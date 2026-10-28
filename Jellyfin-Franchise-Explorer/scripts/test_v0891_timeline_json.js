/* Regressions for Jellyfin 12.2's PascalCase timeline API responses. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const js = fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'),'utf8');
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const film='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const episode='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const first='ref1:'+film, next='ref2:'+episode;
const sample={RowId:row,ParentNodeId:'',Name:'Chronological Order',ItemId:episode,
  SessionId:'SESSION',PlaybackMode:'playing',Index:1,Total:422,PositionTicks:0,
  CompletedKeys:[first],QueueKeys:[first,next],QueueLengths:[1000,1000],
  QueueSourceItemIds:[film,episode],QueueSeasons:[0,1],QueueEpisodes:[0,1],
  PendingAutoAdvanceFromKey:first,PendingAutoAdvanceToKey:next,
  PendingAutoAdvanceUtc:'2026-10-28T22:33:10Z',UpdatedUtc:'2026-10-28T22:33:10Z'};

async function scenario(responseCase){
  const toCase=source=>responseCase==='PascalCase'?source:
    Object.fromEntries(Object.entries(source).map(([key,value])=>
      [key[0].toLowerCase()+key.slice(1),value]));
  const response=(body)=>({ok:true,status:200,json:async()=>body});
  const sent=[];
  const sandbox={window:{},console,Date,setInterval:()=>1,
    fetch:async(url,options={})=>{
      const endpoint=String(url);
      if(!endpoint.includes('/FranchiseExplorer/TimelineState'))
        throw new Error('Unexpected Jellyfin API call: '+endpoint);
      if(options.method==='PUT'){
        sent.push(JSON.parse(options.body));
        return response(toCase(sample));
      }
      return response([toCase(sample)]);
    }};
  vm.runInNewContext(js,sandbox);
  const manager=new sandbox.window.FranchiseTimeline.TimelineManager({
    userId:user,token:'TEST',prefix:'',catalog:{nodes:[],links:[]}});
  await manager.load();
  const progress=manager.getState(row);
  assert.ok(progress,'The server row must be indexed by its canonical rowId');
  assert.equal(progress.index,1);
  assert.equal(progress.completedKeys[0],first);
  assert.equal(progress.pendingAutoAdvanceToKey,next);
  assert.ok(manager.progress(row)>0.23 && manager.progress(row)<0.24,
    '1/422 must not display as 0%');
  const updated=await manager.save({...progress});
  assert.equal(updated.rowId,row);
  assert.equal(updated.index,1);
  assert.equal(sent.length,1);
  assert.equal(sent[0].rowId,row);
  assert.equal(sent[0].completedKeys[0],first);
  assert.ok(!Object.hasOwn(sent[0],'RowId'),'Never post a mixed-case state');
}

(async()=>{
  await scenario('PascalCase');
  await scenario('camelCase');
  console.log('v0.8.9.1 timeline JSON casing and progress tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
