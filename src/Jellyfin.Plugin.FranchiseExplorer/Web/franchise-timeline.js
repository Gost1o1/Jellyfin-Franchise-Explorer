/* Franchise Explorer v0.8.4.0 local Jellyfin Web playback handoff.
 * A Jellyfin PlayNow queue is built from item IDs, never from filenames.
 * Timeline state is separate from Jellyfin watched flags and user-specific.
 */
(function (global) {
  'use strict';
  const guid = v => /^[a-f\d]{32}$|^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v || ''));
  const n = value => Math.max(0, Number.parseInt(value,10) || 0);
  const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rangeLabel = r => r.rangeMode === 'Seasons' ? `Seasons ${r.startSeason}–${r.endSeason}` :
    r.rangeMode === 'Episodes' ? `S${r.startSeason}E${r.startEpisode}–S${r.endSeason}E${r.endEpisode}` : 'Entire title';
  const epNumber = e => [n(e.ParentIndexNumber),n(e.IndexNumber)];
  const compareEpisode = (a,b) => epNumber(a)[0]-epNumber(b)[0] || epNumber(a)[1]-epNumber(b)[1];
  const inRange = (e,r) => {
    const season=n(e.ParentIndexNumber), episode=n(e.IndexNumber);
    if (episode===0 || !e.Id) return false; // exclude virtual placeholders
    if (!r.rangeMode || r.rangeMode==='Full') return season>0; // specials only when selected explicitly
    const start=n(r.startSeason), end=n(r.endSeason);
    if (end < start) return false;
    if (r.rangeMode==='Seasons') return season>=start && season<=end;
    if (r.rangeMode==='Episodes') {
      const from=n(r.startEpisode),to=n(r.endEpisode);
      if (from<1 || to<1 || season<start || season>end || start===end && to<from) return false;
      return (season>start || episode>=from) && (season<end || episode<=to);
    }
    return false;
  };
  class TimelineManager {
    constructor(context) {
      this.context=context;this.states=new Map();this.queues=new Map();this.activeDialog=null;
      this.pollTimer=null;this.currentRow=null;this.latestSession=null;this.inflight=false;
    }
    headers(){return {'Authorization':'MediaBrowser Token="'+this.context.token+'"'};}
    url(path){return this.context.prefix+(path.startsWith('/')?path:'/'+path);}
    async request(path,options={}) {
      const res=await fetch(this.url(path),{cache:'no-store',...options,headers:{...this.headers(),...(options.headers||{})}});
      if(!res.ok)throw new Error('Jellyfin returned HTTP '+res.status+' for '+path.split('?')[0]);
      if(res.status===204)return null;return await res.json();
    }
    async load(){
      try {const states=await this.request('/FranchiseExplorer/TimelineState');
        this.states=new Map((Array.isArray(states)?states:[]).map(s=>[s.rowId,s]));
      }catch(e){console.warn('Franchise timeline state unavailable:',e);}
      this.beginMonitoring();
    }
    getState(rowId){return this.states.get(rowId)||null;}
    async save(state){
      state.updatedUtc=new Date().toISOString();
      const result=await this.request('/FranchiseExplorer/TimelineState/'+encodeURIComponent(state.rowId),{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)
      });
      this.states.set(state.rowId,result);return result;
    }
    async getEpisodes(seriesId){
      const all=[];let offset=0;const size=250;
      for(let page=0;page<100;page++){
        const result=await this.request('/Shows/'+encodeURIComponent(seriesId)+'/Episodes?userId='+encodeURIComponent(this.context.userId)+'&startIndex='+offset+'&limit='+size+'&isMissing=false');
        const part=(result?.Items||[]).filter(e=>e && guid(e.Id) && e.Type==='Episode');
        all.push(...part);offset+=(result?.Items||[]).length;
        if(!result?.Items?.length || offset >= (result.TotalRecordCount||0))break;
      }
      return all.sort(compareEpisode);
    }
    async getCollection(id){
      const all=[];let offset=0;
      for(let page=0;page<100;page++){
        const r=await this.request('/Items?ParentId='+encodeURIComponent(id)+'&Recursive=true&IncludeItemTypes=Movie,Series&StartIndex='+offset+'&Limit=250&UserId='+encodeURIComponent(this.context.userId));
        all.push(...(r.Items||[]));offset+=(r.Items||[]).length;
        if(!r.Items?.length || offset >= (r.TotalRecordCount||0))break;
      }
      return all.filter(i=>i&&['Movie','Series'].includes(i.Type));
    }
    async resolve(row){
      if(row.rowType!=='Timeline')throw new Error('Choose a chronological / viewing-order row.');
      const catalog=this.context.catalog;
      const links=(row.mediaLinkIds||[]).map(id=>catalog.links.find(l=>l.id===id)).filter(Boolean);
      const own=(row.items||[]).filter(x=>guid(x.itemId));
      const ranks=new Map((row.mediaOrder||[]).map((id,i)=>[id,i]));
      const refs=[...links,...own];
      if(ranks.size) refs.sort((a,b)=>(ranks.get(a.id)??99999)-(ranks.get(b.id)??99999));
      const queue=[],warnings=[],duplicateCheck=new Set();
      for(const ref of refs){
        if(!guid(ref.itemId)){warnings.push('A saved reference has no valid Jellyfin item ID.');continue;}
        const item=await this.context.getItem(ref.itemId);
        if(!item){warnings.push('An item is missing or not accessible to your Jellyfin account.');continue;}
        let items=[];
        try {
          if(item.Type==='Movie' || item.Type==='Episode')items=[item];
          else if(item.Type==='Series')items=(await this.getEpisodes(item.Id)).filter(ep=>inRange(ep,ref));
          else if(item.Type==='BoxSet'){
            const members=await this.getCollection(item.Id);
            for(const member of members){if(member.Type==='Movie')items.push(member);
              else if(member.Type==='Series')items.push(...await this.getEpisodes(member.Id));}
          }else{warnings.push('Cannot queue unsupported type '+item.Type+'.');continue;}
        }catch(e){warnings.push('Unable to resolve '+(item.Name||'item')+': '+e.message);continue;}
        if(!items.length){warnings.push((item.Name||'TV Show')+' has no accessible episodes matching '+rangeLabel(ref)+'.');continue;}
        for(const media of items){
          if(!guid(media.Id))continue;
          const key=ref.id+':'+media.Id.toLowerCase();
          if(duplicateCheck.has(key))continue;
          duplicateCheck.add(key);
          const label=media.Type==='Episode'
            ? (item.Name||media.SeriesName||'TV Show')+' · S'+n(media.ParentIndexNumber)+'E'+n(media.IndexNumber)+' · '+(media.Name||'Episode')
            : (media.Name||'Movie');
          queue.push({key,id:media.Id,label,kind:media.Type,seriesId:media.SeriesId||'',
            sourceItemId:item.Id,season:n(media.ParentIndexNumber),episode:n(media.IndexNumber),
            runTimeTicks:n(media.RunTimeTicks),referenceId:ref.id,range:rangeLabel(ref)});
        }
      }
      if(row.nodeIds?.length)warnings.push('Subgroups in a chronological row are not expanded automatically; add their individual media titles.');
      this.queues.set(row.id,queue);
      return {queue,warnings};
    }
    // A Jellyfin 204 response only acknowledges dispatch. It does not prove
    // that the destination client accepted the remote play command.
    isRemoteCapable(session){
      return session && session.SupportsRemoteControl !== false &&
        session.SupportsMediaControl !== false &&
        session.Capabilities?.SupportsMediaControl !== false;
    }
    async sessions(){
      const all=await this.request('/Sessions?ControllableByUserId='+encodeURIComponent(this.context.userId));
      return (Array.isArray(all)?all:[]).filter(s=>s?.Id &&
        (String(s.UserId||'').toLowerCase()===this.context.userId.toLowerCase() ||
          (s.AdditionalUsers||[]).some(u=>String(u.UserId||'').toLowerCase()===this.context.userId.toLowerCase()))
      );
    }
    async verifyStarted(sessionId,expectedItemId,options={}){
      const retries=options.retries??12;
      const delay=options.delay??900;
      for(let i=0;i<retries;i++){
        // The server's NowPlayingItem is an observed state, unlike the HTTP
        // return code from the remote command. Never infer playback from 204.
        try{
          const sessions=await this.sessions();
          const session=sessions.find(s=>s.Id===sessionId);
          const actual=String(session?.NowPlayingItem?.Id||'').replace(/-/g,'').toLowerCase();
          const expected=String(expectedItemId).replace(/-/g,'').toLowerCase();
          if(actual && actual===expected)return session;
        }catch(error){
          if(i===retries-1)throw new Error('Unable to verify Jellyfin playback: '+error.message);
        }
        if(i<retries-1)await new Promise(resolve=>setTimeout(resolve,delay));
      }
      throw new Error('Jellyfin accepted the Play Now command but '+
        'the selected device did not report starting the requested movie/episode. '+
        'Nothing was added to chronological watch history. '+
        'This client may not support remote control. Check its playback/casting capabilities, '+
        'choose a supported device, and retry using a short timeline.');
    }
    async play(queue,sessionId,index=0,positionTicks=0){
      if(!sessionId || !queue.length || index<0 || index>=queue.length)
        throw new Error('Choose a playback device and playable item.');
      const devices=await this.sessions();
      const destination=devices.find(s=>s.Id===sessionId);
      if(!destination)throw new Error('The selected Jellyfin device is no longer connected or accessible. Reopen the playback dialog.');
      if(!this.isRemoteCapable(destination))
        throw new Error((destination.DeviceName||destination.Client||'This playback device')+
          ' reports that remote media control is disabled. Jellyfin cannot start a queue on it via the Sessions API. '+
          'Choose a remote-controllable player or enable casting/remote control in the device. '+
          'Your timeline history was not changed.');
      const chunks=[];
      // Start with a modest batch; adding all 422 titles before verifying the
      // client can start a single item is both slow and misleading.
      for(let i=index;i<queue.length;i+=24)chunks.push(queue.slice(i,i+24));
      const command=async (ids,cmd,position)=>{
        const url='/Sessions/'+encodeURIComponent(sessionId)+'/Playing?playCommand='+cmd+
          '&itemIds='+encodeURIComponent(ids.map(q=>q.id).join(','))+
          '&startIndex=0&startPositionTicks='+Math.max(0,position);
        const res=await fetch(this.url(url),{method:'POST',headers:this.headers()});
        if(!res.ok)throw new Error('Jellyfin rejected '+cmd+' for the selected device (HTTP '+res.status+').');
      };
      await command(chunks[0],'PlayNow',positionTicks);
      await this.verifyStarted(sessionId,queue[index].id);
      // Append only after the player has really started the correct item.
      // PlayLast support can still vary by client; test longer queues on the
      // real device before trusting unattended chronological playback.
      for(let i=1;i<chunks.length;i++){
        await new Promise(resolve=>setTimeout(resolve,250));
        await command(chunks[i],'PlayLast',0);
      }
      return {started:true,appendedChunks:chunks.length-1};
    }
    // Playing on the same Jellyfin Web client is not remote-control playback.
    // Hand off to Jellyfin Web's native Play control; only Jellyfin's observed
    // NowPlayingItem will activate timeline tracking. A localStorage request
    // is an expiring *intent*, NOT watch history.
    handoffKey(){return 'fe-local-timeline-v1:'+String(this.context.userId).toLowerCase();}
    async playHere(row,queue,index,positionTicks=0,reset=false,replayOnly=false){
      if(index<0 || index>=queue.length)throw new Error('Select a playable entry.');
      const target=queue[index];
      const prev=this.getState(row.id);
      const state=this.makeState(row,queue,index);
      state.index=index;state.itemId=target.id;state.positionTicks=Math.max(0,positionTicks);
      state.sessionId='';state.playbackMode='paused';
      if(reset)state.completedKeys=state.completedKeys.filter(k=>queue.findIndex(q=>q.key===k)<index);
      const intent={version:1,created:Date.now(),rowId:row.id,expectedId:target.id,
        state,replayOnly:!!replayOnly,prior:prev?JSON.parse(JSON.stringify(prev)):null,
        subtitleEnabled:!!document.getElementById('fe-subtitles')?.checked};
      // The bridge will confirm actual playback in this logged-in Jellyfin Web
      // client before creating/updating server-side timeline progress.
      localStorage.setItem(this.handoffKey(),JSON.stringify(intent));
      const prefix=this.context.prefix||'';
      const sid=this.context.serverId?'&serverId='+encodeURIComponent(this.context.serverId):'';
      const sub=intent.subtitleEnabled?'1':'0';
      location.assign(prefix+'/web/#/details?id='+encodeURIComponent(target.id)+sid+
        '&feAutoPlay=1&feLocalTimeline=1&feSubs='+sub);
    }
    makeState(row,queue,index=0){
      const old=this.getState(row.id);const same=old && Array.isArray(old.queueKeys) &&
        queue.some(q=>q.key===old.queueKeys[old.index]);
      const restored=same?queue.findIndex(q=>q.key===old.queueKeys[old.index]):index;
      return {
        rowId:row.id,parentNodeId:row.parentNodeId||'',name:row.name,
        itemId:queue[Math.max(0,restored)]?.id||'',sessionId:old?.sessionId||'',playbackMode:'paused',
        index:Math.max(0,restored),total:queue.length,positionTicks:same?n(old.positionTicks):0,
        completedKeys:(old?.completedKeys||[]).filter(key=>queue.some(q=>q.key===key)),queueKeys:queue.map(q=>q.key),queueLengths:queue.map(q=>q.runTimeTicks),
        queueSourceItemIds:queue.map(q=>q.sourceItemId),queueSeasons:queue.map(q=>q.season),queueEpisodes:queue.map(q=>q.episode)
      };
    }
    async start(row,queue,sessionId,index,positionTicks=0,mode='playing',reset=false){
      // Tell Jellyfin to queue the resolved items. State is changed only if
      // the playback command succeeds.
      await this.play(queue,sessionId,index,positionTicks);
      const state=this.makeState(row,queue,index);
      state.index=index;state.itemId=queue[index].id;state.positionTicks=positionTicks;
      state.sessionId=sessionId;state.playbackMode=mode;
      if(reset)state.completedKeys=[];
      await this.save(state);
      return state;
    }
    async replay(row,queue,index,sessionId,resetTimeline){
      const previous=this.getState(row.id);
      const old=this.makeState(row,queue,index);
      if(resetTimeline){
        old.completedKeys=old.completedKeys.filter(k=>queue.findIndex(x=>x.key===k)<index);
        old.index=index;old.itemId=queue[index].id;old.positionTicks=0;old.sessionId=sessionId;
        old.playbackMode='playing'; // queue automatically continues in chronology
      }else{
        old.playbackMode='replay'; // suppress chronological event tracking BEFORE playing
        old.sessionId='';        // an independent replay never rewinds this timeline
      }
      await this.save(old);
      try{
        if(resetTimeline)await this.play(queue,sessionId,index,0);
        else await this.play([queue[index]],sessionId,0,0);
      }catch(e){
        // Restore saved history if Jellyfin rejects the playback command.
        if(previous)await this.save(previous);
        throw e;
      }
    }
    make(tag,cls,content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=content;return el;}
    button(label,callback,cls='btn'){
      const el=this.make('button',cls,label);el.type='button';el.addEventListener('click',()=>Promise.resolve(callback()).catch(e=>this.showError(e)));return el;
    }
    showError(error){console.error(error);if(this.activeDialog){this.activeDialog.querySelector('.timeline-feedback').textContent=error.message||String(error);}}
    progressBar(percent){const outer=this.make('div','timeline-progress-track');outer.setAttribute('role','progressbar');outer.setAttribute('aria-valuenow',String(Math.round(percent)));
      outer.setAttribute('aria-valuemin','0');outer.setAttribute('aria-valuemax','100');const inner=this.make('div','timeline-progress-fill');inner.style.width=Math.max(0,Math.min(100,percent))+'%';outer.append(inner);return outer;}
    progress(rowId){const s=this.getState(rowId);if(!s||!s.total)return 0;
      const finished=new Set(s.completedKeys||[]);return 100*finished.size/s.total;}
    decorateMedia(tile, ref, row) {
      const possible=[...this.states.values()].filter(s=>s.queueKeys?.length && s.queueSourceItemIds?.length);
      if(!possible.length)return;
      // Prefer the timeline from this actual shelf, otherwise the latest saved
      // timeline in this franchise; never infer from Jellyfin's global Played flag.
      const family=new Set();let parentId=row?.parentNodeId||'';
      for(let i=0;i<30 && parentId;i++){
        family.add(parentId);
        parentId=this.context.catalog.nodes.find(n=>n.id===parentId)?.parentId||'';
      }
      const related=possible.filter(s=>family.has(s.parentNodeId) || s.rowId===row?.id)
        .sort((a,b)=>new Date(b.updatedUtc||0)-new Date(a.updatedUtc||0));
      const closest=related.find(s=>s.rowId===row?.id)||related[0];
      if(!closest)return;
      const all=[];
      closest.queueSourceItemIds.forEach((source,i)=>{
        if(String(source).toLowerCase()!==String(ref.itemId).toLowerCase())return;
        if((ref.rangeMode==='Episodes'||ref.rangeMode==='Seasons') &&
            !inRange({Id:closest.queueKeys[i],ParentIndexNumber:closest.queueSeasons?.[i],IndexNumber:closest.queueEpisodes?.[i]},ref))return;
        all.push(closest.queueKeys[i]);
      });
      if(!all.length)return;
      const completed=new Set(closest.completedKeys||[]);
      const finished=all.filter(k=>completed.has(k)).length;
      const value=Math.round(100*finished/all.length);
      const caption=this.make('span','timeline-card-caption',finished+' of '+all.length+' completed · '+closest.name);
      tile.button.append(caption,this.progressBar(value));
    }
    addControls(row,frame){
      if(row.rowType!=='Timeline')return;
      const controls=this.make('div','timeline-shelf-controls');
      const btn=this.button('▶ Play chronological order',()=>this.openDialog(row),'btn btn-primary');
      const details=this.button('☷ Episodes & progress',()=>this.openDialog(row));
      const progress=this.make('div','timeline-mini-progress');
      progress.dataset.rowId=row.id;const pct=Math.round(this.progress(row.id));progress.textContent=pct+'% completed';
      progress.append(this.progressBar(this.progress(row.id)));
      controls.append(btn,details,progress);frame.shelf.insertBefore(controls,frame.track);
    }
    async openDialog(row,autoResume=false){
      this.closeDialog();const mask=this.make('div','timeline-dialog-mask');mask.setAttribute('role','presentation');
      const panel=this.make('section','timeline-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
      panel.setAttribute('aria-label','Chronological playback for '+row.name);
      const top=this.make('div','timeline-dialog-header');top.append(this.make('h2','',row.name),this.button('✕ Close',()=>this.closeDialog()));
      const feedback=this.make('div','timeline-feedback','Resolving selected seasons and episodes…');
      const summary=this.make('div','timeline-summary');const chooser=this.make('div','timeline-chooser');const list=this.make('div','timeline-entry-list');
      panel.append(top,feedback,summary,chooser,list);mask.append(panel);document.body.append(mask);this.activeDialog=panel;
      mask.addEventListener('click',e=>{if(e.target===mask)this.closeDialog();});
      const trap=e=>{if(e.key==='Escape'){e.preventDefault();this.closeDialog();}};
      mask.addEventListener('keydown',trap);panel.querySelector('button')?.focus();
      try{
        const {queue,warnings}=await this.resolve(row);if(this.activeDialog!==panel)return;
        if(warnings.length)feedback.textContent=warnings.join(' · ');else feedback.textContent='';
        const saved=this.getState(row.id),keys=new Set(saved?.completedKeys||[]);
        summary.append(this.make('p','',queue.length+' playable movies/episodes · '+keys.size+' completed'));
        summary.append(this.progressBar(queue.length?keys.size/queue.length*100:0));
        if(!queue.length){list.append(this.make('div','shelf-empty','No playable items in this timeline. Check library permissions, episode ranges, and media availability.'));return;}
        const sessionLabel=this.make('label','','Play on this Jellyfin device:');
        const select=this.make('select','field timeline-device');select.setAttribute('aria-label','Choose a Jellyfin playback session');
        chooser.append(sessionLabel,select);
        const activeDevices=await this.sessions();if(this.activeDialog!==panel)return;
        const localChoice=this.make('option','','This browser (local playback — recommended)');
        localChoice.value='__local__';select.append(localChoice);
        for(const s of activeDevices){
          const supported=this.isRemoteCapable(s);
          const description=(s.DeviceName||s.Client||'Device')+' · '+(s.UserName||'User');
          const option=this.make('option','',description+(supported?'':' · Remote playback unavailable'));
          option.value=s.Id;option.disabled=!supported;select.append(option);
        }
        const playableDevices=activeDevices.filter(s=>this.isRemoteCapable(s));
        select.value='__local__';
        // Keep local browser selected. Remote devices are opt-in.

        if(!playableDevices.length)feedback.textContent+=
          ' No connected session reports remote playback support. The selected Chrome client may not accept remote Play Now commands. '+
          'Choose This browser (local playback) to open the native Jellyfin Web player. Your episode-number formatting is not the cause.';
        const startIndex=queue.findIndex(q=>q.key===saved?.queueKeys?.[saved?.index]);
        const resumeIndex=startIndex>=0?startIndex:0;
        const start=this.button('▶ Play from beginning',async()=>{
          if(select.value==='__local__')return this.playHere(row,queue,0,0,true);
          await this.start(row,queue,select.value,0,0,'playing',true);feedback.textContent='Jellyfin confirmed playback on the remote device; subsequent queue support varies.';
        },'btn btn-primary');
        const resume=this.button('↻ Resume timeline',async()=>{
          if(select.value==='__local__')return this.playHere(row,queue,resumeIndex,n(saved?.positionTicks));
          await this.start(row,queue,select.value,resumeIndex,n(saved?.positionTicks));feedback.textContent='Jellyfin confirmed playback on the remote device.';
        });
        // The local browser option is available even when remote control is disabled.

        chooser.append(start,resume);
        if(autoResume){
          // Dashboard's explicitly clicked Resume Timeline link.
          void (select.value==='__local__'
            ? this.playHere(row,queue,resumeIndex,n(saved?.positionTicks))
            : this.start(row,queue,select.value,resumeIndex,n(saved?.positionTicks))).then(()=>{
            if(this.activeDialog===panel) feedback.textContent='Jellyfin confirmed the resumed movie/episode is playing.';
          }).catch(error=>this.showError(error));
        }
        queue.forEach((q,i)=>{
          const done=keys.has(q.key),isCurrent=i===resumeIndex;
          const line=this.make('div','timeline-entry');
          const details=this.make('div','timeline-entry-text');details.append(this.make('strong','',`${i+1}. ${q.label}`),
            this.make('small','',done?'✓ Completed in this timeline':isCurrent?'▶ Timeline position':'Not started'));
          const act=this.make('div','timeline-entry-actions');
          const replay=this.button('Replay only',async()=>{
            if(select.value==='__local__')return this.playHere(row,queue,i,0,false,true);
            await this.replay(row,queue,i,select.value,false);
            feedback.textContent='Jellyfin confirmed independent replay started. The chronological cursor and completed items were preserved.';
          });
          const reset=this.button('Restart timeline here',async()=>{
            const okay=confirm('Move this timeline back to '+q.label+'? Later entries will be marked unfinished in THIS timeline only.');
            if(!okay)return;
            if(select.value==='__local__')return this.playHere(row,queue,i,0,true,false);
            await this.replay(row,queue,i,select.value,true);
            feedback.textContent='Jellyfin confirmed playback restarted here; remaining queue commands were sent.';
          });
          act.append(replay,reset);line.append(details,act);
          if(isCurrent && !done && q.runTimeTicks){
            const partial=Math.min(100,100*n(saved?.positionTicks)/q.runTimeTicks);
            if(partial>0){details.append(this.progressBar(partial));details.append(this.make('small','',Math.round(partial)+'% through this movie/episode'));}
          }
          if(done)line.classList.add('timeline-complete');list.append(line);
        });
      }catch(e){this.showError(e);}
    }
    closeDialog(){if(this.activeDialog){this.activeDialog.parentElement?.remove();this.activeDialog=null;}}
    beginMonitoring(){
      if(this.pollTimer)return;
      this.pollTimer=setInterval(()=>void this.poll().catch(e=>console.debug('Timeline monitor:',e.message)),12000);
    }
    async poll(){
      if(this.inflight||document.hidden)return;this.inflight=true;
      try{
        // The Jellyfin server-side PlaybackStart/Progress/Stopped listener owns
        // authoritative timeline tracking. Web clients only read progress;
        // they must not race the native event listener with stale PUT requests.
        const states=await this.request('/FranchiseExplorer/TimelineState');
        this.states=new Map((Array.isArray(states)?states:[]).map(x=>[x.rowId,x]));
        document.querySelectorAll('.timeline-mini-progress[data-row-id]').forEach(el=>{
          const p=this.progress(el.dataset.rowId);
          el.firstChild.textContent=Math.round(p)+'% completed';
          const fill=el.querySelector('.timeline-progress-fill');if(fill)fill.style.width=p+'%';
        });
      }catch(e){console.debug('Timeline status refresh:',e.message);}
      finally{this.inflight=false;}
    }

  }
  global.FranchiseTimeline = { TimelineManager, inRange, compareEpisode, rangeLabel };
})(window);
