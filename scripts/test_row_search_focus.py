#!/usr/bin/env python3
"""Browser regression: slow typing never loses row-search focus after a rerender.
Uses a simulated Jellyfin API; does not connect to a real server.
Run locally with playwright and Chromium installed.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
franchise='11111111-1111-4111-8111-111111111111'
media=[
 {'Id':'44444444-4444-4444-8444-444444444444','Name':'Loki','Type':'Series','ProductionYear':2021,'ImageTags':{}},
 {'Id':'55555555-5555-4555-8555-555555555555','Name':'Thor Collection','Type':'BoxSet','ProductionYear':2011,'ImageTags':{}},
 {'Id':'66666666-6666-4666-8666-666666666666','Name':'Iron Man','Type':'Movie','ProductionYear':2008,'ImageTags':{}}
]
initial={'NavigationLabel':'Franchises','Nodes':[{'Id':franchise,'ParentId':'','Name':'Marvel Cinematic Universe','NodeType':'Franchise','SortOrder':1,'Artwork':{}}], 'MediaLinks':[], 'Rows':[]}
mock=f'''<script>
window.saved={json.dumps(initial)};
window.available={json.dumps(media)};
window.ApiClient={{getPluginConfiguration:async()=>JSON.parse(JSON.stringify(window.saved)),updatePluginConfiguration:async(id,cfg)=>{{window.saved=JSON.parse(JSON.stringify(cfg));return {{}};}},getCurrentUserId:()=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',getUrl:x=>x,getItems:async(u,p)=>({{Items:window.available.filter(x=>x.Name.toLowerCase().includes(String(p.searchTerm||'').toLowerCase()))}}),getItem:async(u,id)=>window.available.find(x=>x.Id===id)}};
window.Dashboard={{processPluginConfigurationUpdateResult:()=>{{}}}};
</script>'''
with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  try:
    for width in (390,1280):
      page=browser.new_page(viewport={'width':width,'height':900})
      page.on('dialog', lambda dialog: dialog.accept())
      page.set_content(html.replace('<script type="text/javascript">',mock+'<script type="text/javascript">'))
      page.get_by_role('treeitem',name='Marvel Cinematic Universe').click()
      for rowtype in ('Media','Timeline','Mixed'):
        page.locator('#fx-new-row-name').fill('Focus '+rowtype)
        page.locator('#fx-new-row-type').select_option(rowtype)
        page.locator('#fx-create-row').click()
        row=page.locator('.fx-row-card').last
        search=row.get_by_role('searchbox',name='Search Jellyfin library for Focus '+rowtype)
        search.click()
        # Waiting longer than the 300 ms debounce after EVERY character forces
        # the search completion path while the user is still typing.
        for idx,letter in enumerate('Loki'):
          page.keyboard.type(letter)
          assert search.input_value()=='Loki'[:idx+1]
          page.wait_for_timeout(430)
          assert search.evaluate('(el)=>document.activeElement===el'),(width,rowtype,idx)
          assert search.input_value()=='Loki'[:idx+1]
        assert row.get_by_role('button',name='Choose TV Show range').count()==1
        # Editing a query should not move the caret or destroy the input.
        search.press('ControlOrMeta+A')
        page.keyboard.type('Thor',delay=110)
        page.wait_for_timeout(550)
        assert search.evaluate('(el)=>document.activeElement===el')
        assert search.input_value()=='Thor'
        assert row.get_by_text('Thor Collection · Collection').count()==1
        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2')
        print('Continuous typing, async results and focus',width,rowtype,'passed')
      page.close()
  finally:
    browser.close()
print('Row search focus regression passed.')
