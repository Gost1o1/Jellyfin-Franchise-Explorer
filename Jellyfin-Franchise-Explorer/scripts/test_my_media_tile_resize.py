#!/usr/bin/env python3
"""Mock Jellyfin native card width/height resizing regression."""
from pathlib import Path
from playwright.sync_api import sync_playwright
src=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':860})
    page.set_content('''<style> .card{display:block;flex:0 0 250px;width:250px}.cardScalable{height:145px;background:#345}.itemsContainer{display:flex;gap:12px}</style>
       <section class="verticalSection"><h2 class="sectionTitle">My Media</h2><div class="itemsContainer">
       <div class="card" id="native"><div class="cardScalable"></div><span>Collections</span></div>
       <div class="card"><div class="cardScalable"></div><span>Movies</span></div></div></section>''')
    page.add_script_tag(content=src)
    page.wait_for_selector('#franchise-explorer-my-media-tile')
    def size():
        return page.evaluate('''()=>{
          const a=document.querySelector('#franchise-explorer-my-media-tile');
          return [Math.round(a.getBoundingClientRect().width),Math.round(a.querySelector('.fe-tile-art').getBoundingClientRect().height)];}''')
    assert size()==[250,145],size()
    page.evaluate('''()=>{let n=document.querySelector('#native');n.style.width='180px';n.style.flexBasis='180px';n.querySelector('.cardScalable').style.height='95px'}''')
    page.wait_for_timeout(180)
    assert size()==[180,95],size()
    print('PASS My Media tile exact native width and image height, including dynamic resize')
    browser.close()
