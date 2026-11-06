#!/usr/bin/env python3
"""Mock native Web handoff: activate only after local video and session progress agree."""
from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
script=(base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
client=(base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';movie='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';row='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
 try:
  for supports in (True,False):
   page=browser.new_page();page.route('http://jellyfin.test/**',lambda r:r.fulfill(content_type='text/html',body='<div class="itemsContainer"></div><video style="width:320px;height:180px"></video>'))
   page.goto('http://jellyfin.test/web/index.html#/home')
   page.evaluate('''({uid,movie,row,supports})=>{
    localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'testserver',UserId:uid,AccessToken:'mock',ManualAddress:location.origin}]}));
    localStorage.setItem('_deviceId2','THIS-DEVICE');
    localStorage.setItem('fe-local-timeline-v1:'+uid,JSON.stringify({version:1,created:Date.now(),rowId:row,expectedId:movie,homeOnly:true,subtitleEnabled:false,replayOnly:false,state:{rowId:row,index:0,itemId:movie,playbackMode:'paused'}}));
    window.saved=[];window.enrolled=[];window.clicked=0;window.started=false;window.ticks=0;
    const video=document.querySelector('video');
    Object.defineProperties(video,{paused:{get:()=>!window.started},readyState:{get:()=>4},currentTime:{get:()=>window.ticks}});
    setInterval(()=>{if(window.started)window.ticks+=1;},200);
    document.addEventListener('click',e=>{if(e.target.closest('.itemAction')){
      if(window.enrolled.length!==1)throw Error('Native launch preceded subtitle enrollment');
      window.clicked++;window.started=supports;
    }});
    window.fetch=async(path,options={})=>{
     const ok=v=>new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}});
     if(String(path).endsWith('/FranchiseExplorer/PlaybackPreferences')){
       const body=JSON.parse(options.body);
       if(body.deviceId!=='THIS-DEVICE'||body.enabled!==false||body.itemIds[0]!==movie)throw Error('Wrong subtitle enrollment scope');
       window.enrolled.push(body);return ok({enabled:false,language:'eng',subtitleStreamIndex:-1,mediaSourceId:'SOURCE'});
     }
     if(String(path).includes('/Sessions'))return ok([{Id:'SESSION1',UserId:uid,DeviceId:'THIS-DEVICE',Client:'Jellyfin Web',PlayState:{PositionTicks:window.ticks*10000000,IsPaused:false},NowPlayingItem:window.started?{Id:movie}:null}]);
     if(String(path).endsWith('/Activate')&&options.method==='POST'){window.saved.push(JSON.parse(options.body));return ok({rowId:row,index:0,itemId:movie,playbackMode:'playing',sessionId:'SESSION1'});}
     if(options.method==='PUT'||String(path).includes('/Complete'))throw new Error('Unexpected history mutation');
     return ok([]);
    };
   }''',{'uid':uid,'movie':movie,'row':row,'supports':supports})
   page.add_script_tag(content=client)
   page.add_script_tag(content=script)
   assert page.evaluate('(id)=>window.FranchiseExplorerNativePlayback.play(id,{type:"Movie",startOver:true})',movie)
   page.wait_for_function('window.clicked===1')
   assert page.evaluate('window.enrolled.length')==1
   if supports:
    page.wait_for_function('window.saved.length===1',timeout=7000)
    assert page.evaluate('window.saved[0]')=={'sessionId':'SESSION1','itemId':movie}
    assert page.evaluate('(uid)=>JSON.parse(localStorage.getItem("fe-local-follow-v1:"+uid)).lastItemId',uid)==movie
    assert page.evaluate('(uid)=>localStorage.getItem("fe-local-timeline-v1:"+uid)',uid) is None
   else:
    page.wait_for_timeout(2500);assert page.evaluate('window.saved.length')==0
    assert page.evaluate('(uid)=>localStorage.getItem("fe-local-follow-v1:"+uid)',uid) is None
    assert page.evaluate('(uid)=>JSON.parse(localStorage.getItem("fe-local-timeline-v1:"+uid)).expectedId',uid)==movie
   assert page.evaluate('location.hash')=='#/home'
   print('PASS native handoff:', 'verified local progress activates once' if supports else 'unverified playback leaves history unchanged')
   page.close()
 finally:browser.close()
