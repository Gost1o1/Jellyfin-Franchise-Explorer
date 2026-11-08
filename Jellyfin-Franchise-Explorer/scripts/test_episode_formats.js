'use strict';
// Production model/engine checks against explicit IMDb order and real-library-shaped metadata.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/franchise-settings-core.js'),'utf8');
const context={URL};vm.runInNewContext(source,context);const c=context.FranchiseSettingsCore,a=c.autoAdd;
const plain=value=>JSON.parse(JSON.stringify(value));
let sequence=9000;const id=()=>(++sequence).toString(16).padStart(32,'0');
const nodeId=id(),show={Id:id(),Name:'Test show',Type:'Series'},movie={Id:id(),Name:'Between episodes',Type:'Movie',ProviderIds:{Imdb:'tt99'}};
const episodes=[1,2,3,4].map(number=>({Id:id(),Name:'Episode '+number,Type:'Episode',SeriesId:show.Id,
 ParentIndexNumber:1,IndexNumber:number,ProviderIds:{Imdb:'tt'+number}}));
const library=[show,movie,...episodes],sourceConfig={Id:id(),Url:'https://www.imdb.com/list/ls123/',Enabled:true,Priority:0,
 Categories:['Chronological Timeline','Movies','TV Shows','Other']};
const ordered=['tt1','tt2','tt99','tt4','tt3'];
const result={source:sourceConfig,index:0,orderVerified:true,entries:ordered.map((imdbId,index)=>({imdbId,
 title:imdbId==='tt99'?'Between episodes':'Episode '+imdbId.slice(2),type:imdbId==='tt99'?'Movie':'Episode',position:index+1}))};
const entries=a.preview([result],library),base=c.normalize({Nodes:[{Id:nodeId,Name:'Franchise',AutoAddSources:[sourceConfig]}],Rows:[],MediaLinks:[]});
const timeline=model=>model.Rows.find(row=>row.RowType==='Timeline');
const refs=(model,row=timeline(model))=>row.MediaOrder.map(key=>row.Items.find(item=>item.Id===key)||model.MediaLinks.find(link=>link.Id===key));
const compact=model=>refs(model).map(ref=>ref.RangeMode==='Episodes'?[ref.StartSeason,ref.StartEpisode,ref.EndSeason,ref.EndEpisode]:ref.JellyfinItemId);
const selected=diff=>new Set([...diff.additions,...diff.removals].map(change=>change.key));
const change=(model,preview=entries,results=[result])=>{
 const diff=a.changes(model,nodeId,preview,results);
 return {diff,model:a.applyChanges(model,nodeId,preview,diff,selected(diff),id).model};
};

assert.equal(base.Nodes[0].EpisodeFormat,'Bundles');assert.equal(base.ImdbLists.length,0);
assert.throws(()=>c.normalize({...base,Nodes:[{...base.Nodes[0],EpisodeFormat:'guess'}]}),/Episode bundles/);
assert.throws(()=>c.normalizeImdbLists({}),/Maximum 100/);
assert.throws(()=>c.normalizeImdbLists(Array(101).fill({})),/Maximum 100/);
const list={Id:id(),Name:' My timeline ',Url:'https://imdb.com/list/ls123',Enabled:false,FutureField:{keep:1}};
const saved=c.normalizeImdbLists([list]);
assert.deepEqual(plain(saved),[{...list,Name:'My timeline',Url:'https://www.imdb.com/list/ls123/'}]);
assert.equal(c.normalize({...base,ImdbLists:[list]}).ImdbLists[0].Enabled,false);
assert.throws(()=>c.normalizeImdbLists([list,{...list,Id:id(),Url:'https://www.imdb.com/list/ls123/'}]),/already saved/);
assert.throws(()=>c.normalizeImdbLists([{...list,Name:' '}]),/list name/);
assert.throws(()=>c.normalizeImdbLists([{...list,Url:'https://evil.test/list/ls1/'}]),/HTTPS IMDb/);
assert.throws(()=>c.normalizeImdbLists([{...list,Url:'https://www.imdb.com/list/ls1/?sort=x'}]),/HTTPS IMDb/);
assert.equal(c.normalize({...base,ImdbLists:[list]}).Nodes[0].AutoAddSources[0].Id,sourceConfig.Id,
 'Saved lists never become source-ownership IDs or alter assignments');
