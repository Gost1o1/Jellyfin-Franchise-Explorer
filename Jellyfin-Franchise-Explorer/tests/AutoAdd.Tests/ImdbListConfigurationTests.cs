using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;

internal static class ImdbListConfigurationTests
{
    public static void Run()
    {
        var legacy = ReadXml("""
            <PluginConfiguration>
              <NavigationLabel>Existing franchises</NavigationLabel>
              <Nodes><FranchiseNode><Name>Legacy franchise</Name></FranchiseNode></Nodes>
              <Rows><FranchiseRow><Name>Legacy timeline</Name><RowType>Timeline</RowType></FranchiseRow></Rows>
            </PluginConfiguration>
            """);
        Check(legacy.ImdbLists.Count == 0, "Older XML configurations must load without saved IMDb lists");
        Check(legacy.Nodes[0].EpisodeFormat == "Bundles", "Older franchises must keep bundled chronological episodes");
        Check(legacy.Rows[0].EpisodeFormat == string.Empty, "Older rows must inherit their owning franchise's format");
        Check(legacy.NavigationLabel == "Existing franchises" && legacy.Rows[0].RowType == "Timeline",
            "New defaults must retain existing navigation and row settings");

        var preset = new FranchiseImdbList { Name = "Marvel & friends", Url = "https://www.imdb.com/list/ls123/" };
        Check(Guid.TryParseExact(preset.Id, "D", out _) && preset.Enabled,
            "New saved lists must have a stable portable GUID and start enabled");
        var second = new FranchiseImdbList { Name = "A second list", Url = "https://www.imdb.com/list/ls456/", Enabled = false };
        var node = new FranchiseNode { Name = "MCU", EpisodeFormat = "Individual" };
        var row = new FranchiseRow
        {
            ParentNodeId = node.Id,
            Name = "Chronological Order",
            RowType = "Timeline",
            SourceUrl = preset.Url,
            EpisodeFormat = "Bundles",
            AutoAddSources = new()
            {
                new FranchiseSource { Url = preset.Url, Enabled = true, Priority = 2, Categories = new() { "Chronological Timeline" } },
                new FranchiseSource { Url = second.Url, Enabled = false, Priority = 7, Categories = new() { "Chronological Timeline", "Other" } }
            }
        };
        var inheriting = new FranchiseRow { ParentNodeId = node.Id, Name = "Inherited timeline", RowType = "Timeline" };
        node.AutoAddSources.Add(new FranchiseSource { Url = preset.Url, Priority = 4, Categories = new() { "Movies", "TV Shows" } });
        var referenceId = Guid.NewGuid().ToString("D");
        node.AutoAddRecords.Add(new FranchiseAutoAddRecord
        {
            ScopeRowId = row.Id,
            RowId = row.Id,
            ReferenceId = referenceId,
            SourceIds = row.AutoAddSources.Select(source => source.Id).ToList(),
            ImdbIds = new() { "tt123", "tt456" },
            Signature = "{\"title\":\"Manual & preserved\"}"
        });
        var configuration = new PluginConfiguration
        {
            NavigationLabel = "My franchises",
            ImdbLists = new() { preset, second },
            Nodes = new() { node },
            Rows = new() { row, inheriting }
        };
        var restored = ReadXml(WriteXml(configuration));
        Verify(restored, configuration);

        // Saved-list presets are a library of choices. Imports own independent sources,
        // including when two scopes use the same URL or a preset is later removed.
        restored.ImdbLists.RemoveAt(0);
        var withoutPreset = ReadXml(WriteXml(restored));
        Check(withoutPreset.Rows[0].AutoAddSources[0].Id == row.AutoAddSources[0].Id
            && withoutPreset.Rows[0].AutoAddSources[0].Url == preset.Url
            && withoutPreset.Nodes[0].AutoAddSources[0].Id == node.AutoAddSources[0].Id
            && withoutPreset.Nodes[0].AutoAddRecords[0].ReferenceId == referenceId,
            "Removing a saved-list preset must not change independent imports or their ownership");

        var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var json = JsonSerializer.Serialize(configuration, jsonOptions);
        var fromBackup = JsonSerializer.Deserialize<PluginConfiguration>(json, jsonOptions)!;
        Verify(fromBackup, configuration);
        var oldBackup = JsonSerializer.Deserialize<PluginConfiguration>("""
            {"NavigationLabel":"Older JSON","Nodes":[{"Name":"Old node"}],"Rows":[{"Name":"Old row"}]}
            """, jsonOptions)!;
        Check(oldBackup.ImdbLists.Count == 0 && oldBackup.Nodes[0].EpisodeFormat == "Bundles"
            && oldBackup.Rows[0].EpisodeFormat == string.Empty,
            "Older JSON backups must receive the same saved-list and episode-format defaults as XML");

        Console.WriteLine("PASS IMDb list configuration: legacy defaults, saved-list order/identity, independent multi-source ownership, episode-format overrides and XML/JSON round trips");
    }

