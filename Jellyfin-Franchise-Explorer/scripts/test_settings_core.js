'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const filename = path.join(__dirname, '../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/franchise-settings-core.js');
const source = fs.readFileSync(filename, 'utf8');
const context = {URL};
vm.runInNewContext(source, context);
const core = context.FranchiseSettingsCore;
const plain = value => JSON.parse(JSON.stringify(value));
let sequence = 0;
const guid = () => (++sequence).toString(16).padStart(32, '0');
const nodeId = guid(), childId = guid(), movieId = guid(), linkId = guid(), rowId = guid(), sourceId = guid();
const raw = {
  NavigationLabel:'Franchises', ServerFuture:{setting:'preserved'},
  Nodes:[
    {Id:nodeId, ParentId:'', Name:'Marvel', NodeType:'Franchise', SortOrder:1, FutureNodeField:'preserved', AutoAddRows:[{Category:'TV Shows', RowId:rowId}]},
    {Id:childId, ParentId:nodeId, Name:'Phase One', NodeType:'Phase', SortOrder:1}
  ],
  MediaLinks:[{Id:linkId, NodeId:childId, JellyfinItemId:movieId, DisplayName:'Iron Man', ItemType:'Movie', Position:1, FutureLinkField:17}],
  Rows:[{Id:rowId, ParentNodeId:nodeId, Name:'Renamed TV shelf', RowType:'Media', SortOrder:1, NodeIds:[childId], MediaLinkIds:[linkId], Items:[], MediaOrder:[linkId], SourceUrl:'https://imdb.com/list/ls123/', FutureRowField:true}]
};
const original = JSON.stringify(raw);
const normalized = core.normalize(raw);
assert.equal(JSON.stringify(raw), original, 'Normalization must not mutate a pending configuration');
assert.equal(normalized.ServerFuture.setting, 'preserved');
assert.equal(normalized.Nodes[0].FutureNodeField, 'preserved');
assert.equal(normalized.MediaLinks[0].FutureLinkField, 17);
assert.equal(normalized.Rows[0].FutureRowField, true);
assert.equal(normalized.Rows[0].Category, 'TV Shows', 'Stable AutoAdd row mapping survives renames');
assert.equal(normalized.Rows[0].SourceUrl, 'https://www.imdb.com/list/ls123/');
assert.deepEqual(plain(normalized.Rows[0].MediaLinkIds), [linkId], 'Parent rows may retain descendant references');
assert.deepEqual(plain(normalized.Rows[0].NodeIds), [childId]);
assert(!Object.hasOwn(normalized.MediaLinks[0], 'Artwork'), 'Absent optional artwork must not change legacy reference fingerprints');
assert.deepEqual(plain(core.normalize(normalized)), plain(normalized), 'Normalized backups remain stable across roundtrips');

const explicit = {...normalized.Rows[0], Category:'Collection'};
assert.equal(core.categoryForRow(explicit, normalized), 'Collection', 'Explicit user category overrides migration hints');
assert.equal(core.categoryForRow({Id:guid(), Name:'Chronological Timeline', RowType:'Media'}, normalized), 'Chronological Order');
assert.equal(core.categoryForRow({Id:guid(), Name:'Anything', RowType:'Groups'}, normalized), 'Sub Group');
assert.deepEqual(plain(core.mediaTypesForCategory('Chronological Order')), ['Movie', 'Series']);
assert.deepEqual(plain(core.mediaTypesForCategory('Custom')), ['Movie', 'Series', 'BoxSet']);
assert.equal(core.rowTypeForCategory('Chronological Order'), 'Timeline');
assert.equal(core.rowTypeForCategory('Sub Group'), 'Groups');
assert.equal(core.categoryToAutoAdd('Collection'), 'Collections');

const bad = plain(raw);
bad.Nodes[0].ParentId = childId;
assert.throws(() => core.normalize(bad), /Circular/);
assert.throws(() => core.normalize({...raw, Nodes:[...raw.Nodes, raw.Nodes[0]]}), /Duplicate group/);
assert.throws(() => core.normalize({...raw, Rows:[{...raw.Rows[0], SourceUrl:'https://evil.test/list/ls1/'}]}), /HTTPS IMDb/);
for (const value of ['javascript:alert(1)', 'data:image/png;base64,x', '//evil.test/image', '/\\evil.test/image', 'https://user:password@host/image', '/Items/1/Images/Primary?api_key=secret']) {
  assert.throws(() => core.artRef(value), /Artwork|artwork|credentials/);
}
assert.equal(core.artRef('/Items/'+movieId+'/Images/Backdrop/1?maxWidth=1280'), '/Items/'+movieId+'/Images/Backdrop/1?maxWidth=1280');
assert.equal(core.normalizeArtwork({PrimaryUrl:'/Items/'+movieId+'/Images/Primary', FutureArtworkField:'preserved'}).FutureArtworkField, 'preserved');
assert.throws(() => core.rangeFields({ItemType:'Series', RangeMode:'Seasons', StartSeason:'', EndSeason:1}), /season/);
assert.throws(() => core.rangeFields({ItemType:'Movie', RangeMode:'Episodes', StartSeason:1, EndSeason:1, StartEpisode:1, EndEpisode:3}), /TV Show/);
assert.deepEqual(plain(core.rangeFields({ItemType:'Series', RangeMode:'Episodes', StartSeason:1, EndSeason:2, StartEpisode:9, EndEpisode:1})), {RangeMode:'Episodes', StartSeason:1, EndSeason:2, StartEpisode:9, EndEpisode:1});
assert.equal(core.linkIdentity({JellyfinItemId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}), core.linkIdentity({JellyfinItemId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}));