const presetEdit=c.normalize({...base,ImdbLists:[{...list,Url:'https://www.imdb.com/list/ls999/'}]});
assert.equal(presetEdit.Nodes[0].AutoAddSources[0].Url,sourceConfig.Url,'Editing a reusable preset never retargets an assigned source');
presetEdit.ImdbLists=[];
assert.equal(c.normalize(presetEdit).Nodes[0].AutoAddSources[0].Url,sourceConfig.Url,'Deleting a preset never deletes an assignment');

const bundled=a.apply(base,nodeId,entries,id).model;
assert.deepEqual(plain(compact(bundled)),[[1,1,1,2],movie.Id,[1,4,1,4],[1,3,1,3]],
 'Default keeps adjacent bundles while respecting movies and reverse source order');
const singleBase=c.clone(base);singleBase.Nodes[0].EpisodeFormat='Individual';
const individual=a.apply(singleBase,nodeId,entries,id).model;
assert.deepEqual(plain(compact(individual)),[[1,1,1,1],[1,2,1,2],movie.Id,[1,4,1,4],[1,3,1,3]],
 'Singles follow IMDb chronology, never an independent episode-number sort');
const tv=individual.Rows.find(row=>row.Name==='TV Shows');
assert.equal(tv.Items.length,1);assert.equal(tv.Items[0].RangeMode,'Full');assert.equal(tv.MediaLinkIds.length,0);
const other=individual.Rows.find(row=>row.Name==='Other');
assert.deepEqual(plain(refs(individual,other).filter(ref=>ref.RangeMode==='Episodes').map(ref=>[ref.StartEpisode,ref.EndEpisode])),[[1,2],[4,4],[3,3]],
 'Custom/Other keeps bundled references independently from chronological singles');
assert.equal(a.changes(individual,nodeId,entries,[result]).additions.length,0);
assert.equal(a.changes(individual,nodeId,entries,[result]).removals.length,0);
assert.deepEqual(plain(a.apply(individual,nodeId,entries,id).model),plain(individual),'Reapplying preserves IDs and orders');

// A source can list the full series and its episodes. Episode-range references
// share the series ID but must never appear as a phantom whole-show addition.
const listedShow={...show,ProviderIds:{Imdb:'tt500'}},mixedRaw=[
 {imdbId:'tt500',title:show.Name,type:'Series',position:1},
 ...[episodes[0],episodes[1],movie,episodes[2]].map((item,index)=>({imdbId:item.ProviderIds.Imdb,
   title:item.Name,type:item.Type,position:index+2}))];
for (const categories of [['Chronological Timeline'],['Chronological Timeline','TV Shows']]) {
 const mixedSource={...sourceConfig,Categories:categories},mixedResult={...result,source:mixedSource,entries:mixedRaw},
   mixedEntries=a.preview([mixedResult],[listedShow,movie,...episodes]),
   mixedBase=c.normalize({...singleBase,Nodes:[{...singleBase.Nodes[0],AutoAddSources:[mixedSource]}]}),
   mixedDiff=a.changes(mixedBase,nodeId,mixedEntries,[mixedResult]);
 assert.equal(mixedDiff.additions.filter(add=>add.kind==='title').length,4);
 assert(!mixedDiff.additions.some(add=>add.kind==='title'&&add.entry.item.Type==='Series'),
   'Episode ranges are not full-show additions merely because they share a series ID');
 const applied=a.applyChanges(mixedBase,nodeId,mixedEntries,mixedDiff,selected(mixedDiff),id);
 assert.equal(refs(applied.model).length,4);
 assert.equal(applied.added,mixedDiff.additions.length,'Every selected proposal corresponds to one actual imported title or browsing card');
 const tvCards=applied.model.Rows.find(row=>row.Name==='TV Shows').Items;
 assert.equal(tvCards.length,categories.includes('TV Shows')?1:0);
 assert(tvCards.every(card=>card.RangeMode==='Full'),'TV browsing retains one full-show card');
}

