#!/usr/bin/env python3
"""Exercise server-side file diagnosis through the production recovery UI.

Only the authenticated HTTP server is mocked. A readable file is deliberately
absent from the native index, so checking/scanning must not fabricate a media ID
or report that a queued Jellyfin scan has already linked it.
"""
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit
import re

from playwright.sync_api import expect, sync_playwright

from build_settings_page import generate
from test_recovery_library_picker_browser import (
    Fixture as PickerFixture, WRONG_TYPE, PARTIAL, MOVIE, TITLE, TOKEN,
    assert_open_link,
)


CHECK_PATH = '/emby/FranchiseExplorer/Recovery/File/Check'
SCAN_PATH = '/emby/FranchiseExplorer/Recovery/File/Scan'
VIDEO_PATH = (r'H:\Content\Movies\Star Wars Episode IV A New Hope (1977) [tt0076759]'
              r'\Star Wars Episode IV A New Hope (1977) [tt0076759].mkv')
NO_INDEX = 'Jellyfin can read this file, but it has not indexed it as media.'


def report(**changes):
    result = dict(path=VIDEO_PATH, fileExists=True, readable=True,
                  attributes='ReadOnly, Archive', error='', inLibrary=True,
                  libraries=[dict(name='Movies', contentType='movies')],
                  items=[], parentItems=[], scanState='None', message=NO_INDEX)
    result.update(changes)
    return result


class Fixture(PickerFixture):
    def __init__(self, browser, html, *, width=1280, can_search=True):
        super().__init__(browser, html, auto_enabled=False, width=width, can_search=can_search)
        self.file_report = report()
        self.scan_report = report(scanState='Queued', message='Jellyfin library scan queued. Recovery will check after it finishes.')
        self.file_requests = []
        self.file_error = ''
        self.hold_file = False
        self.held_file = []

    def route(self, route):
        request = route.request
        path = urlsplit(request.url).path
        if path not in (CHECK_PATH, SCAN_PATH):
            return super().route(route)
        assert request.method == 'POST'
        assert request.headers.get('authorization') == TOKEN
        assert request.headers.get('content-type', '').startswith('application/json')
        body = request.post_data_json
        assert set(body) == {'path'} and isinstance(body['path'], str)
        self.file_requests.append((path, deepcopy(body)))
        self.requests.append((request.method, path))
        self.writes.append(path)
        if self.file_error:
            route.fulfill(status=503, json={'error': self.file_error})
        else:
            result = deepcopy(self.scan_report if path == SCAN_PATH else self.file_report)
            result['path'] = body['path']
            if self.hold_file:
                self.held_file.append((route, result))
            else:
                route.fulfill(json=result)

    def file_panel(self, reference=WRONG_TYPE):
        entry = self.entry(reference)
        details = entry.locator('[data-recovery-file-details]')
        if not details.evaluate('(element) => element.open'):
            details.locator('> summary').click()
        expect(entry.locator('[data-recovery-file-path]')).to_be_visible()
        return entry

    def check_file(self, reference=WRONG_TYPE, path=VIDEO_PATH):
        entry = self.file_panel(reference)
        entry.locator('[data-recovery-file-path]').fill(path)
        entry.locator('[data-recovery-file-check]').click()
        expect(entry.locator('[data-recovery-file-result]')).to_contain_text(self.file_report['message'])
        return entry


