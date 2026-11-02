/* Collection-import destinations and safe virtual-reference group moves. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'),'utf8');

function section(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from+start.length);
  assert(from>=0&&to>from,`Missing function boundary: ${start}`);
  return html.slice(from,to);
}
assert(html.includes('id="fx-import-target"'),'Import destination group selector is required');
assert(html.includes('Import members into group'),'Show users where collection members will go');
assert(html.includes("NodeId:destinationId"),'New links must belong to the chosen destination');
assert(html.includes("l.NodeId===destinationId&&l.JellyfinItemId"),'Duplicate checks must use the destination');
assert(html.includes('Assign to group'),'Existing virtual references need group controls');
assert(html.includes('Rows using this reference: '),'Current row membership must be shown');
assert(html.includes('Same title added separately in: '),'Do not conflate direct row entries with virtual link assignments');
assert(html.includes('Show in browse rows ('),'Users must be able to assign exact imported references to existing rows');
assert(html.includes('Not in a row for this group'),'Ancestor assignments must not mask an unassigned group shelf');

const root={Id:'root',ParentId:'',Name:'Marvel',NodeType:'Franchise',SortOrder:1};
const phaseA={Id:'phase-a',ParentId:'root',Name:'Phase One',NodeType:'Phase',SortOrder:1};
const phaseB={Id:'phase-b',ParentId:'root',Name:'Phase Two',NodeType:'Phase',SortOrder:2};
const other={Id:'other',ParentId:'',Name:'Star Wars',NodeType:'Franchise',SortOrder:2};
const moving={Id:'link-1',NodeId:'phase-a',JellyfinItemId:'movie-1',RangeMode:'Full',Position:1,DisplayName:'Movie One'};
const existing={Id:'link-2',NodeId:'phase-b',JellyfinItemId:'movie-2',RangeMode:'Full',Position:4,DisplayName:'Movie Two'};
const duplicate={Id:'link-3',NodeId:'phase-a',JellyfinItemId:'movie-2',RangeMode:'Full',Position:2,DisplayName:'Movie Two'};
const rootRow={Id:'row-root',ParentNodeId:'root',RowType:'Timeline',MediaLinkIds:['link-1'],MediaOrder:['link-1'],Items:[]};
const oldRow={Id:'row-a',ParentNodeId:'phase-a',RowType:'Media',MediaLinkIds:['link-1'],MediaOrder:['link-1'],Items:[]};
const destinationRow={Id:'row-b',ParentNodeId:'phase-b',RowType:'Media',MediaLinkIds:[],MediaOrder:[],Items:[]};
const model={Nodes:[root,phaseA,phaseB,other],MediaLinks:[moving,existing,duplicate],Rows:[rootRow,oldRow,destinationRow]};
let dirty=false;
const context={model,num:v=>Number(v)||0,setDirty:v=>{dirty=v;},
  linkIdentity:l=>[l.JellyfinItemId,l.RangeMode||'Full',l.StartSeason||0,l.EndSeason||0,l.StartEpisode||0,l.EndEpisode||0].join(':'),
};
vm.runInNewContext([
  section('  function children(parent) {','  function normalizeSiblingPositions(parentId) {'),
  section('  function reassignVirtualLink(link,destinationId) {','  function renderLinks(nodeId) {'),
  section('  function syncMediaOrder(row){','  function reorderRow(rowId,delta){'),
  'globalThis.api={groupChoices,reassignVirtualLink,linkBelongsToGroup,setLinkRowMembership};',
].join('\n'),context);
const {groupChoices,reassignVirtualLink,linkBelongsToGroup,setLinkRowMembership}=context.api;

assert.deepEqual(Array.from(groupChoices('phase-a'),x=>x.node.Id),['root','phase-a','phase-b']);
assert.equal(linkBelongsToGroup('phase-b','root'),true);
assert.equal(linkBelongsToGroup('phase-b','phase-a'),false);
assert.throws(()=>reassignVirtualLink(moving,'other'),/same franchise/);
assert.throws(()=>reassignVirtualLink(duplicate,'phase-b'),/already linked/);
assert.equal(moving.NodeId,'phase-a');
assert.equal(duplicate.NodeId,'phase-a');
assert.equal(dirty,false);

assert.equal(reassignVirtualLink(moving,'phase-b'),true);
assert.equal(moving.NodeId,'phase-b');
assert.equal(moving.Position,5);
assert.deepEqual(Array.from(rootRow.MediaLinkIds),['link-1'],'Ancestor row must preserve valid watch order');
assert.deepEqual(Array.from(oldRow.MediaLinkIds),[],'Old subgroup row must drop moved reference');
assert.deepEqual(Array.from(oldRow.MediaOrder),[],'Old row ordering must not retain orphaned reference');
assert.equal(dirty,true);
assert.equal(reassignVirtualLink(moving,'phase-b'),false);
assert.equal(setLinkRowMembership(moving,'row-b',true),true);
assert.deepEqual(Array.from(destinationRow.MediaLinkIds),['link-1']);
assert.deepEqual(Array.from(destinationRow.MediaOrder),['link-1']);
assert.equal(setLinkRowMembership(moving,'row-b',true),false,'Repeated selection should be idempotent');
assert.throws(()=>setLinkRowMembership(moving,'row-a',true),/cannot contain/,'Old subgroup rows must reject moved media');
assert.equal(setLinkRowMembership(moving,'row-b',false),true);
assert.deepEqual(Array.from(destinationRow.MediaLinkIds),[]);
assert.deepEqual(Array.from(destinationRow.MediaOrder),[]);
console.log('PASS collection import target and safe group reassignment, with accurate row-membership labels');