const importNode = guid();
const base = {Nodes:[{Id:importNode, ParentId:'', Name:'Import', AutoAddSources:[], AutoAddRows:[], AutoAddRecords:[]}], Rows:[], MediaLinks:[]};
const sourceConfig = {Id:sourceId, Url:'https://www.imdb.com/list/ls1/', Enabled:true, Priority:0, Categories:['Movies']};
const entry = {imdbId:'tt123', title:'Iron Man', year:2008, type:'Movie', position:1};
const result = {source:sourceConfig, index:0, entries:[entry], orderVerified:true};
const preview = core.autoAdd.preview([result], [{Id:movieId, Name:'Iron Man', Type:'Movie', ProductionYear:2008, ProviderIds:{Imdb:'tt123'}}]);
const imported = core.autoAdd.apply(base, importNode, preview, guid).model;
assert(imported.MediaLinks.length);
const absent = {source:sourceConfig, index:0, entries:[], orderVerified:true};
assert.equal(core.autoAdd.changes(imported, importNode, [], [absent]).removals.length, 1);
imported.MediaLinks[0].Artwork = {PrimaryUrl:'/custom'};
assert.equal(core.autoAdd.changes(imported, importNode, [], [absent]).removals.length, 0, 'Manual artwork edits remain protected by source ownership fingerprints');
assert.equal(core.autoAdd.changes(imported, importNode, [], [absent]).protectedRefs.length, 1);

// The new server-side default Artwork property must not make old, unchanged
// Auto-Add entries look manually edited merely because an assembly was upgraded.
const oldOwnership = core.autoAdd.apply(base, importNode, preview, guid).model;
oldOwnership.MediaLinks[0].Artwork = core.emptyArt();
assert.equal(core.autoAdd.changes(core.normalize(oldOwnership), importNode, [], [absent]).removals.length, 1);

// Same category, independent sources: edits/removals in one row never consume
// another row's membership or source-ownership record.
const ownerId=guid(), rowA=guid(), rowB=guid();
let scoped=core.normalize({Nodes:[{Id:ownerId,ParentId:'',Name:'Independent sources'}],Rows:[rowA,rowB].map((Id,index)=>({Id,ParentNodeId:ownerId,Name:'Movies',Category:'Movies',RowType:'Media',SourceUrl:'https://www.imdb.com/list/ls'+(index+100)+'/',Items:[],NodeIds:[],MediaLinkIds:[],MediaOrder:[]})),MediaLinks:[]});
const jobs=core.scopedJobs(scoped,ownerId);
assert.equal(jobs.length,2);
const sourceIds=jobs.map(job=>job.sources[0].Id);
for(const job of jobs){
  const results=[{source:job.sources[0],index:0,entries:[entry],orderVerified:true}];
  const entries=core.autoAdd.preview(results,[{Id:movieId,Name:'Iron Man',Type:'Movie',ProductionYear:2008,ProviderIds:{Imdb:'tt123'}}]);
  const before=core.scopeModel(scoped,job),diff=core.autoAdd.changes(before,ownerId,entries,results);
  const next=core.autoAdd.applyChanges(before,ownerId,entries,diff,new Set(diff.additions.map(a=>a.key)),guid).model;
  scoped=core.mergeScope(scoped,before,next,job);
}
assert.equal(scoped.MediaLinks.length,2);
assert.notEqual(scoped.Rows[0].MediaLinkIds[0],scoped.Rows[1].MediaLinkIds[0]);
assert.deepEqual(plain(core.scopedJobs(scoped,ownerId).map(job=>job.sources[0].Id)),plain(sourceIds),'Row source identities persist across repeated previews');
const firstJob=jobs[0], removing=[{source:firstJob.sources[0],index:0,entries:[],orderVerified:true}], isolated=core.scopeModel(scoped,firstJob);
const removalDiff=core.autoAdd.changes(isolated,ownerId,[],removing);
assert.equal(removalDiff.removals.length,1);
const remaining=core.autoAdd.applyChanges(isolated,ownerId,[],removalDiff,new Set(removalDiff.removals.map(a=>a.key)),guid).model;
const merged=core.mergeScope(core.clone(scoped),isolated,remaining,firstJob);
assert.equal(merged.Rows.find(r=>r.Id===rowA).MediaLinkIds.length,0);
assert.equal(merged.Rows.find(r=>r.Id===rowB).MediaLinkIds.length,1);
const edited=core.clone(scoped);edited.MediaLinks.find(l=>l.Id===edited.Rows[0].MediaLinkIds[0]).Artwork={PrimaryUrl:'/manual'};
assert.equal(core.autoAdd.changes(core.scopeModel(edited,firstJob),ownerId,[],removing).removals.length,0);

