"""Exercise real settings media dragging and persistence against a mock Jellyfin server."""
from copy import deepcopy
from pathlib import Path
import re
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from test_settings_v9_browser import (
    HTML, BOOT, CONFIG, NODE, CHILD, CHRONO, MOVIES, TV, CUSTOM, COLLECTION,
    LINK, MOVIE1, MOVIE2, SHOW, BOX, gid, entry, row,
)

RANGE_A, DIRECT_MOVIE, RANGE_B = [gid(n) for n in range(301, 304)]
CHILD_ROW = gid(310)
FIXTURE = deepcopy(CONFIG)


def ranged(ident, first, last):
    value = entry(ident, SHOW, 'Agent Carter', 'Series')
    value.update(RangeMode='Episodes', StartSeason=1, EndSeason=1,
                 StartEpisode=first, EndEpisode=last)
    return value


FIXTURE['MediaLinks'][0]['Artwork'] = {'PrimaryUrl': '/Items/' + MOVIE1 + '/Images/Primary/0'}
FIXTURE['Rows'] = [
    row(CHRONO, 'Chronological Order', 'Timeline', Category='Chronological Order'),
    row(MOVIES, 'Movies', 'Media', Category='Movies'),
    row(TV, 'TV Shows', 'Media', Category='TV Shows'),
    row(CUSTOM, 'Custom order', 'Mixed', Category='Custom'),
    row(COLLECTION, 'Collection', 'Media', Category='Collection'),
    row(CHILD_ROW, 'Movies', 'Media', Category='Movies'),
]
FIXTURE['Rows'][0].update(Items=[ranged(301, 1, 3), entry(302, MOVIE2, 'Iron Man'), ranged(303, 4, 6)],
                          MediaLinkIds=[LINK], MediaOrder=[LINK, RANGE_A, DIRECT_MOVIE, RANGE_B])
FIXTURE['Rows'][1].update(Items=[entry(304, MOVIE2, 'Iron Man')], MediaLinkIds=[LINK],
                          MediaOrder=[LINK, gid(304)])
FIXTURE['Rows'][2].update(Items=[ranged(305, 1, 3), ranged(306, 4, 6)],
                          MediaOrder=[gid(305), gid(306)])
FIXTURE['Rows'][3].update(Items=[entry(307, BOX, 'Collection', 'BoxSet'),
                                entry(308, SHOW, 'Agent Carter', 'Series')],
                          MediaLinkIds=[LINK], MediaOrder=[gid(307), LINK, gid(308)])
FIXTURE['Rows'][4].update(Items=[entry(309, BOX, 'Collection A', 'BoxSet'),
                                entry(311, gid(109), 'Collection B', 'BoxSet')],
                          MediaOrder=[gid(309), gid(311)])
