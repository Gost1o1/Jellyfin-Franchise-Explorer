#!/usr/bin/env python3
"""Issue #13: public native queue shortcut with mocked Jellyfin API/player.

Uses the production bridge and upstream shortcut/episode-translation contract.
This validates ordering and lifecycle, not codecs or a live Jellyfin server.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
CLIENT = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
NATIVE = (ROOT / 'scripts/fixtures/jellyfin-web-queue-contract.js').read_text()
UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
ROW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
X2, Y3, MOVIE, X3 = [f'{value:032x}' for value in (101, 102, 103, 104)]


def fixture(browser, identifiers, *, index=0, position=0, legacy_device=False, replay=False, tracked=True, hold=False, failed_seek=False, remote_only=False, hold_sessions=False):
    page = browser.new_page()
    page.route('http://jellyfin.test/**', lambda route: route.fulfill(content_type='text/html', body='''
        <div class="homeTab"><div class="itemsContainer"></div></div>
        <video style="width:320px;height:180px"></video>'''))
    page.goto('http://jellyfin.test/web/index.html#/home')
    page.evaluate('''({uid,row,ids,index,position,x2,y3,movie,x3,legacy,replay,tracked,hold,failedSeek,remoteOnly,holdSessions})=>{
      window.nativeCalls=[];window.nativeExpansions=0;window.seeks=[];window.writes=[];window.itemQueries=[];
      window.started=false;window.currentId='';window.seconds=0;window.hold=hold;window.releaseItems=null;
      window.holdSessions=holdSessions;window.releaseSessions=null;
      localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'server',UserId:uid,AccessToken:'TEST',ManualAddress:location.origin}]}));
      localStorage.setItem('_deviceId2',legacy?'OLD-DEVICE':'THIS-DEVICE');
      if(legacy)window.ApiClient={getCurrentUserId:()=>uid,serverAddress:()=>location.origin,deviceId:()=> 'THIS-DEVICE'};
      window.nativeLibrary={
        [x2]:{Id:x2,Name:'Series X episode 2',Type:'Episode',MediaType:'Video',SeriesId:'series-x',ParentIndexNumber:1,IndexNumber:2},
        [y3]:{Id:y3,Name:'Series Y episode 3',Type:'Episode',MediaType:'Video',SeriesId:'series-y',ParentIndexNumber:1,IndexNumber:3},
        [movie]:{Id:movie,Name:'Interleaved movie',Type:'Movie',MediaType:'Video'},
        [x3]:{Id:x3,Name:'Series X episode 3',Type:'Episode',MediaType:'Video',SeriesId:'series-x',ParentIndexNumber:1,IndexNumber:3}
      };
      window.seriesSuccessors=item=>item.Id===x2?[window.nativeLibrary[x3]]:[];
      window.state={rowId:row,name:'Interleaved timeline',index,itemId:ids[index],playbackMode:'armed',sessionId:'',positionTicks:position,
        queueKeys:ids.map((id,i)=>'reference-'+i+':'+id),queueEpisodes:ids.map(id=>id===movie?0:1),completedKeys:[]};
      if(tracked)localStorage.setItem('fe-local-timeline-v1:'+uid,JSON.stringify({version:1,created:Date.now(),rowId:row,expectedId:ids[index],
        replayOnly:replay,homeOnly:true,subtitleEnabled:false,state:window.state}));
      window.startNativeItem=item=>{window.currentId=item.Id;window.started=true;window.seconds=0;window.nativeFinished=false;};
      const video=document.querySelector('video');
      Object.defineProperties(video,{paused:{get:()=>!window.started},readyState:{get:()=>4},currentTime:{get:()=>window.seconds},
        ended:{get:()=>!!window.nativeFinished},duration:{get:()=>600}});
      setInterval(()=>{if(window.started)window.seconds+=0.25},100);
      const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
      window.fetch=async(path,options={})=>{
        const url=new URL(path,location.origin);
        if(url.pathname==='/FranchiseExplorer/PlaybackPreferences')return ok({enabled:false,subtitleStreamIndex:-1});
        if(url.pathname==='/Items'){
          window.itemQueries.push(url.href);
          if(window.hold)await new Promise(resolve=>window.releaseItems=resolve);
          const ids=url.searchParams.get('Ids').split(',');
          return ok({Items:ids.map(id=>window.nativeLibrary[id]).filter(Boolean)});
        }
        if(url.pathname==='/Sessions'){
          if(window.holdSessions)await new Promise(resolve=>window.releaseSessions=resolve);
          return ok([{Id:'SESSION',UserId:uid,DeviceId:remoteOnly?'REMOTE-DEVICE':'THIS-DEVICE',Client:'Jellyfin Web',
            NowPlayingItem:window.started?{Id:window.currentId}:null,PlayState:{PositionTicks:window.seconds*10000000,IsPaused:!window.started}}]);
        }
        if(url.pathname==='/Sessions/SESSION/Playing/Seek'){
          const target=Number(url.searchParams.get('SeekPositionTicks'));window.seeks.push(target);
          if(!failedSeek)window.seconds=target/10000000;
          return new Response(null,{status:204});
        }
        if(url.pathname.endsWith('/Activate')){
          window.writes.push({kind:'activate',body:JSON.parse(options.body),seconds:window.seconds});
          window.state={...window.state,playbackMode:'playing',sessionId:'SESSION'};return ok(window.state);
        }
        if(url.pathname==='/FranchiseExplorer/TimelineState')return ok([window.state]);
        if(url.pathname.endsWith('/Complete')){window.writes.push({kind:'complete'});return ok(window.state);}
        return ok([]);
      };
    }''', dict(uid=UID, row=ROW, ids=identifiers, index=index, position=position, x2=X2, y3=Y3, movie=MOVIE,
              x3=X3, legacy=legacy_device, replay=replay, tracked=tracked, hold=hold, failedSeek=failed_seek,
              remoteOnly=remote_only, holdSessions=hold_sessions))
    page.add_script_tag(content=NATIVE)
    page.add_script_tag(content=CLIENT)
    page.add_script_tag(content=SCRIPT)
    assert page.evaluate('({id,type,position})=>window.FranchiseExplorerNativePlayback.play(id,{type,positionTicks:position})',
                         dict(id=identifiers[index], type='Movie' if identifiers[index]==MOVIE else 'Episode', position=position))
    return page


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
                                     args=['--no-sandbox'])
        try:
            for ids, index, position, legacy in (([X2,Y3,MOVIE,X3],0,0,False), ([X2,Y3,MOVIE,X2],0,0,False),
                                                  ([X2,Y3,MOVIE],2,1250000000,False), ([X2,Y3],1,950000000,True),
                                                  ([X2],0,0,False), ([X2,Y3,MOVIE,X3]*65,150,0,False)):
                page = fixture(browser, ids, index=index, position=position, legacy_device=legacy)
                page.wait_for_function('window.nativeCalls.length===1')
                result = page.evaluate('({calls:window.nativeCalls,expansions:window.nativeExpansions})')
                start = max(0,index-1)
                assert [item['Id'] for item in result['calls'][0]['items']] == ids[start:index+100], result
                assert result['calls'][0]['startIndex'] == index-start, result
                assert result['expansions'] == 0, result
                assert len(result['calls'][0]['items']) <= 101, 'Bound native metadata/preparation for long timelines'
                assert page.evaluate('(id)=>window.nativeLibrary[id].SeriesId',X2) == 'series-x', 'Do not mutate native metadata'
                page.wait_for_function('window.writes.some(value=>value.kind==="activate")', timeout=10000)
                if position:
                    assert page.evaluate('window.seeks') == [position]
                    assert page.evaluate('window.writes.find(value=>value.kind==="activate").seconds') >= position/10000000
                assert page.evaluate('location.hash') == '#/home'
                print('PASS explicit chronological native queue',len(ids),'start',index,'resume',position,'legacy-device',legacy)
                if len(ids)>1 and index==0:
                    # Near-end completion is persisted before the native video
                    # actually ends. A Home fallback must not interrupt it.
                    page.evaluate('''()=>{
                      window.state={...window.state,index:1,itemId:window.nativeCalls[0].items[1].Id,
                        completedKeys:[window.state.queueKeys[0]],pendingAutoAdvanceUtc:new Date().toISOString(),
                        pendingAutoAdvanceFromKey:window.state.queueKeys[0],pendingAutoAdvanceToKey:window.state.queueKeys[1]};
                    }''')
                    page.wait_for_timeout(2300)
                    assert page.evaluate('sessionStorage.getItem("fe-quickplay-v1")') is None, 'A near-end marker must not interrupt a still-visible native video'
                    assert page.evaluate('window.nativeCalls.length') == 1
                    # Native auto-next owns the actual next item. The Home
                    # fallback must adopt it without launching another copy.
                    page.evaluate('''()=>{
                      window.state={...window.state,index:1,itemId:window.nativeCalls[0].items[1].Id,
                        completedKeys:[window.state.queueKeys[0]],pendingAutoAdvanceUtc:null};
                      window.startNativeItem(window.nativeCalls[0].items[1]);
                    }''')
                    page.wait_for_function('(uid)=>JSON.parse(localStorage.getItem("fe-local-follow-v1:"+uid)).lastItemId===window.currentId',arg=UID)
                    assert page.evaluate('window.nativeCalls.length') == 1
                    assert page.evaluate('sessionStorage.getItem("fe-quickplay-v1")') is None
                    print('PASS native chronological successor adopted without duplicate handoff')
                if len(ids)>100:
                    # At the bounded native window's real EOF, recovery still
                    # has the complete chronology and opens its next window.
                    page.evaluate('''({uid,next})=>{
                      const owner=JSON.parse(localStorage.getItem('fe-local-follow-v1:'+uid));
                      owner.lastItemId=window.state.queueKeys[next-1].split(':').pop();
                      localStorage.setItem('fe-local-follow-v1:'+uid,JSON.stringify(owner));
                      window.state={...window.state,index:next,itemId:window.state.queueKeys[next].split(':').pop(),
                        pendingAutoAdvanceUtc:new Date().toISOString(),pendingAutoAdvanceFromKey:window.state.queueKeys[next-1],
                        pendingAutoAdvanceToKey:window.state.queueKeys[next]};
                      window.started=false;window.currentId='';window.nativeFinished=true;
                    }''', dict(uid=UID,next=index+100))
                    page.wait_for_function('window.nativeCalls.length===2',timeout=10000)
                    assert page.evaluate('window.nativeCalls[1].items[window.nativeCalls[1].startIndex].Id') == ids[index+100]
                    print('PASS bounded native window EOF continues at the next chronological entry')
                if len(ids)==1:
                    page.evaluate('window.state.playbackMode="complete";window.finishNativeItem()')
                    assert page.evaluate('window.nativeFinished') is True
                    assert page.evaluate('window.currentId') == ''
                    assert page.evaluate('window.nativeCalls.length') == 1
                    print('PASS singleton chronological EOF has no same-series successor')
                page.close()

            for tracked,replay in ((False,False),(True,True)):
                page=fixture(browser,[X2,Y3],tracked=tracked,replay=replay)
                page.wait_for_function('window.nativeCalls.length===1')
                assert page.evaluate('window.nativeExpansions') == 1, 'Ordinary native play and independent replay retain Jellyfin behavior'
                assert page.evaluate('window.itemQueries.length') == 0
                page.close()
            for change in ('account','intent'):
                page=fixture(browser,[X2,Y3],hold=True)
                page.wait_for_function('window.releaseItems!==null')
                page.evaluate('''change=>{
                  if(change==='account')localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'other-server',UserId:'other-user',AccessToken:'OTHER',ManualAddress:location.origin}]}));
                  else localStorage.removeItem('fe-local-timeline-v1:'+'''+json.dumps(UID)+''');
                  window.hold=false;window.releaseItems();
                }''',change)
                page.wait_for_timeout(300)
                assert page.evaluate('window.nativeCalls.length') == 0, 'Stale async queue must not launch after '+change+' change'
                page.close()
            page=fixture(browser,[X2,Y3],index=1,position=1250000000,failed_seek=True)
            page.wait_for_function('window.seeks.length===1')
            page.wait_for_function('document.getElementById("fe-local-playback-notice")?.textContent.includes("did not confirm")',timeout=10000)
            assert page.evaluate('window.writes.filter(value=>value.kind==="activate").length') == 0, 'A 204 seek response must not confirm a zero-offset resume'
            assert page.evaluate('(uid)=>JSON.parse(localStorage.getItem("fe-local-timeline-v1:"+uid)).resumeSeekPending',UID)
            page.close()
            page=fixture(browser,[X2,Y3],index=1,position=1250000000,remote_only=True)
            page.wait_for_function('document.getElementById("fe-local-playback-notice")?.textContent.includes("Could not verify this device")',timeout=15000)
            assert page.evaluate('window.seeks.length') == 0, 'An unrelated visible local video must not authorize seeking a same-title remote device'
            assert page.evaluate('window.writes.filter(value=>value.kind==="activate").length') == 0
            page.close()
            page=fixture(browser,[X2,Y3],index=1,position=1250000000,hold_sessions=True)
            page.wait_for_function('window.releaseSessions!==null')
            page.evaluate('''()=>{
              localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'other-server',UserId:'other-user',AccessToken:'OTHER',ManualAddress:location.origin}]}));
              window.holdSessions=false;window.releaseSessions();
            }''')
            page.wait_for_timeout(300)
            assert page.evaluate('window.seeks.length') == 0, 'Changing account while session verification is in flight must cancel the seek'
            page.close()
            print('PASS chronological native playback: ordering, repeated references, singleton EOF, resume proof, native successor and stale requests')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
