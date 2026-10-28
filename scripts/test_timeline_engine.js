'use strict';
// Offline simulated Jellyfin API checks; no real server or files touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const rowId=uuid(1), seriesId=uuid(2), movieId=uuid(3), refShow=uuid(4), refMovie=uuid(5), sessionId='session-1';
const episodes=[
 [1,1],[1,2],[1,3],[2,1],[2,2],[2,3]
].map(([season,episode],i)=>({Id:uuid(100+i),Type:'Episode',Name:'Episode '+episode,
 ParentIndexNumber:season,IndexNumber:episode,SeriesId:seriesId,RunTimeTicks:1000000000}));
const movie={Id:movieId,Type:'Movie',Name:'Iron Man',RunTimeTicks:2000000000};
const show={Id:seriesId,Type:'Series',Name:'Test TV Show'};
const catalog={links:[],rows:[]};
const row={id:rowId,parentNodeId:uuid(8),name:'Chronological Viewing Order',rowType:'Timeline',
 mediaLinkIds:[],items:[
 {id:refShow,itemId:seriesId,rangeMode:'Episodes',startSeason:1,startEpisode:2,endSeason:2,endEpisode:2},
 {id:refMovie,itemId:movieId,rangeMode:'Full'}
 ],mediaOrder:[refShow,refMovie]};
let state=null,posted=[];
const jsonify=x=>({ok:true,status:200,json:async()=>x});
const mockFetch=async (url,options={})=>{
 const path=String(url);
 if(path.includes('/Shows/'+seriesId+'/Episodes'))return jsonify({Items:episodes,TotalRecordCount:episodes.length});
 if(path.includes('/Sessions?'))return jsonify([{Id:sessionId,UserId:uuid(9),DeviceName:'Test Web'}]);
 if(path.includes('/Sessions/'+sessionId+'/Playing')){posted.push(path);return {ok:true,status:204};}
 if(path.includes('/FranchiseExplorer/TimelineState/')&&options.method==='PUT'){
    state=JSON.parse(options.body);return jsonify(state);
 }
 if(path.includes('/FranchiseExplorer/TimelineState'))return jsonify(state?[state]:[]);
 throw Error('Unexpected mock request '+path);
};
const globals={window:{},fetch:mockFetch,setInterval:()=>1,clearInterval:()=>{},console};
vm.runInNewContext(fs.readFileSync('src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js','utf8'),globals,{filename:'franchise-timeline.js'});
const engine=globals.window.FranchiseTimeline;
assert(engine,'Timeline helper should be exported');
assert.equal(engine.inRange(episodes[1],row.items[0]),true);
assert.equal(engine.inRange(episodes[0],row.items[0]),false);
assert.equal(engine.inRange(episodes[5],row.items[0]),false);
const mgr=new engine.TimelineManager({token:'test',prefix:'',userId:uuid(9),catalog,getItem:async(id)=>id===seriesId?show:id===movieId?movie:null});
(async()=>{
 const {queue,warnings}=await mgr.resolve(row);
 assert.equal(warnings.length,0,JSON.stringify(warnings));
 assert.equal(queue.length,5,'S1E2–S2E2 is four episodes plus one movie');
 assert.equal(JSON.stringify(queue.map(x=>x.id)),JSON.stringify([episodes[1].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id,movie.Id]));
 await mgr.start(row,queue,sessionId,0,0,'playing',true);
 assert.equal(state.index,0);
 assert.equal(state.queueKeys.length,5);
 assert.equal(state.queueLengths.length,5);
 assert.equal(state.playbackMode,'playing');
 assert(posted[0].includes('playCommand=PlayNow'));
 assert(posted[0].includes('startIndex=0'));
 // Move ahead, then replay an earlier movie without touching timeline cursor.
 state.index=3;state.completedKeys=state.queueKeys.slice(0,3);state.positionTicks=12345;
 mgr.states.set(rowId,state);
 await mgr.replay(row,queue,0,sessionId,false);
 assert.equal(state.index,3,'replay-only must preserve cursor');
 assert.equal(state.completedKeys.length,3,'replay-only must preserve completed history');
 assert.equal(state.playbackMode,'replay');
 mgr.states.set(rowId,state);
 await mgr.replay(row,queue,1,sessionId,true);
 assert.equal(state.index,1,'restart timeline should move cursor');
 assert.equal(state.completedKeys.length,1,'restart timeline should clear later progress');
 assert.equal(state.playbackMode,'playing');
 assert(posted.at(-1).includes('startIndex=0') && posted.at(-1).includes('playCommand=PlayNow'),'restart must queue remaining movies/episodes, not single clip');
 // A search for an empty season or an inaccessible movie should warn, not guess.
 const bad={...row,items:[{...row.items[0],startSeason:4,endSeason:4,startEpisode:1,endEpisode:2}]};
 const result=await mgr.resolve(bad);
 assert.equal(result.queue.length,0);
 assert(result.warnings.length>0);
 console.log('Timeline resolution, ordering, range filtering, user progress, replay and restart checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
