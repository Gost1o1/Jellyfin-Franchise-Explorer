#!/usr/bin/env python3
"""v0.8.0.1 UI regression: selection controls align left and update.
Mocked Jellyfin API; does not contact a live server.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
p=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'
html=p.read_text()
root='11111111-1111-4111-8111-111111111111'
movie='22222222-2222-4222-8222-222222222222'
config={'NavigationLabel':'Franchises','Nodes':[{'Id':root,'Name':'Marvel','NodeType':'Franchise','ParentId':'','Artwork':{},'SortOrder':1}], 'Rows':[], 'MediaLinks':[]}
media={'Id':movie,'Type':'Movie','Name':'Iron Man','ProductionYear':2008}
mock=f'''<script>
window.saved={json.dumps(config)};
window.ApiClient={{getPluginConfiguration:async()=>JSON.parse(JSON.stringify(window.saved)),updatePluginConfiguration:async(id,cfg)=>{{window.saved=JSON.parse(JSON.stringify(cfg));}}, getCurrentUserId:()=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',getUrl:x=>x,getItems:async(u,p)=>({{Items:[{json.dumps(media)}].filter(i=>i.Name.toLowerCase().includes((p.searchTerm||'').toLowerCase()))}}),getItem:async()=>({json.dumps(media)})}};
window.Dashboard={{processPluginConfigurationUpdateResult:()=>{{}}}};
</script>'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for width in [390,900,1920]:
            page=browser.new_page(viewport={'width':width,'height':900})
            page.set_content(html.replace('<script type="text/javascript">',mock+'<script type="text/javascript">'))
            page.get_by_role('treeitem',name='Marvel').click()
            page.locator('#fx-new-row-name').fill('Chronological')
            page.locator('#fx-new-row-type').select_option('Timeline')
            page.locator('#fx-create-row').click()
            row=page.locator('.fx-row-card').last
            row.get_by_role('searchbox').fill('Iron')
            result=row.locator('.fx-library-result')
            result.wait_for(timeout=5000)
            boxes=page.evaluate('''() => {
              const row=document.querySelector('.fx-library-result');
              const box=row.querySelector('input[type="checkbox"]').getBoundingClientRect();
              const name=row.querySelector('span').getBoundingClientRect();
              return {checkboxX:box.left, labelX:name.left, checkboxY:box.top+box.height/2, labelY:name.top+name.height/2, checkboxWidth:box.width};
            }''')
            assert boxes['checkboxX'] < boxes['labelX'],(width,boxes)
            assert abs(boxes['checkboxY']-boxes['labelY']) < 8,(width,boxes)
            assert boxes['checkboxWidth']<=26,(width,boxes)
            assert row.get_by_role('button',name='Add Selected (0)').count()==1
            result.locator('input[type="checkbox"]').check()
            assert row.get_by_role('button',name='Add Selected (1)').count()==1
            print('Checkbox-left UI and Add Selected count passed',width)
            page.close()
    finally: browser.close()
