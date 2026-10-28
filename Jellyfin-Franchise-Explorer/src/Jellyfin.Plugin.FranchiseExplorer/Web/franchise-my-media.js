/*
 * Jellyfin Franchise Explorer — opt-in Jellyfin Web integration (v0.8.9.1).
 * Adds ONE visual link in the existing "My Media" row. It does not create a
 * Jellyfin library, alter user preferences, or modify the server's media.
 * Requires a compatible JavaScript injector to run in jellyfin-web.
 * The script never sends authentication tokens or user information anywhere.
 */
(function () {
  'use strict';

  // Programmatic registration plus a manual fallback must not create two observers.
  if (window.__franchiseExplorerMyMediaTileLoaded) return;
  window.__franchiseExplorerMyMediaTileLoaded = true;

  const TILE_ID = 'franchise-explorer-my-media-tile';
  const STYLE_ID = 'franchise-explorer-my-media-style';
  let queued = false;
  let observedCard = null;
  let observedResize = null;

  function browseUrl() {
    // Keep Jellyfin base-path prefixes (e.g. /jellyfin/web/index.html).
    const pathname = window.location.pathname || '';
    const match = pathname.match(/^(.*?)\/web(?:\/|$)/i);
    const base = match ? match[1] : '';
    return `${base}/FranchiseExplorer/Browse`;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TILE_ID} { cursor:pointer; text-decoration:none; color:inherit; }
      #${TILE_ID} .fe-tile-art {
        position:absolute;inset:0;display:flex;align-items:center;
        justify-content:center;overflow:hidden;box-sizing:border-box;
        width:100%;height:100%;margin:0!important;padding:0!important;
        border-radius:inherit;
        background:linear-gradient(130deg,#10232f 0%,#105062 55%,#112b37 100%);
        pointer-events:none;
      }
      #${TILE_ID} .fe-tile-icon {
        display:block!important;position:absolute;left:50%;top:43%;
        transform:translate(-50%,-50%);margin:0!important;padding:0!important;
        color:#cbf7fa;font:bold clamp(32px,4vw,58px)/1 Arial,sans-serif;
        text-align:center;text-shadow:0 2px 5px #001c24;
      }
      #${TILE_ID} .fe-tile-art-title {
        display:block!important;position:absolute;left:7px;right:7px;bottom:12%;
        margin:0!important;padding:0!important;text-align:center;color:white;
        font:bold clamp(14px,1.25vw,21px)/1.2 Arial,sans-serif;
        text-shadow:0 2px 5px #001a22;
      }
      #${TILE_ID}:focus-visible { outline:3px solid var(--theme-primary-color,#08bdd0);outline-offset:2px; }
      @media(max-width:540px){
        #${TILE_ID} .fe-tile-icon{font-size:36px}
        #${TILE_ID} .fe-tile-art-title{font-size:14px}
      }
    `;
    document.head.appendChild(style);
  }

  function isMyMediaHeading(element) {
    // This is intentionally English-only until Jellyfin exposes an API for
    // inserting custom library tiles. Do not infer it from unrelated text.
    const label = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return label === 'My Media' || label === 'My Media (small)';
  }

  function findMyMediaContainer() {
    const headings = document.querySelectorAll('h1,h2,h3,h4,.sectionTitle');
    for (const heading of headings) {
      if (!isMyMediaHeading(heading)) continue;
      let section = heading.closest('.verticalSection, .homeSection, section, [data-section]');
      // Some Jellyfin 12 layouts place the heading in a wrapper within the section.
      if (!section) section = heading.parentElement?.parentElement || null;
      for (let step = 0; step < 3 && section; step++, section = section.parentElement) {
        const content = section.querySelector('.itemsContainer, emby-itemscontainer, [is="emby-itemscontainer"]');
        if (content && content.querySelector('.card, .libraryCard, .homeLibraryTile')) return content;
      }
    }
    return null;
  }

  function referenceCard(container) {
    return Array.from(container.children).find(child =>
      child.id !== TILE_ID && child.matches?.('.card, .libraryCard, .homeLibraryTile')
    ) || container.querySelector('.card:not(#' + TILE_ID + ')');
  }

  // Intentionally NO dimensions are assigned here. Jellyfin's native library
  // cards already have responsive width, flex-basis, inner padding and margins.
  // Cloning the card and then forcing its measured outer width creates the
  // extra horizontal spacing visible in My Media on desktop and Android.

  function syncNativeInlineStyles(tile, reference) {
    // Copy ONLY explicit inline dimensions, never calculated outer widths.
    // Themes set their card sizes with CSS; the clone already inherits those.
    // Some third-party themes/clients update inline sizes during resize.
    const copy = (from, to, properties) => {
      if (!from || !to) return;
      for (const property of properties) {
        const next = from.style.getPropertyValue(property);
        if (to.style.getPropertyValue(property) !== next) {
          if (next) to.style.setProperty(property, next, from.style.getPropertyPriority(property));
          else to.style.removeProperty(property);
        }
      }
    };
    copy(reference, tile, ['width','min-width','max-width','flex-basis','height']);
    copy(reference.querySelector('.cardScalable'), tile.querySelector('.cardScalable'),
      ['width','min-width','max-width','height','min-height','max-height','aspect-ratio']);
  }

  // Match the visible Collections library card, regardless of user library order.
  // Do not rely on its image filename or on a hard-coded array index.
  function findCollectionsCard(container) {
    for (const card of Array.from(container.children)) {
      if (card.id === TILE_ID || !card.matches?.('.card, .libraryCard, .homeLibraryTile')) continue;
      const labels = [card.getAttribute('aria-label'), card.getAttribute('title')];
      card.querySelectorAll('.cardText, .cardText-first, .cardText-primary, .cardText-secondary, .cardTextContainer, .libraryName, span')
        .forEach(el => labels.push(el.textContent));
      // Some Jellyfin themes have no conventional card text class.
      labels.push(card.textContent);
      if (labels.some(label => (label || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'collections')) return card;
    }
    return null;
  }

  function placeTile(container,tile) {
    const collections = findCollectionsCard(container);
    if (collections) {
      // If already correctly placed, make no DOM changes (MutationObserver safe).
      if (collections.nextElementSibling !== tile) {
        container.insertBefore(tile, collections.nextElementSibling);
      }
    } else if (container.lastElementChild !== tile) {
      // A missing Collections library must never hide the Franchises card.
      container.appendChild(tile);
    }
  }

  function makeTile(reference) {
    // Clone the genuine Jellyfin library card (prefer Collections, otherwise
    // Movies/Shows) so native theme card sizing, spacing, and aspect ratio apply
    // equally on desktop and the mobile Android WebView.
    const tile = reference.cloneNode(true);
    tile.id = TILE_ID;
    tile.classList.add('fe-franchise-home-tile');
    tile.removeAttribute('href');
    tile.setAttribute('role','link');
    tile.setAttribute('tabindex','0');
    tile.setAttribute('aria-label','Open Franchises');
    tile.title = 'Franchises';
    for (const el of [tile,...tile.querySelectorAll('*')]) {
      // Do not copy native library item identifiers, links, or DOM ids.
      for(const attr of [...el.attributes]){
        if(attr.name === 'id' || attr.name === 'href' || attr.name === 'onclick' ||
           attr.name.startsWith('data-') || attr.name === 'aria-label') el.removeAttribute(attr.name);
      }
    }
    tile.id = TILE_ID;
    tile.setAttribute('aria-label','Open Franchises');
    tile.setAttribute('href',browseUrl());
    const imageHost=(tile.querySelector('.cardImageContainer')||tile.querySelector('.poster')||tile.querySelector('.cardImage')||tile.querySelector('.cardScalable'));
    const art=document.createElement('span');art.className='fe-tile-art';
    art.innerHTML='<span class="fe-tile-icon" aria-hidden="true">F</span><span class="fe-tile-art-title">Franchises</span>';
    if(imageHost){
      // Remove cloned Collections artwork and its inline background image,
      // but preserve native Jellyfin sizing scaffolding around this host.
      imageHost.style.backgroundImage = 'none';
      imageHost.replaceChildren(art);
      // Existing card scaffolding supplies its own aspect ratio.
      if(imageHost.matches('.cardScalable,.poster'))imageHost.style.position='relative';
    }else{
      tile.replaceChildren(art);
      art.style.position='relative';art.style.aspectRatio='16 / 9';
    }
    // Remove any stale native title labels (including theme-specific plain spans).
    for(const child of tile.querySelectorAll('span')){
      if(child!==imageHost && !imageHost?.contains(child) && child.childElementCount===0 &&
        (child.textContent||'').trim() === (reference.getAttribute('title')||'Collections'))child.remove();
    }
    const label=tile.querySelector('.cardText-first,.cardText-primary,.cardText,.libraryName');
    if(label && !imageHost?.contains(label)){
      label.textContent='Franchises';
      // Suppress any stale secondary native-library labels from the clone.
      tile.querySelectorAll('.cardText-secondary').forEach(el=>el.remove());
    }else{
      const text=document.createElement('span');text.className='cardText fe-tile-label';
      text.textContent='Franchises';text.style.cssText='display:block;text-align:center;';
      tile.append(text);
    }
    // Native Jellyfin delegates card activation on the container, so intercept
    // BEFORE the library's handler receives the cloned card click.
    const navigate=()=>window.location.assign(browseUrl());
    tile.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();navigate();},true);
    tile.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopImmediatePropagation();navigate();}
    },true);
    return tile;
  }

  function update() {
    queued = false;
    const container = findMyMediaContainer();
    if (!container) return;
    const ref = findCollectionsCard(container) || referenceCard(container);
    if (!ref) return;
    ensureStyle();
    let tile = document.getElementById(TILE_ID);
    if (tile && tile.parentElement !== container) {
      tile.remove();
      tile = null;
    }
    if (!tile) {
      tile = makeTile(ref);
      // Only the Franchises tile moves; original library cards stay untouched.
      placeTile(container,tile);
    } else {
      // Jellyfin can update its My Media row without recreating our tile.
      placeTile(container,tile);
    }
    syncNativeInlineStyles(tile, ref);
    if (typeof ResizeObserver === 'function' && observedCard !== ref) {
      observedResize?.disconnect();
      observedCard = ref;
      observedResize = new ResizeObserver(schedule);
      observedResize.observe(ref);
      const sourceScalable = ref.querySelector('.cardScalable');
      if (sourceScalable) observedResize.observe(sourceScalable);
    }
    tile.setAttribute('href',browseUrl());
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  const observer = new MutationObserver(schedule);
  const start = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('resize', schedule);
})();

/* v0.8 — Optional home-screen timeline resume and playback progress bridge.
 * This script runs only in an authenticated Jellyfin Web client. It cannot
 * intercept native client playback; supported clients should be tested before
 * relying on seamless unattended progress persistence.
 */
(function () {
  'use strict';
  if (window.__franchiseTimelineHomeLoaded) return;
  window.__franchiseTimelineHomeLoaded = true;
  const WIDGET_ID='franchise-timeline-resume';
  const serverPrefix=()=>{
    const match=(location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i);
    return match?match[1]:'';
  };
  let lastFetch=0,busy=false;
  function timelineResponse(raw){
    const record=value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return value;
      const result={};for(const [key,item] of Object.entries(value))result[key[0].toLowerCase()+key.slice(1)]=item;
      return result;
    };
    return Array.isArray(raw)?raw.map(record):record(raw);
  }
  function credential(){
    let servers=[];
    try{servers=JSON.parse(localStorage.getItem('jellyfin_credentials')||'{}').Servers||[];}catch(_){}
    const matching=servers.filter(s=>s.AccessToken&&s.UserId);
    return matching.find(s=>[s.ManualAddress,s.LocalAddress,s.RemoteAddress].some(a=>{
      try{return new URL(a).origin===location.origin;}catch(_){return false;}
    }))||(matching.length===1?matching[0]:null);
  }
  async function request(path,auth,options={}){
    const prefix=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
    const r=await fetch(prefix+path,{cache:'no-store',...options,
      headers:{Authorization:'MediaBrowser Token="'+auth.AccessToken+'"',...(options.headers||{})}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    if(r.status===204)return null;
    const value=await r.json();
    return path.startsWith('/FranchiseExplorer/TimelineState')?timelineResponse(value):value;
  }
  function findHomeAnchor(){
    const headers=[...document.querySelectorAll('h1,h2,h3,h4,.sectionTitle')];
    const anchor=headers.find(h=>(h.textContent||'').trim()==='Continue Watching');
    if(anchor)return anchor.closest('.verticalSection, .homeSection, section')||anchor.parentElement?.parentElement;
    const myMedia=headers.find(h=>(h.textContent||'').trim()==='My Media');
    return myMedia?.closest('.verticalSection, .homeSection, section')||null;
  }
  function makeHomeSection(states){
    let widget=document.getElementById(WIDGET_ID);
    const home=findHomeAnchor();if(!home?.parentNode)return;
    if(!widget){
      widget=document.createElement('section');widget.id=WIDGET_ID;
      widget.style.cssText='box-sizing:border-box;width:100%;padding:12px max(16px,3vw);min-width:0;color:#fff;';
      home.parentNode.insertBefore(widget,home.nextSibling);
    }
    const heading=document.createElement('h2');heading.textContent='Continue Your Franchises';heading.style.cssText='font-size:1.3rem;margin:8px 0 14px';
    const list=document.createElement('div');list.style.cssText='display:flex;gap:13px;flex-wrap:wrap;';
    for(const state of states.slice(0,8)){
      const link=document.createElement('a');link.href=serverPrefix()+'/FranchiseExplorer/Browse?timeline='+encodeURIComponent(state.rowId)+'&resume=1';
      link.style.cssText='display:block;flex:1 1 210px;max-width:320px;color:#fff;text-decoration:none;min-width:170px;border:1px solid #536270;border-radius:11px;background:#232c37;padding:14px';
      const name=document.createElement('strong');name.textContent=state.name||'Chronological Timeline';
      const sub=document.createElement('div');sub.style.cssText='color:#c9d2de;font-size:.82rem;margin:9px 0';
      const percent=state.total?100*(state.completedKeys||[]).length/state.total:0;
      const shown=percent>0&&percent<1?percent.toFixed(2):Math.round(percent);
      sub.textContent=shown+'% complete · '+(state.index+1)+' of '+state.total+' · Resume timeline';
      const bar=document.createElement('div');bar.style.cssText='height:6px;background:#3b4855;border-radius:8px;overflow:hidden';
      const fill=document.createElement('span');fill.style.cssText='display:block;background:#16b2c6;height:100%;width:'+Math.max(0,Math.min(100,percent))+'%';bar.append(fill);
      link.append(name,sub,bar);list.append(link);
    }
    widget.replaceChildren(heading,list);
  }
  async function tick(){
    if(busy||document.hidden||Date.now()-lastFetch<10000)return;
    busy=true;lastFetch=Date.now();
    try{
      const auth=credential();if(!auth)return;
      const states=await request('/FranchiseExplorer/TimelineState',auth);
      if(!Array.isArray(states))return;
      const active=states.filter(s=>s.total>0&&s.playbackMode!=='complete');
      if(findHomeAnchor()&&active.length)makeHomeSection(active);
      // Read-only dashboard: neither a stale browser session nor a queue skip
      // may overwrite a server-confirmed completion or mark skipped titles.
    }catch(e){/* The optional home integration must never break Jellyfin itself. */}
    finally{busy=false;}
  }
  setInterval(()=>void tick(),12000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void tick(),{once:true});
  else void tick();
})();


/* v0.8.1 — Native-player handoff for item cards.
 * A title card opens Jellyfin Web with feAutoPlay=1. The bridge waits for the
 * correct details page and clicks Jellyfin's own Play control. This avoids
 * bypassing Jellyfin's normal transcoding and codec negotiation.
 * The feature depends on Jellyfin Web's DOM and the installed JS Injector.
 */
(function(){
  'use strict';
  if(window.__franchiseAutoplayBridgeLoaded)return;
  window.__franchiseAutoplayBridgeLoaded=true;
  let currentKey='',attempts=0,scheduled=false,routeSettlingSince=0;
  const MAX_ATTEMPTS=36;
  function params(){
    const hash=location.hash||'';
    if(!/^#\/?details\?/i.test(hash))return null;
    const query=hash.slice(hash.indexOf('?')+1);
    const p=new URLSearchParams(query);
    if(p.get('feAutoPlay')!=='1'||!/^[a-f0-9-]{32,36}$/i.test(p.get('id')||''))return null;
    return p;
  }
  function clearMarker(p){
    const clean=new URLSearchParams(p);
    clean.delete('feAutoPlay');clean.delete('feSubs');clean.delete('feLocalTimeline');
    try { history.replaceState(history.state,'',location.pathname+location.search+'#/details?'+clean.toString()); }
    catch (_) { location.hash='#/details?'+clean.toString(); }
  }
  function disableBrowserTextTracks(){
    for(const video of document.querySelectorAll('video')){
      try{for(const track of video.textTracks||[])track.mode='disabled';}catch(_){/* Not all browsers expose tracks */}
    }
  }
  // A local timeline intent is written by the Franchises browser. The native
  // Jellyfin Web player must start first; 204 from /Sessions/Playing is never
  // enough. This verification is scoped to the authenticated Jellyfin user.
  const handoffPrefix='fe-local-timeline-v1:';
  let pendingCheck=false;
  let lastAutoplayItem='';
  let verifiedVideo = null;
  let completedVideoListener = null;
  function timelineResponse(raw){
    const record=value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return value;
      const result={};for(const [key,item] of Object.entries(value))result[key[0].toLowerCase()+key.slice(1)]=item;
      return result;
    };
    return Array.isArray(raw)?raw.map(record):record(raw);
  }
  function localCredentials(){
    try{
      const all=JSON.parse(localStorage.getItem('jellyfin_credentials')||'{}').Servers||[];
      return all.find(x=>x.UserId&&x.AccessToken&&
        [x.ManualAddress,x.LocalAddress,x.RemoteAddress].some(a=>{
          try{return new URL(a).origin===location.origin;}catch(_){return false;}
        }))||(all.length===1?all[0]:null);
    }catch(_){return null;}
  }
  function localIntent(auth){
    if(!auth?.UserId)return null;
    const key=handoffPrefix+String(auth.UserId).toLowerCase();
    try{
      const obj=JSON.parse(localStorage.getItem(key)||'null');
      if(!obj||obj.version!==1||Date.now()-obj.created>120000){localStorage.removeItem(key);return null;}
      return {key,...obj};
    }catch(_){localStorage.removeItem(key);return null;}
  }
  async function api(path,auth,options={}){
    const prefix=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
    const r=await fetch(prefix+path,{cache:'no-store',...options,
      headers:{Authorization:'MediaBrowser Token="'+auth.AccessToken+'"',...(options.headers||{})}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    if(r.status===204)return null;
    const value=await r.json();
    return path.startsWith('/FranchiseExplorer/TimelineState')?timelineResponse(value):value;
  }
  function itemMatch(a,b){return String(a||'').replace(/-/g,'').toLowerCase()===String(b||'').replace(/-/g,'').toLowerCase();}
  function deviceId(){return localStorage.getItem('_deviceId2')||localStorage.getItem('_deviceId')||'';}
  let localNoticeTimer=null;
  function showLocalNotice(message,ttl=0){
    let notice=document.getElementById('fe-local-playback-notice');
    if(!notice){
      notice=document.createElement('div');notice.id='fe-local-playback-notice';
      notice.setAttribute('role','alert');
      notice.style.cssText='position:fixed;z-index:2147483640;top:75px;left:12px;right:12px;max-width:670px;margin:auto;background:#2b2320;color:#ffdfb3;border:1px solid #d3a04b;border-radius:10px;padding:13px 16px;box-shadow:0 8px 30px #0009;font:14px/1.45 sans-serif';
      document.body.appendChild(notice);
    }
    notice.textContent=message;
    if(localNoticeTimer)clearTimeout(localNoticeTimer);
    if(ttl>0)localNoticeTimer=setTimeout(()=>{notice.remove();localNoticeTimer=null;},ttl);
  }
  function localVideoAdvancing(snapshot){
    // Verify a real rendering player. Session NowPlayingItem alone may refer
    // to a background/stale session, even when it reports an advancing clock.
    for(const video of document.querySelectorAll('video')){
      if(!video.paused && !video.ended && video.readyState>=2 && video.getClientRects().length){
        const time=Number(video.currentTime)||0;
        if(snapshot.has(video) && time-snapshot.get(video)>=0.4)return true;
        if(!snapshot.has(video))snapshot.set(video,time);
      }
    }
    return false;
  }
  async function confirmLocalTimeline(expectedId){
    if(pendingCheck)return;
    pendingCheck=true;
    try{
      const auth=localCredentials();const intent=localIntent(auth);
      if(!intent||!itemMatch(intent.expectedId,expectedId))return;
      let started=null;
      const idOfThisDevice=deviceId();
      const videoStart=new Map();
      const firstTicks=new Map();
      for(let i=0;i<24;i++){
        await new Promise(resolve=>setTimeout(resolve,750));
        const videoAdvancing=localVideoAdvancing(videoStart);
        const sessions=await api('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
        const matchingItems=(sessions||[]).filter(s=>
          itemMatch(s.UserId,auth.UserId)
          &&itemMatch(s.NowPlayingItem?.Id,expectedId));
        const directMatch=matchingItems.filter(s=>idOfThisDevice && String(s.DeviceId||'')===idOfThisDevice);
        // Some WebView/JS Injector versions use a different localStorage
        // device-id key than the server's Session.DeviceId. If exactly ONE
        // user session plays this item and a *visible local video* advances,
        // the local video is stronger evidence than an out-of-date device id.
        // Never guess if multiple same-title sessions are connected.
        const matches=directMatch.length?directMatch:
          (videoAdvancing && matchingItems.length===1?matchingItems:[]);
        for(const session of matches){
          const position=Number(session.PlayState?.PositionTicks)||0;
          const previous=firstTicks.get(session.Id);
          if(previous===undefined)firstTicks.set(session.Id,position);
          const advancing=previous!==undefined && position-previous>5000000;
          const paused=!!session.PlayState?.IsPaused;
          // Browser mode requires a *visible, advancing local video*. In a
          // native Android player, same-device server progress may be the only
          // accessible signal: never accept a Chrome session from elsewhere.
          const nativePlayer=/jellyfin for android|android/i.test(session.Client||'')
            &&idOfThisDevice && String(session.DeviceId||'')===idOfThisDevice;
          if(!paused&&advancing&&(videoAdvancing||nativePlayer)){started=session;break;}
        }
        if(started)break;
      }
      if(!started){
        const msg='Franchise Explorer could not verify video playback on THIS device. Timeline history was not changed. If Jellyfin opened details only, press its normal Play button. Local browser playback must actually start before chronology can advance.';
        console.warn(msg);
        showLocalNotice(msg);
        // Preserve the expiring intent to allow manual Play to succeed.
        return;
      }
      // If the intent is an independent replay, no timeline cursor/history is
      // changed. Ordinary Jellyfin watched progress may still be affected.
      if(!intent.replayOnly){
        // Atomic confirmation: never overwrite completion/index/position if
        // Jellyfin's own PlaybackStart already activated or advanced this row.
        var activeState=await api('/FranchiseExplorer/TimelineState/'+encodeURIComponent(intent.rowId)+'/Activate',auth,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sessionId:started.Id,itemId:expectedId})});
      }
      localStorage.removeItem(intent.key);
      lastAutoplayItem=expectedId;
      if(!intent.replayOnly){
        console.info('Franchise Explorer: timeline tracking activated after verified playback',intent.rowId,started.Id);
        showLocalNotice('Chronological timeline tracking is active on this player.',4500);
      }
      if(!intent.replayOnly){
        const owner={rowId:intent.rowId,created:Date.now(),subtitleEnabled:intent.subtitleEnabled,
          sessionId:started.Id,lastItemId:expectedId,
          verifiedState:activeState};
        localStorage.setItem('fe-local-follow-v1:'+String(auth.UserId).toLowerCase(),JSON.stringify(owner));
        attachVerifiedEndHandler(auth,owner);
      }
    }catch(e){
      console.warn('Franchise Explorer: could not verify or activate local timeline playback:',e);
      showLocalNotice('The movie may be playing, but timeline activation could not be confirmed ('+(e.message||e)+'). Check Franchise Explorer timeline status before relying on auto-next.',12000);
    }
    finally{pendingCheck=false;}
  }
  // Record a short-lived completion signal BEFORE invoking the server.
  // Jellyfin Web sometimes destroys the video element and navigates back to
  // details while the completion POST is still in flight. This signal is not
  // itself watched history; only the authenticated server update can advance it.
  const completionKey=auth=>'fe-local-completion-v1:'+String(auth.UserId).toLowerCase();
  let completionPersistBusy=false;
  async function persistVerifiedCompletion(auth,owner){
    if(!auth?.UserId || !owner?.rowId || !owner?.sessionId || !owner?.lastItemId)return null;
    const key=completionKey(auth);
    localStorage.setItem(key,JSON.stringify({rowId:owner.rowId,sessionId:owner.sessionId,
      lastItemId:owner.lastItemId,created:Date.now()}));
    return retryVerifiedCompletion(auth);
  }
  async function retryVerifiedCompletion(auth){
    if(completionPersistBusy || !auth?.UserId)return null;
    const key=completionKey(auth);let proof;
    try{proof=JSON.parse(localStorage.getItem(key)||'null');}catch(_){localStorage.removeItem(key);return null;}
    if(!proof)return null;
    if(Date.now()-proof.created>120000){localStorage.removeItem(key);return null;}
    completionPersistBusy=true;
    try{
      const owner=JSON.parse(localStorage.getItem('fe-local-follow-v1:'+String(auth.UserId).toLowerCase())||'null');
      if(!owner || owner.rowId!==proof.rowId || owner.sessionId!==proof.sessionId ||
        !itemMatch(owner.lastItemId,proof.lastItemId)){
        localStorage.removeItem(key);return null;
      }
      let state;
      try{
        state=await api('/FranchiseExplorer/TimelineState/'+encodeURIComponent(proof.rowId)+'/Complete',auth,{
          method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sessionId:proof.sessionId,itemId:proof.lastItemId})});
      }catch(error){
        // Do not replay an older browser snapshot over server state. The
        // server-side PlaybackStopped listener is authoritative and retries
        // can only act against the currently matched session and item.
        throw error;
      }
      localStorage.removeItem(key);
      if(state?.pendingAutoAdvanceUtc)void followLocalTimeline();
      return state;
    }catch(error){
      console.warn('Franchise Explorer: confirmed end, but timeline completion needs retry:',error);
      // Retry on the details page; do not silently discard a real end event.
      return null;
    }finally{completionPersistBusy=false;}
  }
  // A real HTML5 ended event is stronger evidence than a Jellyfin session
  // disappearing. It is attached only to a locally verified video element.
  function attachVerifiedEndHandler(auth,owner){
    if(verifiedVideo && completedVideoListener)verifiedVideo.removeEventListener('ended',completedVideoListener);
    verifiedVideo=[...document.querySelectorAll('video')].find(v=>!v.paused && v.getClientRects().length)||null;
    completedVideoListener=null;
    if(!verifiedVideo)return; // Native players may rely on server completion events.
    const video=verifiedVideo;
    completedVideoListener=async()=>{
      if(verifiedVideo!==video || !video.ended)return;
      const key='fe-local-follow-v1:'+String(auth.UserId).toLowerCase();
      const current=JSON.parse(localStorage.getItem(key)||'null');
      if(!current || current.rowId!==owner.rowId || current.sessionId!==owner.sessionId ||
        !itemMatch(current.lastItemId,owner.lastItemId))return;
      try{
        // If unrelated playback has taken over the session, never auto-skip it.
        const sessions=await api('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
        const session=(sessions||[]).find(s=>s.Id===owner.sessionId);
        if(session?.NowPlayingItem?.Id && !itemMatch(session.NowPlayingItem.Id,owner.lastItemId))return;
        await persistVerifiedCompletion(auth,owner);
      }catch(e){console.debug('Franchise Explorer: ended-video handoff unavailable',e);}
    };
    video.addEventListener('ended',completedVideoListener,{once:true});
  }
  // The player may replace its <video> element after verification. Register
  // a capture-phase ended handler in addition to the exact-node listener;
  // only a genuine video-ended event belonging to the verified local session
  // can complete the timeline. The server endpoint is idempotent.
  let completionBusy=false;
  document.addEventListener('ended',async event=>{
    const video=event.target;
    if(!(video instanceof HTMLVideoElement) || completionBusy || !video.ended ||
       !Number.isFinite(video.duration) || video.duration<1 ||
       video.currentTime<video.duration-1.5)return;
    const auth=localCredentials();if(!auth?.UserId)return;
    const ownerKey='fe-local-follow-v1:'+String(auth.UserId).toLowerCase();
    let owner;try{owner=JSON.parse(localStorage.getItem(ownerKey)||'null');}catch(_){return;}
    if(!owner?.rowId || !owner.sessionId || Date.now()-owner.created>86400000)return;
    // The verified video is the strongest association with this play session.
    // The fallback handles player DOM replacement only if the server still
    // identifies the exact expected item in the expected session.
    completionBusy=true;
    try{
      const sessions=await api('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
      const session=(sessions||[]).find(s=>s.Id===owner.sessionId);
      if(video!==verifiedVideo && !itemMatch(session?.NowPlayingItem?.Id,owner.lastItemId))return;
      if(session?.NowPlayingItem?.Id && !itemMatch(session.NowPlayingItem.Id,owner.lastItemId))return;
      await persistVerifiedCompletion(auth,owner);
    }catch(e){console.debug('Franchise Explorer completed-video event:',e);}
    finally{completionBusy=false;}
  },true);

  // Jellyfin Web may remove its <video> before the browser dispatches ended,
  // or navigate back to the movie details page as playback finishes. Observe
  // the final playing frames *before* teardown as a last-resort completion
  // signal. This does NOT fire on ordinary stop, pause, Back, or a seek alone:
  // it needs uninterrupted forward playback in the final few seconds and an
  // exact verified user/session/item match before committing completion.
  const nearEndSamples=new WeakMap();
  document.addEventListener('seeking',event=>{
    if(event.target instanceof HTMLVideoElement)nearEndSamples.delete(event.target);
  },true);
  document.addEventListener('timeupdate',event=>{
    const video=event.target;
    if(!(video instanceof HTMLVideoElement)||video.paused||video.seeking||video.ended||completionBusy)return;
    if(!Number.isFinite(video.duration)||video.duration<60||!Number.isFinite(video.currentTime))return;
    const remaining=video.duration-video.currentTime;
    if(remaining>4||remaining < -1){nearEndSamples.delete(video);return;}
    const auth=localCredentials();if(!auth?.UserId)return;
    const ownerKey='fe-local-follow-v1:'+String(auth.UserId).toLowerCase();
    let owner;try{owner=JSON.parse(localStorage.getItem(ownerKey)||'null');}catch(_){return;}
    if(!owner?.rowId||!owner.sessionId||Date.now()-owner.created>86400000)return;
    let sample=nearEndSamples.get(video);
    if(!sample){sample={last:video.currentTime,advanced:0,ownerId:owner.lastItemId};nearEndSamples.set(video,sample);return;}
    if(!itemMatch(sample.ownerId,owner.lastItemId)){nearEndSamples.delete(video);return;}
    const movement=video.currentTime-sample.last;
    sample.last=video.currentTime;
    if(movement>0&&movement<1.5)sample.advanced+=movement;
    if(remaining>0.30||sample.advanced<0.6)return;
    completionBusy=true;
    (async()=>{
      try{
        const sessions=await api('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
        const session=(sessions||[]).find(s=>s.Id===owner.sessionId);
        // Do not complete an unrelated video, even if it happens to finish.
        if(!session || !itemMatch(session.NowPlayingItem?.Id,owner.lastItemId))return;
        if(video!==verifiedVideo && verifiedVideo?.isConnected && !verifiedVideo.ended)return;
        await persistVerifiedCompletion(auth,owner);
        console.info('Franchise Explorer: verified final playback frames; recorded completion signal',owner.rowId);
      }catch(error){console.debug('Franchise Explorer: final-frame completion fallback unavailable',error);}
      finally{completionBusy=false;nearEndSamples.delete(video);}
    })();
  },true);

  function isVisible(el){return !!(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');}
  function startIfReady(){
    scheduled=false;
    const p=params();if(!p){currentKey='';attempts=0;return;}
    const id=p.get('id');
    const key=id+'|'+(p.get('feSubs')||'0');
    if(currentKey!==key){currentKey=key;attempts=0;routeSettlingSince=Date.now();}
    // On a programmatic transition the previous movie's Play button may still
    // be visible for a moment. Do not click it before Jellyfin has had time
    // to replace the details view for the *new* requested media ID.
    if(Date.now()-routeSettlingSince<600){setTimeout(schedule,250);return;}
    // Jellyfin Web renders the details page asynchronously. Wait for a visible
    // Play control; never click an element in a hidden/previous item page.
    const root=[...document.querySelectorAll('.page, .mainAnimatedPage, main')]
      .filter(isVisible).reverse().find(x=>x.querySelector('.btnPlay,button[data-action="play"],button[data-action="resume"]'));
    const play=root?.querySelector('.btnPlay,button[data-action="play"],button[data-action="resume"]');
    if(play&&isVisible(play)){
      const subs=p.get('feSubs')==='1';
      const isTimeline=p.get('feLocalTimeline')==='1';
      clearMarker(p);currentKey='';attempts=0;
      // The correct details page is visible; disarm route recovery before
      // Jellyfin starts its native player and changes the URL.
      if(isTimeline){
        const auth=localCredentials();const intent=localIntent(auth);
        if(intent && itemMatch(intent.expectedId,id)){
          intent.routePending=false;
          localStorage.setItem(intent.key,JSON.stringify(intent));
        }
      }
      play.click();
      if(isTimeline)void confirmLocalTimeline(id);
      if(!subs){
        // Best-effort web text-track suppression: Jellyfin settings and
        // separately rendered subtitle formats can override this.
        for(const t of [800,2000,4500])setTimeout(disableBrowserTextTracks,t);
      }
      return;
    }
    attempts++;
    if(attempts<MAX_ATTEMPTS)setTimeout(schedule,250);
    else{
      // Give users a clear fallback rather than an endless silent attempt.
      console.warn('Franchise Explorer: Jellyfin Web did not expose its Play button. Open item details and choose Play manually.');
      clearMarker(p);currentKey='';attempts=0;
    }
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(startIfReady);}
  // Follow the saved timeline after Jellyfin server events advance its
  // cursor. Guard against jumping when unrelated playback is active.
  let localFollowBusy=false,lastFollowKey='';
  async function followLocalTimeline(){
    if(localFollowBusy||params()||document.hidden||localIntent(localCredentials()))return;
    const auth=localCredentials();if(!auth?.UserId)return;
    localFollowBusy=true;
    try{
      const localKey='fe-local-follow-v1:'+String(auth.UserId).toLowerCase();
      const owner=JSON.parse(localStorage.getItem(localKey)||'null');
      if(!owner?.rowId||!owner.sessionId||Date.now()-owner.created>86400000)return;
      const states=await api('/FranchiseExplorer/TimelineState',auth);
      const state=(states||[]).find(x=>x.rowId===owner.rowId && x.playbackMode==='playing'
        && x.sessionId===owner.sessionId && x.queueKeys?.length);
      if(!state?.pendingAutoAdvanceUtc)return;
      console.info('Franchise Explorer: completed timeline entry detected; starting next media',
        {rowId:owner.rowId,index:state.index,sessionId:owner.sessionId});
      const index=state.index;
      if(index<1 || index>=state.queueKeys.length)return;
      // Only respond to a fresh, explicit completion of the previous item.
      const when=Date.parse(state.pendingAutoAdvanceUtc);
      if(!Number.isFinite(when) || Date.now()-when>120000 || when>Date.now()+5000)return;
      const from=state.queueKeys[index-1];
      const to=state.queueKeys[index];
      if(from!==state.pendingAutoAdvanceFromKey || to!==state.pendingAutoAdvanceToKey)return;
      const prior=from.split(':').pop(),next=to.split(':').pop();
      if(!itemMatch(prior,owner.lastItemId) || itemMatch(next,prior))return;
      const sessions=await api('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
      const session=(sessions||[]).find(s=>s.Id===owner.sessionId);
      // Jellyfin may have REMOVED the previous item from Now Playing after it
      // ended. This is expected. Refuse only if a different item is active.
      if(session?.NowPlayingItem?.Id && !itemMatch(session.NowPlayingItem.Id,prior))return;
      const key=state.rowId+':'+index;
      if(lastFollowKey===key)return;
      lastFollowKey=key;
      const intent={version:1,created:Date.now(),rowId:state.rowId,expectedId:next,
        routePending:true,navigationAttempts:0,
        state:{...state,itemId:next,sessionId:'',playbackMode:'paused',
          pendingAutoAdvanceUtc:null,pendingAutoAdvanceFromKey:'',pendingAutoAdvanceToKey:''},
        replayOnly:false,subtitleEnabled:!!owner.subtitleEnabled};
      localStorage.setItem(handoffPrefix+String(auth.UserId).toLowerCase(),JSON.stringify(intent));
      // Jellyfin may still be navigating back to the previous title's details
      // after the video closes. A simple hash mutation loses that race.
      // Reload the official Jellyfin Web route so the native Play handoff
      // starts on a fresh details view; the short-lived intent survives reload.
      const nextRoute='#/details?id='+encodeURIComponent(next)+
        '&feAutoPlay=1&feLocalTimeline=1&feSubs='+(owner.subtitleEnabled?'1':'0');
      if(location.protocol==='http:' || location.protocol==='https:'){
        const webRoot=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
        location.assign(webRoot+'/web/index.html'+nextRoute);
      }else{
        location.hash=nextRoute; // offline browser mocks
      }
    }catch(e){console.warn('Franchise Explorer: automatic local transition unavailable:',e);showLocalNotice('Franchise Explorer could not start the next timeline item automatically. Resume the timeline from Franchises. Details: '+(e.message||e),13000);}
    finally{localFollowBusy=false;}
  }
  const pollFollow=()=>{const auth=localCredentials();if(auth)void retryVerifiedCompletion(auth);
    void followLocalTimeline();};
  // If Jellyfin closes the previous player and overwrites our next-title
  // route, recover the pending navigation rather than leaving the user on the
  // previous movie's details page. Never redirect after the intended Play
  // button has been clicked, or when a video is visibly playing.
  function repairPendingRoute(){
    const auth=localCredentials();const intent=localIntent(auth);
    if(!intent?.routePending || params() || Date.now()-intent.created>15000)return;
    if((intent.navigationAttempts||0)>=2)return;
    if([...document.querySelectorAll('video')].some(v=>!v.paused && !v.ended && v.getClientRects().length))return;
    const p=new URLSearchParams((location.hash||'').split('?')[1]||'');
    const onCorrectDetails=itemMatch(p.get('id'),intent.expectedId);
    // Wait briefly for Jellyfin's own hash routing to settle before fixing it.
    if(intent.navigationAttempts===0 && Date.now()-intent.created<1800)return;
    intent.navigationAttempts=(intent.navigationAttempts||0)+1;
    localStorage.setItem(intent.key,JSON.stringify(intent));
    const route='#/details?id='+encodeURIComponent(intent.expectedId)+
      '&feAutoPlay=1&feLocalTimeline=1&feSubs='+(intent.subtitleEnabled?'1':'0');
    console.info('Franchise Explorer: restoring interrupted next-title route',
      {rowId:intent.rowId,attempt:intent.navigationAttempts,onCorrectDetails});
    location.hash=route;
  }
  setInterval(()=>{pollFollow();repairPendingRoute();},2000);
  addEventListener('pageshow',pollFollow);
  addEventListener('focus',pollFollow);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollFollow();});
  // Manual Play fallback: a user may start the media from the details page
  // if this Jellyfin Web build doesn't expose a compatible Play button.
  setInterval(()=>{const auth=localCredentials();const intent=localIntent(auth);
    if(intent && !params())void confirmLocalTimeline(intent.expectedId);
  },5000);
  const observer=new MutationObserver(()=>{if(params())schedule();});
  const init=()=>{
    observer.observe(document.body,{subtree:true,childList:true});
    addEventListener('hashchange',schedule);
    schedule();
  };
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
