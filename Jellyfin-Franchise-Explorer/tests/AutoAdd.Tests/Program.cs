using System.Xml.Serialization;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
static void Check(bool value, string message) { if (!value) throw new Exception(message); }
var html = """
<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
{"position":2,"item":{"@type":"TVSeries","url":"https://www.imdb.com/title/tt3475734/","name":"Agent Carter","datePublished":"2015-01-01"}},
{"position":1,"item":{"@type":"Movie","url":"https://www.imdb.com/title/tt0458339/","name":"First Avenger","datePublished":"2011"}}]}</script>
""";
var entries=FranchiseAutoAddController.Parse(html);
Check(entries.Count==2 && entries[0].Type=="Series" && entries[1].Position==1 && entries[1].Year==2011,"IMDb JSON-LD parsing");
Check(FranchiseAutoAddController.Parse("<html>blocked</html>").Count==0,"Blocked response must not invent titles");
var serializer=new XmlSerializer(typeof(FranchiseNode));
using var oldReader=new StringReader("<FranchiseNode><Name>MCU</Name></FranchiseNode>");
var legacy=(FranchiseNode)serializer.Deserialize(oldReader)!;
Check(legacy.AutoAddSources.Count==0 && legacy.AutoAddRecords.Count==0,"Legacy configuration default");
legacy.AutoAddSources.Add(new(){Url="https://www.imdb.com/list/ls539646485/",Enabled=false,Priority=3,Categories=new(){"Movies","Other"}});
legacy.AutoAddRows.Add(new(){Category="Movies",RowId=Guid.NewGuid().ToString("D")});
legacy.AutoAddRecords.Add(new(){ReferenceId=Guid.NewGuid().ToString("D"),SourceIds=new(){"source"},ImdbIds=new(){"tt1"},Signature="{\"name\":\"A&B\"}"});
using var writer=new StringWriter();serializer.Serialize(writer,legacy);
using var reader=new StringReader(writer.ToString());var restored=(FranchiseNode)serializer.Deserialize(reader)!;
Check(!restored.AutoAddSources[0].Enabled && restored.AutoAddSources[0].Categories.Count==2 && restored.AutoAddSources[0].Priority==3,"XML source persistence");
Check(restored.AutoAddRows[0].Category=="Movies","Stable category row identity persistence");
Check(restored.AutoAddRecords[0].ImdbIds[0]=="tt1" && restored.AutoAddRecords[0].Signature==legacy.AutoAddRecords[0].Signature,"Auto-Add removal ownership XML roundtrip");
var controller=new FranchiseAutoAddController(NullLogger<FranchiseAutoAddController>.Instance);
foreach(var url in new[]{"http://www.imdb.com/list/ls1/","https://evil.example/list/ls1/","https://www.imdb.com/list/ls1/?x=1","https://www.imdb.com:444/list/ls1/"})
    Check(await controller.Source(url,default) is BadRequestObjectResult,"URL must be rejected before network access");
Console.WriteLine("PASS IMDb parser, URL safety, XML migration and persistence");

await ImdbTransportTests.Run();
await ArtworkTests.Run();

if (args.Contains("--live"))
{
    var result = await controller.Source("https://www.imdb.com/list/ls539646485/", default);
    if (result is not OkObjectResult ok) throw new Exception("Live controller retrieval failed: " + System.Text.Json.JsonSerializer.Serialize((result as ObjectResult)?.Value));
    var json = System.Text.Json.JsonSerializer.Serialize(ok.Value, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
    if (args.Length>1) await File.WriteAllTextAsync(args[1], json);
    using var live=System.Text.Json.JsonDocument.Parse(json);
    var list=live.RootElement.GetProperty("entries");
    Check(list.GetArrayLength()>100 && live.RootElement.GetProperty("orderVerified").GetBoolean(), "Live MCU pagination and explicit order");
    Check(list.EnumerateArray().Any(e=>e.GetProperty("type").GetString()=="Episode"), "Live episode metadata");
    Console.WriteLine($"PASS LIVE controller: {list.GetArrayLength()} MCU titles, explicit positions, all pages; first = {list[0].GetProperty("title").GetString()}");
}
