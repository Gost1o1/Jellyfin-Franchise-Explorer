#!/usr/bin/env python3
"""Offline UI regression: delayed media fetches cannot reorder rows.
Verifies separate info button and subtitles-off default; tests native-player bridge.
No live Jellyfin requests, no media files.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
html=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html').read_text()
client=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
companion=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
html=html.replace('<script src="TimelineClient.js"></script>','<script>'+client+'</script>')
guid=lambda n:f'{n:08d}-1111-4111-8111-111111111111'
root_id=guid(1);row_id=guid(2); refs=[{'id':guid(300+i),'itemId':guid(200+i),'rangeMode':'Full'} for i in range(6)]
items={r['itemId']:{'Id':r['itemId'],'Name':'Movie '+str(i+1),'Type':'Movie','ImageTags':{}} for i,r in enumerate(refs)}
catalog={'title':'Franchises','nodes':[{'id':root_id,'parentId':'','name':'Marvel','nodeType':'Franchise','sortOrder':1,'artwork':{}}],
         'links':[],'rows':[{'id':row_id,'parentNodeId':root_id,'name':'Chronological Order','rowType':'Timeline','sortOrder':1,
          'nodeIds':[],'mediaLinkIds':[],'items':refs,'mediaOrder':[r['id'] for r in refs]}]}
setup=f'''<script>
const CATALOG={json.dumps(catalog)};
const ITEMS={json.dumps(items)};
Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:(k)=>k==='jellyfin_credentials'?JSON.stringify({{Servers:[{{Id:'testserver',UserId:'{guid(100)}',AccessToken:'mock',LocalAddress:'http://mock.invalid'}}]}}):null,setItem:()=>{{}}}}}});
window.fetch=async function(input,options={{}}){{
 const path=String(input);
 const ok=(v)=>new Response(JSON.stringify(v),{{status:200,headers:{{'Content-Type':'application/json'}}}});
 if(path.includes('/System/Info/Public'))return ok({{Id:'testserver'}});
 if(path.includes('/FranchiseExplorer/Catalog'))return ok(CATALOG);
 if(path.includes('/FranchiseExplorer/TimelineState'))return ok([]);
 if(path.includes('/Items/')){{
   const id=path.split('/Items/')[1].split('?')[0];
   const delay=id=== '{refs[0]['itemId']}' ? 260 : id=== '{refs[2]['itemId']}' ? 110 : 0;
   await new Promise(r=>setTimeout(r,delay));
   return ok(ITEMS[id]||{{}});
 }}
 return new Response('',{{status:404}});
}};
</script>'''
html=html.replace("<script>\n'use strict';",setup+"\n<script>\n'use strict';")
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in [390,900,1600]:
   page=browser.new_page(viewport={'width':width,'height':940})
   page.set_content(html,wait_until='load')
   page.get_by_role('button',name='Marvel').click()
   cards=page.locator('.shelf-track .tile')
   cards.nth(5).wait_for(timeout=6000)
   expected=['Movie '+str(i+1) for i in range(6)]
   actual=cards.locator('strong').all_text_contents()
   assert actual==expected,(width,actual)
   assert not page.locator('#fe-subtitles').is_checked(),width
   assert cards.locator('.tile-info').count()==6,width
   # Sort/rerender must not randomly permute by completion time.
   page.locator('#sort').select_option('alpha')
   cards.nth(5).wait_for(timeout=6000)
   assert cards.locator('strong').all_text_contents()==expected,width
   page.locator('#sort').select_option('custom')
   cards.nth(5).wait_for(timeout=6000)
   assert cards.locator('strong').all_text_contents()==expected,width
   # The info control is separately accessible, not nested inside a button.
   assert cards.nth(0).locator('.tile-info').get_attribute('aria-label')=='Information about Movie 1'
   metrics=page.evaluate('({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})')
   assert metrics['scroll']<=metrics['client']+1,(width,metrics)
   print('Stable original order, distinct ⓘ control, subtitle default PASS',width)
   page.close()
  # Native Jellyfin player handoff: optional companion detects tagged details link.
  page=browser.new_page()
  bridge=companion.split('/* v0.8.1 — Native-player handoff')[1]
  script='/* v0.8.1 — Native-player handoff'+bridge
  page.set_content('<main class="page"><button class="btnPlay">Play</button></main>')
  page.evaluate('window.__clicked=0; document.querySelector(".btnPlay").addEventListener("click",()=>window.__clicked++)')
  page.evaluate("location.hash='#/details?id="+refs[0]['itemId']+"&feAutoPlay=1&feSubs=0'")
  page.add_script_tag(content=script)
  page.wait_for_function('window.__clicked===1',timeout=5000)
  assert page.evaluate('window.__clicked')==1
  assert 'feAutoPlay' not in page.evaluate('location.hash')
  print('Native-player DOM handoff request PASS')
  page.close()
 finally:browser.close()
