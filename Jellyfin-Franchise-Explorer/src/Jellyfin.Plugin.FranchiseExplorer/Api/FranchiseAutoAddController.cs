using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>Admin-only, read-only IMDb list adapter. Never writes library or configuration data.</summary>
[ApiController]
[Route("FranchiseExplorer/AutoAdd")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class FranchiseAutoAddController(ILogger<FranchiseAutoAddController> logger) : ControllerBase
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(20) };
    public sealed record Entry(string ImdbId, string Title, int? Year, string Type, int? Position);

    [HttpGet("Source")]
    public async Task<IActionResult> Source([FromQuery] string url, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "www.imdb.com" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || !Regex.IsMatch(uri.AbsolutePath, @"^/list/ls[0-9]+/$"))
            return BadRequest(new { error = "Use an HTTPS IMDb list URL: https://www.imdb.com/list/ls123456789/" });
        try
        {
            var listId = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)[1];
            var entries = await ImdbListClient.ReadAsync(Client, listId, cancellationToken);
            if (entries.Count == 0) throw new InvalidOperationException("IMDb list contains no usable titles. No items were imported.");
            var verified = entries.All(e => e.Position > 0) && entries.Select(e => e.Position).Distinct().Count() == entries.Count;
            return Ok(new { entries = verified ? entries.OrderBy(e => e.Position).ToList() : entries, orderVerified = verified,
                warning = "All IMDb list pages were retrieved in explicit list order. Individual episodes require exact IMDb IDs in Jellyfin. Source order is not independent verification of in-universe chronology." });
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or InvalidOperationException or JsonException or RegexMatchTimeoutException or KeyNotFoundException or FormatException)
        {
            logger.LogWarning(ex, "Franchise Auto-Add source {List}: {Error}", uri.AbsolutePath, ex.Message);
            return StatusCode(502, new { error = ex.Message });
        }
    }

    // Accept explicit JSON-LD ItemList positions only, never DOM/search ranking.
    public static List<Entry> Parse(string html)
    {
        var entries = new List<Entry>();
        foreach (Match script in Regex.Matches(html, "<script\\b[^>]*type=[\"']application/ld\\+json[\"'][^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase, TimeSpan.FromSeconds(2)))
        {
            using var document = JsonDocument.Parse(script.Groups[1].Value);
            Walk(document.RootElement, entries);
        }
        return entries.DistinctBy(e => e.ImdbId).Take(3000).ToList();
    }
    private static void Walk(JsonElement element, List<Entry> entries)
    {
        if (element.ValueKind == JsonValueKind.Array) { foreach (var child in element.EnumerateArray()) Walk(child, entries); return; }
        if (element.ValueKind != JsonValueKind.Object) return;
        if (element.TryGetProperty("itemListElement", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var row in list.EnumerateArray())
            {
                var item = row.TryGetProperty("item", out var nested) ? nested : row;
                if (item.ValueKind != JsonValueKind.Object) continue;
                string Text(string key) => item.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                var id = Regex.Match(Text("url"), @"/title/(tt[0-9]+)(?:/|$)").Groups[1].Value;
                if (id.Length == 0 || Text("name").Length == 0) continue;
                int? position = row.TryGetProperty("position", out var pos) && pos.TryGetInt32(out var n) ? n : null;
                int? year = int.TryParse(Text("datePublished").Split('-')[0], out var y) ? y : null;
                var type = Text("@type") switch { "Movie" or "TVMovie" => "Movie", "TVSeries" or "TVMiniSeries" => "Series", _ => "Other" };
                entries.Add(new(id, WebUtility.HtmlDecode(Text("name")), year, type, position));
            }
        foreach (var property in element.EnumerateObject()) if (property.Name != "itemListElement") Walk(property.Value, entries);
    }
}
