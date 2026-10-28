#!/usr/bin/env python3
"""Generate a catalog entry only after GitHub has published a real release ZIP."""
from pathlib import Path
from datetime import datetime,timezone
import argparse, hashlib, json, re, sys
p=argparse.ArgumentParser()
p.add_argument('--version',required=True)
p.add_argument('--archive',type=Path,required=True)
p.add_argument('--repository',required=True)
a=p.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+',a.version):sys.exit('Invalid version')
if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',a.repository):sys.exit('Invalid repo')
if not a.archive.is_file():sys.exit('Release archive missing')
if a.archive.stat().st_size < 1000:sys.exit('Release archive suspiciously small')
with a.archive.open('rb') as f:
    checksum=hashlib.md5(f.read()).hexdigest() # Jellyfin catalog manifests require MD5 here, not SHA256.
name=a.archive.name
url=f'https://github.com/{a.repository}/releases/download/v{a.version}/{name}'
manifest_file=Path('manifest.json')
manifest=json.loads(manifest_file.read_text(encoding='utf-8'))
if not isinstance(manifest,list):sys.exit('Manifest must be a JSON array')
guid='6bc7820b-7c6d-4e64-a139-dfb90b8d6f42'
entry=next((v for v in manifest if v.get('guid')==guid),None)
if entry is None:
    entry={'guid':guid,'name':'Franchise Explorer','overview':'Experimental virtual franchise groups for Jellyfin 12.x (use caution).', 'description':'Unfinished experimental plugin. Virtual franchise hierarchies and item-ID references; no native category or media manipulation.','owner':'Gost1o1','category':'General','versions':[]}
    manifest.append(entry)
versions=entry.setdefault('versions',[])
versions[:]=[v for v in versions if not (v.get('version')==a.version and v.get('targetAbi')=='12.0.0.0')]
versions.insert(0,{'version':a.version,'changelog':f'https://github.com/{a.repository}/releases/tag/v{a.version}', 'targetAbi':'12.0.0.0','sourceUrl':url,'checksum':checksum,'timestamp':datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
manifest_file.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('Manifest updated for actual release archive:',url,'MD5',checksum)
