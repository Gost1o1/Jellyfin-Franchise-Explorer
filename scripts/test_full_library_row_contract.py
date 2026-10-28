#!/usr/bin/env python3
"""Static full-library shelf contract; no external packages needed in CI."""
from pathlib import Path
project=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
admin=(project/'Configuration/configPage.html').read_text()
controller=(project/'Api/FranchiseBrowseController.cs').read_text()
browse=(project/'Configuration/browsePage.html').read_text()
row=(project/'Models/FranchiseRow.cs').read_text()
entry=(project/'Models/FranchiseRowEntry.cs').read_text()
assert 'List<FranchiseRowEntry> Items' in row
assert 'JellyfinItemId' in entry and 'RangeMode' in entry and 'StartSeason' in entry
assert "includeItemTypes:'BoxSet,Movie,Series'" in admin
assert "if(includeGroups)" in admin and "children(selected)" in admin
assert "if(includeMedia)" in admin and 'renderRowLibrary(r,pickers)' in admin
assert 'openRangeEditor(item,null,row.Id)' in admin
assert 'const candidate={JellyfinItemId:item.Id,...range}' in admin
assert 'if(pendingRowId)' in admin
assert 'row.Items.push(entry)' in admin
assert 'MediaLinkIds' in admin  # older rows kept
assert 'MediaOrder' in row and 'mediaOrder' in controller and 'mediaRank' in browse
assert 'items = r.Items.Select' in controller or 'items = r.Items?.Select' in controller
assert "const own=rowIsMedia(r)?(r.items||[])" in browse
assert 'getItem(l.itemId)' in browse
assert 'i.DisplayName' not in controller  # admin-supplied titles not served to viewers
print('Full-library row contract checks passed; live Jellyfin API still unverified.')
