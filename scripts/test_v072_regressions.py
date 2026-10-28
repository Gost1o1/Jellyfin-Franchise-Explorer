#!/usr/bin/env python3
"""Offline v0.7.2 regressions using a mock Jellyfin Admin page (no server access)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from tempfile import TemporaryDirectory
root=Path(__file__).resolve().parents[1]
html=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text(encoding='utf8')
js="""() => {
  window.ApiClient={getPluginConfiguration:async()=>({NavigationLabel:'Franchises',Nodes:[
    {Id:'11111111-1111-4111-8111-111111111111',ParentId:'',Name:'Marvel Cinematic Universe',NodeType:'Franchise',CollectionId:'',SortOrder:1,Artwork:{}},
    {Id:'22222222-2222-4222-8222-222222222222',ParentId:'11111111-1111-4111-8111-111111111111',Name:'Phase Six',NodeType:'Phase',CollectionId:'',SortOrder:6,Artwork:{}}
  ],MediaLinks:[]}),
  getCurrentUserId:()=> '00000000-0000-4000-8000-000000000000',
  updatePluginConfiguration:async (id,cfg)=>{window.__saved=cfg;return {}},
  getImageUrl:()=>'',getUrl:x=>x,
  getItems:async()=>({Items:[]})
  };
}"""
fixture=html.replace('<script type="text/javascript">','<script>('+js+')()</script><script type="text/javascript">')
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1280,'height':1000})
    page.set_content(fixture, wait_until='load')
    page.locator('.fx-tree-item').filter(has_text='Phase Six').click()
    page.locator('#fx-add-sibling').click()
    assert page.locator('#fx-name').input_value()=='New subgroup'
    assert page.locator('#fx-type').input_value()=='Phase', 'sibling retains source group type'
    # Unlike the old behavior, tree label and scope must change while typing.
    page.locator('#fx-name').fill('Test collection')
    assert page.locator('.fx-tree-item').filter(has_text='Test collection').count()==1
    page.locator('#fx-type').select_option('Collection')
    assert 'Editing Collection: Test collection' in page.locator('#fx-artwork-scope').inner_text()
    # Saving must persist the correct sibling parent ID and user-friendly name.
    page.locator('#fx-save').click()
    page.wait_for_function('window.__saved !== undefined')
    saved=page.evaluate('window.__saved')
    node=next(n for n in saved['Nodes'] if n['Name']=='Test collection')
    assert node['ParentId']=='11111111-1111-4111-8111-111111111111'
    assert node['CollectionArtworkMode']=='Preserve'
    assert node['NodeType']=='Collection'
    print('PASS sibling creation, type, live renaming, and save compatibility')
    page.close();b.close()
