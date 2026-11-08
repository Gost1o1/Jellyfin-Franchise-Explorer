"""Read-only episode-format presentation using the actual Browse and timeline clients."""
from pathlib import Path
from urllib.parse import urlsplit
import copy
import json
import re
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer'
HTML = (PROJECT / 'Configuration/browsePage.html').read_text()
CLIENT = (PROJECT / 'Web/franchise-timeline.js').read_text()
gid = lambda value: f'{value:032x}'
NODE, ROW, TV_ROW, SHOW, MOVIE, USER = map(gid, range(1, 7))
SHOW_ITEM = dict(Id=SHOW, Type='Series', Name='Example Show', ImageTags={})
MOVIE_ITEM = dict(Id=MOVIE, Type='Movie', Name='Movie between episodes', ImageTags={})
EPISODES = [dict(Id=gid(100 + number), Type='Episode', Name=f'Episode {number}',
    SeriesId=SHOW, SeriesName='Example Show', ParentIndexNumber=1, IndexNumber=number,
    ImageTags={}, RunTimeTicks=100000000) for number in range(1, 6)]
ITEMS = {item['Id']: item for item in [SHOW_ITEM, MOVIE_ITEM, *EPISODES]}


def catalog_for(kind):
    singleton = kind in ('series-individual', 'series-default')
    gap = kind == 'legacy-gap'
    cross_season = kind == 'series-cross-season'
    order = EPISODES[:3] if singleton else [EPISODES[0], EPISODES[2]] if gap else [
        *EPISODES[:3], MOVIE_ITEM, *EPISODES[3:]]
    if kind == 'legacy-individual':
        order = EPISODES[:3]
    if cross_season:
        order = [EPISODES[0]]
    links = []
    for index, item in enumerate(order):
        ref = dict(id=gid(200 + index), nodeId=NODE, itemId=item['Id'],
                   itemType=item['Type'], rangeMode='Full')
        if singleton or cross_season:
            ref.update(itemId=SHOW, itemType='Series', rangeMode='Episodes',
                startSeason=1, endSeason=2 if cross_season else 1,
                startEpisode=item['IndexNumber'], endEpisode=16 if cross_season else item['IndexNumber'])
        links.append(ref)
    rows = [dict(id=ROW, parentNodeId=NODE, name='Chronological Order', rowType='Timeline',
        category='Chronological Order', autoAddCategory='Chronological Timeline',
        mediaLinkIds=[ref['id'] for ref in links], mediaOrder=[ref['id'] for ref in links],
        items=[]), dict(id=TV_ROW, parentNodeId=NODE, name='TV Shows', rowType='Media',
        category='TV Shows', autoAddCategory='TV Shows',
        mediaLinkIds=[ref['id'] for ref in links if ref['itemType'] != 'Movie'],
        mediaOrder=[ref['id'] for ref in links if ref['itemType'] != 'Movie'], items=[])]
    if kind in ('series-individual', 'legacy-individual'):
        rows[0]['episodeFormat'] = 'Individual'
        # The global choice must not ungroup the TV-show shelf.
        rows[1]['episodeFormat'] = 'Individual'
    catalog = dict(title='Franchises', nodes=[dict(id=NODE, parentId='', name='Example franchise',
        nodeType='Franchise', sortOrder=0, artwork={})], links=links, rows=rows)
    keys = [f'{ref["id"]}:{item["Id"]}' for ref, item in zip(links, order)]
    state = dict(rowId=ROW, parentNodeId=NODE, name='Chronological Order', playbackMode='paused',
        total=len(keys), index=min(1, len(keys) - 1), queueKeys=keys, completedKeys=keys[:1],
        queueSourceItemIds=[SHOW if singleton or cross_season else item['Id'] for item in order],
        queueSeasons=[item.get('ParentIndexNumber', 0) for item in order],
        queueEpisodes=[item.get('IndexNumber', 0) for item in order],
        queueLengths=[100000000] * len(keys), positionTicks=12345)
    return catalog, state