// Two timelines may share an IMDb URL while each already contains different
// episodes. Missing runs remain destination-specific rather than being merged.
const timelineOwner=guid(), timelineA=guid(), timelineB=guid(), showId=guid();
let timeline=core.normalize({Nodes:[{Id:timelineOwner,ParentId:'',Name:'Timelines'}],Rows:[timelineA,timelineB].map(Id=>({Id,ParentNodeId:timelineOwner,Name:'Chronological Order',Category:'Chronological Order',RowType:'Timeline',SourceUrl:'https://www.imdb.com/list/ls999/',Items:[],NodeIds:[],MediaLinkIds:[],MediaOrder:[]})),MediaLinks:[]});
timeline.Rows[0].Items.push({Id:guid(),JellyfinItemId:showId,DisplayName:'Show',ItemType:'Series',RangeMode:'Episodes',StartSeason:1,EndSeason:1,StartEpisode:1,EndEpisode:1});
const episodes=[1,2,3].map(index=>({Id:guid(),Name:'Episode '+index,Type:'Episode',SeriesId:showId,ParentIndexNumber:1,IndexNumber:index,ProviderIds:{Imdb:'tt'+(1000+index)}}));
for(const job of core.scopedJobs(timeline,timelineOwner)){
 const results=[{source:job.sources[0],index:0,orderVerified:true,entries:episodes.map((e,i)=>({imdbId:e.ProviderIds.Imdb,title:e.Name,type:'Episode',position:i+1}))}], entries=core.autoAdd.preview(results,[{Id:showId,Name:'Show',Type:'Series'},...episodes]);
 const before=core.scopeModel(timeline,job),diff=core.autoAdd.changes(before,timelineOwner,entries,results);
 timeline=core.mergeScope(timeline,before,core.autoAdd.applyChanges(before,timelineOwner,entries,diff,new Set(diff.additions.map(a=>a.key)),guid).model,job);
}
const timelineRefs=row=>[...row.Items,...row.MediaLinkIds.map(id=>timeline.MediaLinks.find(l=>l.Id===id))];
assert.deepEqual(plain(timelineRefs(timeline.Rows[0]).map(r=>[r.StartEpisode,r.EndEpisode])),[[1,1],[2,3]]);
assert.deepEqual(plain(timelineRefs(timeline.Rows[1]).map(r=>[r.StartEpisode,r.EndEpisode])),[[1,3]]);

// Manual direct entries must not get a duplicate node-owned membership when a
// main source also adds that title to an independent chronological destination.
const manualOwner=guid(), manualRow=guid(), chronoRow=guid();
let direct=core.normalize({Nodes:[{Id:manualOwner,ParentId:'',Name:'Manual movie',AutoAddSources:[{...sourceConfig,Categories:['Movies','Chronological Timeline']}]}],MediaLinks:[],Rows:[{Id:manualRow,ParentNodeId:manualOwner,Name:'Movies',Category:'Movies',RowType:'Media',Items:[{Id:guid(),JellyfinItemId:movieId,DisplayName:'Iron Man',ItemType:'Movie',RangeMode:'Full'}]},{Id:chronoRow,ParentNodeId:manualOwner,Name:'Chronological Order',Category:'Chronological Order',RowType:'Timeline'}]});
const manualJob=core.scopedJobs(direct,manualOwner)[0],manualBefore=core.scopeModel(direct,manualJob),manualResults=[{...result,source:manualJob.sources[0]}],manualEntries=core.autoAdd.preview(manualResults,[{Id:movieId,Name:'Iron Man',Type:'Movie',ProductionYear:2008,ProviderIds:{Imdb:'tt123'}}]),manualDiff=core.autoAdd.changes(manualBefore,manualOwner,manualEntries,manualResults);
assert.equal(manualDiff.additions.length,1);
assert.deepEqual(plain(manualDiff.additions[0].rowIds),[chronoRow],'Review destinations exclude the row already containing a manual title');
direct=core.mergeScope(direct,manualBefore,core.autoAdd.applyChanges(manualBefore,manualOwner,manualEntries,manualDiff,new Set(manualDiff.additions.map(a=>a.key)),guid).model,manualJob);
assert.equal(direct.Rows.find(r=>r.Id===manualRow).MediaLinkIds.length,0);
assert.equal(direct.Rows.find(r=>r.Id===manualRow).Items.length,1);
assert.equal(direct.Rows.find(r=>r.Id===chronoRow).MediaLinkIds.length,1);

console.log('PASS production settings core: legacy migration, unknown-field preservation, stable IDs, scoped rows, artwork refs, ranges, manual deduplication and AutoAdd edit protection');
