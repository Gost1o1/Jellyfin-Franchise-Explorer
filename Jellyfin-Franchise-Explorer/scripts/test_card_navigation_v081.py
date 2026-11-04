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
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
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
   assert page.locator('#fe-subtitles').count()==0,'Playback preference now lives in settings'
   subtitles=page.evaluate('''async ({rowId,itemId,userId})=>{
      let captured;window.FranchiseExplorerNativePlayback={play:(id,opts)=>{captured=opts;return true;}};
      const manager=new window.FranchiseTimeline.TimelineManager({serverId:'testserver',userId,prefix:'',token:'mock'});
      manager.save=async s=>s;await manager.playHere({id:rowId,name:'Test'},[{id:itemId,key:'test:'+itemId}],0);
      return captured.subtitleEnabled;
   }''',{'rowId':row_id,'itemId':refs[0]['itemId'],'userId':guid(100)})
   assert subtitles is False,width
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
  # Native Web shortcut uses the existing delegated Jellyfin itemAction listener.
  page=browser.new_page()
  page.route('http://jellyfin.test/**',lambda r:r.fulfill(content_type='text/html',body='<div class="itemsContainer"></div>'))
  page.goto('http://jellyfin.test/web/index.html#/home')
  page.evaluate("localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'testserver',UserId:'"+guid(100)+"',AccessToken:'mock'}]}));window.__clicked=[];document.addEventListener('click',e=>{const card=e.target.closest('.itemAction');if(card)window.__clicked.push({id:card.dataset.id,action:card.dataset.action,position:card.dataset.positionticks});});window.fetch=async()=>new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});")
  page.add_script_tag(content=companion)
  accepted=page.evaluate('(id)=>window.FranchiseExplorerNativePlayback.play(id,{type:"Movie",startOver:true,positionTicks:999})',refs[0]['itemId'])
  assert accepted
  page.wait_for_function('window.__clicked.length===1',timeout=5000)
  assert page.evaluate('window.__clicked[0]')=={'id':refs[0]['itemId'],'action':'play','position':'0'}
  assert page.evaluate('location.hash')=='#/home'
  print('Native delegated Web action, restart offset, no Details navigation PASS')
  page.close()
 finally:browser.close()
