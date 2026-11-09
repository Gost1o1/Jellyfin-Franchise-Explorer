using System.Reflection;
using System.Security.Claims;
using System.Xml.Serialization;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

internal static class ArtworkTests
{
    public static async Task Run()
    {
        static void Check(bool value, string message) { if (!value) throw new Exception(message); }
        var root = Path.Combine(Path.GetTempPath(), "franchise-artwork-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Call = method => method.ReturnType == typeof(string) ? root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>();
            ((Proxy)(object)xml).Call = method => method.ReturnType == typeof(object) ? new PluginConfiguration() : null;
            var plugin = new Plugin(paths, xml);
            var user = new User("artwork tester", "default", "default") { Id = Guid.NewGuid() };
            user.SetPermission(PermissionKind.EnableMediaPlayback, true);
            user.SetPermission(PermissionKind.IsAdministrator, true);
            user.SetPermission(PermissionKind.EnableAllFolders, true);
            var filename = Path.Combine(root, "associated.mp4");
            await File.WriteAllBytesAsync(filename, new byte[] { 0, 0, 0, 0 });
            var video = new AccessibleVideo { Id = Guid.NewGuid(), Path = filename, Name = "Associated video" };
            var library = DispatchProxy.Create<ILibraryManager, Proxy>();
            ((Proxy)(object)library).Call = method => method.Name == "GetItemById" ? video : null;
            var users = DispatchProxy.Create<IUserManager, Proxy>();
            ((Proxy)(object)users).Call = method => method.Name == "GetUserById" ? user : null;
            var controller = new FranchiseArtworkController(library, users)
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
            };
            Check(controller.CreateVideoPreview(video.Id) is UnauthorizedResult, "A video ticket must require a verified user claim");
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString()) }, "fixture"));
            Check(controller.VideoPreview(Guid.NewGuid()) is NotFoundResult, "Unknown video capabilities must not resolve");
            user.SetPermission(PermissionKind.EnableMediaPlayback, false);
            Check(controller.CreateVideoPreview(video.Id) is NotFoundObjectResult, "Disabled playback permission must reject video capabilities");
            user.SetPermission(PermissionKind.EnableMediaPlayback, true);
            var capability = controller.CreateVideoPreview(video.Id) as OkObjectResult;
            Check(capability is not null, "An authorized visible video should receive a capability");
            var capabilityJson = System.Text.Json.JsonSerializer.SerializeToElement(capability!.Value);
            var ticket = Guid.Parse(capabilityJson.GetProperty("url").GetString()!.Split('/').Last());
            Check(ticket != video.Id && controller.VideoPreview(video.Id) is NotFoundResult, "A library ID must not be usable as a playback capability");
            Check(controller.VideoPreview(ticket) is PhysicalFileResult { EnableRangeProcessing: true }, "A valid capability should serve only its video with range support");
            user.SetPermission(PermissionKind.EnableMediaPlayback, false);
            Check(controller.VideoPreview(ticket) is NotFoundResult, "Revoking user playback permission must revoke an already issued capability");

            var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4Y5z2HwAFmQJlW9o7EQAAAABJRU5ErkJggg==");
            async Task<string> Upload(byte[] data)
            {
                using var stream = new MemoryStream(data);
                var result = await controller.UploadAsset(new FormFile(stream, 0, data.Length, "file", "photo.png"), default);
                Check(result is OkObjectResult, "A valid raster upload should succeed without a persisted node");
                var json = System.Text.Json.JsonSerializer.Serialize(((OkObjectResult)result).Value);
                return System.Text.Json.JsonDocument.Parse(json).RootElement.GetProperty("url").GetString()!;
            }
            var first = await Upload(png);
            var second = await Upload(png);
            Check(first != second && first.StartsWith("/FranchiseExplorer/Artwork/Assets/"), "Uploads must create immutable, token-free asset URLs");
            var id = Guid.Parse(first.Split('/').Last());
            var read = controller.ReadAsset(id) as PhysicalFileResult;
            Check(read is not null && (await File.ReadAllBytesAsync(read.FileName)).SequenceEqual(png), "A later upload must not overwrite a prior draft asset");
            using var invalid = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("<svg onload='alert(1)'/>"));
            Check(await controller.UploadAsset(new FormFile(invalid, 0, invalid.Length, "file", "unsafe.svg"), default) is BadRequestObjectResult, "Active or invalid uploads must be rejected");
            var config = new PluginConfiguration();
            config.Rows.Add(new FranchiseRow { Category = "Movies", SourceUrl = "https://www.imdb.com/list/ls1/", Artwork = new ArtworkMetadata { PrimaryUrl = first, BackdropVideoItemId = video.Id.ToString() } });
            config.Rows[0].Items.Add(new FranchiseRowEntry { Artwork = new ArtworkMetadata { BackdropUrl = second } });
            config.MediaLinks.Add(new MediaLink { Artwork = new ArtworkMetadata { PrimaryUrl = first } });
            config.Nodes.Add(new FranchiseNode { Name = "Scope test", AutoAddRecords = new() { new FranchiseAutoAddRecord { ScopeRowId = config.Rows[0].Id } } });
            var serializer = new XmlSerializer(typeof(PluginConfiguration));
            using var writer = new StringWriter(); serializer.Serialize(writer, config);
            using var reader = new StringReader(writer.ToString()); var restored = (PluginConfiguration)serializer.Deserialize(reader)!;
            Check(restored.Rows[0].Category == "Movies" && restored.Rows[0].Artwork.BackdropVideoItemId == video.Id.ToString() && restored.Rows[0].Items[0].Artwork.BackdropUrl == second && restored.MediaLinks[0].Artwork.PrimaryUrl == first, "Row/item/link artwork and category must survive real XML configuration serialization");
            Check(restored.Nodes[0].AutoAddRecords[0].ScopeRowId == config.Rows[0].Id && restored.Rows[0].SourceUrl == config.Rows[0].SourceUrl, "Independent row ownership and IMDb URLs must survive XML serialization");
            Console.WriteLine("PASS artwork API: authenticated capabilities, playback denial, immutable draft uploads, invalid-file rejection and XML persistence");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
    private sealed class AccessibleVideo : Video
    {
        public override bool IsVisible(User user, bool allowHidden = false) => true;
    }
    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?> Call { get; set; } = _ => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method is null) return null;
            var result = Call(method);
            return result ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
        }
    }
}
