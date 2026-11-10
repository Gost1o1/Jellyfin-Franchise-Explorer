using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using Jellyfin.Data;
using Jellyfin.Extensions.Json.Converters;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Web;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;

internal static class SubtitleOffRegressionTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    public static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "franchise-subtitle-regression-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try { await RunAt(root); }
        finally { Directory.Delete(root, true); }
        Console.WriteLine("PASS subtitle Off: real MVC route/model binding/negotiation, durable per-user preferences, exact native timeline/device scope and player correction");
    }

    private static async Task RunAt(string root)
    {
        var user = new User("subtitle MVC tester", "default", "default") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.EnableMediaPlayback, true);
        var other = new User("other tester", "default", "default") { Id = Guid.NewGuid() };
        other.SetPermission(PermissionKind.EnableMediaPlayback, true);
        var item = Guid.NewGuid();
        var next = Guid.NewGuid();
        var ordinary = Guid.NewGuid();
        var row = Guid.NewGuid();
        var users = DispatchProxy.Create<IUserManager, PlaybackSubtitleTests.Proxy>();
        ((PlaybackSubtitleTests.Proxy)(object)users).Call = (method, args) => method.Name == "GetUserById"
            ? args?[0] is Guid id && id == user.Id ? user : args?[0] is Guid otherId && otherId == other.Id ? other : null : null;
        var sessions = DispatchProxy.Create<ISessionManager, PlaybackSubtitleTests.Proxy>();
        var active = new List<SessionInfo>
        {
            new(sessions, NullLogger.Instance) { Id = "web-session", UserId = user.Id, DeviceId = "web-device" },
            new(sessions, NullLogger.Instance) { Id = "native-session", UserId = user.Id, DeviceId = "native-device",
                Capabilities = new ClientCapabilities { SupportedCommands = new[] { GeneralCommandType.SetSubtitleStreamIndex } } },
            new(sessions, NullLogger.Instance) { Id = "unrelated-session", UserId = user.Id, DeviceId = "other-device" },
            new(sessions, NullLogger.Instance) { Id = "other-user-session", UserId = other.Id, DeviceId = "other-user-device" }
        };
        var commands = new List<(string Session, int Index)>();
        ((PlaybackSubtitleTests.Proxy)(object)sessions).Call = (method, args) =>
        {
            if (method.Name == "get_Sessions") return active;
            if (method.Name == "SendGeneralCommand")
            {
                commands.Add(((string)args![1]!, int.Parse(((GeneralCommand)args[2]!).Arguments["Index"])));
                return Task.CompletedTask;
            }
            return null;
        };
        var library = DispatchProxy.Create<ILibraryManager, PlaybackSubtitleTests.Proxy>();
        ((PlaybackSubtitleTests.Proxy)(object)library).Call = (method, args) => method.Name == "GetItemById"
            ? new VisibleVideo { Id = args?[0] is Guid id ? id : item } : null;
        var sources = DispatchProxy.Create<IMediaSourceManager, PlaybackSubtitleTests.Proxy>();
        ((PlaybackSubtitleTests.Proxy)(object)sources).Call = (method, _) => method.Name == "GetStaticMediaSources"
            ? FixtureResponse().MediaSources.ToList() : null;
        var preferences = new FranchiseViewerPreferenceStore(() => root);
        var leases = new PlaybackSubtitlePolicyStore();
        var timelines = new FranchiseSubtitleTimelineScope(() => root, id => id == row);
        var probe = new SubtitleNegotiationProbe();
        var server = new InProcessServer();
        using var host = new HostBuilder().ConfigureWebHost(web => web.UseServer(server).ConfigureServices(services =>
        {
            services.AddLogging();
            services.AddAuthorization();
            services.AddAuthentication("fixture").AddScheme<AuthenticationSchemeOptions, FixtureAuthenticationHandler>("fixture", _ => { });
            services.AddSingleton(users); services.AddSingleton(sessions); services.AddSingleton(library); services.AddSingleton(sources);
            services.AddSingleton(preferences); services.AddSingleton(leases); services.AddSingleton(timelines); services.AddSingleton(probe);
            services.AddScoped<PlaybackSubtitlePolicyFilter>();
            services.AddControllers(options => options.Filters.AddService<PlaybackSubtitlePolicyFilter>())
                .AddJsonOptions(options =>
                {
                    options.JsonSerializerOptions.PropertyNamingPolicy = null;
                    options.JsonSerializerOptions.Converters.Add(new JsonGuidConverter());
                    options.JsonSerializerOptions.Converters.Add(new JsonNullableGuidConverter());
                })
                .AddApplicationPart(typeof(Jellyfin.Api.Controllers.MediaInfoController).Assembly)
                .AddApplicationPart(typeof(FranchiseViewerPreferencesController).Assembly);
        }).Configure(app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                var selectedUser = context.Request.Headers["Test-User"] == "other" ? other.Id : user.Id;
                var device = context.Request.Headers["Test-Device"].ToString();
                if (string.IsNullOrEmpty(device)) device = "web-device";
                context.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim("Jellyfin-UserId", selectedUser.ToString("N")), new Claim("Jellyfin-DeviceId", device)
                }, "fixture-verified-Jellyfin-claims"));
                await nextMiddleware();
            });
            app.UseRouting(); app.UseAuthorization(); app.UseEndpoints(endpoints => endpoints.MapControllers());
        })).Build();
        await host.StartAsync();

        async Task<JsonElement> Json(string method, string path, object? body = null, string device = "web-device", bool otherUser = false, int status = 200)
        {
            var response = await server.Request(method, path, body is null ? null : JsonSerializer.Serialize(body), device, otherUser);
            Check(response.Status == status, $"MVC {method} {path} should return {status}; got {response.Status}: {response.Body}");
            return response.Status != 200 || string.IsNullOrEmpty(response.Body) ? default : JsonDocument.Parse(response.Body).RootElement.Clone();
        }
        var missing = await Json("GET", "/FranchiseExplorer/ViewerPreferences");
        Check(!missing.GetProperty("hasPreference").GetBoolean(), "Missing preferences must not silently override legacy behavior");
        await Json("PUT", "/FranchiseExplorer/ViewerPreferences", new { subtitleEnabled = false, subtitleLanguage = "de" });
        var restarted = new FranchiseViewerPreferenceStore(() => root);
        Check(restarted.Get(user.Id) == new FranchiseViewerPreference(true, false, "de") && !restarted.Get(other.Id).HasPreference,
            "Preferences must survive a store restart and stay isolated by authenticated account");
        var otherPreference = await Json("GET", "/FranchiseExplorer/ViewerPreferences", otherUser: true);
        Check(!otherPreference.GetProperty("hasPreference").GetBoolean(), "The real preferences endpoint must use the current verified account");
        await Json("PUT", "/FranchiseExplorer/ViewerPreferences", new { subtitleLanguage = "de" }, status: 400);
        await Json("PUT", "/FranchiseExplorer/ViewerPreferences", new { subtitleEnabled = false, subtitleLanguage = "invalid language" }, status: 400);
        var enrolled = await Json("POST", "/FranchiseExplorer/PlaybackPreferences", new { itemIds = new[] { item, next }, enabled = true, language = "en" });
        Check(enrolled.GetProperty("hasPreference").GetBoolean() && !enrolled.GetProperty("enabled").GetBoolean()
            && enrolled.GetProperty("subtitleStreamIndex").GetInt32() == -1 && enrolled.GetProperty("deviceId").GetString() == "web-device",
            "Durable Off must beat stale local On and omitted device must use the authenticated claim");
        await Json("POST", "/FranchiseExplorer/PlaybackPreferences", new { deviceId = "other-user-device", itemIds = new[] { item }, enabled = false }, status: 403);
        var path = "/Items/" + item.ToString("N") + "/PlaybackInfo";
        var playback = await Json("POST", path + "?SubtitleStreamIndex=7", new { userId = user.Id.ToString("N"), subtitleStreamIndex = 17, mediaSourceId = "source-a" });
        Check(probe.LastSubtitleIndex == -1 && probe.LastSource == "source-a", "Real MVC query/body binding must apply Off before controller codec negotiation");
        CheckOff(playback);
        CheckOff(await Json("GET", path));
        await Json("POST", "/Items/" + ordinary.ToString("N") + "/PlaybackInfo", new { subtitleStreamIndex = 7 });
        Check(probe.LastSubtitleIndex == 7, "Ordinary library playback must not inherit a stored franchise preference");
        await Json("POST", path, new { userId = other.Id.ToString("N"), subtitleStreamIndex = 7 });
        Check(probe.LastSubtitleIndex == 7, "An administrator's explicitly different playback user must not receive their own preference");
        await Json("PUT", "/FranchiseExplorer/ViewerPreferences", new { subtitleEnabled = true, subtitleLanguage = "de" });
        var enabled = await Json("POST", path, new { subtitleStreamIndex = -1, mediaSourceId = "source-a" });
        Check(probe.LastSubtitleIndex == 11 && enabled.GetProperty("MediaSources")[0].GetProperty("DefaultSubtitleStreamIndex").GetInt32() == 11,
            "An active queue must read the latest account preference, including nonzero real stream indices");
        await Json("PUT", "/FranchiseExplorer/ViewerPreferences", new { subtitleEnabled = false, subtitleLanguage = "" });
        user.SubtitleLanguagePreference = "eng";
        var inheritedLanguage = await Json("POST", "/FranchiseExplorer/PlaybackPreferences", new { itemIds = new[] { item, next }, enabled = true, language = "de" });
        Check(inheritedLanguage.GetProperty("subtitleLanguage").GetString() == "" && inheritedLanguage.GetProperty("language").GetString() == "eng",
            "The inherited setting must remain empty while the concrete launch language resolves from the verified Jellyfin account");

        var state = new FranchiseTimelineController.TimelineProgress
        {
            RowId = row.ToString("N"), PlaybackMode = "armed", ArmedUtc = DateTimeOffset.UtcNow, Index = 0,
            QueueKeys = new() { "episode:" + item.ToString("N"), "episode:" + next.ToString("N") }, UpdatedUtc = DateTimeOffset.UtcNow
        };
        var folder = Path.Combine(root, "timeline-progress", user.Id.ToString("N"));
        Directory.CreateDirectory(folder);
        var statePath = Path.Combine(folder, row.ToString("N") + ".json");
        void WriteState() => File.WriteAllText(statePath, JsonSerializer.Serialize(state, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        WriteState();
        CheckOff(await Json("POST", path, new { subtitleStreamIndex = 7 }, "other-device"));
        // Device B may prefetch the armed first item before actual playback on
        // A binds the timeline. That probe must not grant B the remaining queue.
        state.PlaybackMode = "playing"; state.SessionId = "native-session"; state.ArmedUtc = null; WriteState();
        foreach (var requestedItem in new[] { item, next })
        {
            var unrelated = await Json("POST", "/Items/" + requestedItem.ToString("N") + "/PlaybackInfo", new { subtitleStreamIndex = 7 }, "other-device");
            Check(probe.LastSubtitleIndex == 7
                && unrelated.GetProperty("MediaSources")[0].GetProperty("DefaultSubtitleStreamIndex").GetInt32() == 7,
                "An armed prefetch must not keep applying subtitles after a different device activates the timeline");
            Check(!leases.TryGet(user.Id, "other-device", requestedItem, out _),
                "Timeline fallback must not create a persistent playback preference lease");
        }
        CheckOff(await Json("POST", path, new { subtitleStreamIndex = 7 }, "native-device"));
        await Json("POST", path, new { subtitleStreamIndex = 7 }, "other-device");
        Check(probe.LastSubtitleIndex == 7, "A different same-user device cannot adopt another session's playing timeline");
        await Json("POST", "/Items/" + ordinary.ToString("N") + "/PlaybackInfo", new { subtitleStreamIndex = 7 }, "native-device");
        Check(probe.LastSubtitleIndex == 7, "A native device's ordinary out-of-queue title must remain untouched");
        state.PlaybackMode = "paused"; WriteState();
        var isolated = new FranchiseSubtitleTimelineScope(() => root, id => id == row);
        Check(!isolated.TryQueue(user.Id, "native-device", item, sessions, out _), "Paused timeline history must not enroll native playback");
        state.PlaybackMode = "armed"; state.ArmedUtc = DateTimeOffset.UtcNow; state.SessionId = ""; WriteState();
        Check(isolated.TryQueue(user.Id, "native-device", item, sessions, out var armedQueue) && armedQueue.Length == 2
            && !isolated.TryQueue(user.Id, "native-device", next, sessions, out _), "A recent explicit arm may enroll only its intended first item, then its exact queue");
        state.PlaybackMode = "playing"; state.SessionId = "native-session"; WriteState();
        active[1].PlayState.SubtitleStreamIndex = 7;
        active[1].NowPlayingItem = new BaseItemDto { Id = item };
        var nativeLeases = new PlaybackSubtitlePolicyStore();
        var playbackService = new FranchiseSubtitlePlaybackService(sessions, users, sources, nativeLeases, preferences, timelines);
        await playbackService.EnforceAsync(new PlaybackProgressEventArgs { Session = active[1], Item = new VisibleVideo { Id = item } });
        Check(commands.Count == 1 && commands[0] == ("native-session", -1), "Native ASS/forced restored subtitles require the real player SetSubtitleStreamIndex command");
        state.PlaybackMode = "paused"; WriteState();
        // Fresh service instances prevent the command throttle from hiding a
        // stale lease that could otherwise outlive either timeline transition.
        await new FranchiseSubtitlePlaybackService(sessions, users, sources, nativeLeases, preferences, timelines)
            .EnforceAsync(new PlaybackProgressEventArgs { Session = active[1], Item = new VisibleVideo { Id = item } });
        Check(commands.Count == 1, "Native fallback must stop correcting the player when its timeline is paused");
        state.PlaybackMode = "playing"; state.SessionId = "unrelated-session"; WriteState();
        await new FranchiseSubtitlePlaybackService(sessions, users, sources, nativeLeases, preferences, timelines)
            .EnforceAsync(new PlaybackProgressEventArgs { Session = active[1], Item = new VisibleVideo { Id = item } });
        Check(commands.Count == 1, "Native fallback must stop correcting the old device after its timeline transfers to another session");
        Check(!nativeLeases.TryGet(user.Id, "native-device", item, out _)
            && !nativeLeases.TryGet(user.Id, "native-device", next, out _),
            "Native timeline fallback must not create a persistent playback preference lease");
        active[1].NowPlayingItem = new BaseItemDto { Id = ordinary };
        await playbackService.EnforceAsync(new PlaybackProgressEventArgs { Session = active[1], Item = new VisibleVideo { Id = ordinary } });
        Check(commands.Count == 1, "No player command may alter ordinary out-of-scope native playback");
        await playbackService.EnforceAsync(new PlaybackProgressEventArgs { Session = active[1], Item = new VisibleVideo { Id = item } });
        Check(commands.Count == 1, "A delayed franchise event must not command a newly playing unrelated title");
        var preferencePath = Path.Combine(root, "viewer-preferences", user.Id.ToString("N") + ".json");
        File.Move(preferencePath, preferencePath + ".old");
        Directory.CreateDirectory(preferencePath);
        var writeFailed = false;
        try { preferences.Set(user.Id, true, "fr"); }
        catch (IOException) { writeFailed = true; }
        Check(writeFailed && !preferences.Get(user.Id).SubtitleEnabled, "A failed atomic save must retain the previous effective preference");
        var freshStore = new FranchiseViewerPreferenceStore(() => root);
        var readFailed = false;
        try { freshStore.Get(user.Id); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { readFailed = true; }
        Check(readFailed, "An unreadable saved preference must fail visibly instead of becoming an unconfigured browser default");
        Directory.Delete(preferencePath);
        File.Move(preferencePath + ".old", preferencePath);
        Check(freshStore.Get(user.Id) is { HasPreference: true, SubtitleEnabled: false },
            "A failed read must not cache a missing preference and must recover when the saved file becomes readable");
        Check(!new FranchiseViewerPreferenceStore(() => root).Get(user.Id).SubtitleEnabled,
            "A failed save must not replace the durable preference file");
        await host.StopAsync();
    }

    private static void CheckOff(JsonElement response)
    {
        var source = response.GetProperty("MediaSources")[0];
        Check(source.GetProperty("DefaultSubtitleStreamIndex").GetInt32() == -1
            && source.GetProperty("TranscodingUrl").GetString()!.Contains("SubtitleStreamIndex=-1", StringComparison.Ordinal),
            "Scoped Off must survive real MVC response execution and encoding URL serialization");
    }

    internal static PlaybackInfoResponse FixtureResponse() => new()
    {
        PlaySessionId = "real-mvc-play-session", MediaSources = new[] { new MediaSourceInfo
        {
            Id = "source-a", DefaultSubtitleStreamIndex = 7,
            TranscodingUrl = "/Videos/id/master.m3u8?SubtitleStreamIndex=7&AudioStreamIndex=2",
            MediaStreams = new List<MediaStream>
            {
                new() { Type = MediaStreamType.Audio, Index = 2 },
                new() { Type = MediaStreamType.Subtitle, Index = 7, Codec = "ass", IsForced = true },
                new() { Type = MediaStreamType.Subtitle, Index = 11, Language = "deu", Codec = "srt" }
            }
        } }
    };

    private sealed class VisibleVideo : MediaBrowser.Controller.Entities.Video
    { public override bool IsVisible(User user, bool allowHidden = false) => true; }

    private sealed class FixtureAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
            => Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(Context.User, "fixture")));
    }

    private sealed class InProcessServer : IServer
    {
        private Func<IFeatureCollection, Task>? _request;
        public IFeatureCollection Features { get; } = new FeatureCollection();
        public Task StartAsync<TContext>(IHttpApplication<TContext> application, CancellationToken token) where TContext : notnull
        {
            _request = async features =>
            {
                var context = application.CreateContext(features);
                Exception? error = null;
                try { await application.ProcessRequestAsync(context); }
                catch (Exception ex) { error = ex; throw; }
                finally { application.DisposeContext(context, error); }
            };
            return Task.CompletedTask;
        }
        public Task StopAsync(CancellationToken token) => Task.CompletedTask;
        public void Dispose() { }
        public async Task<(int Status, string Body)> Request(string method, string path, string? json, string device, bool other)
        {
            var split = path.IndexOf('?');
            var response = new HttpResponseFeature { StatusCode = 200 };
            var bytes = Encoding.UTF8.GetBytes(json ?? string.Empty);
            var headers = new HeaderDictionary { ["Content-Type"] = "application/json", ["Content-Length"] = bytes.Length.ToString(), ["Test-Device"] = device };
            if (other) headers["Test-User"] = "other";
            var request = new HttpRequestFeature
            {
                Protocol = "HTTP/1.1", Scheme = "http", Method = method, Path = split < 0 ? path : path[..split],
                QueryString = split < 0 ? "" : path[split..], Headers = headers, Body = new MemoryStream(bytes)
            };
            var stream = new MemoryStream();
            var features = new FeatureCollection();
            features.Set<IHttpRequestFeature>(request); features.Set<IHttpResponseFeature>(response);
            features.Set<IHttpResponseBodyFeature>(new StreamResponseBodyFeature(stream));
            await _request!(features);
            return (response.StatusCode, Encoding.UTF8.GetString(stream.ToArray()));
        }
    }
}

