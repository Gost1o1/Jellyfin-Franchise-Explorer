/* Regression: native playback card contract, no blocking Home modal, centered confirmation. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../src/Jellyfin.Plugin.FranchiseExplorer/Web');
const timeline=fs.readFileSync(path.join(root,'franchise-timeline.js'),'utf8');
const home=fs.readFileSync(path.join(root,'franchise-my-media.js'),'utf8');
assert(!timeline.includes('if(!confirm('),'Timeline choices must never invoke browser-native confirmations');
assert(timeline.includes('await this.confirmAction('));
assert(timeline.includes('this.closeDialog(); // Unmount the blocking modal BEFORE native playback starts.'));
assert(home.includes("wrapper.className='card itemAction fe-direct-playback-shortcut'"));
assert(home.includes("wrapper.dataset.serverid=serverId"));
assert(home.includes("wrapper.dataset.mediatype='Video'"));
assert(home.includes("wrapper.dataset.action=options.startOver||!Number(options.positionTicks)?'play':'resume'"));
assert(home.includes('if(intent.replayOnly){'),'Untracked viewing must not trigger timeline activation warnings');

class Element {
  constructor(tag){this.tag=tag;this.style={};this.children=[];this.attributes={};this.events={};this.isConnected=true;}
  setAttribute(k,v){this.attributes[k]=v;}
  append(...elements){this.children.push(...elements);for(const e of elements)e.parent=this;}
  addEventListener(type,callback){this.events[type]=callback;}
  focus(){doc.activeElement=this;}
  remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(x=>x!==this);}
  click(){this.events.click?.({target:this});}
}
const doc={body:new Element('body'),activeElement:null};
const env={window:{},document:doc,console};
vm.runInNewContext(timeline,env);
const m=new env.window.FranchiseTimeline.TimelineManager({});
m.make=(tag,cls,value)=>{const e=new Element(tag);e.className=cls;e.textContent=value||'';return e;};
m.button=(text,callback)=>{const e=new Element('button');e.textContent=text;e.addEventListener('click',callback);return e;};
(async()=>{
  const phrase='Continue the chronological timeline from Agent Carter?';
  let result=m.confirmAction(phrase,'Watch and track');
  const mask=doc.body.children[0];
  assert(mask.style.cssText.includes('place-items:center'));
  const panel=mask.children[0];
  assert.equal(panel.attributes.role,'alertdialog');
  assert.equal(panel.attributes['aria-modal'],'true');
  assert.equal(panel.children[0].textContent,phrase);
  const actions=panel.children[1].children;
  assert.equal(actions[1].textContent,'Watch and track');
  assert(actions[0].style.cssText.includes('border-radius:8px'),'Cancel uses the rounded home-dialog style');
  assert(actions[0].style.cssText.includes('background:#2b3643'),'Cancel uses a dark background');
  assert(actions[1].style.cssText.includes('background:#0b9caf'),'Watch and track uses the teal primary style');
  assert(actions[1].style.cssText.includes('color:#03191c'),'Primary action text has the contrasting dark color');
  actions[0].click();assert.equal(await result,false);
  assert.equal(doc.body.children.length,0,'Cancel removes the confirmation layer');
  result=m.confirmAction(phrase,'Watch and track');
  doc.body.children[0].children[0].children[1].children[1].click();
  assert.equal(await result,true);
  assert.equal(doc.body.children.length,0,'Accept removes the confirmation layer');
  console.log('v0.8.9.15 centered tracking-choice and blocking-modal lifecycle contracts passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
