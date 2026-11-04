using System.Net;
using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Api;

internal static class ImdbTransportTests
{
    public static async Task Run()
    {
        static object Edge(int position, string id, string type) => new { node = new { absolutePosition = position }, listItem = new { id, titleText = new { text = id }, releaseYear = new { year = 2011 }, titleType = new { id = type } } };
        static string Page(int total, bool more, string? cursor, params object[] edges) => JsonSerializer.Serialize(new { data = new { list = new { titleListItemSearch = new { total, edges, pageInfo = new { hasNextPage = more, endCursor = cursor } } } } });
        var requests = new List<string>();
        using var client = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri?.ToString() != ImdbListClient.Endpoint || request.Method != HttpMethod.Post) throw new Exception("Unexpected outbound request");
            var body=await request.Content!.ReadAsStringAsync();requests.Add(body);
            using var document=JsonDocument.Parse(body);
            var variables=document.RootElement.GetProperty("variables");
            if (variables.GetProperty("sort").GetProperty("by").GetString()!="LIST_ORDER" || variables.GetProperty("sort").GetProperty("order").GetString()!="ASC") throw new Exception("Explicit source sorting required");
            var after=variables.GetProperty("after");
            return new(HttpStatusCode.OK) { Content=new StringContent(after.ValueKind==JsonValueKind.Null ? Page(2,true,"next",Edge(1,"tt1","movie")) : Page(2,false,null,Edge(2,"tt2","tvEpisode"))) };
        }));
        var result=await ImdbListClient.ReadAsync(client,"ls1",default);
        if (result.Count!=2 || requests.Count!=2 || result[1].Type!="Episode" || result[1].Position!=2)throw new Exception("Pagination/episode parser failed");
        async Task Reject(string payload, HttpStatusCode code=HttpStatusCode.OK)
        {
            using var failing=new HttpClient(new Handler(_=>Task.FromResult(new HttpResponseMessage(code){Content=new StringContent(payload)})));
            try { await ImdbListClient.ReadAsync(failing,"ls1",default); }
            catch(InvalidOperationException) { return; }
            throw new Exception("Unsafe or incomplete IMDb response was accepted");
        }
        using var emptyClient=new HttpClient(new Handler(_=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(Page(0,false,null))})));
        if((await ImdbListClient.ReadAsync(emptyClient,"ls1",default)).Count!=0)throw new Exception("Verified empty list must be accepted");
        await Reject("blocked",HttpStatusCode.Forbidden);
        await Reject("rate limited",HttpStatusCode.TooManyRequests);
        await Reject("{\"errors\":[{\"message\":\"PersistedQueryNotFound\"}],\"data\":null}");
        await Reject("{\"data\":{\"list\":null}}");
        await Reject(Page(2,false,null,Edge(1,"tt1","movie"))); // Incomplete response must not become a partial import.
        await Reject(Page(3,true,"same",Edge(1,"tt1","movie"))); // Repeated cursor.
        await Reject(Page(2,false,null,Edge(1,"tt1","movie"),Edge(1,"tt2","movie"))); // Duplicate positions.
        await Reject(Page(3001,false,null));
        Console.WriteLine("PASS IMDb transport: explicit sorting, pagination, episode metadata, 403/429, API errors, private lists, incomplete pages, cursor loops and limits");
    }
    private sealed class Handler(Func<HttpRequestMessage,Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)=>response(request);
    }
}