    private static void Verify(PluginConfiguration actual, PluginConfiguration expected)
    {
        Check(actual.NavigationLabel == expected.NavigationLabel, "New settings must retain navigation preferences");
        Check(actual.ImdbLists.Count == 2
            && actual.ImdbLists.Select(list => list.Id).SequenceEqual(expected.ImdbLists.Select(list => list.Id))
            && actual.ImdbLists.Select(list => list.Name).SequenceEqual(expected.ImdbLists.Select(list => list.Name))
            && actual.ImdbLists.Select(list => list.Url).SequenceEqual(expected.ImdbLists.Select(list => list.Url))
            && actual.ImdbLists[0].Enabled && !actual.ImdbLists[1].Enabled,
            "Saved-list names, order, URLs, enabled states and identities must survive serialization");
        Check(actual.Nodes[0].EpisodeFormat == "Individual" && actual.Rows[0].EpisodeFormat == "Bundles"
            && actual.Rows[1].EpisodeFormat == string.Empty,
            "Node defaults, explicit row overrides and inheriting rows must survive serialization");
        var sources = actual.Rows[0].AutoAddSources;
        Check(sources.Count == 2
            && sources.Select(source => source.Id).SequenceEqual(expected.Rows[0].AutoAddSources.Select(source => source.Id))
            && sources.Select(source => source.Url).SequenceEqual(expected.Rows[0].AutoAddSources.Select(source => source.Url))
            && sources[0].Enabled && !sources[1].Enabled && sources[0].Priority == 2 && sources[1].Priority == 7
            && sources[1].Categories.SequenceEqual(new[] { "Chronological Timeline", "Other" }),
            "Multiple independent row sources must retain identities, order and import settings");
        Check(actual.Rows[0].SourceUrl == expected.Rows[0].SourceUrl
            && actual.Nodes[0].AutoAddSources[0].Id == expected.Nodes[0].AutoAddSources[0].Id
            && actual.Nodes[0].AutoAddRecords[0].SourceIds.SequenceEqual(expected.Nodes[0].AutoAddRecords[0].SourceIds)
            && actual.Nodes[0].AutoAddRecords[0].Signature == expected.Nodes[0].AutoAddRecords[0].Signature,
            "Legacy source URLs, node sources and removal ownership signatures must remain unchanged");
        Check(actual.Rows[0].AutoAddSources.All(source => actual.ImdbLists.All(list => source.Id != list.Id)),
            "Assigned source ownership must not use global saved-list IDs");
    }

    private static string WriteXml(PluginConfiguration configuration)
    {
        using var writer = new StringWriter();
        new XmlSerializer(typeof(PluginConfiguration)).Serialize(writer, configuration);
        return writer.ToString();
    }

    private static PluginConfiguration ReadXml(string xml)
    {
        using var reader = new StringReader(xml);
        return (PluginConfiguration)new XmlSerializer(typeof(PluginConfiguration)).Deserialize(reader)!;
    }

    private static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
    }
}
