#!/usr/bin/env python3
"""Basic local/CI structural checks. Does NOT establish runtime compatibility."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess,json,re,shutil,sys,tempfile
root=Path(__file__).resolve().parents[1]
project=root/'src/Jellyfin.Plugin.FranchiseExplorer'
required=[root/'LICENSE', root/'README.md',root/'manifest.json',project/'Plugin.cs',project/'Configuration/PluginConfiguration.cs',project/'Configuration/configPage.html']
for p in required:
    if not p.is_file():sys.exit('Missing required file: '+str(p))
license_text=(root/'LICENSE').read_text(encoding='utf-8')
if not license_text.startswith('PERSONAL AND NONCOMMERCIAL USE LICENSE (DRAFT)'):
    sys.exit('The requested custom license is missing.')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
if not isinstance(manifest,list):sys.exit('Manifest must be a JSON array.')
for item in manifest:
    if not all(k in item for k in ('guid','name','versions')):sys.exit('Invalid manifest item.')
csproj=(project/'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text(encoding='utf-8')
for marker in ('<TargetFramework>net10.0</TargetFramework>','Version="12.2.0"','<EmbeddedResource Include="Configuration/configPage.html"'):
    if marker not in csproj:sys.exit('Expected project setting missing: '+marker)
class Scripts(HTMLParser):
    def __init__(self):super().__init__();self.inscript=False;self.js=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and not dict(attrs).get('src'): self.inscript=True
    def handle_endtag(self,tag):
        if tag=='script':self.inscript=False
    def handle_data(self,data):
        if self.inscript:self.js.append(data)
h=Scripts();h.feed((project/'Configuration/configPage.html').read_text(encoding='utf-8'))
if not h.js:sys.exit('Missing embedded admin JavaScript.')
js=''.join(h.js)
if shutil.which('node'):
    with tempfile.NamedTemporaryFile(mode='w',suffix='.js',encoding='utf-8',delete=False) as f:
        f.write(js); temp=Path(f.name)
    try:subprocess.run(['node','--check',str(temp)],check=True)
    finally:temp.unlink(missing_ok=True)
else:print('Node.js unavailable; JS syntax validation skipped.')
for marker in ('getPluginConfiguration','updatePluginConfiguration','normalize(raw)','replaceChildren'):
    if marker not in js:sys.exit('Expected admin-page behavior missing: '+marker)
print('Static repository checks passed. A Jellyfin host test is still required.')
