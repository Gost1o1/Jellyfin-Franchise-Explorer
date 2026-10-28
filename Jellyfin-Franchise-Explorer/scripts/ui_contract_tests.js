/* Basic DOM-independent regression tests. Not a Jellyfin host integration test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'),'utf8');
assert(html.includes('<style id="fx-live-css">'), 'Embedded styles must be inside the plugin page');
assert(html.indexOf('<style id="fx-live-css">') > html.indexOf('id="FranchiseExplorerConfigPage"'));
for (const id of ['fx-tree','fx-selected','fx-media-search','fx-search-results','fx-image-primary','fx-upload-primary','fx-file-primary','fx-image-backdrop','fx-upload-backdrop','fx-image-logo','fx-upload-logo','fx-image-thumb','fx-upload-thumb','fx-image-banner','fx-upload-banner','fx-save','fx-export','fx-import-file']) {
  const found = html.match(new RegExp('id="'+id+'"','g'))||[];
  assert.equal(found.length,1,`Expected exactly one ${id}`);
}
const source = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const start = source.indexOf('  const validGuid');
const end = source.indexOf('  function children(parent)');
const defs = source.slice(start,end) + '\nglobalThis.normalizeForTest=normalize;';
const context={};
vm.runInNewContext(defs,context);
const normalize=context.normalizeForTest;
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const m='33333333-3333-4333-8333-333333333333';
const l='44444444-4444-4444-8444-444444444444';
const existing={NavigationLabel:'Franchises',Nodes:[{Id:a,ParentId:'',Name:'Star Wars',NodeType:'Franchise',SortOrder:0,Artwork:{PrimaryUrl:'https://example.com/poster.jpg'}},{Id:b,ParentId:a,Name:'Fall of the Jedi',NodeType:'Era',SortOrder:0}],MediaLinks:[{Id:l,NodeId:b,JellyfinItemId:m,DisplayName:'Episode I',ItemType:'Movie',ViewingOrder:'Chronological',Position:1}]};
const normalized=normalize(existing);
assert.equal(normalized.Nodes.length,2);
assert.equal(normalized.MediaLinks.length,1);
assert.equal(normalized.Nodes[0].Artwork.PrimaryUrl,'https://example.com/poster.jpg');
const managed={...existing,Nodes:[{...existing.Nodes[0],Artwork:{PrimaryUrl:'/FranchiseExplorer/Artwork/11111111111141118111111111111111/primary'}},existing.Nodes[1]]};
assert.equal(normalize(managed).Nodes[0].Artwork.PrimaryUrl,managed.Nodes[0].Artwork.PrimaryUrl);
assert.equal(normalized.MediaLinks[0].ViewingOrder,'Chronological');
assert.throws(()=>normalize({...existing,Nodes:[{...existing.Nodes[0],ParentId:b},existing.Nodes[1]]}),/Circular/);
assert.throws(()=>normalize({...existing,MediaLinks:[{...existing.MediaLinks[0],JellyfinItemId:'not-a-guid'}]}),/Invalid virtual media link/);
assert.throws(()=>normalize({...existing,Nodes:[{...existing.Nodes[0],Artwork:{PrimaryUrl:'javascript:alert(1)'}},existing.Nodes[1]]}),/Artwork references/);
console.log('Existing v0.3/0.4 model migration contract, UI selectors and JS syntax passed.');
const migrated=normalize({...existing,Nodes:[{...existing.Nodes[0],CollectionId:'33333333-3333-4333-8333-333333333333'},existing.Nodes[1]]});
assert.equal(migrated.Nodes[0].CollectionId,'33333333-3333-4333-8333-333333333333');
assert.throws(()=>normalize({...existing,Nodes:[{...existing.Nodes[0],CollectionId:'bad-id'},existing.Nodes[1]]}),/collection ID/);
for(const id of ['fx-connected-collection','fx-collection-search','fx-find-collections','fx-import-collection','fx-unlink-collection','fx-select-all-results','fx-add-selected-results']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' expected exactly once');
}
console.log('v0.5 collection and bulk-selector UI contract passed.');
