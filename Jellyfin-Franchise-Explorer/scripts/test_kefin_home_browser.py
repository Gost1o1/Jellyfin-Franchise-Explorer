#!/usr/bin/env python3
"""Production injector against the upstream KefinTweaks Enhanced Home DOM contract.

The fixture reproduces HomeScreen3's hidden native .sectionN rows and separately
painted data-section-id shelves, not a complete live Jellyfin/Kefin installation.
Source contract reviewed at ranaldsgift/KefinTweaks b1328ced54316293aead138c05d560ea5b50e0b1.
"""
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
TILE = '#franchise-explorer-my-media-tile'
SHELF = '#franchise-explorer-home-section'
ORIGIN = 'http://jellyfin.test'
BASE = '/jellyfin'
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;color:white;background:#111;font-family:Arial}.hide{display:none!important}
.verticalSection{padding:15px 3%;box-sizing:border-box;min-width:0}.itemsContainer{display:flex;gap:12px;max-width:100%;overflow-x:auto}
.card{flex:0 0 230px}.poster{height:130px;background:#145168}.card span{display:block}
.homeSectionsContainer{display:flex;flex-direction:column;max-width:100%}
</style></head><body><div class="homePage"><div id="homeTab" class="is-active">
<div class="sections homeSectionsContainer" data-category="none">
<section id="home-my-media" class="verticalSection section0"><h2 class="sectionTitle">My Media</h2>
<div class="itemsContainer"><div class="card" data-id="collections"><div class="poster"></div><span>Collections</span></div>
<div class="card" data-id="movies"><div class="poster"></div><span>Movies</span></div></div></section>
<section class="verticalSection section1"><h2>Continue Watching</h2><div class="itemsContainer"><div class="card">A movie</div></div></section>
</div></div></div></body></html>'''

# Exact visibility contract from upstream scripts/homeScreen3.js:41–60.
HIDE_NATIVE = '\n'.join([f'.section{number}:not([data-page])' for number in range(10)])
HIDE_NATIVE = HIDE_NATIVE.replace('\n', ',\n') + '{display:none!important}'
ENHANCED = '''<section class="verticalSection" data-section-id="my-media" data-category="none" style="order:5">
<h2 class="sectionTitle">My Media</h2><div class="itemsContainer">
<div class="card" data-type="CollectionFolder"><div class="poster"></div><span>Collections</span></div>
<div class="card" data-type="CollectionFolder"><div class="poster"></div><span>Movies</span></div></div></section>'''


def enable(page, *, paint=True):
    page.evaluate('''({css, markup}) => {
      const style=document.createElement('style');style.id='kefin-hide-native-homesections';style.textContent=css;
      document.head.append(style);
      if(markup)document.querySelector('.homeSectionsContainer').insertAdjacentHTML('beforeend',markup);
    }''', {'css': HIDE_NATIVE, 'markup': ENHANCED if paint else ''})


def single_visible(page):
    expect(page.locator(TILE)).to_have_count(1)
    expect(page.locator(TILE)).to_be_visible()
    expect(page.locator(SHELF)).to_have_count(1)
    assert page.locator(f'{SHELF} {TILE}').count() == 1
    assert page.locator(SHELF).get_attribute('data-section-id') is None, 'Must not claim a Kefin-managed shelf'
    assert page.locator(SHELF).get_attribute('data-category') == 'none'
    assert page.locator(TILE).get_attribute('href') == BASE + '/FranchiseExplorer/Browse'
    art = page.locator(TILE + ' .fe-tile-art').bounding_box()
    assert art and 150 <= art['width'] <= 270 and art['height'] >= 70, art
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal page overflow'


def check(browser, width):
    page = browser.new_page(viewport={'width': width, 'height': 900})
    writes, errors = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def route(request):
        if request.request.method != 'GET':
            writes.append(request.request.url)
        if request.request.url.endswith('/web/index.html'):
            request.fulfill(status=200, content_type='text/html', body=HTML)
        else:
            request.fulfill(status=200, content_type='application/json', body='[]')
    page.route(ORIGIN + '/**', route)
    page.goto(ORIGIN + BASE + '/web/index.html')
    page.add_script_tag(content=SCRIPT)
    expect(page.locator('#home-my-media ' + TILE)).to_be_visible()
    assert page.locator(SHELF).count() == 0

    # Late Enhanced Home initialization must move the link out of the hidden
    # native My Media row, even before replacement API shelves finish painting.
    enable(page, paint=False)
    single_visible(page)
    expect(page.locator('#home-my-media')).to_be_hidden()
    assert page.locator('#home-my-media [data-id]').count() == 2
    page.evaluate('markup => document.querySelector(".homeSectionsContainer").insertAdjacentHTML("beforeend",markup)', ENHANCED)
    page.wait_for_timeout(100)
    single_visible(page)
    assert page.locator('[data-section-id="my-media"] .card').count() == 2

    # Native menu and keyboard navigation stay usable on the standalone shelf.
    page.locator(TILE + ' .fe-settings-toggle').focus()
    page.keyboard.press('Enter')
    expect(page.locator(TILE + ' .fe-settings-menu')).to_be_visible()
    menu = page.locator(TILE + ' .fe-settings-menu').bounding_box()
    assert menu and menu['x'] >= 0 and menu['x'] + menu['width'] <= width, menu
    assert page.locator(TILE + ' .fe-settings-link').last.get_attribute('href') == BASE + '/web/index.html#/configurationpage?name=Franchise%20Explorer'
    page.keyboard.press('Escape')
    expect(page.locator(TILE + ' .fe-settings-menu')).to_be_hidden()

    # A full enhanced repaint may discard both native and replacement My Media.
    # Our link must remain available without either library shelf or an API ID.
    page.evaluate('''() => {
      document.querySelector('.homeSectionsContainer').innerHTML =
        '<div id="kefin-home-screen-sentinel"></div><section class="verticalSection" data-section-id="continueWatching" data-category="none"><h2>Continue Watching</h2></section>';
    }''')
    single_visible(page)
    assert page.locator(TILE).get_attribute('data-id') is None
    assert page.locator(TILE).get_attribute('data-type') is None
    page.add_script_tag(content=SCRIPT)
    page.wait_for_timeout(120)
    single_visible(page)

    # Stable DOM must settle; no competing observers should recreate it forever.
    page.evaluate('''() => { window.__tileMutations=0;new MutationObserver(changes=>window.__tileMutations+=changes.length)
      .observe(document.querySelector('.homeSectionsContainer'),{childList:true,subtree:true}); }''')
    page.wait_for_timeout(180)
    assert page.evaluate('window.__tileMutations') == 0

    # Ordinary SPA replacement and disabling Enhanced Home restore the normal
    # one-link My Media placement, without leaving an extra dedicated shelf.
    page.evaluate('''markup => {
      document.getElementById('kefin-hide-native-homesections').remove();
      document.querySelector('.homeSectionsContainer').innerHTML=markup;
    }''', '<section id="home-my-media" class="verticalSection section0"><h2>My Media</h2><div class="itemsContainer"><div class="card"><div class="poster"></div><span>Collections</span></div></div></section>')
    expect(page.locator('#home-my-media ' + TILE)).to_be_visible()
    expect(page.locator(SHELF)).to_have_count(0)
    assert page.locator(TILE).count() == 1
    assert not errors, errors
    assert not writes, writes
    page.locator(TILE).focus()
    page.keyboard.press('Enter')
    page.wait_for_url(ORIGIN + BASE + '/FranchiseExplorer/Browse')
    page.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True,
        executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
        args=['--no-sandbox'])
    for width in (320, 390, 1280):
        check(browser, width)
        print(f'PASS Kefin Enhanced Home compatibility {width}px')
    browser.close()
