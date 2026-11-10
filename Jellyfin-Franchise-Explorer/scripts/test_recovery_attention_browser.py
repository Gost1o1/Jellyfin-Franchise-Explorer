#!/usr/bin/env python3
"""Exercise persistent recovery attention on the generated production settings page.

The API fixture stores five legacy, unrowed MediaLinks and a stale row item.
Status is read-only; Check can persist identity metadata; Apply changes only the
selected Jellyfin item ID. No generated resource or real server is modified.
"""
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import re
import runpy

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'http://jellyfin.test'
TOKEN = 'MediaBrowser Token="fixture-token"'


def gid(value):
    return f'{value:032x}'


NODE, ROW, ROW_REF = (gid(value) for value in (1, 2, 3))
LINK_REFS = [gid(10 + index) for index in range(5)]
REFS = [*LINK_REFS, ROW_REF]
OLD_IDS = {reference: gid(100 + index) for index, reference in enumerate(REFS)}
NEW_IDS = {reference: gid(200 + index) for index, reference in enumerate(REFS)}
TITLES = {reference: f'Saved legacy movie {index + 1}' for index, reference in enumerate(REFS)}
TITLES[ROW_REF] = 'Saved row movie'
LIBRARY = [dict(Id=NEW_IDS[reference], Name=TITLES[reference], Type='Movie',
                ProductionYear=2000 + index, ProviderIds={})
           for index, reference in enumerate(REFS)]


def config_fixture():
    return dict(
        NavigationLabel='Franchises', ConfigurationRevision=1,
        FutureField={'preserved': True}, ImdbLists=[],
        Nodes=[dict(Id=NODE, ParentId='', Name='Legacy franchise', NodeType='Franchise',
                    Overview='Keep the saved franchise', SortOrder=0, Artwork={},
                    AutoAddSources=[], AutoAddRows=[], AutoAddRecords=[])],
        Rows=[dict(Id=ROW, ParentNodeId=NODE, Name='Saved row', Category='Movies',
                   RowType='Timeline', SortOrder=0, Artwork={'Primary': 'saved-artwork'},
                   Items=[dict(Id=ROW_REF, JellyfinItemId=OLD_IDS[ROW_REF],
                               DisplayName=TITLES[ROW_REF], ItemType='Movie', RangeMode='Full')],
                   NodeIds=[], MediaLinkIds=[], MediaOrder=[ROW_REF])],
        MediaLinks=[dict(Id=reference, NodeId=NODE, JellyfinItemId=OLD_IDS[reference],
                         DisplayName=TITLES[reference], ItemType='Movie', RangeMode='Full',
                         ViewingOrder='Custom', Position=index + 1)
                    for index, reference in enumerate(LINK_REFS)],
        MediaRecovery=dict(Enabled=True, AutoReconnect=True),
        AutoFranchises=dict(Enabled=False, Registry=[], Exclusions=[], PendingChanges=[],
                           Ownership=[], LastRun=None, LastCompletedLocalDay=''))


BOOT = r"""
window.ApiClient = {
 getCurrentUserId:()=> 'admin', accessToken:()=> 'fixture-token',
 getCurrentUser:async()=>({Policy:{IsAdministrator:true},Configuration:{}}),
 getPluginConfiguration:async()=>{const r=await fetch('/emby/MockConfiguration',{headers:{Authorization:'MediaBrowser Token="fixture-token"'}});return r.json();},
 updatePluginConfiguration:async(_id,config)=>{const r=await fetch('/emby/MockConfiguration',{method:'POST',headers:{Authorization:'MediaBrowser Token="fixture-token"','Content-Type':'application/json'},body:JSON.stringify(config)});if(!r.ok)throw Error('Save failed');},
 getUrl:(route,query)=>{const u=new URL(route.replace(/^\//,''),location.origin+'/emby/');for(const[k,v]of Object.entries(query||{}))u.searchParams.set(k,v);return u.href;},
 getItems:async(_user,query)=>{let all=window.__library.filter(item=>(query.includeItemTypes||'Movie,Series,BoxSet').split(',').includes(item.Type));if(query.searchTerm)all=all.filter(item=>item.Name.toLowerCase().includes(query.searchTerm.toLowerCase()));return {Items:structuredClone(all),TotalRecordCount:all.length};},
 getItem:async(_user,id)=>{const item=window.__library.find(item=>item.Id===id);if(!item)throw Error('The saved Jellyfin item is unavailable.');return structuredClone(item);}
};
"""


