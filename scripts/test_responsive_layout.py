#!/usr/bin/env python3
"""Static regression guard for responsive page CSS (not a Jellyfin runtime test)."""
from pathlib import Path
html=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text(encoding='utf8')
checks=['container-type:inline-size','@container (max-width: 1120px)', '@container (max-width: 740px)', '@container (max-width: 480px)', 'grid-template-columns:minmax(0,1fr)', 'overflow-x:hidden', 'fx-wrap {width:100%!important']
for marker in checks:
    assert marker in html, f'Missing responsive CSS: {marker}'
print('Responsive layout structural checks passed')
