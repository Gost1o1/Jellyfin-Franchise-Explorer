using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

internal static class TimelineQueueTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    public static async Task Run()
    {
        using var fixture = new Fixture();
        var state = fixture.State();
        await fixture.Write(state);
        // Native Web starts Y before the asynchronous server stop handler for X runs.
        await fixture.Record(fixture.Second, 270_000_000, completed: false, active: true);
        await fixture.Record(fixture.First, 600_000_000, completed: true, active: false);
        state = await fixture.Read();
        Check(state.Index == 1 && state.ItemId == fixture.Second.ToString("D") && state.PositionTicks == 270_000_000,
            "A late prior completion must preserve the native successor's real cursor, item and position");
        Check(state.CompletedKeys.SequenceEqual(new[] { fixture.Key(0) }) && state.PendingAutoAdvanceUtc is null,
            "A late natural completion must record only the actual prior reference without creating duplicate auto-next");
        await fixture.Record(fixture.First, 600_000_000, completed: true, active: false);
        Check((await fixture.Read()).CompletedKeys.Count == 1, "Duplicate stopped events must be idempotent");

        await fixture.Write(fixture.State());
        await fixture.Record(fixture.First, 600_000_000, completed: true, active: false);
        Check((await fixture.Read()).PendingAutoAdvanceUtc.HasValue, "A genuine completion must initially offer a fallback handoff");
        await fixture.Record(fixture.Second, 0, completed: false, active: true);
        state = await fixture.Read();
        Check(state.Index == 1 && state.PendingAutoAdvanceUtc is null && state.PendingAutoAdvanceFromKey.Length == 0,
            "Native successor PlaybackStart at zero must consume the pending handoff without waiting ten seconds");
        Check(await fixture.CompleteAgain() is ContentResult,
            "A browser completion retry for the already completed prior item must remain idempotent after native next playback clears the handoff marker");

        await fixture.Write(fixture.State());
        await fixture.Record(fixture.Second, 210_000_000, completed: false, active: true);
        await fixture.Record(fixture.First, 600_000_000, completed: false, active: false);
        Check((await fixture.Read()).CompletedKeys.Count == 0, "An ordinary stop must never mark a skipped episode completed");
        await fixture.Record(fixture.First, 600_000_000, completed: true, active: false, session: "another-session");
        await fixture.Record(Guid.NewGuid(), 600_000_000, completed: true, active: false);
        await fixture.Record(fixture.First, 600_000_000, completed: true, active: false, user: Guid.NewGuid());
        Check((await fixture.Read()).CompletedKeys.Count == 0, "Unrelated sessions, users and titles must not complete this timeline");
        Console.WriteLine("PASS native chronological queue lifecycle: reordered stop/start events, zero-position successor activation, idempotence and session isolation");
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "franchise-native-queue-" + Guid.NewGuid().ToString("N"));
        private readonly Plugin _plugin;
        private readonly Guid _row = Guid.NewGuid();
        private readonly Guid _user = Guid.NewGuid();
        public Guid First { get; } = Guid.NewGuid();
        public Guid Second { get; } = Guid.NewGuid();
        private string FilePath => Path.Combine(_plugin.DataFolderPath, "timeline-progress", _user.ToString("N"), _row.ToString("N") + ".json");

        public Fixture()
        {
            Directory.CreateDirectory(_root);
            var paths = DispatchProxy.Create<IApplicationPaths, RecoveryLibraryPickerTests.Proxy>();
            ((RecoveryLibraryPickerTests.Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? _root : null;
            var serializer = DispatchProxy.Create<IXmlSerializer, RecoveryLibraryPickerTests.Proxy>();
            ((RecoveryLibraryPickerTests.Proxy)(object)serializer).Call = (method, _) => method.ReturnType == typeof(object) ? new PluginConfiguration() : null;
            _plugin = new Plugin(paths, serializer);
            _plugin.Configuration.Rows.Add(new FranchiseRow { Id = _row.ToString("D"), RowType = "Timeline" });
        }
        public string Key(int index) => "reference-" + index + ":" + (index == 0 ? First : Second).ToString("D");
        public FranchiseTimelineController.TimelineProgress State() => new()
        {
            RowId = _row.ToString("D"), ItemId = First.ToString("D"), SessionId = "local-session", PlaybackMode = "playing",
            Index = 0, Total = 2, QueueKeys = [Key(0), Key(1)]
        };
        public async Task Write(FranchiseTimelineController.TimelineProgress state)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            await File.WriteAllTextAsync(FilePath, JsonSerializer.Serialize(state, Json));
        }
        public async Task<FranchiseTimelineController.TimelineProgress> Read() => JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(FilePath), Json)!;
        public async Task Record(Guid item, long position, bool completed, bool active, string session = "local-session", Guid? user = null)
        {
            var method = typeof(FranchiseTimelineController).GetMethod("RecordPlaybackAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
            await (Task)method.Invoke(null, [user ?? _user, session, item, position, completed, active, null, CancellationToken.None])!;
        }
        public Task<IActionResult> CompleteAgain()
        {
            var controller = new FranchiseTimelineController { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", _user.ToString("D"))], "fixture"));
            return controller.ConfirmLocalCompletion(_row, new() { SessionId = "local-session", ItemId = First.ToString("D") }, CancellationToken.None);
        }
        public void Dispose() => Directory.Delete(_root, true);
    }
}
