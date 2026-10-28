from pathlib import Path
p=Path('src/Jellyfin.Plugin.FranchiseExplorer/Api/FranchiseArtworkController.cs').read_text()
for s in ('Policies.RequiresElevation','MaxImageBytes','TryGetDirectory','Plugin.Instance','DetectImage','Path.Combine(plugin.DataFolderPath','File.Move(temporary, destination, true)','Response.Headers["Cache-Control"]','HttpPost','HttpGet'):
    assert s in p, f'Artwork controller missing: {s}'
assert 'file.FileName' not in p and 'file.ContentType' not in p, 'Never trust upload filename or supplied MIME type'
h=Path('src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
for s in ('fx-upload-primary','fx-upload-backdrop','fx-upload-logo','fx-upload-thumb','fx-upload-banner','FormData','artApiUrl','authHeaders()','renderArtwork'):
    assert s in h, f'Artwork UI missing: {s}'
for s in ('Primary poster URL','Backdrop URL','Clearlogo URL','Thumb / icon URL','Banner URL'):
    assert s not in h, f'Old URL input remains: {s}'
import re
selectors=set(re.findall(r'byId\(\'([^\']+)\'\)',h))
ids=set(re.findall(r'\bid=\"([^\"]+)\"',h))
assert selectors<=ids, 'JS is referencing nonexistent HTML selectors: '+str(selectors-ids)
print('Artwork controller and UI static contract passed (not a runtime test).')
