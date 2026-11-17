using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

public sealed record RecoveryFileLibrary(string Name, string ContentType);
public sealed record RecoveryFileItem(string ItemId, string Title, string ItemType, bool IsVirtual, bool Supported);

public sealed class RecoveryFileReport
{
    public string Path { get; set; } = "";
    public bool InLibrary { get; set; }
    public bool FileExists { get; set; }
    public bool Readable { get; set; }
    public string Attributes { get; set; } = "";
    public string Error { get; set; } = "";
    public List<RecoveryFileLibrary> Libraries { get; set; } = [];
    public List<RecoveryFileItem> Items { get; set; } = [];
    public List<RecoveryFileItem> ParentItems { get; set; } = [];
    public string ScanState { get; set; } = "None";
    public string Message { get; set; } = "";
}

/// <summary>Checks one administrator-supplied library path from the server process; never imports files or changes their attributes.</summary>
public sealed class RecoveryFileService(ILibraryManager library)
{
    private readonly SemaphoreSlim _scanGate = new(1, 1);
    private long _queuedUntilTicks;

    public async Task<RecoveryFileReport> CheckAsync(string path, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 4096 || !System.IO.Path.IsPathFullyQualified(path))
            throw new ArgumentException("Enter the full video file path on the Jellyfin server.");
        string canonical;
        try { canonical = System.IO.Path.GetFullPath(path); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        { throw new ArgumentException("The server file path is invalid."); }
        var report = new RecoveryFileReport { Path = canonical };
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        foreach (var folder in library.GetVirtualFolders())
        {
            if (!(folder.Locations ?? []).Any(root => Contains(root, canonical, comparison))) continue;
            report.Libraries.Add(new(folder.Name ?? "Library", folder.CollectionType?.ToString() ?? "Mixed content"));
        }
        report.InLibrary = report.Libraries.Count > 0;
        if (!report.InLibrary)
        {
            report.Message = "This path is outside Jellyfin's configured library folders. Add its parent folder in Dashboard → Libraries first.";
            return report;
        }
        cancellationToken.ThrowIfCancellationRequested();
        // No item-type, virtual-item, or presentation grouping filters: reveal misclassified and duplicate native records too.
        report.Items = Query(canonical);
        var parent = System.IO.Path.GetDirectoryName(canonical);
        if (parent is not null) report.ParentItems = Query(parent);
        try
        {
            var attributes = File.GetAttributes(canonical);
            report.Attributes = attributes.ToString();
            if (attributes.HasFlag(FileAttributes.Directory)) throw new ArgumentException("Enter the video file path, including its filename and extension.");
            report.FileExists = true;
            await using var stream = new FileStream(canonical, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var buffer = new byte[1];
            report.Readable = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false) > 0;
            if (!report.Readable) report.Error = "The file is empty.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            report.Error = ex.Message;
        }
        report.ScanState = ScanState();
        report.Message = !report.Readable
            ? "Jellyfin's server process could not read this video. Check the path and access for the account running Jellyfin."
            : report.Items.Count == 0
                ? "Jellyfin can read this file, but it has no indexed media record. Scan the Jellyfin libraries before automatic recovery can link it."
                : report.Items.Any(item => item.Supported)
                    ? "Jellyfin indexed this file. Automatic recovery can reconnect it when the saved identity, or exact title and media type, match."
                    : "Jellyfin indexed this path with an unsupported or virtual media type. Check the library content type and scan the Jellyfin libraries.";
        return report;
    }

    public async Task<RecoveryFileReport> ScanAsync(string path, CancellationToken cancellationToken = default)
    {
        await _scanGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var report = await CheckAsync(path, cancellationToken).ConfigureAwait(false);
            if (!report.InLibrary || !report.Readable) return report;
            report.ScanState = ScanState();
            if (report.ScanState == "None")
            {
                // Jellyfin queues a global task here; awaiting this call does not mean the scan has finished.
                // Never cancel/requeue an active scan, and debounce the interval before the queued task starts.
                await library.ValidateMediaLibrary(new Progress<double>(), cancellationToken).ConfigureAwait(false);
                Interlocked.Exchange(ref _queuedUntilTicks, DateTimeOffset.UtcNow.AddSeconds(30).UtcTicks);
                report.ScanState = "Queued";
            }
            report.Message = report.ScanState == "Running"
                ? "A Jellyfin library scan is already running. Automatic recovery will retry after it finishes."
                : "A Jellyfin library scan is queued. Automatic recovery will retry after it finishes; this file has not been imported or linked yet.";
            return report;
        }
        finally { _scanGate.Release(); }
    }

    private string ScanState() => library.IsScanRunning ? "Running" : DateTimeOffset.UtcNow.UtcTicks < Interlocked.Read(ref _queuedUntilTicks) ? "AlreadyQueued" : "None";

    private List<RecoveryFileItem> Query(string path) => library.GetItemList(new InternalItemsQuery
    {
        Path = path, EnableTotalRecordCount = false, GroupByPresentationUniqueKey = false
    }).Select(item => new RecoveryFileItem(item.Id.ToString("D"), item.Name ?? "", item.GetType().Name,
        item.IsVirtualItem, !item.IsVirtualItem && item is Movie or Series or Episode or BoxSet)).ToList();

    private static bool Contains(string root, string path, StringComparison comparison)
    {
        if (string.IsNullOrWhiteSpace(root) || !System.IO.Path.IsPathFullyQualified(root)) return false;
        try
        {
            root = System.IO.Path.GetFullPath(root);
            var prefix = System.IO.Path.EndsInDirectorySeparator(root) ? root : root + System.IO.Path.DirectorySeparatorChar;
            return path.StartsWith(prefix, comparison);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
    }
}
