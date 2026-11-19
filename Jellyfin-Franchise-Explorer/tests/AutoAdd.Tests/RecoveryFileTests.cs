using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

internal static class RecoveryFileTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    public static async Task Run()
    {
        await InspectNativeRecords();
        await EnforceConfiguredRoots();
        await MissingEmptyAndLockedFiles();
        await QueueWithoutCancellingOrPretendingImport();
        await ReadOnlyMovieRemainsRecoverable();
        await EnforceAdministrator();
        Console.WriteLine("PASS server file recovery diagnostics: native path/type/duplicate inspection, configured roots, read-only files, absent/empty/locked files, guarded scan queue, real-ID recovery and administrator access");
    }

    private static async Task InspectNativeRecords()
    {
        using var fixture = new Fixture();
        var path = fixture.WriteVideo();
        var movie = fixture.Add(new Movie { Name = "Star Wars", Path = path });
        var generic = fixture.Add(new Video { Name = "A New Hope generic video", Path = path });
        var virtualMovie = fixture.Add(new Movie { Name = "Stale virtual movie", Path = path, IsVirtualItem = true });
        var parent = fixture.Add(new Folder { Name = "Movie folder", Path = Path.GetDirectoryName(path)! });
        fixture.Folders.Add(new VirtualFolderInfo { Name = "Overlapping source", Locations = [Path.GetDirectoryName(path)!] });
        var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
        var report = await fixture.Files.CheckAsync(path);
        Check(report.InLibrary && report.FileExists && report.Readable && report.Libraries.Count == 2,
            "The diagnostic must inspect the real server file and report every matching configured library");
        Check(report.Items.Count == 3 && report.Items.Any(i => i.ItemId == movie.Id.ToString("D") && i.ItemType == "Movie" && i.Supported)
            && report.Items.Any(i => i.ItemId == generic.Id.ToString("D") && i.ItemType == "Video" && !i.Supported)
            && report.Items.Any(i => i.ItemId == virtualMovie.Id.ToString("D") && i.IsVirtual && !i.Supported),
            "Exact native path inspection must reveal supported, generic and virtual duplicate records without relabeling them");
        Check(report.ParentItems.Single().ItemId == parent.Id.ToString("D") && !report.ParentItems[0].Supported,
            "The file's native parent record must be reported separately rather than offered as the movie");
        Check(fixture.Queries.Count == 2 && fixture.Queries.Select(q => q.Path).SequenceEqual(new[] { path, Path.GetDirectoryName(path) }),
            "Only exact file and parent paths must be queried; the diagnostic must not enumerate the whole index");
        Check(fixture.Queries.All(q => q.IncludeItemTypes.Length == 0 && q.IsVirtualItem is null
            && q.GroupByPresentationUniqueKey == false && q.Limit is null && !q.Recursive),
            "Native path inspection must not hide unexpected types, virtual records or duplicate presentation records");
        Check(before == MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) && fixture.SaveCount == 0 && fixture.ScanCount == 0,
            "Checking a file must never capture configuration, reconnect links, or start a native scan");
    }

    private static async Task EnforceConfiguredRoots()
    {
        using var fixture = new Fixture();
        foreach (var path in new[] { fixture.Root + "-sibling/movie.mkv", Path.Combine(fixture.Root, "..", "outside.mkv") })
        {
            var report = await fixture.Files.CheckAsync(path);
            Check(!report.InLibrary && !report.FileExists && !report.Readable && report.Items.Count == 0 && fixture.Queries.Count == 0,
                "A sibling-prefix or canonicalized traversal path outside configured roots must be rejected before filesystem probing or native queries");
            report = await fixture.Files.ScanAsync(path);
            Check(fixture.ScanCount == 0 && report.ScanState == "None", "Outside paths must never queue native library scans");
        }
        foreach (var path in new[] { "relative.mkv", "", new string('x', 4097), fixture.Root + "\0video.mkv" })
            Check(await Rejects(() => fixture.Files.CheckAsync(path)), "Relative, empty, overlong and invalid paths must fail validation");
        var valid = fixture.WriteVideo();
        fixture.Folders.Clear();
        Check(!(await fixture.Files.CheckAsync(valid)).InLibrary && fixture.Queries.Count == 0,
            "Configured library roots must be reloaded on each request, including removed locations");
    }

    private static async Task MissingEmptyAndLockedFiles()
    {
        using var fixture = new Fixture();
        var missing = await fixture.Files.CheckAsync(Path.Combine(fixture.Root, "missing.mkv"));
        Check(!missing.FileExists && !missing.Readable && missing.Error.Length > 0,
            "A nonexistent file must be reported unavailable without an imported native record");
        var emptyPath = fixture.WriteVideo("empty.mkv", []);
        var empty = await fixture.Files.CheckAsync(emptyPath);
        Check(empty.FileExists && !empty.Readable && empty.Error.Contains("empty", StringComparison.OrdinalIgnoreCase),
            "An empty file must not be described as a readable playable movie");
        Check((await fixture.Files.ScanAsync(emptyPath)).ScanState == "None" && fixture.ScanCount == 0,
            "A missing or empty file cannot trigger an import claim or scan request");
        var lockedPath = fixture.WriteVideo("locked.mkv");
        using (var locked = new FileStream(lockedPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            var report = await fixture.Files.CheckAsync(lockedPath);
            Check(report.FileExists && !report.Readable && report.Error.Length > 0,
                "Failure to open an existing file from the server process must be distinct from a missing native media record");
            Check((await fixture.Files.ScanAsync(lockedPath)).ScanState == "None" && fixture.ScanCount == 0,
                "A file unreadable by the server process must not queue a scan as though it were accessible");
        }
        Check(await Rejects(() => fixture.Files.CheckAsync(fixture.Root + Path.DirectorySeparatorChar)),
            "A directory path must require the actual video filename rather than be passed off as a video");
    }

    private static async Task QueueWithoutCancellingOrPretendingImport()
    {
        using var fixture = new Fixture();
        var path = fixture.WriteVideo();
        var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
        var reports = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => fixture.Files.ScanAsync(path)));
        Check(fixture.ScanCount == 1 && reports.Count(r => r.ScanState == "Queued") == 1
            && reports.Count(r => r.ScanState == "AlreadyQueued") == 7,
            "Concurrent repeated requests must queue exactly one native task while it is waiting to start");
        Check(reports.All(r => r.Items.Count == 0 && r.Message.Contains("queued", StringComparison.OrdinalIgnoreCase))
            && fixture.Media.Count == 0 && fixture.SaveCount == 0 && MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) == before,
            "Queueing a native scan must not pretend it completed, import synthetic item IDs, or change franchise settings");
        fixture.Scanning = true;
        var running = await fixture.Files.ScanAsync(path);
        Check(running.ScanState == "Running" && fixture.ScanCount == 1,
            "An active global native scan must be reported rather than cancelled or requeued");
        Check((await fixture.Files.CheckAsync(path)).ScanState == "Running", "Read-only diagnostics must expose an active scan too");
        using var alreadyScanning = new Fixture { Scanning = true };
        Check((await alreadyScanning.Files.ScanAsync(alreadyScanning.WriteVideo())).ScanState == "Running" && alreadyScanning.ScanCount == 0,
            "A scan that began elsewhere must also be protected from ValidateMediaLibrary's cancel-and-requeue behavior");
    }

    private static async Task ReadOnlyMovieRemainsRecoverable()
    {
        using var fixture = new Fixture();
        var bytes = new byte[] { 0x1a, 0x45, 0xdf, 0xa3, 0x10 };
        var path = fixture.WriteVideo("Star Wars Episode IV A New Hope (1977) [tt0076759].mkv", bytes);
        var flags = File.GetAttributes(path) | FileAttributes.ReadOnly;
        if (OperatingSystem.IsWindows()) flags |= FileAttributes.Archive;
        File.SetAttributes(path, flags);
        var original = File.GetAttributes(path);
        var movie = fixture.Add(new Movie { Name = "Star Wars", Path = path, ProductionYear = 1977, ProviderIds = new() { ["Imdb"] = "tt0076759" } });
        var link = new MediaLink
        {
            JellyfinItemId = Guid.NewGuid().ToString("D"), DisplayName = "Star Wars Episode IV A New Hope", ItemType = "Movie",
            Identity = new() { ItemType = "Movie", Year = 1977, ProviderIds = [new() { Name = "Imdb", Value = "tt0076759" }] }
        };
        fixture.Plugin.Configuration.MediaLinks.Add(link);
        var report = await fixture.Files.CheckAsync(path);
        Check(report.FileExists && report.Readable && report.Attributes.Contains("ReadOnly") && report.Items.Single().Supported,
            "ReadOnly (and Archive on Windows) must remain readable and supported without clearing file attributes");
        var inventory = AutoFranchiseService.ReadLibrary(fixture.Library);
        Check(inventory.Single().IsAvailable && inventory[0].Id == movie.Id.ToString("D"),
            "The actual automatic inventory must include a native movie whose video is read-only");
        var snapshots = new FranchiseLibrarySnapshotService(fixture.Library);
        using var recovery = new MediaRecoveryService(fixture.Library, snapshots, NullLogger<MediaRecoveryService>.Instance);
        var auto = await recovery.AutoAsync();
        Check(auto.RemappedCount == 1 && fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == movie.Id.ToString("D"),
            "Automatic recovery must link the read-only movie's real native ID using its saved provider identity");
        Check(File.GetAttributes(path) == original && File.ReadAllBytes(path).SequenceEqual(bytes),
            "Diagnostic and automatic linking must preserve the original video bytes and all file attributes");
    }

    private static async Task EnforceAdministrator()
    {
        using var fixture = new Fixture();
        var path = fixture.WriteVideo();
        var user = new User("file diagnostic tester", "default", "default") { Id = Guid.NewGuid() };
        var users = DispatchProxy.Create<IUserManager, Proxy>();
        ((Proxy)(object)users).Call = (method, _) => method.Name == "GetUserById" ? user : null;
        var controller = new FranchiseRecoveryFileController(fixture.Files, users)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var policy = typeof(FranchiseRecoveryFileController).GetCustomAttribute<AuthorizeAttribute>();
        Check(policy?.Policy == Policies.RequiresElevation, "File diagnostics and scan routes must retain Jellyfin's elevated authorization policy");
        var request = new RecoveryFileRequest { Path = path };
        Check(await controller.Check(request, default) is UnauthorizedResult && await controller.Scan(request, default) is UnauthorizedResult,
            "Both file endpoints must reject a missing Jellyfin user before probing files or queueing scans");
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", user.Id.ToString())], "fixture"));
        Check(await controller.Check(request, default) is UnauthorizedResult && await controller.Scan(request, default) is UnauthorizedResult
            && fixture.Queries.Count == 0 && fixture.ScanCount == 0,
            "An authenticated non-administrator must not inspect server paths or start scans");
        user.SetPermission(PermissionKind.IsAdministrator, true);
        var result = await controller.Check(request, default);
        Check(result is ContentResult { ContentType: "application/json; charset=utf-8" } && controller.Response.Headers.CacheControl == "no-store",
            "An administrator must receive camel-case file diagnostics without response caching");
        using var json = JsonDocument.Parse(((ContentResult)result).Content!);
        Check(json.RootElement.GetProperty("fileExists").GetBoolean() && json.RootElement.GetProperty("readable").GetBoolean()
            && json.RootElement.GetProperty("scanState").GetString() == "None", "The API must expose the agreed readable-file and scan-state contract");
        Check(await controller.Check(new() { Path = "relative.mkv" }, default) is BadRequestObjectResult,
            "Invalid server paths must return a clear bad-request response");
        Check(await controller.Scan(request, default) is ContentResult && fixture.ScanCount == 1 && fixture.SaveCount == 0,
            "Only an administrator's explicit scan request may queue a native task; it must not save configuration");
    }

    private static async Task<bool> Rejects(Func<Task> action)
    {
        try { await action(); return false; }
        catch (ArgumentException) { return true; }
    }

    private sealed class Fixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "franchise-file-check-" + Guid.NewGuid().ToString("N"));
        public List<BaseItem> Media { get; } = [];
        public List<VirtualFolderInfo> Folders { get; } = [];
        public List<InternalItemsQuery> Queries { get; } = [];
        public ILibraryManager Library { get; }
        public RecoveryFileService Files { get; }
        public Plugin Plugin { get; }
        public bool Scanning { get; set; }
        public int ScanCount { get; private set; }
        public int SaveCount { get; private set; }

        public Fixture()
        {
            Directory.CreateDirectory(Root);
            Folders.Add(new() { Name = "Movies", Locations = [Root], CollectionType = CollectionTypeOptions.movies });
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? Root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>();
            ((Proxy)(object)xml).Call = (method, _) =>
            {
                if (method.Name == "SerializeToFile") SaveCount++;
                return method.ReturnType == typeof(object) ? new PluginConfiguration() : null;
            };
            Plugin = new Plugin(paths, xml);
            Library = DispatchProxy.Create<ILibraryManager, Proxy>();
            ((Proxy)(object)Library).Call = (method, args) =>
            {
                if (method.Name == "GetVirtualFolders") return Folders;
                if (method.Name == "get_IsScanRunning") return Scanning;
                if (method.Name == "ValidateMediaLibrary") { ScanCount++; return Task.CompletedTask; }
                if (method.Name == "GetItemList")
                {
                    var query = (InternalItemsQuery)args![0]!;
                    Queries.Add(query);
                    return string.IsNullOrEmpty(query.Path) ? Media : Media.Where(item => item.Path == query.Path).ToList();
                }
                return null;
            };
            Files = new RecoveryFileService(Library);
        }

        public string WriteVideo(string filename = "video.mkv", byte[]? bytes = null)
        {
            var path = Path.Combine(Root, filename);
            File.WriteAllBytes(path, bytes ?? [0x1a, 0x45, 0xdf, 0xa3]);
            return path;
        }

        public T Add<T>(T item) where T : BaseItem { item.Id = Guid.NewGuid(); Media.Add(item); return item; }

        public void Dispose()
        {
            foreach (var path in Directory.EnumerateFiles(Root, "*", SearchOption.AllDirectories))
                File.SetAttributes(path, File.GetAttributes(path) & ~FileAttributes.ReadOnly);
            Directory.Delete(Root, recursive: true);
        }
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
            => method is null ? null : Call(method, args) ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
    }
}
