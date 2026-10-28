#!/usr/bin/env python3
"""Chromium DOM tests using mocked Jellyfin APIs. No real server or media touched."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
html=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text(encoding='utf8')
node='11111111-1111-4111-8111-111111111111'
show='22222222-2222-4222-8222-222222222222'
link='33333333-3333-4333-8333-333333333333'
mock_js='''() => {
  window.ApiClient = {
    getPluginConfiguration: async () => ({NavigationLabel:'Franchises',Nodes:[{Id:'NODE_ID',ParentId:'',Name:'Marvel Cinematic Universe',NodeType:'Franchise',SortOrder:1,CollectionId:'',Overview:'',Artwork:{PrimaryUrl:'',BackdropUrl:'',LogoUrl:'',ThumbUrl:'',BannerUrl:''}}],MediaLinks:[{Id:'LINK_ID',NodeId:'NODE_ID',JellyfinItemId:'SHOW_ID',DisplayName:'Agents of S.H.I.E.L.D.',ItemType:'Series',ViewingOrder:'Custom',Position:7,RangeMode:'Full'}]}),
    getCurrentUserId:()=> '00000000-0000-4000-8000-000000000000',
    getItems: async () => ({Items:[{Id:'SHOW_ID',Name:'Agents of S.H.I.E.L.D.',Type:'Series',ProductionYear:2013,ImageTags:{}}]}),
    updatePluginConfiguration: async () => ({}),
    getImageUrl:()=>'',getUrl:x=>x,
  };
}'''.replace('NODE_ID',node).replace('LINK_ID',link).replace('SHOW_ID',show)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for viewport,hostLeft,hostWidth in [(1600,90,1300),(1150,90,1100),(800,110,1170),(620,90,1100),(390,8,700)]:
        page=browser.new_page(viewport={'width':viewport,'height':860})
        
        fixture_html=html.replace('<script type="text/javascript">','<script>(' + mock_js + ')()</script><script type="text/javascript">')
        host=f'<style>html,body{{margin:0;padding:0;background:#111}} #jellyfin-host{{margin-left:{hostLeft}px;width:{hostWidth}px;min-height:700px}}</style><div id="jellyfin-host">{fixture_html}</div>'
        page.set_content(host,wait_until='load')
        page.wait_for_timeout(150)
        result=page.evaluate('''() => {
           const wrap=document.querySelector('.fx-wrap').getBoundingClientRect();
           const grid=document.querySelector('.fx-grid').getBoundingClientRect();
           const details=document.querySelector('.fx-grid main').getBoundingClientRect();
           return {wrapLeft:wrap.left,wrapRight:wrap.right,gridRight:grid.right,detailsRight:details.right,cols:getComputedStyle(document.querySelector('.fx-grid')).gridTemplateColumns,compact:document.querySelector('.fx-wrap').className,innerWidth};
        }''')
        assert result['wrapRight'] < viewport+1, (viewport,result)
        assert result['detailsRight'] < viewport+1, (viewport,result)
        if viewport<1150: assert 'fx-medium' in result['compact'],(viewport,result)
        print('responsive',viewport,'ok',result['cols'])
        if viewport==800:
            page.locator('.fx-tree-item').filter(has_text='Marvel Cinematic Universe').click()
            page.locator('#fx-media-search').fill('Agent')
            page.wait_for_timeout(600)
            page.get_by_role('button',name='+ Choose TV Show range').click()
            overlay=page.locator('#fx-tv-range')
            assert overlay.is_visible(),'TV show chooser should open'
            page.locator('#fx-range-mode').select_option('Episodes')
            assert page.locator('#fx-start-episode').is_visible()
            page.locator('#fx-start-season').fill('1')
            page.locator('#fx-start-episode').fill('5')
            page.locator('#fx-end-season').fill('2')
            page.locator('#fx-end-episode').fill('8')
            page.locator('#fx-save-range').click()
            assert not overlay.is_visible(),'dialog should close after saving'
            assert page.get_by_text('S1E5 – S2E8').count()>0,'new link should show range'
            page.get_by_role('button',name='Edit TV Show range').last.click()
            assert overlay.is_visible(),'existing link should be editable'
            assert page.locator('#fx-range-mode').input_value()=='Episodes'
            page.locator('#fx-range-mode').select_option('Seasons')
            page.locator('#fx-start-season').fill('1')
            page.locator('#fx-end-season').fill('3')
            page.locator('#fx-save-range').click()
            assert page.get_by_text('Seasons 1–3').count()>0,'edited range should render'
            page.get_by_role('button',name='Edit TV Show range').first.click()
            assert overlay.is_visible()
            page.keyboard.press('Escape')
            assert not overlay.is_visible()
            print('modal open, add, edit, close tests passed')
        page.close()
    browser.close()
print('All mocked Jellyfin browser UI tests passed')
