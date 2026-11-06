/* Android-only native chronological queue regression.
 * Jellyfin Android 2.7.x advances an ExoPlayer queue if the user's
 * EnableNextEpisodeAutoPlay preference is enabled. Simulated bridge only.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,
  '../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'),'utf8');
function section(begin,end){
  const from=source.indexOf(begin),to=source.indexOf(end,from+begin.length);
  assert(from>=0&&to>from,'Missing Android source section: '+begin);
  return source.slice(from,to);
}
const device=section('  function androidIntegratedPlayer(){','  const playbackReturnKey=');
const bridge=section('  async function prepareNativeSubtitles(id,options={},itemIds){',
  '  // Jellyfin Web\'s own delegated shortcuts');
const movie='11111111-1111-1111-1111-111111111111';
const episode='22222222-2222-2222-2222-222222222222';
const third='33333333-3333-3333-3333-333333333333';
const queueKeys=['Movie:'+movie,'Episode:'+episode,'Movie:'+third];
let intent={version:1,key:'pending',rowId:'row',expectedId:movie,
  replayOnly:false,state:{queueKeys,index:0}};
const calls=[],enrollments=[],notices=[],store={};
let failEnrollment=false;
const win={NativePlayer:{isEnabled:()=>true},
  NativeInterface:{getDeviceInformation:()=>JSON.stringify({deviceId:'android-device'})},
  FranchiseSubtitlePreferences:{prepare:async(context,fallback)=>{
    enrollments.push({context,fallback});
    if(failEnrollment)throw new Error('Enrollment rejected');
    return fallback.subtitleEnabled
      ?{subtitleEnabled:true,subtitleLanguage:'de',subtitleStreamIndex:11,mediaSourceId:'alternate-source'}
      :{subtitleEnabled:false,subtitleLanguage:'',subtitleStreamIndex:-1,mediaSourceId:'source-a'};
  }},
  ExoPlayer:{play:options=>{calls.push(options);return Promise.resolve();}}};
const context={window:win,console,Date,JSON,Number,Math,Promise,encodeURIComponent,
  location:{href:'http://localhost/web/#/home',pathname:'/jellyfin/web/index.html'},
  itemMatch:(a,b)=>String(a||'').replace(/-/g,'').toLowerCase()===
    String(b||'').replace(/-/g,'').toLowerCase(),
  localCredentials:()=>({UserId:'user',Id:'server',AccessToken:'test-token'}),localIntent:()=>intent,
  localStorage:{getItem:key=>store[key]||null,
    setItem:(key,value)=>{store[key]=value;},
    removeItem:key=>{delete store[key];}},
  armPlaybackReturn:()=>{},applySubtitlePreferences:()=>{},showLocalNotice:message=>notices.push(message)};
vm.createContext(context);
vm.runInContext(device+bridge,context);
const play=vm.runInContext('playAndroidIntegrated',context);
(async()=>{
assert.equal(play(movie,{positionTicks:50000000}),true);
assert.equal(calls.length,0,'Subtitle enrollment must finish before native launch');
await new Promise(setImmediate);
assert.equal(enrollments[0].context.deviceId,'android-device');
assert.equal(enrollments[0].context.serverId,'server');
assert.equal(enrollments[0].context.userId,'user');
assert.equal(enrollments[0].context.token,'test-token');
assert.equal(enrollments[0].context.prefix,'/jellyfin');
assert.deepEqual(Array.from(enrollments[0].context.itemIds),[movie,episode,third],
  'Enrollment must cover the exact queue Android can advance through while WebView is paused');
assert.deepEqual(Array.from(calls[0].items,x=>x.Id),[movie,episode,third],
  'A tracked Android launch must give ExoPlayer the remaining native queue');
assert.equal(calls[0].startPositionTicks,50000000);
assert.equal(calls[0].startIndex,0);
assert.equal(calls[0].subtitleStreamIndex,-1,'Off must reach the top-level native playback option');
assert.equal(calls[0].mediaSourceId,'source-a');

intent={...intent,expectedId:episode,subtitleEnabled:true,subtitleLanguage:'de',state:{queueKeys,index:1}};
assert.equal(play(episode,{startOver:true,positionTicks:60000000}),true);
await new Promise(setImmediate);
assert.deepEqual(Array.from(calls[1].items,x=>x.Id),[episode,third],
  'Resuming an Android chronology must not replay earlier entries');
assert.equal(calls[1].startPositionTicks,0);
assert.equal(calls[1].subtitleStreamIndex,11,'On must use the server-selected real stream index');
assert.equal(calls[1].mediaSourceId,'alternate-source','Native negotiation must use the matching media version');

intent={...intent,replayOnly:true};
assert.equal(play(episode,{}),true);
await new Promise(setImmediate);
assert.deepEqual(Array.from(calls[2].items,x=>x.Id),[episode],
  'One-off Watch must never auto-queue the remaining timeline');

intent={...intent,replayOnly:false,state:{queueKeys,index:0}};
assert.equal(play(episode,{}),true);
await new Promise(setImmediate);
assert.deepEqual(Array.from(calls[3].items,x=>x.Id),[episode],
  'An inconsistent saved queue must fail closed instead of starting another item');

failEnrollment=true;
assert.equal(play(episode,{}),true);
await new Promise(setImmediate);
assert.equal(calls.length,4,'Failed enrollment must prevent a native launch with unwanted subtitle defaults');
assert(notices.at(-1).includes('Enrollment rejected'),'Enrollment failure must provide a visible retry message');

win.NativePlayer.isEnabled=()=>false;
assert.equal(play(movie,{}),null,
  'Desktop and Jellyfin Web player must stay on their existing playback path');
assert.equal(calls.length,4);
console.log('PASS v0.8.9.22 Android native mixed-media queue, resume, one-off safety, desktop isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
