#!/usr/bin/env python3
"""CI checks exact expected repository paths, especially hidden GitHub workflows.
File presence is not evidence of successful .NET compilation or live playback.
"""
from pathlib import Path
project_root = Path(__file__).resolve().parents[1]
repo_root = project_root.parent
listing = project_root/'docs/EXPECTED_SOURCE_FILES.txt'
if not listing.exists(): raise SystemExit('Missing expected-source inventory')
paths = [x.strip() for x in listing.read_text(encoding='utf-8').splitlines()
         if x.strip() and not x.startswith('#')]
missing = [path for path in paths if not (repo_root/path).is_file()]
if missing: raise SystemExit('Expected files absent from GitHub checkout:\n'+'\n'.join(missing))
if len(paths) != len(set(paths)): raise SystemExit('Duplicate inventory paths')
print(f'All {len(paths)} required repository source files exist, including GitHub workflows.')
