#!/usr/bin/env python3
"""Opt-in live IMDb controller + browser preview/apply check; Jellyfin library is simulated.
Run with the .NET 10 SDK on PATH. Never included in offline CI or auto-run as a test_*.py.
"""
from pathlib import Path
import json, subprocess, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as directory:
 payload=Path(directory)/'imdb.json'
 subprocess.run(['dotnet','run','--project',str(root/'tests/AutoAdd.Tests'),'-c','Release','--','--live',str(payload)],cwd=root,check=True)
 data=json.loads(payload.read_text());entries=data['entries']
 movie=next(e for e in entries if e['type']=='Movie');episode=next(e for e in entries if e['type']=='Episode')
 library=[{'Id':'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','Type':'Movie','Name':movie['title'],'ProductionYear':movie['year'],'ProviderIds':{'Imdb':movie['imdbId']}},
          {'Id':'cccccccccccccccccccccccccccccccc','Type':'Episode','Name':episode['title'],'SeriesId':'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','SeriesName':'Agent Carter','ParentIndexNumber':1,'IndexNumber':1,'ProductionYear':episode['year'],'ProviderIds':{'Imdb':episode['imdbId']}}]
 library.append({'Id':'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','Type':'Series','Name':'Agent Carter','ProviderIds':{}})
 config={'Nodes':[{'Id':'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Name':'MCU','ParentId':'','AutoAddSources':[{'Id':'dddddddddddddddddddddddddddddddd','Url':'https://www.imdb.com/list/ls539646485/','Enabled':True,'Priority':0,'Categories':['Chronological Timeline','Movies','TV Shows','Collections','Other']}]}],'MediaLinks':[],'Rows':[]}
 mock='window.saved='+json.dumps(config)+';window.library='+json.dumps(library)+';window.source='+json.dumps(data)+''';
 window.ApiClient={getCurrentUserId:()=> 'ffffffffffffffffffffffffffffffff',getPluginConfiguration:async()=>structuredClone(saved),updatePluginConfiguration:async(id,cfg)=>{window.saved=structuredClone(cfg);return {};},getUrl:(p,args)=>'https://mock.invalid/'+p+'?'+new URLSearchParams(args||{}),accessToken:()=> 'mock',getImageUrl:()=>'',getItems:async()=>({Items:window.library,TotalRecordCount:window.library.length})};
 window.fetch=async()=>new Response(JSON.stringify(window.source),{status:200,headers:{'Content-Type':'application/json'}});'''
 html=(root/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
  page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html.replace('<script type="text/javascript">','<script>'+mock+'</script><script type="text/javascript">'))
  page.locator('#fx-status').filter(has_text='Loaded.').wait_for();page.locator('#fx-auto-panel').evaluate('(e)=>e.open=true')
  page.locator('#fx-auto-preview').click();page.locator('#fx-auto-results').filter(has_text='2 matched, '+str(len(entries)-2)+' unmatched, 0 ambiguous').wait_for()
  page.locator('#fx-auto-apply').click();page.locator('#fx-status').filter(has_text='Applied and saved').wait_for()
  saved=page.evaluate('window.saved');assert len(saved['MediaLinks'])==2
  timeline=next(row for row in saved['Rows'] if row['Name']=='Chronological Timeline');assert len(timeline['MediaLinkIds'])==2
  assert saved['MediaLinks'][1]['JellyfinItemId']==library[1]['SeriesId'] and saved['MediaLinks'][1]['RangeMode']=='Episodes'
  tv=next(row for row in saved['Rows'] if row['Name']=='TV Shows');assert len(tv['Items'])==1 and tv['Items'][0]['JellyfinItemId']==library[1]['SeriesId']
  assert not errors,errors
  browser.close()
 print(f'PASS LIVE IMDb-to-editor pipeline: {len(entries)} real source entries, exact movie/episode matches, preview-only missing titles, virtual import/save. Jellyfin library and playback simulated.')
