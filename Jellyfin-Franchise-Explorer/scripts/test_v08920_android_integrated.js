/* Android Integrated Player handoff and desktop isolation contracts.
 * This simulates Jellyfin's bridge; a physical Android device test is still required.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'),'utf8');
function section(begin,end){
  const from=source.indexOf(begin),to=source.indexOf(end,from+begin.length);
  assert(from>=0&&to>from,`Missing source section: ${begin}`);
  return source.slice(from,to);
}
const deviceCode=section('  function androidIntegratedPlayer(){','  const playbackReturnKey=');
const nativeCode=section('  function nativeAndroidQueue(id,intent){','  // Jellyfin Web\'s own delegated shortcuts');
const bridgeCode=section('  window.FranchiseExplorerNativePlayback={','  // A click in the standalone Franchises browser');
const recoveryCode=section('  async function recoverAndroidFollow(auth,owner,localKey){','  async function followLocalTimeline(){');

const id='11111111-1111-1111-1111-111111111111';
const calls=[];
let verified=0,webElementQueried=0,sessionDevice='android-device-id';
const store={};
const win={
  NativePlayer:{isEnabled:()=>true},
  NativeInterface:{getDeviceInformation:()=>JSON.stringify({deviceId:'android-device-id'})},
  ExoPlayer:{play:options=>{calls.push(options);return Promise.resolve();}}
};
const context={
  window:win,console,Promise,JSON,Number,Math,Date,encodeURIComponent,
  itemMatch:(a,b)=>String(a||'').replace(/-/g,'').toLowerCase()===String(b||'').replace(/-/g,'').toLowerCase(),
  localStorage:{getItem:key=>store[key]||null,setItem:(key,value)=>{store[key]=value;},removeItem:key=>{delete store[key];}},
  localCredentials:()=>({UserId:'u',Id:'server-id'}),
  localIntent:()=>({key:'fe-intent',rowId:'row-1',expectedId:id,replayOnly:false,
    subtitleEnabled:true,subtitleLanguage:'de'}),
  armPlaybackReturn:()=>{},confirmLocalTimeline:()=>{verified++;return Promise.resolve();},
  applySubtitlePreferences:()=>{},showLocalNotice:()=>{},
  api:async path=>path.startsWith('/Sessions')
    ?[{Id:'native-session',UserId:'u',DeviceId:sessionDevice}]
    :[{rowId:'row-1',playbackMode:'playing',sessionId:'native-session',
      queueKeys:['Movie:'+id,'Episode:22222222-2222-2222-2222-222222222222'],index:1,
      pendingAutoAdvanceFromKey:'Movie:'+id}],
  location:{href:'http://localhost/web/#/home',pathname:'/web/index.html',hash:'#/home'},
  document:{querySelector:()=>{webElementQueried++;return null;}},
};
store._deviceId2='webview-id';
vm.createContext(context);
vm.runInContext(deviceCode+nativeCode+bridgeCode+recoveryCode,context);
assert.equal(vm.runInContext('deviceId()',context),'android-device-id',
  'Native session verification must prefer the actual Android device ID');
assert.equal(win.FranchiseExplorerNativePlayback.play(id,{type:'Episode',startOver:true,positionTicks:600000000}),true);
assert.equal(calls.length,1,'An Android next episode must launch through the native player');
assert.equal(calls[0].startPositionTicks,0,'Restart must begin from zero on Android');
assert.equal(calls[0].fullscreen,true);
assert.equal(calls[0].items[0].Id,id);
assert.equal(verified,0,'Android must not rely on WebView timers while native playback is visible');
assert(store['fe-android-native-follow-v1:u'],'Android must preserve the device-bound launch for Home recovery');
assert.equal(store['fe-intent'],undefined,'An expiring browser intent must not block Android follow-up');
assert.equal(webElementQueried,0,'Native Android playback must not use the synthetic desktop card');

win.NativePlayer.isEnabled=()=>false;
assert.equal(vm.runInContext('deviceId()',context),'webview-id',
  'Desktop and Web Player must retain the original device identity');
const desktopPlay=win.FranchiseExplorerNativePlayback.play(id,{startOver:true});
assert.equal(desktopPlay,false,'Without a Jellyfin Web cards host, original desktop fallback remains');
assert.equal(webElementQueried,1,'Desktop must continue using the existing Web card path');
assert.equal(calls.length,1,'Desktop must never invoke the Android native player');

win.NativePlayer.isEnabled=()=>true;
win.ExoPlayer=null;
webElementQueried=0;
assert.equal(win.FranchiseExplorerNativePlayback.play(id),false,
  'Android without ExoPlayer must decline safely rather than use a Web-only click');
assert.equal(webElementQueried,0);

(async()=>{
  const auth=context.localCredentials();
  const owner=await vm.runInContext('recoverAndroidFollow',context)(auth,null,'fe-local-follow-v1:u');
  assert.equal(owner.sessionId,'native-session');
  assert.equal(owner.lastItemId,id);
  assert.equal(owner.subtitleLanguage,'de');
  assert.equal(store['fe-android-native-follow-v1:u'],undefined,'Verified marker must be consumed');
  assert(store['fe-local-follow-v1:u'],'Verified Android session must be durable');

  sessionDevice='someone-elses-device';
  store['fe-android-native-follow-v1:u']=JSON.stringify({rowId:'row-1',itemId:id,
    deviceId:'android-device-id',created:Date.now()});
  const foreign=await vm.runInContext('recoverAndroidFollow',context)(auth,null,'fe-local-follow-v1:u');
  assert.equal(foreign,null,'Never adopt another device\'s matching user/title session');
  console.log('PASS v0.8.9.22 Android launch, native-session recovery, other-device refusal, and desktop isolation (simulated)');
})().catch(error=>{console.error(error);process.exitCode=1;});
