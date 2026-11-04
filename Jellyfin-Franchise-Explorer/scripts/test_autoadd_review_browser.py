"""Review-first UX, selections, safe removals, atomic apply/save, and existing/new modes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
html=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
guid=lambda n:f'{n:032x}'
node=guid(1);manual=guid(2);movies=[{'Id':guid(10+n),'Name':'Movie '+str(n),'Type':'Movie','ProviderIds':{'Imdb':'tt'+str(n)}} for n in range(1,5)]
show={'Id':guid(20),'Name':'Agent Carter','Type':'Series'}
episodes=[{'Id':guid(30+n),'Name':'Episode '+str(n),'Type':'Episode','SeriesId':show['Id'],'SeriesName':show['Name'],'ParentIndexNumber':1,'IndexNumber':n,'ProviderIds':{'Imdb':'tt10'+str(n)}} for n in range(1,4)]
source=lambda nums:[{'imdbId':'tt'+str(n),'title':'Movie '+str(n),'type':'Movie','position':i+1} for i,n in enumerate(nums)]
config={'Nodes':[{'Id':node,'ParentId':'','Name':'My manual franchise','Artwork':{}}],'Rows':[],'MediaLinks':[{'Id':manual,'NodeId':node,'JellyfinItemId':movies[2]['Id'],'DisplayName':'My manual title','ItemType':'Movie','RangeMode':'Full','Position':50}]}
mock='window.saved='+json.dumps(config)+';window.library='+json.dumps([*movies,show,*episodes])+';window.entries='+json.dumps(source([1,2,99]))+''';
window.ApiClient={getCurrentUserId:()=> 'ffffffffffffffffffffffffffffffff',getPluginConfiguration:async()=>structuredClone(saved),updatePluginConfiguration:async(id,cfg)=>{if(window.rejectSave)throw Error('Simulated save failure');window.saved=structuredClone(cfg);return {};},getUrl:(p,args)=>'https://mock.invalid/'+p+'?'+new URLSearchParams(args||{}),accessToken:()=> 'mock',getImageUrl:()=>'',getItems:async(uid,args)=>{if(args.fields&&args.fields!=='ProviderIds')throw Error('Invalid Jellyfin ItemFields');return {Items:library,TotalRecordCount:library.length};}};
window.fetch=async()=>new Response(JSON.stringify(window.sourceError?{error:'IMDb HTTP 429'}:{entries:window.entries,orderVerified:true}),{status:window.sourceError?502:200,headers:{'Content-Type':'application/json'}});'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html.replace('<script type="text/javascript">','<script>'+mock+'</script><script type="text/javascript">'));page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.locator('#fx-auto-panel').evaluate('(e)=>e.open=true')
 assert page.locator('#fx-auto-use-existing').get_attribute('aria-pressed')=='true';page.locator('#fx-auto-url').fill('https://www.imdb.com/list/ls1/')
 def preview(text):
  page.locator('#fx-auto-preview').click();page.locator('#fx-auto-results').filter(has_text=text).wait_for()
 def apply():
  page.locator('#fx-auto-apply').click();page.locator('#fx-status').filter(has_text='Applied and saved').wait_for()
 preview('2 additions · 0 removals · 1 missing');assert len(page.evaluate('saved.MediaLinks'))==1
 assert page.get_by_role('checkbox',name='Add Movie 1',exact=True).is_checked();page.get_by_role('checkbox',name='Add Movie 2',exact=True).uncheck();apply()
 assert len(page.evaluate('saved.Nodes'))==1 and len(page.evaluate('saved.MediaLinks'))==2
 assert page.evaluate('(id)=>saved.MediaLinks.some(l=>l.Id===id&&l.DisplayName==="My manual title")',manual)
 page.evaluate('(value)=>window.entries=value',source([2,99]));preview('1 additions · 1 removals · 1 missing')
 remove=page.get_by_role('checkbox',name=re.compile('^Remove Movie 1'));assert remove.is_checked();remove.uncheck();apply();assert len(page.evaluate('saved.MediaLinks'))==3
 preview('0 additions · 1 removals · 1 missing');apply();assert len(page.evaluate('saved.MediaLinks'))==2
 assert page.evaluate('(id)=>!saved.MediaLinks.some(l=>l.JellyfinItemId===id)',movies[0]['Id'])
 # Persisted ownership survives save/reload; hand-edited imports are retained.
 page.evaluate('(id)=>{saved.MediaLinks.find(l=>l.JellyfinItemId===id).DisplayName="Edited auto title";}',movies[1]['Id']);page.locator('#fx-reload').click();page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.evaluate('(value)=>window.entries=value',source([99]));preview('0 additions · 0 removals · 1 missing');assert 'edited Auto-Add reference(s) preserved' in page.locator('#fx-auto-results').inner_text()
 page.evaluate('window.sourceError=true');preview('IMDb HTTP 429');assert page.locator('#fx-auto-apply').is_disabled();page.evaluate('window.sourceError=false')
 # Failed persistence leaves the saved configuration untouched and the selection retryable.
 page.evaluate('(value)=>window.entries=value',source([4]));preview('1 additions');before=page.evaluate('saved');page.evaluate('window.rejectSave=true');page.locator('#fx-auto-apply').click();page.locator('#fx-status').filter(has_text='Apply failed: Simulated save failure').wait_for();assert page.evaluate('saved')==before;page.evaluate('window.rejectSave=false');apply()
 # New-from-URL is a staged preview, with per-episode choices inside a compact range.
 page.locator('#fx-auto-create').click();page.locator('#fx-auto-name').fill('New IMDb franchise');page.locator('#fx-auto-url').fill('https://www.imdb.com/list/ls2/')
 epEntries=[{'imdbId':e['ProviderIds']['Imdb'],'title':e['Name'],'type':'Episode','position':i+1} for i,e in enumerate(episodes)]
 page.evaluate('(value)=>window.entries=value',epEntries);preview('4 additions · 0 removals');assert len(page.evaluate('saved.Nodes'))==1
 assert page.get_by_role('checkbox',name='Add Agent Carter · S01E01–S01E03',exact=True).is_checked()
 page.get_by_role('button',name='Clear selection',exact=True).click();assert page.locator('#fx-auto-apply').is_disabled();page.get_by_role('button',name='Select all changes',exact=True).click()
 page.locator('#fx-auto-results details').evaluate('(e)=>e.open=true');page.get_by_role('checkbox',name='Add Episode 2',exact=True).uncheck();apply()
 saved=page.evaluate('saved');assert len(saved['Nodes'])==2;root=next(n for n in saved['Nodes'] if n['Name']=='New IMDb franchise');ranges=[l for l in saved['MediaLinks'] if l['NodeId']==root['Id']];assert [(l['StartEpisode'],l['EndEpisode']) for l in ranges]==[(1,1),(3,3)]
 tv=next(r for r in saved['Rows'] if r['ParentNodeId']==root['Id'] and r['Name']=='TV Shows');assert len(tv['Items'])==1 and tv['Items'][0]['JellyfinItemId']==show['Id']
 # Replacing an existing range requires selecting its removal; overlaps cannot be added accidentally.
 page.locator('#fx-auto-create').click();page.locator('#fx-auto-name').fill('Range replacement');page.evaluate('(value)=>window.entries=value',epEntries);preview('4 additions');apply()
 page.evaluate('(value)=>window.entries=value',[epEntries[0],{**epEntries[2],'position':2}]);preview('2 additions · 1 removals')
 oldRange=page.get_by_role('checkbox',name=re.compile('^Remove Agent Carter'));oldRange.uncheck();assert page.get_by_role('checkbox',name='Add Agent Carter · S01E01',exact=True).is_disabled();assert page.get_by_role('checkbox',name='Add Agent Carter · S01E03',exact=True).is_disabled();assert page.locator('#fx-auto-apply').is_disabled()
 page.get_by_role('button',name='Select all changes',exact=True).click();apply()
 assert not errors,errors;assert page.locator('#fx-save').evaluate('(e)=>!!e.closest(".fx-toolbar")');browser.close()
print('PASS review-first existing/new workflows: defaults, individual selections, additions/removals/missing, source errors, protected manual edits, save/reload and failed-save retry')
