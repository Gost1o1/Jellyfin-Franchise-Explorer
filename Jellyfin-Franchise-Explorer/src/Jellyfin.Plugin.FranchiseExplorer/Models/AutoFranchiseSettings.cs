using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Xml.Serialization;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Durable, opt-in server automation; separate from the reusable IMDb list library.</summary>
public sealed class AutoFranchiseSettings
{
    public bool Enabled { get; set; }
    [XmlIgnore]
    public List<AutoFranchiseRegistration> Registry { get; set; } = AutoFranchiseDefaults.Registry();
    // XmlSerializer appends to initialized collections. An array surrogate replaces the
    // defaults on deserialization, while legacy XML without Registry keeps the eleven seeds.
    [XmlArray("Registry"), XmlArrayItem("AutoFranchiseRegistration"), JsonIgnore]
    public AutoFranchiseRegistration[] RegistryXml
    {
        get => Registry.ToArray();
        set => Registry = value?.ToList() ?? new();
    }
    public List<AutoFranchiseExclusion> Exclusions { get; set; } = new();
    public List<AutoFranchiseChange> PendingChanges { get; set; } = new();
    public List<AutoFranchiseOwnership> Ownership { get; set; } = new();
    public AutoFranchiseRunStatus? LastRun { get; set; }
    public string LastCompletedLocalDay { get; set; } = string.Empty;
}

public sealed class AutoFranchiseRegistration
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string Name { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public string FranchiseNodeId { get; set; } = string.Empty;
    public string EpisodeFormat { get; set; } = "Bundles";
    public bool Deleted { get; set; }
    public List<AutoFranchiseRowMapping> Rows { get; set; } = new();
}

public sealed class AutoFranchiseRowMapping
{
    public string Kind { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public bool Deleted { get; set; }
}

/// <summary>Stable provider identity plus optional row scope; never inferred from Cancel or a failed source.</summary>
public sealed class AutoFranchiseExclusion
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string RegistrationId { get; set; } = string.Empty;
    public string FranchiseNodeId { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public string Scope { get; set; } = "Movie";
    public string ProviderName { get; set; } = "Imdb";
    public string ProviderId { get; set; } = string.Empty;
    public string JellyfinItemId { get; set; } = string.Empty;
    public int StartSeason { get; set; }
    public int EndSeason { get; set; }
    public int StartEpisode { get; set; }
    public int EndEpisode { get; set; }
    public bool Enabled { get; set; } = true;
    public string Reason { get; set; } = "Excluded by you";
    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Plugin-owned reference fingerprint. Edited/deleted references do not become eligible additions again.</summary>
public sealed class AutoFranchiseOwnership
{
    public string RegistrationId { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public string ReferenceId { get; set; } = string.Empty;
    public string MediaKey { get; set; } = string.Empty;
    public string Signature { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public string ItemType { get; set; } = string.Empty;
    public string ProviderId { get; set; } = string.Empty;
    public string SeriesProviderId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int StartSeason { get; set; }
    public int EndSeason { get; set; }
    public int StartEpisode { get; set; }
    public int EndEpisode { get; set; }
    public int SourcePosition { get; set; }
    public List<string> EpisodeIds { get; set; } = new();
}

/// <summary>Persisted review operation. Status Pending/Kept/Applied makes identical nightly notifications idempotent.</summary>
public sealed class AutoFranchiseChange
{
    public string Id { get; set; } = string.Empty;
    public string RegistrationId { get; set; } = string.Empty;
    public string FranchiseNodeId { get; set; } = string.Empty;
    public string FranchiseName { get; set; } = string.Empty;
    public string Kind { get; set; } = "Add";
    public string Status { get; set; } = "Pending";
    public bool Safe { get; set; }
    public string Title { get; set; } = string.Empty;
    public string ItemType { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public string SeriesId { get; set; } = string.Empty;
    public string ProviderId { get; set; } = string.Empty;
    public string SeriesProviderId { get; set; } = string.Empty;
    public string RowKind { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public string ReferenceId { get; set; } = string.Empty;
    public string MediaKey { get; set; } = string.Empty;
    public string SourceUrl { get; set; } = string.Empty;
    public int SourcePosition { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string Existing { get; set; } = string.Empty;
    public string Proposed { get; set; } = string.Empty;
    public List<string> ExclusionIds { get; set; } = new();
    public List<string> EpisodeIds { get; set; } = new();
    public int StartSeason { get; set; }
    public int EndSeason { get; set; }
    public int StartEpisode { get; set; }
    public int EndEpisode { get; set; }
    public DateTimeOffset UpdatedUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class AutoFranchiseRunStatus
{
    public DateTimeOffset StartedUtc { get; set; }
    public DateTimeOffset? CompletedUtc { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public List<string> RegistrationIds { get; set; } = new();
    public int Added { get; set; }
    public int Held { get; set; }
    public int Errors { get; set; }
}

public static class AutoFranchiseDefaults
{
    public static string StableGuid(string value)
        => new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(value))[..16]).ToString("D");

    public static List<AutoFranchiseRegistration> Registry()
    {
        var names = new[] { "The Matrix", "Pirates Of The Caribbean", "Indiana Jones", "Terminator", "Transformers", "Men In Black", "Marvel Cinematic Universe", "Alien", "The MonsterVerse", "Jurassic Park", "Star Wars" };
        var lists = new[] { "ls579565194", "ls526615193", "ls526781175", "ls024885449", "ls592604450", "ls4104275763", "ls539646485", "ls087871200", "ls521872135", "ls539977081", "ls072034866" };
        return names.Select((name, index) => new AutoFranchiseRegistration
        {
            Id = StableGuid("auto-franchise:" + lists[index]), Name = name,
            Url = "https://www.imdb.com/list/" + lists[index] + "/"
        }).ToList();
    }
}
