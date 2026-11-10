#!/usr/bin/env python3
"""Missing native IDs stay visible to admins and remain private in public browse.

Runs the production settings modules through build_settings_page.generate() and
the production browse resource against an authenticated, in-memory API fixture.
"""
from pathlib import Path
from urllib.parse import urlsplit
import json

from playwright.sync_api import expect, sync_playwright
from build_settings_page import generate


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Configuration'
gid = lambda value: f'{value:032x}'
native = lambda value: str(value).replace('-', '').lower()
def dashed(value):
    value = native(value)
    return '-'.join((value[:8], value[8:12], value[12:16], value[16:20], value[20:])).upper()


NODE, PHASE, GROUPS, MOVIES, OWN_REF = [gid(value) for value in range(1, 6)]
REFS = [gid(100 + value) for value in range(6)]
MEDIA = [gid(200 + value) for value in range(6)]
NEW = gid(300)


def reference(ident, item_id, title, kind='Movie', **extra):
    return dict(Id=ident, JellyfinItemId=item_id, DisplayName=title, ItemType=kind,
                RangeMode='Full', **extra)


def config_fixture():
    links = [reference(ident, dashed(MEDIA[index]) if index == 0 else MEDIA[index],
                       f'Admin saved title {index + 1}', 'Series' if index == 3 else 'Movie',
                       NodeId=PHASE, Position=index + 1) for index, ident in enumerate(REFS)]
    return dict(NavigationLabel='Franchises', ConfigurationRevision=1, ImdbLists=[],
                Nodes=[dict(Id=NODE, ParentId='', Name='Marvel', NodeType='Franchise', SortOrder=0),
                       dict(Id=PHASE, ParentId=NODE, Name='Phase One', NodeType='Phase', SortOrder=0)],
                Rows=[dict(Id=GROUPS, ParentNodeId=NODE, Name='Phases', Category='Sub Group',
                           RowType='Groups', SortOrder=0, NodeIds=[PHASE], MediaLinkIds=[], Items=[]),
                      dict(Id=MOVIES, ParentNodeId=PHASE, Name='Movies', Category='Movies',
                           RowType='Media', SortOrder=0, NodeIds=[], MediaLinkIds=[REFS[5]],
                           Items=[reference(OWN_REF, MEDIA[0], 'Same native title in a row')])],
                MediaLinks=links, AutoFranchises=dict(Enabled=False, Registry=[], Exclusions=[],
                    PendingChanges=[], Ownership=[]), MediaRecovery=dict(Enabled=True, AutoReconnect=False))


BOOT = r'''
localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
 Id:'fixture',UserId:'admin',AccessToken:'fixture-token',LocalAddress:location.origin}]}));
window.__itemRequests=[];
const fixtureHeaders={Authorization:'MediaBrowser Token="fixture-token"'};
window.ApiClient={
 getCurrentUserId:()=> 'admin', accessToken:()=> 'fixture-token',
 getCurrentUser:async()=>({Policy:{IsAdministrator:true},Configuration:{}}),
 getUrl:(route,query)=>{const url=new URL(route.replace(/^\//,''),location.origin+'/emby/');
   for(const [key,value] of Object.entries(query||{}))url.searchParams.set(key,value);return url.href;},
 getPluginConfiguration:async()=>{const response=await fetch('/emby/MockConfiguration',{headers:fixtureHeaders});return response.json();},
 updatePluginConfiguration:async(_plugin,config)=>{const response=await fetch('/emby/MockConfiguration',{
   method:'POST',headers:{...fixtureHeaders,'Content-Type':'application/json'},body:JSON.stringify(config)});
   if(!response.ok)throw Error('Save failed');},
 getItem:async(_user,id)=>{window.__itemRequests.push(id);const response=await fetch('/emby/Items/'+id,{headers:fixtureHeaders});
   if(!response.ok)throw Error('Native item unavailable');return response.json();},
 getItems:async()=>({Items:[],TotalRecordCount:0})
};
'''


