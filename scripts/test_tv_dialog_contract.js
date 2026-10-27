// Static contract checks for v0.6.2 modal and resilience. No Jellyfin host access.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html'),'utf8');
for(const id of ['fx-tv-range','fx-range-mode','fx-range-endpoints','fx-range-error','fx-start-season','fx-end-season','fx-start-episode','fx-end-episode','fx-close-range','fx-save-range']) {
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'Missing/duplicate control '+id);
}
for(const txt of ['role="dialog"','aria-modal="true"','Entire TV Show','Season to season','Season/episode to season/episode','Edit TV Show range','+ Choose TV Show range','fitEditorToViewport','ResizeObserver','fx-compact','hostOverflows']) {
  assert(html.includes(txt),'Missing UI behavior '+txt);
}
assert(html.includes("single.addEventListener('click',()=>item.Type==='Series'?openRangeEditor(item):addResult(item))"), 'TV Show link should open dialog');
assert(html.includes("Object.assign(link,range)"), 'Editing should modify existing link rather than duplicating it');
assert(html.includes("wrap.style.setProperty('margin-left', hostOverflows ? '0px'"),'Overflowing host should disable offscreen centering');
console.log('TV Show range dialog and dashboard-width static contracts passed');
