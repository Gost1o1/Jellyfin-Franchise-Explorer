#!/usr/bin/env python3
"""v0.7.3 standalone mock UI tests. Does not touch user server."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
admin=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
browse=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html').read_text()
gids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444']
rootid,phaseid,collectionid,mediaid=gids
nodes=[{'Id':rootid,'ParentId':'','Name':'Marvel Cinematic Universe','NodeType':'Franchise','SortOrder':1,'CollectionId':'','Overview':'Marvel','Artwork':{}},{'Id':phaseid,'ParentId':rootid,'Name':'Phase One','NodeType':'Phase','SortOrder':1,'CollectionId':'','Overview':'','Artwork':{}},{'Id':collectionid,'ParentId':rootid,'Name':'Thor Collection','NodeType':'Collection','SortOrder':2,'CollectionId':'','Overview':'','Artwork':{}}]
links=[{'Id':mediaid,'NodeId':phaseid,'JellyfinItemId':'55555555-5555-4555-8555-555555555555','DisplayName':'Iron Man','ItemType':'Movie','ViewingOrder':'Custom','Position':1,'RangeMode':'Full'}]
data={'NavigationLabel':'Franchises','Nodes':nodes,'MediaLinks':links,'Rows':[]}
mock=f'''<script>
window.mockSaved={json.dumps(data)};
window.ApiClient={{getPluginConfiguration:async()=>JSON.parse(JSON.stringify(window.mockSaved)),updatePluginConfiguration:async(id,cfg)=>{{window.mockSaved=JSON.parse(JSON.stringify(cfg));return {{}};}},getCurrentUserId:()=>"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",getUrl:x=>x}};
window.Dashboard={{processPluginConfigurationUpdateResult:()=>{{}}}};
</script>'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in [390,900,1600]:
   page=browser.new_page(viewport={'width':width,'height':900})
   page.on('dialog',lambda dialog:dialog.accept())
   page.set_content(admin.replace('<script type="text/javascript">',mock+'\n<script type="text/javascript">'))
   page.get_by_role('treeitem',name='Marvel Cinematic Universe').click()
   # auto-generate: phases, collections, plus blank chronology
   page.locator('#fx-suggest-rows').click()
   assert page.locator('.fx-row-card').count()==3,page.locator('.fx-row-card').count()
   assert page.locator('.fx-row-card').filter(has=page.get_by_role('textbox',name='Rename row Phases')).count()==1
   assert page.get_by_role('textbox',name='Rename row Collections').count()==1
   # custom row add, rename and delete
   page.locator('#fx-new-row-name').fill('Additional Marvel TV')
   page.locator('#fx-new-row-type').select_option('Mixed')
   page.locator('#fx-create-row').click()
   assert page.locator('.fx-row-card').count()==4
   page.get_by_role('textbox',name='Rename row Additional Marvel TV').fill('Legacy TV Shows')
   page.get_by_role('textbox',name='Rename row Additional Marvel TV').blur()
   assert page.get_by_role('textbox',name='Rename row Legacy TV Shows').count()==1
   # order via buttons
   card=page.locator('.fx-row-card').filter(has=page.get_by_role('textbox',name='Rename row Legacy TV Shows'))
   card.get_by_role('button',name='Move Legacy TV Shows up').click()
   assert page.locator('.fx-row-card').nth(2).get_by_role('textbox',name='Rename row Legacy TV Shows').count()==1
   page.locator('#fx-save').click()
   page.wait_for_timeout(100)
   assert len(page.evaluate('window.mockSaved.Rows'))==4
   assert [x['Name'] for x in page.evaluate('window.mockSaved.Rows') if x['Name']=='Legacy TV Shows']==['Legacy TV Shows']
   # deleting a row doesn't change nodes or links
   card=page.locator('.fx-row-card').filter(has=page.get_by_role('textbox',name='Rename row Legacy TV Shows'))
   card.get_by_role('button',name='Delete row').click()
   page.locator('#fx-save').click()
   assert len(page.evaluate('window.mockSaved.Rows'))==3
   assert len(page.evaluate('window.mockSaved.Nodes'))==3
   assert len(page.evaluate('window.mockSaved.MediaLinks'))==1
   metrics=page.evaluate('''() => ({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})''')
   assert metrics['scroll']<=metrics['client']+1,(width,metrics)
   page.close();print('Admin row add/rename/move/delete/save width',width,'passed')
  # Browser fixture with saved rows, correct IDs, metadata and authenticated mock endpoints.
  saved=data.copy();saved['Rows']=[{'Id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ParentNodeId':rootid,'Name':'Phases','RowType':'Groups','SortOrder':1,'NodeIds':[phaseid],'MediaLinkIds':[]},{'Id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ParentNodeId':rootid,'Name':'Chronological Viewing Order','RowType':'Timeline','SortOrder':2,'NodeIds':[],'MediaLinkIds':[mediaid]}]
  catalog={'title':'Franchises','nodes':[{'id':n['Id'],'parentId':n['ParentId'],'name':n['Name'],'nodeType':n['NodeType'],'overview':n['Overview'],'sortOrder':n['SortOrder'],'collectionId':'','artwork':{}} for n in nodes], 'links':[{'id':mediaid,'nodeId':phaseid,'itemId':links[0]['JellyfinItemId'],'rangeMode':'Full','viewingOrder':'Custom','position':1}], 'rows':[{'id':r['Id'],'parentNodeId':r['ParentNodeId'],'name':r['Name'],'rowType':r['RowType'],'sortOrder':r['SortOrder'],'nodeIds':r['NodeIds'],'mediaLinkIds':r['MediaLinkIds']} for r in saved['Rows']]}
  item={'Id':links[0]['JellyfinItemId'],'Name':'Iron Man','Type':'Movie','ProductionYear':2008,'ImageTags':{}}
  setup=f'''<script>
  Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:()=>JSON.stringify({{Servers:[{{Id:'server',UserId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',AccessToken:'mock',ManualAddress:'http://fake.invalid'}}]}})}}}});
  window.fetch=async input=>{{ const path=String(input).split('?')[0];
    if(path.endsWith('/System/Info/Public'))return new Response(JSON.stringify({{Id:'server'}}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
    if(path.endsWith('/FranchiseExplorer/Catalog'))return new Response(JSON.stringify({json.dumps(catalog)}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
    if(path.endsWith('/Items/{item['Id']}'))return new Response(JSON.stringify({json.dumps(item)}),{{status:200,headers:{{'Content-Type':'application/json'}}}});
    return new Response('',{{status:404}});
  }};
  </script>'''
  test_html=browse.replace("<script>\n'use strict';",setup+"<script>\n'use strict';")
  for width in [390,900,1920]:
   page=browser.new_page(viewport={'width':width,'height':900})
   page.set_content(test_html)
   page.get_by_role('button',name='Marvel Cinematic Universe').click()
   page.get_by_role('region',name='Chronological Viewing Order titles').get_by_role('button',name='Iron Man').wait_for(timeout=6000)
   assert page.get_by_role('region',name='Phases titles').get_by_role('button',name='Phase One').count()==1
   assert page.get_by_role('region',name='Unassigned Groups titles').get_by_role('button',name='Thor Collection').count()==1
   scroll=page.evaluate('document.documentElement.scrollWidth')
   assert scroll<=width+1,(width,scroll)
   print('Browser row shelves width',width,'passed')
   page.close()
 finally:browser.close()
print('All rows regression checks passed.')
