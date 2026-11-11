using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Web;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging.Abstractions;

internal static class PlaybackSubtitleTests
{
    private static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
    }

    public static async Task Run()
    {
        var clock = new Clock();
        var store = new PlaybackSubtitlePolicyStore(clock);
        var userId = Guid.NewGuid();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        var off = store.Set(userId, "native-device", new[] { first, second }, false, "");
        Check(!off.Enabled && off.ExpiresAt > clock.GetUtcNow(), "An Off lease must have a bounded future expiry");
        Check(store.TryGet(userId, "native-device", second, out _), "An enrolled native queue's later items must retain the policy");
        Check(!store.TryGet(Guid.NewGuid(), "native-device", first, out _), "Another user must not inherit a device policy");
        Check(!store.TryGet(userId, "other-device", first, out _), "Another device must not inherit a user policy");
        Check(store.TryGet(userId, "native-device", first, out _), "Cross-scope lookups must not clear the actual owner's policy");

        var original = PlaybackInfo();
        var disabled = PlaybackSubtitlePolicyFilter.Apply(original, off);
        Check(disabled.MediaSources.All(s => s.DefaultSubtitleStreamIndex == -1), "Off must suppress forced ASS and ordinary subtitle defaults on every media source");
        Check(!ReferenceEquals(original, disabled) && !ReferenceEquals(original.MediaSources, disabled.MediaSources)
            && !ReferenceEquals(original.MediaSources[0], disabled.MediaSources[0])
            && !ReferenceEquals(original.MediaSources[0].MediaStreams, disabled.MediaSources[0].MediaStreams)
            && !ReferenceEquals(original.MediaSources[0].MediaStreams[0], disabled.MediaSources[0].MediaStreams[0]),
            "Playback responses, sources and streams must be cloned before editing cached data");
        Check(original.MediaSources[0].DefaultSubtitleStreamIndex == 7
            && original.MediaSources[0].TranscodingUrl!.Contains("SubtitleStreamIndex=7", StringComparison.Ordinal),
            "Applying a device policy must not mutate Jellyfin's cached source or encoding URL");
        Check(disabled.PlaySessionId == original.PlaySessionId && disabled.MediaSources[0].Name == original.MediaSources[0].Name
            && disabled.MediaSources[0].MediaStreams[0].Codec == "ass" && disabled.MediaSources[0].MediaStreams[0].IsForced,
            "Unrelated playback, source and subtitle metadata must survive cloning");
        CheckUrl(disabled.MediaSources[0].TranscodingUrl!, "-1", "token+value", "2");
        var duplicateQuery = PlaybackInfo();
        duplicateQuery.MediaSources[0].TranscodingUrl = "/stream?SubtitleStreamIndex=7&subtitleStreamIndex=11&api_key=token%2Bvalue&AudioStreamIndex=2&custom=a%26b#fragment";
        CheckUrl(PlaybackSubtitlePolicyFilter.Apply(duplicateQuery, off).MediaSources[0].TranscodingUrl!, "-1", "token+value", "2");

        var german = store.Set(userId, "native-device", new[] { first }, true, "de");
        var enabled = PlaybackSubtitlePolicyFilter.Apply(original, german);
        Check(enabled.MediaSources[0].DefaultSubtitleStreamIndex == 11, "On must match ISO-2 de to ISO-3 deu and select the actual subtitle stream index");
        CheckUrl(enabled.MediaSources[0].TranscodingUrl!, "11", "token+value", "2");

        var fallback = PlaybackSubtitlePolicyFilter.Apply(original, store.Set(userId, "native-device", new[] { first }, true, "ja"));
        Check(fallback.MediaSources[0].DefaultSubtitleStreamIndex == 7, "A missing language should retain a valid subtitle default");
        original.MediaSources[0].DefaultSubtitleStreamIndex = 2; // Audio, not a subtitle.
        var firstSubtitle = PlaybackSubtitlePolicyFilter.Apply(original, german with { Language = "ja" });
        Check(firstSubtitle.MediaSources[0].DefaultSubtitleStreamIndex == 7, "An invalid default must fall back to the first real subtitle, never assumed index zero");
        original.MediaSources[0].MediaStreams = new List<MediaStream>();
        var noTracks = PlaybackSubtitlePolicyFilter.Apply(original, german);
        Check(noTracks.MediaSources[0].DefaultSubtitleStreamIndex == -1, "On with no subtitle tracks must remain disabled");

        store.Set(userId, "native-device", new[] { first }, false, "");
        Check(!store.TryGet(userId, "native-device", Guid.NewGuid(), out _), "Unlisted playback must not receive a franchise subtitle override");
        Check(store.TryGet(userId, "native-device", first, out _), "Unrelated PlaybackInfo requests must preserve the explicit native queue's lease");
        store.Set(userId, "native-device", new[] { second }, true, "de");
        Check(!store.TryGet(userId, "native-device", first, out _) && store.TryGet(userId, "native-device", second, out _),
            "A later explicit launch must replace that device's previous queue scope");
        store.Set(userId, "native-device", new[] { first }, false, "");
        clock.Advance(TimeSpan.FromHours(13));
        Check(!store.TryGet(userId, "native-device", first, out _), "Expired policies must not affect later playback");
        TestEnrollment(clock);
        await TestFilter(clock);
        Console.WriteLine("PASS playback subtitle policies: forced/ASS Off, native queue scope, language indices, expiry, authenticated enrollment and immutable playback URLs");
    }

    private static PlaybackInfoResponse PlaybackInfo() => new()
    {
        PlaySessionId = "preserved-play-session",
        MediaSources = new[]
        {
            new MediaSourceInfo
            {
                Id = "source-a", Name = "Unchanged source", DefaultSubtitleStreamIndex = 7,
                TranscodingUrl = "/Videos/id/master.m3u8?api_key=token%2Bvalue&SubtitleStreamIndex=7&AudioStreamIndex=2&custom=a%26b#fragment",
                MediaStreams = new List<MediaStream>
                {
                    new() { Type = MediaStreamType.Subtitle, Index = 7, Language = "eng", Codec = "ass", IsForced = true },
                    new() { Type = MediaStreamType.Audio, Index = 2, Language = "deu", Codec = "aac" },
                    new() { Type = MediaStreamType.Subtitle, Index = 11, Language = "deu", Codec = "srt" },
                    new() { Type = MediaStreamType.Subtitle, Index = 17, Language = "fra", Codec = "srt" }
                }
            },
            new MediaSourceInfo
            {
                Id = "source-b", DefaultSubtitleStreamIndex = 31,
                MediaStreams = new List<MediaStream> { new() { Type = MediaStreamType.Subtitle, Index = 31, Codec = "pgssub", IsForced = true } }
            }
        }
    };

    private static void CheckUrl(string url, string index, string token, string audio)
    {
        var question = url.IndexOf('?');
        var fragment = url.IndexOf('#');
        var query = QueryHelpers.ParseQuery(url[(question + 1)..(fragment >= 0 ? fragment : url.Length)]);
        var subtitle = query.Single(p => p.Key.Equals("SubtitleStreamIndex", StringComparison.OrdinalIgnoreCase));
        Check(subtitle.Value.Count == 1 && subtitle.Value[0] == index, "Stream URLs must contain exactly one matching subtitle selection");
        Check(query["api_key"] == token && query["AudioStreamIndex"] == audio && query["custom"] == "a&b" && url.EndsWith("#fragment", StringComparison.Ordinal),
            "Subtitle URL changes must preserve authorization, unrelated parameters and fragments");
    }

    private static void TestEnrollment(Clock clock)
    {
        var store = new PlaybackSubtitlePolicyStore(clock);
        var user = new User("subtitle tester", "default", "default") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.EnableMediaPlayback, true);
        var users = DispatchProxy.Create<IUserManager, Proxy>();
        ((Proxy)(object)users).Call = (method, args) => method.Name == "GetUserById" && args?[0] is Guid id && id == user.Id ? user : null;
        var sessions = DispatchProxy.Create<ISessionManager, Proxy>();
        var active = new List<SessionInfo>
        {
            new(sessions, NullLogger.Instance) { Id = "same-user-session", UserId = user.Id, DeviceId = "native-device" },
            new(sessions, NullLogger.Instance) { Id = "other-user-session", UserId = Guid.NewGuid(), DeviceId = "someone-else" }
        };
        ((Proxy)(object)sessions).Call = (method, _) => method.Name == "get_Sessions" ? active : null;
        var controller = new FranchisePlaybackPreferencesController(store, users, sessions)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var item = Guid.NewGuid();
        var request = new FranchisePlaybackPreferencesController.PlaybackPreferencesRequest
        {
            DeviceId = "native-device", ItemIds = new[] { item }, Enabled = false, Language = "de"
        };
        Check(controller.Save(request) is UnauthorizedResult, "Enrollment must require an authenticated Jellyfin user");
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString("N")) }));
        Check(controller.Save(request) is UnauthorizedResult, "An unverified user claim must not enroll playback preferences");
        controller.HttpContext.User = Identity(user.Id);
        Check(controller.Save(request) is ContentResult { ContentType: "application/json; charset=utf-8" } result
            && JsonDocument.Parse(result.Content!).RootElement.TryGetProperty("expiresAt", out _),
            "An authenticated owner may enroll its active device and receives a camelCase expiry");
        Check(store.TryGet(user.Id, "native-device", item, out _), "Authorized enrollment must install the queue lease");
        var library = DispatchProxy.Create<ILibraryManager, Proxy>();
        ((Proxy)(object)library).Call = (method, _) => method.Name == "GetItemById" ? new AccessibleVideo { Id = item } : null;
        var mediaSources = DispatchProxy.Create<IMediaSourceManager, Proxy>();
        ((Proxy)(object)mediaSources).Call = (method, _) => method.Name == "GetStaticMediaSources" ? PlaybackInfo().MediaSources.ToList() : null;
        var withSources = new FranchisePlaybackPreferencesController(store, users, sessions, library, mediaSources) { ControllerContext = controller.ControllerContext };
        user.SubtitleLanguagePreference = "deu";
        request.Enabled = true;
        request.Language = "";
        var inherited = (ContentResult)withSources.Save(request);
        using (var document = JsonDocument.Parse(inherited.Content!))
        {
            var json = document.RootElement;
            Check(json.GetProperty("enabled").GetBoolean() && json.GetProperty("language").GetString() == "deu"
                && json.GetProperty("subtitleStreamIndex").GetInt32() == 11 && json.GetProperty("mediaSourceId").GetString() == "source-a",
                "Enrollment should inherit the verified user's preferred language and return a concrete first-item native launch index/source");
        }
        request.Language = "fr";
        using (var document = JsonDocument.Parse(((ContentResult)withSources.Save(request)).Content!))
            Check(document.RootElement.GetProperty("subtitleStreamIndex").GetInt32() == 17 && user.SubtitleLanguagePreference == "deu",
                "An explicit franchise language should override the launch without changing the user's Jellyfin preference");
        request.MediaSourceId = "SOURCE-B";
        using (var document = JsonDocument.Parse(((ContentResult)withSources.Save(request)).Content!))
            Check(document.RootElement.GetProperty("subtitleStreamIndex").GetInt32() == 31
                && document.RootElement.GetProperty("mediaSourceId").GetString() == "source-b",
                "Changing preferences during playback must resolve the selected version's own subtitle indices");
        request.MediaSourceId = "unknown-source";
        using (var document = JsonDocument.Parse(((ContentResult)withSources.Save(request)).Content!))
            Check(document.RootElement.GetProperty("subtitleStreamIndex").ValueKind == JsonValueKind.Null
                && document.RootElement.GetProperty("mediaSourceId").ValueKind == JsonValueKind.Null,
                "An unknown requested version must not silently select another version");
        request.MediaSourceId = new string('a', 257);
        Check(IsBadRequest(withSources.Save(request)), "Enrollment must bound the selected media source ID");
        request.MediaSourceId = null;
        request.Enabled = false;
        request.Language = "de";
        request.ItemIds = Array.Empty<Guid>();
        Check(IsBadRequest(controller.Save(request)), "Enrollment requires an explicit nonempty item set");
        request.ItemIds = Enumerable.Range(0, 1001).Select(_ => Guid.NewGuid()).ToArray();
        Check(IsBadRequest(controller.Save(request)), "Enrollment must reject oversized queue policies");
        request.ItemIds = new[] { Guid.Empty };
        Check(IsBadRequest(controller.Save(request)), "An empty item ID is not an explicit playable item");
        request.ItemIds = new[] { item };
        request.Language = new string('a', 21);
        Check(IsBadRequest(controller.Save(request)), "Enrollment must bound language input");
        request.Language = "de";
        request.DeviceId = "someone-else";
        Check(controller.Save(request) is ForbidResult, "A current session owned by another user must be rejected");
        request.DeviceId = "not-connected";
        Check(controller.Save(request) is ForbidResult, "An unknown device must not be enrollable");
        request.DeviceId = "native-device";
        user.SetPermission(PermissionKind.EnableMediaPlayback, false);
        Check(controller.Save(request) is UnauthorizedResult or ForbidResult, "A user without playback permission must not enroll subtitle policies");
        user.SetPermission(PermissionKind.EnableMediaPlayback, true);
        controller.HttpContext.User = Identity(Guid.NewGuid());
        Check(controller.Save(request) is UnauthorizedResult or ForbidResult, "A stale or unknown Jellyfin user must be rejected");
    }

    private static bool IsBadRequest(IActionResult result) => result is BadRequestResult or BadRequestObjectResult;

    private static async Task TestFilter(Clock clock)
    {
        var user = new User("filter tester", "default", "default") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.EnableMediaPlayback, true);
        var users = DispatchProxy.Create<IUserManager, Proxy>();
        ((Proxy)(object)users).Call = (method, args) => method.Name == "GetUserById" && args?[0] is Guid id && id == user.Id ? user : null;
        var sessions = DispatchProxy.Create<ISessionManager, Proxy>();
        var active = new List<SessionInfo> { new(sessions, NullLogger.Instance) { Id = "native-session", DeviceId = "native-device", UserId = user.Id } };
        ((Proxy)(object)sessions).Call = (method, _) => method.Name == "get_Sessions" ? active : null;
        var item = Guid.NewGuid();
        var library = DispatchProxy.Create<ILibraryManager, Proxy>();
        ((Proxy)(object)library).Call = (method, _) => method.Name == "GetItemById" ? new AccessibleVideo { Id = item } : null;
        var mediaSources = DispatchProxy.Create<IMediaSourceManager, Proxy>();
        ((Proxy)(object)mediaSources).Call = (method, _) => method.Name == "GetStaticMediaSources" ? PlaybackInfo().MediaSources.ToList() : null;
        var store = new PlaybackSubtitlePolicyStore(clock);
        var filter = new PlaybackSubtitlePolicyFilter(store, users, sessions, library, mediaSources);
        var controller = new Jellyfin.Api.Controllers.MediaInfoController();
        var filters = new List<IFilterMetadata>();
        var original = PlaybackInfo();

        async Task RunFilter(string actionName, ClaimsPrincipal identity, Guid? targetUser, bool expectedOverride,
            bool enabled = false, bool actualController = true, string requestedSource = "source-a", string? bodySource = null,
            int expectedNegotiationIndex = 11, string expectedSource = "source-a", Guid? requestedItem = null,
            bool? queryIsPlayback = null, bool? bodyIsPlayback = null, bool? expectedLeaseRemaining = null)
        {
            store.Set(user.Id, "native-device", new[] { item }, enabled, "de");
            var body = new PlaybackBody { UserId = targetUser, SubtitleStreamIndex = 7, MediaSourceId = bodySource ?? requestedSource, IsPlayback = bodyIsPlayback };
            var descriptor = new ControllerActionDescriptor
            {
                ControllerTypeInfo = actualController ? controller.GetType().GetTypeInfo() : typeof(PlaybackSubtitleTests).GetTypeInfo(),
                MethodInfo = controller.GetType().GetMethod(actionName)!,
                ActionName = actionName
            };
            var http = new DefaultHttpContext { User = identity };
            http.Request.Method = actionName == "GetPostedPlaybackInfo" ? "POST" : "GET";
            if (queryIsPlayback.HasValue)
                http.Request.QueryString = QueryString.Create("IsPlayback", queryIsPlayback.Value ? "true" : "false");
            var actionContext = new ActionContext(http, new RouteData(), descriptor);
            var arguments = new Dictionary<string, object?>
            {
                ["itemId"] = requestedItem ?? item, ["userId"] = targetUser, ["subtitleStreamIndex"] = 7,
                ["mediaSourceId"] = requestedSource, ["playbackInfoDto"] = body
            };
            var executing = new ActionExecutingContext(actionContext, filters, arguments, controller);
            var result = new ObjectResult(original);
            await filter.OnActionExecutionAsync(executing, () =>
            {
                if (actionName == "GetPostedPlaybackInfo")
                {
                    var wanted = expectedOverride ? enabled ? expectedNegotiationIndex : -1 : 7;
                    Check(arguments["subtitleStreamIndex"] is int actual && actual == wanted && body.SubtitleStreamIndex == wanted,
                        "Only enrolled PlaybackInfo negotiation may change both the higher-precedence query index and body index");
                    if (expectedOverride)
                        Check(arguments["mediaSourceId"] as string == expectedSource && body.MediaSourceId == expectedSource,
                            "The subtitle selection must use the actual media source ID before Jellyfin's codec negotiation");
                }
                return Task.FromResult(new ActionExecutedContext(actionContext, filters, controller) { Result = result });
            });
            if (expectedOverride)
            {
                Check(result.Value is PlaybackInfoResponse applied && !ReferenceEquals(applied, original)
                    && applied.MediaSources[0].DefaultSubtitleStreamIndex == (enabled ? 11 : -1),
                    "The enrolled Jellyfin action must return a cloned response with the selected subtitle default");
            }
            else Check(ReferenceEquals(result.Value, original), "Unrelated actions, users and devices must retain the original response");
            if (expectedLeaseRemaining.HasValue)
                Check(store.TryGet(user.Id, "native-device", item, out _) == expectedLeaseRemaining.Value,
                    "All unlisted PlaybackInfo probes must preserve the explicit native queue lease without receiving its policy");
        }

        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, true, enabled: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, true, enabled: true, requestedSource: "SOURCE-A");
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, true, enabled: true,
            requestedSource: "", bodySource: "source-b", expectedNegotiationIndex: 31, expectedSource: "source-b");
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, true, enabled: true,
            requestedSource: "  ", bodySource: "source-b", expectedNegotiationIndex: 31, expectedSource: "source-b");
        await RunFilter("GetPlaybackInfo", Identity(user.Id), user.Id, true);
        await RunFilter("GetPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), queryIsPlayback: false, expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), bodyIsPlayback: false, expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), queryIsPlayback: true, expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false,
            requestedItem: Guid.NewGuid(), bodyIsPlayback: true, expectedLeaseRemaining: true);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), user.Id, false, actualController: false);
        await RunFilter("GetPostedPlaybackInfo", Identity(user.Id), Guid.NewGuid(), false);
        await RunFilter("GetPostedPlaybackInfo", Identity(Guid.NewGuid()), null, false);
        var otherDevice = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString("N")), new Claim("Jellyfin-DeviceId", "different-device") }, "fixture"));
        await RunFilter("GetPostedPlaybackInfo", otherDevice, null, false);
    }

    private sealed class PlaybackBody
    {
        public Guid? UserId { get; set; }
        public int? SubtitleStreamIndex { get; set; }
        public string? MediaSourceId { get; set; }
        public bool? IsPlayback { get; set; }
    }

    private sealed class AccessibleVideo : MediaBrowser.Controller.Entities.Video
    {
        public override bool IsVisible(User user, bool allowHidden = false) => true;
    }

    private static ClaimsPrincipal Identity(Guid user) => new(new ClaimsIdentity(new[]
    {
        new Claim("Jellyfin-UserId", user.ToString("N")), new Claim("Jellyfin-DeviceId", "native-device")
    }, "fixture"));

    private sealed class Clock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 5, 3, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan duration) => _now += duration;
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method is null) return null;
            var result = Call(method, args);
            return result ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
        }
    }
}
