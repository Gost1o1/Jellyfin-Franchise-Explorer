"""Production saved IMDb library and chronological-format UI with offline Jellyfin APIs."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from urllib.parse import urlsplit
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load_module('settings_builder', ROOT / 'scripts/build_settings_page.py')
fixture = load_module('settings_fixture', ROOT / 'scripts/test_settings_v9_browser.py')
HTML = builder.generate()
BOOT = fixture.BOOT + r'''
const initialConfig = window.__config;
ApiClient.getPluginConfiguration = async () => JSON.parse(localStorage.getItem('imdb-ui-config') || JSON.stringify(initialConfig));
ApiClient.updatePluginConfiguration = async (_id, value) => {
  window.__config = structuredClone(value); window.__saved = structuredClone(value);
  localStorage.setItem('imdb-ui-config', JSON.stringify(value));
};
'''


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1280, 'height': 1100})
        page = context.new_page()
        errors, imports = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route(request):
            path = urlsplit(request.request.url).path
            if path == '/settings':
                request.fulfill(content_type='text/html', body=HTML.replace(
                    '<script type="text/javascript">', '<script>' + BOOT + '</script><script type="text/javascript">', 1))
            elif path.endswith('/AutoAdd/Source'):
                imports.append(request.request.url)
                request.fulfill(json=fixture.SOURCE)
            elif path.endswith('/Images') or path.endswith('/LocalTrailers') or path.endswith('/SpecialFeatures'):
                request.fulfill(json=[])
            elif path.endswith('/ThemeMedia'):
                request.fulfill(json={'ThemeVideosResult': {'Items': []}})
            else:
                request.fulfill(status=404)

        page.route('http://jellyfin.test/**', route)
        page.goto('http://jellyfin.test/settings')
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        model = lambda: page.evaluate('FranchiseSettings.getModel()')
        page.locator('#settings > summary').click()
        page.locator('#advanced > summary').click()
        page.locator('#add-imdb-list').click()
        page.locator('#imdb-list-name').fill('Cancelled list')
        page.locator('#imdb-list-url').fill('https://www.imdb.com/list/ls999/')
        page.locator('#imdb-list-dialog').get_by_role('button', name='Cancel', exact=True).click()
        assert model()['ImdbLists'] == []

        def add_list(name, url):
            page.locator('#add-imdb-list').click()
            page.locator('#imdb-list-name').fill(name)
            page.locator('#imdb-list-url').fill(url)
            page.locator('#save-imdb-list').click()
            expect(page.locator('#imdb-list-dialog')).not_to_be_visible()

        add_list('MCU timeline', 'https://imdb.com/list/ls111')
        add_list('Second timeline', 'https://www.imdb.com/list/ls222/')
        lists = model()['ImdbLists']
        assert [value['Url'] for value in lists] == [
            'https://www.imdb.com/list/ls111/', 'https://www.imdb.com/list/ls222/']
        assert imports == [], 'Saving source presets must never import media'
        assert page.evaluate('__saved === null')
        first, second = [value['Id'] for value in lists]
        page.locator(f'[data-edit-imdb-list="{first}"]').click()
        page.locator('#imdb-list-name').fill('MCU revised')
        page.locator('#save-imdb-list').click()
        assert [value['Id'] for value in model()['ImdbLists']] == [first, second], 'Editing retains preset position and identity'
        page.locator('#save').click()
        page.reload()
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        assert model()['ImdbLists'][0]['Name'] == 'MCU revised'
        assert len(model()['ImdbLists']) == 2

        def open_node():
            page.locator('#franchises').evaluate('(el) => el.open = true')
            page.locator(f'[data-settings-node="{fixture.NODE}"]').click()
            page.locator('#franchise-auto-add').click()

        def pick_both():
            page.locator('#choose-franchise-imdb-lists').click()
            for ident in [first, second]:
                page.locator(f'[data-saved-imdb-list="{ident}"]').check()
            page.locator('#use-imdb-sources').click()

        # Choosing sources in a cancelled franchise dialog has no side effects.
        open_node()
        pick_both()
        page.locator('#franchise-dialog').get_by_role('button', name='Cancel', exact=True).click()
        assert model()['Nodes'][0]['AutoAddSources'] == []
        assert imports == []
        open_node()
        pick_both()
        page.locator('#franchise-episode-format').select_option('Individual')
        page.locator('#franchise-preview').click()
        review = page.locator('#review')
        expect(review).to_be_visible()
        assert len(imports) == 2, imports
        episode_rows = review.locator('tr').filter(has_text='S01E01')
        expect(episode_rows).to_have_count(1)
        expect(episode_rows.locator('td').nth(2)).to_have_text('Episode')
        for index in [1, 2, 3]:
            expect(review.locator('tr').filter(has_text=f'S01E{index:02}')).to_have_count(1)
        assert review.locator('[data-review-cell]:enabled:not(:checked)').count() == 0
        count = len(imports)
        review.locator(f'[data-review-format-row="{fixture.CHRONO}"]').select_option('Bundles')
        expect(review.locator('tr').filter(has_text='S01E01–S01E03')).to_have_count(1)
        assert len(imports) == count, 'Switching review format reuses fetched IMDb/library data'
        review.locator(f'[data-review-format-row="{fixture.CHRONO}"]').select_option('Individual')
        expect(review.locator('tr').filter(has_text='S01E03')).to_have_count(1)
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        sources = model()['Nodes'][0]['AutoAddSources']
        assert len(sources) == 2
        assert set(source['Id'] for source in sources).isdisjoint({first, second}), 'Assignments own independent IDs'
        episode_links = [value for value in model()['MediaLinks'] if value['ItemType'] == 'Series']
        assert len(episode_links) == 3
        assert all(value['StartEpisode'] == value['EndEpisode'] for value in episode_links)
        manual = next(value for value in model()['MediaLinks'] if value['Id'] == fixture.LINK)
        assert manual['DisplayName'] == 'Captain America', 'Manual reference is preserved'
        page.locator('#save-franchise').click()
        page.locator('#save').click()
        page.reload()
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        assert len([value for value in model()['MediaLinks'] if value['ItemType'] == 'Series']) == 3
        assert model()['Nodes'][0]['AutoAddSources'] == sources

        # Deleting a reusable preset never deletes its assigned source; Undo restores it.
        page.locator('#settings').evaluate('(el) => el.open = true')
        page.locator('#advanced').evaluate('(el) => el.open = true')
        page.locator(f'[data-delete-imdb-list="{first}"]').click()
        assert len(model()['ImdbLists']) == 1
        assert model()['Nodes'][0]['AutoAddSources'] == sources
        page.locator('#undo').click()
        assert [value['Id'] for value in model()['ImdbLists']] == [first, second]

        # Direct row preview narrows inherited sources without losing node-owned import records.
        page.locator('#franchises').evaluate('(el) => el.open = true')
        page.locator(f'[data-expand="{fixture.NODE}"]').click()
        page.locator(f'[data-settings-row="{fixture.CHRONO}"]').click()
        page.locator('#row-auto-add').click()
        page.locator('#row-episode-format').select_option('Bundles')
        before = model()
        sibling = next(value for value in before['Rows'] if value['Id'] == fixture.TV)
        page.locator('#row-preview').click()
        expect(review).to_be_visible()
        expect(review.locator('tr').filter(has_text='S01E01–S01E03')).to_have_count(1)
        destinations = review.locator('.where-cell').all_text_contents()
        assert all('Chronological' in value for value in destinations), destinations
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        assert next(value for value in model()['Rows'] if value['Id'] == fixture.TV) == sibling
        assert model()['Nodes'][0]['AutoAddSources'] == sources
        assert len([value for value in model()['MediaLinks'] if value['ItemType'] == 'Series']) == 1
        page.locator('#row-dialog').get_by_role('button', name='Cancel', exact=True).click()

        # The opposite transition also previews and replaces an existing node-owned bundle.
        page.locator(f'[data-settings-row="{fixture.CHRONO}"]').click()
        page.locator('#row-auto-add').click()
        page.locator('#row-episode-format').select_option('Individual')
        page.locator('#row-preview').click()
        expect(review).to_be_visible()
        for index in [1, 2, 3]:
            additions = review.locator('tr').filter(has=page.locator('.change-pill.add')).filter(has_text=f'S01E{index:02}')
            expect(additions).to_have_count(1)
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        assert len([value for value in model()['MediaLinks'] if value['ItemType'] == 'Series']) == 3
        assert next(value for value in model()['Rows'] if value['Id'] == fixture.TV) == sibling
        assert model()['Nodes'][0]['AutoAddSources'] == sources
        assert next(value for value in model()['Rows'] if value['Id'] == fixture.CHRONO)['SourceUrl'] == ''
        page.locator('#row-dialog').get_by_role('button', name='Cancel', exact=True).click()

        # Existing inline actions and all source controls fit narrow phone widths.
        for width in [390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.locator('#settings').evaluate('(el) => el.open = true')
            page.locator('#advanced').evaluate('(el) => el.open = true')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.locator(f'[data-settings-node="{fixture.NODE}"]').click()
            page.locator('#franchise-auto-add').click()
            page.locator('#choose-franchise-imdb-lists').click()
            assert page.evaluate('document.querySelector("#imdb-source-picker").scrollWidth <= document.querySelector("#imdb-source-picker").clientWidth + 1')
            page.locator('#imdb-source-picker').get_by_role('button', name='Cancel', exact=True).click()
            page.locator('#franchise-dialog').get_by_role('button', name='Cancel', exact=True).click()

        # A row-only first import persists its mapping and respects a later UI deletion.
        page.set_viewport_size({'width': 1280, 'height': 1100})
        unmapped = json.loads(json.dumps(fixture.CONFIG))
        unmapped['Nodes'][0]['AutoAddSources'] = [dict(
            Id=fixture.gid(950), Url='https://www.imdb.com/list/ls111/', Enabled=True,
            Priority=0, Categories=['Chronological Timeline'])]
        unmapped['Nodes'][0]['AutoAddRows'] = []
        page.evaluate('(config) => localStorage.setItem("imdb-ui-config", JSON.stringify(config))', unmapped)
        page.reload()
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        original_rows = [value['Id'] for value in model()['Rows']]
        page.locator('#franchises').evaluate('(el) => el.open = true')
        page.locator(f'[data-expand="{fixture.NODE}"]').click()
        page.locator(f'[data-settings-row="{fixture.CHRONO}"]').click()
        page.locator('#row-auto-add').click()
        page.locator('#row-preview').click()
        expect(review).to_be_visible()
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        assert [value['Id'] for value in model()['Rows']] == original_rows
        mapping = dict(Category='Chronological Timeline', RowId=fixture.CHRONO)
        assert model()['Nodes'][0]['AutoAddRows'] == [mapping]
        page.locator('#row-dialog').get_by_role('button', name='Cancel', exact=True).click()
        page.locator(f'[data-delete-row="{fixture.CHRONO}"]').click()
        page.locator('#confirm-delete').click()
        assert not any(value['Id'] == fixture.CHRONO for value in model()['Rows'])
        assert model()['Nodes'][0]['AutoAddRows'] == [mapping]
        assert page.evaluate('''(id) => {
          const planned = FranchiseSettings.getModel();
          return FranchiseSettings.core.scopedJobs(planned, id).length === 0 &&
            planned.Rows.every(row => row.RowType !== 'Timeline');
        }''', fixture.NODE), 'A deleted mapped row must not be recreated by the next Auto Add'
        assert not errors, errors
        browser.close()
    print('PASS saved IMDb library and episode-format UI: CRUD/Undo/Save/reload, multi-source assignment, scoped review/cache, manual preservation and mobile layout')


if __name__ == '__main__':
    run()