def check_readonly_and_index_results(browser, html):
    fixture = Fixture(browser, html)
    before = deepcopy(fixture.config)
    fixture.open()
    fixture.review()
    expect(fixture.entry(WRONG_TYPE).locator('[data-recovery-file-details]')).to_have_js_property('open', False)
    entry = fixture.check_file()
    result = entry.locator('[data-recovery-file-result]')
    expect(result).to_contain_text('ReadOnly, Archive')
    expect(result).to_contain_text('Movies')
    expect(result.locator('a')).to_have_count(0)
    assert fixture.file_requests == [(CHECK_PATH, {'path': VIDEO_PATH})]
    assert fixture.config == before and fixture.applied == []
    expect(fixture.page.locator('#recovery-apply')).to_be_disabled()

    # Native metadata may use another title/type. Diagnosis exposes the actual
    # ID for inspection, and does not turn a generic Video into a Movie match.
    fixture.file_report = report(
        items=[dict(itemId=MOVIE, title=TITLE, itemType='Video', isVirtual=False, supported=False)],
        parentItems=[dict(itemId='00000000000000000000000000000401', title='Film folder',
                          itemType='Folder', isVirtual=False, supported=False)],
        message='The file is indexed as Video, which recovery does not support.')
    entry.locator('[data-recovery-file-check]').click()
    expect(result).to_contain_text(fixture.file_report['message'])
    expect(result).to_contain_text(TITLE)
    expect(result).to_contain_text('Video')
    assert_open_link(result, MOVIE)
    expect(entry.locator('[data-recovery-choice]')).to_have_value('')
    expect(fixture.page.locator('#recovery-apply')).to_be_disabled()
    assert fixture.config == before and fixture.applied == []

    # A rerender caused by an unrelated candidate lookup keeps file diagnosis
    # independent of the replacement selection and the selected search query.
    fixture.entry(PARTIAL).locator('[data-recovery-search]').click()
    expect(fixture.entry(PARTIAL).locator(f'option[value="{MOVIE}"]')).to_have_count(1)
    expect(entry.locator('[data-recovery-file-path]')).to_have_value(VIDEO_PATH)
    expect(entry.locator('[data-recovery-file-details]')).to_have_js_property('open', True)
    expect(result).to_contain_text(fixture.file_report['message'])
    assert len(fixture.file_requests) == 2

    # A result belongs to the checked path. Editing the path removes that
    # result immediately; Enter checks the new literal path without changing a
    # replacement selection or submitting the surrounding settings form.
    new_path = VIDEO_PATH.replace('A New Hope', 'Another movie')
    entry.locator('[data-recovery-file-path]').fill(new_path)
    expect(entry.locator('[data-recovery-file-result]')).to_have_count(0)
    entry.locator('[data-recovery-file-path]').press('Enter')
    expect(result).to_contain_text(fixture.file_report['message'])
    assert fixture.file_requests[-1] == (CHECK_PATH, {'path': new_path})
    assert fixture.config == before and fixture.applied == []
    fixture.finish()


def check_scan_states_and_errors(browser, html):
    fixture = Fixture(browser, html)
    before = deepcopy(fixture.config)
    fixture.open()
    fixture.review()
    entry = fixture.check_file()
    result = entry.locator('[data-recovery-file-result]')
    entry.locator('[data-recovery-file-scan]').click()
    expect(result).to_contain_text('scan queued')
    expect(result).not_to_contain_text(re.compile(r'(?:scan completed|reconnected|linked successfully)', re.I))
    assert fixture.file_requests[-1] == (SCAN_PATH, {'path': VIDEO_PATH})
    assert fixture.config == before and fixture.applied == []

    fixture.scan_report = report(scanState='Running', message='A Jellyfin library scan is already running.')
    entry.locator('[data-recovery-file-scan]').click()
    expect(result).to_contain_text('already running')
    assert fixture.config == before
    fixture.scan_report = report(scanState='AlreadyQueued', message='A Jellyfin library scan is already queued.')
    entry.locator('[data-recovery-file-scan]').click()
    expect(result).to_contain_text('already queued')

    fixture.file_report = report(readable=False, error='Access to the path is denied.',
                                 message='Jellyfin cannot read this video file.')
    entry.locator('[data-recovery-file-check]').click()
    expect(result).to_contain_text('cannot read')
    expect(result).to_contain_text('Access to the path is denied.')
    assert fixture.config == before

    fixture.file_error = 'The file diagnostic is unavailable. Try again.'
    entry.locator('[data-recovery-file-check]').click()
    expect(entry.locator('[data-recovery-file-details] [role="alert"]').first).to_contain_text('file diagnostic is unavailable')
    expect(entry.locator('[data-recovery-file-path]')).to_have_value(VIDEO_PATH)
    fixture.file_error = ''
    fixture.file_report = report()
    entry.locator('[data-recovery-file-check]').click()
    expect(result).to_contain_text(NO_INDEX)
    assert fixture.config == before and fixture.applied == []
    fixture.finish()


