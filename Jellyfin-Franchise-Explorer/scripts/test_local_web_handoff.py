#!/usr/bin/env python3
"""Offline native-web handoff regression. Uses a simulated web player.
Does not establish Jellyfin 12.2 client compatibility.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
script=(base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
engine=(base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
assert 'This browser (local playback' in engine
assert 'feLocalTimeline=1' in engine
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
movie='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
row='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for supports in (True,False):
            page=browser.new_page()
            page.goto('about:blank#/details?id='+movie+'&feAutoPlay=1&feLocalTimeline=1&feSubs=0')
            page.set_content('<div class="page"><button class="btnPlay">Play</button></div>')
            page.evaluate('''({uid,movie,row,supports})=>{
                const dict=new Map();
                Object.defineProperty(window,'localStorage',{value:{
                    getItem:k=>dict.has(k)?dict.get(k):null,
                    setItem:(k,v)=>dict.set(k,String(v)),
                    removeItem:k=>dict.delete(k)
                }});
                const auth={Servers:[{UserId:uid,AccessToken:'TESTTOKEN',ManualAddress:'http://localhost'}]};
                localStorage.setItem('jellyfin_credentials',JSON.stringify(auth));
                const state={rowId:row,name:'Demo',index:0,itemId:movie,sessionId:'',total:1,
                    playbackMode:'paused',completedKeys:[],queueKeys:['ref:'+movie],queueLengths:[10000],
                    queueSourceItemIds:[movie],queueSeasons:[0],queueEpisodes:[0],positionTicks:0};
                localStorage.setItem('fe-local-timeline-v1:'+uid,JSON.stringify({version:1,created:Date.now(),
                    rowId:row,expectedId:movie,subtitleEnabled:false,replayOnly:false,state}));
                window.saved=[];window.playClicked=false;window.tick=0;
                localStorage.setItem('_deviceId2','THIS-DEVICE');
                const pretendVideo={paused:false,ended:false,readyState:4,currentTime:0,getClientRects:()=>[{}]};
                const originalQuery=document.querySelectorAll.bind(document);
                document.querySelectorAll=(selector)=>selector==='video' && window.playClicked ? [pretendVideo] : originalQuery(selector);
                setInterval(()=>{if(window.playClicked)pretendVideo.currentTime+=1;},200);
                document.querySelector('.btnPlay').addEventListener('click',()=>window.playClicked=!!supports);
                window.fetch=async(path,options={})=>{
                    if(String(path).includes('/Sessions'))return {ok:true,status:200,json:async()=>[{
                      Id:'SESSION1',UserId:uid,DeviceId:'THIS-DEVICE',Client:'Jellyfin Web',DeviceName:'Chrome',
                      PlayState:{PositionTicks:window.playClicked?(window.tick+=20000000):0,IsPaused:false},
                      NowPlayingItem:window.playClicked?{Id:movie}:null}]};
                    if(String(path).includes('/FranchiseExplorer/TimelineState/')&&options.method==='PUT'){
                      window.saved.push(JSON.parse(options.body));
                      return {ok:true,status:200,json:async()=>JSON.parse(options.body)};
                    }
                    return {ok:true,status:200,json:async()=>[]};
                };
            }''',{'uid':uid,'movie':movie,'row':row,'supports':supports})
            page.evaluate(script)
            page.wait_for_timeout(5000)
            was_clicked=page.evaluate('window.playClicked')
            saved=page.evaluate('window.saved')
            if supports:
                assert was_clicked and len(saved)==1,(supports,saved)
                assert saved[0]['playbackMode']=='playing' and saved[0]['sessionId']=='SESSION1'
            else:
                assert not was_clicked and not saved
            assert 'feAutoPlay' not in page.url
            print('Web handoff', 'verified success' if supports else 'unconfirmed playback: state unchanged')
            page.close()
    finally:browser.close()
