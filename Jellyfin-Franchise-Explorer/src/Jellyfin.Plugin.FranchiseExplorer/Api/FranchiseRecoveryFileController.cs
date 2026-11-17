using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

public sealed class RecoveryFileRequest
{
    public string Path { get; set; } = "";
}

[ApiController]
[Route("FranchiseExplorer/Recovery/File")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class FranchiseRecoveryFileController(RecoveryFileService files, IUserManager users) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpPost("Check")]
    [RequestSizeLimit(16 * 1024)]
    public Task<IActionResult> Check([FromBody] RecoveryFileRequest request, CancellationToken cancellationToken) => Run(request, false, cancellationToken);

    [HttpPost("Scan")]
    [RequestSizeLimit(16 * 1024)]
    public Task<IActionResult> Scan([FromBody] RecoveryFileRequest request, CancellationToken cancellationToken) => Run(request, true, cancellationToken);

    private async Task<IActionResult> Run(RecoveryFileRequest request, bool scan, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var id)
            || users.GetUserById(id)?.HasPermission(PermissionKind.IsAdministrator) != true) return Unauthorized();
        Response.Headers["Cache-Control"] = "no-store";
        try
        {
            var report = scan ? await files.ScanAsync(request.Path, cancellationToken).ConfigureAwait(false)
                : await files.CheckAsync(request.Path, cancellationToken).ConfigureAwait(false);
            return Content(JsonSerializer.Serialize(report, JsonOptions), "application/json; charset=utf-8");
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
        catch (IOException) { return StatusCode(503, new { error = "Jellyfin could not complete the file check or queue the library scan. Retry after checking the server log." }); }
    }
}
