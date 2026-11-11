#!/usr/bin/env python3
"""Exercise the recovery library picker through the production settings page.

The fixture deliberately stores Winter Soldier as Series although Jellyfin has
a Movie. Only an explicit library choice may correct that saved type. Automatic
passes are server owned and may reconnect only an exact same-type match.
"""
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import os
import re

from playwright.sync_api import expect, sync_playwright

from build_settings_page import generate
from test_recovery_attention_browser import BOOT, Fixture as AttentionFixture, TOKEN


ORIGIN = 'http://jellyfin.test'
ARTIFACTS = Path(os.environ.get('RECOVERY_PICKER_ARTIFACTS',
                             '/workspace/artifacts/recovery-picker30'))
gid = lambda value: f'{value:032x}'
NODE, WRONG_TYPE, PARTIAL, EXACT = [gid(value) for value in (1, 11, 12, 13)]
REFS = [WRONG_TYPE, PARTIAL, EXACT]
OLD = {reference: gid(100 + index) for index, reference in enumerate(REFS)}
MOVIE, PARTIAL_MOVIE, EXACT_MOVIE = [gid(value) for value in (201, 202, 203)]
TITLE = 'Captain America: The Winter Soldier'
TITLES = {WRONG_TYPE: TITLE, PARTIAL: 'Captain America', EXACT: 'New clear library match'}
AUTO_PATH = '/emby/FranchiseExplorer/Recovery/Auto'
LIBRARY_PATH = '/emby/FranchiseExplorer/Recovery/Library'


def config_fixture():
    return dict(
        NavigationLabel='Franchises', ConfigurationRevision=1, ImdbLists=[], Rows=[],
        FutureField={'progressReferenceIds': REFS[:], 'retained': True},
        Nodes=[dict(Id=NODE, ParentId='', Name='Marvel franchise', NodeType='Franchise',
                    Overview='Saved franchise overview', SortOrder=0, Artwork={},
                    AutoAddSources=[], AutoAddRows=[], AutoAddRecords=[])],
        MediaLinks=[dict(Id=reference, NodeId=NODE, JellyfinItemId=OLD[reference],
                         DisplayName=TITLES[reference], ItemType='Series' if reference == WRONG_TYPE else 'Movie',
                         RangeMode='Full', ViewingOrder='Custom', Position=index + 1,
                         Artwork={'PrimaryUrl': '/emby/saved-reference-art'},
                         FutureReferenceField={'retained': reference})
                    for index, reference in enumerate(REFS)],
        MediaRecovery=dict(Enabled=True, AutoReconnect=True),
        AutoFranchises=dict(Enabled=False, Registry=[], Exclusions=[], PendingChanges=[],
                           Ownership=[], LastRun=None, LastCompletedLocalDay=''))


def library_fixture():
    return [
        dict(Id=MOVIE, Name=TITLE, Type='Movie', ProductionYear=2014,
             ProviderIds={'Imdb': 'tt1843866', 'Tmdb': '100402'}),
        dict(Id=PARTIAL_MOVIE, Name='Captain America: Civil War', Type='Movie',
             ProductionYear=2016, ProviderIds={'Imdb': 'tt3498820'}),
        dict(Id=EXACT_MOVIE, Name=TITLES[EXACT], Type='Movie', ProductionYear=2026, ProviderIds={}),
        *[dict(Id=gid(300 + index), Name=f'Library item {index:02}',
               Type=('Movie', 'Series', 'BoxSet')[index % 3],
               ProductionYear=1980 + index % 40, ProviderIds={}) for index in range(65)],
        dict(Id=gid(900), Name='<img src=x onerror="window.__unsafe=true">' + 'Long title ' * 12,
             Type='Movie', ProductionYear=2000, ProviderIds={'Imdb': 'long-value-' * 24}),
    ]