def check_dirty_and_empty_index(browser, html):
    # Diagnosing is read-only, so it remains useful with a draft and with no
    # usable native inventory. A scan request still obeys the draft guard.
    fixture = Fixture(browser, html, can_search=False)
    fixture.open()
    fixture.draft('Do not overwrite this draft')
    draft = fixture.page.evaluate('FranchiseSettings.getModel()')
    before = deepcopy(fixture.config)
    fixture.review()
    entry = fixture.file_panel()
    entry.locator('[data-recovery-file-path]').fill(VIDEO_PATH)
    expect(entry.locator('[data-recovery-file-check]')).to_be_enabled()
    expect(entry.locator('[data-recovery-file-scan]')).to_be_disabled()
    entry.locator('[data-recovery-file-check]').click()
    expect(entry.locator('[data-recovery-file-result]')).to_contain_text(NO_INDEX)
    assert fixture.file_requests == [(CHECK_PATH, {'path': VIDEO_PATH})]
    assert fixture.config == before and fixture.applied == []
    assert fixture.page.evaluate('FranchiseSettings.getModel()') == draft
    expect(fixture.page.locator('#save-state')).to_have_text('Unsaved changes')
    fixture.finish()


def check_pending_and_stale_response(browser, html):
    fixture = Fixture(browser, html)
    fixture.open()
    fixture.review()
    entry = fixture.check_file()
    result = entry.locator('[data-recovery-file-result]')
    fixture.hold_file = True
    fixture.file_report = report(message='STALE FILE DIAGNOSIS MUST NOT APPEAR')
    entry.locator('[data-recovery-file-check]').click()
    expect(entry.locator('[data-recovery-file-check]')).to_be_disabled()
    expect(entry.locator('[data-recovery-file-scan]')).to_be_disabled()
    expect(entry.locator('[data-recovery-file-path]')).to_be_disabled()
    expect(fixture.page.locator('#recovery-apply')).to_be_disabled()
    assert len(fixture.held_file) == 1

    # Settings can be reloaded by Jellyfin while its diagnostic request is in
    # flight. The prior response must not overwrite the new recovery report.
    fixture.config['ConfigurationRevision'] += 1
    fixture.status_message = 'Fresh recovery report during file check.'
    fixture.page.evaluate('FranchiseSettings.load()')
    expect(fixture.page.locator('#recovery-notice-count')).to_contain_text('Fresh recovery report during file check')
    route, response = fixture.held_file.pop()
    route.fulfill(json=response)
    expect(entry.locator('[data-recovery-file-check]')).to_be_enabled()
    expect(result).not_to_contain_text('STALE FILE DIAGNOSIS MUST NOT APPEAR')
    expect(entry.locator('[data-recovery-file-path]')).to_have_value(VIDEO_PATH)
    assert fixture.applied == []
    fixture.finish()


def check_mobile_and_escaping(browser, html):
    unsafe = '<img src=x onerror="window.__unsafeFile=true">'
    for width in (320, 390, 1280):
        fixture = Fixture(browser, html, width=width)
        fixture.file_report = report(
            message=unsafe + 'Long diagnostic result ' * 9,
            libraries=[dict(name=unsafe + ' Movies', contentType='movies')],
            items=[dict(itemId=MOVIE, title=unsafe + 'Long video title ' * 15,
                        itemType='Movie', isVirtual=False, supported=True)])
        fixture.open()
        fixture.review()
        entry = fixture.check_file()
        result = entry.locator('[data-recovery-file-result]')
        expect(result).to_contain_text(unsafe)
        expect(result.locator('img')).to_have_count(0)
        assert not fixture.page.evaluate('Boolean(window.__unsafeFile)')
        assert_open_link(result, MOVIE)
        for selector in ('[data-recovery-file-path]', '[data-recovery-file-check]',
                         '[data-recovery-file-scan]', '[data-recovery-file-result]'):
            element = entry.locator(selector)
            assert element.evaluate('(el)=>el.getBoundingClientRect().width <= innerWidth'), (width, selector)
        assert fixture.page.locator('#recovery-dialog').evaluate('(el)=>el.scrollWidth <= el.clientWidth + 1'), width
        assert fixture.page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        fixture.finish()


def run():
    html = generate()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        check_readonly_and_index_results(browser, html)
        check_scan_states_and_errors(browser, html)
        check_dirty_and_empty_index(browser, html)
        check_pending_and_stale_response(browser, html)
        check_mobile_and_escaping(browser, html)
        browser.close()
    print('Recovery file diagnosis browser checks passed: authenticated server file checks, ReadOnly/Archive, '
          'native ID inspection without fabricated links, queued/running scans, errors, drafts, stale replies, '
          'escaped content and 320/390/1280px layouts.')


if __name__ == '__main__':
    run()