class Fixture:
    def __init__(self, browser, html, *, healthy=True, can_search=True):
        self.config = config_fixture()
        self.healthy = healthy
        self.can_search = can_search
        self.checked = '2026-11-10T00:10:00Z'
        self.requests = []
        self.writes = []
        self.queries = []
        self.applied = []
        self.status_error = ''
        self.check_error = ''
        self.search_error = ''
        self.apply_error = ''
        self.hold_check = False
        self.held_check = None
        self.page_errors = []
        self.page = browser.new_page(viewport={'width': 1280, 'height': 1000})
        self.page.on('pageerror', lambda error: self.page_errors.append(str(error)))
        self.html = html
        self.page.route(ORIGIN + '/**', self.route)

    def references(self):
        return [*self.config['MediaLinks'], *self.config['Rows'][0]['Items']]

    def status(self):
        entries = []
        for reference in self.references():
            healthy = reference['JellyfinItemId'] == NEW_IDS[reference['Id']]
            entries.append(dict(
                referenceId=reference['Id'], rowId=ROW if reference['Id'] == ROW_REF else '',
                nodeId=NODE, oldItemId=reference['JellyfinItemId'], title=reference['DisplayName'],
                itemType=reference['ItemType'], status='Healthy' if healthy else 'ManualReview',
                reason='The saved Jellyfin item is available.' if healthy else
                       'Legacy reference has no stable identity. Choose the actual library item explicitly.',
                candidates=[]))
        healthy_count = sum(entry['status'] == 'Healthy' for entry in entries)
        message = ('Library unavailable; recovery is paused.' if not self.can_search else
                   'Automatic reconnection is paused until a healthy scan; manual review is available.'
                   if not self.healthy else 'Review the saved media references that need attention.')
        return dict(revision=f"configuration-{self.config['ConfigurationRevision']}",
                    libraryRevision='library-1', enabled=self.config['MediaRecovery']['Enabled'],
                    autoReconnect=self.config['MediaRecovery']['AutoReconnect'],
                    libraryHealthy=self.healthy, canSearch=self.can_search,
                    referenceCount=len(entries), healthyCount=healthy_count,
                    attentionCount=len(entries) - healthy_count, checkedUtc=self.checked,
                    message=message, entries=entries)

    def candidate(self, reference):
        item = next(item for item in LIBRARY if item['Id'] == NEW_IDS[reference])
        return dict(itemId=item['Id'], title=item['Name'], itemType=item['Type'],
                    year=item['ProductionYear'], providerIds=[], verified=False)

    def fail(self, route, message):
        route.fulfill(status=503, json={'error': message})

    def finish_check(self, route):
        # Explicit Check is allowed to capture metadata and therefore needs the
        # same local-draft protection as Apply. GET Status never reaches here.
        for reference in self.references():
            if reference['JellyfinItemId'] == NEW_IDS[reference['Id']]:
                reference['Identity'] = dict(Title=reference['DisplayName'], ItemType='Movie')
        self.config['ConfigurationRevision'] += 1
        self.checked = '2026-11-10T02:00:00Z'
        route.fulfill(json=self.status())

    def route(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        path = parsed.path
        if path == '/settings':
            boot = 'window.__library=' + json.dumps(LIBRARY) + ';' + BOOT
            route.fulfill(content_type='text/html', body=self.html.replace(
                '<script type="text/javascript">', '<script>' + boot +
                '</script><script type="text/javascript">', 1))
            return
        if path.startswith('/emby/'):
            assert request.headers.get('authorization') == TOKEN, path
        self.requests.append((request.method, path))
        if request.method == 'POST':
            self.writes.append(path)
        if path == '/emby/MockConfiguration':
            if request.method == 'POST':
                self.config = request.post_data_json
                self.config['ConfigurationRevision'] += 1
            route.fulfill(json=self.config)
        elif path.endswith('/Automation/Status'):
            route.fulfill(json=dict(settings=dict(enabled=False, registry=[], exclusions=[],
                                                  pendingChanges=[], ownership=[]),
                                    fingerprint='automation-1', running=False))
        elif path.endswith('/Recovery/Status'):
            if self.status_error:
                self.fail(route, self.status_error)
            else:
                route.fulfill(json=self.status())
        elif path.endswith('/Recovery/Check'):
            assert request.method == 'POST'
            if self.check_error:
                self.fail(route, self.check_error)
            elif self.hold_check:
                self.held_check = route
            else:
                self.finish_check(route)
        elif path.endswith('/Recovery/Candidates'):
            assert request.method == 'GET'
            query = parse_qs(parsed.query)
            assert query['revision'] == [self.status()['revision']]
            assert query['libraryRevision'] == ['library-1']
            reference = query['referenceId'][0]
            assert reference in REFS
            self.queries.append((reference, query['query'][0]))
            if self.search_error:
                self.fail(route, self.search_error)
            else:
                assert self.can_search
                route.fulfill(json=[self.candidate(reference)])
        elif path.endswith('/Recovery/Apply'):
            assert request.method == 'POST'
            body = request.post_data_json
            assert body['revision'] == self.status()['revision']
            assert body['libraryRevision'] == 'library-1'
            if self.apply_error:
                self.fail(route, self.apply_error)
            else:
                assert self.can_search
                self.applied.append(deepcopy(body['choices']))
                for choice in body['choices']:
                    assert choice['itemId'] == NEW_IDS[choice['referenceId']]
                    reference = next(item for item in self.references() if item['Id'] == choice['referenceId'])
                    reference['JellyfinItemId'] = choice['itemId']
                self.config['ConfigurationRevision'] += 1
                route.fulfill(json=self.status())
        else:
            route.fulfill(status=404)

    def open(self):
        self.page.goto(ORIGIN + '/settings')
        self.page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        expect(self.page.locator('#recovery-notice')).to_be_visible()
        assert not self.page.locator('#settings').evaluate('(element)=>element.open')
        assert not self.page.locator('#advanced').evaluate('(element)=>element.open')
        assert self.page.locator('#recovery-notice').evaluate(
            '(element)=>!element.closest("#settings, #advanced")')

    def review(self):
        self.page.locator('#recovery-notice-review').click()
        expect(self.page.locator('#recovery-dialog')).to_be_visible()

    def entry(self, reference):
        return self.page.locator(f'[data-recovery-entry="{reference}"]')

    def find(self, reference):
        entry = self.entry(reference)
        expect(entry.locator('[data-recovery-query]')).to_have_value(TITLES[reference])
        entry.locator('[data-recovery-search]').click()
        expect(entry.locator('option', has_text=NEW_IDS[reference])).to_have_count(1)
        return entry

    def close_review(self):
        self.page.locator('#recovery-dialog').get_by_role('button', name='Close', exact=True).click()

    def open_settings(self):
        for identifier in ('settings', 'advanced'):
            if not self.page.locator('#' + identifier).evaluate('(element)=>element.open'):
                self.page.locator('#' + identifier + ' > summary').click()

    def draft(self, title):
        if not self.page.locator('#franchises').evaluate('(element)=>element.open'):
            self.page.locator('#franchises > summary').click()
        self.page.locator('#add-franchise').click()
        self.page.locator('#new-name').fill(title)
        self.page.locator('#create-manual').click()
        expect(self.page.locator('#save-state')).to_have_text('Unsaved changes')

    def finish(self):
        assert not self.page_errors, self.page_errors
        self.page.close()


def assert_counts(page, total, healthy, attention):
    status = page.locator('#recovery-dialog-status')
    expect(status).to_contain_text(re.compile(rf'\b{total}\b.*reference', re.I))
    expect(status).to_contain_text(re.compile(rf'\b{healthy}\b\s+(?:healthy|available)', re.I))
    expect(status).to_contain_text(re.compile(rf'\b{attention}\b.*(?:attention|review)', re.I))


def check_legacy_review(browser, html):
    fixture = Fixture(browser, html)
    before = deepcopy(fixture.config)
    fixture.open()
    page = fixture.page
    assert fixture.writes == []
    assert fixture.config == before
    fixture.review()
    assert_counts(page, 6, 0, 6)
    expect(page.locator('[data-recovery-entry]')).to_have_count(6)
    expect(page.locator('#recovery-results')).to_contain_text('Legacy reference has no stable identity')
    for reference in REFS:
        expect(fixture.entry(reference).locator('[data-recovery-query]')).to_have_value(TITLES[reference])
        expect(fixture.entry(reference).locator('[data-recovery-choice]')).to_have_value('')
    expect(page.locator('#recovery-apply')).to_be_disabled()
    assert fixture.writes == []  # Opening review and loading Status never captures metadata.

    reference = LINK_REFS[0]
    entry = fixture.find(reference)
    assert fixture.queries == [(reference, TITLES[reference])]
    assert fixture.writes == []
    expect(entry).to_contain_text('Manual')
    entry.locator('[data-recovery-choice]').select_option(NEW_IDS[reference])
    expect(page.locator('#recovery-apply')).to_be_enabled()
    page.locator('#recovery-apply').click()
    expect(page.locator('[data-recovery-entry]')).to_have_count(5)
    assert fixture.applied == [[dict(referenceId=reference, itemId=NEW_IDS[reference])]]
    expected = deepcopy(before)
    expected['MediaLinks'][0]['JellyfinItemId'] = NEW_IDS[reference]
    expected['ConfigurationRevision'] = fixture.config['ConfigurationRevision']
    assert fixture.config == expected  # Reference IDs, positions, rows and artwork survive.
    page.wait_for_function('(id)=>FranchiseSettings.getModel().MediaLinks[0].JellyfinItemId===id',
                           arg=NEW_IDS[reference])
    assert_counts(page, 6, 1, 5)
    fixture.close_review()

    # An explicit Check may capture metadata and must reload the resulting config.
    fixture.open_settings()
    page.locator('#recovery-check').click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    page.wait_for_function('FranchiseSettings.getModel().MediaLinks[0].Identity?.Title === "Saved legacy movie 1"')
    assert fixture.writes[-1].endswith('/Recovery/Check')
    assert fixture.config['MediaLinks'][0]['Identity']['Title'] == TITLES[reference]
    fixture.close_review()

    # The ordinary franchise editor offers a direct route from retained stale media.
    if not page.locator('#franchises').evaluate('(element)=>element.open'):
        page.locator('#franchises > summary').click()
    page.locator(f'#board [data-expand="{NODE}"]').click()
    legacy = page.locator(f'#board [data-node-media="{NODE}"]')
    expect(legacy.locator('[data-media-item]')).to_have_count(5)
    expect(legacy).to_contain_text(TITLES[LINK_REFS[1]])
    direct = legacy.locator(f'[data-recover-reference="{LINK_REFS[1]}"]')
    expect(direct).to_be_visible()
    direct.click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    expect(fixture.entry(LINK_REFS[1])).to_be_visible()
    fixture.close_review()

    page.reload()
    page.wait_for_function('(id)=>window.FranchiseSettings && FranchiseSettings.getModel().MediaLinks[0]?.JellyfinItemId===id',
                           arg=NEW_IDS[reference])
    fixture.review()
    assert_counts(page, 6, 1, 5)
    expect(page.locator('[data-recovery-entry]')).to_have_count(5)
    fixture.finish()


def check_errors(browser, html):
    fixture = Fixture(browser, html)
    fixture.status_error = 'Recovery status unavailable. Try again.'
    before = deepcopy(fixture.config)
    fixture.open()
    page = fixture.page
    expect(page.locator('#recovery-notice')).to_contain_text(re.compile('unavailable|could not|failed', re.I))
    fixture.review()
    error = page.locator('#recovery-dialog-error')
    expect(error).to_have_attribute('role', 'alert')
    expect(error).to_be_visible()
    expect(error).to_contain_text('Recovery status unavailable')
    expect(page.locator('#recovery-results')).not_to_contain_text('No unresolved media references')
    assert fixture.writes == [] and fixture.config == before

    # Review retries a failed read, so transient failures do not strand an empty panel.
    fixture.status_error = ''
    fixture.close_review()
    fixture.review()
    expect(page.locator('[data-recovery-entry]')).to_have_count(6)
    assert_counts(page, 6, 0, 6)
    expect(error).to_be_hidden()
    fixture.close_review()
    fixture.open_settings()
    fixture.check_error = 'Recovery check failed. Existing references retained.'
    page.locator('#recovery-check').click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    expect(error).to_be_visible()
    expect(error).to_contain_text('Recovery check failed')
    assert fixture.config == before

    fixture.check_error = ''
    fixture.close_review()
    page.locator('#recovery-check').click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    expect(error).to_be_hidden()
    assert_counts(page, 6, 0, 6)
    reference = LINK_REFS[0]
    fixture.search_error = 'Candidate search unavailable.'
    fixture.entry(reference).locator('[data-recovery-search]').click()
    expect(error).to_be_visible()
    expect(error).to_contain_text('Candidate search unavailable')
    fixture.search_error = ''
    page.locator('#recovery-refresh').click()
    expect(error).to_be_hidden()
    entry = fixture.find(reference)
    expect(error).to_be_hidden()
    entry.locator('[data-recovery-choice]').select_option(NEW_IDS[reference])
    fixture.apply_error = 'Recovery apply failed. Existing references retained.'
    before_apply = deepcopy(fixture.config)
    page.locator('#recovery-apply').click()
    expect(error).to_be_visible()
    expect(error).to_contain_text('Recovery apply failed')
    expect(entry.locator('[data-recovery-choice]')).to_have_value(NEW_IDS[reference])
    assert fixture.config == before_apply
    fixture.finish()


def check_library_availability(browser, html):
    fixture = Fixture(browser, html, healthy=False, can_search=False)
    fixture.open()
    fixture.review()
    page = fixture.page
    assert_counts(page, 6, 0, 6)
    expect(page.locator('#recovery-dialog-status')).to_contain_text(re.compile('paused', re.I))
    for control in page.locator('[data-recovery-search], [data-recovery-choice]').all():
        expect(control).to_be_disabled()
    expect(page.locator('#recovery-apply')).to_be_disabled()
    assert fixture.writes == []
    fixture.finish()

    # A partial scan pauses automatic matching while actual available items can
    # still be selected manually. CanSearch, rather than LibraryHealthy, gates it.
    fixture = Fixture(browser, html, healthy=False, can_search=True)
    fixture.open()
    fixture.review()
    page = fixture.page
    expect(page.locator('#recovery-dialog-status')).to_contain_text(re.compile('paused', re.I))
    reference = ROW_REF
    entry = fixture.find(reference)
    expect(entry.locator('[data-recovery-choice]')).to_be_enabled()
    entry.locator('[data-recovery-choice]').select_option(NEW_IDS[reference])
    expect(page.locator('#recovery-apply')).to_be_enabled()
    page.locator('#recovery-apply').click()
    expect(page.locator('[data-recovery-entry]')).to_have_count(5)
    assert fixture.config['Rows'][0]['Items'][0]['JellyfinItemId'] == NEW_IDS[reference]
    assert fixture.config['Rows'][0]['MediaOrder'] == [ROW_REF]
    assert fixture.config['Rows'][0]['Items'][0]['Id'] == ROW_REF
    assert_counts(page, 6, 1, 5)
    fixture.close_review()
    expect(page.locator('#recovery-notice')).to_be_visible()
    fixture.finish()

    # Unavailability remains visible even if the last report marked all saved
    # IDs healthy. Zero attention must not conceal the paused library state.
    fixture = Fixture(browser, html, healthy=False, can_search=False)
    for reference in fixture.references():
        reference['JellyfinItemId'] = NEW_IDS[reference['Id']]
    fixture.open()
    fixture.review()
    assert_counts(fixture.page, 6, 6, 0)
    expect(fixture.page.locator('#recovery-dialog-status')).to_contain_text(re.compile('paused', re.I))
    fixture.close_review()
    expect(fixture.page.locator('#recovery-notice')).to_be_visible()
    fixture.finish()


def check_draft_protection(browser, html):
    fixture = Fixture(browser, html)
    fixture.open()
    page = fixture.page
    fixture.draft('Unsaved recovery draft')
    before = deepcopy(fixture.config)
    writes = len(fixture.writes)
    fixture.review()
    expect(page.locator('#recovery-dialog-status')).to_contain_text(re.compile('save|reload|unsaved', re.I))
    expect(page.locator('#recovery-apply')).to_be_disabled()
    # DOM click also covers implementations that disable Check while dirty.
    page.locator('#recovery-check').evaluate('(element)=>element.click()')
    page.wait_for_timeout(80)
    assert len(fixture.writes) == writes
    assert fixture.config == before
    assert any(node['Name'] == 'Unsaved recovery draft' for node in page.evaluate('FranchiseSettings.getModel().Nodes'))
    fixture.finish()

    # Edits made during an already authorized Check must survive its completion.
    fixture = Fixture(browser, html)
    fixture.open()
    fixture.open_settings()
    page = fixture.page
    fixture.hold_check = True
    page.locator('#recovery-check').click()
    expect(page.locator('#recovery-dialog')).to_be_visible()
    page.wait_for_timeout(80)
    assert fixture.held_check is not None
    fixture.close_review()
    fixture.draft('Draft during recovery check')
    fixture.finish_check(fixture.held_check)
    expect(page.locator('#recovery-refresh')).to_be_enabled()
    assert any(node['Name'] == 'Draft during recovery check' for node in page.evaluate('FranchiseSettings.getModel().Nodes'))
    assert not any(node['Name'] == 'Draft during recovery check' for node in fixture.config['Nodes'])
    expect(page.locator('#save-state')).to_have_text('Unsaved changes')
    fixture.review()
    assert_counts(page, 6, 0, 6)
    expect(page.locator('#recovery-dialog-status')).to_contain_text(re.compile('save|reload|unsaved', re.I))
    fixture.finish()


def check_background_reconnection(browser, html):
    fixture = Fixture(browser, html)
    fixture.open()
    fixture.draft('Draft before background reconnection')
    fixture.review()
    page = fixture.page
    draft = page.evaluate('FranchiseSettings.getModel()')

    # A server scan reconnects every native ID without changing saved reference
    # IDs. Reading the new report must not silently replace an open editor draft.
    for reference in fixture.references():
        reference['JellyfinItemId'] = NEW_IDS[reference['Id']]
    fixture.config['ConfigurationRevision'] += 1
    page.locator('#recovery-refresh').click()
    assert_counts(page, 6, 6, 0)
    notice = page.locator('#recovery-notice')
    expect(notice).to_be_visible()
    expect(notice).to_contain_text(re.compile(r'6.*references changed.*server', re.I))
    expect(notice).to_contain_text(re.compile(r'draft.*kept', re.I))
    assert page.evaluate('FranchiseSettings.getModel()') == draft
    assert fixture.writes == []
    fixture.close_review()

    expect(page.locator('#recovery-reload')).to_be_visible()
    page.locator('#recovery-reload').click()
    page.wait_for_function('(id)=>FranchiseSettings.getModel().MediaLinks[0].JellyfinItemId===id',
                           arg=NEW_IDS[LINK_REFS[0]])
    expect(page.locator('#save-state')).to_have_text('All changes saved')
    expect(notice).to_be_hidden()
    model = page.evaluate('FranchiseSettings.getModel()')
    assert [entry['Id'] for entry in model['MediaLinks']] == LINK_REFS
    assert model['Rows'][0]['Items'][0]['Id'] == ROW_REF
    assert not any(node['Name'] == 'Draft before background reconnection' for node in model['Nodes'])
    expect(page.locator('#undo')).to_be_enabled()
    page.locator('#undo').click()
    assert page.evaluate('FranchiseSettings.getModel()') == draft
    expect(page.locator('#save-state')).to_have_text('Unsaved changes')
    assert fixture.writes == []
    fixture.finish()


def run():
    html = runpy.run_path(str(ROOT / 'scripts/build_settings_page.py'))['generate']()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        check_legacy_review(browser, html)
        check_errors(browser, html)
        check_library_availability(browser, html)
        check_draft_protection(browser, html)
        check_background_reconnection(browser, html)
        browser.close()
    print('Recovery attention browser checks passed: persistent notice, legacy manual review, '
          'read-only status, saved reconnects, API errors, partial libraries and draft protection.')


if __name__ == '__main__':
    run()