// A format conversion reviews owned references, preserving a shared bundle in Other.
const requested=c.clone(bundled),otherBefore=plain(requested.Rows.find(row=>row.Name==='Other'));
requested.Nodes[0].EpisodeFormat='Individual';
const conversion=a.changes(requested,nodeId,entries,[result]);
assert.equal(conversion.removals.length,1);assert.equal(conversion.removals[0].DetachOnly,true);
assert.equal(conversion.additions.filter(add=>add.entry?.type==='Episode').length,2);
assert(conversion.additions.filter(add=>['tt1','tt2'].includes(add.entry?.imdbId)).every(add=>add.requiresRemovals.length===1));
const unchecked=a.applyChanges(requested,nodeId,entries,conversion,new Set(conversion.additions.map(add=>add.key)),id).model;
assert.deepEqual(plain(compact(unchecked)),plain(compact(requested)),'Unselected replacement removal must not introduce overlapping singles');
const converted=a.applyChanges(requested,nodeId,entries,conversion,selected(conversion),id).model;
assert.deepEqual(plain(compact(converted)),plain(compact(individual)));
assert.deepEqual(plain(converted.Rows.find(row=>row.Name==='Other')),otherBefore,'Other row retains its shared bundle identity/order');
assert.equal(a.changes(converted,nodeId,entries,[result]).removals.length,0,'A completed conversion is idempotent');
const reverse=c.clone(converted);reverse.Nodes[0].EpisodeFormat='Bundles';
const reverseChange=change(reverse);
assert.equal(reverseChange.diff.removals.length,2);
assert.deepEqual(plain(compact(reverseChange.model)),plain(compact(bundled)));
assert.equal(change(reverseChange.model).diff.additions.length,0);

// A row-only preview retains node source ownership and safely detaches shared
// ranges without rewriting the external row, artwork, positions or record IDs.
const rowOnly=c.normalize(bundled),target=timeline(rowOnly);
target.EpisodeFormat='Individual';
const nodeJob=c.scopedJobs(rowOnly,nodeId).find(job=>job.scopeRowId===''),
  narrowed={...nodeJob,rowIds:[target.Id],mappings:nodeJob.mappings.filter(mapping=>mapping.RowId===target.Id),
    sources:nodeJob.sources.map(source=>({...source,Categories:['Chronological Timeline']})),episodeFormat:'Individual'},
  rowOnlyBefore=c.scopeModel(rowOnly,narrowed),rowOnlyResults=[{...result,source:narrowed.sources[0]}],
  rowOnlyEntries=a.preview(rowOnlyResults,library),rowOnlyDiff=a.changes(rowOnlyBefore,nodeId,rowOnlyEntries,rowOnlyResults),
  outsideRows=plain(rowOnly.Rows.filter(row=>row.Id!==target.Id)),
  outsideLinks=plain(rowOnly.MediaLinks.filter(link=>rowOnly.Rows.some(row=>row.Id!==target.Id&&row.MediaLinkIds.includes(link.Id))));
assert.equal(rowOnlyDiff.removals.length,1);assert.equal(rowOnlyDiff.removals[0].DetachOnly,true);
const rowOnlyAfter=c.mergeScope(c.clone(rowOnly),rowOnlyBefore,
 a.applyChanges(rowOnlyBefore,nodeId,rowOnlyEntries,rowOnlyDiff,selected(rowOnlyDiff),id).model,narrowed);
