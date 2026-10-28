#!/usr/bin/env python3
"""Optional Chromium UI test with mocked sessions and TV episode data.
Does NOT make requests to a real Jellyfin server.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
base=root/'src/Jellyfin.Plugin.FranchiseExplorer'
html=(base/'Configuration/browsePage.html').read_text()
client=(base/'Web/franchise-timeline.js').read_text()
html=html.replace('<script src="TimelineClient.js"></script>','<script>'+client+'</script>')
uid=lambda n:f'{n:08d}-1111-4111-8111-111111111111'
marvel=uid(1);rowid=uid(2);showid=uid(3);movieid=uid(4);refshow=uid(5);refmovie=uid(6);user=uid(7)
cat={'title':'Franchises','nodes':[{'id':marvel,'parentId':'','name':'Marvel Cinematic Universe','nodeType':'Franchise','overview':'','sortOrder':0,'artwork':{}}],
     'links':[], 'rows':[{'id':rowid,'parentNodeId':marvel,'name':'Chronological Viewing Order','rowType':'Timeline','nodeIds':[],
                         'mediaLinkIds':[], 'mediaOrder':[refshow,refmovie],'items':[
                         {'id':refshow,'itemId':showid,'rangeMode':'Episodes','startSeason':1,'startEpisode':2,'endSeason':2,'endEpisode':2},
                         {'id':refmovie,'itemId':movieid,'rangeMode':'Full'}]}]}
items={showid:{'Id':showid,'Type':'Series','Name':'Agents of S.H.I.E.L.D.','ImageTags':{}},
       movieid:{'Id':movieid,'Type':'Movie','Name':'The Avengers','RunTimeTicks':5000000000,'ImageTags':{}}}
episodes=[{'Id':uid(100+i),'Type':'Episode','Name':'Episode '+str(ep),'SeriesId':showid,'ParentIndexNumber':season,'IndexNumber':ep,'RunTimeTicks':1000000000,'ImageTags':{}} for i,(season,ep) in enumerate([(1,1),(1,2),(1,3),(2,1),(2,2),(2,3)])]
# The browser page imports credentials from Jellyfin Web on the same origin.
setup=f'''<script>
const SAMPLE_CATALOG={json.dumps(cat)};
const SAMPLE_ITEMS={json.dumps(items)};
const SAMPLE_EPISODES={json.dumps(episodes)};
window.__played=[];window.__state=null;
Object.defineProperty(window,'localStorage',{{configurable:true,value:{{getItem:()=>JSON.stringify({{Servers:[{{Id:'testserver',UserId:'{user}',AccessToken:'fake',ManualAddress:'http://test.invalid'}}]}})}}}});
window.fetch=async function(input,options={{}}){{
 const path=String(input);
 const ok=(v)=>new Response(JSON.stringify(v),{{status:200,headers:{{'Content-Type':'application/json'}}}});
 if(path.includes('/System/Info/Public'))return ok({{Id:'testserver'}});
 if(path.includes('/FranchiseExplorer/Catalog'))return ok(SAMPLE_CATALOG);
 if(path.includes('/FranchiseExplorer/TimelineState/')&&options.method==='PUT'){{window.__state=JSON.parse(options.body);return ok(window.__state);}}
 if(path.includes('/FranchiseExplorer/TimelineState'))return ok(window.__state?[window.__state]:[]);
 if(path.includes('/Shows/{showid}/Episodes'))return ok({{Items:SAMPLE_EPISODES,TotalRecordCount:SAMPLE_EPISODES.length}});
 if(path.includes('/Sessions?'))return ok([{{Id:'dev1',UserId:'{user}',DeviceName:'Chrome Web',UserName:'Mock'}}]);
 if(path.includes('/Sessions/dev1/Playing')){{window.__played.push(path);return new Response(null,{{status:204}});}}
 const key=path.split('?')[0].split('/').pop();if(SAMPLE_ITEMS[key])return ok(SAMPLE_ITEMS[key]);
 return new Response('',{{status:404}});
}};
</script>'''
html=html.replace("<script>\n'use strict';",setup+"\n<script>\n'use strict';")
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  for width in [390,900,1920]:
   page=browser.new_page(viewport={'width':width,'height':920})
   page.set_content(html,wait_until='load')
   page.get_by_role('button',name='Marvel Cinematic Universe').wait_for(timeout=8000)
   page.get_by_role('button',name='Marvel Cinematic Universe').click()
   page.get_by_role('button',name='▶ Play chronological order').click()
   dialog=page.get_by_role('dialog',name='Chronological playback for Chronological Viewing Order')
   dialog.wait_for(timeout=8000)
   dialog.get_by_text('5 playable movies/episodes').wait_for(timeout=8000)
   assert dialog.get_by_text('S1E2').count() and dialog.get_by_text('S2E2').count()
   dialog.get_by_role('button',name='▶ Play from beginning').click()
   page.wait_for_function('window.__played.length===1',timeout=4000)
   progress=page.evaluate('window.__state')
   assert progress['total']==5 and progress['index']==0 and progress['playbackMode']=='playing',progress
   assert progress['queueLengths'][0]>0
   dialog.get_by_role('button',name='Replay only').first.click()
   page.wait_for_function("window.__state && window.__state.playbackMode === 'replay'",timeout=4000)
   assert page.evaluate('window.__state.completedKeys.length')==0
   page.wait_for_function('window.__played.length===2',timeout=4000)
   metrics=page.evaluate('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})')
   assert metrics['scroll']<=metrics['width']+1,(width,metrics)
   page.close()
   print('Mocked timeline browser passed',width,'px')
 finally:browser.close()
print('All timeline browser UI tests passed (mock data only).')
