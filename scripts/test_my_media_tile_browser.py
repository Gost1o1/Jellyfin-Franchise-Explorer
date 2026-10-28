#!/usr/bin/env python3
"""Browser mock only; does not establish Jellyfin 12.2 compatibility."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'
assert SCRIPT.exists()
JS = SCRIPT.read_text(encoding='utf-8')

HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;background:#101114;color:#fff;font-family:Arial}
.verticalSection{padding:20px 3%;}
.itemsContainer{display:flex;gap:13px;align-items:flex-start;overflow-x:auto;max-width:100%;}
.card{flex:0 0 245px;box-sizing:border-box;}
.poster{height:138px;background:#00708c;border-radius:4px;}
.card span{display:block;text-align:center;margin-top:8px}
@media(max-width:600px){.card{flex-basis:158px}}
</style></head><body>
<section class="verticalSection" id="home-my-media"><h2 class="sectionTitle">My Media</h2>
<div class="itemsContainer">
 <div class="card"><div class="poster">Books</div><span>Books</span></div>
 <div class="card"><div class="poster">Collections</div><span>Collections</span></div>
 <div class="card"><div class="poster">Movies</div><span>Movies</span></div>
</div></section>
<section class="verticalSection"><h2 class="sectionTitle">Continue Watching</h2><div class="itemsContainer"><div class="card">Firefly</div></div></section>
</body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in [390, 620, 900, 1440, 1920]:
        page = browser.new_page(viewport={'width':width, 'height':900})
        page.set_content(HTML)
        page.add_script_tag(content=JS)
        page.wait_for_selector('#franchise-explorer-my-media-tile',timeout=5000)
        assert page.locator('#franchise-explorer-my-media-tile').count() == 1
        href = page.locator('#franchise-explorer-my-media-tile').get_attribute('href')
        assert href == '/FranchiseExplorer/Browse',href
        assert page.locator('#home-my-media .card').count()==4
        assert page.locator('section').nth(1).locator('.card').count()==1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow at '+str(width)
        tile_width=page.locator('#franchise-explorer-my-media-tile').bounding_box()['width']
        assert tile_width > 100 and tile_width <= width * .46, (width,tile_width)
        # Jellyfin replaces the My Media row after a client-side refresh:
        page.evaluate("document.querySelector('#home-my-media .itemsContainer').innerHTML='<div class=\"card\"><div class=\"poster\"></div><span>Music</span></div>'")
        page.wait_for_timeout(130)
        assert page.locator('#franchise-explorer-my-media-tile').count() == 1
        # Re-injecting must not create duplicate MutationObservers or cards:
        page.add_script_tag(content=JS)
        page.wait_for_timeout(100)
        assert page.locator('#franchise-explorer-my-media-tile').count() == 1
        print('PASS',width,'px; tile',round(tile_width),'px; route',href)
        page.close()
    browser.close()
print('Mock Jellyfin My Media tile browser tests passed; live Jellyfin runtime remains unverified.')
