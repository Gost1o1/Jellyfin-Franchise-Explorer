#!/usr/bin/env python3
"""Fail closed when requested release and active deployment markers differ."""
import pathlib
import re
import sys

version = sys.argv[1] if len(sys.argv) > 1 else ''
if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', version):
    sys.exit('Expected a 4-component numerical release version.')
root = pathlib.Path(__file__).resolve().parents[1]
project = root / 'src/Jellyfin.Plugin.FranchiseExplorer'
script_id = 'jellyfin-franchise-explorer-my-media-v' + version.replace('.', '')


def require(path, markers):
    content = path.read_text(encoding='utf-8')
    for marker in markers:
        if marker not in content:
            sys.exit(f'Release version marker missing in {path.name}: {marker}. Refusing to publish.')


for field in ('Version', 'AssemblyVersion', 'FileVersion'):
    require(project / 'Jellyfin.Plugin.FranchiseExplorer.csproj', [f'<{field}>{version}</{field}>'])
require(project / 'Api/FranchiseBrowseController.cs', [f'version = "{version}"'])
require(project / 'Web/HomeTileRegistrationService.cs', [
    f'CurrentScriptId = "{script_id}"', f'["pluginVersion"] = "{version}"',
])
require(project / 'Web/franchise-my-media.js', [
    f"window.__franchiseExplorerUiVersion = '{version}'",
    f"window.__franchiseTimelineHomeVersion = '{version}'",
    f"window.__franchiseAutoplayBridgeVersion='{version}'",
    f"setAttribute('data-fe-version','{version}')",
    f"CACHE_PREFIX = 'fe-franchise-home-v{version.replace('.', '')}:'",
])
require(project / 'Configuration/configPage.html', [f'<span class="version">v{version}</span>'])
require(root.parent / '.github/workflows/release.yml', [f"default: '{version}'"])
require(root.parent / 'README.md', [f'v{version}', script_id])
print('Version matches:', version)
