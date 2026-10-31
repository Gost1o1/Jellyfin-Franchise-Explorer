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
assert(home.includes('if (segmentTrack) info.append(segmentStatus, segmentTrack);'),
  'Multi-episode segment progress must render only when available');
assert(home.includes("const track = makeProgress('Watch order completed', percent, 'timeline');"),
  'The existing chronological progress bar must remain at the bottom');
assert(home.includes('info.append(franchise, title, next, itemStatus, itemTrack);'),
  'The current episode/movie progress must render first');
const progressStart=home.indexOf('  function progressForCard(state, isEpisode) {');
const progressEnd=home.indexOf('  async function cardFor(',progressStart);
assert(progressStart>=0&&progressEnd>progressStart);
const progressContext={};
vm.runInNewContext(home.slice(progressStart,progressEnd)+'\nglobalThis.calculate=progressForCard;',progressContext);
const queueKeys=['movie:movie','agent-carter-s1:e1','agent-carter-s1:e2','agent-carter-s1:e3',
  'agent-carter-s2:e1','agent-carter-s2:e2','solo:episode'];
const queueEpisodes=[0,1,2,3,1,2,1];
const base={queueKeys,queueEpisodes,queueLengths:[1000,1000,1000,1000,1000,1000,1000],
  completedKeys:[queueKeys[1]],index:2,positionTicks:500};
let progress=progressContext.calculate(base,true);
assert.equal(progress.itemPercent,50,'Current episode playback position must use its own duration');
assert.equal(progress.segment.total,3,'Range one must have exactly three episodes');
assert.equal(progress.segment.watched,1,'Only completed episodes count toward the segment');
assert(Math.abs(progress.segment.percent-100/3)<0.00001);
progress=progressContext.calculate({...base,index:4,positionTicks:0},true);
assert.equal(progress.segment.total,2,'Adjacent range two must not merge with range one');
assert.equal(progress.segment.watched,0);
progress=progressContext.calculate({...base,index:6},true);
assert.equal(progress.segment,null,'Single-episode references must not show a segment bar');
progress=progressContext.calculate({...base,index:0},false);
assert.equal(progress.segment,null,'Movies must not show a TV segment bar');
progress=progressContext.calculate({...base,index:1,positionTicks:0},true);
assert.equal(progress.itemPercent,100,'Completed episodes show a full item bar');
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