public sealed class SubtitleNegotiationProbe
{
    public int? LastSubtitleIndex { get; set; }
    public string? LastSource { get; set; }
}

namespace Jellyfin.Api.Controllers
{
    [ApiController]
    [Route("")]
    public sealed class MediaInfoController(SubtitleNegotiationProbe? probe = null) : ControllerBase
    {
        [HttpGet("Items/{itemId}/PlaybackInfo")]
        public async Task<ActionResult<PlaybackInfoResponse>> GetPlaybackInfo([FromRoute] Guid itemId, [FromQuery] Guid? userId)
        { await Task.Yield(); return SubtitleOffRegressionTests.FixtureResponse(); }

        [HttpPost("Items/{itemId}/PlaybackInfo")]
        public async Task<ActionResult<PlaybackInfoResponse>> GetPostedPlaybackInfo(
            [FromRoute] Guid itemId, [FromQuery] Guid? userId, [FromQuery] int? subtitleStreamIndex,
            [FromQuery] string? mediaSourceId, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] PlaybackInfoDto? playbackInfoDto)
        {
            subtitleStreamIndex ??= playbackInfoDto?.SubtitleStreamIndex;
            mediaSourceId ??= playbackInfoDto?.MediaSourceId;
            if (probe is not null) { probe.LastSubtitleIndex = subtitleStreamIndex; probe.LastSource = mediaSourceId; }
            await Task.Yield();
            return SubtitleOffRegressionTests.FixtureResponse();
        }
    }

    public sealed class PlaybackInfoDto
    {
        public Guid? UserId { get; set; }
        public int? SubtitleStreamIndex { get; set; }
        public string? MediaSourceId { get; set; }
    }
}