def recovery_fixture():
    candidate = dict(itemId=NEW, title='Actual replacement title', itemType='Movie', year=2026,
                     providerIds=[dict(name='Imdb', value='tt300')], verified=True)
    return dict(revision='configuration-1', libraryRevision='library-1', libraryHealthy=True,
                checkedUtc='2026-11-10T12:00:00Z', enabled=True, autoReconnect=False,
                message='Two references need review.', entries=[
                    dict(referenceId=REFS[0], nodeId=PHASE, rowId='', oldItemId=MEDIA[0],
                         title='Admin saved title 1', itemType='Movie', status='Ambiguous',
                         reason='Identity needs review.', candidates=[]),
                    dict(referenceId=REFS[1], nodeId=PHASE, rowId='', oldItemId=MEDIA[1],
                         title='Admin saved title 2', itemType='Movie', status='Missing',
                         reason='The old native ID is missing.', candidates=[candidate])])


def settings_regression(browser):
    state = dict(config=config_fixture(), recovery=recovery_fixture(), writes=[], requests=[],
                 library={ident: dict(Id=ident, Name=f'Current title {index + 1}',
                                      Type='Series' if index == 3 else 'Movie', ImageTags={})
                          for index, ident in enumerate(MEDIA) if index not in (1, 2)})
    state['library'][NEW] = dict(Id=NEW, Name='Actual replacement title', Type='Movie', ImageTags={})
    page = browser.new_page(viewport={'width': 1280, 'height': 1050})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route(request):
        path = urlsplit(request.request.url).path
        if path == '/settings':
            request.fulfill(content_type='text/html', body=generate().replace(
                '<script type="text/javascript">', '<script>' + BOOT + '</script><script type="text/javascript">', 1))
            return
        if path.startswith('/emby/'):
            assert request.request.headers.get('authorization') == 'MediaBrowser Token="fixture-token"', path
        state['requests'].append((request.request.method, path))
        if request.request.method == 'POST':
            state['writes'].append(path)
        if path == '/emby/MockConfiguration':
            if request.request.method == 'POST':
                state['config'] = json.loads(request.request.post_data)
            request.fulfill(json=state['config'])
        elif path == '/emby/FranchiseExplorer/Automation/Status':
            request.fulfill(json=dict(settings=state['config']['AutoFranchises'], fingerprint='fixture',
                                      running=False, serverTimeZone='UTC', schedule='Daily'))
        elif path in ('/emby/FranchiseExplorer/Recovery/Status', '/emby/FranchiseExplorer/Recovery/Check'):
            request.fulfill(json=state['recovery'])
        elif path == '/emby/FranchiseExplorer/Recovery/Apply':
            body = json.loads(request.request.post_data)
            assert body['choices'] == [dict(referenceId=REFS[1], itemId=NEW)], body
            state['config']['MediaLinks'][1]['JellyfinItemId'] = NEW
            state['config']['ConfigurationRevision'] += 1
            state['recovery']['revision'] = 'configuration-2'
            state['recovery']['entries'] = [state['recovery']['entries'][0]]
            request.fulfill(json=state['recovery'])
        elif path.startswith('/emby/Items/'):
            media = state['library'].get(native(path.rsplit('/', 1)[-1]))
            request.fulfill(json=media) if media else request.fulfill(status=404)
        else:
            request.fulfill(status=404)

    page.route('http://jellyfin.test/**', route)
    page.goto('http://jellyfin.test/settings')
    page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
    page.locator('#franchises').evaluate('(element)=>element.open=true')
    board, current = page.locator('#board'), page.locator('#media-current')
    model = lambda: page.evaluate('FranchiseSettings.getModel()')
    revision = lambda: page.evaluate('FranchiseSettings.getRevision()')
    baseline, original_revision = model(), revision()
    board.locator(f'[data-expand="{NODE}"]').click()
    board.locator(f'[data-expand="{PHASE}"]').click()
    direct = board.locator(f'[data-node-media="{PHASE}"]')
    expect(direct.locator('h4')).to_have_text('Franchise media · 5')
    assert direct.locator('[data-media-item]').evaluate_all('(entries)=>entries.map(entry=>entry.dataset.mediaItem)') == REFS[:5]
    assert direct.locator('.grip,[data-media-row]').count() == 0
    board.locator(f'[data-toggle-row="{MOVIES}"]').click()
    assert board.locator(f'[data-media-item="{REFS[5]}"]').count() == 1
    assert direct.locator(f'[data-media-item="{REFS[5]}"]').count() == 0
    assert page.evaluate('(id)=>__itemRequests.filter(value=>value.replace(/-/g,"").toLowerCase()===id).length', MEDIA[0]) == 1
    missing = direct.locator(f'[data-media-item="{REFS[1]}"]')
    expect(missing.locator('.media-availability')).to_have_text('Unavailable in Jellyfin')
    expect(missing.locator('[data-recover-reference]')).to_be_visible()
    expect(direct.locator(f'[data-media-item="{REFS[0]}"] .media-availability')).to_have_text('Reference needs review')
    for width in (390, 320, 1280):
        page.set_viewport_size({'width': width, 'height': 1050})
        page.wait_for_timeout(80)
        assert direct.locator('.media-entry').evaluate_all('''entries=>entries.every(entry=>{
            const bounds=entry.getBoundingClientRect(),actions=entry.querySelector('.media-actions').getBoundingClientRect();
            return bounds.left>=0&&bounds.right<=innerWidth+1&&actions.right<=bounds.right+1;
        })'''), width

    # Failed lookups can be retried by reopening the tree, without editing data.
    state['library'][MEDIA[2]] = dict(Id=MEDIA[2], Name='Returned native title', Type='Movie', ImageTags={})
    board.locator(f'[data-expand="{PHASE}"]').click()
    board.locator(f'[data-expand="{PHASE}"]').click()
    expect(direct.locator(f'[data-media-item="{REFS[2]}"] .media-availability')).to_be_hidden()
    assert page.evaluate('(id)=>__itemRequests.filter(value=>value===id).length', MEDIA[2]) >= 2

    # Existing direct-link management works from both the tree and popup.
    series = direct.locator(f'[data-media-item="{REFS[3]}"]')
    series.locator('[data-settings-item]').click()
    expect(page.locator('#item-dialog')).to_be_visible()
    expect(page.locator('#item-art-title')).to_have_text('Admin saved title 4')
    page.locator('#item-dialog [data-close="item-dialog"]').first.click()
    series.locator('[data-edit-library-item]').click()
    expect(page.locator('#library-range-dialog')).to_be_visible()
    expect(page.locator('#library-range-title')).to_have_text('Current title 4')
    page.locator('#library-range-dialog [data-close="library-range-dialog"]').first.click()
    missing.locator('[data-remove-item]').click()
    expect(page.locator('#delete-message')).to_contain_text('Admin saved title 2')
    page.locator('#delete-dialog [data-close="delete-dialog"]').first.click()
    board.locator(f'[data-add-node="{PHASE}"]').click()
    assert current.locator('[data-media-item]').count() == 7
    for ident in REFS:
        assert current.locator(f'[data-media-item="{ident}"]').count() == 1
    expect(current.locator(f'[data-media-item="{REFS[1]}"] .media-availability')).to_have_text('Unavailable in Jellyfin')
    assert model() == baseline and revision() == original_revision
    expect(page.locator('#save-state')).to_have_text('All changes saved')
    expect(page.locator('#undo')).to_be_disabled()
    assert not state['writes'], state['writes']

    # Review opens the real recovery dialog; its server apply reloads the model.
    current.locator(f'[data-recover-reference="{REFS[1]}"]').click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    page.locator(f'[data-recovery-choice="{REFS[1]}"]').select_option(NEW)
    page.locator('#recovery-apply').click()
    page.wait_for_function('(args)=>FranchiseSettings.getModel().MediaLinks.find(link=>link.Id===args.ref).JellyfinItemId===args.media',
                           arg=dict(ref=REFS[1], media=NEW))
    page.locator('#recovery-dialog [data-close="recovery-dialog"]').first.click()
    expect(current.locator(f'[data-media-item="{REFS[1]}"] .media-availability')).to_be_hidden()
    assert page.evaluate('(id)=>__itemRequests.includes(id)', NEW)
    assert state['writes'] == ['/emby/FranchiseExplorer/Recovery/Apply'], state['writes']
    assert not errors, errors
    page.close()
    print('Passed: legacy direct links in tree/popup, no mutation/duplicates, actions, missing/review badges, retry and reconnect.')


