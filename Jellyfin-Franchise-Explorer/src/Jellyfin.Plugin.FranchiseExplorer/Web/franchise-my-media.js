/*
 * Jellyfin Franchise Explorer — opt-in Jellyfin Web integration (v0.8.9.13).
 * Adds ONE visual link in the existing "My Media" row. It does not create a
 * Jellyfin library, alter user preferences, or modify the server's media.
 * Requires a compatible JavaScript injector to run in jellyfin-web.
 * The script never sends authentication tokens or user information anywhere.
 */
(function () {
  'use strict';

  // Programmatic registration plus a manual fallback must not create two observers.
  window.__franchiseExplorerUiVersion = '0.8.9.13';
  if (window.__franchiseExplorerMyMediaTileLoaded) return;
  window.__franchiseExplorerMyMediaTileLoaded = true;
  // Replaced with a data URI when registered by the plugin host service.
  const TILE_ART_DATA = '__FE_TILE_ART_DATA_URL__';

  const TILE_ID = 'franchise-explorer-my-media-tile';
  const STYLE_ID = 'franchise-explorer-my-media-style';
  let queued = false;
  let observedCard = null;
  let observedResize = null;
  let activeSettingsMenu = null;

  function browseUrl() {
    // Keep Jellyfin base-path prefixes (e.g. /jellyfin/web/index.html).
    const pathname = window.location.pathname || '';
    const match = pathname.match(/^(.*?)\/web(?:\/|$)/i);
    const base = match ? match[1] : '';
    return `${base}/FranchiseExplorer/Browse`;
  }

  function settingsUrl() {
    const match = (window.location.pathname || '').match(/^(.*?)\/web(?:\/|$)/i);
    const base = match ? match[1] : '';
    return base + '/web/index.html#/configurationpage?name=Franchise%20Explorer';
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
        background-size:cover;background-position:center center;
        pointer-events:none;
      }
      #${TILE_ID} .fe-tile-icon {
        display:block!important;position:absolute;left:50%;top:43%;
        transform:translate(-50%,-50%);margin:0!important;padding:0!important;
        color:#cbf7fa;font:bold clamp(32px,4vw,58px)/1 Arial,sans-serif;
        text-align:center;text-shadow:0 2px 5px #001c24;
      }
      #${TILE_ID} .fe-tile-art.fe-cinematic-art::before {
        content:"";position:absolute;inset:0;z-index:0;
        background:rgba(2,12,19,.27);backdrop-filter:blur(2px);
        pointer-events:none;
      }
      #${TILE_ID} .fe-tile-art-title {
        display:block!important;position:absolute;z-index:1;
        left:7px;right:7px;top:50%;bottom:auto;transform:translateY(-50%);
        margin:0!important;padding:0!important;text-align:center;color:white;
        font:bold clamp(18px,1.75vw,30px)/1.2 Arial,sans-serif;
        text-shadow:0 2px 6px #000,0 4px 14px #000;
      }
      #${TILE_ID} .fe-settings-holder {
        position:absolute;right:6px;bottom:3px;z-index:999;line-height:1;
        pointer-events:none!important;isolation:isolate;
      }
      #${TILE_ID}:hover .fe-settings-holder,
      #${TILE_ID}:focus-within .fe-settings-holder {pointer-events:auto!important;}
      #${TILE_ID} .fe-settings-toggle {
        display:flex;align-items:center;justify-content:center;width:28px;height:28px;
        border:0;border-radius:50%;background:transparent;color:white;cursor:pointer;
        font:bold 20px/1 Arial,sans-serif;text-shadow:0 1px 4px #001b25;
        opacity:0;pointer-events:none;transition:opacity .15s ease;
      }
      #${TILE_ID}:hover .fe-settings-toggle,
      #${TILE_ID}:focus-within .fe-settings-toggle,
      #${TILE_ID} .fe-settings-toggle[aria-expanded="true"] {opacity:1;pointer-events:auto;}
      @media(hover:none), (pointer:coarse) {
        #${TILE_ID} .fe-settings-holder {pointer-events:auto!important;}
        #${TILE_ID} .fe-settings-toggle {opacity:1;pointer-events:auto;}
      }
      #${TILE_ID} .fe-settings-toggle:hover,
      #${TILE_ID} .fe-settings-toggle:focus-visible {background:#075a71;outline:2px solid #74dcec;}
      #${TILE_ID} .fe-settings-menu {
        position:absolute;right:0;bottom:33px;min-width:224px;max-width:min(85vw,280px);padding:5px;
        background:#182430;color:#fff;border:1px solid #4b6878;border-radius:9px;
        box-shadow:0 8px 24px #000a;box-sizing:border-box;
      }
      #${TILE_ID} .fe-settings-menu[hidden] {display:none!important;}
      #${TILE_ID} .fe-settings-link {
        display:block;padding:11px 10px;color:#fff;text-decoration:none;
        font:600 13px/1.3 Arial,sans-serif;border-radius:6px;white-space:nowrap;
      }
      #${TILE_ID} .fe-settings-link:hover,
      #${TILE_ID} .fe-settings-link:focus-visible {background:#244a5a;outline:1px solid #53c9df;}
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
    tile.setAttribute('data-fe-version','0.8.9.13');
    tile.setAttribute('aria-label','Open Franchises');
    tile.setAttribute('href',browseUrl());
    // Native actions from a cloned Collections card cannot operate on the
    // virtual Franchises tile; supply a dedicated options menu instead.
    tile.querySelectorAll('.cardMenuButton,.cardOverlayButton,button').forEach(el=>el.remove());
    const imageHost=(tile.querySelector('.cardImageContainer')||tile.querySelector('.poster')||tile.querySelector('.cardImage')||tile.querySelector('.cardScalable'));
    const art=document.createElement('span');art.className='fe-tile-art';
    art.innerHTML='<span class="fe-tile-icon" aria-hidden="true">F</span><span class="fe-tile-art-title">Franchises</span>';
    if (TILE_ART_DATA.startsWith('data:image/')) {
      art.classList.add('fe-cinematic-art');
      art.style.backgroundImage='linear-gradient(0deg,rgba(0,9,17,.7),transparent 68%),url("'+TILE_ART_DATA+'")';
      art.querySelector('.fe-tile-icon')?.remove();
    }
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
    tile.style.position='relative';
    const controls=document.createElement('div');controls.className='fe-settings-holder';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='fe-settings-toggle';
    trigger.textContent='⋮';trigger.title='Franchises options';trigger.setAttribute('aria-label','Franchises options');
    trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    const menu=document.createElement('div');menu.className='fe-settings-menu';menu.hidden=true;
    menu.setAttribute('role','menu');
    const openBrowse=document.createElement('a');openBrowse.className='fe-settings-link';openBrowse.href=browseUrl();
    openBrowse.setAttribute('role','menuitem');openBrowse.textContent='▶  Open Franchises';
    const settings=document.createElement('a');settings.className='fe-settings-link';settings.href=settingsUrl();
    settings.setAttribute('role','menuitem');settings.textContent='⚙  Franchise Explorer Settings';
    // The visible artwork ends ABOVE Jellyfin's separate card caption.
    // Positioning against the outer card put the three dots below the image,
    // so anchor the menu to the image itself, like Jellyfin's native tiles.
    const controlsHost = imageHost || art;
    // Do not inspect computed styles until the clone is connected to the
    // document: disconnected nodes can report wrong theme positions.
    if (!imageHost) controlsHost.style.pointerEvents = 'auto';
    menu.append(openBrowse,settings);controls.append(trigger,menu);controlsHost.append(controls);
    const setOpen=open=>{
      if(open && activeSettingsMenu && activeSettingsMenu.controls!==controls)activeSettingsMenu.close();
      menu.hidden=!open;trigger.setAttribute('aria-expanded',open?'true':'false');
      if(open)activeSettingsMenu={controls,close:()=>setOpen(false)};
      else if(activeSettingsMenu?.controls===controls)activeSettingsMenu=null;
    };
    trigger.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();setOpen(menu.hidden);
    });
    trigger.addEventListener('keydown',event=>{
      if(event.key==='Escape'){setOpen(false);trigger.focus();}
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setOpen(true);settings.focus();}
    });
    openBrowse.addEventListener('click',event=>event.stopPropagation());
    settings.addEventListener('click',event=>event.stopPropagation());
    settings.addEventListener('keydown',event=>event.stopPropagation());
    menu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.focus();}
    });
    // Native Jellyfin delegates card activation on the container, so intercept
    // BEFORE the library's handler receives the cloned card click.
    const navigate=()=>window.location.assign(browseUrl());
    tile.addEventListener('click',e=>{
      if(e.target.closest?.('.fe-settings-holder'))return;
      e.preventDefault();e.stopImmediatePropagation();navigate();
    },true);
    tile.addEventListener('keydown',e=>{
      if(e.target.closest?.('.fe-settings-holder'))return;
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
    // Preserve native absolute image positioning if the theme uses it. Only
    // establish a positioning context for genuinely static image elements.
    const controlsHost=tile.querySelector('.fe-settings-holder')?.parentElement;
    if(controlsHost && window.getComputedStyle(controlsHost).position === 'static')
      controlsHost.style.position='relative';
    if (typeof ResizeObserver === 'function' && observedCard !== ref) {
      observedResize?.disconnect();
      observedCard = ref;
      observedResize = new ResizeObserver(schedule);
      observedResize.observe(ref);
      const sourceScalable = ref.querySelector('.cardScalable');
      if (sourceScalable) observedResize.observe(sourceScalable);
    }
    tile.setAttribute('href',browseUrl());
    tile.setAttribute('data-fe-version','0.8.9.13');
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  const observer = new MutationObserver(schedule);
  document.addEventListener('click',event=>{
    if(activeSettingsMenu &&
       (!activeSettingsMenu.controls.isConnected || !activeSettingsMenu.controls.contains(event.target)))
      activeSettingsMenu.close();
  },true);
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

/* v0.8.9.13 — Per-user franchise resume cards and in-place playback shortcuts on Jellyfin Web's home.
 * Jellyfin regularly replaces the home DOM, including after a refresh and
 * client-side navigation. Reattach the same widget rather than waiting for the
 * next API poll, and keep a short session-scoped cache for hard refreshes.
 * Neither this dashboard nor artwork loading changes playback/watched state.
 */
(function () {
  'use strict';
  // An older Injector script may still be running. Never let its shared v1
  // marker block the newer in-place playback actions from initializing.
  if (window.__franchiseTimelineHomeVersion === '0.8.9.13') return;
  window.__franchiseTimelineHomeVersion = '0.8.9.13';
  window.__franchiseTimelineHomeLoaded = true;
  const WIDGET_ID = 'franchise-timeline-resume';
  // Versioned styles take precedence if an earlier Injector script left its
  // stylesheet in the page before the new registration initialized.
  const STYLE_ID = 'franchise-timeline-resume-style-v08913';
  const NATIVE_HIDE_STYLE_ID = 'fe-native-franchise-row-filter-style';
  const NATIVE_HIDE_CLASS = 'fe-native-franchise-row-hidden';
  const CACHE_PREFIX = 'fe-franchise-home-v08913:';
  const MAX_CARDS = 8;
  const phonePortrait = () => window.matchMedia('(orientation: portrait) and (max-width: 700px)').matches;
  const GUID = /^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const serverPrefix = () => ((location.pathname || '').match(/^(.*?)\/web(?:\/|$)/i) || [,''])[1] || '';
  const serverPath = path => serverPrefix() + path;
  let lastFetch = 0, busy = false, queuedMount = false, cards = [], authScope = '', renderedSignature = '';
  let confirmedEmpty = false;
  let widget = null;
  let activeResumeMenu = null;
  const images = new Map();
  const itemCache = new Map();
  const nativeItemCache = new Map();
  let catalogCache = null, catalogFetched = 0;
  let nativeFilterSerial = 0;
  // Hide all linked items in an active franchise's saved watch order when the
  // user enables this setting. Hiding only the current cursor lets earlier
  // shows (e.g. Agent Carter) reappear after a timeline reset.
  let nativeTimelineTargets = new Set();

  function credential() {
    let servers = [];
    try { servers = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}').Servers || []; } catch (_) {}
    const available = servers.filter(s => s.AccessToken && s.UserId);
    return available.find(s => [s.ManualAddress, s.LocalAddress, s.RemoteAddress, s.LastConnectionAddress].some(a => {
      try { return new URL(a).origin === location.origin; } catch (_) { return false; }
    })) || (available.length === 1 ? available[0] : null);
  }

  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key[0].toLowerCase() + key.slice(1)] = item;
    return result;
  }
  async function request(path, auth) {
    const response = await fetch(serverPath(path), {
      cache: 'no-store',
      headers: { Authorization: 'MediaBrowser Token="' + auth.AccessToken + '"' }
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const json = await response.json();
    return path.startsWith('/FranchiseExplorer/TimelineState')
      ? (Array.isArray(json) ? json.map(normalize) : normalize(json)) : json;
  }

  function scopeFor(auth) {
    return CACHE_PREFIX + location.origin + ':' + String(auth.UserId || '').toLowerCase();
  }
  function restore(auth) {
    const next = auth ? scopeFor(auth) : '';
    if (authScope === next) return;
    authScope = next;
    cards = [];
    nativeTimelineTargets = new Set();
    confirmedEmpty = false;
    renderedSignature = '';
    if (widget) { widget.remove(); widget = null; }
    for (const url of images.values()) if (typeof url === 'string') URL.revokeObjectURL(url);
    images.clear();
    itemCache.clear(); nativeItemCache.clear(); catalogCache = null; catalogFetched = 0;
    if (!next) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(next) || '{}');
      // Cache has display metadata only (no auth tokens) and is tied to the
      // Jellyfin origin and active user. Live server state replaces it shortly.
      if (Date.now() - cached.time < 2 * 60 * 60 * 1000 && Array.isArray(cached.cards))
        cards = cached.cards.filter(x => x && GUID.test(x.rowId || '')).slice(0, MAX_CARDS);
    } catch (_) {}
  }
  function saveCache() {
    if (!authScope) return;
    try { sessionStorage.setItem(authScope, JSON.stringify({time: Date.now(), cards})); } catch (_) {}
  }

  function homeAnchor() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,.sectionTitle')];
    const heading = headings.find(h => (h.textContent || '').trim() === 'Continue Watching')
      || headings.find(h => (h.textContent || '').trim() === 'My Media');
    return heading?.closest('.verticalSection,.homeSection,section') || heading?.parentElement?.parentElement || null;
  }
  function nativeRowSettingKey(auth) {
    return 'fe-show-active-native-rows:' + location.origin + ':' + String(auth.UserId || '').toLowerCase();
  }
  function nativeRowSections() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,.sectionTitle')];
    return headings.filter(h => /^(Continue Watching|Next Up)(?:\s*[›»>→])?$/.test((h.textContent || '').replace(/\s+/g,' ').trim()))
      .map(h => h.closest('.verticalSection,.homeSection,section') || h.parentElement?.parentElement)
      .filter(Boolean);
  }
  function nativeCardId(card) {
    const candidates = [card, card.querySelector('[data-id],[data-item-id],[data-itemid]')].filter(Boolean);
    for (const node of candidates) {
      for (const attribute of ['data-id','data-item-id','data-itemid']) {
        const id = node.getAttribute(attribute);
        if (GUID.test(id || '')) return id.toLowerCase();
      }
    }
    const links = [...card.querySelectorAll('a[href]')];
    if (card.matches('a[href]')) links.unshift(card);
    for (const link of links) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        const id = url.searchParams.get('id') || new URLSearchParams(url.hash.split('?')[1] || '').get('id');
        if (GUID.test(id || '')) return id.toLowerCase();
      } catch (_) { /* Invalid native link. */ }
    }
    return '';
  }
  async function nativeSeriesId(id, auth) {
    const stored = nativeItemCache.get(id);
    if (stored && Date.now() - stored.time < 120000) return stored.value;
    let value = '';
    try {
      const item = await cachedItem(id, auth);
      value = String(item?.SeriesId || (item?.Type === 'Series' ? item.Id : '') || '').toLowerCase();
    } catch (_) { /* A missing item must remain visible. */ }
    nativeItemCache.set(id, {time:Date.now(),value});
    return value;
  }
  async function filterNativeRows(auth) {
    const serial = ++nativeFilterSerial;
    const sections = nativeRowSections();
    if (!sections.length) return;
    if (!document.getElementById(NATIVE_HIDE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = NATIVE_HIDE_STYLE_ID;
      style.textContent = '.' + NATIVE_HIDE_CLASS + '{display:none!important}';
      document.head.append(style);
    }
    const hide = auth && localStorage.getItem(nativeRowSettingKey(auth)) === '0';
    const targets = new Set();
    for(const id of nativeTimelineTargets)targets.add(id);
    for (const card of cards) {
      if (GUID.test(card.itemId || '')) targets.add(card.itemId.toLowerCase());
      if (GUID.test(card.seriesId || '')) targets.add(card.seriesId.toLowerCase());
    }
    const nativeCards = [...new Set(sections.flatMap(section =>
      [...section.querySelectorAll('.card,.libraryCard')].filter(card => !card.closest('#'+WIDGET_ID))))];
    for (const card of nativeCards) {
      const id = nativeCardId(card);
      if (!hide || !targets.size || !id) {
        card.classList.remove(NATIVE_HIDE_CLASS);
        continue;
      }
      if (targets.has(id)) {
        card.classList.add(NATIVE_HIDE_CLASS);
        continue;
      }
      const seriesId = await nativeSeriesId(id, auth);
      if (serial !== nativeFilterSerial || !card.isConnected) return;
      card.classList.toggle(NATIVE_HIDE_CLASS, Boolean(seriesId && targets.has(seriesId)));
    }
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      // Legacy Injector registrations may leave a second tracker with the
      // exact same DOM id. Hide it so its native confirm/resume menu cannot
      // be clicked accidentally after the upgraded script becomes active.
      '#'+WIDGET_ID+':not([data-fe-version="0.8.9.13"]){display:none!important}',
      '#'+WIDGET_ID+'{box-sizing:border-box;width:100%;min-width:0;padding:10px max(16px,2.5vw) 16px;color:#fff}',
      '#'+WIDGET_ID+' h2{font-size:1.32rem;margin:8px 0 15px;font-weight:600}',
      '#'+WIDGET_ID+' .fe-resume-grid{display:flex;gap:16px;flex-wrap:wrap;align-items:stretch}',
      '#'+WIDGET_ID+' .fe-resume-card{display:flex;flex:1 1 445px;max-width:590px;min-width:0;min-height:164px;position:relative;overflow:visible;background:#202b37;border:1px solid #4b5b69;border-radius:11px;box-sizing:border-box}',
      '#'+WIDGET_ID+' .fe-resume-card.fe-resume-menu-open{z-index:20}',
      '#'+WIDGET_ID+' .fe-resume-art{display:flex;align-items:center;justify-content:center;position:relative;flex:0 0 39%;min-width:0;overflow:hidden;border-radius:10px 0 0 10px;background:linear-gradient(145deg,#143c4a,#10232d);color:#82b8c5;text-decoration:none}',
      '#'+WIDGET_ID+' .fe-resume-art.fe-resume-landscape::before{content:"";position:absolute;inset:-12px;background-image:var(--fe-resume-backdrop);background-size:cover;background-position:center;filter:blur(12px) brightness(.45);opacity:.9}',
      '#'+WIDGET_ID+' .fe-resume-art img{width:100%;height:100%;position:absolute;inset:0;object-fit:contain;z-index:1}',
      '#'+WIDGET_ID+' .fe-resume-art img.fe-resume-portrait{object-fit:contain;background:#10232d}',
      '#'+WIDGET_ID+' .fe-resume-art span{font-size:3rem;opacity:.55}',
      '#'+WIDGET_ID+' .fe-resume-content{flex:1;min-width:0;padding:15px 18px;display:flex;flex-direction:column;gap:5px}',
      '#'+WIDGET_ID+' .fe-resume-franchise{font-size:.71rem;letter-spacing:.08em;font-weight:700;text-transform:uppercase;color:#c5dce9;line-height:1.3}',
      '#'+WIDGET_ID+' .fe-resume-title{font-size:1.38rem;line-height:1.22;font-weight:700;overflow-wrap:anywhere}',
      '#'+WIDGET_ID+' .fe-resume-next{font-size:.9rem;color:#f1f5f8;overflow-wrap:anywhere}',
      '#'+WIDGET_ID+' .fe-resume-status{font-size:.78rem;color:#ccd5e1;margin-top:1px}',
      '#'+WIDGET_ID+' .fe-resume-progress{height:6px;border-radius:8px;background:#3b4a59;overflow:hidden;margin:4px 0 6px}',
      '#'+WIDGET_ID+' .fe-resume-progress span{display:block;height:100%;background:#12a9c4;min-width:0}',
      '#'+WIDGET_ID+' .fe-resume-play{align-self:flex-start;background:#008ca5;color:#fff!important;padding:7px 13px;border-radius:7px;font-size:.84rem;font-weight:600;text-decoration:none;line-height:1.4}',
      '#'+WIDGET_ID+' .fe-resume-play:hover{background:#00a6bf}',
      '#'+WIDGET_ID+' .fe-resume-menu-holder{position:absolute;top:7px;right:7px;z-index:21}',
      '#'+WIDGET_ID+' .fe-resume-menu-toggle{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #738899;border-radius:50%;background:#14232eea;color:#fff;font:bold 21px/1 Arial,sans-serif;cursor:pointer;opacity:0;transition:opacity .15s}',
      '#'+WIDGET_ID+' .fe-resume-card:hover .fe-resume-menu-toggle,#'+WIDGET_ID+' .fe-resume-card:focus-within .fe-resume-menu-toggle,#'+WIDGET_ID+' .fe-resume-menu-toggle[aria-expanded="true"]{opacity:1}',
      '#'+WIDGET_ID+' .fe-resume-menu{position:absolute;right:0;top:37px;min-width:220px;max-width:min(88vw,280px);padding:5px;background:#162734;color:#fff;border:1px solid #547083;border-radius:9px;box-shadow:0 12px 28px #000c;box-sizing:border-box}',
      '#'+WIDGET_ID+' .fe-resume-menu[hidden]{display:none!important}',
      '#'+WIDGET_ID+' .fe-resume-menu button{display:block;width:100%;padding:11px 9px;border:0;border-radius:6px;background:transparent;color:#fff;text-align:left;font:600 13px/1.35 Arial,sans-serif;white-space:normal;cursor:pointer}',
      '#'+WIDGET_ID+' .fe-resume-menu button:hover,#'+WIDGET_ID+' .fe-resume-menu button:focus-visible{background:#205367;outline:1px solid #42c9e0}',
      '#'+WIDGET_ID+' .fe-resume-menu button:disabled{opacity:.55;cursor:wait}',
      '#'+WIDGET_ID+' .fe-resume-wait{padding:16px;border:1px solid #425564;border-radius:10px;color:#bccbd6;background:#1b2631;font-size:.9rem;max-width:590px}',
      '#'+WIDGET_ID+' a:focus-visible,#'+WIDGET_ID+' button:focus-visible{outline:3px solid #38c5d9;outline-offset:2px}',
      '@media(hover:none),(pointer:coarse){#'+WIDGET_ID+' .fe-resume-menu-toggle{opacity:1}}',
      '@media(max-width:650px){#'+WIDGET_ID+' .fe-resume-card{flex-basis:100%;min-height:140px}#'+WIDGET_ID+' .fe-resume-content{padding:12px;gap:4px}#'+WIDGET_ID+' .fe-resume-title{font-size:1.06rem}#'+WIDGET_ID+' .fe-resume-art{flex-basis:36%}#'+WIDGET_ID+' .fe-resume-next{font-size:.8rem}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // TimelineManager renders the SAME list as Browse, but Jellyfin Home does
  // not load Browse's stylesheet. The modal is appended to document.body.
  function ensureHomeTimelineStyle() {
    if (document.getElementById('fe-home-timeline-dialog-style-v08913')) return;
    const style=document.createElement('style');style.id='fe-home-timeline-dialog-style-v08913';
    style.textContent=[
      '.timeline-dialog-mask{position:fixed;inset:0;z-index:2147483630;background:#050709e8;backdrop-filter:blur(2px);display:grid;place-items:center;padding:12px;overscroll-behavior:contain}',
      '.timeline-dialog-mask.fe-home-chronological-modal .timeline-dialog{width:min(830px,100%);max-height:min(88dvh,810px)}',
      '.timeline-dialog{box-sizing:border-box;width:min(920px,100%);max-height:min(92dvh,900px);min-width:0;overflow-y:auto;background:#1b2027;color:#f2f7fb;border:1px solid #647180;border-radius:16px;padding:clamp(13px,2vw,26px);box-shadow:0 22px 70px #000b;font:16px/1.4 system-ui,sans-serif}',
      '.timeline-dialog *{box-sizing:border-box}',
      '.timeline-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.timeline-dialog-header h2{margin:5px 0;font-size:clamp(1.2rem,3vw,1.8rem)}',
      '.timeline-dialog .btn{border:1px solid #566170;border-radius:9px;background:#272e38;color:#f3f8fc;padding:10px 13px;min-height:42px;font:650 .9rem/1.2 system-ui,sans-serif;cursor:pointer}',
      '.timeline-dialog .btn:hover{background:#3d4653}',
      '.timeline-dialog .btn.btn-primary{background:#079eb3;border-color:#079eb3;color:#03171a}',
      '.timeline-dialog .btn.btn-primary:hover{background:#23d0df}',
      '.timeline-dialog .field{background:#1a1f27;color:#fff;border:1px solid #66717d;border-radius:9px;padding:10px;min-height:44px;min-width:0}',
      '.timeline-dialog button:focus-visible,.timeline-dialog select:focus-visible{outline:3px solid #5deafa;outline-offset:2px}',
      '.timeline-feedback{color:#e7c485;font-size:.91rem;line-height:1.45;margin:12px 0}',
      '.timeline-chooser{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:15px 0}',
      '.timeline-watch-choice{display:flex;align-items:center;gap:9px;flex-wrap:wrap;width:100%;padding:12px;border:1px solid #3d8498;border-radius:10px;background:#122934}',
      '.timeline-watch-choice[hidden]{display:none!important}',
      '.timeline-watch-choice p{width:100%;margin:0 0 5px;font-weight:600;line-height:1.45}',
      '.timeline-device{max-width:100%;min-width:min(100%,230px)}',
      '.timeline-progress-track{height:7px;background:#354353;border-radius:999px;overflow:hidden;margin-top:6px}',
      '.timeline-progress-fill{height:100%;background:#12b7cb;border-radius:999px}',
      '.timeline-entry-list{display:grid;gap:8px;min-width:0}',
      '.timeline-entry{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#242a33;border:1px solid #465363;border-radius:10px;padding:12px}',
      '.timeline-entry-text{display:grid;gap:6px;min-width:0;flex:1;overflow-wrap:anywhere}',
      '.timeline-entry-text strong{font-size:.94rem}',
      '.timeline-entry-text small{color:#b9c5d0;font-size:.76rem}',
      '.timeline-entry-actions{display:flex;gap:6px;flex-wrap:wrap}',
      '.timeline-entry-actions .btn{min-height:42px;font-size:.82rem;padding:8px}',
      '.timeline-complete{border-color:#267965}',
      '.timeline-dialog .shelf-empty{padding:14px;color:#b9c5d0}',
      '@media(max-width:650px){.timeline-entry{align-items:stretch;flex-direction:column}.timeline-entry-actions{display:grid;grid-template-columns:1fr 1fr}.timeline-chooser .btn{flex:1}.timeline-dialog{max-height:96dvh}}'
    ].join('\n');document.head.appendChild(style);
  }

  // Use an accessible, centered confirmation rather than window.confirm,
  // whose native placement is controlled by the browser and often top-aligned.
  function confirmResetChronology(franchise) {
    if(document.getElementById('fe-reset-confirmation'))return Promise.resolve(false);
    return new Promise(resolve=>{
      const mask=document.createElement('div');mask.id='fe-reset-confirmation';
      mask.style.cssText='position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;padding:16px;background:#050709d9;backdrop-filter:blur(3px)';
      const dialog=document.createElement('section');dialog.setAttribute('role','dialog');
      dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','fe-reset-question');
      dialog.style.cssText='width:min(440px,100%);box-sizing:border-box;background:#1d252f;color:#fff;border:1px solid #647180;border-radius:15px;padding:25px;box-shadow:0 20px 65px #000b;font:16px/1.45 system-ui,sans-serif';
      const question=document.createElement('h2');question.id='fe-reset-question';
      question.textContent='Are you sure you want to reset '+franchise+' chronological timeline?';
      question.style.cssText='font:650 1.16rem/1.5 system-ui,sans-serif;margin:0 0 24px';
      const controls=document.createElement('div');controls.style.cssText='display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
      const reset=document.createElement('button');reset.type='button';reset.textContent='Reset timeline';
      for(const button of [cancel,reset])button.style.cssText='min-height:43px;border:1px solid #607184;border-radius:8px;padding:9px 14px;background:#2b3643;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer';
      reset.style.background='#0b9caf';reset.style.borderColor='#0b9caf';reset.style.color='#03191c';
      const priorFocus=document.activeElement;
      const finish=accepted=>{mask.remove();document.removeEventListener('keydown',onKey,true);if(priorFocus?.isConnected)priorFocus.focus();resolve(accepted);};
      const onKey=event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);}
        else if(event.key==='Tab'){
          if(event.shiftKey&&document.activeElement===cancel){event.preventDefault();reset.focus();}
          else if(!event.shiftKey&&document.activeElement===reset){event.preventDefault();cancel.focus();}
        }
      };
      cancel.addEventListener('click',()=>finish(false));reset.addEventListener('click',()=>finish(true));
      mask.addEventListener('click',event=>{if(event.target===mask)finish(false);});
      controls.append(cancel,reset);dialog.append(question,controls);mask.append(dialog);document.body.append(mask);
      document.addEventListener('keydown',onKey,true);cancel.focus();
    });
  }

  function homeFeedback(message, error=false) {
    let notice=document.getElementById('fe-home-timeline-feedback');
    if(!notice){notice=document.createElement('div');notice.id='fe-home-timeline-feedback';notice.setAttribute('role','status');document.body.append(notice);}
    notice.style.cssText='position:fixed;bottom:24px;left:16px;right:16px;margin:auto;max-width:620px;z-index:2147483635;padding:14px 18px;border-radius:10px;box-shadow:0 10px 30px #0009;font:600 14px/1.5 system-ui,sans-serif;background:'+(error?'#532c2c':'#173c39')+';border:1px solid '+(error?'#e49c9c':'#5bc6bb')+';color:#fff';
    notice.textContent=message;
    clearTimeout(homeFeedback.timer);
    homeFeedback.timer=setTimeout(()=>notice.remove(),6500);
  }

  function playbackManager(auth,catalog={nodes:[],links:[],rows:[]}) {
    const manager=window.FranchiseTimeline?.TimelineManager;
    if(!manager)throw Error('The chronological playback engine was not loaded. Restart Jellyfin and check JavaScript Injector.');
    return new manager({catalog,prefix:serverPrefix(),token:auth.AccessToken,userId:auth.UserId,
      serverId:auth.Id||auth.ServerId||'',getItem:id=>cachedItem(id,auth)});
  }
  function playableQueue(state) {
    if(!Array.isArray(state.queueKeys)||!state.queueKeys.length)throw Error('No saved chronological playback queue exists for this franchise. Open its timeline once from Franchise Explorer.');
    return state.queueKeys.map((key,index)=>{
      const itemId=String(key).slice(String(key).lastIndexOf(':')+1);
      if(!GUID.test(itemId))throw Error('A saved chronological entry has an invalid media ID.');
      return {key,id:itemId,runTimeTicks:state.queueLengths?.[index]||0,
        sourceItemId:state.queueSourceItemIds?.[index]||itemId,
        season:state.queueSeasons?.[index]||0,episode:state.queueEpisodes?.[index]||0};
    });
  }
  function stopOldLocalFollow(rowId,auth) {
    const user=String(auth.UserId).toLowerCase();
    const key='fe-local-follow-v1:'+user;
    try{
      const owner=JSON.parse(localStorage.getItem(key)||'null');
      if(owner?.rowId===rowId){localStorage.removeItem(key);localStorage.removeItem('fe-local-completion-v1:'+user);}
    }catch(_){/* Other plugins may own malformed storage; don't alter it. */}
  }
  async function homepageAction(card,action,auth) {
    if(!auth)throw Error('Sign in to Jellyfin first.');
    if(action==='details'){
      if(!GUID.test(card.itemId||''))throw Error('No current playable title is available for Details.');
      window.FranchiseExplorerPlaybackReturn?.clear();
      const sid=auth.Id||auth.ServerId;
      location.assign(serverPath('/web/#/details?id='+encodeURIComponent(card.itemId)+
        (sid?'&serverId='+encodeURIComponent(sid):'')));
      return;
    }
    if(action==='select'){
      const catalogRaw=await cachedCatalog(auth);
      const catalog={nodes:(catalogRaw.nodes||catalogRaw.Nodes||[]).map(normalize),
        links:(catalogRaw.links||catalogRaw.Links||[]).map(normalize),
        rows:(catalogRaw.rows||catalogRaw.Rows||[]).map(normalize)};
      const row=catalog.rows.find(r=>String(r.id).toLowerCase()===String(card.rowId).toLowerCase() && r.rowType==='Timeline');
      if(!row)throw Error('This chronological row could not be found in your franchise catalog.');
      const player=playbackManager(auth,catalog);
      const state=await request('/FranchiseExplorer/TimelineState/'+encodeURIComponent(card.rowId),auth);
      if(state?.queueKeys?.length)player.states.set(row.id,state);
      ensureHomeTimelineStyle();
      const opening=player.openDialog(row,false,'select'); // Stay on Jellyfin Home.
      player.activeDialog?.parentElement?.classList.add('fe-home-chronological-modal');
      await opening;
      return;
    }
    const state=await request('/FranchiseExplorer/TimelineState/'+encodeURIComponent(card.rowId),auth);
    if(!state || !GUID.test(state.rowId||''))throw Error('No saved chronological history was found.');
    const queue=playableQueue(state);
    const row={id:state.rowId,parentNodeId:state.parentNodeId,name:state.name||card.franchise};
    const player=playbackManager(auth);
    player.states.set(row.id,state);
    if(action==='restart-history'){
      if(!await confirmResetChronology(card.franchise))return;
      await player.resetHistory(row,queue);
      stopOldLocalFollow(row.id,auth);
      // The reset changes the cursor to the first movie, but previously
      // watched franchise episodes must stay hidden in native home rows.
      // Apply the existing queue immediately, even if a background refresh
      // is already in progress and tick(true) must wait until the next poll.
      for(const q of queue){
        if(GUID.test(q.id||''))nativeTimelineTargets.add(q.id.toLowerCase());
        if(GUID.test(q.sourceItemId||''))nativeTimelineTargets.add(q.sourceItemId.toLowerCase());
      }
      scheduleMount();
      homeFeedback('Chronological history reset to the first item.');
      void tick(true); // Repaint the card in place, without opening the dialog.
    }else if(action==='restart-current'){
      const index=Math.max(0,Math.min(queue.length-1,Number(state.index)||0));
      stopOldLocalFollow(row.id,auth);
      await player.playHere(row,queue,index,0,false,false,true); // Reset time and open the native player directly.
    }
  }

  // Rescue clicks from a cached *old* Injector menu. Previous releases used
  // <a href=".../Browse?...&action=select">; capture those clicks and open
  // the new Home modal instead, even if the old widget remains in the DOM.
  document.addEventListener('click',event=>{
    const oldLink=event.target.closest?.('#franchise-timeline-resume .fe-resume-menu a[href*="action="]');
    if(!oldLink)return;
    let url;try{url=new URL(oldLink.href,location.href);}catch(_){return;}
    if(!url.pathname.endsWith('/FranchiseExplorer/Browse')||url.origin!==location.origin)return;
    const action=url.searchParams.get('action'),rowId=url.searchParams.get('timeline');
    if(!['select','restart-history','restart-current'].includes(action)||!GUID.test(rowId||''))return;
    event.preventDefault();event.stopImmediatePropagation();
    const card=cards.find(c=>c.rowId?.toLowerCase()===rowId.toLowerCase())||{rowId,franchise:'this franchise'};
    void homepageAction(card,action,credential()).catch(error=>{
      console.warn('Franchise Explorer legacy menu action:',error.message);homeFeedback(error.message,true);
    });
  },true);

  function scheduleMount() {
    if (queuedMount) return;
    queuedMount = true;
    requestAnimationFrame(() => { queuedMount = false; mount(); });
  }
  document.addEventListener('click', event => {
    if (activeResumeMenu && (!activeResumeMenu.holder.isConnected || !activeResumeMenu.holder.contains(event.target)))
      activeResumeMenu.close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeResumeMenu) {
      event.preventDefault();activeResumeMenu.close();
    }
  });
  function mount() {
    const auth = credential();
    restore(auth);
    // Hide only the current watch-order show/movie, never an entire franchise.
    // Existing Jellyfin rows remain intact; this is client-side presentation only.
    void filterNativeRows(auth);
    const anchor = homeAnchor();
    if (!anchor?.parentElement || (!cards.length && confirmedEmpty)) {
      if (widget?.isConnected) widget.remove();
      return;
    }
    ensureStyle();
    if (!widget) {
      widget = document.createElement('section');
      widget.id = WIDGET_ID;
      widget.setAttribute('aria-label', 'Continue Your Franchises');
    }
    widget.setAttribute('data-fe-version','0.8.9.13');
    // Jellyfin's home view can destroy and recreate this entire parent.
    // Keep our rendered widget and reattach immediately after the native row.
    if (widget.parentElement !== anchor.parentElement || anchor.nextElementSibling !== widget)
      anchor.parentElement.insertBefore(widget, anchor.nextSibling);
    const portrait = phonePortrait();
    const signature = JSON.stringify({cards,confirmedEmpty,portrait});
    if (signature === renderedSignature && widget.childElementCount) return;
    renderedSignature = signature;
    if (activeResumeMenu) activeResumeMenu.close();
    const heading = document.createElement('h2');
    heading.textContent = 'Continue Your Franchises';
    const grid = document.createElement('div');
    grid.className = 'fe-resume-grid';
    if (!cards.length) {
      const waiting = document.createElement('div');waiting.className='fe-resume-wait';
      waiting.textContent = auth ? 'Loading your franchise watch orders…' : 'Waiting for your Jellyfin session…';
      grid.append(waiting);
      widget.replaceChildren(heading,grid);
      return;
    }
    const authForImages = auth;
    for (const card of cards) {
      const url = serverPath('/FranchiseExplorer/Browse?timeline=' + encodeURIComponent(card.rowId) + '&resume=1');
      const panel = document.createElement('article'); panel.className = 'fe-resume-card';
      const cover = document.createElement('a'); cover.className = 'fe-resume-art'; cover.href = url;
      cover.setAttribute('aria-label', 'Resume ' + card.franchise + ': ' + card.title);
      const icon = document.createElement('span'); icon.textContent = '▶'; icon.setAttribute('aria-hidden', 'true');
      cover.append(icon);
      if ((card.artwork || card.artworkPortrait) && authForImages) {
        const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
        img.addEventListener('load', () => { icon.style.display = 'none'; });
        cover.append(img);
        // Keep the existing horizontal Thumb/Backdrop image in landscape.
        // On a phone held vertically, prefer the series/movie Primary poster.
        // If there is no poster (or it fails to load), retain the horizontal art.
        const candidates = portrait
          ? [card.artworkPortrait, card.artwork] : [card.artwork];
        void (async () => {
          for (const route of [...new Set(candidates.filter(Boolean))]) {
            const src = await authenticatedArtwork(route, authForImages);
            if (!img.isConnected || scopeFor(authForImages) !== authScope) return;
            if (src) {
              const usesPoster = portrait && route === card.artworkPortrait;
              img.classList.toggle('fe-resume-portrait', usesPoster);
              cover.classList.toggle('fe-resume-landscape',!usesPoster);
              if(!usesPoster)cover.style.setProperty('--fe-resume-backdrop','url("'+src+'")');
              else cover.style.removeProperty('--fe-resume-backdrop');
              img.dataset.feArtworkKind = usesPoster ? 'poster' : 'landscape';
              img.src = src;
              return;
            }
          }
        })();
      }
      const info = document.createElement('div'); info.className = 'fe-resume-content';
      const franchise = document.createElement('div'); franchise.className = 'fe-resume-franchise';
      franchise.textContent = card.franchise || 'Franchise';
      const title = document.createElement('strong'); title.className = 'fe-resume-title';
      title.textContent = card.title || 'Next in watch order';
      const next = document.createElement('div'); next.className = 'fe-resume-next';
      next.textContent = card.detail || 'Next in chronological order';
      const status = document.createElement('div'); status.className = 'fe-resume-status';
      const percent = Math.max(0, Math.min(100, Number(card.percent) || 0));
      const shown = percent > 0 && percent < 1 ? percent.toFixed(2) : percent.toFixed(1).replace(/\.0$/, '');
      status.textContent = shown + '% complete · ' + card.position + ' of ' + card.total + ' in chronological order';
      const track = document.createElement('div'); track.className = 'fe-resume-progress';
      track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', 'Watch order completed');
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(percent.toFixed(2)));
      const fill = document.createElement('span'); fill.style.width = percent + '%'; track.append(fill);
      const resume = document.createElement('a'); resume.className = 'fe-resume-play'; resume.href = url;
      resume.textContent = '▶  Resume Watch Order';
      info.append(franchise, title, next, status, track, resume);
      const holder = document.createElement('div'); holder.className = 'fe-resume-menu-holder';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'fe-resume-menu-toggle';
      toggle.textContent = '⋮';toggle.title = 'Franchise playback options';
      toggle.setAttribute('aria-label', 'Playback options for ' + (card.franchise || 'franchise'));
      toggle.setAttribute('aria-haspopup', 'true');toggle.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');menu.className = 'fe-resume-menu';menu.hidden = true;
      const close = () => { menu.hidden = true;toggle.setAttribute('aria-expanded','false');panel.classList.remove('fe-resume-menu-open');if(activeResumeMenu?.holder===holder)activeResumeMenu=null; };
      for(const [label,action] of [
        ['Restart chronological history','restart-history'],
        ['Restart current viewing','restart-current'],
        ['Select from chronological list','select'],
        ['Details','details']
      ]) {
        const option=document.createElement('button');option.type='button';
        option.textContent=label;
        option.addEventListener('click',async event=>{
          event.preventDefault();event.stopPropagation();
          close();option.disabled=true;
          try{await homepageAction(card,action,credential());}
          catch(error){console.warn('Franchise Explorer home playback action:',error.message);homeFeedback(error.message,true);}
          finally{if(option.isConnected)option.disabled=false;}
        });
        menu.append(option);
      }
      toggle.addEventListener('click', event => {
        event.preventDefault();event.stopPropagation();
        const opening=menu.hidden;
        if(activeResumeMenu)activeResumeMenu.close();
        menu.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));
        panel.classList.toggle('fe-resume-menu-open',opening);
        activeResumeMenu=opening?{holder,close}:null;
      });
      holder.append(toggle,menu);
      panel.append(cover, info,holder); grid.append(panel);
    }
    widget.replaceChildren(heading, grid);
  }

  async function authenticatedArtwork(route, auth) {
    if (!/^\/Items\/[a-f\d-]{32,36}\/Images\/(?:Thumb|Backdrop\/0|Primary)\?maxWidth=\d+$/i.test(route))
      return '';
    if (images.has(route)) return images.get(route);
    const pending = fetch(serverPath(route), {
      headers: {Authorization: 'MediaBrowser Token="' + auth.AccessToken + '"'}
    }).then(r => r.ok ? r.blob() : null)
      .then(blob => blob?.type.startsWith('image/') ? URL.createObjectURL(blob) : '')
      .catch(() => '');
    images.set(route, pending);
    const value = await pending;
    if (scopeFor(auth) !== authScope) { if (value) URL.revokeObjectURL(value); return ''; }
    images.set(route, value);
    if (images.size > 40) {
      const oldest = images.keys().next().value;
      if (oldest && oldest !== route) {
        const stale = images.get(oldest);
        if (typeof stale === 'string' && stale) URL.revokeObjectURL(stale);
        images.delete(oldest);
      }
    }
    return value;
  }
  async function cachedItem(id, auth) {
    if (!GUID.test(id || '')) return null;
    const startedScope = scopeFor(auth);
    const key = id.toLowerCase();
    const stored = itemCache.get(key);
    if (stored && Date.now() - stored.time < 2 * 60 * 1000) return stored.value;
    const value = await request('/Items/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(auth.UserId), auth);
    if (startedScope !== authScope) return null;
    itemCache.set(key, {time:Date.now(), value});
    if (itemCache.size > 100) itemCache.delete(itemCache.keys().next().value);
    return value;
  }
  async function cachedCatalog(auth) {
    if (catalogCache && Date.now() - catalogFetched < 2 * 60 * 1000) return catalogCache;
    const startedScope = scopeFor(auth);
    const value = await request('/FranchiseExplorer/Catalog', auth);
    if (startedScope !== authScope) return {nodes:[],rows:[]};
    catalogCache = value;
    catalogFetched = Date.now();
    return catalogCache;
  }

  function itemKey(state) {
    const value = String((state.queueKeys || [])[state.index] || '');
    const result = value.slice(value.lastIndexOf(':') + 1);
    return GUID.test(result) ? result : '';
  }
  function artworkRoute(item) {
    if (!item || !GUID.test(item.Id || '')) return '';
    if (item.ImageTags?.Thumb) return '/Items/' + item.Id + '/Images/Thumb?maxWidth=800';
    if (item.BackdropImageTags?.length) return '/Items/' + item.Id + '/Images/Backdrop/0?maxWidth=800';
    if (item.ImageTags?.Primary) return '/Items/' + item.Id + '/Images/Primary?maxWidth=800';
    return '';
  }
  function posterRoute(item) {
    if (!item || !GUID.test(item.Id || '') || !item.ImageTags?.Primary) return '';
    return '/Items/' + item.Id + '/Images/Primary?maxWidth=600';
  }
  function franchiseFor(state, catalog) {
    const nodes = new Map((catalog.nodes || catalog.Nodes || []).map(n => {
      const value = normalize(n);
      return [String(value.id || '').toLowerCase(), value];
    }));
    const row = (catalog.rows || catalog.Rows || []).map(normalize)
      .find(r => String(r.id).toLowerCase() === String(state.rowId).toLowerCase());
    let current = String(row?.parentNodeId || state.parentNodeId || '').toLowerCase();
    let root = null;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = nodes.get(current);
      if (!node) break;
      root = node;
      current = String(node.parentId || '').toLowerCase();
    }
    return root?.name || row?.name || state.name || 'Franchise';
  }
  async function cardFor(state, catalog, auth) {
    const id = itemKey(state);
    let item = null, series = null;
    if (id) try { item = await cachedItem(id, auth); } catch (_) {}
    if (item && GUID.test(item.SeriesId || '')) {
      try { series = await cachedItem(item.SeriesId, auth); } catch (_) {}
    }
    const title = item?.SeriesName || series?.Name || item?.Name || 'Next in watch order';
    let detail = 'Next in chronological order';
    if (item?.Type === 'Episode') {
      const season = Number.isInteger(item.ParentIndexNumber) ? item.ParentIndexNumber : '?';
      const episode = Number.isInteger(item.IndexNumber) ? item.IndexNumber : '?';
      detail = 'Up next: S' + season + ':E' + episode + (item.Name ? ' – ' + item.Name : '');
    } else if (item?.Type === 'Movie') detail = 'Up next: Movie' + (item.ProductionYear ? ' · ' + item.ProductionYear : '');
    const completed = Array.isArray(state.completedKeys) ? state.completedKeys.length : 0;
    return {
      rowId: state.rowId,
      itemId: id,
      seriesId: item?.Type === 'Episode' ? String(item.SeriesId || '').toLowerCase() : '',
      franchise: franchiseFor(state, catalog),
      title, detail,
      artwork: artworkRoute(series) || artworkRoute(item),
      artworkPortrait: item?.Type === 'Episode'
        ? posterRoute(series) : (posterRoute(item) || posterRoute(series)),
      percent: state.total > 0 ? 100 * completed / state.total : 0,
      position: Math.min(state.total, Math.max(1, state.index + 1)),
      total: state.total
    };
  }
  async function tick(force = false) {
    const auth = credential();
    restore(auth);
    scheduleMount();
    if (!auth || busy || document.hidden || (!force && Date.now() - lastFetch < 10000)) return;
    busy = true; lastFetch = Date.now();
    const startedScope = authScope;
    try {
      const states = await request('/FranchiseExplorer/TimelineState', auth);
      if (!Array.isArray(states)) return;
      const active = states.filter(s => s && GUID.test(s.rowId || '') && s.total > 0
        && s.index >= 0 && s.index < s.total && s.playbackMode !== 'complete').slice(0, MAX_CARDS);
      const nextTargets=new Set();
      for(const state of active){
        if(GUID.test(state.itemId||''))nextTargets.add(state.itemId.toLowerCase());
        for(const sourceId of state.queueSourceItemIds||[])
          if(GUID.test(sourceId||''))nextTargets.add(sourceId.toLowerCase());
        for(const key of state.queueKeys||[]){
          const id=String(key).slice(String(key).lastIndexOf(':')+1);
          if(GUID.test(id))nextTargets.add(id.toLowerCase());
        }
      }
      let catalog = { nodes: [], rows: [] };
      if (active.length) try { catalog = await cachedCatalog(auth); } catch (_) {}
      const resolved = await Promise.all(active.map(state => cardFor(state, catalog, auth)));
      if (startedScope !== authScope) return;
      nativeTimelineTargets=nextTargets;
      cards = resolved;
      confirmedEmpty = active.length === 0;
      saveCache();
      scheduleMount();
      // Read only: never change user playback state or Jellyfin watched flags.
    } catch (error) {
      // Transient errors must not erase the user's most recent cards. Log only
      // the status/error class (never an auth header, token or user ID).
      console.warn('[Franchise Explorer 0.8.9.13] Home tracker refresh failed:', error?.message || 'unknown error');
    }
    finally { busy = false; }
  }
  const observer = new MutationObserver(() => { if (cards.length) scheduleMount(); });
  function start() {
    if (!document.body) return;
    restore(credential());
    observer.observe(document.body, {childList:true, subtree:true});
    scheduleMount();
    void tick(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
  setInterval(() => void tick(), 12000);
  window.addEventListener('hashchange', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  window.addEventListener('resize', scheduleMount);
  window.addEventListener('orientationchange', scheduleMount);
  window.addEventListener('pageshow', () => { scheduleMount(); void tick(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleMount(); void tick(true); } });
})();


/* v0.8.1 — Native-player handoff for item cards.
 * A title card opens Jellyfin Web with feAutoPlay=1. The bridge waits for the
 * correct details page and clicks Jellyfin's own Play control. This avoids
 * bypassing Jellyfin's normal transcoding and codec negotiation.
 * The feature depends on Jellyfin Web's DOM and the installed JS Injector.
 */
(function(){
  'use strict';
  // Older Injector scripts can coexist after an upgrade. A boolean-only
  // guard would silently retain their details-page/autoresume behavior.
  if(window.__franchiseAutoplayBridgeVersion==='0.8.9.13')return;
  window.__franchiseAutoplayBridgeVersion='0.8.9.13';
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
    clean.delete('feAutoPlay');clean.delete('feSubs');clean.delete('feLocalTimeline');clean.delete('feStartOver');
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
  const playbackReturnKey='fe-return-after-player-v1';
  function readPlaybackReturn(){
    try{
      const value=JSON.parse(sessionStorage.getItem(playbackReturnKey)||'null');
      if(!value||Date.now()-value.created>12*60*60*1000){sessionStorage.removeItem(playbackReturnKey);return null;}
      return value;
    }catch(_){return null;}
  }
  function armPlaybackReturn(id,source){
    if(!/^[a-f0-9-]{32,36}$/i.test(id))return;
    const auth=localCredentials();
    try{
      const origin=location.origin;
      const root=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
      const fallback=origin+root+'/web/#/home';
      const url=new URL(source||location.href,location.href);
      const isPlayerOrDetails=/^#\/(?:details|video|playback)(?:\?|\/|$)/i.test(url.hash);
      sessionStorage.setItem(playbackReturnKey,JSON.stringify({version:1,id,
        returnUrl:url.origin===origin&&!isPlayerOrDetails?url.href:fallback,
        userId:String(auth?.UserId||'').toLowerCase(),created:Date.now(),startedAt:0}));
    }catch(error){console.debug('Franchise Explorer: return destination unavailable',error);}
  }
  function clearPlaybackReturn(){try{sessionStorage.removeItem(playbackReturnKey);}catch(_){}}
  window.FranchiseExplorerPlaybackReturn={arm:armPlaybackReturn,clear:clearPlaybackReturn};
  // PlaybackManager may return to the title's Details route when the native
  // player is closed, even if playback began directly from Jellyfin Home.
  // Only handle our own recent, actually-started same-user playback and leave
  // deliberately opened Details pages alone.
  document.addEventListener('playing',event=>{
    if(!(event.target instanceof HTMLVideoElement))return;
    const marker=readPlaybackReturn();if(!marker)return;
    const auth=localCredentials();
    if(marker.userId!==String(auth?.UserId||'').toLowerCase())return;
    if(marker.startedAt)return;
    marker.startedAt=Date.now();
    try{sessionStorage.setItem(playbackReturnKey,JSON.stringify(marker));}catch(_){}
  },true);
  let returning=false;
  function restorePlaybackOrigin(){
    if(returning)return;
    const marker=readPlaybackReturn();if(!marker?.startedAt)return;
    const auth=localCredentials();
    if(marker.userId!==String(auth?.UserId||'').toLowerCase())return;
    if(!/^#\/?details\?/i.test(location.hash||''))return;
    const route=new URLSearchParams(location.hash.split('?')[1]||'');
    if(route.get('feAutoPlay')==='1'||!itemMatch(route.get('id'),marker.id))return;
    returning=true;
    setTimeout(()=>{
      returning=false;
      const current=readPlaybackReturn();
      if(!current?.startedAt||current.id!==marker.id||!/^#\/?details\?/i.test(location.hash||''))return;
      const visibleVideo=[...document.querySelectorAll('video')].some(v=>!v.paused&&!v.ended&&v.getClientRects().length);
      if(visibleVideo)return;
      try{
        const destination=new URL(current.returnUrl,location.href);
        if(destination.origin!==location.origin)return;
        clearPlaybackReturn();
        location.replace(destination.href);
      }catch(error){console.warn('Franchise Explorer: could not return to previous page',error);}
    },250);
  }
  addEventListener('hashchange',restorePlaybackOrigin);
  addEventListener('popstate',restorePlaybackOrigin);
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
      if(intent.replayOnly){
        // An independent Watch only action explicitly opts out of franchise
        // tracking. Do not display the tracked-playback verification warning
        // while the user watches this item; Jellyfin watched data is separate.
        localStorage.removeItem(intent.key);
        return;
      }
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
  // Jellyfin may offer Resume instead of Play for a previously watched title.
  // A restart-current shortcut must seek the native local player back to 0:00
  // even when the native resume setting would otherwise resume the video.
  let cancelStartOver=null;
  function enforceStartOver(expectedId){
    if(cancelStartOver)cancelStartOver();
    let closed=false;
    const onVideo=event=>{
      const video=event.target;
      if(!(video instanceof HTMLVideoElement)||!isVisible(video))return;
      const intent=localIntent(localCredentials());
      if(!intent?.forceStartOver||!itemMatch(intent.expectedId,expectedId))return;
      try{
        if(video.readyState<1)return;
        video.currentTime=0;
        if(video.currentTime<1.5)stop();
      }catch(_){/* Wait for the native player to load media metadata. */}
    };
    const stop=()=>{
      if(closed)return;closed=true;
      document.removeEventListener('playing',onVideo,true);
      document.removeEventListener('timeupdate',onVideo,true);
      clearTimeout(expiry);if(cancelStartOver===stop)cancelStartOver=null;
    };
    cancelStartOver=stop;
    document.addEventListener('playing',onVideo,true);
    document.addEventListener('timeupdate',onVideo,true);
    const expiry=setTimeout(stop,30000);
  }
  // Jellyfin Web's own delegated shortcuts click handler understands
  // data-action=play / resume on a card inside the active items container.
  // This invokes the native PlaybackManager immediately: no /details route,
  // direct stream URLs, or guessed server-side Session.Playing commands.
  // Explicit `play` with position 0 is essential for restart-current: native
  // Jellyfin's Resume action otherwise restores its separate watched offset.
  window.FranchiseExplorerNativePlayback={
    version:'0.8.9.13',
    play(id,options={}){
      if(!/^[a-f0-9-]{32,36}$/i.test(id))return false;
      const container=document.querySelector('.homeTab:not(.hide) .itemsContainer, .homeTab:not(.hide) .itemsContainerWithBorders, .homeTab .itemsContainer, .itemsContainer:not(.hide)');
      if(!container)return false;
      const wrapper=document.createElement('div');
      // Jellyfin shortcuts.onClick looks up the nearest `.itemAction` from
      // the clicked element and reads ALL playback metadata from that card.
      // A plain hidden button with data-action is ignored by the handler.
      wrapper.className='card itemAction fe-direct-playback-shortcut';
      wrapper.dataset.id=id;
      wrapper.dataset.itemid=id;
      const auth=localCredentials();
      const serverId=auth?.Id||auth?.ServerId||'';
      if(!serverId)return false;
      armPlaybackReturn(id,options.returnUrl||location.href);
      wrapper.dataset.serverid=serverId;
      wrapper.dataset.type=options.type==='Episode'?'Episode':'Movie';
      wrapper.dataset.mediatype='Video';
      wrapper.dataset.isfolder='false';
      wrapper.dataset.action=options.startOver||!Number(options.positionTicks)?'play':'resume';
      wrapper.dataset.positionticks=String(options.startOver?0:Math.max(0,Number(options.positionTicks)||0));
      wrapper.setAttribute('aria-hidden','true');
      wrapper.style.cssText='position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;pointer-events:none';
      const button=document.createElement('button');
      button.type='button';button.tabIndex=-1;
      button.dataset.action=wrapper.dataset.action;
      button.dataset.id=id;
      button.dataset.itemid=id;
      button.dataset.positionticks=String(options.startOver?0:Math.max(0,Number(options.positionTicks)||0));
      wrapper.appendChild(button);container.appendChild(wrapper);
      const intent=localIntent(auth);
      if(intent&&itemMatch(intent.expectedId,id)){
        intent.routePending=false;
        localStorage.setItem(intent.key,JSON.stringify(intent));
      }
      if(options.startOver)enforceStartOver(id);
      // Let Jellyfin's own delegated listener observe an inserted card before
      // clicking; do not try to jump directly into a private Web module.
      setTimeout(()=>{
        if(!wrapper.isConnected)return;
        button.click();
        setTimeout(()=>wrapper.remove(),250);
        void confirmLocalTimeline(id);
      },0);
      if(!options.subtitleEnabled)for(const delay of [800,2000,4500])setTimeout(disableBrowserTextTracks,delay);
      // A theme or Jellyfin Web variant may not expose the delegated
      // shortcut listener. Only then fall back to the details-page handoff.
      const pathname=location.pathname,hash=location.hash;
      setTimeout(()=>{
        const latest=localIntent(localCredentials());
        if(!latest||!itemMatch(latest.expectedId,id)||location.pathname!==pathname||location.hash!==hash)return;
        const playing=[...document.querySelectorAll('video')].some(v=>!v.paused&&v.readyState>=2);
        if(playing)return;
        console.warn('Franchise Explorer: direct Jellyfin shortcut did not start a player; trying the compatibility handoff.');
        const prefix=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
        const sid=auth?.Id||auth?.ServerId;
        location.assign(prefix+'/web/#/details?id='+encodeURIComponent(id)+(sid?'&serverId='+encodeURIComponent(sid):'')+
          '&feAutoPlay=1&feLocalTimeline=1&feSubs='+(options.subtitleEnabled?'1':'0')+(options.startOver?'&feStartOver=1':''));
      },12000);
      return true;
    }
  };
  // A click in the standalone Franchises browser starts on that browser's
  // page, where Jellyfin Web's shortcuts handler is not mounted. The browser
  // hands the request to this same-tab /web Home bridge through sessionStorage.
  // Never treat the request as playback history; verification is still needed.
  let queuedQuickPlay=null;
  try{
    const raw=sessionStorage.getItem('fe-quickplay-v1');
    queuedQuickPlay=raw?JSON.parse(raw):null;
  }catch(_){/* Storage may be blocked in a restricted browser. */}
  if(queuedQuickPlay?.version===1 && /^[a-f0-9-]{32,36}$/i.test(queuedQuickPlay.id)){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      const current=queuedQuickPlay;
      if(Date.now()-current.created>60000){
        clearInterval(timer);sessionStorage.removeItem('fe-quickplay-v1');return;
      }
      if(window.FranchiseExplorerNativePlayback.play(current.id,current)){
        clearInterval(timer);sessionStorage.removeItem('fe-quickplay-v1');return;
      }
      if(tries>=50){
        clearInterval(timer);sessionStorage.removeItem('fe-quickplay-v1');
        console.warn('Franchise Explorer: native Home shortcut unavailable; opening the standard player compatibility route.');
        armPlaybackReturn(current.id,current.returnUrl||location.href);
        const prefix=((location.pathname||'').match(/^(.*?)\/web(?:\/|$)/i)||[])[1]||'';
        location.assign(prefix+'/web/#/details?id='+encodeURIComponent(current.id)+
          '&feAutoPlay=1&feLocalTimeline=1&feSubs='+(current.subtitleEnabled?'1':'0')+
          (current.startOver?'&feStartOver=1':''));
      }
    },300);
  }
  function startIfReady(){
    scheduled=false;
    const p=params();if(!p){currentKey='';attempts=0;return;}
    const id=p.get('id');
    const key=id+'|'+(p.get('feSubs')||'0')+'|'+(p.get('feStartOver')||'0');
    if(currentKey!==key){currentKey=key;attempts=0;routeSettlingSince=Date.now();}
    // On a programmatic transition the previous movie's Play button may still
    // be visible for a moment. Do not click it before Jellyfin has had time
    // to replace the details view for the *new* requested media ID.
    if(Date.now()-routeSettlingSince<600){setTimeout(schedule,250);return;}
    // Jellyfin Web renders the details page asynchronously. Wait for a visible
    // Play control; never click an element in a hidden/previous item page.
    const root=[...document.querySelectorAll('.page, .mainAnimatedPage, main')]
      .filter(isVisible).reverse().find(x=>x.querySelector('.btnPlay,button[data-action="play"],button[data-action="resume"]'));
    const play=root?.querySelector(p.get('feStartOver')==='1'
      ? 'button[data-action="play"],.btnPlay,button[data-action="resume"]'
      : '.btnPlay,button[data-action="play"],button[data-action="resume"]');
    if(play&&isVisible(play)){
      const subs=p.get('feSubs')==='1';
      const isTimeline=p.get('feLocalTimeline')==='1';
      const startOver=isTimeline && p.get('feStartOver')==='1';
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
      if(startOver)enforceStartOver(id);
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
      const previousReturn=readPlaybackReturn();
      armPlaybackReturn(next,previousReturn?.returnUrl||location.href);
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
