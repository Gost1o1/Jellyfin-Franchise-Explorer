#!/usr/bin/env python3
"""Opt-in live IMDb retrieval through the controller and production editor.

Run with .NET 10 on PATH. IMDb is live; Jellyfin library/configuration APIs are
simulated. This check is deliberately separate from the offline CI suite.
"""
from pathlib import Path
from urllib.parse import urlsplit
import json
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NODE, SOURCE_ID, MOVIE, EPISODE, SERIES = [f'{n:032x}' for n in range(1, 6)]


def run():
    with tempfile.TemporaryDirectory() as directory:
        payload = Path(directory) / 'imdb.json'
        subprocess.run(['dotnet', 'run', '--project', str(ROOT / 'tests/AutoAdd.Tests'),
                        '-c', 'Release', '--', '--live', str(payload)], cwd=ROOT, check=True)
        data = json.loads(payload.read_text())
    entries = data['entries']
    movie = next(e for e in entries if e['type'] == 'Movie')
    episode = next(e for e in entries if e['type'] == 'Episode')
    library = [
        dict(Id=MOVIE, Type='Movie', Name=movie['title'], ProductionYear=movie['year'], ProviderIds={'Imdb': movie['imdbId']}),
        dict(Id=EPISODE, Type='Episode', Name=episode['title'], SeriesId=SERIES, ParentIndexNumber=1,
             IndexNumber=1, ProductionYear=episode['year'], ProviderIds={'Imdb': episode['imdbId']}),
        dict(Id=SERIES, Type='Series', Name='Associated show', ProviderIds={})]
    config = dict(Nodes=[dict(Id=NODE, Name='Live IMDb check', ParentId='', AutoAddSources=[dict(
        Id=SOURCE_ID, Url='https://www.imdb.com/list/ls539646485/', Enabled=True, Priority=0,
        Categories=['Chronological Timeline', 'Movies', 'TV Shows', 'Collections'])])], MediaLinks=[], Rows=[])
    boot = '''window.__config=%s;window.__library=%s;window.__saved=null;
window.ApiClient={getCurrentUserId:()=> 'viewer',accessToken:()=> 'fixture-token',
getPluginConfiguration:async()=>structuredClone(__config),
updatePluginConfiguration:async(id,value)=>{__config=structuredClone(value);__saved=structuredClone(value);},
getUrl:(path)=>new URL(path.replace(/^\\//,''),location.origin+'/emby/').href,
getItems:async(uid,q)=>{const all=__library.filter(i=>q.includeItemTypes.split(',').includes(i.Type));
return {Items:structuredClone(all.slice(q.startIndex||0,(q.startIndex||0)+(q.limit||40))),TotalRecordCount:all.length};}};
''' % (json.dumps(config), json.dumps(library))
    html = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium'
            if Path('/usr/bin/chromium').exists() else None, args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route(request):
            path = urlsplit(request.request.url).path
            if path == '/settings':
                request.fulfill(content_type='text/html', body=html.replace('<script type="text/javascript">',
                    '<script>' + boot + '</script><script type="text/javascript">', 1))
            elif path.endswith('/AutoAdd/Source'):
                request.fulfill(json=data)
            else:
                request.fulfill(status=404)

        page.route('http://jellyfin.test/**', route)
        page.goto('http://jellyfin.test/settings')
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        page.locator('#franchises > summary').click()
        page.locator(f'[data-settings-node="{NODE}"]').click()
        page.locator('#franchise-auto-add').click()
        page.locator('#franchise-preview').click()
        expect(page.locator('#review')).to_be_visible(timeout=15000)
        expect(page.locator('#review .count-pill.missing')).to_have_text(f'{len(entries)-2} missing')
        assert page.evaluate('__saved===null'), 'Preview must not save'
        page.locator('#apply-selected').click()
        expect(page.locator('#review')).not_to_be_visible()
        page.locator('#franchise-dialog [data-close="franchise-dialog"]').first.click()
        assert page.evaluate('__saved===null'), 'Review application must remain staged'
        page.locator('#save').click()
        page.wait_for_function('__saved!==null')
        saved = page.evaluate('__saved')
        assert len(saved['MediaLinks']) == 2
        timeline = next(row for row in saved['Rows'] if row['RowType'] == 'Timeline')
        assert len(timeline['MediaLinkIds']) == 2
        imported_episode = next(link for link in saved['MediaLinks'] if link['JellyfinItemId'] == SERIES)
        assert imported_episode['RangeMode'] == 'Episodes'
        tv = next(row for row in saved['Rows'] if row['Category'] == 'TV Shows')
        assert len(tv['Items']) == 1 and tv['Items'][0]['JellyfinItemId'] == SERIES
        assert not errors, errors
        browser.close()
    print(f'PASS LIVE IMDb-to-editor pipeline: {len(entries)} real entries, exact movie/episode matches, '
          'missing titles, staged review and save. Jellyfin library/playback simulated.')


if __name__ == '__main__':
    run()
