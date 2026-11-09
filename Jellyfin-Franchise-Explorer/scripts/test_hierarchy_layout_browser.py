"""Verify row memberships and ordered packing using the production settings sources."""
from copy import deepcopy
import json
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from build_settings_page import generate
from test_settings_v9_browser import BOOT, CONFIG, gid


ROOTS = [gid(1100 + index) for index in range(11)]
MARVEL, PHASES, SPARE = ROOTS[2], gid(1300), gid(1250)
GROUPS = [gid(1200 + index) for index in range(6)]
FIXTURE = deepcopy(CONFIG)
FIXTURE.update(Nodes=[dict(Id=ident, ParentId='', Name='Marvel' if index == 2 else f'Franchise {index + 1}',
    NodeType='Franchise', SortOrder=index) for index, ident in enumerate(ROOTS)] +
    [dict(Id=ident, ParentId=MARVEL, Name=f'Phase {index + 1}', NodeType='Custom', SortOrder=index)
     for index, ident in enumerate(GROUPS)] +
    [dict(Id=SPARE, ParentId=MARVEL, Name='Unassigned group', NodeType='Custom', SortOrder=6)],
    Rows=[dict(Id=PHASES, ParentNodeId=MARVEL, Name='Phases', Category='Sub Group', RowType='Groups',
        SortOrder=0, NodeIds=GROUPS, MediaLinkIds=[], Items=[], MediaOrder=[])], MediaLinks=[])


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium'
            if Path('/usr/bin/chromium').exists() else None, args=['--no-sandbox'])
        errors = []
        context = browser.new_context(viewport={'width': 1280, 'height': 1100})
        page = context.new_page()
        page.add_init_script('''(() => {
            const frame = window.requestAnimationFrame.bind(window);
            window.__layoutFrames = 0;
            window.requestAnimationFrame = callback => frame(time => {
                if(callback.name === 'layoutBoard') window.__layoutFrames++;
                callback(time);
            });
        })();''')
        page.on('pageerror', lambda error: errors.append(str(error)))
        server = {'config': deepcopy(FIXTURE), 'saves': 0}
        override = '''
ApiClient.getPluginConfiguration=async()=>structuredClone(window.__fixture);
ApiClient.updatePluginConfiguration=async(id,value)=>{
 const response=await fetch('/configuration',{method:'POST',body:JSON.stringify(value)});
 if(!response.ok)throw Error('Save failed');window.__fixture=await response.json();
};'''

        def route(request):
            path = urlsplit(request.request.url).path
            if path == '/settings':
                boot = BOOT + '\nwindow.__fixture=' + json.dumps(server['config']) + ';' + override
                request.fulfill(content_type='text/html', body=generate().replace(
                    '<script type="text/javascript">', '<script>' + boot + '</script><script type="text/javascript">', 1))
            elif path == '/configuration' and request.request.method == 'POST':
                server['config'] = json.loads(request.request.post_data)
                server['saves'] += 1
                request.fulfill(json=server['config'])
            else:
                request.fulfill(status=404)

        page.route('http://jellyfin.test/**', route)
        board = page.locator('#board')
        model = lambda: page.evaluate('FranchiseSettings.getModel()')
        revision = lambda: page.evaluate('FranchiseSettings.getRevision()')
        row = lambda: next(entry for entry in model()['Rows'] if entry['Id'] == PHASES)

        def load():
            page.goto('http://jellyfin.test/settings')
            page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
            page.locator('#franchises').evaluate('(el)=>el.open=true')
            board.locator(f'[data-expand="{MARVEL}"]').click()
            page.wait_for_timeout(100)

        def assert_sequence():
            assert board.locator(':scope > .node-card').evaluate_all('(cards)=>cards.map(el=>el.dataset.id)') == ROOTS
            assert [entry['Id'] for entry in sorted((node for node in model()['Nodes'] if not node['ParentId']),
                key=lambda node: node['SortOrder'])] == ROOTS

        load()
        baseline, start_revision = model(), revision()
        expect(board.locator(f'[data-row-entry="{PHASES}"] .row-count')).to_have_text('6 groups')
        for ident in GROUPS:
            assert board.locator(f'[data-id="{ident}"][data-drop="node"]').count() == 1
            assert board.locator(f'[data-row-entry="{PHASES}"] [data-id="{ident}"][data-drop="node"]').count() == 1
        cards = board.locator(':scope > .node-card').evaluate_all('''cards=>cards.map(el=>{
            const b=el.getBoundingClientRect();return {left:b.left,top:b.top,bottom:b.bottom,height:b.height}})''')
        assert len({round(card['left']) for card in cards[:3]}) == 3, cards
        assert cards[3]['top'] < cards[2]['bottom'] and cards[4]['top'] < cards[2]['bottom'], cards
        assert abs(cards[3]['top'] - cards[0]['bottom'] - 12) < 1, cards
        assert_sequence()

        # Expansion and responsive packing have no configuration/history effects.
        toggle = board.locator(f'[data-toggle-row="{PHASES}"]')
        toggle.click()
        assert board.locator(f'[data-id="{GROUPS[0]}"]').count() == 0
        board.locator(f'[data-expand="{ROOTS[0]}"]').click()
        assert board.locator(f'[data-toggle-row="{PHASES}"]').get_attribute('aria-expanded') == 'false'
        toggle.click()
        for width in (950, 390, 320, 1280):
            page.set_viewport_size({'width': width, 'height': 1100})
            page.wait_for_timeout(100)
            assert_sequence()
            assert model() == baseline and revision() == start_revision
            expect(page.locator('#undo')).to_be_disabled()
            expect(page.locator('#save-state')).to_have_text('All changes saved')
            if width in (320, 390):
                boxes = board.locator('.node-head,.tree-row').evaluate_all('''heads=>heads.map(head=>{
                    const b=head.getBoundingClientRect();return [...head.querySelectorAll(':scope > .node-actions > button,:scope > .row-actions > button')]
                      .every(button=>{const a=button.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1})})''')
                assert all(boxes), (width, boxes)
        settled = page.evaluate('__layoutFrames')
        page.wait_for_timeout(150)
        assert page.evaluate('__layoutFrames') == settled, 'ResizeObserver must settle after packing'

        # Reorder cards in the packed two-dimensional layout, retaining ownership.
        source = board.locator(f':scope > [data-id="{ROOTS[-1]}"] > .node-head > .grip')
        target = board.locator(f':scope > [data-id="{ROOTS[3]}"] > .node-head')
        source.scroll_into_view_if_needed()
        target.scroll_into_view_if_needed()
        start, end = source.bounding_box(), target.bounding_box()
        page.mouse.move(start['x'] + start['width']/2, start['y'] + start['height']/2)
        page.mouse.down()
        page.mouse.move(start['x'] + start['width']/2 + 8, start['y'] + start['height']/2, steps=2)
        page.wait_for_timeout(100)
        target.scroll_into_view_if_needed()
        end = target.bounding_box()
        page.mouse.move(end['x'] + end['width']*.25, end['y'] + end['height']/2, steps=12)
        page.mouse.up()
        actual = board.locator(':scope > .node-card').evaluate_all('(cards)=>cards.map(el=>el.dataset.id)')
        assert actual == ROOTS[:3] + [ROOTS[-1]] + ROOTS[3:-1], actual
        page.locator('#undo').click()
        assert model() == baseline
        assert_sequence()

        # The plus action creates an owned child and saves presentation membership.
        board.locator(f'[data-add-row="{PHASES}"]').click()
        page.locator('#choose-add-subgroup').click()
        page.locator('#subgroup-name').fill('Phase Seven')
        page.locator('#confirm-subgroup').click()
        created = next(node for node in model()['Nodes'] if node['Name'] == 'Phase Seven')
        assert created['ParentId'] == MARVEL and created['Id'] in row()['NodeIds']
        expect(board.locator(f'[data-row-entry="{PHASES}"] .row-count')).to_have_text('7 groups')
        page.locator('#undo').click()
        assert model() == baseline

        # Actual pointer dragging into a row edits membership, retaining ownership.
        source = board.locator(f'[data-drag-id="{SPARE}"]')
        target = board.locator(f'.tree-row[data-id="{PHASES}"]')
        source.scroll_into_view_if_needed()
        target.scroll_into_view_if_needed()
        start, end = source.bounding_box(), target.bounding_box()
        page.mouse.move(start['x'] + start['width']/2, start['y'] + start['height']/2)
        page.mouse.down()
        page.mouse.move(end['x'] + end['width']/2, end['y'] + end['height']/2, steps=12)
        page.mouse.up()
        assert SPARE in row()['NodeIds']
        assert next(node for node in model()['Nodes'] if node['Id'] == SPARE)['ParentId'] == MARVEL
        assert board.locator(f'[data-row-entry="{PHASES}"] [data-id="{SPARE}"][data-drop="node"]').count() == 1
        page.locator('#save').click()
        page.wait_for_function('document.querySelector("#save-state").textContent === "All changes saved"')
        assert server['saves'] == 1
        saved = model()
        load()
        assert model() == saved and SPARE in row()['NodeIds']
        expect(page.locator('#undo')).to_be_disabled()

        # Removing the presentation row keeps owned nodes and their other references.
        board.locator(f'[data-delete-row="{PHASES}"]').click()
        page.locator('#confirm-delete').click()
        assert all(any(node['Id'] == ident for node in model()['Nodes']) for ident in GROUPS + [SPARE])
        page.locator('#undo').click()
        assert model() == saved

        # Keyboard placement exposes the same row membership operation on mobile.
        board.locator(f'[data-drag-id="{SPARE}"]').press('Enter')
        expect(page.locator('#move-parent')).to_have_value('row:' + PHASES)
        page.locator('#move-parent').select_option(MARVEL)
        page.locator('#confirm-move').click()
        assert SPARE not in row()['NodeIds']
        page.locator('#undo').click()
        assert model() == saved

        # Two rows can reference one owned child in separate rendering contexts.
        duplicate = deepcopy(server['config']['Rows'][0])
        duplicate.update(Id=gid(1301), Name='Featured groups', NodeIds=[GROUPS[0]], SortOrder=1)
        server['config']['Rows'].append(duplicate)
        load()
        assert board.locator(f'[data-id="{GROUPS[0]}"][data-drop="node"]').count() == 2
        assert board.locator(f'[data-row-entry="{PHASES}"] [data-id="{GROUPS[0]}"][data-drop="node"]').count() == 1
        assert board.locator(f'[data-row-entry="{gid(1301)}"] [data-id="{GROUPS[0]}"][data-drop="node"]').count() == 1
        assert not errors, errors
        browser.close()
    print('Hierarchy and ordered masonry browser tests passed.')


if __name__ == '__main__':
    run()
