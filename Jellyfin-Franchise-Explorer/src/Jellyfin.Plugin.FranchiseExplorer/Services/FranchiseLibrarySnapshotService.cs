using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

public sealed record FranchiseLibrarySnapshot(IReadOnlyList<AutomationLibraryItem> Items, string Revision, bool Healthy, string Message);

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
            if (library.IsScanRunning) return new([], "scanning:" + _generation, false, "Wait for the Jellyfin library scan to finish.");
            if (!force && _snapshot is not null) return _snapshot;
            try
            {
                var items = AutoFranchiseService.ReadLibrary(library);
                if (library.IsScanRunning) return new([], "scanning:" + _generation, false, "The library changed during the check. Wait for the scan to finish.");
                var data = JsonSerializer.Serialize(items.OrderBy(i => i.Id, StringComparer.Ordinal).ToArray());
                var revision = _generation + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data)));
                var healthy = items.Count > 0 && items.All(i => i.IsAvailable);
                return _snapshot = new(items, revision, healthy, healthy ? "Library metadata is available." : "Some library media is unavailable. Confirm all drives are online and complete a Jellyfin scan.");
            }
            catch (InvalidOperationException ex) { return new([], "unavailable:" + _generation, false, ex.Message); }
        }
    }

    public bool IsCurrent(string revision)
    {
        lock (_sync) return !library.IsScanRunning && _snapshot?.Revision == revision;
    }
}
