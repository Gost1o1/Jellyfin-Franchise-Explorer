'use strict';
// Offline, pure-function contract tests. Live Jellyfin behavior is not covered.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'),'utf8');
const js=src.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const l='44444444-4444-4444-8444-444444444444';
const media='55555555-5555-4555-8555-555555555555';
const nodes=[{Id:a,ParentId:'',Name:'Marvel',NodeType:'Franchise',SortOrder:1,Artwork:{ThumbUrl:'https://example.org/my-upload.jpg'}},{Id:b,ParentId:a,Name:'Phase Two',NodeType:'Phase',SortOrder:1,Artwork:{}},{Id:c,ParentId:a,Name:'Phase Three',NodeType:'Phase',SortOrder:2,Artwork:{}}];
const links=[{Id:l,NodeId:b,JellyfinItemId:media,DisplayName:'Daredevil',ItemType:'Series',ViewingOrder:'Custom',Position:1}];
const ctx={};
const start=js.indexOf('  const validGuid');
const end=js.indexOf('  function children(parent)');
vm.runInNewContext(js.slice(start,end)+'\nglobalThis.normalizeTest=normalize;globalThis.rangeTest=rangeFields;globalThis.rangeLabelTest=linkRangeLabel;',ctx);
const restored=ctx.normalizeTest({NavigationLabel:'Franchises',Nodes:nodes,MediaLinks:links});
assert.equal(restored.Nodes[0].Artwork.ThumbUrl,'https://example.org/my-upload.jpg','override must survive migration');
assert.equal(restored.MediaLinks[0].RangeMode,'Full','existing v0.5 links stay full-range');
assert.equal(restored.MediaLinks[0].ItemType,'Series','Jellyfin internal type remains Series');
const r1={...links[0],RangeMode:'Seasons',StartSeason:1,EndSeason:3};
const r2={...links[0],RangeMode:'Episodes',StartSeason:1,StartEpisode:5,EndSeason:2,EndEpisode:8};
assert.equal(ctx.rangeLabelTest(r1),'Seasons 1–3');
assert.equal(ctx.rangeLabelTest(r2),'S1E5 – S2E8');
assert.equal(ctx.normalizeTest({Nodes:nodes,MediaLinks:[r1]}).MediaLinks[0].EndSeason,3);
assert.equal(ctx.normalizeTest({Nodes:nodes,MediaLinks:[r2]}).MediaLinks[0].EndEpisode,8);
assert.throws(()=>ctx.normalizeTest({Nodes:nodes,MediaLinks:[{...r1,StartSeason:4,EndSeason:1}]}),/Invalid TV Show season range/);
assert.throws(()=>ctx.normalizeTest({Nodes:nodes,MediaLinks:[{...r2,StartSeason:2,EndSeason:2,StartEpisode:9,EndEpisode:3}]}),/Invalid TV Show episode range/);
assert.throws(()=>ctx.normalizeTest({Nodes:nodes,MediaLinks:[{...r1,ItemType:'Movie'}]}),/require a Jellyfin TV Show/);
assert.throws(()=>ctx.normalizeTest({Nodes:nodes,MediaLinks:[{...r1,StartSeason:1000}]}),/Invalid TV Show season range/);
// Drag-and-drop helper is exercised without browser UI.
const codeStart=js.indexOf('  function children(parent)');
const codeEnd=js.indexOf('  function treeNode(node, depth, query)');
const dnd={model:{Nodes:JSON.parse(JSON.stringify(nodes))},dirty:false,setDirty(x){this.dirty=x;},render(){this.rendered=true;},byId:()=>({querySelectorAll:()=>[]})};
dnd.setDirty=x=>dnd.dirty=x;
dnd.render=()=>dnd.rendered=true;
vm.runInNewContext(js.slice(codeStart,codeEnd)+'\nglobalThis.repositionTest=repositionNode;globalThis.childrenTest=children;',dnd);
assert.equal(dnd.repositionTest(c,b,'before'),true,'move sibling above sibling');
assert.deepEqual(Array.from(dnd.childrenTest(a),n=>n.Id),[c,b]);
assert.equal(dnd.repositionTest(a,b,'inside'),false,'cannot nest ancestor into descendant');
assert.equal(dnd.repositionTest(c,b,'inside'),true,'can nest subgroup inside another subgroup');
assert.equal(dnd.model.Nodes.find(n=>n.Id===c).ParentId,b);
assert.equal(dnd.model.Nodes.find(n=>n.Id===c).SortOrder,1);
assert.equal(dnd.dirty,true);
// Explicit custom slots must not be overwritten when media references are appended.
const addResultCode=js.slice(js.indexOf('  function addResult(item) {'),js.indexOf('  let currentResults=[]'));
assert(!addResultCode.includes('Artwork['),'adding media must not mutate custom artwork');
assert(js.includes('sequence===previewEpoch)showSlot(slot,ref,caption)'), 'async artwork preview needs stale-result guard');
for(const id of ['fx-group-actions','fx-move-up','fx-move-down','fx-artwork-scope','fx-range-mode','fx-start-season','fx-end-season','fx-start-episode','fx-end-episode','fx-save-range']){
 assert.equal((src.match(new RegExp('id="'+id+'"','g'))||[]).length,1,`${id} must exist once`);
}
console.log('v0.6 media range, drag-and-drop, artwork guard and backward compatibility tests passed.');
