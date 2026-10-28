#!/usr/bin/env python3
"""Optional Playwright UI regression with fully mocked Jellyfin network responses.
No actual Jellyfin server or outbound network is used.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html').read_text()
star='11111111111141118111111111111111';marvel='22222222222242228222222222222222';phase='33333333333343338333333333333333';loki='44444444444444448444444444444444';collection='55555555555545558555555555555555'
catalog={'version':'0.7.0.0','title':'Franchises','nodes':[
 {'id':star,'parentId':'','name':'Star Wars','nodeType':'Franchise','collectionId':'','overview':'A galaxy far, far away.','sortOrder':0,'artwork':{}},
 {'id':marvel,'parentId':'','name':'Marvel Cinematic Universe','nodeType':'Franchise','collectionId':collection,'overview':'Marvel universes and phases','sortOrder':1,'artwork':{}},
 {'id':phase,'parentId':marvel,'name':'Phase Four','nodeType':'Phase','collectionId':'','overview':'New era','sortOrder':0,'artwork':{}}
],'links':[{'nodeId':phase,'itemId':loki,'rangeMode':'Seasons','startSeason':1,'endSeason':1,'viewingOrder':'Custom','position':1}]}
items={loki:{'Id':loki,'Name':'Loki','Type':'Series','ProductionYear':2021,'ImageTags':{}},collection:{'Id':collection,'Name':'Marvel Universe','Type':'BoxSet','ImageTags':{}}}
setup=f'''<script>
Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:()=>JSON.stringify({{Servers:[{{Id:'testserver',UserId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',AccessToken:'mock',ManualAddress:'http://mock.invalid'}}]}})}}}});
window.fetch=async function(input){{
  const path=String(input).split('?')[0];
  if(path.endsWith('/System/Info/Public'))return new Response(JSON.stringify({{Id:'testserver'}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
  if(path.endsWith('/FranchiseExplorer/Catalog'))return new Response(JSON.stringify({json.dumps(catalog)}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
  const item={json.dumps(items)}[path.split('/').pop()];
  if(path.includes('/Items/')&&item)return new Response(JSON.stringify(item),{{status:200,headers:{{'Content-Type':'application/json'}}}});
  return new Response('',{{status:404}});
}};
</script>'''
HTML=HTML.replace('<script>\n\'use strict\';',setup+'\n<script>\n\'use strict\';')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width,height in [(390,850),(620,930),(900,780),(1280,720),(1920,1080)]:
   page=browser.new_page(viewport={'width':width,'height':height})
   page.set_content(HTML)
   page.get_by_role('button',name='Marvel Cinematic Universe').wait_for(timeout=5000)
   page.get_by_role('button',name='Marvel Cinematic Universe').click()
   page.get_by_role('button',name='Phase Four').wait_for(timeout=5000)
   page.get_by_role('button',name='Phase Four').click()
   page.get_by_role('button',name='Loki').wait_for(timeout=5000)
   assert page.get_by_text('Seasons 1–1').count()>0
   metrics=page.evaluate('({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})')
   assert metrics['scroll']<=metrics['client']+1,(width,metrics)
   if width in (390,900,1920):page.screenshot(path=str(ROOT/f'mock-browser-{width}.png'),full_page=True)
   page.keyboard.press('Escape')
   page.get_by_role('button',name='Phase Four').wait_for(timeout=3000)
   print('Passed',width,'px',metrics)
   page.close()
 finally:browser.close()
print('Browser UI tests passed against simulated API data; live Jellyfin compatibility NOT tested.')
