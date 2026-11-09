using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

[ApiController]
[Route("FranchiseExplorer/Automation")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class FranchiseAutomationController(AutoFranchiseService automation) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [HttpGet("Status")]
    public Task<IActionResult> Status(CancellationToken token) => Execute(() => automation.StatusAsync(token));

    [HttpPost("Settings")]
    [RequestSizeLimit(128 * 1024)]
    public Task<IActionResult> Settings([FromBody] AutoFranchiseService.SettingsRequest request, CancellationToken token)
        => Execute(() => automation.SaveSettingsAsync(request, token));

    [HttpPost("Preview")]
    [RequestSizeLimit(16 * 1024)]
    public Task<IActionResult> Preview([FromBody] AutoFranchiseService.PreviewRequest request, CancellationToken token)
        => Execute(() => automation.PreviewAsync(request, token));

    [HttpPost("Run")]
    [RequestSizeLimit(1024)]
    public Task<IActionResult> Run(CancellationToken token) => Execute(() => automation.RunAsync(scheduled: false, token));

    [HttpPost("Decision")]
    [RequestSizeLimit(128 * 1024)]
    public Task<IActionResult> Decision([FromBody] AutoFranchiseService.DecisionRequest request, CancellationToken token)
        => Execute(() => automation.DecideAsync(request, token));

    [HttpPost("Exclusion")]
    [RequestSizeLimit(16 * 1024)]
    public Task<IActionResult> Exclusion([FromBody] AutoFranchiseService.ExclusionRequest request, CancellationToken token)
        => Execute(() => automation.SaveExclusionAsync(request, token));

    private async Task<IActionResult> Execute<T>(Func<Task<T>> action)
    {
        try { return ExplicitJson(await action().ConfigureAwait(false)); }
        catch (AutomationConflictException ex) { return ExplicitJson(new { error = ex.Message }, 409); }
        catch (ArgumentException ex) { return ExplicitJson(new { error = ex.Message }, 400); }
        catch (InvalidOperationException ex) { return ExplicitJson(new { error = ex.Message }, 503); }
    }

    private ContentResult ExplicitJson<T>(T value, int status = 200)
    {
        if (HttpContext is not null) Response.Headers["Cache-Control"] = "no-store";
        return new() { Content = JsonSerializer.Serialize(value, Json), ContentType = "application/json; charset=utf-8", StatusCode = status };
    }
}
