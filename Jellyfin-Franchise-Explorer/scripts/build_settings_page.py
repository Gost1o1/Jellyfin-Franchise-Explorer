#!/usr/bin/env python3
"""Generate Jellyfin's self-contained settings resource from reviewed source modules."""
from pathlib import Path
import argparse
import re

ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT/'src/Jellyfin.Plugin.FranchiseExplorer'
CONFIG=PROJECT/'Configuration'

def generate():
    project=(PROJECT/'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text(encoding='utf-8')
    version=re.search(r'<Version>([^<]+)</Version>',project).group(1)
    result=(CONFIG/'settingsPage.template.html').read_text(encoding='utf-8')
    replacements={
        '{{PLUGIN_VERSION}}':version,
        '{{SETTINGS_CORE}}':(CONFIG/'franchise-settings-core.js').read_text(encoding='utf-8'),
        '{{SETTINGS_ARTWORK}}':(CONFIG/'franchise-settings-artwork.js').read_text(encoding='utf-8'),
        '{{SETTINGS_AUTOMATION}}':(CONFIG/'franchise-settings-automation.js').read_text(encoding='utf-8'),
        '{{SETTINGS_MAIN}}':(CONFIG/'franchise-settings.js').read_text(encoding='utf-8'),
    }
    for marker,content in replacements.items():
        if marker not in result:raise SystemExit('Missing settings template marker: '+marker)
        if '</script' in content.lower() and marker!='{{PLUGIN_VERSION}}':
            raise SystemExit('Settings modules must not contain a script-closing tag: '+marker)
        result=result.replace(marker,content)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Fail if the embedded page needs regeneration.')
    args=parser.parse_args();target=CONFIG/'configPage.html';result=generate()
    if args.check:
        if not target.exists() or target.read_text(encoding='utf-8')!=result:
            raise SystemExit('configPage.html is stale. Run python3 scripts/build_settings_page.py')
        print('Generated settings resource is up to date.')
    else:
        target.write_text(result,encoding='utf-8')
        print('Generated '+str(target.relative_to(ROOT)))

if __name__=='__main__':main()
