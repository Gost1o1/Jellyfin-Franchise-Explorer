#!/usr/bin/env python3
"""Exercise bulk recovery through the generated production settings interface.

An authenticated in-memory API supplies 127 unique title/type matches and two
references that still need review. This checks the browser contract and editor
reload; the real planner and persistence are exercised by the C# recovery tests.
"""
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import re
import time

from playwright.sync_api import expect, sync_playwright
from build_settings_page import generate
from test_recovery_attention_browser import BOOT, Fixture as AttentionFixture, TOKEN


ORIGIN = 'http://jellyfin.test'
gid = lambda value: f'{value:032x}'
NODE, ROW = gid(1), gid(2)
READY = [gid(100 + index) for index in range(127)]
UNKNOWN, AMBIGUOUS = gid(300), gid(301)
REFS = [*READY, UNKNOWN, AMBIGUOUS]
OLD = {reference: gid(1000 + index) for index, reference in enumerate(REFS)}
NEW = {reference: gid(2000 + index) for index, reference in enumerate(REFS)}
TITLES = {reference: f'Saved title {index + 1:03}' for index, reference in enumerate(READY)}
TITLES.update({UNKNOWN: 'Unknown saved item', AMBIGUOUS: 'Two library editions'})
AUTO_PATH = '/emby/FranchiseExplorer/Recovery/Auto'


def config_fixture():
    def reference(identifier):
        return dict(Id=identifier, JellyfinItemId=OLD[identifier],
                    DisplayName=TITLES[identifier], ItemType='Movie', RangeMode='Full',
                    Artwork={'PrimaryUrl': '/emby/saved-reference-art'},
                    FutureReferenceField={'retained': identifier})

    direct = [*READY[:100], UNKNOWN, AMBIGUOUS]
    items = [reference(identifier) for identifier in READY[100:]]
    links = [dict(reference(identifier), NodeId=NODE, ViewingOrder='Custom', Position=index + 1)
             for index, identifier in enumerate(direct)]
    return dict(
        NavigationLabel='Franchises', ConfigurationRevision=1, ImdbLists=[],
        FutureField={'completedReferenceIds': READY[:3], 'positionTicks': 123456789,
                     'queueReferenceIds': READY[100:103], 'keep': 'saved progress metadata'},
        Nodes=[dict(Id=NODE, ParentId='', Name='Saved franchise', NodeType='Franchise',
                    Overview='Preserve franchise settings', SortOrder=0,
                    Artwork={'PrimaryUrl': '/emby/saved-franchise-art'},
                    AutoAddSources=[], AutoAddRows=[], AutoAddRecords=[
                        dict(ReferenceId=READY[0], RowId=ROW, SourceIds=[], ImdbIds=[],
                             Signature='saved ownership')])],
        Rows=[dict(Id=ROW, ParentNodeId=NODE, Name='Saved timeline', RowType='Timeline',
                   Category='Movies', SortOrder=0, Artwork={'PrimaryUrl': '/emby/saved-row-art'},
                   NodeIds=[], MediaLinkIds=READY[:8], Items=items,
                   MediaOrder=[READY[100], READY[0], *READY[101:], *READY[1:8]])],
        MediaLinks=links, MediaRecovery=dict(Enabled=True, AutoReconnect=True),
        AutoFranchises=dict(Enabled=False, Registry=[], Exclusions=[], PendingChanges=[],
                           Ownership=[], LastRun=None, LastCompletedLocalDay=''))


def pascal(value):
    if isinstance(value, list):
        return [pascal(entry) for entry in value]
    if isinstance(value, dict):
        return {key[0].upper() + key[1:]: pascal(entry) for key, entry in value.items()}
    return value


