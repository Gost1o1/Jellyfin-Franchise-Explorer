/* Local source regression for the explicit, server-observed timeline arm. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'), 'utf8');
const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const second = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rowId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const row = {id:rowId, name:'Chronological Order', parentNodeId:'parent'};
const queue = [first,second].map((id,i) => ({key:'ref'+i+':'+id,id,runTimeTicks:9000,
  sourceItemId:id,season:0,episode:0}));

async function scenario(replayOnly,failSave=false) {
  const memory = new Map();
  const navigation = [];
  const writes = [];
  const sandbox = {window:{},document:{getElementById:()=>null},localStorage:{
    getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),
    removeItem:k=>memory.delete(k)}, location:{assign:url=>navigation.push(url)},
    console,URLSearchParams};
  vm.runInNewContext(script,sandbox);
  const manager = new sandbox.window.FranchiseTimeline.TimelineManager({userId:uid,prefix:'',serverId:''});
  manager.states.set(rowId,{rowId,index:1,completedKeys:[queue[0].key,queue[1].key],
    queueKeys:queue.map(q=>q.key),positionTicks:400});
  manager.save = async state => {
    writes.push(JSON.parse(JSON.stringify(state)));
    if(failSave)throw new Error('storage failed');
    return {...state,armedUtc:'2026-10-28T12:00:00Z'};
  };
  if(failSave)await assert.rejects(manager.playHere(row,queue,0,0,true,false),/storage failed/);
  else await manager.playHere(row,queue,0,0,true,replayOnly);
  if(failSave){assert.equal(navigation.length,0);assert.equal(memory.size,0);return;}
  const intent=JSON.parse(memory.get('fe-local-timeline-v1:'+uid));
  assert.equal(intent.expectedId,first);
  assert.equal(intent.replayOnly,replayOnly);
  assert.equal(navigation.length,1);
  assert.match(navigation[0],/feLocalTimeline=1/);
  if(replayOnly){
    assert.equal(writes.length,1,'Replay only must disarm an active timeline session');
    assert.equal(writes[0].playbackMode,'replay');
    assert.equal(writes[0].sessionId,'');
    assert.equal(writes[0].index,1,'Replay only cannot move the cursor');
    assert.deepEqual(writes[0].completedKeys,[queue[0].key,queue[1].key]);
  }
  else{
    assert.equal(writes.length,1);
    assert.equal(writes[0].playbackMode,'armed');
    assert.equal(writes[0].sessionId,'');
    assert.deepEqual(writes[0].completedKeys,[]);
    assert.ok(intent.state.armedUtc,'The browser intent keeps server-saved state');
  }
}

(async()=>{
  await scenario(false);
  await scenario(true);
  await scenario(false,true);
  console.log('v0.8.9 timeline arm/replay/failure safety tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
