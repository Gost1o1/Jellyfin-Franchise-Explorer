#!/usr/bin/env python3
"""CI static guard for web-only My Media feature; not a live Jellyfin test."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
project=root/'src/Jellyfin.Plugin.FranchiseExplorer'
script=(project/'Web/franchise-my-media.js').read_text()
startup=(project/'Web/HomeTileRegistrationService.cs').read_text()
csproj=(project/'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text()
checks={
 'Script embedded': 'EmbeddedResource Include="Web/franchise-my-media.js"' in csproj,
 'Stable Jellyfin plugin GUID': '6bc7820b-7c6d-4e64-a139-dfb90b8d6f42' in (project/'Plugin.cs').read_text(),
 'Match My Media heading': 'My Media' in script,
 'No existing media change': 'placeTile(container,tile)' in script and 'removeChild(ref)' not in script,
 'Idempotent injection': '__franchiseExplorerMyMediaTileLoaded' in script,
 'Supports base path': r"pathname.match(/^(.*?)\/web" in script,
 'Plugin registration via interface': 'IPluginServiceRegistrator' in startup and 'RegisterScript' in startup,
 'Optional registration': 'TryRegister()' in startup and 'catch (Exception ex)' in startup,
 'No plugin-shipped Injector binary': 'Jellyfin.Plugin.JavaScriptInjector' not in csproj,
 'Matching numeric assembly version': bool(re.search(r'<Version>(\d+\.\d+\.\d+\.\d+)</Version>', csproj)) and
     re.search(r'<Version>(\d+\.\d+\.\d+\.\d+)</Version>', csproj).group(1) ==
     re.search(r'<AssemblyVersion>([^<]+)</AssemblyVersion>',csproj).group(1),
}
for title,passed in checks.items():
 assert passed, title
print('My Media tile static checks passed; live Jellyfin still unverified.')
