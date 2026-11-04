#!/usr/bin/env python3
"""Guard unique release tags and current Injector/version migration."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
repo = root.parent
project = root / 'src/Jellyfin.Plugin.FranchiseExplorer'
csproj = (project / 'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text()
service = (project / 'Web/HomeTileRegistrationService.cs').read_text()
script = (project / 'Web/franchise-my-media.js').read_text()
browse = (project / 'Configuration/browsePage.html').read_text()
config = (project / 'Configuration/configPage.html').read_text()
release = (repo / '.github/workflows/release.yml').read_text()

for field in ('Version', 'AssemblyVersion', 'FileVersion'):
    assert f'<{field}>0.8.9.22</{field}>' in csproj
assert 'CurrentScriptId = "jellyfin-franchise-explorer-my-media-v08922"' in service
assert '"jellyfin-franchise-explorer-my-media-v08918"' in service, 'The previous v0.8.9.18 Injector entry must be retired after upgrade'
assert '"jellyfin-franchise-explorer-my-media-v08917"' in service, 'The previous v0.8.9.17 Injector entry must be retired after upgrade'
assert '"jellyfin-franchise-explorer-my-media-v08916"' in service, 'The previous v0.8.9.16 Injector entry must be retired after upgrade'
assert '"jellyfin-franchise-explorer-my-media-v08914"' in service
assert '"jellyfin-franchise-explorer-my-media-v08913"' in service
assert '"jellyfin-franchise-explorer-my-media-v0899"' in service
assert '["pluginVersion"] = "0.8.9.22"' in service
assert "window.__franchiseExplorerUiVersion = '0.8.9.22'" in script
assert "CACHE_PREFIX = 'fe-franchise-home-v08922:'" in script
assert "widget.setAttribute('data-fe-version','0.8.9.22')" in script
assert "Hide franchise Continue Watching and Next Up from main menu" in config
assert 'id="fe-native-rows"' not in browse
assert 'id="hide-native"' in config
assert 'id="subtitles"' in config
assert 'id="save"' in config and 'id="media-dialog"' in config
assert 'TILE_ART_DATA = \'__FE_TILE_ART_DATA_URL__\'' in script
assert 'script.Replace("__FE_TILE_ART_DATA_URL__", url' in service
assert '.fe-resume-art img{width:100%;height:100%;position:absolute;inset:0;object-fit:contain' in script
assert '.fe-resume-art.fe-resume-landscape::before' in script
assert "cover.classList.toggle('fe-resume-landscape',!usesPoster)" in script
assert "document.querySelector('.hero').classList.toggle('hidden',!selected)" in browse
assert "text($('brand-title'),'Franchise Explorer')" in browse
assert "localStorage.getItem('fe-subtitles:'+this.context.serverId+':'+this.context.userId)" in (project / 'Web/franchise-timeline.js').read_text()
assert 'franchise-tile-backdrop.webp' in csproj and (project / 'Web/franchise-tile-backdrop.webp').is_file()
assert "default: '0.8.9.22'" in release
assert 'Verify requested release version before browser tests' in release
assert release.index('run: python3 scripts/check_version.py "$RELEASE_VERSION"') < release.index('python -m pip install playwright')
assert 'gh release view "v${RELEASE_VERSION}"' in release
assert release.index('gh release view "v${RELEASE_VERSION}"') < release.index('dotnet build')
assert 'gh release create "v${RELEASE_VERSION}"' in release
assert '--clobber' not in release
assert 'v0.8.9.22' in (repo / 'README.md').read_text()
assert (root / 'docs/UPGRADE_V08915.md').is_file()
print('v0.8.9.22 release version and duplicate-tag guard contract passed.')