assert.deepEqual(plain(compact(rowOnlyAfter)),plain(compact(individual)));
assert.deepEqual(plain(rowOnlyAfter.Rows.filter(row=>row.Id!==target.Id)),outsideRows);
assert.deepEqual(plain(rowOnlyAfter.MediaLinks.filter(link=>outsideLinks.some(old=>old.Id===link.Id))),outsideLinks);
assert(!JSON.stringify(rowOnlyAfter).includes('__scope'),'Scoped bookkeeping must never enter persisted configuration');
const fullRecheck=a.changes(rowOnlyAfter,nodeId,entries,[result]);
assert.equal(fullRecheck.removals.length,0,'Shared source fingerprints remain valid after a narrow conversion');
assert.equal(fullRecheck.protectedRefs.length,0);
const rowOnlyAgain=c.scopeModel(rowOnlyAfter,narrowed);
assert.equal(a.changes(rowOnlyAgain,nodeId,rowOnlyEntries,rowOnlyResults).removals.length,0);
const absentDiff=a.changes(rowOnlyAgain,nodeId,[],[{...rowOnlyResults[0],entries:[]}]);
const emptied=c.mergeScope(c.clone(rowOnlyAfter),rowOnlyAgain,
 a.applyChanges(rowOnlyAgain,nodeId,[],absentDiff,selected(absentDiff),id).model,narrowed);
assert.equal(timeline(emptied).MediaOrder.length,0);
assert.deepEqual(plain(emptied.Rows.filter(row=>row.Id!==target.Id)),outsideRows,'Row-only source removal preserves external memberships');
assert.deepEqual(plain(emptied.MediaLinks.filter(link=>outsideLinks.some(old=>old.Id===link.Id))),outsideLinks);

// Edited Auto-Add references and ordinary manual entries never become format removals.
const edited=c.clone(bundled),oldRange=refs(edited)[0];oldRange.DisplayName='My edited title';
oldRange.Artwork={PrimaryUrl:'/manual-art'};oldRange.Position=51;
const editedBefore=plain(oldRange);edited.Nodes[0].EpisodeFormat='Individual';
const editedChange=change(edited);
assert.equal(editedChange.diff.removals.length,0);assert.equal(editedChange.diff.protectedRefs.length,1);
assert.deepEqual(plain(editedChange.model.MediaLinks.find(link=>link.Id===oldRange.Id)),editedBefore);
assert.equal(refs(editedChange.model).filter(ref=>ref.StartEpisode===1).length,1);
const manual=c.clone(singleBase),manualRow={Id:id(),ParentNodeId:nodeId,Name:'Chronological Timeline',RowType:'Timeline',
 Items:[{Id:id(),JellyfinItemId:show.Id,DisplayName:'Manual episode',ItemType:'Series',RangeMode:'Episodes',
 StartSeason:1,EndSeason:1,StartEpisode:2,EndEpisode:2}],MediaLinkIds:[],MediaOrder:[]};
manualRow.MediaOrder=[manualRow.Items[0].Id];manual.Rows=[manualRow];
const manualBefore=plain(manualRow.Items[0]),manualModel=a.apply(manual,nodeId,entries,id).model;
assert.deepEqual(plain(manualModel.Rows.find(row=>row.Id===manualRow.Id).Items[0]),manualBefore);
assert.equal(refs(manualModel).filter(ref=>ref.StartEpisode===2).length,1,'Manual episode blocks only its own chronological slot');
assert.equal(a.changes(requested,nodeId,[],[{source:sourceConfig,error:'Unavailable'}]).removals.length,0);
assert.equal(a.changes(requested,nodeId,entries.map(entry=>({...entry,orderVerified:false})),[result]).removals.length,0,
 'Unverified order cannot trigger a format conversion');