class Fixture(AttentionFixture):
    def __init__(self, browser, html, *, auto_enabled=True, can_search=True, width=1280):
        super().__init__(browser, html, can_search=can_search)
        self.config = config_fixture()
        self.config['MediaRecovery']['AutoReconnect'] = auto_enabled
        self.library = library_fixture()
        self.library_revision = 'library-1'
        self.ready = False
        self.auto_counts = []
        self.library_queries = []
        self.config_reads = 0
        self.library_error = ''
        self.auto_error = ''
        self.status_message = 'Only explicit choices can correct a saved media type.'
        self.hold_library = False
        self.held_library = []
        self.page.set_viewport_size({'width': width, 'height': 1000})

    def references(self):
        return self.config['MediaLinks']

    def candidate(self, identifier):
        item = next(item for item in self.library if item['Id'] == identifier)
        return dict(itemId=item['Id'], title=item['Name'], itemType=item['Type'],
                    year=item['ProductionYear'], verified=False,
                    providerIds=[dict(name=name, value=value) for name, value in item['ProviderIds'].items()])

    def status(self):
        entries = []
        for reference in self.references():
            identifier = reference['Id']
            healthy = reference['JellyfinItemId'] in (MOVIE, PARTIAL_MOVIE, EXACT_MOVIE)
            ready = identifier == EXACT and self.ready and not healthy
            entries.append(dict(
                referenceId=identifier, rowId='', nodeId=NODE,
                oldItemId=reference['JellyfinItemId'], title=reference['DisplayName'],
                itemType=reference['ItemType'], status='Healthy' if healthy else 'Verified' if ready else 'ManualReview',
                reason='The saved item is available.' if healthy else
                       'One exact title and type match.' if ready else
                       'Choose the actual library item. A title fragment or different type is not an automatic match.',
                canAutoRemap=ready, matchMethod='Exact title and type' if ready else '',
                candidates=[self.candidate(EXACT_MOVIE)] if ready else []))
        healthy_count = sum(entry['status'] == 'Healthy' for entry in entries)
        return dict(revision=f"configuration-{self.config['ConfigurationRevision']}",
                    libraryRevision=self.library_revision, enabled=True,
                    autoReconnect=self.config['MediaRecovery']['AutoReconnect'],
                    libraryHealthy=True, canSearch=self.can_search,
                    checkedUtc='2026-11-11T00:10:00Z', referenceCount=len(entries),
                    healthyCount=healthy_count, attentionCount=len(entries) - healthy_count,
                    message=self.status_message, entries=entries)

    def library_result(self, query):
        items = self.library
        item_type = query.get('itemType', [''])[0]
        if item_type and item_type != 'All':
            assert item_type in ('Movie', 'Series', 'BoxSet', 'Episode')
            items = [item for item in items if item['Type'] == item_type]
        title = query.get('query', [''])[0]
        if title:
            items = [item for item in items if title.casefold() in item['Name'].casefold()]
        start = int(query.get('startIndex', ['0'])[0])
        limit = int(query.get('limit', ['30'])[0])
        assert start >= 0 and 1 <= limit <= 50
        return dict(items=[self.candidate(item['Id']) for item in items[start:start + limit]],
                    totalRecordCount=len(items), startIndex=start, limit=limit)

    def route(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        path = parsed.path
        if path == '/settings':
            boot = 'window.__library=' + json.dumps(self.library) + ';' + BOOT.replace(
                "getCurrentUserId:()=> 'admin',", "serverAddress:()=> location.origin+'/emby', getCurrentUserId:()=> 'admin',")
            route.fulfill(content_type='text/html', body=self.html.replace(
                '<script type="text/javascript">', '<script>' + boot +
                '</script><script type="text/javascript">', 1))
            return
        if path.endswith('-art'):
            route.fulfill(status=404)
            return
        if path.startswith('/emby/'):
            assert request.headers.get('authorization') == TOKEN, path
        self.requests.append((request.method, path))
        if request.method == 'POST':
            self.writes.append(path)
        if path == '/emby/MockConfiguration':
            assert request.method == 'GET', 'Recovery must reload the server configuration, never save a browser reconstruction.'
            self.config_reads += 1
            route.fulfill(json=self.config)
        elif path.endswith('/Automation/Status'):
            route.fulfill(json=dict(settings=self.config['AutoFranchises'], fingerprint='automation-1', running=False))
        elif path.endswith('/Recovery/Status'):
            route.fulfill(json=self.status())
        elif path == AUTO_PATH:
            assert request.method == 'POST'
            assert not request.post_data or request.post_data_json == {}
            if self.auto_error:
                route.fulfill(status=503, json={'error': self.auto_error})
                return
            changed = 0
            for reference in self.references():
                if reference['Id'] == EXACT and self.ready and reference['JellyfinItemId'] == OLD[EXACT]:
                    assert reference['ItemType'] == 'Movie'
                    reference['JellyfinItemId'] = EXACT_MOVIE
                    changed += 1
            if changed:
                self.config['ConfigurationRevision'] += 1
            self.auto_counts.append(changed)
            route.fulfill(json=dict(status=self.status(), remappedCount=changed))
        elif path in (LIBRARY_PATH, '/emby/FranchiseExplorer/Recovery/Candidates'):
            assert request.method == 'GET'
            query = parse_qs(parsed.query, keep_blank_values=True)
            assert query['referenceId'][0] in REFS
            assert query['revision'] == [self.status()['revision']]
            assert query['libraryRevision'] == [self.library_revision]
            if path == LIBRARY_PATH:
                assert self.can_search
                self.library_queries.append(deepcopy(query))
                result = self.library_result(query)
                if self.library_error:
                    route.fulfill(status=503, json={'error': self.library_error})
                elif self.hold_library:
                    self.held_library.append((route, result))
                else:
                    route.fulfill(json=result)
            else:
                self.queries.append((query['referenceId'][0], query.get('query', [''])[0]))
                route.fulfill(json=[self.candidate(MOVIE)])
        elif path.endswith('/Recovery/Apply'):
            assert request.method == 'POST'
            body = request.post_data_json
            assert body['revision'] == self.status()['revision']
            assert body['libraryRevision'] == self.library_revision
            if self.apply_error:
                route.fulfill(status=503, json={'error': self.apply_error})
                return
            self.applied.append(deepcopy(body['choices']))
            for choice in body['choices']:
                reference = next(item for item in self.references() if item['Id'] == choice['referenceId'])
                candidate = self.candidate(choice['itemId'])
                different_type = reference['ItemType'] != candidate['itemType']
                assert choice.get('correctItemType', False) == different_type
                reference['JellyfinItemId'] = choice['itemId']
                if different_type:
                    reference['ItemType'] = candidate['itemType']
            self.config['ConfigurationRevision'] += 1
            route.fulfill(json=self.status())
        else:
            route.fulfill(status=404)

    def review(self):
        super().review()
        expect(self.entry(WRONG_TYPE)).to_be_visible()
        expect(self.page.locator('#recovery-refresh')).to_be_enabled()

    def browse(self, reference=WRONG_TYPE):
        self.entry(reference).locator('[data-recovery-browse]').click()
        expect(self.entry(reference).locator('[data-recovery-library-choose]').first).to_be_visible()
        return self.entry(reference)

    def picker(self, reference=WRONG_TYPE):
        return self.entry(reference)


def assert_open_link(entry, identifier):
    link = entry.locator(f'[data-recovery-open="{identifier}"]').first
    expect(link).to_have_text('Open in Jellyfin')
    parsed = urlsplit(link.get_attribute('href'))
    assert (parsed.scheme, parsed.netloc) == ('http', 'jellyfin.test')
    assert parsed.path.startswith('/emby/')
    assert parse_qs(parsed.fragment.partition('?')[2]).get('id', []) == [identifier]
    assert not parsed.query and not parsed.username and not parsed.password
    assert 'fixture-token' not in link.get_attribute('href')
    assert link.get_attribute('target') == '_blank'
    assert {'noopener', 'noreferrer'} <= set((link.get_attribute('rel') or '').split())


def check_browse_and_correct_type(browser, html):
    fixture = Fixture(browser, html)
    before = deepcopy(fixture.config)
    fixture.open()
    assert fixture.writes == [], 'Background status must remain read-only.'
    reads = fixture.config_reads
    fixture.review()
    assert fixture.auto_counts == [0]
    assert fixture.config_reads > reads
    assert fixture.config == before, 'Cross-type and partial titles must remain unresolved after Auto.'
    entry = fixture.browse()
    query = fixture.library_queries[-1]
    assert query.get('query', ['']) == ['']
    assert query.get('itemType', ['']) in ([''], ['All'])
    assert query.get('startIndex', ['0']) == ['0']
    assert query.get('limit', ['30']) == ['30']
    expect(entry.locator('[data-recovery-library-query]')).to_have_value('')
    expect(entry.locator('[data-recovery-library-choose]')).to_have_count(30)
    expect(entry).to_contain_text(TITLE)
    expect(entry).to_contain_text('2014')
    expect(entry).to_contain_text('tt1843866')
    assert_open_link(entry, MOVIE)
    expect(entry.locator('[data-recovery-library-previous]')).to_be_disabled()
    entry.locator('[data-recovery-library-next]').click()
    expect(entry.locator(f'[data-recovery-library-choose="{MOVIE}"]')).to_have_count(0)
    assert fixture.library_queries[-1]['startIndex'] == ['30']
    entry.locator('[data-recovery-library-previous]').click()
    expect(entry.locator(f'[data-recovery-library-choose="{MOVIE}"]')).to_be_visible()
    entry.locator('[data-recovery-library-type]').select_option('Series')
    expect(entry.locator(f'[data-recovery-library-choose="{MOVIE}"]')).to_have_count(0)
    assert fixture.library_queries[-1]['itemType'] == ['Series']
    assert fixture.library_queries[-1].get('startIndex', ['0']) == ['0']
    entry.locator('[data-recovery-library-type]').select_option('Movie')
    expect(entry.locator(f'[data-recovery-library-choose="{MOVIE}"]')).to_be_visible()
    entry.locator('[data-recovery-library-query]').fill('Winter Soldier')
    entry.locator('[data-recovery-library-search]').click()
    expect(entry.locator('[data-recovery-library-choose]')).to_have_count(1)
    assert fixture.library_queries[-1]['query'] == ['Winter Soldier']
    entry.locator(f'[data-recovery-library-choose="{MOVIE}"]').click()
    expect(entry.locator('[data-recovery-choice]')).to_have_value(MOVIE)
    expect(fixture.page.locator('#recovery-apply')).to_be_enabled()
    assert fixture.applied == [] and fixture.config == before
    fixture.page.locator('#recovery-apply').click()
    expect(fixture.page.locator('[data-recovery-entry]')).to_have_count(2)
    assert fixture.applied == [[dict(referenceId=WRONG_TYPE, itemId=MOVIE, correctItemType=True)]]
    expected = deepcopy(before)
    expected['MediaLinks'][0].update(JellyfinItemId=MOVIE, ItemType='Movie')
    expected['ConfigurationRevision'] = fixture.config['ConfigurationRevision']
    assert fixture.config == expected
    fixture.page.wait_for_function('(id)=>FranchiseSettings.getModel().MediaLinks[0].JellyfinItemId===id', arg=MOVIE)
    assert fixture.page.evaluate('FranchiseSettings.getModel().MediaLinks[0].ItemType') == 'Movie'
    # A same-type manual choice reconnects without requesting a type correction.
    entry = fixture.browse(PARTIAL)
    entry.locator('[data-recovery-library-query]').fill('Civil War')
    entry.locator('[data-recovery-library-query]').press('Enter')
    expect(entry.locator('[data-recovery-library-choose]')).to_have_count(1)
    entry.locator(f'[data-recovery-library-choose="{PARTIAL_MOVIE}"]').click()
    fixture.page.locator('#recovery-apply').click()
    expect(fixture.page.locator('[data-recovery-entry]')).to_have_count(1)
    assert fixture.applied[-1] == [dict(referenceId=PARTIAL, itemId=PARTIAL_MOVIE)]
    expected['MediaLinks'][1]['JellyfinItemId'] = PARTIAL_MOVIE
    expected['ConfigurationRevision'] = fixture.config['ConfigurationRevision']
    assert fixture.config == expected
    fixture.finish()


def check_find_uses_fresh_automatic_pass(browser, html):
    fixture = Fixture(browser, html)
    fixture.open()
    fixture.review()
    fixture.ready = True  # A completed library scan discovers a safe same-type match.
    fixture.entry(EXACT).locator('[data-recovery-search]').click()
    fixture.page.wait_for_function('(id)=>FranchiseSettings.getModel().MediaLinks[2].JellyfinItemId===id', arg=EXACT_MOVIE)
    expect(fixture.entry(EXACT)).to_have_count(0)
    assert fixture.auto_counts == [0, 1]
    assert fixture.queries == [] and fixture.applied == []
    assert fixture.config['MediaLinks'][0]['JellyfinItemId'] == OLD[WRONG_TYPE]
    assert fixture.config['MediaLinks'][1]['JellyfinItemId'] == OLD[PARTIAL]
    fixture.entry(WRONG_TYPE).locator('[data-recovery-search]').click()
    expect(fixture.entry(WRONG_TYPE).locator(f'option[value="{MOVIE}"]')).to_have_count(1)
    assert fixture.queries == [(WRONG_TYPE, TITLE)]
    assert fixture.auto_counts == [0, 1, 0]
    assert fixture.config['MediaLinks'][0]['ItemType'] == 'Series'
    assert fixture.applied == []
    fixture.finish()


def check_errors_and_dirty_draft(browser, html):
    fixture = Fixture(browser, html, auto_enabled=False)
    fixture.open()
    fixture.review()
    entry = fixture.browse()
    entry.locator(f'[data-recovery-library-choose="{MOVIE}"]').click()
    entry.locator('[data-recovery-query]').fill('Preserved manual candidate query')
    entry.locator('[data-recovery-library-query]').fill('Preserved picker query')
    fixture.library_error = 'Library browse unavailable. Saved choices retained.'
    entry.locator('[data-recovery-library-search]').click()
    error = fixture.page.locator('#recovery-dialog-error')
    expect(error).to_be_visible()
    expect(error).to_contain_text('Library browse unavailable')
    expect(entry.locator('[data-recovery-choice]')).to_have_value(MOVIE)
    expect(entry.locator('[data-recovery-query]')).to_have_value('Preserved manual candidate query')
    expect(entry.locator('[data-recovery-library-query]')).to_have_value('Preserved picker query')
    assert fixture.writes == []
    fixture.library_error = ''
    fixture.page.locator('#recovery-refresh').click()
    expect(error).to_be_hidden()
    fixture.apply_error = 'Recovery changed. Refresh before reconnecting.'
    fixture.page.locator('#recovery-apply').click()
    expect(error).to_contain_text('Recovery changed')
    expect(entry.locator('[data-recovery-choice]')).to_have_value(MOVIE)
    assert fixture.config['MediaLinks'][0]['JellyfinItemId'] == OLD[WRONG_TYPE]
    fixture.finish()

    fixture = Fixture(browser, html)
    fixture.open()
    fixture.draft('Unsaved picker draft')
    draft = fixture.page.evaluate('FranchiseSettings.getModel()')
    fixture.review()
    expect(fixture.page.locator('#recovery-dialog-status')).to_contain_text(re.compile('save|reload|draft', re.I))
    fixture.browse()
    fixture.entry(WRONG_TYPE).locator(f'[data-recovery-library-choose="{MOVIE}"]').click()
    expect(fixture.page.locator('#recovery-apply')).to_be_disabled()
    fixture.entry(WRONG_TYPE).locator('[data-recovery-search]').click()
    expect(fixture.entry(WRONG_TYPE).locator(f'option[value="{MOVIE}"]')).to_have_count(1)
    assert fixture.writes == [] and fixture.auto_counts == []
    assert fixture.page.evaluate('FranchiseSettings.getModel()') == draft
    expect(fixture.page.locator('#save-state')).to_have_text('Unsaved changes')
    fixture.finish()


def check_mobile(browser, html):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    for width in (320, 390):
        fixture = Fixture(browser, html, width=width)
        fixture.open()
        fixture.review()
        entry = fixture.browse()
        entry.locator('[data-recovery-library-query]').fill('Winter Soldier')
        entry.locator('[data-recovery-library-search]').click()
        expect(entry.locator('[data-recovery-library-choose]')).to_have_count(1)
        if width == 390:
            entry.locator('.recovery-library-heading').evaluate("(el)=>el.scrollIntoView({block:'start'})")
            fixture.page.screenshot(path=str(ARTIFACTS / 'recovery-picker-library-390.png'), full_page=True)
        entry.locator(f'[data-recovery-library-choose="{MOVIE}"]').click()
        expect(entry.locator('.recovery-type-correction')).to_contain_text('Selected library type: Movie')
        entry.locator('.recovery-type-correction').scroll_into_view_if_needed()
        fixture.page.screenshot(path=str(ARTIFACTS / f'recovery-picker-correction-{width}.png'), full_page=True)
        entry.locator('[data-recovery-library-query]').fill('Long title')
        entry.locator('[data-recovery-library-search]').click()
        expect(entry.locator('[data-recovery-library-choose]')).to_have_count(1)
        expect(entry).to_contain_text('<img src=x onerror="window.__unsafe=true">')
        assert not fixture.page.evaluate('Boolean(window.__unsafe)')
        assert entry.locator('img').count() == 0
        dialog = fixture.page.locator('#recovery-dialog')
        assert dialog.evaluate('(el)=>el.scrollWidth <= el.clientWidth + 1')
        assert fixture.page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        for control in entry.locator('[data-recovery-library-query], [data-recovery-library-type], '
                                     '[data-recovery-library-search], [data-recovery-library-choose], '
                                     '[data-recovery-open]').all():
            box = control.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1, box
        fixture.page.screenshot(path=str(ARTIFACTS / f'recovery-picker-{width}.png'), full_page=True)
        fixture.finish()


def check_stale_library_responses(browser, html):
    for changed in ('configuration', 'library'):
        fixture = Fixture(browser, html, auto_enabled=False)
        fixture.open()
        fixture.review()
        entry = fixture.browse()
        entry.locator(f'[data-recovery-library-choose="{MOVIE}"]').click()
        entry.locator('[data-recovery-library-query]').fill('Library item 0')
        fixture.hold_library = True
        with fixture.page.expect_request(lambda request: urlsplit(request.url).path == LIBRARY_PATH):
            entry.locator('[data-recovery-library-search]').click()
        expect(entry.locator('[data-recovery-library-search]')).to_be_disabled()
        assert len(fixture.held_library) == 1
        if changed == 'configuration':
            fixture.config['ConfigurationRevision'] += 1
        else:
            fixture.library_revision = 'library-2'
        fixture.status_message = 'Fresh recovery report loaded while browsing.'
        # Jellyfin can reload the settings controller while a library request is
        # pending. Use its existing public load hook, leaving busy UI guards intact.
        fixture.page.evaluate('FranchiseSettings.load()')
        expect(fixture.page.locator('#recovery-dialog-status')).to_contain_text('Fresh recovery report loaded')
        route, result = fixture.held_library.pop()
        assert len(result['items']) == 10
        route.fulfill(json=result)
        expect(fixture.page.locator('#recovery-dialog-error')).to_contain_text('recovery report changed')
        expect(entry.locator('[data-recovery-library-choose]')).to_have_count(30)
        expect(entry.locator('[data-recovery-choice]')).to_have_value(MOVIE)
        expect(entry.locator('[data-recovery-library-query]')).to_have_value('Library item 0')
        assert fixture.writes == []
        assert fixture.config['MediaLinks'][0]['JellyfinItemId'] == OLD[WRONG_TYPE]
        fixture.finish()


def check_selected_server_link(browser, html):
    fixture = Fixture(browser, html, auto_enabled=False)
    app_origin = 'http://app.example'
    fixture.page.route(app_origin + '/**', fixture.route)
    fixture.page.goto(app_origin + '/settings')
    fixture.page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
    fixture.page.evaluate("""() => {
      const fixtureGetUrl = ApiClient.getUrl;
      ApiClient.getUrl = (route, query) => route === 'web/index.html'
        ? 'http://name:secret@jellyfin.test/emby/web/index.html?api_key=fixture-token#discarded'
        : fixtureGetUrl(route, query);
    }""")
    fixture.review()
    entry = fixture.browse()
    assert fixture.page.url.startswith(app_origin)
    assert_open_link(entry, MOVIE)
    assert 'secret' not in entry.locator(f'[data-recovery-open="{MOVIE}"]').first.get_attribute('href')
    fixture.finish()


def run():
    html = generate()  # Exercise the real page without rewriting configPage.html.
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        check_browse_and_correct_type(browser, html)
        check_find_uses_fresh_automatic_pass(browser, html)
        check_errors_and_dirty_draft(browser, html)
        check_stale_library_responses(browser, html)
        check_selected_server_link(browser, html)
        check_mobile(browser, html)
        browser.close()
    print('Recovery library picker browser checks passed: blank browse, pagination and type filtering, '
          'explicit type correction, safe Jellyfin links, automatic prepass and fresh Find, errors, stale replies, drafts, '
          'escaped content and 320/390px layouts.')


if __name__ == '__main__':
    run()