def catalog_fixture(item_ids):
    refs = [dict(id=gid(500 + index), nodeId=PHASE, itemId=ident, itemType='Movie',
                 displayName=f'Private saved title {index + 1}', rangeMode='Full', position=index)
            for index, ident in enumerate(item_ids)]
    return dict(title='Franchises', nodes=[
        dict(id=NODE, parentId='', name='Marvel', nodeType='Franchise', sortOrder=0, artwork={}),
        dict(id=PHASE, parentId=NODE, name='Phase One', nodeType='Phase', sortOrder=0, artwork={})], links=refs,
        rows=[dict(id=MOVIES, parentNodeId=PHASE, name='Movies', rowType='Media', sortOrder=0,
                   nodeIds=[], mediaLinkIds=[ref['id'] for ref in refs], items=[]),
              dict(id=gid(600), parentNodeId=PHASE, name='Empty row', rowType='Media', sortOrder=1,
                   nodeIds=[], mediaLinkIds=[], items=[])])


def browse_regression(browser):
    state = dict(catalog=catalog_fixture(MEDIA[:5]), library={}, item_requests=[], held=[], hold=False)
    page = browser.new_page(viewport={'width': 1100, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
        Id:'fixture',UserId:'viewer',AccessToken:'viewer-token',LocalAddress:location.origin}]}));""")

    def fulfill_item(request, ident):
        media = state['library'].get(ident)
        request.fulfill(json=media) if media else request.fulfill(status=404)

    def route(request):
        path = urlsplit(request.request.url).path
        if path == '/FranchiseExplorer/Browse':
            request.fulfill(content_type='text/html', body=(CONFIG_DIR / 'browsePage.html').read_text())
        elif path == '/System/Info/Public':
            request.fulfill(json=dict(Id='fixture'))
        elif path == '/FranchiseExplorer/Catalog':
            assert request.request.headers.get('authorization') == 'MediaBrowser Token="viewer-token"'
            request.fulfill(json=state['catalog'])
        elif path.startswith('/Items/') and '/Images/' not in path:
            assert request.request.headers.get('authorization') == 'MediaBrowser Token="viewer-token"'
            ident = native(path.rsplit('/', 1)[-1])
            state['item_requests'].append(ident)
            if state['hold']:
                state['held'].append((request, ident))
            else:
                fulfill_item(request, ident)
        else:
            request.fulfill(status=404)

    page.route('http://jellyfin.test/**', route)
    page.goto('http://jellyfin.test/FranchiseExplorer/Browse')
    root_tile = page.locator('#group-grid .tile')
    expect(root_tile.locator('small')).to_have_text('TV Shows 0 · Movies 0 · Some titles unavailable')
    root_tile.click()
    expect(page.locator('#hero-count')).to_have_text('TV Shows 0 · Movies 0 · Some titles unavailable')
    page.locator('.tile', has=page.get_by_text('Phase One', exact=True)).click()
    shelves = page.locator('#rows-container .shelf')
    expect(shelves.nth(0).locator('.shelf-count')).to_have_text('0 items')
    expect(shelves.nth(0).locator('.shelf-empty')).to_have_text('Titles in this row are unavailable or cannot be accessed with your account.')
    expect(shelves.nth(1).locator('.shelf-empty')).to_have_text('No items assigned to this row yet.')
    assert page.locator('#rows-container .tile').count() == 0
    assert 'Private saved title' not in page.locator('body').inner_text()
    page.locator('#search').fill('absent search')
    expect(shelves.nth(0).locator('.shelf-empty')).to_have_text('No titles match your search in this row.')
    expect(shelves.nth(1).locator('.shelf-empty')).to_have_text('No titles match your search in this row.')
    page.locator('#search').fill('')
    expect(shelves.nth(0).locator('.shelf-empty')).to_contain_text('unavailable')

    # New native IDs become visible on a fresh catalog after reconnection.
    state['catalog']['links'][1]['itemId'] = NEW
    state['library'][NEW] = dict(Id=NEW, Name='Actual replacement title', Type='Movie', ImageTags={})
    page.reload()
    expect(page.locator('#hero-count')).to_have_text('TV Shows 0 · Movies 1 · Some titles unavailable')
    expect(shelves.nth(0).locator('.shelf-count')).to_have_text('1 item')
    expect(shelves.nth(0).locator('.tile')).to_contain_text('Actual replacement title')
    assert 'Private saved title' not in page.locator('body').inner_text()

    # N/D GUID spellings and repeated row membership count the actual title once.
    state['catalog'] = catalog_fixture([NEW, dashed(NEW)])
    state['catalog']['rows'][0]['items'] = [dict(id=OWN_REF, itemId=dashed(NEW), itemType='Series',
        displayName='Private saved title in a row', rangeMode='Full')]
    state['item_requests'].clear()
    page.goto('http://jellyfin.test/FranchiseExplorer/Browse')
    expect(root_tile.locator('small')).to_have_text('TV Shows 0 · Movies 1')
    assert state['item_requests'] == [NEW], state['item_requests']
    root_tile.click()
    expect(page.locator('#hero-count')).to_have_text('TV Shows 0 · Movies 1')

    # Count requests share the same bounded viewer cache as the shelves/artwork.
    state['catalog'] = catalog_fixture([gid(700 + index) for index in range(14)])
    state['item_requests'].clear()
    state['hold'] = True
    page.goto('http://jellyfin.test/FranchiseExplorer/Browse')
    expect(root_tile.locator('small')).to_have_text('Checking available titles…')
    for _ in range(20):
        page.wait_for_timeout(25)
        if len(state['held']) == 6:
            break
    assert len(state['held']) == 6 and len(state['item_requests']) == 6, state['item_requests']
    # Navigate while the old count is pending; stale results must not alter the hero.
    root_tile.click()
    page.locator('.tile', has=page.get_by_text('Phase One', exact=True)).click()
    for batch_size in (6, 6, 2):
        for _ in range(40):
            page.wait_for_timeout(25)
            if len(state['held']) == batch_size:
                break
        assert len(state['held']) == batch_size, (batch_size, len(state['held']))
        held, state['held'] = state['held'], []
        for request, ident in held:
            fulfill_item(request, ident)
    expect(page.locator('#hero-title')).to_have_text('Phase One')
    expect(page.locator('#hero-count')).to_have_text('TV Shows 0 · Movies 0 · Some titles unavailable')
    expect(shelves.nth(0).locator('.shelf-count')).to_have_text('0 items')
    assert len(state['item_requests']) == 14, state['item_requests']
    assert not errors, errors
    page.close()
    print('Passed: public viewer counts/privacy, unavailable/search/empty rows, fresh IDs, N/D dedup and bounded concurrent lookups.')


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium'
            if Path('/usr/bin/chromium').exists() else None, args=['--no-sandbox'])
        try:
            settings_regression(browser)
            browse_regression(browser)
        finally:
            browser.close()


if __name__ == '__main__':
    run()
