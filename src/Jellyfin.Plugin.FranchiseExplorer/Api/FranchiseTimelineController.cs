using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
        public int Index { get; set; }
        public int Total { get; set; }
        public long PositionTicks { get; set; }
        public List<string> CompletedKeys { get; set; } = new();
        public List<string> QueueKeys { get; set; } = new();
        public List<long> QueueLengths { get; set; } = new();
        public List<string> QueueSourceItemIds { get; set; } = new();
        public List<int> QueueSeasons { get; set; } = new();
        public List<int> QueueEpisodes { get; set; } = new();
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
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(rows.OrderByDescending(x => x.UpdatedUtc));
    }

    [HttpGet("{rowId:guid}")]
    public IActionResult Read(Guid rowId)
    {
        if (!TryIdentity(out var user)) return Unauthorized();
        if (!ValidRow(rowId)) return NotFound();
        var path = PathFor(user, rowId);
        if (path is null) return StatusCode(503);
        if (!System.IO.File.Exists(path)) return Ok(new TimelineProgress { RowId = rowId.ToString("D") });
        try
        {
            Response.Headers["Cache-Control"] = "no-store";
            return Ok(JsonSerializer.Deserialize<TimelineProgress>(System.IO.File.ReadAllText(path), JsonOptions));
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
            || record.PlaybackMode is not ("playing" or "paused" or "replay" or "complete"))
            return BadRequest("Invalid timeline progress payload.");
        var path = PathFor(user, rowId);
        if (path is null) return StatusCode(503);
        record.UpdatedUtc = DateTimeOffset.UtcNow;
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
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(record);
    }
    /// <summary>
    /// Called by the Jellyfin server playback listener. Track only a previously
    /// started, explicitly selected timeline and its exact session and item.
    /// Unrelated playback and independent replays must never change progress.
    /// </summary>
    internal static async Task RecordPlaybackAsync(
        Guid userId, string sessionId, Guid itemId, long? positionTicks,
        bool playedToCompletion, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty || itemId == Guid.Empty || string.IsNullOrEmpty(sessionId)) return;
        var root = Plugin.Instance?.DataFolderPath;
        if (string.IsNullOrWhiteSpace(root)) return;
        var folder = Path.Combine(root, "timeline-progress", userId.ToString("N"));
        if (!Directory.Exists(folder)) return;
        var suffix = ":" + itemId.ToString("D");
        var compactSuffix = ":" + itemId.ToString("N");
        await WriteLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var path in Directory.EnumerateFiles(folder, "*.json").Take(100))
            {
                if (!Guid.TryParse(Path.GetFileNameWithoutExtension(path), out var rowId) || !ValidRow(rowId)) continue;
                TimelineProgress? progress;
                try { progress = JsonSerializer.Deserialize<TimelineProgress>(await System.IO.File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false), JsonOptions); }
                catch (JsonException) { continue; }
                if (progress is null || progress.PlaybackMode != "playing" || progress.SessionId != sessionId
                    || progress.QueueKeys is null || progress.CompletedKeys is null || progress.Index >= progress.QueueKeys.Count) continue;

                bool Matches(string key) => key.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)
                    || key.EndsWith(compactSuffix, StringComparison.OrdinalIgnoreCase);
                var index = progress.Index;
                if (!Matches(progress.QueueKeys[index]))
                {
                    // A user may seek forward in the same Jellyfin queue. Do not
                    // falsely mark skipped episodes watched.
                    index = progress.QueueKeys.FindIndex(progress.Index + 1, key => Matches(key));
                    if (index < 0) continue;
                }
                var changed = false;
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
                    if (progress.Index >= progress.QueueKeys.Count) progress.PlaybackMode = "complete";
                    else
                    {
                        var next = progress.QueueKeys[progress.Index];
                        var separator = next.LastIndexOf(':');
                        progress.ItemId = separator >= 0 ? next[(separator + 1)..] : string.Empty;
                    }
                    changed = true;
                }
                else if (positionTicks is >= 0 && Math.Abs(positionTicks.Value - progress.PositionTicks) >= 100000000)
                {
                    // Ten-second persistence interval to avoid a disk write on
                    // every native playback-progress event.
                    progress.PositionTicks = positionTicks.Value;
                    progress.ItemId = itemId.ToString("D");
                    changed = true;
                }
                if (!changed) continue;
                progress.UpdatedUtc = DateTimeOffset.UtcNow;
                var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    await System.IO.File.WriteAllTextAsync(temp, JsonSerializer.Serialize(progress, JsonOptions), cancellationToken).ConfigureAwait(false);
                    System.IO.File.Move(temp, path, overwrite: true);
                }
                finally { if (System.IO.File.Exists(temp)) System.IO.File.Delete(temp); }
            }
        }
        finally { WriteLock.Release(); }
    }

}
