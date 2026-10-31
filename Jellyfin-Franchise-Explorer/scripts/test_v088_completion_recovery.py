#!/usr/bin/env python3
"""Browser simulation: verified completion survives a transient failed POST and route teardown.
Not a replacement for live Jellyfin / JavaScript Injector integration tests.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

base = Path(__file__).resolve().parents[1]
bridge = (base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
engine = (base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
assert 'No connected session reports remote playback support' not in engine
assert 'persistVerifiedCompletion(auth,owner)' in bridge
assert 'repairPendingRoute()' in bridge
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
first='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
second='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
row='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
    try:
        for transient in (False,True):
            page=browser.new_page()
            page.goto('about:blank')
            page.set_content('<main><video id="movie"></video></main>')
            page.evaluate('''({uid,first,second,row,transient})=>{
              const memory=new Map();
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,
                setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});
              // about:blank has an opaque origin: provide the same-tab store
              // that a real /web/#/home Jellyfin page normally supplies.
              const quickMemory=new Map();
              Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>quickMemory.get(k)??null,
                setItem:(k,v)=>quickMemory.set(k,String(v)),removeItem:k=>quickMemory.delete(k)}});
              localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
                AccessToken:'TEST',UserId:uid,ManualAddress:'about:blank'}]}));
              const oldKey='ref1:'+first,nextKey='ref2:'+second;
              const state={rowId:row,name:'Chronological Order',index:0,itemId:first,
                total:2,playbackMode:'playing',sessionId:'SESSION',completedKeys:[],
                queueKeys:[oldKey,nextKey],queueLengths:[1000000000,1000000000],
                queueSourceItemIds:[first,second],queueSeasons:[0,1],queueEpisodes:[0,1],
                positionTicks:1000000000};
              localStorage.setItem('fe-local-follow-v1:'+uid,JSON.stringify({rowId:row,
                lastItemId:first,sessionId:'SESSION',created:Date.now(),subtitleEnabled:false,
                verifiedState:state}));
              const vid=document.getElementById('movie');
              Object.defineProperty(vid,'duration',{get:()=>100});
              Object.defineProperty(vid,'currentTime',{get:()=>100});
              Object.defineProperty(vid,'ended',{get:()=>true});
              window.completeCalls=0;window.advanceSaved=false;window.pending=state;
              window.fetch=async(url,options={})=>{
                const target=String(url);
                if(target.includes('/Sessions?'))return {ok:true,status:200,json:async()=>[{
                  Id:'SESSION',UserId:uid,NowPlayingItem:{Id:first}}]};
                if(target.includes('/Complete')){
                  window.completeCalls++;
                  if(transient&&window.completeCalls===1)throw new Error('network disconnected');
                  window.pending={...state,index:1,itemId:second,completedKeys:[oldKey],
                    pendingAutoAdvanceUtc:new Date().toISOString(),
                    pendingAutoAdvanceFromKey:oldKey,pendingAutoAdvanceToKey:nextKey};
                  return {ok:true,status:200,json:async()=>window.pending};
                }
                if(target.includes('/TimelineState'))return {ok:true,status:200,json:async()=>[window.pending]};
                return {ok:true,status:200,json:async()=>[]};
              };
            }''',{'uid':uid,'first':first,'second':second,'row':row,'transient':transient})
            page.add_script_tag(content=bridge)
            page.evaluate('''()=>document.getElementById('movie').dispatchEvent(new Event('ended'))''')
            page.wait_for_timeout(4900 if transient else 1500)
            result=page.evaluate('''uid=>({calls:window.completeCalls,
              intent:JSON.parse(localStorage.getItem('fe-local-timeline-v1:'+uid)||'null'),
              nextPlay:JSON.parse(sessionStorage.getItem('fe-quickplay-v1')||'null'),
              completion:localStorage.getItem('fe-local-completion-v1:'+uid),hash:location.hash})''',uid)
            assert result['calls']==(2 if transient else 1),result
            assert result['completion'] is None,result
            assert result['intent'] is not None and result['intent']['expectedId']==second,result
            assert result['intent']['homeOnly'] is True,result
            assert result['intent']['routePending'] is False,result
            assert result['nextPlay'] is not None and result['nextPlay']['id']==second,result
            assert result['nextPlay']['autoNext'] is True,result
            # An about:blank browser mock has no Jellyfin Home router, so its
            # location.hash is not authoritative. The stored, one-shot native
            # Home request is; there must never be a Details autoplay route.
            assert 'feAutoPlay' not in result['hash'] and '#/details' not in result['hash'],result
            print('PASS recovery with transient failure' if transient else 'PASS immediate completion handoff')
            page.close()
    finally:
        browser.close()
