#!/usr/bin/env python3
"""Mock browser regression: timeline-specific poster bars and watched badge."""
from pathlib import Path
from playwright.sync_api import sync_playwright
script=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
ref='11111111-1111-4111-8111-111111111111'
row='22222222-2222-4222-8222-222222222222'
item='33333333-3333-4333-8333-333333333333'
uid='44444444-4444-4444-8444-444444444444'
with sync_playwright() as p:
  b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
  page=b.new_page()
  page.set_content('<div id="card"><span class="cover"></span></div>')
  page.add_script_tag(content=script)
  result=page.evaluate('''({ref,row,item})=>{
    const state={rowId:row,parentNodeId:row,name:'Chronological Order',queueKeys:[ref+':'+item],
      queueSourceItemIds:[item],queueLengths:[1000000000],completedKeys:[],
      positionTicks:400000000,index:0,playbackMode:'playing',name:'Chronology'};
    const tm=new FranchiseTimeline.TimelineManager({prefix:'',token:'',userId:'',catalog:{nodes:[{id:row,parentId:''}]}});
    tm.states.set(row,state);
    const button=document.getElementById('card'),cover=button.querySelector('.cover');
    tm.decorateMedia({button,cover},{itemId:item,rangeMode:'Full'}, {id:row,parentNodeId:row});
    const partial=button.querySelector('.timeline-progress-fill').style.width;
    const badge=cover.querySelector('.timeline-watched-badge');
    state.completedKeys=[state.queueKeys[0]];state.index=1;state.positionTicks=0;state.playbackMode='complete';
    for(const update of tm.decorations)update();
    return {partial,finished:button.querySelector('.timeline-progress-fill').style.width,
      badge:badge.textContent,hidden:badge.hidden};
  }''',{'ref':ref,'row':row,'item':item})
  assert result['partial']=='40%' and result['finished']=='100%' and result['badge']=='✓ Watched' and result['hidden'] is False,result
  print('PASS partial poster progress and Watched overlay after actual timeline completion')
  b.close()
