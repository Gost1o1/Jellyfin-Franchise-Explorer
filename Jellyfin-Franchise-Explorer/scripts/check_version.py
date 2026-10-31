#!/usr/bin/env python3
"""Fail closed if a manually requested release doesn't match the assembly version."""
import re, sys, pathlib
version=sys.argv[1] if len(sys.argv)>1 else ''
if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+',version):
    sys.exit('Expected a 4-component numerical release version.')
p=pathlib.Path('src/Jellyfin.Plugin.FranchiseExplorer/Jellyfin.Plugin.FranchiseExplorer.csproj')
s=p.read_text()
for field in ('Version', 'AssemblyVersion', 'FileVersion'):
    if f'<{field}>{version}</{field}>' not in s:
        sys.exit(f'Release version differs from the project {field}. Refusing to publish.')
print('Version matches:', version)
