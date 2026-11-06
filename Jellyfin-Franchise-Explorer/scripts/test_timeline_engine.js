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
let state=null,posted=[],enrollments=[],nowPlayingId=null,remoteSupported=true,simulateStart=true;
const jsonify=x=>({ok:true,status:200,json:async()=>x});
const mockFetch=async (url,options={})=>{
 const path=String(url);
 if(path.includes('/Shows/'+seriesId+'/Episodes'))return jsonify({Items:episodes,TotalRecordCount:episodes.length});
 if(path.includes('/Sessions?'))return jsonify([
   {Id:sessionId,UserId:uuid(9),DeviceId:'remote-web',DeviceName:'Test Web',SupportsMediaControl:remoteSupported,SupportsRemoteControl:remoteSupported,NowPlayingItem:nowPlayingId?{Id:nowPlayingId}:null},
   {Id:'additional-user-only',UserId:uuid(88),DeviceId:'another-users-device',AdditionalUsers:[{UserId:uuid(9)}]}
 ]);
 if(path.includes('/FranchiseExplorer/PlaybackPreferences')){
    assert.equal(options.method,'POST');
    const request=JSON.parse(options.body);enrollments.push(request);
    assert.equal(request.deviceId,'remote-web');assert.equal(request.enabled,false);
    return jsonify({enabled:false,language:'',subtitleStreamIndex:-1,mediaSourceId:'first-source'});
 }
 if(path.includes('/Sessions/'+sessionId+'/Playing')){assert(enrollments.length,'Subtitle policy must be confirmed before playback');posted.push(path);if(simulateStart && path.includes('playCommand=PlayNow')){const first=new URLSearchParams(path.split('?')[1]).get('itemIds').split(',')[0];nowPlayingId=first;}return {ok:true,status:204};}
 if(path.includes('/FranchiseExplorer/TimelineState/')&&options.method==='PUT'){
    state=JSON.parse(options.body);return jsonify(state);
 }
 if(path.includes('/FranchiseExplorer/TimelineState'))return jsonify(state?[state]:[]);
 throw Error('Unexpected mock request '+path);
};
const globals={window:{},fetch:mockFetch,setInterval:()=>1,clearInterval:()=>{},setTimeout,console};
vm.runInNewContext(fs.readFileSync('src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js','utf8'),globals,{filename:'franchise-timeline.js'});
const engine=globals.window.FranchiseTimeline;
assert(engine,'Timeline helper should be exported');
assert.equal(engine.inRange(episodes[1],row.items[0]),true);
assert.equal(engine.inRange(episodes[0],row.items[0]),false);
assert.equal(engine.inRange(episodes[5],row.items[0]),false);
const mgr=new engine.TimelineManager({serverId:'test-server',token:'test',prefix:'',userId:uuid(9),catalog,getItem:async(id)=>id===seriesId?show:id===movieId?movie:null});
(async()=>{
 assert.deepEqual(Array.from(await mgr.sessions(),session=>session.Id),[sessionId],
   'Device choices must be owned by the signed-in user so subtitle enrollment can apply on that player');
 const {queue,warnings}=await mgr.resolve(row);
 assert.equal(warnings.length,0,JSON.stringify(warnings));
 assert.equal(queue.length,5,'S1E2–S2E2 is four episodes plus one movie');
 assert.equal(JSON.stringify(queue.map(x=>x.id)),JSON.stringify([episodes[1].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id,movie.Id]));
 // A row-local order can interleave direct ranged shows and shared links.
 // Resolving that order must preserve identity and existing viewing history.
 const sharedMovie={id:refMovie,nodeId:row.parentNodeId,itemId:movieId,itemType:'Movie',rangeMode:'Full',position:17,viewingOrder:'Custom'};
 const mixedRow={...row,id:uuid(10),mediaLinkIds:[refMovie],items:[{...row.items[0]}],mediaOrder:[refShow,refMovie]};
 const siblingRow={...row,id:uuid(11),mediaLinkIds:[refMovie],items:[],mediaOrder:[refMovie]};
 catalog.links.push(sharedMovie);catalog.rows.push(mixedRow,siblingRow);
 const linksBefore=JSON.stringify(catalog.links),siblingBefore=JSON.stringify(siblingRow);
 const metadataBefore=JSON.stringify({...mixedRow,mediaOrder:[]});
 const initialMixed=await mgr.resolve(mixedRow);
 assert.equal(initialMixed.warnings.length,0);
 assert.deepEqual(Array.from(initialMixed.queue,q=>q.id),[episodes[1].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id,movieId]);
 const progress=mgr.makeState(mixedRow,initialMixed.queue);
 progress.index=2;progress.itemId=initialMixed.queue[2].id;progress.positionTicks=12345;
 progress.completedKeys=initialMixed.queue.slice(0,2).map(q=>q.key);
 mgr.states.set(mixedRow.id,progress);
 const progressBefore=JSON.stringify(progress),storedBefore=JSON.stringify(state),commandsBefore=posted.length;
 mixedRow.mediaOrder=[refMovie,refShow];
 const reordered=await mgr.resolve(mixedRow);
 assert.equal(reordered.warnings.length,0);
 assert.deepEqual(Array.from(reordered.queue,q=>q.id),[movieId,episodes[1].Id,episodes[2].Id,episodes[3].Id,episodes[4].Id],'Saved row order must put the shared movie before the direct show range');
 assert.deepEqual(Array.from(reordered.queue,q=>q.key),[refMovie+':'+movieId,...episodes.slice(1,5).map(ep=>refShow+':'+ep.Id)],'Queue keys must retain their reference-based identity');
 assert.deepEqual(Array.from(reordered.queue,q=>q.key).sort(),Array.from(initialMixed.queue,q=>q.key).sort());
 const restored=mgr.makeState(mixedRow,reordered.queue);
 assert.equal(restored.index,3,'The cursor must follow its episode to the new index');
 assert.equal(restored.itemId,progress.itemId);
 assert.equal(restored.queueKeys[restored.index],initialMixed.queue[progress.index].key);
 assert.equal(restored.positionTicks,12345,'Reordering must retain the current playback position');
 assert.deepEqual(Array.from(restored.completedKeys),Array.from(progress.completedKeys),'Reordering must retain completed references');
 assert.equal(JSON.stringify(mgr.getState(mixedRow.id)),progressBefore,'Resolution must not rewrite the saved viewing state');
 assert.equal(JSON.stringify(state),storedBefore,'Reordering must not persist a reset or refresh');
 assert.equal(posted.length,commandsBefore,'Reordering must not dispatch playback');
 assert.equal(JSON.stringify({...mixedRow,mediaOrder:[]}),metadataBefore,'Membership, ranges and reference IDs must stay unchanged');
 assert.equal(JSON.stringify(catalog.links),linksBefore,'Row ordering must not alter global media positions');
 assert.equal(sharedMovie.position,17);
 assert.equal(JSON.stringify(siblingRow),siblingBefore,'A sibling sharing the movie must keep its own order');
 await mgr.start(row,queue,sessionId,0,0,'playing',true);
 assert.equal(state.index,0);
 assert.equal(state.queueKeys.length,5);
 assert.equal(state.queueLengths.length,5);
 assert.equal(state.playbackMode,'playing');
 assert(posted[0].includes('playCommand=PlayNow'));
 assert(posted[0].includes('startIndex=0'));
 assert(posted[0].includes('subtitleStreamIndex=-1')&&posted[0].includes('mediaSourceId=first-source'));
 assert.deepEqual(enrollments[0].itemIds,Array.from(queue,item=>item.id),'The whole queue must be enrolled before its first play command');
 assert.equal(nowPlayingId,queue[0].id, 'First item must actually begin playing');
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
 // Appended chunks negotiate their own first item. A media source belongs to
 // the initial title and must never be reused as another title's source.
 const longQueue=Array.from({length:26},(_,index)=>({id:uuid(500+index)}));
 const chunkStart=posted.length;
 await mgr.play(longQueue,sessionId);
 const chunks=posted.slice(chunkStart).map(path=>new URLSearchParams(path.split('?')[1]));
 assert.equal(chunks.length,2);assert.equal(chunks[0].get('playCommand'),'PlayNow');
 assert.equal(chunks[0].get('subtitleStreamIndex'),'-1');
 assert.equal(chunks[0].get('mediaSourceId'),'first-source');
 assert.equal(chunks[1].get('playCommand'),'PlayLast');
 assert.equal(chunks[1].has('subtitleStreamIndex'),false);
 assert.equal(chunks[1].has('mediaSourceId'),false);
 assert.deepEqual(enrollments.at(-1).itemIds,longQueue.map(item=>item.id));
 // Real-world failure case: a 204 HTTP response does NOT mean the web
 // client started playback. Never write a new timeline state on a no-op.
 const before=JSON.stringify(state),sentBefore=posted.length;
 remoteSupported=false;
 await assert.rejects(()=>mgr.start(row,queue,sessionId,0),/remote media control is disabled/i);
 assert.equal(posted.length,sentBefore,'Unsupported session must not receive a command');
 assert.equal(JSON.stringify(state),before,'No progress changed for unsupported session');
 remoteSupported=true;simulateStart=false;nowPlayingId=movieId;
 const verifyOriginal=mgr.verifyStarted.bind(mgr);
 mgr.verifyStarted=(sid,id)=>verifyOriginal(sid,id,{retries:2,delay:0});
 await assert.rejects(()=>mgr.start(row,queue,sessionId,0),/did not report starting/);
 assert.equal(JSON.stringify(state),before,'A 204 no-op must not mutate the timeline');
 mgr.verifyStarted=verifyOriginal;
 console.log('Mixed direct/shared row ordering preserves reference identity, viewing progress, and sibling rows.');
 console.log('Confirmed playback, unsupported-device, and HTTP 204 no-op tests passed.');
 console.log('Timeline resolution, ordering, range filtering, user progress, replay and restart checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
