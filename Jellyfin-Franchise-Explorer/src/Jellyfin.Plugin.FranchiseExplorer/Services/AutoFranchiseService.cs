using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

/// <summary>Server-owned automation. Only complete, current plans can replace a configuration snapshot.</summary>
public sealed class AutoFranchiseService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(40) };
    private readonly Func<PluginConfiguration> _read;
    private readonly Action<PluginConfiguration> _write;
    private readonly Func<bool> _scanRunning;
    private readonly Func<IReadOnlyList<AutomationLibraryItem>> _library;
    private readonly Func<string, CancellationToken, Task<List<FranchiseAutoAddController.Entry>>> _source;
    private readonly Func<DateTimeOffset> _now;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly TimeZoneInfo _timeZone;
    private readonly SemaphoreSlim _operation = new(1, 1);
    private readonly AutoFranchisePlanner _planner = new();
    private AutoFranchiseRunStatus? _active;

    [ActivatorUtilitiesConstructor]
    public AutoFranchiseService(ILibraryManager library, FranchiseLibrarySnapshotService snapshots, ILogger<AutoFranchiseService> logger)
        : this(() => Plugin.Instance?.Configuration ?? throw new InvalidOperationException("Plugin configuration is unavailable."),
            config => (Plugin.Instance ?? throw new InvalidOperationException("Plugin is unavailable.")).CommitConfigurationUnderGate(config),
            () => library.IsScanRunning,
            () => { var snapshot = snapshots.Get(force: true); if (!snapshot.Healthy) throw new InvalidOperationException("The library snapshot is incomplete or a scan is active."); return snapshot.Items; },
            (id, token) => ImdbListClient.ReadAsync(Client, id, token))
    {
        _ = logger;
    }

    /// <summary>Dependency boundary used by deterministic tests; production always uses the IMDb adapter and server library.</summary>
    public AutoFranchiseService(Func<PluginConfiguration> readConfiguration, Action<PluginConfiguration> writeConfiguration,
        Func<bool> scanRunning, Func<IReadOnlyList<AutomationLibraryItem>> readLibrary,
        Func<string, CancellationToken, Task<List<FranchiseAutoAddController.Entry>>> readSource,
        Func<DateTimeOffset>? utcNow = null, TimeZoneInfo? timeZone = null,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _read = readConfiguration; _write = writeConfiguration; _scanRunning = scanRunning;
        _library = readLibrary; _source = readSource; _now = utcNow ?? (() => DateTimeOffset.UtcNow);
        _timeZone = timeZone ?? TimeZoneInfo.Local; _delay = delay ?? Task.Delay;
    }

    public sealed class StatusResponse
    {
        public AutoFranchiseSettings Settings { get; init; } = new();
        public string Fingerprint { get; init; } = string.Empty;
        public bool Running { get; init; }
        public string ServerTimeZone { get; init; } = string.Empty;
        public string Schedule { get; init; } = "Daily at 00:00 server local time";
    }

    public sealed class SettingsRequest
    {
        public string ExpectedFingerprint { get; set; } = string.Empty;
        public bool Enabled { get; set; }
        public List<RegistrationRequest> Registry { get; set; } = new();
    }

    public sealed class RegistrationRequest
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Url { get; set; } = string.Empty;
        public bool Enabled { get; set; }
        public string EpisodeFormat { get; set; } = "Bundles";
        public string FranchiseNodeId { get; set; } = string.Empty;
    }

    public sealed class PreviewRequest { public List<string> RegistrationIds { get; set; } = new(); }
    public sealed class PreviewResponse
    {
        public string Fingerprint { get; init; } = string.Empty;
        public List<RegistrationPlan> Plans { get; init; } = new();
        public string Message { get; init; } = "Preview only. No configuration changes were applied.";
    }
    public sealed class RegistrationPlan
    {
        public string RegistrationId { get; init; } = string.Empty;
        public string FranchiseName { get; init; } = string.Empty;
        public IReadOnlyList<AutoFranchiseChange> SafeAdditions { get; init; } = Array.Empty<AutoFranchiseChange>();
        public IReadOnlyList<AutoFranchiseChange> Pending { get; init; } = Array.Empty<AutoFranchiseChange>();
        public IReadOnlyList<AutoFranchiseChange> Missing { get; init; } = Array.Empty<AutoFranchiseChange>();
        public bool SourceFailed { get; init; }
    }
    public sealed class DecisionRequest
    {
        public string ExpectedFingerprint { get; set; } = string.Empty;
        public string Decision { get; set; } = string.Empty;
        public List<string> ChangeIds { get; set; } = new();
        public List<string> ExclusionIds { get; set; } = new();
        public List<string> RegistrationIds { get; set; } = new();
    }
    public sealed class ExclusionRequest
    {
        public string ExpectedFingerprint { get; set; } = string.Empty;
        public AutoFranchiseExclusion Exclusion { get; set; } = new();
    }

    public async Task<StatusResponse> StatusAsync(CancellationToken token)
    {
        await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
        try { return Status(Clone(_read())); }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private StatusResponse Status(PluginConfiguration config)
    {
        if (_active is not null) config.AutoFranchises.LastRun = Clone(_active);
        return new() { Settings = config.AutoFranchises, Fingerprint = Fingerprint(config), Running = _operation.CurrentCount == 0,
            ServerTimeZone = _timeZone.Id };
    }

    public async Task<StatusResponse> SaveSettingsAsync(SettingsRequest request, CancellationToken token)
    {
        if (request.Registry is null || request.Registry.Count > 100) throw new ArgumentException("At most 100 registry entries are allowed.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var registration in request.Registry)
        {
            if (registration is null || registration.Name is null || registration.Name.Trim().Length is < 1 or > 200
                || registration.EpisodeFormat is not ("Bundles" or "Individual")
                || !TryCanonicalListUrl(registration.Url, out _, out _)
                || (!string.IsNullOrEmpty(registration.Id) && !Guid.TryParse(registration.Id, out _))
                || (!string.IsNullOrEmpty(registration.FranchiseNodeId) && !Guid.TryParse(registration.FranchiseNodeId, out _)))
                throw new ArgumentException("Registry entries need a name, a canonical HTTPS IMDb list URL, valid IDs and an episode format.");
            if (!string.IsNullOrEmpty(registration.Id) && !ids.Add(registration.Id)) throw new ArgumentException("Registry IDs must be unique.");
        }
        await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
        try
        {
            var config = Clone(_read()); RequireFingerprint(config, request.ExpectedFingerprint);
            var existing = config.AutoFranchises.Registry;
            var updated = new List<AutoFranchiseRegistration>();
            foreach (var incoming in request.Registry)
            {
                var item = existing.SingleOrDefault(x => x.Id == incoming.Id) ?? new AutoFranchiseRegistration { Id = string.IsNullOrEmpty(incoming.Id) ? Guid.NewGuid().ToString("D") : incoming.Id };
                if (!string.IsNullOrEmpty(incoming.FranchiseNodeId) && incoming.FranchiseNodeId != item.FranchiseNodeId
                    && !config.Nodes.Any(n => n.Id == incoming.FranchiseNodeId && n.NodeType == "Franchise"))
                    throw new ArgumentException("The target franchise no longer exists.");
                if (item.FranchiseNodeId != incoming.FranchiseNodeId && config.AutoFranchises.Ownership.Any(o => o.RegistrationId == item.Id))
                    throw new AutomationConflictException("An established registry mapping cannot be replaced. Add a separate registry entry for the new target.");
                TryCanonicalListUrl(incoming.Url, out var canonical, out _);
                item.Name = incoming.Name.Trim(); item.Url = canonical; item.Enabled = incoming.Enabled;
                item.EpisodeFormat = incoming.EpisodeFormat; item.FranchiseNodeId = incoming.FranchiseNodeId;
                updated.Add(item);
            }
            // Retain mappings and deletion history when a registry entry is removed from the editor.
            foreach (var removed in existing.Where(old => !updated.Any(next => next.Id == old.Id))) { removed.Enabled = false; updated.Add(removed); }
            if (updated.Where(x => x.Enabled && !x.Deleted).GroupBy(x => x.Url, StringComparer.Ordinal).Any(g => g.Count() > 1))
                throw new ArgumentException("An enabled IMDb source can appear only once in the automation registry.");
            config.AutoFranchises.Registry = updated; config.AutoFranchises.Enabled = request.Enabled;
            _write(config); return Status(Clone(config));
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    public async Task<PreviewResponse> PreviewAsync(PreviewRequest request, CancellationToken token)
    {
        ValidateIds(request.RegistrationIds, 100);
        if (!await _operation.WaitAsync(0, token).ConfigureAwait(false)) throw new AutomationConflictException("An automation operation is already running.");
        try
        {
            var config = await SnapshotAsync(token).ConfigureAwait(false);
            var fingerprint = Fingerprint(config);
            var library = HealthyLibrary();
            var registrations = SelectRegistrations(config, request.RegistrationIds);
            // An explicit preview can be inspected before opting in to automatic execution.
            config.AutoFranchises.Enabled = true;
            var plans = await BuildPlansAsync(config, registrations, library, token).ConfigureAwait(false);
            return new() { Fingerprint = fingerprint, Plans = plans.Select(p => View(p.Registration, p.Plan)).ToList() };
        }
        finally { _operation.Release(); }
    }

    public async Task<AutoFranchiseRunStatus> RunAsync(bool scheduled, CancellationToken token, IProgress<double>? progress = null)
    {
        if (!await _operation.WaitAsync(0, token).ConfigureAwait(false))
            return new() { StartedUtc = _now(), CompletedUtc = _now(), Status = "Busy", Message = "An automation operation is already running." };
        var status = new AutoFranchiseRunStatus { StartedUtc = _now(), Status = "Running", Message = "Preparing library and source snapshots." };
        _active = status;
        try
        {
            var config = await SnapshotAsync(token).ConfigureAwait(false);
            if (!config.AutoFranchises.Enabled) return await CompleteAndSaveAsync(status, "Disabled", "Enable Auto Franchises to opt in.", token).ConfigureAwait(false);
            var localDay = LocalDay(_now(), _timeZone);
            if (scheduled && !IsScheduledDayDue(config.AutoFranchises.LastCompletedLocalDay, localDay))
                return Complete(status, "AlreadyCompleted", "This server-local scheduled day has already completed.");
            while (_scanRunning())
            {
                status.Status = "WaitingForLibraryScan"; status.Message = "Waiting for the active Jellyfin library scan to finish.";
                await SaveRunStatusAsync(status, token).ConfigureAwait(false);
                await _delay(TimeSpan.FromSeconds(5), token).ConfigureAwait(false);
            }
            // Settings and manual choices may change while a scan is running.
            config = await SnapshotAsync(token).ConfigureAwait(false);
            if (!config.AutoFranchises.Enabled) return await CompleteAndSaveAsync(status, "Disabled", "Auto Franchises was disabled while waiting.", token).ConfigureAwait(false);
            localDay = LocalDay(_now(), _timeZone);
            if (scheduled && !IsScheduledDayDue(config.AutoFranchises.LastCompletedLocalDay, localDay))
                return Complete(status, "AlreadyCompleted", "This server-local scheduled day has already completed.");
            var fingerprint = Fingerprint(config);
            var library = HealthyLibrary(); var libraryFingerprint = LibraryFingerprint(library);
            status.Status = "Running"; status.Message = "Reading the enabled automation registry.";
            var registrations = SelectRegistrations(config, Array.Empty<string>());
            status.RegistrationIds = registrations.Select(r => r.Id).ToList();
            await SaveRunStatusAsync(status, token).ConfigureAwait(false);
            var plans = await BuildPlansAsync(config, registrations, library, token).ConfigureAwait(false);
            foreach (var pair in plans)
            {
                if (pair.Plan.SourceFailed)
                {
                    status.Errors++;
                    foreach (var error in pair.Plan.Pending)
                        if (!config.AutoFranchises.PendingChanges.Any(old => old.Id == error.Id)) config.AutoFranchises.PendingChanges.Add(error);
                }
                else { status.Added += _planner.Apply(config, config.AutoFranchises, pair.Registration, pair.Plan); status.Held += pair.Plan.Pending.Count + pair.Plan.Missing.Count; }
                progress?.Report(plans.Count == 0 ? 100 : 100d * (plans.IndexOf(pair) + 1) / plans.Count);
            }
            var currentLibraryFingerprint = LibraryFingerprint(HealthyLibrary());
            if (currentLibraryFingerprint != libraryFingerprint) throw new AutomationConflictException("The library changed during automation. No planned changes were saved; run again after the scan finishes.");
            await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
            try
            {
                var current = _read(); RequireFingerprint(current, fingerprint);
                if (_scanRunning()) throw new AutomationConflictException("A library scan started during automation. No planned changes were saved.");
                Complete(status, status.Errors == 0 ? "Completed" : "CompletedWithErrors", status.Errors == 0 ? "Safe additions applied; protected changes remain in the review inbox." : "Some IMDb sources failed. Their existing franchises were preserved.");
                config.AutoFranchises.LastRun = Clone(status);
                if (scheduled) config.AutoFranchises.LastCompletedLocalDay = localDay;
                config.ConfigurationRevision = current.ConfigurationRevision;
                _write(config);
            }
            finally { FranchiseConfigurationGate.Gate.Release(); }
            return Clone(status);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            status.Added = 0; Complete(status, "Cancelled", "Automation was cancelled. No uncommitted plan was saved.");
            await SaveRunStatusAsync(status, CancellationToken.None).ConfigureAwait(false); throw;
        }
        catch (Exception ex) when (ex is AutomationConflictException or InvalidOperationException or IOException or HttpRequestException or JsonException)
        {
            status.Added = 0; status.Errors++; Complete(status, ex is AutomationConflictException ? "Deferred" : "Failed", ex.Message);
            await SaveRunStatusAsync(status, CancellationToken.None).ConfigureAwait(false); return Clone(status);
        }
        finally { _active = null; _operation.Release(); }
    }

    public async Task<StatusResponse> DecideAsync(DecisionRequest request, CancellationToken token)
    {
        ValidateIds(request.ChangeIds, 500); ValidateIds(request.ExclusionIds, 500); ValidateIds(request.RegistrationIds, 100);
        if (request.Decision is not ("Keep" or "Apply" or "Restore") || request.ChangeIds.Count + request.ExclusionIds.Count == 0
            || (request.ExclusionIds.Count > 0 && (request.Decision != "Restore" || request.ChangeIds.Count > 0)))
            throw new ArgumentException("Choose known review changes, or choose exclusions to restore.");
        if (!await _operation.WaitAsync(0, token).ConfigureAwait(false)) throw new AutomationConflictException("An automation operation is already running.");
        try
        {
            var config = await SnapshotAsync(token).ConfigureAwait(false); RequireFingerprint(config, request.ExpectedFingerprint);
            var fingerprint = Fingerprint(config);
            var settings = config.AutoFranchises;
            var changes = settings.PendingChanges.Where(x => request.ChangeIds.Contains(x.Id, StringComparer.Ordinal) && x.Status is "Pending" or "Kept").ToList();
            if (changes.Count != request.ChangeIds.Count && (request.Decision == "Keep" || request.RegistrationIds.Count == 0))
                throw new AutomationConflictException("A selected review change is unknown or has already been applied. Preview current changes before applying a new selection.");
            if (request.Decision != "Keep" && changes.Any(c => c.Kind is not ("Remove" or "RangeReplacement") && (c.ItemId.Length == 0 || c.ReferenceId.Length == 0)))
                throw new ArgumentException("This notification requires a manual edit or source repair. Keep it to acknowledge the message.");
            if (request.Decision != "Keep" && changes.Any(c => c.ExclusionIds.Any(id => settings.Exclusions.Any(e => e.Id == id && e.Enabled))))
                throw new ArgumentException("Restore the exact restrictions in Saved choices first, then preview current additions. Applying one episode cannot clear a whole-show, season or other saved restriction.");
            string? libraryFingerprint = null;
            if (request.Decision == "Keep")
            {
                foreach (var change in changes) { change.Status = "Kept"; change.UpdatedUtc = _now(); }
            }
            else
            {
                var storedEnabled = settings.Enabled;
                // An explicit administrator decision can be reviewed while the daily schedule remains off.
                settings.Enabled = true;
                var selectedExclusions = settings.Exclusions.Where(e => e.Enabled && request.ExclusionIds.Contains(e.Id, StringComparer.Ordinal)).ToList();
                if (selectedExclusions.Count != request.ExclusionIds.Count) throw new AutomationConflictException("A selected saved choice no longer exists.");
                var registrationIds = changes.Select(c => c.RegistrationId).Concat(selectedExclusions.Select(e => e.RegistrationId))
                    .Concat(request.RegistrationIds).Distinct(StringComparer.Ordinal).ToList();
                var registrations = SelectRegistrations(config, registrationIds);
                var library = HealthyLibrary(); libraryFingerprint = LibraryFingerprint(library);
                var plans = await BuildPlansAsync(config, registrations, library, token).ConfigureAwait(false);
                if (plans.Any(p => p.Plan.SourceFailed)) throw new AutomationConflictException("A selected source could not be retrieved completely. No saved choices were changed.");
                var candidates = plans.SelectMany(p => p.Plan.Pending.Concat(p.Plan.SafeAdditions)).ToList();
                if (request.ExclusionIds.Count > 0)
                {
                    if (request.ExclusionIds.Any(id => !candidates.Any(c => c.ExclusionIds.Contains(id, StringComparer.Ordinal))))
                        throw new AutomationConflictException("A selected restriction has no current available source candidate. Preview again after its source and library are available.");
                    foreach (var exclusion in selectedExclusions) exclusion.Enabled = false;
                }
                else
                {
                    var selectedCandidates = candidates.Where(c => request.ChangeIds.Contains(c.Id, StringComparer.Ordinal)).ToList();
                    if (request.ChangeIds.Any(id => !selectedCandidates.Any(c => c.Id == id))
                        || changes.Any(old => !selectedCandidates.Any(c => c.Id == old.Id && c.ItemId == old.ItemId && c.RowId == old.RowId)))
                        throw new AutomationConflictException("The selected proposal changed or no longer matches the current library. Preview again.");
                    if (selectedCandidates.Any(c => c.Kind is not ("Remove" or "RangeReplacement") && (c.ItemId.Length == 0 || c.ReferenceId.Length == 0)))
                        throw new ArgumentException("This notification requires a manual edit or source repair. Keep it to acknowledge the message.");
                    if (selectedCandidates.Any(c => c.ExclusionIds.Any(id => settings.Exclusions.Any(e => e.Id == id && e.Enabled))))
                        throw new ArgumentException("Restore the exact restrictions in Saved choices first, then preview current additions. Applying one episode cannot clear a whole-show, season or other saved restriction.");
                    foreach (var pair in plans) _planner.Apply(config, settings, pair.Registration, pair.Plan, request.ChangeIds);
                }
                settings.Enabled = storedEnabled;
            }
            if (libraryFingerprint is not null && LibraryFingerprint(HealthyLibrary()) != libraryFingerprint)
                throw new AutomationConflictException("The library changed while reviewing. No choices were saved.");
            await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
            try
            {
                var current = _read(); RequireFingerprint(current, fingerprint);
                if (libraryFingerprint is not null && _scanRunning()) throw new AutomationConflictException("A library scan started. Review again after it finishes.");
                config.ConfigurationRevision = current.ConfigurationRevision;
                _write(config); return Status(Clone(config));
            }
            finally { FranchiseConfigurationGate.Gate.Release(); }
        }
        finally { _operation.Release(); }
    }

    public async Task<StatusResponse> SaveExclusionAsync(ExclusionRequest request, CancellationToken token)
    {
        var rule = request.Exclusion ?? throw new ArgumentException("A saved choice is required.");
        if (rule.Scope is not ("Movie" or "Show" or "WholeShow" or "Series" or "Season" or "Episode" or "Range" or "RestrictedRange" or "AllowedRange")
            || rule.ProviderName != "Imdb" || !Regex.IsMatch(rule.ProviderId ?? "", "^tt[0-9]{1,15}$", RegexOptions.CultureInvariant)
            || !Guid.TryParse(rule.RegistrationId, out _) || (!string.IsNullOrEmpty(rule.Id) && !Guid.TryParse(rule.Id, out _))
            || (!string.IsNullOrEmpty(rule.RowId) && !Guid.TryParse(rule.RowId, out _))
            || (!string.IsNullOrEmpty(rule.JellyfinItemId) && !Guid.TryParse(rule.JellyfinItemId, out _))
            || new[] { rule.StartSeason, rule.EndSeason, rule.StartEpisode, rule.EndEpisode }.Any(n => n is < 0 or > 100000)
            || (rule.EndSeason > 0 && rule.EndSeason < rule.StartSeason) || (rule.EndEpisode > 0 && rule.EndEpisode < rule.StartEpisode))
            throw new ArgumentException("Use a supported scope, stable IMDb identity and valid season/episode bounds.");
        await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
        try
        {
            var config = Clone(_read()); RequireFingerprint(config, request.ExpectedFingerprint);
            var registration = config.AutoFranchises.Registry.SingleOrDefault(r => r.Id == rule.RegistrationId)
                ?? throw new ArgumentException("The automation registration does not exist.");
            if (!string.IsNullOrEmpty(rule.RowId) && !config.Rows.Any(r => r.Id == rule.RowId && r.ParentNodeId == registration.FranchiseNodeId))
                throw new ArgumentException("The row does not belong to this franchise.");
            if (config.AutoFranchises.Exclusions.Count >= 25000) throw new ArgumentException("The saved-choice limit has been reached.");
            // This endpoint can add protection. Restore requires the verified decision workflow above.
            rule = Clone(rule); rule.Id = string.IsNullOrEmpty(rule.Id) ? Guid.NewGuid().ToString("D") : rule.Id;
            if (rule.Scope is "Range" or "RestrictedRange") rule.Scope = "AllowedRange";
            rule.Enabled = true; rule.CreatedUtc = _now(); rule.Reason = "Excluded by you";
            if (config.AutoFranchises.Exclusions.Any(e => e.Id == rule.Id)) throw new ArgumentException("An existing saved choice cannot be replaced. Restore it explicitly first.");
            config.AutoFranchises.Exclusions.Add(rule); _write(config); return Status(Clone(config));
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private async Task<List<(AutoFranchiseRegistration Registration, AutoFranchisePlan Plan)>> BuildPlansAsync(PluginConfiguration config,
        IReadOnlyList<AutoFranchiseRegistration> registrations, IReadOnlyList<AutomationLibraryItem> library, CancellationToken token)
    {
        var result = new List<(AutoFranchiseRegistration, AutoFranchisePlan)>();
        foreach (var registration in registrations)
        {
            token.ThrowIfCancellationRequested();
            List<FranchiseAutoAddController.Entry> entries = new(); string? error = null;
            if (!TryCanonicalListUrl(registration.Url, out _, out var listId)) error = "The source URL is not an allowed HTTPS IMDb list URL.";
            else
            {
                try
                {
                    entries = await _source(listId, token).ConfigureAwait(false);
                    if (entries.Count == 0) throw new InvalidOperationException("The IMDb list was empty. Existing content was preserved; verify the source before removing anything.");
                    if (entries.Count > 3000 || entries.Any(e => e.Position is null or < 1 || !Regex.IsMatch(e.ImdbId, "^tt[0-9]+$"))
                        || entries.Select(e => e.Position).Distinct().Count() != entries.Count)
                        throw new InvalidOperationException("IMDb did not return a complete, explicitly ordered list.");
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
                catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or InvalidOperationException or JsonException or FormatException or KeyNotFoundException or RegexMatchTimeoutException)
                { error = ex.Message; }
            }
            result.Add((registration, _planner.Plan(config, config.AutoFranchises, registration, library, entries, error is null, error)));
        }
        return result;
    }

    private static RegistrationPlan View(AutoFranchiseRegistration registration, AutoFranchisePlan plan) => new()
    {
        RegistrationId = registration.Id, FranchiseName = registration.Name, SafeAdditions = plan.SafeAdditions,
        Pending = plan.Pending, Missing = plan.Missing, SourceFailed = plan.SourceFailed
    };

    private static List<AutoFranchiseRegistration> SelectRegistrations(PluginConfiguration config, IReadOnlyCollection<string> ids)
    {
        var registrations = config.AutoFranchises.Registry.Where(r => r.Enabled && (ids.Count == 0 || ids.Contains(r.Id, StringComparer.Ordinal))).ToList();
        if (ids.Count > 0 && registrations.Count != ids.Count) throw new ArgumentException("Select existing, enabled automation registrations.");
        return registrations;
    }

    private async Task<PluginConfiguration> SnapshotAsync(CancellationToken token)
    {
        await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
        try { return Clone(_read()); }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private async Task SaveRunStatusAsync(AutoFranchiseRunStatus status, CancellationToken token)
    {
        await FranchiseConfigurationGate.Gate.WaitAsync(token).ConfigureAwait(false);
        try { var current = Clone(_read()); current.AutoFranchises.LastRun = Clone(status); _write(current); }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private IReadOnlyList<AutomationLibraryItem> HealthyLibrary()
    {
        if (_scanRunning()) throw new AutomationConflictException("A Jellyfin library scan is active. Retry after it finishes.");
        IReadOnlyList<AutomationLibraryItem> result;
        try { result = _library(); }
        catch (InvalidOperationException ex) { throw new AutomationConflictException(ex.Message); }
        if (_scanRunning() || result.Any(i => !i.IsAvailable))
            throw new AutomationConflictException("The library is scanning or contains unavailable media. Existing franchises were preserved; retry when the library is fully available.");
        return result;
    }

    private AutoFranchiseRunStatus Complete(AutoFranchiseRunStatus status, string outcome, string message)
    { status.Status = outcome; status.Message = message; status.CompletedUtc = _now(); return Clone(status); }

    private async Task<AutoFranchiseRunStatus> CompleteAndSaveAsync(AutoFranchiseRunStatus status, string outcome, string message, CancellationToken token)
    {
        Complete(status, outcome, message);
        await SaveRunStatusAsync(status, token).ConfigureAwait(false);
        return Clone(status);
    }

    private static void ValidateIds(List<string>? ids, int limit)
    {
        if (ids is null || ids.Count > limit || ids.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 200)
            || ids.Distinct(StringComparer.Ordinal).Count() != ids.Count) throw new ArgumentException("Invalid or duplicate selection IDs.");
    }

    public static bool TryCanonicalListUrl(string? url, out string canonical, out string listId)
    {
        canonical = string.Empty; listId = string.Empty;
        if (url is null || url.Length > 200 || url != url.Trim() || url.Contains('%') || url.Contains('\\')
            || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || !string.Equals(uri.Host, "www.imdb.com", StringComparison.OrdinalIgnoreCase)
            || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0
            || !Regex.IsMatch(uri.AbsolutePath, "^/list/ls[0-9]{1,18}/?$", RegexOptions.CultureInvariant)) return false;
        listId = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)[1];
        canonical = "https://www.imdb.com/list/" + listId + "/"; return true;
    }

    public static string LocalDay(DateTimeOffset utc, TimeZoneInfo timeZone)
        => TimeZoneInfo.ConvertTime(utc, timeZone).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static bool IsScheduledDayDue(string? lastCompletedLocalDay, string localDay)
        => string.IsNullOrEmpty(lastCompletedLocalDay) || string.CompareOrdinal(lastCompletedLocalDay, localDay) < 0;

    public static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Json), Json)!;

    public static string Fingerprint(PluginConfiguration config)
    {
        var snapshot = Clone(config); snapshot.AutoFranchises.LastRun = null; snapshot.ConfigurationRevision = 0;
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot, Json))));
    }

    private static string LibraryFingerprint(IReadOnlyList<AutomationLibraryItem> library)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(library.OrderBy(i => i.Id, StringComparer.Ordinal), Json))));

    private static void RequireFingerprint(PluginConfiguration config, string expected)
    {
        if (expected is null || expected.Length != 64 || !string.Equals(Fingerprint(config), expected, StringComparison.Ordinal))
            throw new AutomationConflictException("The franchise configuration changed. Reload current settings and review the proposal again.");
    }

    /// <summary>Capture actual server metadata, including unavailability; never infer media from source titles.</summary>
    public static IReadOnlyList<AutomationLibraryItem> ReadLibrary(ILibraryManager library)
    {
        if (library.IsScanRunning) throw new InvalidOperationException("A Jellyfin library scan is active.");
        var items = library.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode, BaseItemKind.BoxSet },
            Recursive = true, EnableTotalRecordCount = false, IsVirtualItem = false
        });
        if (items.Count > 250000) throw new InvalidOperationException("The automation library snapshot exceeds 250,000 items.");
        var series = items.OfType<Series>().ToDictionary(s => s.Id);
        var result = items.Select(item =>
        {
            var episode = item as Episode;
            series.TryGetValue(episode?.SeriesId ?? Guid.Empty, out var parent);
            var available = item is MediaBrowser.Controller.Entities.Movies.BoxSet
                || (!item.IsVirtualItem && !string.IsNullOrWhiteSpace(item.Path)
                    && (item.IsFolder ? Directory.Exists(item.Path) : File.Exists(item.Path)));
            return new AutomationLibraryItem
            {
                Id = item.Id.ToString("D"), Name = item.Name ?? string.Empty,
                ItemType = item switch { Movie => "Movie", Series => "Series", Episode => "Episode", _ => "BoxSet" },
                ProviderIds = new(item.ProviderIds ?? new(), StringComparer.OrdinalIgnoreCase),
                SeriesId = episode?.SeriesId.ToString("D") ?? string.Empty,
                SeriesProviderIds = new(parent?.ProviderIds ?? new(), StringComparer.OrdinalIgnoreCase),
                SeasonNumber = episode?.ParentIndexNumber, EpisodeNumber = episode?.IndexNumber,
                EpisodeEnd = episode?.IndexNumberEnd, Year = item.ProductionYear, IsAvailable = available
            };
        }).ToList();
        if (library.IsScanRunning) throw new InvalidOperationException("A Jellyfin library scan started during the snapshot.");
        return result;
    }
}

public sealed class AutomationConflictException(string message) : InvalidOperationException(message);
