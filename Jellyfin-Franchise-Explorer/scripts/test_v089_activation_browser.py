#!/usr/bin/env python3
"""Mocked Jellyfin Web: explicit arm -> verified session -> pending auto-next.
This is an integration regression, not validation on a real Jellyfin server.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

bridge = (Path(__file__).resolve().parents[1] / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
second = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
row = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True,
        executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
        args=['--no-sandbox'])
    try:
        page = browser.new_page()
        page.goto('about:blank')
        page.set_content('<main class="page"><button class="btnPlay">Play</button>'
                         '<video id="movie" style="width:640px;height:360px;display:block"></video></main>')
        page.evaluate('''({uid,first,second,row})=>{
          const memory=new Map();
          Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,
            setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});
          localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
            AccessToken:'TEST',UserId:uid,ManualAddress:'about:blank'}]}));
          const state={rowId:row,name:'Chronological Order',index:0,itemId:first,total:2,
            playbackMode:'armed',sessionId:'',completedKeys:[],
            queueKeys:['ref1:'+first,'ref2:'+second],queueLengths:[1e9,1e9],
            queueSourceItemIds:[first,second],queueSeasons:[0,1],queueEpisodes:[0,1],
            positionTicks:0};
          localStorage.setItem('fe-local-timeline-v1:'+uid,JSON.stringify({
            version:1,created:Date.now(),rowId:row,expectedId:first,state,
            replayOnly:false,routePending:true,navigationAttempts:0,subtitleEnabled:false}));
          window.serverState=state;
          window.activations=0;window.playClicks=0;window.startTime=Date.now();
          document.querySelector('.btnPlay').addEventListener('click',()=>{
            window.playClicks++;window.startTime=Date.now();});
          const video=document.getElementById('movie');
          Object.defineProperty(video,'paused',{get:()=>window.playClicks===0});
          Object.defineProperty(video,'ended',{get:()=>false});
          Object.defineProperty(video,'readyState',{get:()=>4});
          Object.defineProperty(video,'currentTime',{get:()=>window.playClicks?(Date.now()-window.startTime)/1000:0});
          window.fetch=async (url,options={})=>{
            const target=String(url);
            if(target.includes('/Sessions?'))return {ok:true,status:200,json:async()=>[{
              Id:'SESSION',UserId:uid.replace(/-/g,''),Client:'Jellyfin Web',
              DeviceId:'DEVICE',NowPlayingItem:{Id:first},
              PlayState:{PositionTicks:Math.floor((Date.now()-window.startTime)*10000),IsPaused:false}}]};
            if(target.includes('/Activate')){
              window.activations++;
              const body=JSON.parse(options.body);
              if(body.sessionId!=='SESSION'||body.itemId!==first)throw new Error('wrong item/session');
              window.serverState={...window.serverState,playbackMode:'playing',sessionId:'SESSION'};
              return {ok:true,status:200,json:async()=>window.serverState};
            }
            if(target.includes('/TimelineState'))return {ok:true,status:200,
              json:async()=>target.endsWith('/TimelineState')?[window.serverState]:window.serverState};
            return {ok:true,status:200,json:async()=>[]};
          };
          localStorage.setItem('_deviceId2','DEVICE');
          location.hash='#/details?id='+first+'&feAutoPlay=1&feLocalTimeline=1';
        }''', {'uid':uid,'first':first,'second':second,'row':row})
        page.add_script_tag(content=bridge)
        page.wait_for_function('''uid=>window.activations===1 && !!localStorage.getItem('fe-local-follow-v1:'+uid)''',
                               arg=uid,timeout=15000)
        activated = page.evaluate('''uid=>({playClicks:window.playClicks,activations:window.activations,
          owner:JSON.parse(localStorage.getItem('fe-local-follow-v1:'+uid)),
          intent:localStorage.getItem('fe-local-timeline-v1:'+uid)})''',uid)
        assert activated['playClicks']==1,activated
        assert activated['owner']['sessionId']=='SESSION',activated
        assert activated['intent'] is None,activated

        page.evaluate('''({first,second})=>{
          window.serverState={...window.serverState,index:1,itemId:second,
            completedKeys:['ref1:'+first],
            pendingAutoAdvanceFromKey:'ref1:'+first,pendingAutoAdvanceToKey:'ref2:'+second,
            pendingAutoAdvanceUtc:new Date().toISOString()};
        }''',{'first':first,'second':second})
        page.wait_for_function('''({uid,second})=>{
          const intent=JSON.parse(localStorage.getItem('fe-local-timeline-v1:'+uid)||'null');
          const staged=JSON.parse(sessionStorage.getItem('fe-quickplay-v1')||'null');
          return intent?.expectedId===second && intent.homeOnly &&
            staged?.id===second && location.hash==='#/home';
        }''',arg={'uid':uid,'second':second},timeout=12000)
        print('PASS armed playback -> GUID-normalized session activation -> native Home auto-next handoff')
        page.close()
    finally:
        browser.close()