// Independent row sources keep every URL, stable IDs, category and inherited format.
const rowA=id(),rowB=id(),sourceB={...sourceConfig,Id:id(),Url:'https://www.imdb.com/list/ls456/',Priority:1};
const scoped=c.normalize({...base,Nodes:[{...base.Nodes[0],EpisodeFormat:'Individual'}],Rows:[
 {Id:rowA,ParentNodeId:nodeId,Name:'Chronological Order',Category:'Chronological Order',RowType:'Timeline',
  EpisodeFormat:'Bundles',SourceUrl:sourceConfig.Url,AutoAddSources:[sourceConfig,sourceB]},
 {Id:rowB,ParentNodeId:nodeId,Name:'Chronological Order',Category:'Chronological Order',RowType:'Timeline',
  SourceUrl:sourceConfig.Url,AutoAddSources:[sourceConfig]}]});
const jobs=c.scopedJobs(scoped,nodeId),jobA=jobs.find(job=>job.scopeRowId===rowA),jobB=jobs.find(job=>job.scopeRowId===rowB);
assert.equal(jobA.sources.length,2);assert.deepEqual(plain(jobA.sources.map(item=>item.Id)),[sourceConfig.Id,sourceB.Id]);
assert.equal(jobA.episodeFormat,'Bundles');assert.equal(jobB.episodeFormat,'Individual');
assert(jobs.filter(job=>job.scopeRowId==='').every(job=>!job.rowIds.includes(rowA)&&!job.rowIds.includes(rowB)));
assert.deepEqual(plain(c.scopedJobs(scoped,nodeId).find(job=>job.scopeRowId===rowA).sources),plain(jobA.sources));
const disabled=c.clone(scoped);disabled.Rows[0].AutoAddSources.forEach(item=>item.Enabled=false);
assert(!c.scopedJobs(disabled,nodeId).some(job=>job.scopeRowId===rowA),
 'Disabled explicit sources cannot be revived by the legacy SourceUrl mirror or a franchise source');
let full=c.clone(scoped);const siblingBefore=plain(full.Rows.find(row=>row.Id===rowB));
const scopedBefore=c.scopeModel(full,jobA),jobResults=[{...result,source:jobA.sources[0]}],jobEntries=a.preview(jobResults,library),jobDiff=a.changes(scopedBefore,nodeId,jobEntries,jobResults);
full=c.mergeScope(full,scopedBefore,a.applyChanges(scopedBefore,nodeId,jobEntries,jobDiff,selected(jobDiff),id).model,jobA);
assert.deepEqual(plain(full.Rows.find(row=>row.Id===rowB)),siblingBefore,'Independent row remains untouched');
assert.deepEqual(plain(compact({...full,Rows:[full.Rows.find(row=>row.Id===rowA)]})),plain(compact(bundled)));
assert.deepEqual(plain(c.normalize(c.normalize(full))),plain(c.normalize(full)),'Formats, aliases and imports survive save/backup normalization');

// Resolve the persisted singleton representation through the actual timeline engine.
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js'),'utf8'),{window});
const links=individual.MediaLinks.map(ref=>({id:ref.Id,itemId:ref.JellyfinItemId,rangeMode:ref.RangeMode,
 startSeason:ref.StartSeason,endSeason:ref.EndSeason,startEpisode:ref.StartEpisode,endEpisode:ref.EndEpisode}));
const manager=new window.FranchiseTimeline.TimelineManager({catalog:{links},getItem:async key=>library.find(item=>item.Id===key)});
manager.getEpisodes=async key=>episodes.filter(episode=>episode.SeriesId===key);
(async()=>{
 const row=timeline(individual),resolved=await manager.resolve({id:row.Id,rowType:'Timeline',mediaLinkIds:row.MediaLinkIds,mediaOrder:row.MediaOrder,items:[]});
 assert.deepEqual(Array.from(resolved.queue,item=>item.id),[episodes[0].Id,episodes[1].Id,movie.Id,episodes[3].Id,episodes[2].Id]);
 console.log('PASS episode formats: IMDb order, bundles/singles, TV grouping, reviewed safe conversions, manual protection, row scopes, multi-source persistence, saved lists and exact playback resolution');
})().catch(error=>{console.error(error);process.exitCode=1;});
