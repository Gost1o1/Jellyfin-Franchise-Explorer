"""Editor integration with mocked IMDb and Jellyfin responses; no live server."""
from pathlib import Path
from playwright.sync_api import sync_playwright
html=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
mock=r'''window.saved={NavigationLabel:'Franchises',Nodes:[],MediaLinks:[],Rows:[]};
window.ApiClient={getCurrentUserId:()=> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getPluginConfiguration:async()=>structuredClone(window.saved),updatePluginConfiguration:async(id,cfg)=>{window.saved=structuredClone(cfg);return {};},getUrl:(p,args)=>'https://mock.invalid/'+p+'?'+new URLSearchParams(args||{}),accessToken:()=> 'mock',getImageUrl:()=>'',getItems:async()=>({Items:[{Id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',Name:'First Avenger',Type:'Movie',ProductionYear:2011,ProviderIds:{Imdb:'tt0458339'}}],TotalRecordCount:1})};
window.fetch=async(url)=>new Response(JSON.stringify(window.sourceError?{error:'IMDb HTTP 403'}:{Entries:[{ImdbId:'tt0458339',Title:'First Avenger',Year:2011,Type:'Movie',Position:1},{ImdbId:'tt999999',Title:'Missing title',Year:2020,Type:'Movie',Position:2}],OrderVerified:true}),{status:window.sourceError?502:200,headers:{'Content-Type':'application/json'}});'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html.replace('<script type="text/javascript">','<script>'+mock+'</script><script type="text/javascript">'))
 page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.locator('#fx-auto-panel').evaluate('(e)=>e.open=true')
 page.locator('#fx-auto-create').click();assert page.locator('#fx-auto-sources input[type=url]').count()==1
 page.locator('#fx-auto-add-source').click();urls=page.locator('#fx-auto-sources input[type=url]');urls.nth(1).fill('https://www.imdb.com/list/ls2/');urls.nth(1).dispatch_event('change')
 checks=page.locator('#fx-auto-sources input[aria-label="Enable source"]');checks.nth(1).uncheck()
 assert urls.nth(1).evaluate('(e)=>({color:getComputedStyle(e).color,line:getComputedStyle(e).textDecorationLine})')=={'color':'rgb(144, 153, 164)','line':'none'}
 checks.nth(1).check();assert urls.nth(1).evaluate('(e)=>getComputedStyle(e).color')=='rgb(237, 240, 243)';checks.nth(1).uncheck()
 page.locator('#fx-save').click();page.locator('#fx-status').filter(has_text='Saved plugin-owned').wait_for()
 checks.nth(1).check();page.locator('#fx-save').click();page.locator('#fx-status').filter(has_text='Saved plugin-owned').wait_for();assert page.evaluate('saved.Nodes[0].AutoAddSources[1].Enabled')
 checks.nth(1).uncheck();page.locator('#fx-save').click();page.locator('#fx-status').filter(has_text='Saved plugin-owned').wait_for()
 page.locator('#fx-reload').click();page.locator('#fx-status').filter(has_text='Loaded.').wait_for();assert urls.count()==2 and not checks.nth(1).is_checked()
 page.locator('#fx-auto-preview').click();page.locator('#fx-auto-results').filter(has_text='1 matched, 1 unmatched, 0 ambiguous').wait_for();page.locator('#fx-auto-apply').click()
 page.locator('#fx-status').filter(has_text='Added 1 new virtual').wait_for();page.locator('#fx-save').click();page.locator('#fx-status').filter(has_text='Saved plugin-owned').wait_for()
 assert page.evaluate('saved.MediaLinks.length')==1 and page.evaluate('saved.Rows.length')==5
 page.locator('#fx-auto-preview').click();page.wait_for_function('!document.querySelector("#fx-auto-apply").disabled');page.locator('#fx-auto-apply').click();page.locator('#fx-status').filter(has_text='Added 0 new virtual').wait_for()
 page.evaluate('window.sourceError=true');page.locator('#fx-auto-preview').click();page.locator('#fx-auto-results').filter(has_text='IMDb HTTP 403').wait_for();assert page.locator('#fx-auto-apply').is_disabled()
 assert not errors,errors
 assert page.locator('#fx-save').evaluate('(e)=>!!e.closest(".fx-toolbar")');browser.close()
print('PASS Auto-Add browser: mobile editor, multiple URLs, source styling, save/reload, preview/apply, idempotent rerun, HTTP 403, top Save')
