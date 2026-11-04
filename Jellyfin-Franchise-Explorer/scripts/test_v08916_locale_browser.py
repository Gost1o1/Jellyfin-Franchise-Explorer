#!/usr/bin/env python3
"""Jellyfin localized-home browser regression (requires Playwright + Chromium)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[1]
js = (repo / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text(encoding='utf-8')

html = '''<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
body{background:#101114;color:white}.itemsContainer{display:flex;gap:12px}
.card{width:180px}.poster{height:110px;background:#126078}
</style></head><body><div class="homeTab">
<section class="verticalSection" id="libraries"><h2 class="sectionTitle">Meine Medien</h2>
<div class="itemsContainer"><div class="card"><div class="poster"></div><span>Bücher</span></div>
<div class="card"><div class="poster"></div><span>Sammlungen</span></div>
<div class="card"><div class="poster"></div><span>Filme</span></div></div></section>
<section class="verticalSection" id="watching"><h2 class="sectionTitle">Weiterschauen</h2>
<div class="itemsContainer"><div class="card">Serie A</div><div class="card">Serie B</div></div></section>
</div></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None, args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content(html)
    page.add_script_tag(content=js)
    tile = page.locator('#franchise-explorer-my-media-tile')
    tile.wait_for(timeout=5000)
    assert tile.count() == 1
    assert page.locator('#libraries #franchise-explorer-my-media-tile').count() == 1
    assert page.locator('#watching #franchise-explorer-my-media-tile').count() == 0
    page.locator('#franchise-timeline-resume').wait_for(timeout=5000)
    assert page.locator('section').nth(1).get_attribute('id') == 'watching', 'Resume widget must follow Continue Watching, not displace it'
    assert page.locator('#watching + #franchise-timeline-resume').count() == 1
    order = page.locator('#libraries .itemsContainer').evaluate('''el =>
      [...el.children].map(c=>c.id==='franchise-explorer-my-media-tile'?'Franchises':c.querySelector('span')?.textContent).join('|')''')
    assert order == 'Bücher|Sammlungen|Franchises|Filme', order
    page.evaluate("document.querySelector('#libraries .sectionTitle').textContent='Biblioteca'")
    page.evaluate("document.querySelector('#libraries .card:nth-child(2) span').textContent='Colecciones'")
    page.wait_for_timeout(150)
    assert tile.count() == 1
    assert tile.get_attribute('href') == '/FranchiseExplorer/Browse'
    browser.close()
print('German and Spanish localized My Media tile smoke test passed.')