FIXTURE['Rows'][5].update(ParentNodeId=CHILD,
                          Items=[entry(312, MOVIE1, 'Captain America'), entry(313, MOVIE2, 'Iron Man')],
                          MediaOrder=[gid(312), gid(313)])


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium'
            if Path('/usr/bin/chromium').exists() else None, args=['--no-sandbox'])
        errors = []

        def make_page(mobile=False):
            context = browser.new_context(viewport={'width': 390 if mobile else 1280,
                                                    'height': 844 if mobile else 1100},
                                          is_mobile=mobile, has_touch=mobile)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            server = {'config': deepcopy(FIXTURE), 'saves': 0}
            override = '''
ApiClient.getPluginConfiguration=async()=>{const r=await fetch('/configuration');return r.json();};
ApiClient.updatePluginConfiguration=async(id,value)=>{
 const r=await fetch('/configuration',{method:'POST',body:JSON.stringify(value)});
 if(!r.ok)throw Error('Save failed');window.__saved=await r.json();
};'''

            def route(request):
                path = urlsplit(request.request.url).path
                if path == '/settings':
                    request.fulfill(content_type='text/html', body=HTML.replace(
                        '<script type="text/javascript">', '<script>' + BOOT + override +
                        '</script><script type="text/javascript">', 1))
                elif path == '/configuration':
                    if request.request.method == 'POST':
                        server['config'] = request.request.post_data_json
                        server['saves'] += 1
                    request.fulfill(json=server['config'])
                else:
                    request.fulfill(status=404)

            page.route('http://jellyfin.test/**', route)
            page.goto('http://jellyfin.test/settings')
            page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
            return page, server, context

        page, server, context = make_page()
        model = lambda: page.evaluate('FranchiseSettings.getModel()')
        revision = lambda: page.evaluate('FranchiseSettings.getRevision()')
        board = page.locator('#board')
        modal = page.locator('#media-dialog')
        last_drag = {}

        def expand_all():
            page.locator('#franchises').evaluate('(el)=>el.open=true')
            for node_id in (NODE, CHILD):
                button = board.locator(f'[data-expand="{node_id}"]')
                if button.get_attribute('aria-expanded') != 'true':
                    button.click()
            for row_id in (CHRONO, MOVIES, TV, CUSTOM, COLLECTION, CHILD_ROW):
                button = board.locator(f'[data-toggle-row="{row_id}"]')
                if button.get_attribute('aria-expanded') != 'true':
                    button.click()

        def media_entry(row_id, ref_id, scope=None):
            return (scope or board).locator(
                f'[data-media-row="{row_id}"][data-media-item="{ref_id}"]')

        def drag(row_id, ref_id, target_id, *, below=False, scope=None, target_row=None,
                 cancel=False):
            handle = media_entry(row_id, ref_id, scope).locator('.grip')
            target = media_entry(target_row or row_id, target_id, scope)
            handle.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})")
            target.scroll_into_view_if_needed()
            start, end = handle.bounding_box(), target.bounding_box()
            page.mouse.move(start['x'] + start['width']/2, start['y'] + start['height']/2)
            page.mouse.down()
            page.mouse.move(end['x'] + end['width']/2,
                            end['y'] + end['height']*(.8 if below else .2), steps=12)
            last_drag.update(page.evaluate('''({x,y})=>({x,y,point:document.elementFromPoint(x,y)?.outerHTML,
                active:document.querySelector('#FranchiseExplorerConfigPage').className,
                markers:[...document.querySelectorAll('.drop-before,.drop-after')].map(el=>el.dataset),
                scroll:document.scrollingElement.scrollTop})''',
                {'x': end['x'] + end['width']/2, 'y': end['y'] + end['height']*(.8 if below else .2)}))
            if scope is not None:
                expect(modal.locator('.drag-ghost')).to_be_visible()
            if cancel:
                page.locator('#FranchiseExplorerConfigPage').dispatch_event('pointercancel', {'pointerId': 1})
            page.mouse.up()

        def order(row_id):
            return next(r['MediaOrder'] for r in model()['Rows'] if r['Id'] == row_id)

        def touch_drag(row_id, ref_id, target_id, scope=None):
            handle = media_entry(row_id, ref_id, scope).locator('.grip')
            target = media_entry(row_id, target_id, scope)
            handle.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})")
            target.scroll_into_view_if_needed()
            start, end = handle.bounding_box(), target.bounding_box()
            assert start['width'] >= 44 and start['height'] >= 44, 'Media grips need touch targets'
            cdp = context.new_cdp_session(page)
            start_x, start_y = start['x'] + start['width']/2, start['y'] + start['height']/2
            end_x, end_y = end['x'] + 40, end['y'] + end['height']*.2
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart',
                'touchPoints': [{'x': start_x, 'y': start_y}]})
            for step in range(1, 9):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{
                    'x': start_x + (end_x-start_x)*step/8,
                    'y': start_y + (end_y-start_y)*step/8}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            cdp.detach()

        def only_order_changed(before, row_id):
            after = model()
            next(r for r in after['Rows'] if r['Id'] == row_id)['MediaOrder'] = next(
                r['MediaOrder'] for r in before['Rows'] if r['Id'] == row_id)
            assert after == before, 'Reordering must preserve IDs, memberships, ranges, artwork and other rows'

        expand_all()
        baseline = model()
        original = order(CHRONO)
        drag(CHRONO, RANGE_B, LINK)
        assert order(CHRONO) == [RANGE_B, LINK, RANGE_A, DIRECT_MOVIE]
        only_order_changed(baseline, CHRONO)
        drag(CHRONO, LINK, DIRECT_MOVIE, below=True)
        assert order(CHRONO) == [RANGE_B, RANGE_A, DIRECT_MOVIE, LINK]
        page.locator('#undo').click()
        page.locator('#undo').click()
        assert model() == baseline

        # Invalid cross-row movement, self-drops, and cancellation leave no edit/history.
        before_revision = revision()
        drag(CHRONO, LINK, LINK)
        drag(CHRONO, RANGE_B, gid(304), target_row=MOVIES)
        drag(CHRONO, RANGE_B, LINK, cancel=True)
        assert model() == baseline and revision() == before_revision
        # Secondary pointers cannot hijack or end the primary drag.
        handle = media_entry(CHRONO, RANGE_B).locator('.grip')
        handle.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})")
        target = media_entry(CHRONO, LINK)
        start, end = handle.bounding_box(), target.bounding_box()
        page.mouse.move(start['x']+start['width']/2, start['y']+start['height']/2)
        page.mouse.down()
        page.mouse.move(end['x']+end['width']/2, end['y']+end['height']*.2, steps=12)
        for event in ('pointermove', 'pointerup', 'pointercancel'):
            page.locator('#FranchiseExplorerConfigPage').dispatch_event(event,
                {'pointerId': 999, 'isPrimary': False, 'clientX': 0, 'clientY': 0})
        expect(page.locator('#FranchiseExplorerConfigPage')).to_have_class(re.compile('is-dragging-media'))
        page.mouse.up()
        assert order(CHRONO) == [RANGE_B, LINK, RANGE_A, DIRECT_MOVIE]
        page.locator('#undo').click()

        # All row categories and rows nested in subgroups expose the same behavior.
        for row_id in (MOVIES, TV, CUSTOM, COLLECTION, CHILD_ROW):
            before = model()
            ids = order(row_id)
            drag(row_id, ids[-1], ids[0])
            assert order(row_id) == [ids[-1]] + ids[:-1], (row_id, order(row_id), ids, last_drag, errors)
            only_order_changed(before, row_id)
            page.locator('#undo').click()
            assert model() == before

        handle = media_entry(CHRONO, RANGE_B).locator('.grip')
        handle.press('Alt+ArrowUp')
        assert order(CHRONO) == [LINK, RANGE_A, RANGE_B, DIRECT_MOVIE]
        expect(media_entry(CHRONO, RANGE_B).locator('.grip')).to_be_focused()
        expect(page.locator('#drag-status')).to_contain_text('position 3 of 4')
        page.locator('#undo').click()
        media_entry(CHRONO, RANGE_B).locator('.grip').press('Enter')
        expect(page.locator('#move-scope')).to_contain_text('Chronological Order')
        expect(page.locator('#move-parent')).not_to_be_visible()
        page.locator('#move-position').select_option('0')
        page.locator('#confirm-move').click()
        assert order(CHRONO) == [RANGE_B, LINK, RANGE_A, DIRECT_MOVIE]
        expect(media_entry(CHRONO, RANGE_B).locator('.grip')).to_be_focused()
        page.locator('#undo').click()

        # Reordering also works in the plus popup, where dragging used to be blocked.
        board.locator(f'[data-add-row="{CHRONO}"]').click()
        expect(modal.locator('[data-library-search]')).to_be_focused()
        drag(CHRONO, RANGE_B, LINK, scope=modal)
        assert order(CHRONO) == [RANGE_B, LINK, RANGE_A, DIRECT_MOVIE]
        modal.locator('#media-undo').click()
        assert order(CHRONO) == original
        media_entry(CHRONO, RANGE_B, modal).locator('.grip').press('Enter')
        page.locator('#move-position').select_option('0')
        page.locator('#confirm-move').click()
        expect(media_entry(CHRONO, RANGE_B, modal).locator('.grip')).to_be_focused()
        modal.locator('[data-close="media-dialog"]').first.click()
        only_order_changed(baseline, CHRONO)
        saved_order = order(CHRONO)
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')
        assert server['saves'] == 1
        assert next(r['MediaOrder'] for r in server['config']['Rows'] if r['Id'] == CHRONO) == saved_order
        page.reload()
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        assert order(CHRONO) == saved_order
        expand_all()
        assert board.locator(f'[data-media-row="{CHRONO}"]').evaluate_all(
            '(els)=>els.map(el=>el.dataset.mediaItem)') == saved_order
        context.close()

        # Real Chromium touch events exercise pointer capture on a narrow screen.
        for width in (390, 320):
            page, server, context = make_page(mobile=True)
            page.set_viewport_size({'width': width, 'height': 844})
            board = page.locator('#board')
            modal = page.locator('#media-dialog')
            expand_all()
            # Search opens only on a deliberate tap; a title added now and an existing
            # title can both be reordered immediately in this same row.
            board.locator(f'[data-add-row="{CUSTOM}"]').click()
            search = modal.locator('[data-library-search]')
            expect(search).not_to_be_focused()
            search.tap()
            expect(search).to_be_focused()
            search.fill('Iron Man')
            add = modal.locator(f'[data-library-add="{MOVIE2}"]')
            expect(add).to_be_visible()
            add.tap()
            expect(modal.locator(f'[data-media-row="{CUSTOM}"]')).to_have_count(4)
            added = next(r for r in model()['Rows'] if r['Id'] == CUSTOM)['Items'][-1]['Id']
            before = model()
            original = order(CUSTOM)
            touch_drag(CUSTOM, added, original[0], modal)
            assert order(CUSTOM) == [added] + original[:-1], f'New media touch reorder at {width}px'
            only_order_changed(before, CUSTOM)
            touch_drag(CUSTOM, LINK, added, modal)
            assert order(CUSTOM) == [LINK, added, gid(307), gid(308)]
            actions = modal.locator('.media-actions')
            assert actions.evaluate_all('''els=>els.every(el=>{
                const row=el.closest('.media-entry').getBoundingClientRect(), box=el.getBoundingClientRect();
                return box.left>=row.left && box.right<=row.right+1;
            })'''), f'Media actions must stay inside their cards at {width}px'
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            for _ in range(3):
                modal.locator('#media-undo').click()
            modal.locator('[data-close="media-dialog"]').first.click()

            for popup in (False, True):
                if popup:
                    board.locator(f'[data-add-row="{TV}"]').click()
                    expect(modal.locator('[data-library-search]')).not_to_be_focused()
                    expect(modal.locator('[data-close="media-dialog"]').first).to_be_focused()
                scope = modal if popup else None
                touch_drag(TV, gid(306), gid(305), scope)
                assert order(TV) == [gid(306), gid(305)], f'Touch reorder at {width}px, popup={popup}'
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.locator('#media-undo' if popup else '#undo').click()
                if popup:
                    modal.locator('[data-close="media-dialog"]').first.click()
            context.close()

        # Holding near the popup's lower edge scrolls a long media list, not the background page.
        page, server, context = make_page()
        page.set_viewport_size({'width': 1280, 'height': 700})
        additions = [entry(n, gid(n+1000), 'Movie ' + str(n)) for n in range(500, 530)]
        server['config']['Rows'][0]['Items'] += additions
        server['config']['Rows'][0]['MediaOrder'] += [ref['Id'] for ref in additions]
        page.reload()
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        board = page.locator('#board')
        modal = page.locator('#media-dialog')
        expand_all()
        board.locator(f'[data-add-row="{CHRONO}"]').click()
        handle = media_entry(CHRONO, LINK, modal).locator('.grip')
        handle.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})")
        before = model()
        start = handle.bounding_box()
        body = modal.locator('#media-current')
        bounds = body.bounding_box()
        outer = modal.locator('#media-body').bounding_box()
        visible_bottom = min(bounds['y']+bounds['height'], outer['y']+outer['height'])
        scroll = body.evaluate('(el)=>el.scrollTop')
        background = page.evaluate('document.scrollingElement.scrollTop')
        page.mouse.move(start['x']+start['width']/2, start['y']+start['height']/2)
        page.mouse.down()
        page.mouse.move(bounds['x']+bounds['width']/2, visible_bottom-12, steps=12)
        page.wait_for_function('start=>document.querySelector("#media-current").scrollTop>start+200', arg=scroll)
        page.mouse.up()
        assert order(CHRONO).index(LINK)>3
        assert page.evaluate('document.scrollingElement.scrollTop')==background
        only_order_changed(before, CHRONO)
        first = order(CHRONO)[0]
        grip = media_entry(CHRONO, first, modal).locator('.grip')
        grip.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})")
        grip.press('Enter')
        page.locator('#move-position').select_option(str(len(order(CHRONO))))
        page.locator('#confirm-move').click()
        expect(media_entry(CHRONO, first, modal).locator('.grip')).to_be_focused()
        expect(media_entry(CHRONO, first, modal).locator('.grip')).to_be_in_viewport()
        context.close()
        assert not errors, errors
        browser.close()
        print('PASS row media ordering: pointer/touch/keyboard, all categories/subgroups, '
              'popup focus, newly added media, touch targets, cancellation, isolated metadata, Undo and Save/reload')


if __name__ == '__main__':
    run()
