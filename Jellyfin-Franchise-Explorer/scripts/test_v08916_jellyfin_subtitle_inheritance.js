/* Offline test: subtitle auto-default follows the current Jellyfin user, with explicit override. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'),'utf8');
const start=source.indexOf('  function subtitleCode(value){');
const end=source.indexOf('  // A local timeline intent',start);
assert(start>0&&end>start,'Subtitle preference bridge should be present');

const tracks=[
  {kind:'subtitles',language:'eng',mode:'disabled'},
  {kind:'subtitles',language:'deu',mode:'disabled'},
  {kind:'subtitles',language:'fra',mode:'disabled'}
];
const timers=[];
let fetchCount=0,override='',userLanguage='deu';
const context={
  document:{querySelectorAll:()=>[{textTracks:tracks}]},
  location:{pathname:'/web/index.html'},
  localCredentials:()=>({AccessToken:'test-token',Id:'server',UserId:'user'}),
  localStorage:{getItem:key=>key==='fe-subtitle-language:server:user'?override:''},
  disableBrowserTextTracks:()=>{},
  setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length},
  fetch:async(url,opts)=>{
    fetchCount++;
    assert.equal(url,'/Users/Me');
    assert.equal(opts.headers.Authorization,'MediaBrowser Token="test-token"');
    return {ok:true,json:async()=>({Configuration:{SubtitleLanguagePreference:userLanguage}})};
  }
};
vm.runInNewContext(source.slice(start,end),context);

(async()=>{
  context.applySubtitlePreferences({subtitleEnabled:true});
  await new Promise(setImmediate);
  assert.equal(fetchCount,1,'Default option should fetch current Jellyfin user preferences');
  timers.splice(0).forEach(t=>t.fn());
  assert.equal(tracks[1].mode,'showing','Jellyfin German preference should be automatically selected');
  assert.equal(tracks[0].mode,'disabled');

  override='fr';
  context.applySubtitlePreferences({subtitleEnabled:true});
  await new Promise(setImmediate);
  assert.equal(fetchCount,1,'Explicit override should not fetch the Jellyfin default');
  timers.splice(0).forEach(t=>t.fn());
  assert.equal(tracks[2].mode,'showing','An explicit French override should win');
  assert.equal(tracks[1].mode,'disabled');

  override='';userLanguage='eng';
  context.applySubtitlePreferences({subtitleEnabled:true});
  await new Promise(setImmediate);
  assert.equal(fetchCount,2,'A later playback should re-read the live Jellyfin preference');
  timers.splice(0).forEach(t=>t.fn());
  assert.equal(tracks[0].mode,'showing','Changes to the Jellyfin setting should be inherited');

  console.log('v0.8.9.20 Jellyfin subtitle-language auto-default and override tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
