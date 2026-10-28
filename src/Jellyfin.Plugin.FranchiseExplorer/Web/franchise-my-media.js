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
