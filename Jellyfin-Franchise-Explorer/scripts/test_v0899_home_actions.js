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
assert(home.includes("player.openDialog(row,false,'select')"));
assert(home.includes("ensureHomeTimelineStyle()"));
assert(home.includes("enforceStartOver(id)"));
assert(home.includes("window.__franchiseTimelineHomeVersion === '0.8.9.15'"));
assert(home.includes('fe-home-chronological-modal'));
assert(home.includes("STYLE_ID = 'franchise-timeline-resume-style-v08915'"));
assert(home.includes('fe-home-timeline-dialog-style-v08915'));
assert(!home.includes("confirm('Reset all chronological progress"));

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
let navigation='',calls=[],ticks=0;
const storage=new Map([['fe-local-follow-v1:my-user',JSON.stringify({rowId,sessionId:'s1'})],
  ['fe-local-completion-v1:my-user','pending']]);
class FakeManager {
  constructor(context){this.context=context;this.states=new Map();}
  async resetHistory(row,queue){calls.push(['reset',row,queue]);state={...state,index:0,itemId:idA,
    positionTicks:0,sessionId:'',playbackMode:'paused',completedKeys:[]};return state;}
  async playHere(...args){calls.push(['play',...args]);}
  async openDialog(...args){calls.push(['dialog',...args]);}
}
const auth={AccessToken:'mock-token',UserId:'my-user',Id:'mock-server'};
const card={rowId,franchise:'Marvel Cinematic Universe',itemId:idB};
const mockCatalog={nodes:[],links:[],rows:[{Id:rowId,ParentNodeId:parent,Name:row.name,RowType:'Timeline',MediaLinkIds:[]}]};
const injected=home.slice(home.indexOf('  function confirmResetChronology('),home.indexOf('  function scheduleMount()'));
assert(injected.startsWith('  function confirmResetChronology('));
const listeners=new Map();
const fakeDom={activeElement:null,createElement:tag=>new FakeElement(tag),
  getElementById:id=>fakeDom.body.children.find(x=>x.id===id&&!x.removed)||null,
  addEventListener:(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
  removeEventListener:(type,fn)=>{listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));},
  body:null};
class FakeElement {
  constructor(tag){this.tagName=tag;this.style={};this.children=[];this.attrs={};this.events={};this.isConnected=true;
    this.classList={add:()=>{}};}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parentElement=this;}
  remove(){this.removed=true;this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
  focus(){fakeDom.activeElement=this;}
  addEventListener(type,fn){this.events[type]=fn;}
  click(){this.events.click?.({target:this});}
}
fakeDom.body=new FakeElement('body');
const sandbox={
  window:{FranchiseTimeline:{TimelineManager:FakeManager}},document:fakeDom,
  setTimeout:()=>1,clearTimeout:()=>{},console,
  URL,location:{origin:'https://jellyfin.test',href:'https://jellyfin.test/web/index.html',assign:url=>{navigation=url;}},
  localStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},
  normalize:value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k[0].toLowerCase()+k.slice(1),v])),
  GUID:/^[a-f0-9-]{36}$/i,
  serverPrefix:()=>'',serverPath:path=>path,cachedItem:async()=>null,cachedCatalog:async()=>mockCatalog,
  request:async path=>{assert.equal(path,'/FranchiseExplorer/TimelineState/'+rowId);return {...state};},
  ensureHomeTimelineStyle:()=>{calls.push(['style']);},
  tick:async()=>{ticks++;},scheduleMount:()=>{},nativeTimelineTargets:new Set(),cards:[card],credential:()=>auth
};
vm.runInNewContext(injected+'\nglobalThis.runHomeAction=homepageAction;',sandbox);

async function resetPopup(accept) {
  for(let i=0;i<6&&!fakeDom.getElementById('fe-reset-confirmation');i++)await Promise.resolve();
  const overlay=fakeDom.getElementById('fe-reset-confirmation');
  assert(overlay,'Reset should open a custom centered confirmation');
  const panel=overlay.children[0];
  assert.equal(panel.attrs.role,'dialog');
  assert.equal(panel.attrs['aria-modal'],'true');
  assert.equal(panel.children[0].textContent,'Are you sure you want to reset Marvel Cinematic Universe chronological timeline?');
  assert(overlay.style.cssText.includes('place-items:center'));
  const buttons=panel.children[1].children;
  buttons[accept?1:0].click();
}

