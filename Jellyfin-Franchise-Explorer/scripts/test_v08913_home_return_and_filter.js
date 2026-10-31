/* Playback return location, explicit Details, and all-queue native-row hiding. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer');
const home=fs.readFileSync(path.join(root,'Web/franchise-my-media.js'),'utf8');
const browse=fs.readFileSync(path.join(root,'Configuration/browsePage.html'),'utf8');
const timeline=fs.readFileSync(path.join(root,'Web/franchise-timeline.js'),'utf8');
const config=fs.readFileSync(path.join(root,'Configuration/configPage.html'),'utf8');
assert(home.includes('for(const sourceId of state.queueSourceItemIds||[])'),
  'All series within a franchise timeline should stay hidden even after reset');
assert(home.includes('for(const key of state.queueKeys||[])'),
  'All linked movie/episode IDs should be filtered, not just the current cursor');
assert(home.includes('for(const id of nativeTimelineTargets)targets.add(id)'));
assert(config.includes('Hide franchise titles from Continue Watching and Next Up'));
assert(home.includes("['Details','details']"));
assert(home.includes("if(action==='details')"));
assert(home.includes('window.FranchiseExplorerPlaybackReturn?.clear()'));
assert(browse.includes('returnUrl:location.href'));
assert(timeline.includes('returnUrl:location.href'));
assert(home.includes('armPlaybackReturn(id,options.returnUrl||location.href)'));

const sourceStart=home.indexOf("  const playbackReturnKey='fe-return-after-player-v1';");
const sourceEnd=home.indexOf('  let localNoticeTimer=null;',sourceStart);
assert(sourceStart>=0&&sourceEnd>sourceStart);
const events=new Map(),timers=[],memory=new Map();
const id='11111111-1111-1111-1111-111111111111';
const auth={UserId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
const origin='https://jellyfin.test',backTo=origin+'/FranchiseExplorer/Browse?franchise=marvel';
let redirected='';
class Video {}
const location={origin,pathname:'/web/index.html',hash:'#/home',href:origin+'/web/#/home',
  replace:url=>{redirected=url;}};
const context={window:{},document:{addEventListener:(name,fn)=>events.set('document:'+name,fn),querySelectorAll:()=>[]},
  addEventListener:(name,fn)=>events.set(name,fn),
  location,HTMLVideoElement:Video,
  sessionStorage:{getItem:key=>memory.get(key)||null,setItem:(key,val)=>memory.set(key,val),removeItem:key=>memory.delete(key)},
  localCredentials:()=>auth,itemMatch:(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase(),
  URL,URLSearchParams,Date,console,setTimeout:(fn,ms)=>{timers.push(fn);return 1;}};
vm.runInNewContext(home.slice(sourceStart,sourceEnd),context);
const back=context.window.FranchiseExplorerPlaybackReturn;
assert(back?.arm&&back?.clear);

back.arm(id,backTo);
assert.equal(JSON.parse(memory.get('fe-return-after-player-v1')).returnUrl,backTo);
location.hash='#/details?id='+id;
events.get('hashchange')();
assert.equal(timers.length,0,'The details route must not be redirected before a player has started');
events.get('document:playing')({target:new Video()});
events.get('hashchange')();
assert.equal(timers.length,1);
timers.shift()();
assert.equal(redirected,backTo,'Backing out must return to the original Franchises page');
assert.equal(memory.has('fe-return-after-player-v1'),false);

redirected='';location.hash='#/home';location.href=origin+'/web/#/home';
back.arm(id,location.href);
events.get('document:playing')({target:new Video()});
location.hash='#/details?id=22222222-2222-2222-2222-222222222222';
events.get('hashchange')();
assert.equal(timers.length,0,'Unrelated item details must not be hijacked');
back.clear();location.hash='#/details?id='+id;
events.get('hashchange')();
assert.equal(timers.length,0,'Explicit Details must clear return navigation');
console.log('v0.8.9.13 Home return-to-origin, Details and full-franchise filtering contracts passed.');
