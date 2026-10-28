#!/usr/bin/env python3
"""Simulated Web-client completion marker -> next item's native details route.
Not a live Jellyfin client or server playback test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
js=(base/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
first='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
second='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
row='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for case in ('completed_then_stopped','stopped_without_completion','unrelated_video_playing','wrong_session'):
            page=browser.new_page()
            page.goto('http://127.0.0.1:8399/web/index.html') if False else page.goto('about:blank')
            page.set_content('<main><h2>Test navigation</h2></main>')
            page.evaluate('''({uid,first,second,row,scenario})=>{
              const memory=new Map();
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});
              localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{AccessToken:'TEST',UserId:uid,ManualAddress:'about:blank'}]}));
              localStorage.setItem('fe-local-follow-v1:'+uid.toLowerCase(),JSON.stringify({rowId:row,sessionId:'S1',lastItemId:first,subtitleEnabled:false,created:Date.now()}));
              const from='r1:'+first,to='r2:'+second;
              const completed=scenario!=='stopped_without_completion';
              const state={rowId:row,name:'Demo',playbackMode:'playing',index:completed?1:0,sessionId:scenario==='wrong_session'?'S2':'S1',
                queueKeys:[from,to],pendingAutoAdvanceUtc:completed?new Date().toISOString():null,
                pendingAutoAdvanceFromKey:completed?from:'',pendingAutoAdvanceToKey:completed?to:''};
              window.requests=[];
              window.fetch=async url=>{
                window.requests.push(String(url));
                if(String(url).includes('/TimelineState'))return {ok:true,status:200,json:async()=>[state]};
                if(String(url).includes('/Sessions?'))return {ok:true,status:200,json:async()=>[{
                  Id:'S1',UserId:uid,NowPlayingItem:scenario==='unrelated_video_playing'?{Id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}:null
                }]};
                return {ok:true,status:200,json:async()=>[]};
              };
            }''',{'uid':uid,'first':first,'second':second,'row':row,'scenario':case})
            page.add_script_tag(content=js)
            page.wait_for_timeout(4700)
            result=page.evaluate('''({uid,second})=>({hash:location.hash,intent:JSON.parse(localStorage.getItem('fe-local-timeline-v1:'+uid.toLowerCase())||'null')})''',{'uid':uid,'second':second})
            if case=='completed_then_stopped':
                assert 'feAutoPlay=1' in result['hash'],result
                assert result['intent']['expectedId']==second,result
            else:
                assert result['intent'] is None,result
                assert 'feAutoPlay' not in result['hash'],result
            print('PASS',case)
            page.close()
    finally:
        browser.close()
