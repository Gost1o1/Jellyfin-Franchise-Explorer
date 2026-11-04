"""Real editor grouping and read-only display of old flat imports; no real Jellyfin data."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
root=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
config_html=(root/'Configuration/configPage.html').read_text();browse_html=(root/'Configuration/browsePage.html').read_text();client=(root/'Web/franchise-timeline.js').read_text()
guid=lambda n:f'{n:032x}'
show={'Id':guid(1),'Name':'Agent Carter','Type':'Series','ProviderIds':{}}
movie={'Id':guid(2),'Name':'A movie between episodes','Type':'Movie','ProviderIds':{'Imdb':'tt99'}}
episodes=[{'Id':guid(10+n),'Name':'Episode '+str(n),'SeriesId':show['Id'],'SeriesName':show['Name'],'Type':'Episode','ParentIndexNumber':1,'IndexNumber':n,'ProviderIds':{'Imdb':'tt'+str(n)}} for n in range(1,6)]
library=[show,movie,*episodes];order=[episodes[0],episodes[1],episodes[2],movie,episodes[3],episodes[4]]
entries=[{'imdbId':x['ProviderIds']['Imdb'],'title':x['Name'],'type':x['Type'],'position':n+1} for n,x in enumerate(order)]
mock='window.saved={Nodes:[],Rows:[],MediaLinks:[]};window.library='+json.dumps(library)+';window.source='+json.dumps({'entries':entries,'orderVerified':True})+''';
window.ApiClient={getCurrentUserId:()=> 'ffffffffffffffffffffffffffffffff',getPluginConfiguration:async()=>structuredClone(saved),updatePluginConfiguration:async(id,cfg)=>{window.saved=structuredClone(cfg);return {};},getUrl:(p,args)=>'https://mock.invalid/'+p+'?'+new URLSearchParams(args||{}),accessToken:()=> 'mock',getImageUrl:()=>'',getItems:async()=>({Items:library,TotalRecordCount:library.length})};
window.fetch=async()=>new Response(JSON.stringify(window.source),{status:200,headers:{'Content-Type':'application/json'}});'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(config_html.replace('<script type="text/javascript">','<script>'+mock+'</script><script type="text/javascript">'));page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.locator('#fx-auto-panel').evaluate('(e)=>e.open=true');page.locator('#fx-auto-create').click();page.locator('#fx-auto-preview').click();page.wait_for_function('!document.querySelector("#fx-auto-apply").disabled')
 assert 'S01E01–S01E03' in page.locator('#fx-auto-results').inner_text()
 page.locator('#fx-auto-apply').click();page.locator('#fx-status').filter(has_text='Applied and saved').wait_for();saved=page.evaluate('saved')
 tv=next(r for r in saved['Rows'] if r['Name']=='TV Shows');chron=next(r for r in saved['Rows'] if r['RowType']=='Timeline')
 assert len(tv['Items'])==1 and tv['Items'][0]['JellyfinItemId']==show['Id'] and not tv['MediaLinkIds']
 assert len(chron['MediaLinkIds'])==3
 ranges=[l for l in saved['MediaLinks'] if l['RangeMode']=='Episodes'];assert [(l['StartEpisode'],l['EndEpisode']) for l in ranges]==[(1,3),(4,5)]
 assert not any(l['ItemType']=='Episode' for l in saved['MediaLinks'])
 page.locator('#fx-reload').click();page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.locator('#fx-auto-preview').click();page.locator('#fx-auto-results').filter(has_text='0 additions · 0 removals').wait_for();assert page.locator('#fx-auto-apply').is_disabled();assert page.evaluate('saved')==saved
 page.close()
 # Existing flat rows are grouped only in the view, retaining their original queue IDs and watched keys.
 for legacy in [False,True]:
  node=guid(100);row=guid(101);tvrow=guid(102)
  if legacy:
   links=[{'id':guid(200+n),'nodeId':node,'itemId':x['Id'],'itemType':x['Type'],'rangeMode':'Full'} for n,x in enumerate(order)]
   rows=[{'id':row,'parentNodeId':node,'name':'Chronological Timeline','rowType':'Timeline','autoAddCategory':'Chronological Timeline','mediaLinkIds':[l['id'] for l in links],'mediaOrder':[l['id'] for l in links],'items':[]},
         {'id':tvrow,'parentNodeId':node,'name':'TV Shows','rowType':'Media','autoAddCategory':'TV Shows','mediaLinkIds':[l['id'] for l in links if l['itemType']=='Episode'],'mediaOrder':[l['id'] for l in links if l['itemType']=='Episode'],'items':[]}]
  else:
   links=[{'id':l['Id'],'nodeId':node,'itemId':l['JellyfinItemId'],'itemType':l['ItemType'],'rangeMode':l['RangeMode'],'startSeason':l['StartSeason'],'endSeason':l['EndSeason'],'startEpisode':l['StartEpisode'],'endEpisode':l['EndEpisode']} for l in saved['MediaLinks']]
   rows=[{'id':row,'parentNodeId':node,'name':'Chronological Timeline','rowType':'Timeline','autoAddCategory':'Chronological Timeline','mediaLinkIds':chron['MediaLinkIds'],'mediaOrder':chron['MediaOrder'],'items':[]},
         {'id':tvrow,'parentNodeId':node,'name':'TV Shows','rowType':'Media','autoAddCategory':'TV Shows','mediaLinkIds':[],'mediaOrder':[tv['Items'][0]['Id']],'items':[{'id':tv['Items'][0]['Id'],'itemId':show['Id'],'itemType':'Series','rangeMode':'Full'}]}]
  catalog={'title':'Franchises','nodes':[{'id':node,'parentId':'','name':'MCU'}],'links':links,'rows':rows}
  keys=[(links[n]['id'] if legacy else chron['MediaLinkIds'][0 if n<3 else 1 if n==3 else 2])+':'+x['Id'] for n,x in enumerate(order)]
  state={'RowId':row,'ParentNodeId':node,'Name':'Chronological Timeline','PlaybackMode':'paused','Total':6,'Index':1,'QueueKeys':keys,'CompletedKeys':[keys[0]],'QueueSourceItemIds':[x['Id'] if legacy else movie['Id'] if x['Type']=='Movie' else show['Id'] for x in order],'QueueSeasons':[x.get('ParentIndexNumber',0) for x in order],'QueueEpisodes':[x.get('IndexNumber',0) for x in order]}
  mutations=[];items={x['Id']:x for x in library};page=browser.new_page(viewport={'width':900,'height':950});page.on('pageerror',lambda e:errors.append(str(e)))
  def respond(route):
   path=route.request.url.split('?')[0]
   if route.request.method not in ['GET','HEAD']:mutations.append(route.request.url)
   if path.endswith('/web/'):
    route.fulfill(content_type='text/html',body='<main>Show seasons and episodes</main>');return
   if path.endswith('/Browse'):route.fulfill(content_type='text/html',body=browse_html);return
   if path.endswith('/TimelineClient.js'):route.fulfill(content_type='text/javascript',body=client);return
   if path.endswith('/System/Info/Public'):value={'Id':'server'}
   elif path.endswith('/Catalog'):value=catalog
   elif '/TimelineState' in path:value=[state]
   elif '/Items/' in path:value=items.get(path.split('/Items/')[1])
   else:route.fulfill(status=404,body='');return
   route.fulfill(content_type='application/json',body=json.dumps(value))
  page.route('http://jellyfin.test/**',respond);page.add_init_script("localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'server',UserId:'ffffffffffffffffffffffffffffffff',AccessToken:'mock',ManualAddress:'http://jellyfin.test'}]}))")
  page.goto('http://jellyfin.test/FranchiseExplorer/Browse');page.get_by_role('button',name=re.compile('^MCU')).click();shelf=page.get_by_role('region',name='TV Shows titles',exact=True);shelf.locator('.tile').first.wait_for();assert shelf.locator('.tile').count()==1
  timeline=page.get_by_role('region',name='Chronological Timeline titles',exact=True);assert timeline.locator('.tile').count()==3
  assert 'S1E1' in timeline.inner_text() and 'S1E3' in timeline.inner_text();assert '1 of 3 watched' in timeline.inner_text()
  assert state['QueueKeys']==keys and state['CompletedKeys']==[keys[0]] and not mutations
  shelf.locator('.tile').first.click();page.wait_for_url('**/web/**');assert 'details?id='+show['Id'] in page.url and 'feAutoPlay' not in page.url
  page.close()
 assert not errors,errors
 browser.close()
print('PASS grouped editor import/save/reload and existing flat-row display: one show card, contiguous ranges, original watched keys/progress, show-details browsing')
