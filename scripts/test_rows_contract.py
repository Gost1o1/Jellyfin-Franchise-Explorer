#!/usr/bin/env python3
"""Fast CI contract checks for presentation-only franchise rows."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
config=(root/'Configuration/PluginConfiguration.cs').read_text()
model=(root/'Models/FranchiseRow.cs').read_text()
api=(root/'Api/FranchiseBrowseController.cs').read_text()
admin=(root/'Configuration/configPage.html').read_text()
browse=(root/'Configuration/browsePage.html').read_text()
assert config.count('public List<FranchiseRow> Rows { get; set; }')==1
for field in ('ParentNodeId','RowType','SortOrder','NodeIds','MediaLinkIds'):
    assert f'public ' in model and field in model,field
    assert field[0].lower()+field[1:] in api,field
for marker in ('fx-create-row','fx-new-row-name','fx-rows-list','fx-suggest-rows','function renderRows','Delete row','Rename row','cfg.Rows=data.Rows','Rows:safeRows'):
    assert marker in admin,marker
for marker in ('rows-container','function defaultRows','async function renderShelf','Unassigned Groups','shelf-track','scroll-snap-type'):
    assert marker in browse,marker
assert 'config.Rows.Select' in api
assert 'id = l.Id' in api
print('Presentation row schema and browser contract checks passed (static only)')
