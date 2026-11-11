using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

[ApiController]
[Route("FranchiseExplorer/Recovery")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class FranchiseRecoveryController(MediaRecoveryService recovery, IUserManager users) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private bool IsAdministrator() => Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var id)
        && users.GetUserById(id)?.HasPermission(PermissionKind.IsAdministrator) == true;
    private IActionResult JsonResult(object value)
    {
        Response.Headers["Cache-Control"] = "no-store";
        return Content(JsonSerializer.Serialize(value, JsonOptions), "application/json; charset=utf-8");
    }
    [HttpGet("Status")]
    public async Task<IActionResult> Status(CancellationToken cancellationToken)
    {
        if (!IsAdministrator()) return Unauthorized();
        try { return JsonResult(await recovery.StatusAsync(cancellationToken).ConfigureAwait(false)); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }
    [HttpPost("Check")]
    public async Task<IActionResult> Check(CancellationToken cancellationToken)
    {
        if (!IsAdministrator()) return Unauthorized();
        try { return JsonResult(await recovery.CheckAsync(true, cancellationToken).ConfigureAwait(false)); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }
    [HttpGet("Candidates")]
    public async Task<IActionResult> Candidates([FromQuery] string referenceId, [FromQuery] string query, [FromQuery] string revision, [FromQuery] string libraryRevision, CancellationToken cancellationToken)
    {
        if (!IsAdministrator()) return Unauthorized();
        try { return JsonResult(await recovery.CandidatesAsync(referenceId, query, revision, libraryRevision, cancellationToken).ConfigureAwait(false)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }
    [HttpPost("Auto")]
    public async Task<IActionResult> Auto(CancellationToken cancellationToken)
    {
        if (!IsAdministrator()) return Unauthorized();
        try { return JsonResult(await recovery.AutoAsync(cancellationToken).ConfigureAwait(false)); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
        catch (IOException) { return StatusCode(503, new { error = "Recovery could not save all timeline records. No media references were changed." }); }
        catch (JsonException) { return StatusCode(503, new { error = "A timeline record needs repair before media links can be recovered." }); }
    }
    [HttpPost("Apply")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> Apply([FromBody] MediaRecoveryApplyRequest request, CancellationToken cancellationToken)
    {
        if (!IsAdministrator()) return Unauthorized();
        try { return JsonResult(await recovery.ApplyAsync(request, false, cancellationToken).ConfigureAwait(false)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
        catch (IOException) { return StatusCode(503, new { error = "Recovery could not save all timeline records. No media references were changed." }); }
        catch (JsonException) { return StatusCode(503, new { error = "A timeline record needs repair before media links can be recovered." }); }
    }
}
