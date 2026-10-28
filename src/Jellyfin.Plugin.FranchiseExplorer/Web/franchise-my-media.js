/*
 * Jellyfin Franchise Explorer — opt-in Jellyfin Web integration (v0.7.2).
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
      #${TILE_ID} {
        display: block; position: relative; box-sizing: border-box;
        flex: 0 0 auto; min-width: 0; max-width: 45vw;
        color: inherit; cursor: pointer; text-decoration: none;
        -webkit-tap-highlight-color: transparent;
      }
      #${TILE_ID} .fe-tile-art {
        position: relative; width: 100%; aspect-ratio: 16 / 9;
        overflow: hidden; border-radius: 4px;
        background: linear-gradient(138deg, #142e3c 0%, #164a59 49%, #063644 100%);
        display: flex; align-items: center; justify-content: center;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.07);
      }
      #${TILE_ID} .fe-tile-art::before,
      #${TILE_ID} .fe-tile-art::after {
        content: ''; position: absolute; width: 66%; aspect-ratio: 1;
        border: 1px solid rgba(115,225,240,.20);
        border-radius: 24%; transform: rotate(30deg);
      }
      #${TILE_ID} .fe-tile-art::after {
        width: 44%; border-color: rgba(115,225,240,.30); transform: rotate(-22deg);
      }
      #${TILE_ID} .fe-tile-icon {
        position: relative; z-index: 1; color: #c4f5fa;
        font-family: Arial, sans-serif; font-size: clamp(26px, 3vw, 50px);
        font-weight: 750; letter-spacing: -.08em;
      }
      #${TILE_ID} .fe-tile-art-title {
        position: absolute; z-index: 1; left: 0; right: 0; bottom: 9%;
        text-align: center; color: #fff; font-weight: 700;
        font-size: clamp(14px, 1.4vw, 23px); line-height: 1.3;
        text-shadow: 0 2px 5px rgba(0,0,0,.65);
      }
      #${TILE_ID} .fe-tile-label {
        display: block; text-align: center; padding-top: 7px;
        font-size: clamp(11px, .9vw, 14px); line-height: 1.4;
        color: inherit; overflow: hidden; text-overflow: ellipsis;
      }
      #${TILE_ID}:hover .fe-tile-art,
      #${TILE_ID}:focus-visible .fe-tile-art {
        outline: 2px solid var(--theme-primary-color, #00a6bb);
        outline-offset: 2px; filter: brightness(1.13);
      }
      #${TILE_ID}:focus-visible { outline: none; }
      @media (max-width: 540px) {
        #${TILE_ID} .fe-tile-icon { font-size: 26px; }
        #${TILE_ID} .fe-tile-art-title { font-size: 13px; }
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

  function fitTile(tile, reference) {
    if (!reference) return;
    const box = reference.getBoundingClientRect();
    const computed = window.getComputedStyle(reference);
    const width = box.width || parseFloat(computed.width) || 240;
    if (Number.isFinite(width) && width >= 90 && width <= 800) {
      tile.style.width = `${Math.round(width)}px`;
      tile.style.flexBasis = `${Math.round(width)}px`;
    }
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
    const tile = document.createElement('a');
    tile.id = TILE_ID;
    // Reuse Jellyfin's card class only for integration with the scroller.
    tile.className = 'card fe-franchise-home-tile';
    tile.href = browseUrl();
    tile.setAttribute('aria-label', 'Open Franchises');
    tile.title = 'Franchises';
    tile.innerHTML = '<span class="fe-tile-art"><span class="fe-tile-icon" aria-hidden="true">F</span><span class="fe-tile-art-title">Franchises</span></span><span class="fe-tile-label">Franchises</span>';
    fitTile(tile, reference);
    // Jellyfin handles native cards with delegated listeners. Keep this card's
    // activation independent so a fake media ID is never sent to Jellyfin.
    tile.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    tile.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(tile.href);
      }
    });
    return tile;
  }

  function update() {
    queued = false;
    const container = findMyMediaContainer();
    if (!container) return;
    const ref = referenceCard(container);
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
    fitTile(tile, ref);
    tile.href = browseUrl();
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
  function credential(){
    let servers=[];
    try{servers=JSON.parse(localStorage.getItem('jellyfin_credentials')||'{}').Servers||[];}catch(_){}
    const matching=servers.filter(s=>s.AccessToken&&s.UserId);
    return matching.find(s=>[s.ManualAddress,s.LocalAddress,s.RemoteAddress].some(a=>{
      try{return new URL(a).origin===location.origin;}catch(_){return false;}
    }))||(matching.length===1?matching[0]:null);
  }
  async function request(path,auth,options={}){
    const r=await fetch(serverPrefix()+path,{cache:'no-store',...options,
      headers:{Authorization:'MediaBrowser Token="'+auth.AccessToken+'"',...(options.headers||{})}});
    if(!r.ok)throw new Error('HTTP '+r.status);return r.status===204?null:r.json();
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
      const percent=state.total?Math.round(100*(state.completedKeys||[]).length/state.total):0;
      sub.textContent=percent+'% complete · '+(state.index+1)+' of '+state.total+' · Resume timeline';
      const bar=document.createElement('div');bar.style.cssText='height:6px;background:#3b4855;border-radius:8px;overflow:hidden';
      const fill=document.createElement('span');fill.style.cssText='display:block;background:#16b2c6;height:100%;width:'+Math.max(0,Math.min(100,percent))+'%';bar.append(fill);
      link.append(name,sub,bar);list.append(link);
    }
    widget.replaceChildren(heading,list);
  }
  async function updateProgress(auth,states){
    const active=states.filter(x=>x.playbackMode==='playing'&&x.sessionId&&Array.isArray(x.queueKeys));
    if(!active.length)return;
    const sessions=await request('/Sessions?ControllableByUserId='+encodeURIComponent(auth.UserId),auth);
    for(const state of active){
      const session=(sessions||[]).find(s=>s.Id===state.sessionId&&String(s.UserId||'').toLowerCase()===String(auth.UserId).toLowerCase());
      if(!session?.NowPlayingItem?.Id)continue;
      const id=String(session.NowPlayingItem.Id).toLowerCase();
      const current=state.queueKeys.findIndex((key,i)=>i>=state.index&&key.toLowerCase().endsWith(':'+id));
      if(current<0)continue; // Do not move the timeline when watching unrelated content.
      let changed=false;
      if(current>state.index){
        for(let i=state.index;i<current;i++)state.completedKeys.push(state.queueKeys[i]);
        state.index=current;changed=true;
      }
      const ticks=Number(session.PlayState?.PositionTicks)||0;
      if(Math.abs(ticks-(state.positionTicks||0))>25000000){state.positionTicks=ticks;changed=true;}
      if(changed){
        state.completedKeys=[...new Set(state.completedKeys)];state.itemId=id;
        await request('/FranchiseExplorer/TimelineState/'+encodeURIComponent(state.rowId),auth,{
          method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
      }
    }
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
      // Jellyfin server playback events update persistent progress, even when
      // this optional home widget is closed. The browser only displays it.
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
  let currentKey='',attempts=0,scheduled=false;
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
    clean.delete('feAutoPlay');clean.delete('feSubs');
    try { history.replaceState(history.state,'',location.pathname+location.search+'#/details?'+clean.toString()); }
    catch (_) { location.hash='#/details?'+clean.toString(); }
  }
  function disableBrowserTextTracks(){
    for(const video of document.querySelectorAll('video')){
      try{for(const track of video.textTracks||[])track.mode='disabled';}catch(_){/* Not all browsers expose tracks */}
    }
  }
  function isVisible(el){return !!(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');}
  function startIfReady(){
    scheduled=false;
    const p=params();if(!p){currentKey='';attempts=0;return;}
    const id=p.get('id');
    const key=id+'|'+(p.get('feSubs')||'0');
    if(currentKey!==key){currentKey=key;attempts=0;}
    // Jellyfin Web renders the details page asynchronously. Wait for a visible
    // Play control; never click an element in a hidden/previous item page.
    const root=[...document.querySelectorAll('.page, .mainAnimatedPage, main')]
      .filter(isVisible).reverse().find(x=>x.querySelector('.btnPlay,button[data-action="play"],button[data-action="resume"]'));
    const play=root?.querySelector('.btnPlay,button[data-action="play"],button[data-action="resume"]');
    if(play&&isVisible(play)){
      const subs=p.get('feSubs')==='1';
      clearMarker(p);currentKey='';attempts=0;
      play.click();
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
  const observer=new MutationObserver(()=>{if(params())schedule();});
  const init=()=>{
    observer.observe(document.body,{subtree:true,childList:true});
    addEventListener('hashchange',schedule);
    schedule();
  };
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
