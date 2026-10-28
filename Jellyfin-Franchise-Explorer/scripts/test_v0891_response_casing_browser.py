#!/usr/bin/env python3
"""Mocked Jellyfin Web: real-response PascalCase or camelCase pending follow.
This regression cannot prove playback on the user's actual Jellyfin server.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

bridge = (Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
row='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
first='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
second='dddddddd-dddd-4ddd-8ddd-dddddddddddd'

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,
        executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
        args=['--no-sandbox'])
    try:
        for style in ('PascalCase','camelCase'):
            page=browser.new_page()
            page.goto('about:blank')
            page.set_content('<main><p>Jellyfin Web test</p></main>')
            page.evaluate('''({uid,row,first,second,style})=>{
              const memory=new Map();
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,
                setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});
              localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
                AccessToken:'TEST',UserId:uid,ManualAddress:'about:blank'}]}));
              localStorage.setItem('fe-local-follow-v1:'+uid,JSON.stringify({
                rowId:row,lastItemId:first,sessionId:'SESSION',created:Date.now(),subtitleEnabled:false}));
              const state={RowId:row,Name:'Chronological Order',Index:1,Total:422,
                ItemId:second,SessionId:'SESSION',PlaybackMode:'playing',
                CompletedKeys:['ref1:'+first],QueueKeys:['ref1:'+first,'ref2:'+second],
                PendingAutoAdvanceFromKey:'ref1:'+first,PendingAutoAdvanceToKey:'ref2:'+second,
                PendingAutoAdvanceUtc:new Date().toISOString()};
              const camel=Object.fromEntries(Object.entries(state).map(([key,value])=>
                [key[0].toLowerCase()+key.slice(1),value]));
              window.serverState=style==='PascalCase'?state:camel;
              window.fetch=async(url,options={})=>{
                if(String(url).includes('/Sessions?'))return {ok:true,status:200,json:async()=>[{
                  Id:'SESSION',NowPlayingItem:{Id:first}}]};
                if(String(url).includes('/FranchiseExplorer/TimelineState'))
                  return {ok:true,status:200,json:async()=>[window.serverState]};
                return {ok:true,status:200,json:async()=>[]};
              };
            }''',{'uid':uid,'row':row,'first':first,'second':second,'style':style})
            page.add_script_tag(content=bridge)
            page.wait_for_function('''({uid,second})=>{
              const intent=JSON.parse(localStorage.getItem('fe-local-timeline-v1:'+uid)||'null');
              return intent?.expectedId===second && location.hash.includes('feAutoPlay=1');
            }''',arg={'uid':uid,'second':second},timeout=10000)
            state=page.evaluate('''uid=>({
              intent:JSON.parse(localStorage.getItem('fe-local-timeline-v1:'+uid)||'null'),
              hash:location.hash})''',uid)
            assert state['intent']['state']['completedKeys']==['ref1:'+first],state
            assert state['intent']['state']['index']==1,state
            assert 'feLocalTimeline=1' in state['hash'],state
            print('PASS',style,'completion marker -> next-episode browser handoff')
            page.close()
    finally:
        browser.close()
