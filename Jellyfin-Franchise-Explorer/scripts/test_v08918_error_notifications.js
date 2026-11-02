#!/usr/bin/env node
/* Ensure visible errors expire, while diagnostic details remain logged. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer');
const home=fs.readFileSync(path.join(root,'Web/franchise-my-media.js'),'utf8');
const timeline=fs.readFileSync(path.join(root,'Web/franchise-timeline.js'),'utf8');
const config=fs.readFileSync(path.join(root,'Configuration/configPage.html'),'utf8');
const browse=fs.readFileSync(path.join(root,'Configuration/browsePage.html'),'utf8');
const server=fs.readFileSync(path.join(root,'Api/FranchiseBrowseController.cs'),'utf8');

const from=home.indexOf('  function showLocalNotice(message,ttl=6500){');
const to=home.indexOf('  function localVideoAdvancing(',from);
assert(from>=0&&to>from,'Playback notification handler missing');
const handler=home.slice(from,to);
const timers=new Map();
const logged=[];
let nextTimer=0,notice=null,removed=false,nativeAndroid=false;
const sandbox={
  androidIntegratedPlayer:()=>nativeAndroid,
  document:{
    getElementById:()=>removed?null:notice,
    createElement:()=>({style:{},setAttribute(){},remove(){removed=true;}}),
    body:{appendChild(el){notice=el;removed=false;}}
  },
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn:()=>{timers.delete(id);fn();},ms});return id;},
  clearTimeout:id=>timers.delete(id),
  window:{FranchiseExplorerReportError:(source,message)=>logged.push({source,message})},
  console:{error:(...args)=>logged.push({source:'console',message:args.join(' ')})}
};
vm.createContext(sandbox);
vm.runInContext('let localNoticeTimer=null,lastAndroidNotice="",lastAndroidNoticeAt=0;\n'+handler+'\nshowLocalNotice("Could not verify video playback on THIS device.");',sandbox);
assert.equal(logged.length,1,'Visible playback error must be logged');
assert.equal(logged[0].source,'playback');
assert.equal(timers.size,1);
assert.equal([...timers.values()][0].ms,6500,'Default error expires in 6.5 seconds');
vm.runInContext('showLocalNotice("Could not start video",30000);',sandbox);
assert.equal(timers.size,1,'Replacing a warning cancels its former timer');
assert.equal([...timers.values()][0].ms,8000,'Long warning durations capped at 8 seconds');
[...timers.values()][0].fn();
assert.equal(removed,true,'Notice must disappear');
vm.runInContext('showLocalNotice("Chronological timeline tracking is active",4500);',sandbox);
assert.equal(logged.length,2,'Success notices should not be logged as errors');

// Android's 2-second Home poll must not perpetually reset the dismissal
// timer for a recurring error, though every failure remains in the log.
nativeAndroid=true;
vm.runInContext('showLocalNotice("Android native handoff failed",6500);',sandbox);
const androidTimerId=[...timers.keys()][0];
const beforeRepeat=logged.length;
vm.runInContext('showLocalNotice("Android native handoff failed",6500);',sandbox);
assert.equal(logged.length,beforeRepeat+1,'Repeated Android errors must still be logged');
assert.deepEqual([...timers.keys()],[androidTimerId],
  'Repeated Android errors must not extend the visible notification');
timers.get(androidTimerId).fn();
assert.equal(removed,true,'Repeated Android notifications must still disappear');

assert(home.includes("window.FranchiseExplorerReportError('home',message)"));
assert(home.includes("fetch(base+'/FranchiseExplorer/ClientLog'"));
assert(config.includes('function statusElement(el,message,error,color,source)'));
assert(config.includes("if(el.textContent===message){el.textContent='';el.style.color='';}"));
assert(config.includes("recordClientError('tv-range',message)"));
assert(config.includes('errorTimers.set(el,setTimeout('));
assert(browse.includes('const status = (message,error=false) =>'));
assert(browse.includes('logBrowseError(message);'));
assert(timeline.includes("window.FranchiseExplorerReportError?.('timeline',message)"));
assert(timeline.includes("if(this.activeDialog===panel&&feedback.textContent===message)feedback.textContent=''"));
assert(server.includes('[HttpPost("ClientLog")]'));
assert(server.includes('[Authorize]'));
assert(server.includes('_logger.LogWarning("Franchise Explorer client notification'));
assert(server.includes('[REDACTED]'));
console.log('PASS v0.8.9.19 timed playback notices, Home, browse, settings, timeline and Jellyfin logging contracts');
