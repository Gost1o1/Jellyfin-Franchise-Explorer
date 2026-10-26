#!/usr/bin/env python3
"""Tests the offline manifest generator, without publishing anything."""
from pathlib import Path
import hashlib, zipfile, subprocess, sys, tempfile, json, shutil
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
    d=Path(td)
    (d/'manifest.json').write_text('[]\n')
    z=d/'franchise-explorer_0.3.0.0.zip'
    with zipfile.ZipFile(z,'w') as out:
        out.writestr('Jellyfin.Plugin.FranchiseExplorer.dll',b'test-not-a-real-assembly'*100)
    subprocess.run([sys.executable,str(root/'scripts/publish_manifest.py'),'--version','0.3.0.0','--archive',str(z),'--repository','Gost1o1/Jellyfin-Franchise-Explorer'],cwd=d,check=True)
    obj=json.loads((d/'manifest.json').read_text())
    assert obj[0]['versions'][0]['checksum']==hashlib.md5(z.read_bytes()).hexdigest()
    assert obj[0]['versions'][0]['targetAbi']=='12.0.0.0'
    assert obj[0]['versions'][0]['sourceUrl'].endswith(z.name)
    subprocess.run([sys.executable,str(root/'scripts/publish_manifest.py'),'--version','0.3.0.0','--archive',str(z),'--repository','Gost1o1/Jellyfin-Franchise-Explorer'],cwd=d,check=True)
    obj=json.loads((d/'manifest.json').read_text())
    assert len(obj)==1 and len(obj[0]['versions'])==1, 'manifest should not duplicate same release'
print('Offline smoke tests passed (manifest generator and checksum)')
