/* Offline homepage action contracts: no Browse redirects or unintended progress changes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer');
const home = fs.readFileSync(path.join(root,'Web/franchise-my-media.js'),'utf8');
const timeline = fs.readFileSync(path.join(root,'Web/franchise-timeline.js'),'utf8');
const service = fs.readFileSync(path.join(root,'Web/HomeTileRegistrationService.cs'),'utf8');
assert(service.includes('script = timelineReader.ReadToEnd() + "\\n" + script;'), 'Home Injector must load the shared timeline module');
assert(home.includes("option=document.createElement('button')"));
assert(!home.includes("option.href=serverPath('/FranchiseExplorer/Browse?timeline='"));
assert(home.includes("await player.openDialog(row,false,'select')"));
assert(home.includes("ensureHomeTimelineStyle()"));
assert(home.includes("enforceStartOver(id)"));

const idA='11111111-1111-1111-1111-111111111111';
const idB='22222222-2222-2222-2222-222222222222';
const rowId='33333333-3333-3333-3333-333333333333';
const parent='44444444-4444-4444-4444-444444444444';
const row={id:rowId,parentNodeId:parent,name:'Chronological Order',rowType:'Timeline',mediaLinkIds:[]};
const original={rowId,parentNodeId:parent,name:row.name,index:1,total:2,
  itemId:idB,playbackMode:'playing',sessionId:'s1',positionTicks:321,
  completedKeys:['link-a:'+idA],queueKeys:['link-a:'+idA,'link-b:'+idB],
  queueLengths:[1000,2000],queueSourceItemIds:[idA,idB],queueSeasons:[0,0],queueEpisodes:[0,0]};
let state={...original,completedKeys:[...original.completedKeys]};
let navigation='',calls=[],confirmResponse=true,ticks=0;
const storage=new Map([['fe-local-follow-v1:my-user',JSON.stringify({rowId,sessionId:'s1'})],
  ['fe-local-completion-v1:my-user','pending']]);
class FakeManager {
  constructor(context){this.context=context;this.states=new Map();}
  async resetHistory(row,queue){calls.push(['reset',row,queue]);state={...state,index:0,itemId:idA,
    positionTicks:0,sessionId:'',playbackMode:'paused',completedKeys:[]};return state;}
  async playHere(...args){calls.push(['play',...args]);navigation='/web/#/details?id='+args[1][args[2]].id;}
  async openDialog(...args){calls.push(['dialog',...args]);}
}
const auth={AccessToken:'mock-token',UserId:'my-user',Id:'mock-server'};
const card={rowId,franchise:'Marvel Cinematic Universe'};
const mockCatalog={nodes:[],links:[],rows:[{Id:rowId,ParentNodeId:parent,Name:row.name,RowType:'Timeline',MediaLinkIds:[]}]};
const injected=home.slice(home.indexOf('  function playbackManager('),home.indexOf('  function scheduleMount()'));
assert(injected.startsWith('  function playbackManager('));
const fakeDom={getElementById:()=>null,createElement:()=>({setAttribute(){},style:{},remove(){}}),body:{append(){}}};
const sandbox={
  window:{FranchiseTimeline:{TimelineManager:FakeManager}},document:fakeDom,
  setTimeout:()=>1,clearTimeout:()=>{},console,
  localStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},
  normalize:value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k[0].toLowerCase()+k.slice(1),v])),
  GUID:/^[a-f0-9-]{36}$/i,
  serverPrefix:()=>'',cachedItem:async()=>null,cachedCatalog:async()=>mockCatalog,
  request:async path=>{assert.equal(path,'/FranchiseExplorer/TimelineState/'+rowId);return {...state};},
  ensureHomeTimelineStyle:()=>{calls.push(['style']);},
  confirm:()=>confirmResponse,
  homeFeedback:()=>{},
  tick:async()=>{ticks++;}
};
vm.runInNewContext(injected+'\nglobalThis.runHomeAction=homepageAction;',sandbox);

(async()=>{
  await sandbox.runHomeAction(card,'restart-history',auth);
  assert.equal(calls.filter(x=>x[0]==='reset').length,1);
  assert.equal(calls.filter(x=>x[0]==='dialog').length,0);
  assert.equal(state.index,0);assert.equal(state.completedKeys.length,0);
  assert.equal(state.positionTicks,0);assert.equal(ticks,1);
  assert.equal(storage.has('fe-local-follow-v1:my-user'),false);
  assert.equal(storage.has('fe-local-completion-v1:my-user'),false);
  assert.equal(navigation,'','Reset should not navigate anywhere');
  state={...original};calls=[];confirmResponse=false;
  await sandbox.runHomeAction(card,'restart-history',auth);
  assert.equal(calls.length,0,'Cancelled reset must preserve progress');
  assert.equal(state.index,1);

  calls=[];await sandbox.runHomeAction(card,'restart-current',auth);
  const play=calls.find(x=>x[0]==='play');
  assert(play,'Restart current must start local playback');
  assert.equal(play[3],1,'Restart must target the current timeline index');
  assert.equal(play[4],0,'Restart must begin at 0:00');
  assert.equal(play[6],false,'Restart is tracked, not independent');
  assert.equal(play[7],true,'Restart must force native player to start over');
  assert.equal(state.completedKeys.length,1,'Earlier completed entries must stay complete');
  assert(navigation.includes('/web/#/details?id='+idB));
  assert(!navigation.includes('FranchiseExplorer/Browse'));

  calls=[];navigation='';
  await sandbox.runHomeAction(card,'select',auth);
  assert.equal(calls.some(x=>x[0]==='style'),true);
  const dialog=calls.find(x=>x[0]==='dialog');
  assert(dialog);assert.equal(dialog[1].id,rowId);
  assert.equal(dialog[2],false);assert.equal(dialog[3],'select');
  assert.equal(navigation,'','Opening the chronological selection list must keep Home visible');

  // Test the REAL engine's native start-over handoff, not just our action adapter.
  const nativeStorage=new Map();let directUrl='';
  const nativeEnv={window:{},console,localStorage:{getItem:k=>nativeStorage.get(k)||null,
    setItem:(k,v)=>nativeStorage.set(k,v),removeItem:k=>nativeStorage.delete(k)},
    location:{assign:url=>{directUrl=url;}}};
  vm.runInNewContext(timeline,nativeEnv);
  const manager=new nativeEnv.window.FranchiseTimeline.TimelineManager({userId:'my-user',serverId:'server',prefix:'',token:'test'});
  manager.states.set(rowId,original);
  manager.save=async s=>{manager.states.set(s.rowId,s);return s;};
  const queue=original.queueKeys.map((key,i)=>({id:i===0?idA:idB,key,sourceItemId:i===0?idA:idB,
    runTimeTicks:original.queueLengths[i],season:0,episode:0}));
  await manager.playHere(row,queue,1,0,false,false,true);
  const saved=manager.getState(rowId);
  assert.equal(saved.index,1);assert.equal(saved.positionTicks,0);
  assert.equal(saved.completedKeys.length,1);
  const intent=JSON.parse(nativeStorage.get(manager.handoffKey()));
  assert.equal(intent.forceStartOver,true);
  assert(directUrl.includes('feStartOver=1'));
  assert(!directUrl.includes('FranchiseExplorer/Browse'));
  console.log('v0.8.9.9 home reset, native restart, and in-place chronological list tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
