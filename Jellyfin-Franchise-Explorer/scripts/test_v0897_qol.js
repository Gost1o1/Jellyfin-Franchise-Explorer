/* v0.8.9.7 homepage and franchise browsing quality-of-life regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const project = path.join(__dirname, '../src/Jellyfin.Plugin.FranchiseExplorer');
const browse = fs.readFileSync(path.join(project, 'Configuration/browsePage.html'), 'utf8');
const home = fs.readFileSync(path.join(project, 'Web/franchise-my-media.js'), 'utf8');
const api = fs.readFileSync(path.join(project, 'Api/FranchiseBrowseController.cs'), 'utf8');

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
console.log('v0.8.9.7 centered tile, clean browser, sort reset, and distinct TV/movie counts passed.');
