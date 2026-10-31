/* v0.8.9.8 homepage and franchise browsing quality-of-life regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const project = path.join(__dirname, '../src/Jellyfin.Plugin.FranchiseExplorer');
const browse = fs.readFileSync(path.join(project, 'Configuration/browsePage.html'), 'utf8');
const home = fs.readFileSync(path.join(project, 'Web/franchise-my-media.js'), 'utf8');
const api = fs.readFileSync(path.join(project, 'Api/FranchiseBrowseController.cs'), 'utf8');
const timeline = fs.readFileSync(path.join(project, 'Web/franchise-timeline.js'), 'utf8');
const config = fs.readFileSync(path.join(project, 'Configuration/configPage.html'), 'utf8');

assert(!browse.includes('Groups and subgroups'));
assert(!browse.includes('Experimental chronological playback. Per-user timeline progress'));
assert(!browse.includes('id="groups-count"'));
assert(browse.includes("n.nodeType==='Franchise'?'':n.nodeType"));
assert(browse.includes("$('sort').value='custom';location.hash"));
assert(browse.includes('id="brand-home" class="brand"'));
assert(browse.includes("$('brand-home').addEventListener('click',event=>"));
assert(browse.includes("event.preventDefault();"));
assert(browse.includes("openGroup('');"));
assert(browse.includes("$('sort').value='custom';void render()"));
assert(browse.includes("$('sort').value='custom';\n"));
assert(home.includes('top:50%;bottom:auto;transform:translateY(-50%)'));
assert(home.includes('backdrop-filter:blur(2px)'));
assert(api.includes('itemType = l.ItemType'));
for(const action of ['restart-history','restart-current','select'])
  assert(home.includes("'"+action+"'"), 'Continue Your Franchises menu missing '+action);
assert(home.includes('fe-resume-menu-toggle') && home.includes('fe-resume-menu[hidden]'));
assert(browse.includes('timeline.openDialog(row,resume,action)'));
assert(browse.includes("params.delete('action')"), 'One-time restart actions must not repeat on refresh');
assert(timeline.includes('Watch only · No franchise tracking') && timeline.includes('Watch and track from here'));
assert(timeline.includes('this.playHere(row,queue,index,0,false,true)'), 'One-off local playback must bypass timeline tracking');
assert(timeline.includes('this.replay(row,queue,index,select.value,false)'), 'One-off remote playback must bypass timeline tracking');
assert(config.includes("collapse.open=rowItemsExpanded.has(r.Id)?rowItemsExpanded.get(r.Id):members.length<=8"));
assert(config.includes('collapse.append(summary,included)'));
assert(config.includes('fx-row-included-toggle>summary'));

const begin = browse.indexOf('  function mediaCounts(root){');
const end = browse.indexOf('  function defaultRows(', begin);
assert(begin >= 0 && end > begin, 'Media count function is missing');
const getCounts = new Function('catalog', browse.slice(begin, end) + '\nreturn mediaCounts;');
const cat = {
  nodes: [
    {id:'root',parentId:''},{id:'phase',parentId:'root'},
    {id:'other',parentId:''}
  ],
  links: [
    {nodeId:'phase',itemId:'show-a',itemType:'Series'},
    {nodeId:'phase',itemId:'movie-b',itemType:'Movie'},
    {nodeId:'root',itemId:'collection',itemType:'BoxSet'},
    {nodeId:'other',itemId:'unrelated',itemType:'Movie'}
  ],
  rows: [
    {parentNodeId:'root',items:[
      {itemId:'show-a',itemType:'Series'}, // Same series, another range.
      {itemId:'movie-c',itemType:'Movie'}
    ]},
    {parentNodeId:'other',items:[{itemId:'unrelated-2',itemType:'Movie'}]}
  ]
};
assert.deepEqual(getCounts(cat)('root'),{tvShows:1,movies:2});
assert.deepEqual(getCounts(cat)('phase'),{tvShows:1,movies:1});
assert.deepEqual(getCounts(cat)('other'),{tvShows:0,movies:2});
const store = new Map();
let lastNavigation = '';
const environment = {
  window:{},console,
  localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
  location:{assign:url=>{lastNavigation=url;}}
};
vm.runInNewContext(timeline,environment);
const TimelineManager=environment.window.FranchiseTimeline.TimelineManager;
const manager=new TimelineManager({userId:'user1',serverId:'server1',prefix:'',token:'test'});
const row={id:'row-1',parentNodeId:'root-1',name:'Chronological Order'};
const queue=[
  {id:'11111111-1111-1111-1111-111111111111',key:'ref-1:11111111-1111-1111-1111-111111111111',label:'Movie One',runTimeTicks:1000},
  {id:'22222222-2222-2222-2222-222222222222',key:'ref-2:22222222-2222-2222-2222-222222222222',label:'Movie Two',runTimeTicks:1000}
];
const previous={rowId:row.id,parentNodeId:row.parentNodeId,name:row.name,index:1,total:2,
  itemId:queue[1].id,positionTicks:450,sessionId:'session1',playbackMode:'playing',
  completedKeys:[queue[0].key],queueKeys:queue.map(q=>q.key),queueLengths:[1000,1000]};
manager.states.set(row.id,previous);
manager.save=async state=>{manager.states.set(state.rowId,state);return state;};
(async()=>{
  // A full history reset must clear only franchise progress, not Jellyfin's watched flags.
  const reset=await manager.resetHistory(row,queue);
  assert.equal(reset.index,0);
  assert.equal(reset.positionTicks,0);
  assert.equal(reset.playbackMode,'paused');
  assert.equal(reset.sessionId,'');
  assert.equal(reset.completedKeys.length,0);
  assert.equal(reset.itemId,queue[0].id);
  // Watching an arbitrary entry independently disarms tracking but preserves the cursor/history.
  manager.states.set(row.id,{...previous,completedKeys:[queue[0].key]});
  store.set('fe-local-follow-v1:user1',JSON.stringify({rowId:row.id,sessionId:'session1'}));
  store.set('fe-local-completion-v1:user1','stale');
  await manager.playHere(row,queue,0,0,false,true);
  assert.equal(manager.getState(row.id).index,1);
  assert.equal(manager.getState(row.id).completedKeys[0],queue[0].key);
  assert.equal(manager.getState(row.id).playbackMode,'replay');
  const intent=JSON.parse(store.get(manager.handoffKey()));
  assert.equal(intent.replayOnly,true);
  assert.equal(intent.expectedId,queue[0].id);
  assert.equal(store.has('fe-local-follow-v1:user1'),false,'One-off viewing must clear the previous local auto-next owner');
  assert.equal(store.has('fe-local-completion-v1:user1'),false,'One-off viewing must clear an old completion signal');
  assert(lastNavigation.includes('feLocalTimeline=1'));
  // Remote one-off playback also must not create an empty history for a fresh timeline.
  manager.states.delete(row.id);
  manager.play=async()=>({started:true});
  await manager.replay(row,queue,1,'remote-session',false);
  assert.equal(manager.getState(row.id),null);
  console.log('v0.8.9.8 tile, list collapse, chronological reset and untracked one-off playback contracts passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