def run():
    # These hooks expose snapshots only; all rendering, resolution and progress
    # decoration still run through the shipped production code.
    client = CLIENT + '''\n(() => {
      const original = FranchiseTimeline.TimelineManager.prototype.load;
      FranchiseTimeline.TimelineManager.prototype.load = async function(...args) {
        await original.apply(this,args); window.__timelineForPresentationTest = this;
      };
    })();'''
    html = HTML.replace('  void init();',
        '  window.__catalogForPresentationTest=()=>structuredClone(catalog);\n  void init();')
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        try:
            for width in (390, 1280):
                for kind in ('series-individual', 'series-default', 'legacy-individual',
                             'legacy-bundles', 'legacy-gap', 'series-cross-season'):
                    catalog, state = catalog_for(kind)
                    original_catalog, original_state = copy.deepcopy(catalog), copy.deepcopy(state)
                    mutations = []
                    context = browser.new_context(viewport={'width': width, 'height': 950})
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))

                    def respond(route):
                        request = route.request
                        path = urlsplit(request.url).path
                        if request.method not in ('GET', 'HEAD'):
                            mutations.append((request.method, request.url))
                        if path.endswith('/Browse'):
                            route.fulfill(content_type='text/html', body=html)
                            return
                        if path.endswith('/TimelineClient.js'):
                            route.fulfill(content_type='text/javascript', body=client)
                            return
                        if path.endswith('/web/'):
                            route.fulfill(content_type='text/html', body='<main>Jellyfin show details</main>')
                            return
                        if path.endswith('/System/Info/Public'):
                            value = {'Id': 'server'}
                        elif path.endswith('/Catalog'):
                            value = catalog
                        elif '/TimelineState' in path:
                            value = [state]
                        elif '/Sessions' in path:
                            value = []
                        elif '/Items/' in path:
                            value = ITEMS.get(path.rsplit('/', 1)[-1])
                        else:
                            route.fulfill(status=404, body='')
                            return
                        route.fulfill(content_type='application/json', body=json.dumps(value))

                    page.route('http://jellyfin.test/**', respond)
                    page.add_init_script("localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:["
                        + json.dumps(dict(Id='server', UserId=USER, AccessToken='mock',
                            ManualAddress='http://jellyfin.test')) + "]}))")
                    page.goto('http://jellyfin.test/FranchiseExplorer/Browse')
                    page.get_by_role('button', name='Example franchise').click()
                    chronological = page.get_by_role('region', name='Chronological Order titles', exact=True)
                    tv = page.get_by_role('region', name='TV Shows titles', exact=True)
                    expected_count = 1 if kind == 'series-cross-season' else 2 if kind == 'legacy-gap' else 3
                    expect(chronological.locator('.tile')).to_have_count(expected_count)
                    expect(tv.locator('.tile')).to_have_count(1)
                    captions = chronological.locator('.tile .tag').all_text_contents()
                    if kind == 'legacy-bundles':
                        assert captions == ['S01E01–S01E03', 'Movie', 'S01E04–S01E05'], captions
                        assert '1 of 3 watched' in chronological.inner_text()
                    elif kind == 'legacy-gap':
                        assert captions == ['S01E01', 'S01E03'], captions
                    elif kind == 'series-cross-season':
                        assert captions == ['S01E01–S02E16'], captions
                    else:
                        assert captions == ['S01E01', 'S01E02', 'S01E03'], captions
                        # This also verifies original legacy episode IDs still find their
                        # watched progress after their presentation becomes a singleton.
                        assert '1 of 1 watched' in chronological.locator('.tile').first.inner_text()
                    assert not re.search(r'S01E0[123]–S01E0[123]', chronological.inner_text()) if kind != 'legacy-bundles' else True
                    assert 'S01E' not in tv.inner_text(), tv.inner_text()
                    assert page.evaluate('__catalogForPresentationTest()') == original_catalog
                    assert page.evaluate('(row) => __timelineForPresentationTest.getState(row)', ROW) == original_state
                    assert catalog == original_catalog and state == original_state
                    assert not mutations, mutations
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
                    tv.locator('.tile').first.click()
                    page.wait_for_url('**/web/**')
                    assert 'details?id=' + SHOW in page.url and 'feAutoPlay' not in page.url
                    assert not mutations, mutations
                    context.close()
                print(f'PASS episode presentation {width}px: singleton labels, individual legacy rows, bundles, gaps, movie order and TV grouping')
        finally:
            browser.close()
    assert not errors, errors
    print('PASS read-only catalog references, timeline cursor/position/completed keys and no API writes')


if __name__ == '__main__':
    run()
