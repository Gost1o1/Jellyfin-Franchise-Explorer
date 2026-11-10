using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

public sealed record FranchiseLibrarySnapshot(IReadOnlyList<AutomationLibraryItem> Items, string Revision, bool Healthy, string Message)
{
    // A complete snapshot can recover removed IDs even when unrelated files are offline.
    public bool CanSearch { get; init; } = Healthy || Items.Any(i => i.IsAvailable);
}

/// <summary>One shared, event-invalidated metadata snapshot for automation and recovery.</summary>
public sealed class FranchiseLibrarySnapshotService(ILibraryManager library)
{
    private readonly object _sync = new();
    private FranchiseLibrarySnapshot? _snapshot;
    private long _generation;

    public void Invalidate() { lock (_sync) { _generation++; _snapshot = null; } }

    public FranchiseLibrarySnapshot Get(bool force = false)
    {
        lock (_sync)
        {
            if (library.IsScanRunning) return new([], "scanning:" + _generation, false, "Wait for the Jellyfin library scan to finish.") { CanSearch = false };
            if (!force && _snapshot is not null) return _snapshot;
            try
            {
                var items = AutoFranchiseService.ReadLibrary(library);
                if (library.IsScanRunning) return new([], "scanning:" + _generation, false, "The library changed during the check. Wait for the scan to finish.") { CanSearch = false };
                var data = JsonSerializer.Serialize(items.OrderBy(i => i.Id, StringComparer.Ordinal).ToArray());
                var revision = _generation + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data)));
                var healthy = items.Count > 0 && items.All(i => i.IsAvailable);
                var available = items.Count(i => i.IsAvailable);
                return _snapshot = new(items, revision, healthy, healthy ? "Library metadata is available."
                    : items.Count == 0 ? "No library media was returned. Complete a Jellyfin scan; saved references are retained."
                    : $"{items.Count - available} library items are unavailable. Removed IDs can reconnect to clear available matches; references to offline items are retained.") { CanSearch = available > 0 };
            }
            catch (InvalidOperationException ex) { return new([], "unavailable:" + _generation, false, ex.Message) { CanSearch = false }; }
        }
    }

    public bool IsCurrent(string revision)
    {
        lock (_sync) return !library.IsScanRunning && _snapshot?.Revision == revision;
    }
}
