using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>Read public IMDb lists, in explicit list order, without scraping/challenge bypasses.</summary>
public static class ImdbListClient
{
    // Public operation identifier used by IMDb Web's TitleListMainPage operation.
    // Confirmed against the live MCU list. No runtime dependency on third-party scripts or hashes.
    // Reference: https://github.com/Kometa-Team/IMDb-Hash/blob/master/LIST_HASH
    public const string OperationHash = "dc98c1b896ffcb97e619b888d27721ff40fea6985fd022bca920615ed744ee0b";
    public const string Endpoint = "https://api.graphql.imdb.com/";

    public static async Task<List<FranchiseAutoAddController.Entry>> ReadAsync(HttpClient client, string listId, CancellationToken cancellationToken)
    {
        if (!Regex.IsMatch(listId, @"^ls[0-9]+$")) throw new InvalidOperationException("Invalid IMDb list identifier.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(35));
        var token = deadline.Token;
        var entries = new List<FranchiseAutoAddController.Entry>();
        var cursors = new HashSet<string>(StringComparer.Ordinal);
        string? cursor = null;
        int? expectedTotal = null;
        for (var page = 0; page < 30; page++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint);
            request.Headers.TryAddWithoutValidation("x-imdb-client-name", "imdb-web-next");
            request.Content = JsonContent.Create(new
            {
                operationName = "TitleListMainPage",
                variables = new { lsConst = listId, locale = "en-US", first = 100, after = cursor, isInPace = false, sort = new { by = "LIST_ORDER", order = "ASC" } },
                extensions = new { persistedQuery = new { version = 1, sha256Hash = OperationHash } }
            });
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"IMDb API HTTP {(int)response.StatusCode}. The source may be blocked or rate limited. Retry later; no partial list was imported.");
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(chunk, token)) != 0)
            {
                if (buffer.Length + count > 8 * 1024 * 1024) throw new InvalidOperationException("IMDb response exceeded the 8 MB limit.");
                buffer.Write(chunk, 0, count);
            }
            using var document = JsonDocument.Parse(buffer.ToArray());
            var root = document.RootElement;
            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
            {
                // Do not accept partial GraphQL data when access/schema errors are present.
                var message = errors[0].TryGetProperty("message", out var error) ? error.GetString() : "Unknown API error";
                throw new InvalidOperationException("IMDb API: " + (message ?? "Unknown API error")[..Math.Min(message?.Length ?? 17, 600)] + ". No partial list was imported.");
            }
            if (!root.TryGetProperty("data", out var data) || !data.TryGetProperty("list", out var list) || list.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("IMDb list is unavailable, private, or does not exist.");
            if (!list.TryGetProperty("titleListItemSearch", out var search) || search.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("IMDb returned unsupported list metadata. The API operation may need updating.");
            var total = search.GetProperty("total").GetInt32();
            if (total < 0 || total > 3000) throw new InvalidOperationException("IMDb lists must contain at most 3,000 entries. No partial list was imported.");
            if (expectedTotal.HasValue && expectedTotal != total) throw new InvalidOperationException("IMDb list changed during retrieval. Preview again.");
            expectedTotal = total;
            var edges = search.GetProperty("edges");
            foreach (var edge in edges.EnumerateArray())
            {
                var item = edge.GetProperty("listItem");
                var id = item.GetProperty("id").GetString() ?? "";
                var title = item.GetProperty("titleText").GetProperty("text").GetString() ?? "";
                if (!Regex.IsMatch(id, @"^tt[0-9]+$") || title.Length == 0) throw new InvalidOperationException("IMDb returned an unavailable title; no partial list was imported.");
                int? position = edge.GetProperty("node").TryGetProperty("absolutePosition", out var pos) && pos.ValueKind == JsonValueKind.Number && pos.TryGetInt32(out var number) ? number : null;
                int? year = item.TryGetProperty("releaseYear", out var release) && release.ValueKind == JsonValueKind.Object && release.TryGetProperty("year", out var y) && y.ValueKind == JsonValueKind.Number && y.TryGetInt32(out var value) ? value : null;
                var kind = item.GetProperty("titleType").GetProperty("id").GetString();
                var type = kind switch { "movie" or "tvMovie" => "Movie", "tvSeries" or "tvMiniSeries" => "Series", "tvEpisode" => "Episode", _ => "Other" };
                entries.Add(new(id, title, year, type, position));
            }
            if (entries.Count > total) throw new InvalidOperationException("IMDb returned inconsistent pagination. Preview again.");
            var pageInfo = search.GetProperty("pageInfo");
            if (!pageInfo.GetProperty("hasNextPage").GetBoolean())
            {
                if (entries.Count != total) throw new InvalidOperationException("IMDb returned an incomplete list. No partial list was imported.");
                // Order is verified before deduplication; duplicated titles retain their first source position.
                if (entries.Any(e => e.Position is null or < 1) || entries.Select(e => e.Position).Distinct().Count() != entries.Count)
                    throw new InvalidOperationException("IMDb did not return unique, explicit list positions. No chronology was inferred.");
                return entries.OrderBy(e => e.Position).DistinctBy(e => e.ImdbId).ToList();
            }
            cursor = pageInfo.GetProperty("endCursor").GetString();
            if (edges.GetArrayLength() == 0 || string.IsNullOrEmpty(cursor) || !cursors.Add(cursor))
                throw new InvalidOperationException("IMDb pagination stalled. No partial list was imported.");
        }
        throw new InvalidOperationException("IMDb pagination exceeded the 30-page limit. No partial list was imported.");
    }
}
