/* v0.8.9.15: Home resume/artwork and chronological auto-next must stay off Details/Browse. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'),'utf8');
const timeline=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'),'utf8');

assert(script.includes("const cover = document.createElement('button'); cover.type='button';"),
  'Home artwork must be a playback button, never a Browse link');
assert(script.includes("const resume = document.createElement('button'); resume.type='button';"),
  'Resume Watch Order must be a button rather than a navigation link');
assert(script.includes("cover.addEventListener('click',launchFromHome)"));
assert(script.includes("resume.addEventListener('click',launchFromHome)"));
assert(script.includes("await homepageAction(card,'resume',credential())"));
assert(!script.includes("cover.href = url"));
assert(!script.includes("resume.href = url"));
assert(script.includes("const candidates = [card.artworkPortrait, card.artwork];"),
  'Primary poster must be used for both orientations');
assert(script.includes("const usesPoster = route === card.artworkPortrait;"));
assert(script.includes("cover.classList.toggle('fe-resume-poster',usesPoster)"));
assert(script.includes('setInterval(consumeHomeQuickPlay,300)'),
  'Auto-next intent must be observed after Web startup, not just once on page load');
assert(script.includes('if(intent?.homeOnly)return;'),
  'Pending Home playback must never be repaired through Details');
assert(!timeline.includes("location.assign(prefix+'/web/#/details?id='"),
  'Timeline manager must not redirect an unsupported Home playback attempt to Details');

const previous='11111111-1111-1111-1111-111111111111';
const next='22222222-2222-2222-2222-222222222222';
const rowId='33333333-3333-3333-3333-333333333333';
const user='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const home='https://jellyfin.test/web/#/home';
const now=new Date().toISOString();
const state={rowId,index:1,queueKeys:['segment:'+previous,'segment:'+next],
  queueEpisodes:[1,2],pendingAutoAdvanceUtc:now,
  pendingAutoAdvanceFromKey:'segment:'+previous,pendingAutoAdvanceToKey:'segment:'+next,
  playbackMode:'playing',sessionId:'session-1'};
const owner={rowId,sessionId:'session-1',created:Date.now(),lastItemId:previous,subtitleEnabled:false};
const locals=new Map([['fe-local-follow-v1:'+user,JSON.stringify(owner)]]);
const quicks=new Map();
const localStorage={getItem:k=>locals.get(k)||null,setItem:(k,v)=>locals.set(k,v),removeItem:k=>locals.delete(k)};
const sessionStorage={getItem:k=>quicks.get(k)||null,setItem:(k,v)=>quicks.set(k,v),removeItem:k=>quicks.delete(k)};
const auth={UserId:user};
const navigation=[];
const location={origin:'https://jellyfin.test',protocol:'https:',pathname:'/web/index.html',hash:'#/details?id='+previous,
  href:'https://jellyfin.test/web/index.html#/details?id='+previous,
  assign:url=>navigation.push(url)};
const itemMatch=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const followStart=script.indexOf('  let localFollowBusy=false,lastFollowKey=\'\';');
const followEnd=script.indexOf('  const pollFollow=',followStart);
assert(followStart>=0&&followEnd>followStart);
const env={console,Date,location,localStorage,sessionStorage,
  document:{hidden:false},localCredentials:()=>auth,localIntent:()=>null,
  params:()=>null,itemMatch,handoffPrefix:'fe-local-timeline-v1:',
  readPlaybackReturn:()=>({returnUrl:home}),
  armPlaybackReturn:()=>{},setTimeout:()=>{},consumeHomeQuickPlay:()=>{},
  api:async endpoint=>endpoint.startsWith('/Sessions?')
    ? [{Id:'session-1',NowPlayingItem:{Id:previous}}] : [state],
  showLocalNotice:msg=>assert.fail('Auto-next should not fail: '+msg)};
vm.runInNewContext(script.slice(followStart,followEnd)+'\nglobalThis.runFollow=followLocalTimeline;',env);

const consumeStart=script.indexOf('  let nextHomeRecoveryAt=0;');
const consumeEnd=script.indexOf('  setInterval(consumeHomeQuickPlay,300);',consumeStart);
assert(consumeStart>=0&&consumeEnd>consumeStart);
const nativeCalls=[];
const consumerEnv={Date,console,sessionStorage,document:{querySelectorAll:()=>[]},
  location:{hash:'#/home',origin:'https://jellyfin.test',pathname:'/web/index.html',search:'',
    replace:url=>navigation.push(url)},
  window:{FranchiseExplorerNativePlayback:{play:(id,options)=>{nativeCalls.push({id,options});return true;}}},
  showLocalNotice:msg=>assert.fail('The Home bridge should not need Details: '+msg)};
vm.runInNewContext(script.slice(consumeStart,consumeEnd)+'\nglobalThis.consume=consumeHomeQuickPlay;',consumerEnv);

(async()=>{
  // The Web bridge exists before an episode finishes; a new intent arrives
  // later in the same session, without reloading or reinjecting JavaScript.
  consumerEnv.consume();
  assert.equal(nativeCalls.length,0);
  await env.runFollow();
  assert.equal(navigation.length,1);
  assert.equal(navigation[0],home,'End-of-episode transition must navigate only to Home');
  const localIntent=JSON.parse(locals.get('fe-local-timeline-v1:'+user));
  assert.equal(localIntent.expectedId,next);
  assert.equal(localIntent.homeOnly,true);
  assert.equal(localIntent.routePending,false);
  const staged=JSON.parse(quicks.get('fe-quickplay-v1'));
  assert.equal(staged.id,next);
  assert.equal(staged.type,'Episode');
  assert.equal(staged.autoNext,true);
  assert.equal(staged.startOver,true);
  consumerEnv.consume();
  assert.equal(nativeCalls.length,1,'The already-running Home bridge must start the next episode');
  assert.equal(nativeCalls[0].id,next);
  assert.equal(quicks.has('fe-quickplay-v1'),false,'Quickplay request is one-time');
  assert.equal(navigation.length,1,'Consuming an episode must not navigate to Details');

  // Jellyfin may briefly restore the previous title's details after the
  // player closes; recover to Home while the next request is pending.
  quicks.set('fe-quickplay-v1',JSON.stringify({...staged,created:Date.now()-1100}));
  consumerEnv.location.hash='#/details?id='+previous;
  consumerEnv.consume();
  assert(navigation.at(-1).endsWith('#/home'),'A stale Details route must be sent to Home');
  assert.equal(nativeCalls.length,1,'Do not start playback on a Details route');
  consumerEnv.location.hash='#/home';
  consumerEnv.consume();
  assert.equal(nativeCalls.length,2);
  console.log('v0.8.9.15 Home resume, poster orientation, and native chronological next-episode contracts passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
