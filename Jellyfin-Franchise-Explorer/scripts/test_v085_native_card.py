#!/usr/bin/env python3
"""Native Jellyfin-like card markup: clone keeps cardBox/cardPadder and native spacing."""
from pathlib import Path
from playwright.sync_api import sync_playwright
js=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
page_html='''<style>
.itemsContainer{display:flex;gap:14px;width:100%;overflow:hidden}
.card{flex:0 0 256px;width:256px;min-width:0;padding:0 5px;box-sizing:border-box}
.cardBox{width:100%}.cardScalable{position:relative;width:100%;}
.cardPadder{padding-top:56.25%;}
.cardImageContainer{position:absolute;inset:0;background:#135;}
.cardText{display:block;text-align:center;margin-top:6px}
@media(max-width:600px){.card{flex-basis:180px;width:180px}}
</style><section class="verticalSection"><h2>My Media</h2><div class="itemsContainer">
<div class="card"><div class="cardBox"><div class="cardScalable"><div class="cardPadder"></div><div class="cardImageContainer" style="background-image:url(fake.jpg)"><span>Collections image</span></div></div><span class="cardText">Collections</span></div></div>
<div class="card"><div class="cardBox"><div class="cardScalable"><div class="cardPadder"></div><div class="cardImageContainer"></div></div><span class="cardText">Movies</span></div></div>
</div></section>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
 for width in (390,1440):
  page=b.new_page(viewport={'width':width,'height':820})
  page.set_content(page_html);page.add_script_tag(content=js)
  page.wait_for_selector('#franchise-explorer-my-media-tile .fe-tile-art')
  result=page.evaluate('''()=>{
   const cards=document.querySelectorAll('.itemsContainer>.card');
   const reference=cards[0],tile=document.querySelector('#franchise-explorer-my-media-tile');
   const art=tile.querySelector('.fe-tile-art'),img=tile.querySelector('.cardImageContainer');
   return {referenceWidth:reference.offsetWidth,tileWidth:tile.offsetWidth,
     referenceHeight:reference.querySelector('.cardImageContainer').getBoundingClientRect().height,
     tileHeight:art.getBoundingClientRect().height,
     padder:!!tile.querySelector('.cardPadder'),
     caption:tile.querySelector('.cardText').textContent,
     original:cards[0].querySelector('.cardText').textContent};}''')
  assert result['referenceWidth']==result['tileWidth'],result
  assert abs(result['referenceHeight']-result['tileHeight']) < 2,result
  assert result['padder'] and result['caption']=='Franchises' and result['original']=='Collections',result
  print('PASS native card structure and matching image box',width)
  page.close()
 b.close()
