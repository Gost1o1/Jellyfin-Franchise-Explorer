using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

public sealed record FranchiseViewerPreference(bool HasPreference, bool SubtitleEnabled, string SubtitleLanguage);

/// <summary>Plugin-owned account preferences, independent of Jellyfin's library playback defaults.</summary>
public sealed class FranchiseViewerPreferenceStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Func<string?> _root;
    private readonly object _gate = new();
    private readonly Dictionary<Guid, FranchiseViewerPreference> _cache = new();

    public FranchiseViewerPreferenceStore() : this(() => Plugin.Instance?.DataFolderPath) { }
    public FranchiseViewerPreferenceStore(Func<string?> root) => _root = root;

    public static bool ValidLanguage(string? language) => language is not null && language.Length <= 20
        && (language.Length == 0 || Regex.IsMatch(language, "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$", RegexOptions.CultureInvariant));

    private string PathFor(Guid user)
    {
        if (user == Guid.Empty) throw new ArgumentException("A verified user is required.");
        var root = _root();
        if (string.IsNullOrWhiteSpace(root)) throw new IOException("Plugin data folder unavailable.");
        return Path.Combine(root, "viewer-preferences", user.ToString("N") + ".json");
    }

    public FranchiseViewerPreference Get(Guid user)
    {
        lock (_gate)
        {
            if (_cache.TryGetValue(user, out var cached)) return cached;
            var path = PathFor(user);
            FranchiseViewerPreference? value;
            try { value = JsonSerializer.Deserialize<FranchiseViewerPreference>(File.ReadAllText(path), JsonOptions); }
            catch (FileNotFoundException) { value = new(false, false, string.Empty); }
            catch (DirectoryNotFoundException) { value = new(false, false, string.Empty); }
            if (value is null || !ValidLanguage(value.SubtitleLanguage)) throw new JsonException("Invalid viewer preferences.");
            _cache[user] = value;
            return value;
        }
    }

    public FranchiseViewerPreference Set(Guid user, bool enabled, string language)
    {
        if (!ValidLanguage(language)) throw new ArgumentException("Invalid subtitle language.");
        lock (_gate)
        {
            var path = PathFor(user);
            var value = new FranchiseViewerPreference(true, enabled, language);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, JsonSerializer.Serialize(value, JsonOptions));
                File.Move(temporary, path, overwrite: true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            // Publish only after the atomic replacement succeeds.
            _cache[user] = value;
            return value;
        }
    }
}
