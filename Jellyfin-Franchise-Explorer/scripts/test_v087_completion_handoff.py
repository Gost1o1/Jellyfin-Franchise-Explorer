#!/usr/bin/env python3
"""Offline Jellyfin Web finish-frame regression. Does NOT replace live server tests."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
plugin=root/'src/Jellyfin.Plugin.FranchiseExplorer'
script=(plugin/'Web/franchise-my-media.js').read_text()
browse=(plugin/'Configuration/browsePage.html').read_text()
config=(plugin/'Configuration/configPage.html').read_text()
service=(plugin/'Web/TimelinePlaybackMonitorService.cs').read_text()
assert 'id="preview-notice"' not in browse
assert '<div class="fx-warning" role="alert">' not in config
assert "sessionStorage.setItem('fe-quickplay-v1'" in script
assert 'location.assign(homeUrl)' in script
assert 'CompletedAtEndDespiteUnflaggedStop' in service
assert 'args.PlayedToCompletion || nearEnd' in service

uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
item='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
row='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for case in ('natural_end_frames','pause_near_end','seek_to_end','different_media'):
            page=browser.new_page()
            page.goto('about:blank')
            page.set_content('<main><video id="movie"></video></main>')
            page.evaluate('''({uid,item,row,caseName})=>{
              const mem=new Map();
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>mem.get(k)??null,
                setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)}});
              localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{
                AccessToken:'TEST',UserId:uid,ManualAddress:'about:blank'}]}));
              localStorage.setItem('fe-local-follow-v1:'+uid,JSON.stringify({rowId:row,
                lastItemId:item,sessionId:'SESSION1',created:Date.now()}));
              const video=document.getElementById('movie');
              window.frame={position:96,playing:true,seeking:false};
              Object.defineProperty(video,'duration',{get:()=>100});
              Object.defineProperty(video,'currentTime',{get:()=>window.frame.position});
              Object.defineProperty(video,'paused',{get:()=>!window.frame.playing});
              Object.defineProperty(video,'seeking',{get:()=>window.frame.seeking});
              window.posts=0;
              window.fetch=async(url,opts={})=>{
                if(String(url).includes('/Sessions?'))return {ok:true,status:200,json:async()=>[{
                  Id:'SESSION1',NowPlayingItem:{Id:caseName==='different_media'?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':item}}]};
                if(String(url).includes('/Complete')){window.posts++;return {ok:true,status:200,json:async()=>({pendingAutoAdvanceUtc:null})};}
                return {ok:true,status:200,json:async()=>[]};
              };
            }''',{'uid':uid,'item':item,'row':row,'caseName':case})
            page.add_script_tag(content=script)
            if case=='pause_near_end':
                page.evaluate('window.frame.playing=false;window.frame.position=99.8;document.getElementById("movie").dispatchEvent(new Event("timeupdate"))')
            elif case=='seek_to_end':
                page.evaluate('''()=>{const v=document.getElementById('movie');window.frame.seeking=true;v.dispatchEvent(new Event('seeking'));window.frame.seeking=false;window.frame.position=99.9;v.dispatchEvent(new Event('timeupdate'));}''')
            else:
                for position in (96,96.8,97.6,98.4,99.0,99.8):
                    page.evaluate('''value=>{window.frame.position=value;
                      document.getElementById('movie').dispatchEvent(new Event('timeupdate'));}''',position)
            page.wait_for_timeout(350)
            posts=page.evaluate('window.posts')
            assert posts==(1 if case=='natural_end_frames' else 0),(case,posts)
            print('PASS',case,posts)
            page.close()
    finally:
        browser.close()
