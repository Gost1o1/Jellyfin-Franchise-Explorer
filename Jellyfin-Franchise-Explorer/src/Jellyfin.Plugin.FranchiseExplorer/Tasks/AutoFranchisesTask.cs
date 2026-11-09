using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.FranchiseExplorer.Tasks;

/// <summary>Jellyfin executes this task on the server, independently of browser sessions.</summary>
public sealed class AutoFranchisesTask(AutoFranchiseService automation) : IScheduledTask
{
    public string Name => "Auto Franchises";
    public string Key => "FranchiseExplorer.AutoFranchises";
    public string Description => "Update enabled Auto Franchises at midnight in the server's local timezone. Requires opt-in in Franchise Explorer settings.";
    public string Category => "Franchise Explorer";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        yield return new() { Type = TaskTriggerInfoType.DailyTrigger, TimeOfDayTicks = 0 };
        yield return new() { Type = TaskTriggerInfoType.StartupTrigger };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        await automation.RunAsync(scheduled: true, cancellationToken, progress).ConfigureAwait(false);
        progress.Report(100);
    }
}
