/* Native Jellyfin shortcut contract; never claim live-host validation. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js'),'utf8');
const browser=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html'),'utf8');
const timeline=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'),'utf8');
assert(browser.includes("sessionStorage.setItem('fe-quickplay-v1'"),'Independent movie/episode cards must use direct playback handoff');
assert(timeline.includes("sessionStorage.setItem('fe-quickplay-v1'"),'Chronological playback from standalone browser must use direct handoff');
assert(script.includes("sessionStorage.getItem('fe-quickplay-v1')"),'Home bridge must consume cross-page direct playback requests');
const start=script.indexOf('  window.FranchiseExplorerNativePlayback={');
const end=script.indexOf('  function startIfReady(){',start);
assert(start>=0&&end>start);
assert(script.includes("window.__franchiseAutoplayBridgeVersion==='0.8.9.15'"));
assert(script.includes('confirmLocalTimeline(id)'));
assert(script.includes('enforceStartOver(id)'));
assert(script.includes('button.dataset.positionticks=String(options.startOver?0:'));
assert(script.includes('wrapper.dataset.action=options.startOver||!Number(options.positionTicks)'));
assert(script.includes("wrapper.className='card itemAction fe-direct-playback-shortcut'"));
assert(script.includes('wrapper.dataset.serverid=serverId'));
assert(script.includes("wrapper.dataset.mediatype='Video'"));
assert(script.includes("wrapper.dataset.type=options.type==='Episode'?'Episode':'Movie'"));
assert(script.includes(':not([data-fe-version="0.8.9.15"])'));
const id='11111111-1111-1111-1111-111111111111';
let parent=null,clicks=0,verified=0,forced=0;
const timers=[];
function element(){return {dataset:{},style:{},isConnected:true,children:[],setAttribute(){},
  appendChild(child){this.children.push(child)},click(){clicks++},remove(){this.isConnected=false}};}
const context={
  window:{},location:{pathname:'/web/index.html',hash:'#/home',assign:()=>assert.fail('should not navigate')},
  document:{querySelector:()=>parent,createElement:()=>element(),querySelectorAll:()=>[]},
  localCredentials:()=>({UserId:'u',Id:'server-id'}),localIntent:()=>null,
  armPlaybackReturn:()=>{},
  localStorage:{setItem(){}},enforceStartOver:()=>{forced++},
  confirmLocalTimeline:async()=>{verified++},disableBrowserTextTracks:()=>{},
  setTimeout:(callback,ms)=>{timers.push({callback,ms});return 1},
  setInterval:()=>1,addEventListener:()=>{},
  sessionStorage:{getItem:()=>null},console,
  encodeURIComponent
};
vm.runInNewContext(script.slice(start,end),context);
const native=context.window.FranchiseExplorerNativePlayback;
assert.equal(native.version,'0.8.9.15');
assert.equal(native.play(id,{startOver:true,positionTicks:999999}),false,'without a shortcuts host, fallback must remain available');
parent=element();
assert.equal(native.play(id,{startOver:true,positionTicks:999999,type:'Episode'}),true);
const wrapper=parent.children[0],button=wrapper.children[0];
assert.equal(wrapper.dataset.id,id);
assert(wrapper.className.includes('itemAction'));
assert.equal(wrapper.dataset.action,'play');
assert.equal(wrapper.dataset.serverid,'server-id');
assert.equal(wrapper.dataset.type,'Episode');
assert.equal(wrapper.dataset.mediatype,'Video');
assert.equal(wrapper.dataset.positionticks,'0');
assert.equal(button.dataset.action,'play');
assert.equal(button.dataset.positionticks,'0');
assert.equal(clicks,0,'insertion must finish before dispatch');
assert.equal(forced,1);
timers.filter(t=>t.ms===0).at(-1).callback();
assert.equal(clicks,1,'Jellyfin shortcut click must be dispatched');
assert.equal(verified,1,'playback verification is still required');
console.log('v0.8.9.15 native home playback contract passed (offline DOM simulation; live Jellyfin still required).');
