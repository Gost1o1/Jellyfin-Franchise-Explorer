using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>
/// Authenticated, per-user timeline state. State is never stored in the shared
/// plugin configuration and never modifies native Jellyfin watched flags.
/// The user ID comes from Jellyfin's verified auth claim, not the request body.
/// </summary>
[ApiController]
[Authorize]
[Route("FranchiseExplorer/TimelineState")]
public sealed class FranchiseTimelineController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly SemaphoreSlim WriteLock = new(1, 1);

    public sealed class TimelineProgress
    {
        public string RowId { get; set; } = string.Empty;
        public string ParentNodeId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string ItemId { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public string PlaybackMode { get; set; } = "paused";
        // Explicit local Play intent, accepted only briefly and bound to the
        // actual Jellyfin session by the server's PlaybackStart/Progress event.
        public DateTimeOffset? ArmedUtc { get; set; }
        public int Index { get; set; }
        public int Total { get; set; }
        public long PositionTicks { get; set; }
        public List<string> CompletedKeys { get; set; } = new();
        public List<string> QueueKeys { get; set; } = new();
        public List<long> QueueLengths { get; set; } = new();
        public List<string> QueueSourceItemIds { get; set; } = new();
        public List<int> QueueSeasons { get; set; } = new();
        public List<int> QueueEpisodes { get; set; } = new();
        // Set only after the current item actually completes. The web bridge
        // uses this marker rather than relying on a now-cleared NowPlayingItem.
        public string PendingAutoAdvanceFromKey { get; set; } = string.Empty;
        public string PendingAutoAdvanceToKey { get; set; } = string.Empty;
        public DateTimeOffset? PendingAutoAdvanceUtc { get; set; }
        public DateTimeOffset UpdatedUtc { get; set; } = DateTimeOffset.UtcNow;
    }

    private bool TryIdentity(out Guid userId)
    {
        var claim = User.FindFirst("Jellyfin-UserId")?.Value;
        return Guid.TryParse(claim, out userId) && userId != Guid.Empty;
    }

    private static bool ValidRow(Guid row) => Plugin.Instance?.Configuration.Rows.Any(r => Guid.TryParse(r.Id, out var id) && id == row) == true;

    private static string? PathFor(Guid user, Guid row)
    {
        var root = Plugin.Instance?.DataFolderPath;
        if (string.IsNullOrWhiteSpace(root)) return null;
        return Path.Combine(root, "timeline-progress", user.ToString("N"), row.ToString("N") + ".json");
    }

    private static bool MatchesItem(string? key, Guid itemId)
    {
        var suffix = key?.LastIndexOf(':') ?? -1;
        return key is not null && suffix >= 0 && Guid.TryParse(key[(suffix + 1)..], out var parsed) && parsed == itemId;
    }

    private static bool CurrentItemMatches(TimelineProgress state, Guid itemId)
        => state.QueueKeys is not null && state.Index >= 0 && state.Index < state.QueueKeys.Count
            && MatchesItem(state.QueueKeys[state.Index], itemId);

    private static bool RecentlyArmed(TimelineProgress state)
        => state.ArmedUtc.HasValue && state.ArmedUtc.Value <= DateTimeOffset.UtcNow.AddSeconds(5)
            && state.ArmedUtc.Value >= DateTimeOffset.UtcNow.AddMinutes(-2);

    // Jellyfin 12.2 configures its MVC Ok(...) JSON serializer to emit
    // PascalCase properties, even though the on-disk serializer uses Web
    // camelCase. The browser expects rowId, completedKeys and the pending
    // handoff marker. Serialize all timeline responses explicitly so the
    // host's unrelated global MVC settings cannot silently break playback.
    private IActionResult TimelineJson<T>(T state)
    {
        Response.Headers["Cache-Control"] = "no-store";
        return Content(JsonSerializer.Serialize(state, JsonOptions), "application/json; charset=utf-8");
    }

    [HttpGet]
    public IActionResult List()
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        var root = Plugin.Instance?.DataFolderPath;
        if (string.IsNullOrWhiteSpace(root)) return StatusCode(503);
        var folder = Path.Combine(root, "timeline-progress", user.ToString("N"));
        var rows = new List<TimelineProgress>();
        if (Directory.Exists(folder))
        {
            foreach (var file in Directory.EnumerateFiles(folder, "*.json").Take(100))
            {
                try
                {
                    if (!Guid.TryParse(Path.GetFileNameWithoutExtension(file), out var rowId) || !ValidRow(rowId)) continue;
                    var record = JsonSerializer.Deserialize<TimelineProgress>(System.IO.File.ReadAllText(file), JsonOptions);
                    if (record is not null) rows.Add(record);
                }
                catch (JsonException) { /* Older or damaged progress is skipped. */ }
                catch (IOException) { /* A concurrent update may be underway. */ }
            }
        }
        return TimelineJson(rows.OrderByDescending(x => x.UpdatedUtc).ToArray());
    }

    [HttpGet("{rowId:guid}")]
    public IActionResult Read(Guid rowId)
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        if (!ValidRow(rowId)) return NotFound();
        var path = PathFor(user, rowId);
        if (path is null) return StatusCode(503);
        if (!System.IO.File.Exists(path)) return TimelineJson(new TimelineProgress { RowId = rowId.ToString("D") });
        try
        {
            return TimelineJson(JsonSerializer.Deserialize<TimelineProgress>(System.IO.File.ReadAllText(path), JsonOptions));
        }
        catch (IOException) { return StatusCode(503, "Timeline state temporarily unavailable."); }
        catch (JsonException) { return StatusCode(503, "Timeline state requires repair or backup restoration."); }
    }

    [HttpPut("{rowId:guid}")]
    [RequestSizeLimit(128 * 1024)]
    public async Task<IActionResult> Save(Guid rowId, [FromBody] TimelineProgress record, CancellationToken cancellationToken)
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        if (!ValidRow(rowId)) return NotFound();
        if (record is null || !Guid.TryParse(record.RowId, out var suppliedRow) || suppliedRow != rowId
            || record.Index < 0 || record.Total < 0 || record.Total > 25000 || record.Index > record.Total
            || record.PositionTicks < 0 || record.QueueKeys is null || record.QueueKeys.Count > 25000
            || record.CompletedKeys is null || record.CompletedKeys.Count > 25000
            || record.QueueKeys.Any(k => string.IsNullOrEmpty(k) || k.Length > 140)
            || record.CompletedKeys.Any(k => string.IsNullOrEmpty(k) || k.Length > 140)
            || record.QueueLengths is null || record.QueueLengths.Count > 25000
            || record.QueueLengths.Any(length => length < 0)
            || (record.QueueLengths.Count > 0 && record.QueueLengths.Count != record.QueueKeys.Count)
            || record.QueueSourceItemIds is null || record.QueueSourceItemIds.Count > 25000
            || record.QueueSeasons is null || record.QueueSeasons.Count > 25000
            || record.QueueEpisodes is null || record.QueueEpisodes.Count > 25000
            || (record.QueueSourceItemIds.Count > 0 && record.QueueSourceItemIds.Count != record.QueueKeys.Count)
            || (record.QueueSeasons.Count > 0 && record.QueueSeasons.Count != record.QueueKeys.Count)
            || (record.QueueEpisodes.Count > 0 && record.QueueEpisodes.Count != record.QueueKeys.Count)
            || string.IsNullOrEmpty(record.Name) || record.Name.Length > 200
            || record.PlaybackMode is not ("armed" or "playing" or "paused" or "replay" or "complete")
            || (record.PlaybackMode == "armed" && (!Guid.TryParse(record.ItemId, out var armedItem)
                || !CurrentItemMatches(record, armedItem))))
            return BadRequest("Invalid timeline progress payload.");
        var path = PathFor(user, rowId);
        if (path is null) return StatusCode(503);
        record.UpdatedUtc = DateTimeOffset.UtcNow;
        if (record.PlaybackMode == "armed")
        {
            // A client cannot self-certify its session or an arbitrary arm time.
            record.SessionId = string.Empty;
            record.ArmedUtc = record.UpdatedUtc;
            record.PendingAutoAdvanceUtc = null;
            record.PendingAutoAdvanceFromKey = string.Empty;
            record.PendingAutoAdvanceToKey = string.Empty;
        }
        else record.ArmedUtc = null;
        var json = JsonSerializer.Serialize(record, JsonOptions);
        if (json.Length > 120000) return BadRequest("Timeline state is too large.");
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await System.IO.File.WriteAllTextAsync(temporary, json, cancellationToken).ConfigureAwait(false);
                System.IO.File.Move(temporary, path, overwrite: true);
            }
            finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
        }
        finally { WriteLock.Release(); }
        return TimelineJson(record);
    }
    public sealed class TimelineCompletionRequest
    {
        public string SessionId { get; set; } = string.Empty;
        public string ItemId { get; set; } = string.Empty;
    }

    /// <summary>
    /// The web bridge may confirm the same observed local session, but it may
    /// never replace a row already advanced by Jellyfin's server events.
    /// </summary>
    [HttpPost("{rowId:guid}/Activate")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> ConfirmLocalActivation(Guid rowId, [FromBody] TimelineCompletionRequest request, CancellationToken cancellationToken)
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        if (!ValidRow(rowId)) return NotFound();
        if (request is null || !Guid.TryParse(request.ItemId, out var itemId)
            || string.IsNullOrWhiteSpace(request.SessionId) || request.SessionId.Length > 256) return BadRequest();
        var path = PathFor(user, rowId);
        if (path is null || !System.IO.File.Exists(path)) return NotFound();
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            TimelineProgress? state;
            try { state = JsonSerializer.Deserialize<TimelineProgress>(await System.IO.File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false), JsonOptions); }
            catch (IOException) { return StatusCode(503); }
            catch (JsonException) { return StatusCode(503); }
            if (state is null) return Conflict("Timeline state unavailable.");
            // A short movie can finish while the browser is still verifying
            // the local video. Return the already-persisted transition without
            // rolling it back to the browser's earlier intent snapshot.
            if (state.PlaybackMode == "playing" && state.SessionId == request.SessionId
                && state.PendingAutoAdvanceUtc.HasValue && MatchesItem(state.PendingAutoAdvanceFromKey, itemId))
                return TimelineJson(state);
            if (!CurrentItemMatches(state, itemId)) return Conflict("The timeline has moved to a different item.");
            if (state.PlaybackMode == "playing" && state.SessionId == request.SessionId) return TimelineJson(state);
            if (state.PlaybackMode != "armed" || !RecentlyArmed(state)) return Conflict("The timeline is not awaiting this playback.");
            state.PlaybackMode = "playing";
            state.SessionId = request.SessionId;
            state.ArmedUtc = null;
            state.UpdatedUtc = DateTimeOffset.UtcNow;
            await WriteProgressAsync(path, state, cancellationToken).ConfigureAwait(false);
            return TimelineJson(state);
        }
        finally { WriteLock.Release(); }
    }

    /// <summary>
    /// Confirm the HTML5 video 'ended' event from a verified local web player.
    /// This is idempotent with Jellyfin's own PlaybackStopped event and cannot
    /// advance another user's timeline or an unrelated playback session.
    /// </summary>
    [HttpPost("{rowId:guid}/Complete")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> ConfirmLocalCompletion(Guid rowId, [FromBody] TimelineCompletionRequest request, CancellationToken cancellationToken)
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        if (!ValidRow(rowId)) return NotFound();
        if (request is null || !Guid.TryParse(request.ItemId, out var itemId)
            || string.IsNullOrWhiteSpace(request.SessionId) || request.SessionId.Length > 256) return BadRequest();
        var path = PathFor(user, rowId);
        if (path is null || !System.IO.File.Exists(path)) return NotFound();
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            TimelineProgress? state;
            try { state = JsonSerializer.Deserialize<TimelineProgress>(await System.IO.File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false), JsonOptions); }
            catch (IOException) { return StatusCode(503); }
            catch (JsonException) { return StatusCode(503); }
            if (state is null || state.PlaybackMode != "playing" || state.SessionId != request.SessionId) return Conflict("Timeline session not active.");
            bool SameItem(string key) => MatchesItem(key, itemId);
            if (state.Index > 0 && state.QueueKeys.Count > state.Index - 1
                && SameItem(state.QueueKeys[state.Index - 1]) && state.PendingAutoAdvanceUtc.HasValue)
                return TimelineJson(state); // Server PlaybackStopped already advanced it.
            if (state.Index < 0 || state.Index >= state.QueueKeys.Count || !SameItem(state.QueueKeys[state.Index]))
                return Conflict("The ended video is not the current timeline item.");
            var from = state.QueueKeys[state.Index];
            if (!state.CompletedKeys.Contains(from)) state.CompletedKeys.Add(from);
            state.Index++;
            state.PositionTicks = 0;
            if (state.Index >= state.QueueKeys.Count)
            {
                state.PlaybackMode = "complete";
                state.PendingAutoAdvanceUtc = null;
                state.PendingAutoAdvanceFromKey = string.Empty;
                state.PendingAutoAdvanceToKey = string.Empty;
            }
            else
            {
                var next = state.QueueKeys[state.Index];
                var separator = next.LastIndexOf(':');
                state.ItemId = separator >= 0 ? next[(separator + 1)..] : string.Empty;
                state.PendingAutoAdvanceFromKey = from;
                state.PendingAutoAdvanceToKey = next;
                state.PendingAutoAdvanceUtc = DateTimeOffset.UtcNow;
            }
            state.UpdatedUtc = DateTimeOffset.UtcNow;
            await WriteProgressAsync(path, state, cancellationToken).ConfigureAwait(false);
            return TimelineJson(state);
        }
        finally { WriteLock.Release(); }
    }

    private static async Task WriteProgressAsync(string path, TimelineProgress state, CancellationToken cancellationToken)
    {
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await System.IO.File.WriteAllTextAsync(temp, JsonSerializer.Serialize(state, JsonOptions), cancellationToken).ConfigureAwait(false);
            System.IO.File.Move(temp, path, overwrite: true);
        }
        finally { if (System.IO.File.Exists(temp)) System.IO.File.Delete(temp); }
    }

    /// <summary>Holds the timeline write lock until the caller commits configuration or rolls the change back.</summary>
    public sealed class TimelineRemapTransaction : IAsyncDisposable
    {
        private readonly List<(string Path, byte[] Original)> _originals;
        private bool _committed;
        private bool _disposed;
        internal TimelineRemapTransaction(List<(string Path, byte[] Original)> originals) => _originals = originals;
        public int ChangedFiles => _originals.Count;
        public void Commit() => _committed = true;
        public async ValueTask DisposeAsync()
        {
            if (_disposed) return;
            _disposed = true;
            try
            {
                if (!_committed)
                    foreach (var (path, original) in _originals)
                    {
                        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                        try
                        {
                            await System.IO.File.WriteAllBytesAsync(temporary, original).ConfigureAwait(false);
                            System.IO.File.Move(temporary, path, true);
                        }
                        finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
                    }
            }
            finally { WriteLock.Release(); }
        }
    }

    /// <summary>Remap all users' progress without changing saved position, queue order or completed markers.</summary>
    public static Task<TimelineRemapTransaction> RemapItemIdsAsync(IReadOnlyDictionary<string, string> mapping, CancellationToken cancellationToken = default)
        => RemapItemIdsAsync(Plugin.Instance?.DataFolderPath ?? throw new InvalidOperationException("Plugin data folder unavailable."), mapping, cancellationToken);

    public static async Task<TimelineRemapTransaction> RemapItemIdsAsync(string dataRoot, IReadOnlyDictionary<string, string> mapping, CancellationToken cancellationToken = default)
    {
        static string Normalize(string id) => Guid.TryParse(id, out var value) ? value.ToString("N") : id;
        var normalized = mapping.ToDictionary(p => Normalize(p.Key), p => p.Value, StringComparer.OrdinalIgnoreCase);
        string Remap(string id) => normalized.GetValueOrDefault(Normalize(id), id);
        string Key(string key)
        {
            var colon = key.LastIndexOf(':');
            return colon >= 0 ? key[..(colon + 1)] + Remap(key[(colon + 1)..]) : Remap(key);
        }
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        var originals = new List<(string Path, byte[] Original)>();
        var transaction = new TimelineRemapTransaction(originals);
        try
        {
            var folder = Path.Combine(dataRoot, "timeline-progress");
            var staged = new List<(string Path, byte[] Original, TimelineProgress State)>();
            if (Directory.Exists(folder))
                foreach (var path in Directory.EnumerateFiles(folder, "*.json", SearchOption.AllDirectories))
                {
                    var original = await System.IO.File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
                    // A malformed record aborts the repair. Skipping it would leave part of a user's queue stale.
                    var state = JsonSerializer.Deserialize<TimelineProgress>(original, JsonOptions)
                        ?? throw new JsonException("Timeline state requires repair before media recovery.");
                    var before = JsonSerializer.Serialize(state, JsonOptions);
                    var currentKey = state.QueueKeys is not null && state.Index >= 0 && state.Index < state.QueueKeys.Count ? state.QueueKeys[state.Index] : string.Empty;
                    var currentSource = state.QueueSourceItemIds is not null && state.Index >= 0 && state.Index < state.QueueSourceItemIds.Count ? state.QueueSourceItemIds[state.Index] : string.Empty;
                    var staleIntent = Remap(state.ItemId) != state.ItemId || Key(currentKey) != currentKey || Remap(currentSource) != currentSource
                        || Key(state.PendingAutoAdvanceFromKey) != state.PendingAutoAdvanceFromKey || Key(state.PendingAutoAdvanceToKey) != state.PendingAutoAdvanceToKey;
                    state.ItemId = Remap(state.ItemId);
                    state.QueueKeys = (state.QueueKeys ?? []).Select(Key).ToList();
                    state.CompletedKeys = (state.CompletedKeys ?? []).Select(Key).ToList();
                    state.QueueSourceItemIds = (state.QueueSourceItemIds ?? []).Select(Remap).ToList();
                    var changed = before != JsonSerializer.Serialize(state, JsonOptions)
                        || Key(state.PendingAutoAdvanceFromKey) != state.PendingAutoAdvanceFromKey
                        || Key(state.PendingAutoAdvanceToKey) != state.PendingAutoAdvanceToKey;
                    if (!changed) continue;
                    if (staleIntent)
                    {
                        state.SessionId = string.Empty;
                        state.ArmedUtc = null;
                        state.PendingAutoAdvanceFromKey = string.Empty;
                        state.PendingAutoAdvanceToKey = string.Empty;
                        state.PendingAutoAdvanceUtc = null;
                        if (state.PlaybackMode is "playing" or "armed") state.PlaybackMode = "paused";
                    }
                    state.UpdatedUtc = DateTimeOffset.UtcNow;
                    staged.Add((path, original, state));
                }
            foreach (var (path, original, state) in staged)
            {
                originals.Add((path, original));
                await WriteProgressAsync(path, state, cancellationToken).ConfigureAwait(false);
            }
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    public static async Task<IReadOnlyList<string>> StoredItemIdsAsync(string dataRoot, CancellationToken cancellationToken = default)
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var root = Path.Combine(dataRoot, "timeline-progress");
            if (!Directory.Exists(root)) return [];
            foreach (var path in Directory.EnumerateFiles(root, "*.json", SearchOption.AllDirectories))
            {
                TimelineProgress? state;
                try { state = JsonSerializer.Deserialize<TimelineProgress>(await System.IO.File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false), JsonOptions); }
                catch (JsonException) { continue; }
                if (state is null) continue;
                void Add(string value) { if (Guid.TryParse(value, out var id)) ids.Add(id.ToString("D")); }
                Add(state.ItemId);
                foreach (var id in state.QueueSourceItemIds ?? []) Add(id);
                foreach (var key in (state.QueueKeys ?? []).Concat(state.CompletedKeys ?? [])) Add(key[(key.LastIndexOf(':') + 1)..]);
            }
            return ids.ToArray();
        }
        finally { WriteLock.Release(); }
    }

    /// <summary>
    /// Called by the Jellyfin server playback listener. Track only a previously
    /// started, explicitly selected timeline and its exact session and item.
    /// Unrelated playback and independent replays must never change progress.
    /// </summary>
    internal static async Task RecordPlaybackAsync(
        Guid userId, string sessionId, Guid itemId, long? positionTicks,
        bool playedToCompletion, bool activePlaybackEvent, ILogger? logger = null,
        CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty || itemId == Guid.Empty || string.IsNullOrEmpty(sessionId))
        {
            if (playedToCompletion) logger?.LogWarning("Franchise Explorer: completion ignored: event lacks user, session or item identity.");
            return;
        }
        var root = Plugin.Instance?.DataFolderPath;
        if (string.IsNullOrWhiteSpace(root))
        {
            if (playedToCompletion) logger?.LogWarning("Franchise Explorer: completion ignored: plugin data folder unavailable.");
            return;
        }
        var folder = Path.Combine(root, "timeline-progress", userId.ToString("N"));
        if (!Directory.Exists(folder))
        {
            if (playedToCompletion) logger?.LogWarning("Franchise Explorer: completion ignored: no timeline records for this user.");
            return;
        }
        var rows = 0;
        var activeRows = 0;
        var sessionMatches = 0;
        var itemMatches = 0;
        var savedCompletions = 0;
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var path in Directory.EnumerateFiles(folder, "*.json").Take(100))
            {
                if (!Guid.TryParse(Path.GetFileNameWithoutExtension(path), out var rowId) || !ValidRow(rowId)) continue;
                TimelineProgress? progress;
                try { progress = JsonSerializer.Deserialize<TimelineProgress>(await System.IO.File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false), JsonOptions); }
                catch (JsonException)
                {
                    if (playedToCompletion) logger?.LogWarning("Franchise Explorer: a timeline record could not be parsed; inspect backup before repair.");
                    continue;
                }
                rows++;
                if (progress is null || progress.QueueKeys is null || progress.CompletedKeys is null
                    || progress.Index < 0 || progress.Index >= progress.QueueKeys.Count) continue;

                var activated = false;
                if (progress.PlaybackMode == "armed" && activePlaybackEvent && RecentlyArmed(progress)
                    && CurrentItemMatches(progress, itemId))
                {
                    // The plugin observed actual playback on Jellyfin. No
                    // browser session guessing or remote 204 is involved.
                    progress.PlaybackMode = "playing";
                    progress.ArmedUtc = null;
                    progress.SessionId = sessionId;
                    progress.ItemId = itemId.ToString("D");
                    activated = true;
                    logger?.LogInformation("Franchise Explorer: armed timeline activated by server playback for row {RowId}.", rowId.ToString("N"));
                }
                if (progress.PlaybackMode != "playing") continue;
                activeRows++;
                if (progress.SessionId != sessionId) continue;
                sessionMatches++;

                var index = progress.Index;
                if (!MatchesItem(progress.QueueKeys[index], itemId))
                {
                    // A user may seek forward in the same Jellyfin queue. Do not
                    // falsely mark skipped episodes watched.
                    index = progress.QueueKeys.FindIndex(progress.Index + 1, key => MatchesItem(key, itemId));
                    if (index < 0) continue;
                }
                itemMatches++;
                var changed = activated;
                if (index != progress.Index)
                {
                    progress.Index = index;
                    progress.PositionTicks = 0;
                    changed = true;
                }
                if (playedToCompletion)
                {
                    var key = progress.QueueKeys[index];
                    if (!progress.CompletedKeys.Contains(key)) progress.CompletedKeys.Add(key);
                    progress.PositionTicks = 0;
                    progress.Index = index + 1;
                    if (progress.Index >= progress.QueueKeys.Count)
                    {
                        progress.PlaybackMode = "complete";
                        progress.PendingAutoAdvanceUtc = null;
                        progress.PendingAutoAdvanceFromKey = string.Empty;
                        progress.PendingAutoAdvanceToKey = string.Empty;
                    }
                    else
                    {
                        var next = progress.QueueKeys[progress.Index];
                        var separator = next.LastIndexOf(':');
                        progress.ItemId = separator >= 0 ? next[(separator + 1)..] : string.Empty;
                        progress.PendingAutoAdvanceFromKey = key;
                        progress.PendingAutoAdvanceToKey = next;
                        progress.PendingAutoAdvanceUtc = DateTimeOffset.UtcNow;
                    }
                    changed = true;
                    savedCompletions++;
                }
                else if (positionTicks is >= 0 && Math.Abs(positionTicks.Value - progress.PositionTicks) >= 100000000)
                {
                    // Ten-second persistence interval to avoid a disk write on
                    // every native playback-progress event.
                    progress.PositionTicks = positionTicks.Value;
                    progress.ItemId = itemId.ToString("D");
                    // Next playback has actually begun: consume the marker.
                    progress.PendingAutoAdvanceUtc = null;
                    progress.PendingAutoAdvanceFromKey = string.Empty;
                    progress.PendingAutoAdvanceToKey = string.Empty;
                    changed = true;
                }
                if (!changed) continue;
                progress.UpdatedUtc = DateTimeOffset.UtcNow;
                await WriteProgressAsync(path, progress, cancellationToken).ConfigureAwait(false);
            }
        }
        finally { WriteLock.Release(); }
        if (playedToCompletion)
        {
            if (savedCompletions > 0)
                logger?.LogInformation("Franchise Explorer: timeline completion saved, advancedRows={AdvancedRows}.", savedCompletions);
            else
                logger?.LogWarning("Franchise Explorer: completed playback did not advance a timeline. validRows={Rows}, playingRows={ActiveRows}, matchingSessions={Sessions}, matchingItems={Items}. Check activation/row state; no history was changed.",
                    rows, activeRows, sessionMatches, itemMatches);
        }
    }

}