(async()=>{
  let pending=sandbox.runHomeAction(card,'restart-history',auth);
  await resetPopup(true);await pending;
  assert.equal(calls.filter(x=>x[0]==='reset').length,1);
  assert.equal(calls.filter(x=>x[0]==='dialog').length,0);
  assert.equal(state.index,0);assert.equal(state.completedKeys.length,0);
  assert.equal(state.positionTicks,0);assert.equal(ticks,1);
  assert(sandbox.nativeTimelineTargets.has(idB.toLowerCase()),'Reset must preserve native-row exclusion for the formerly active episode');
  assert.equal(storage.has('fe-local-follow-v1:my-user'),false);
  assert.equal(storage.has('fe-local-completion-v1:my-user'),false);
  assert.equal(navigation,'','Reset should not navigate anywhere');
  state={...original};calls=[];
  pending=sandbox.runHomeAction(card,'restart-history',auth);
  await resetPopup(false);await pending;
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
  assert.equal(navigation,'','Restart-current on Home must not open the details page');

  calls=[];navigation='';
  await sandbox.runHomeAction(card,'resume',auth);
  const resumePlay=calls.find(x=>x[0]==='play');
  assert(resumePlay,'Resume Watch Order must invoke local playback, not browse navigation');
  assert.equal(resumePlay[3],1,'Resume must use the saved chronological index');
  assert.equal(resumePlay[4],321,'Resume must preserve the current item playback position');
  assert.equal(navigation,'','Home resume must not navigate to Browse or Details');

  calls=[];navigation='';
  await sandbox.runHomeAction(card,'select',auth);
  assert.equal(calls.some(x=>x[0]==='style'),true);
  const dialog=calls.find(x=>x[0]==='dialog');
  assert(dialog);assert.equal(dialog[1].id,rowId);
  assert.equal(dialog[2],false);assert.equal(dialog[3],'select');
  assert.equal(navigation,'','Opening the chronological selection list must keep Home visible');

  // Details is deliberately separate from Play and must open the selected
  // movie/episode information screen without automatic video playback.
  let clearedReturn=false;navigation='';
  sandbox.window.FranchiseExplorerPlaybackReturn={clear:()=>{clearedReturn=true;}};
  await sandbox.runHomeAction(card,'details',auth);
  assert.equal(clearedReturn,true);
  assert(navigation.startsWith('/web/#/details?id='+idB));
  assert(!navigation.includes('feAutoPlay=1'));
  navigation='';

  // A stale old-Injector menu can still contain a Browse link. The new
  // script must intercept it before browser navigation and show Home's popup.
  calls=[];navigation='';
  const legacyClick=listeners.get('click')?.[0];assert(legacyClick);
  let prevented=false,stopped=false;
  legacyClick({target:{closest:()=>({href:'https://jellyfin.test/FranchiseExplorer/Browse?timeline='+rowId+'&action=select'})},
    preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert(prevented&&stopped,'Old navigation must be stopped before leaving Home');
  assert(calls.some(x=>x[0]==='dialog'&&x[3]==='select'));
  assert.equal(navigation,'');

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
  nativeEnv.location.pathname='/web/index.html';
  await assert.rejects(manager.playHere(row,queue,1,0,false,false,true),/Direct playback is unavailable/);
  assert.equal(directUrl,'','An unsupported Home client must never be sent to Details');
  assert.equal(nativeStorage.has(manager.handoffKey()),false,'Failed native playback must not leave a local playback intent');
  // When the injected Web shortcut is available, the engine must bypass the
  // details-page route and explicitly request position 0 for restart-current.
  let directCall=null;directUrl='';
  nativeEnv.window.FranchiseExplorerNativePlayback={play:(id,options)=>{
    directCall={id,options};return true;
  }};
  let modalRemoved=false;
  manager.activeDialog={parentElement:{remove:()=>{modalRemoved=true;}}};
  await manager.playHere(row,queue,1,0,false,false,true);
  const saved=manager.getState(rowId);
  assert.equal(saved.index,1);assert.equal(saved.positionTicks,0);
  assert.equal(saved.completedKeys.length,1);
  const intent=JSON.parse(nativeStorage.get(manager.handoffKey()));
  assert.equal(intent.forceStartOver,true);
  assert.equal(intent.homeOnly,true);
  assert.equal(directCall.id,idB);
  assert.equal(directCall.options.positionTicks,0);
  assert.equal(directCall.options.startOver,true);
  assert.equal(directUrl,'','A supported native shortcut must not visit /details');
  assert.equal(modalRemoved,true,'Successful native playback handoff must close the blocking chronological dialog');
  // Standalone Browse cannot use the Web DOM directly: it must hand off to
  // /web Home via same-tab storage instead of displaying the details page.
  nativeEnv.window.FranchiseExplorerNativePlayback=null;
  nativeEnv.location.pathname='/FranchiseExplorer/Browse';
  nativeEnv.sessionStorage={setItem:(key,val)=>nativeStorage.set('session:'+key,val)};
  directUrl='';
  await manager.playHere(row,queue,1,0,false,false,true);
  assert.equal(directUrl,'/web/#/home');
  const quick=JSON.parse(nativeStorage.get('session:fe-quickplay-v1'));
  assert.equal(quick.id,idB);
  assert.equal(quick.startOver,true);
  assert.equal(quick.type,'Movie');
  console.log('v0.8.9.15 centered reset, native restart, stale-menu recovery, and in-place chronological list tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