class Fixture(AttentionFixture):
    """Reuse the existing real-editor navigation and dirty-draft helpers."""

    def __init__(self, browser, html, *, healthy=True, can_search=True, legacy=False,
                 use_pascal=True, auto_enabled=True):
        super().__init__(browser, html, healthy=healthy, can_search=can_search)
        self.config = config_fixture()
        self.config['MediaRecovery']['AutoReconnect'] = auto_enabled
        self.legacy = legacy
        self.use_pascal = use_pascal
        self.auto_error = ''
        self.auto_bodies = []
        self.auto_counts = []
        self.hold_auto = False
        self.held_auto = None
        self.config_reads = 0
        self.hold_config_reload = False
        self.held_config_reload = None
        self.library = [dict(Id=NEW[reference], Name=TITLES[reference], Type='Movie',
                             ProductionYear=2000 + index % 25, ProviderIds={}, ImageTags={})
                        for index, reference in enumerate(REFS)]

    def wire(self, value):
        return pascal(value) if self.use_pascal else value

    def references(self):
        return [*self.config['MediaLinks'], *self.config['Rows'][0]['Items']]

    def candidate(self, reference, *, alternate=False):
        return dict(itemId=gid(9999) if alternate else NEW[reference],
                    title=TITLES[reference], itemType='Movie', year=2001,
                    providerIds=[], verified=reference in READY)

    def status(self):
        entries = []
        for reference in self.references():
            identifier = reference['Id']
            healthy = reference['JellyfinItemId'] == NEW[identifier]
            ready = identifier in READY and not healthy
            entry = dict(referenceId=identifier, nodeId=NODE,
                         rowId=ROW if identifier in READY[100:] else '',
                         oldItemId=reference['JellyfinItemId'], title=TITLES[identifier],
                         itemType='Movie', status='Healthy' if healthy else
                         'Verified' if ready else 'Ambiguous' if identifier == AMBIGUOUS else 'ManualReview',
                         reason='The saved item is available.' if healthy else
                         'One exact saved title and type match.' if ready else
                         'Several library editions match; choose a version.' if identifier == AMBIGUOUS else
                         'No unique replacement is confirmed. Search and choose explicitly.',
                         candidates=[] if healthy or identifier == UNKNOWN else
                         [self.candidate(identifier), self.candidate(identifier, alternate=True)]
                         if identifier == AMBIGUOUS else [self.candidate(identifier)])
            if not self.legacy:
                entry.update(canAutoRemap=ready and self.can_search,
                             matchMethod='Exact title and type' if ready else '')
            entries.append(entry)
        available = sum(entry['status'] == 'Healthy' for entry in entries)
        return dict(revision=f"configuration-{self.config['ConfigurationRevision']}",
                    libraryRevision='library-1', enabled=self.config['MediaRecovery']['Enabled'],
                    autoReconnect=self.config['MediaRecovery']['AutoReconnect'],
                    libraryHealthy=self.healthy, canSearch=self.can_search,
                    referenceCount=len(entries), healthyCount=available,
                    attentionCount=len(entries) - available, checkedUtc=self.checked,
                    message='Review the remaining references.' if self.healthy else
                    'Some unrelated library media is unavailable; available candidates can be remapped.',
                    entries=entries)

    def finish_auto(self, route):
        assert self.can_search
        changed = 0
        for reference in self.references():
            identifier = reference['Id']
            if identifier in READY and reference['JellyfinItemId'] != NEW[identifier]:
                reference['JellyfinItemId'] = NEW[identifier]
                changed += 1
        if changed:
            self.config['ConfigurationRevision'] += 1
        self.auto_counts.append(changed)
        route.fulfill(json=self.wire(dict(status=self.status(), remappedCount=changed)))

    def route(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        path = parsed.path
        if path == '/settings':
            boot = 'window.__library=' + json.dumps(self.library) + ';' + BOOT
            route.fulfill(content_type='text/html', body=self.html.replace(
                '<script type="text/javascript">', '<script>' + boot +
                '</script><script type="text/javascript">', 1))
            return
        if path.startswith('/emby/') and not path.endswith('-art'):
            assert request.headers.get('authorization') == TOKEN, path
        self.requests.append((request.method, path))
        if request.method == 'POST':
            self.writes.append(path)
        if path == '/emby/MockConfiguration':
            assert request.method == 'GET', 'Auto remap must not save a browser-built configuration.'
            self.config_reads += 1
            if self.hold_config_reload and self.auto_counts:
                self.held_config_reload = route
            else:
                route.fulfill(json=self.config)
        elif path.endswith('/Automation/Status'):
            route.fulfill(json=dict(settings=self.config['AutoFranchises'],
                                    fingerprint='automation-1', running=False))
        elif path.endswith('/Recovery/Status'):
            route.fulfill(json=self.wire(self.status()))
        elif path == AUTO_PATH:
            assert request.method == 'POST'
            body = json.loads(request.post_data) if request.post_data else None
            assert body in (None, {}), 'The server determines every safe mapping; no manual choices belong here.'
            self.auto_bodies.append(body)
            if self.auto_error:
                self.fail(route, self.auto_error)
            elif self.hold_auto:
                self.held_auto = route
            else:
                self.finish_auto(route)
        elif path.endswith('/Recovery/Candidates'):
            assert request.method == 'GET'
            query = parse_qs(parsed.query)
            identifier = query['referenceId'][0]
            assert identifier in REFS
            assert query['revision'] == [self.status()['revision']]
            self.queries.append((identifier, query['query'][0]))
            route.fulfill(json=self.wire([self.candidate(identifier)]))
        elif path.endswith('/Recovery/Apply'):
            assert request.method == 'POST'
            body = request.post_data_json
            assert body['revision'] == self.status()['revision']
            assert body['libraryRevision'] == 'library-1'
            self.applied.append(deepcopy(body['choices']))
            for choice in body['choices']:
                reference = next(entry for entry in self.references() if entry['Id'] == choice['referenceId'])
                assert choice['itemId'] == NEW[reference['Id']]
                reference['JellyfinItemId'] = choice['itemId']
            self.config['ConfigurationRevision'] += 1
            route.fulfill(json=self.wire(self.status()))
        else:
            route.fulfill(status=404)


def auto_button(page):
    return page.locator('#recovery-dialog .dialog-footer #recovery-auto-remap')


def wait_for_held(fixture, attribute):
    deadline = time.monotonic() + 5
    while getattr(fixture, attribute) is None and time.monotonic() < deadline:
        fixture.page.wait_for_timeout(20)
    assert getattr(fixture, attribute) is not None, f'Timed out waiting for {attribute}'


def expect_two_unresolved(fixture):
    page = fixture.page
    expect(page.locator('[data-recovery-entry]')).to_have_count(2)
    expect(page.locator('[data-recovery-choice]')).to_have_count(2)
    expect(fixture.entry(UNKNOWN)).to_be_visible()
    expect(fixture.entry(AMBIGUOUS)).to_be_visible()
    expect(page.locator('#recovery-results')).not_to_contain_text(TITLES[READY[0]])


def check_bulk_remap(browser, html):
    fixture = Fixture(browser, html)
    before = deepcopy(fixture.config)
    fixture.open()
    page = fixture.page
    model_before = page.evaluate('FranchiseSettings.getModel()')
    reads = fixture.config_reads
    fixture.hold_auto = True
    fixture.hold_config_reload = True
    fixture.review()
    status = page.locator('#recovery-dialog-status')
    notice = page.locator('#recovery-notice-count')
    expect(status).to_be_visible()
    expect(status).to_have_text('Checking media…')
    expect(auto_button(page)).to_be_disabled()
    expect(page.locator('[data-recovery-entry]')).to_have_count(0)
    expect(page.locator('#recovery-apply')).to_be_disabled()
    assert fixture.writes == [AUTO_PATH] and fixture.queries == []
    assert fixture.config == before
    wait_for_held(fixture, 'held_auto')
    assert page.locator('#recovery-auto').evaluate('(element)=>element.type') == 'checkbox'

    fixture.hold_auto = False
    fixture.finish_auto(fixture.held_auto)
    # A successful server write is followed by a real configuration reload;
    # manual cards must wait until the editor has that saved revision too.
    expect(auto_button(page)).to_be_disabled()
    expect(page.locator('[data-recovery-entry]')).to_have_count(0)
    wait_for_held(fixture, 'held_config_reload')
    assert page.evaluate('FranchiseSettings.getModel()') == model_before
    fixture.hold_config_reload = False
    fixture.held_config_reload.fulfill(json=fixture.config)
    page.wait_for_function('(id)=>FranchiseSettings.getModel().Rows[0].Items[26].JellyfinItemId===id',
                           arg=NEW[READY[-1]])
    expect(notice).to_contain_text('129 saved references checked')
    expect(notice).to_contain_text('127 available')
    expect(notice).to_contain_text(re.compile(r'Last auto remap: 127 references reconnected', re.I))
    expect(status).to_have_text('')
    expect(status).to_be_hidden()
    expect(page.locator('#save-state')).to_have_text('All changes saved')
    expect_two_unresolved(fixture)
    expect(auto_button(page)).to_have_text('Auto remap')
    assert fixture.writes == [AUTO_PATH]
    assert len(fixture.auto_bodies) == 1 and fixture.auto_counts == [127]
    assert fixture.applied == [] and fixture.queries == []
    assert fixture.config_reads > reads, 'The host must reload the actual saved server configuration.'

    expected_server, expected_model = deepcopy(before), deepcopy(model_before)
    for config in (expected_server, expected_model):
        for reference in [*config['MediaLinks'], *config['Rows'][0]['Items']]:
            if reference['Id'] in READY:
                reference['JellyfinItemId'] = NEW[reference['Id']]
        config['ConfigurationRevision'] = fixture.config['ConfigurationRevision']
    # The whole model comparison covers reference IDs, positions, memberships,
    # timeline order, ownership records, artwork and saved future/progress fields.
    assert fixture.config == expected_server
    assert page.evaluate('FranchiseSettings.getModel()') == expected_model
    assert not any(method == 'DELETE' for method, _ in fixture.requests)

    # A complete pass remains available when only unresolved entries remain.
    expect(auto_button(page)).to_be_enabled()
    auto_button(page).click()
    expect(notice).to_contain_text(re.compile(r'Last auto remap: 0 references reconnected', re.I))
    expect(page.locator('#toast')).to_contain_text(re.compile(r'reconnect.*0|0.*reconnect', re.I))
    assert fixture.auto_counts == [127, 0]
    assert fixture.writes == [AUTO_PATH, AUTO_PATH]
    assert fixture.config == expected_server
    expect_two_unresolved(fixture)

    # Manual review still works for an ambiguous item after the automatic pass.
    fixture.entry(AMBIGUOUS).locator('[data-recovery-choice]').select_option(NEW[AMBIGUOUS])
    page.locator('#recovery-apply').click()
    expect(page.locator('[data-recovery-entry]')).to_have_count(1)
    assert fixture.applied == [[dict(referenceId=AMBIGUOUS, itemId=NEW[AMBIGUOUS])]]
    assert next(entry for entry in fixture.references() if entry['Id'] == UNKNOWN)['JellyfinItemId'] == OLD[UNKNOWN]
    fixture.finish()


def check_errors_and_drafts(browser, html):
    fixture = Fixture(browser, html, use_pascal=False)
    fixture.open()
    fixture.review()
    page = fixture.page
    fixture.entry(AMBIGUOUS).locator('[data-recovery-choice]').select_option(NEW[AMBIGUOUS])
    fixture.entry(UNKNOWN).locator('[data-recovery-query]').fill('A corrected manual search')
    before, model = deepcopy(fixture.config), page.evaluate('FranchiseSettings.getModel()')
    reads = fixture.config_reads
    fixture.auto_error = 'Auto remap failed. Saved references and choices were kept.'
    auto_button(page).click()
    expect(page.locator('#recovery-dialog-error')).to_have_attribute('role', 'alert')
    expect(page.locator('#recovery-dialog-error')).to_contain_text('Auto remap failed')
    expect(page.locator('#recovery-dialog-error')).to_be_visible()
    expect(fixture.entry(AMBIGUOUS).locator('[data-recovery-choice]')).to_have_value(NEW[AMBIGUOUS])
    expect(fixture.entry(UNKNOWN).locator('[data-recovery-query]')).to_have_value('A corrected manual search')
    assert fixture.config == before and page.evaluate('FranchiseSettings.getModel()') == model
    assert fixture.config_reads == reads
    fixture.auto_error = ''
    page.locator('#recovery-refresh').click()
    expect(page.locator('#recovery-dialog-error')).to_be_hidden()
    expect(auto_button(page)).to_be_enabled()
    fixture.finish()

    fixture = Fixture(browser, html)
    fixture.open()
    fixture.draft('Unsaved auto remap draft')
    fixture.review()
    page = fixture.page
    before = deepcopy(fixture.config)
    expect(auto_button(page)).to_be_disabled()
    auto_button(page).evaluate('(button)=>button.click()')
    # Also exercise the write guard if a stale external view enables the button.
    auto_button(page).evaluate('(button)=>{button.disabled=false;button.click();}')
    expect(page.locator('#recovery-dialog-status')).to_contain_text(re.compile('save|reload|unsaved', re.I))
    assert fixture.writes == [] and fixture.config == before
    assert any(node['Name'] == 'Unsaved auto remap draft'
               for node in page.evaluate('FranchiseSettings.getModel().Nodes'))
    expect(page.locator('#save-state')).to_have_text('Unsaved changes')
    fixture.finish()

    # An edit made while the server is working must survive the Auto response.
    fixture = Fixture(browser, html)
    fixture.open()
    fixture.hold_auto = True
    fixture.review()
    page = fixture.page
    expect(auto_button(page)).to_be_disabled()
    wait_for_held(fixture, 'held_auto')
    fixture.close_review()
    fixture.draft('Draft during auto remap')
    draft = page.evaluate('FranchiseSettings.getModel()')
    fixture.finish_auto(fixture.held_auto)
    expect(page.locator('#recovery-refresh')).to_be_enabled()
    assert page.evaluate('FranchiseSettings.getModel()') == draft
    expect(page.locator('#save-state')).to_have_text('Unsaved changes')
    expect(page.locator('#recovery-notice')).to_contain_text(re.compile(r'127.*changed.*server', re.I))
    assert fixture.auto_counts == [127] and fixture.writes == [AUTO_PATH]
    fixture.finish()


def check_availability_and_legacy(browser, html):
    fixture = Fixture(browser, html, healthy=False, can_search=True)
    fixture.open()
    fixture.review()
    page = fixture.page
    expect_two_unresolved(fixture)
    expect(auto_button(page)).to_be_enabled()
    expect(page.locator('#recovery-notice-count')).to_contain_text('127 available')
    assert fixture.auto_counts == [127] and fixture.writes == [AUTO_PATH]
    auto_button(page).click()
    expect(page.locator('#recovery-notice-count')).to_contain_text('Last auto remap: 0 references reconnected')
    assert fixture.auto_counts == [127, 0]
    fixture.finish()

    fixture = Fixture(browser, html, healthy=False, can_search=False)
    fixture.open()
    fixture.review()
    expect(auto_button(fixture.page)).to_be_visible()
    expect(auto_button(fixture.page)).to_be_disabled()
    auto_button(fixture.page).evaluate('(button)=>button.click()')
    assert fixture.writes == []
    fixture.finish()

    # With automatic reconnection disabled, old reports that omit CanAutoRemap
    # and MatchMethod must retain all candidates for an explicit manual choice.
    fixture = Fixture(browser, html, legacy=True, auto_enabled=False)
    fixture.open()
    fixture.review()
    page = fixture.page
    expect(page.locator('[data-recovery-entry]')).to_have_count(129)
    choice = fixture.entry(READY[0]).locator('[data-recovery-choice]')
    choice.select_option(NEW[READY[0]])
    expect(page.locator('#recovery-apply')).to_be_enabled()
    page.locator('#recovery-apply').click()
    expect(page.locator('[data-recovery-entry]')).to_have_count(128)
    assert fixture.applied == [[dict(referenceId=READY[0], itemId=NEW[READY[0]])]]
    assert fixture.auto_counts == []
    fixture.finish()


def run():
    html = generate()  # Do not read or rewrite the generated configPage.html.
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        check_bulk_remap(browser, html)
        check_errors_and_drafts(browser, html)
        check_availability_and_legacy(browser, html)
        browser.close()
    print('Auto remap browser checks passed: 127 mappings in one pass, focused manual review, '
          'saved metadata and editor reload, idempotence, errors, drafts, partial libraries and legacy reports.')


if __name__ == '__main__':
    run()
