#!/usr/bin/env python3
"""v0.7.4 integration smoke using simulated Jellyfin credentials/data; no server changes."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
admin=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
browse=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html').read_text()
rootid='11111111-1111-4111-8111-111111111111'
phaseid='22222222-2222-4222-8222-222222222222'
movieid='33333333-3333-4333-8333-333333333333'
showid='44444444-4444-4444-8444-444444444444'
collectionid='55555555-5555-4555-8555-555555555555'
oldid='66666666-6666-4666-8666-666666666666'
initial={'NavigationLabel':'Franchises','Nodes':[{'Id':rootid,'ParentId':'','Name':'Marvel Cinematic Universe','NodeType':'Franchise','SortOrder':1,'Artwork':{}},{'Id':phaseid,'ParentId':rootid,'Name':'Phase One','NodeType':'Phase','SortOrder':1,'Artwork':{}}],
'MediaLinks':[{'Id':oldid,'NodeId':phaseid,'JellyfinItemId':movieid,'DisplayName':'Iron Man','ItemType':'Movie','ViewingOrder':'Custom','Position':1,'RangeMode':'Full'}],
'Rows':[]}
media=[{'Id':movieid,'Name':'Iron Man','Type':'Movie','ProductionYear':2008,'ImageTags':{}},{'Id':showid,'Name':'Loki','Type':'Series','ProductionYear':2021,'ImageTags':{}},{'Id':collectionid,'Name':'Thor Collection','Type':'BoxSet','ProductionYear':2011,'ImageTags':{}}]
jsmock=f'''<script>
window.saved={json.dumps(initial)};
window.available={json.dumps(media)};
window.ApiClient={{getPluginConfiguration:async()=>JSON.parse(JSON.stringify(window.saved)),updatePluginConfiguration:async(id,cfg)=>{{window.saved=JSON.parse(JSON.stringify(cfg));return {{}};}},getCurrentUserId:()=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getUrl:x=>x,getItems:async(u,p)=>({{Items:window.available.filter(x=>x.Name.toLowerCase().includes(String(p.searchTerm||'').toLowerCase()))}}),getItem:async(u,id)=>window.available.find(x=>x.Id===id)}};
window.Dashboard={{processPluginConfigurationUpdateResult:()=>{{}}}};
</script>'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in [390,900,1500]:
   page=browser.new_page(viewport={'width':width,'height':950})
   page.on('dialog',lambda d:d.accept())
   page.set_content(admin.replace('<script type="text/javascript">',jsmock+'<script type="text/javascript">'))
   page.get_by_role('treeitem',name='Marvel Cinematic Universe').click()
   page.locator('#fx-new-row-name').fill('Custom Marvel Order')
   page.locator('#fx-new-row-type').select_option('Media')
   page.locator('#fx-create-row').click()
   row=page.locator('.fx-row-card').last
   assert row.locator('summary').count()==0, 'media row unexpectedly limited to existing main links'
   field=row.get_by_role('searchbox',name='Search Jellyfin library for Custom Marvel Order')
   field.fill('Thor')
   row.get_by_role('button',name='+ Add').wait_for(timeout=5000)
   assert row.get_by_text('Thor Collection · Collection').count()==1
   row.get_by_role('button',name='+ Add').click()
   assert page.evaluate('window.saved.Rows.length')==0,'saved prematurely'
   assert page.locator('.fx-row-included-item').get_by_text('Thor Collection',exact=False).count()==1
   row=page.locator('.fx-row-card').last
   row.get_by_role('searchbox').fill('Loki')
   row.get_by_role('button',name='Choose TV Show range').wait_for(timeout=5000)
   row.get_by_role('button',name='Choose TV Show range').click()
   page.locator('#fx-range-mode').select_option('Episodes')
   page.locator('#fx-start-season').fill('1');page.locator('#fx-start-episode').fill('3')
   page.locator('#fx-end-season').fill('2');page.locator('#fx-end-episode').fill('5')
   page.locator('#fx-save-range').click()
   assert page.locator('#fx-tv-range').evaluate('(e)=>e.classList.contains("fx-hidden")')
   assert page.get_by_text('S1E3 – S2E5').count()>=1
   page.locator('#fx-save').click()
   saved=page.evaluate('window.saved')
   assert len(saved['Rows'])==1 and len(saved['Rows'][0]['Items'])==2
   assert len(saved['MediaLinks'])==1,'row addition must not change franchise links'
   assert saved['Rows'][0]['Items'][1]['RangeMode']=='Episodes'
   assert saved['Rows'][0]['Items'][0]['ItemType']=='BoxSet'
   page.locator('#fx-reload').click()
   page.get_by_role('treeitem',name='Marvel Cinematic Universe').click()
   assert page.locator('.fx-row-included-item').count()==2
   # Row-specific items can be removed without altering the source library.
   row=page.locator('.fx-row-card').last
   row.get_by_role('button',name='Edit range').click()
   page.locator('#fx-range-mode').select_option('Seasons')
   page.locator('#fx-start-season').fill('1');page.locator('#fx-end-season').fill('3')
   page.locator('#fx-save-range').click()
   page.locator('#fx-save').click()
   saved=page.evaluate('window.saved')
   assert saved['Rows'][0]['Items'][1]['RangeMode']=='Seasons'
   assert saved['Rows'][0]['Items'][1]['EndSeason']==3
   assert len(saved['MediaLinks'])==1
   metrics=page.evaluate('''() => ({scroll:document.documentElement.scrollWidth, client:document.documentElement.clientWidth})''')
   assert metrics['scroll']<=metrics['client']+2,(width,metrics)
   print('Admin full-library row add/range/edit/save/reload',width,'passed')
   page.close()
  # Browser API mock: Row has collection + independent ranged series, but no direct group MediaLinks.
  saved=saved
  catalog={'title':'Franchises','nodes':[{'id':n['Id'],'parentId':n['ParentId'],'name':n['Name'],'nodeType':n['NodeType'],'sortOrder':n['SortOrder'],'overview':'','collectionId':'','artwork':{}} for n in saved['Nodes']],
  'links':[{'id':oldid,'nodeId':phaseid,'itemId':movieid,'rangeMode':'Full','position':1}],
  'rows':[{'id':r['Id'],'parentNodeId':r['ParentNodeId'],'name':r['Name'],'rowType':r['RowType'],'nodeIds':r['NodeIds'],'mediaLinkIds':r['MediaLinkIds'],'sortOrder':r['SortOrder'],'items':[{'id':i['Id'],'itemId':i['JellyfinItemId'],'itemType':i['ItemType'],'rangeMode':i['RangeMode'],'startSeason':i['StartSeason'],'startEpisode':i['StartEpisode'],'endSeason':i['EndSeason'],'endEpisode':i['EndEpisode']} for i in r['Items']]} for r in saved['Rows']]}
  setup=f'''<script>
  Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:()=>JSON.stringify({{Servers:[{{Id:'server',UserId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',AccessToken:'mock',ManualAddress:'http://fake.invalid'}}]}})}}}});
  window.fetch=async input=>{{let p=String(input).split('?')[0];let data=null;
  if(p.endsWith('/System/Info/Public'))data={{Id:'server'}};
  else if(p.endsWith('/FranchiseExplorer/Catalog'))data={json.dumps(catalog)};
  else if(p.includes('/Items/'))data={json.dumps({x['Id']:x for x in media})}[p.split('/Items/')[1]];
  if(data)return new Response(JSON.stringify(data),{{status:200,headers:{{'Content-Type':'application/json'}}}});
  return new Response('',{{status:404}});
  }};</script>'''
  html=browse.replace("<script>\n'use strict';",setup+"<script>\n'use strict';")
  for width in [390,900,1920]:
   page=browser.new_page(viewport={'width':width,'height':900})
   page.set_content(html)
   page.get_by_role('button',name='Marvel Cinematic Universe').click()
   shelf=page.get_by_role('region',name='Custom Marvel Order titles')
   shelf.get_by_role('button',name='Thor Collection',exact=False).wait_for(timeout=6000)
   shelf.get_by_role('button',name='Loki',exact=False).wait_for(timeout=6000)
   assert 'Seasons 1–3' in shelf.inner_text()
   metrics=page.evaluate('''() => ({scroll:document.documentElement.scrollWidth, client:document.documentElement.clientWidth})''')
   assert metrics['scroll']<=metrics['client']+2,(width,metrics)
   print('Browse independent row reference',width,'passed')
   page.close()
 finally:browser.close()
print('All full library row regression tests passed.')
