/* Live Jellyfin settings controller. The flat plugin configuration is the source of truth. */
(function () {
  'use strict';
  const page = document.getElementById('FranchiseExplorerConfigPage');
  if (!page || page.dataset.fxInitialized === 'yes') return;
  page.dataset.fxInitialized = 'yes';
  const C = window.FranchiseSettingsCore,
    $ = (id) => page.querySelector('#' + id);
  const pluginId = '6bc7820b-7c6d-4e64-a139-dfb90b8d6f42';
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  let model = C.normalize({ Nodes: [], Rows: [], MediaLinks: [] }),
    loaded = false,
    baseline = '',
    dirty = false,
    revision = 0,
    saving = false,
    automation = null;
  let selected = '',
    nodeDraft = null,
    rowDraft = null,
    structure = null,
    subgroupParent = '',
    subgroupRowId = '',
    mediaScope = null,
    rangeDraft = null,
    deletion = null,
    movePayload = null,
    review = null;
  const history = [],
    expanded = new Set(),
    openRows = new Set(),
    searches = new Map(),
    itemCache = new Map(),
    blobCache = new Map();
  const getNode = (id) => model.Nodes.find((n) => n.Id === id),
    getRow = (id) => model.Rows.find((r) => r.Id === id);
  const children = (id) => model.Nodes.filter((n) => n.ParentId === id).sort(order);
  const rows = (id) => model.Rows.filter((r) => r.ParentNodeId === id).sort(order);
  const order = (a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name);
  const category = (row) => C.categoryForRow(row, model);
  const shortType = (type) => ({ Series: 'TV Show', BoxSet: 'Collection' })[type] || type;
  const typeIcon = (type) =>
    ({ 'TV Shows': 'tv', Movies: 'film', Collection: 'box', 'Sub Group': 'folder' })[type] ||
    'list';
  // Jellyfin serializes model properties in class order, which can differ from
  // a freshly created browser draft. Only data changes indicate a conflict.
  const fingerprint = (value) =>
    JSON.stringify(
      {
        NavigationLabel: value.NavigationLabel,
        Nodes: value.Nodes,
        Rows: value.Rows,
        MediaLinks: value.MediaLinks,
        ImdbLists: value.ImdbLists,
        ConfigurationRevision: value.ConfigurationRevision,
        AutoFranchises: value.AutoFranchises,
        MediaRecovery: value.MediaRecovery,
      },
      (_key, entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(
              Object.keys(entry)
                .sort()
                .map((key) => [key, entry[key]]),
            )
          : entry,
    );
  function descendants(id, data = model) {
    const ids = new Set([id]);
    let changed;
    do {
      changed = false;
      for (const n of data.Nodes)
        if (ids.has(n.ParentId) && !ids.has(n.Id)) {
          ids.add(n.Id);
          changed = true;
        }
    } while (changed);
    return ids;
  }
  function path(id) {
    const names = [],
      seen = new Set();
    let n = getNode(id);
    while (n && !seen.has(n.Id)) {
      seen.add(n.Id);
      names.unshift(n.Name);
      n = getNode(n.ParentId);
    }
    return names.join(' / ');
  }
  function rootOf(id) {
    let n = getNode(id);
    const seen = new Set();
    while (n?.ParentId && !seen.has(n.Id)) {
      seen.add(n.Id);
      n = getNode(n.ParentId);
    }
    return n;
  }
  function expandPath(id) {
    let n = getNode(id);
    while (n && !expanded.has(n.Id)) {
      expanded.add(n.Id);
      n = getNode(n.ParentId);
    }
  }
  function references(row) {
    const entries = [
      ...(row.Items || []),
      ...(row.MediaLinkIds || [])
        .map((id) => model.MediaLinks.find((l) => l.Id === id))
        .filter(Boolean),
    ];
    const ranks = new Map((row.MediaOrder || []).map((id, i) => [id, i]));
    return entries.sort((a, b) => (ranks.get(a.Id) ?? Infinity) - (ranks.get(b.Id) ?? Infinity));
  }
  function franchiseMedia(nodeId) {
    const assigned = new Set(model.Rows.flatMap((row) => row.MediaLinkIds)),
      links = model.MediaLinks.filter((link) => link.NodeId === nodeId && !assigned.has(link.Id))
        .sort((a, b) => a.Position - b.Position);
    return {
      Id: 'node:' + nodeId, Name: 'Franchise media', Items: [],
      MediaLinkIds: links.map((link) => link.Id), MediaOrder: links.map((link) => link.Id),
    };
  }
  function reference(rowId, id) {
    if (rowId.startsWith('node:')) {
      const node = getNode(rowId.slice(5)),
        ref = model.MediaLinks.find((l) => l.Id === id && l.NodeId === node?.Id);
      return ref ? { node, row: null, ref, direct: false } : null;
    }
    const row = getRow(rowId);
    if (!row) return null;
    const item = row.Items.find((i) => i.Id === id),
      link = model.MediaLinks.find((i) => i.Id === id && row.MediaLinkIds.includes(id));
    return item || link ? { row, ref: item || link, direct: !!item } : null;
  }
  function art(value) {
    return C.normalizeArtwork(value?.Artwork);
  }
  function newNode(parent, name) {
    return {
      Id: C.guid(),
      ParentId: parent,
      Name: name,
      NodeType: parent ? 'Custom' : 'Franchise',
      Overview: '',
      CollectionId: '',
      CollectionArtworkMode: 'Preserve',
      SortOrder: children(parent).length,
      Artwork: C.emptyArt(),
      AutoAddSources: [],
      AutoAddRows: [],
      AutoAddRecords: [],
      EpisodeFormat: 'Bundles',
    };
  }
  function newRow(parent, type, name) {
    return {
      Id: C.guid(),
      ParentNodeId: parent,
      Name: type === 'Custom' ? name : type,
      Category: type,
      RowType: C.rowTypeForCategory(type),
      SourceUrl: '',
      AutoAddSources: [],
      EpisodeFormat: '',
      SortOrder: rows(parent).length,
      NodeIds: [],
      MediaLinkIds: [],
      Items: [],
      MediaOrder: [],
    };
  }
  function remember() {
    history.push(C.clone(model));
    if (history.length > 40) history.shift();
  }
  function markDirty() {
    dirty = true;
    revision++;
    $('save-state').textContent = 'Unsaved changes';
    $('save-state').classList.add('dirty');
    $('undo').disabled = !history.length;
  }
  function change(action) {
    if (saving) throw Error('Wait for the configuration save to finish.');
    const before = C.clone(model);
    action();
    try {
      model = C.normalize(model);
    } catch (error) {
      model = before;
      throw error;
    }
    history.push(before);
    if (history.length > 40) history.shift();
    markDirty();
    render();
  }
  let notificationTimer;
  function notify(message, error = false) {
    const box = $('toast');
    (document.activeElement?.closest('dialog') || page).append(box);
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = false;
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => (box.hidden = true), 4500);
  }
  async function attempt(action) {
    try {
      return await action();
    } catch (error) {
      notify(error.message || 'The operation failed.', true);
      return null;
    }
  }
  function headers() {
    const token = typeof ApiClient.accessToken === 'function' ? ApiClient.accessToken() : '';
    return token ? { Authorization: 'MediaBrowser Token="' + token + '"' } : {};
  }
  function serverUrl(route, query) {
    return ApiClient.getUrl(route.replace(/^\//, ''), query);
  }
  async function request(route, options = {}) {
    const response = await fetch(serverUrl(route), {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
      signal: options.signal || AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      let message = '';
      try {
        const body = await response.json();
        message = body.error || body.Error || body.message || '';
      } catch (_) {}
      throw Error(message || 'Jellyfin returned HTTP ' + response.status);
    }
    return response.status === 204 ? null : response.json();
  }
  async function items(params) {
    const uid = ApiClient.getCurrentUserId?.();
    if (ApiClient.getItems) return ApiClient.getItems(uid, params);
    return request('Items?' + new URLSearchParams({ ...params, userId: uid || '' }));
  }
  async function item(id) {
    if (!C.validGuid(id)) return null;
    const key = id.replace(/-/g, '').toLowerCase();
    if (!itemCache.has(key)) {
      const pending = Promise.resolve().then(() => ApiClient.getItem
          ? ApiClient.getItem(ApiClient.getCurrentUserId?.(), id)
          : request(
              'Items/' + id + '?userId=' + encodeURIComponent(ApiClient.getCurrentUserId?.() || ''),
            )
        ).catch(() => null).then((media) => {
          if (!media && itemCache.get(key) === pending) itemCache.delete(key);
          return media;
        });
      itemCache.set(key, pending);
    }
    return itemCache.get(key);
  }
  function imageAddress(route) {
    if (!route) throw Error('No artwork was selected.');
    C.artRef(route);
    const u = new URL(route, location.origin);
    // Preserve remote HTTPS artwork without forwarding the Jellyfin token.
    if (u.origin !== location.origin) {
      if (u.protocol !== 'https:') throw Error('Artwork must use HTTPS.');
      return { remote: u.href };
    }
    const prefix = new URL(serverUrl('FranchiseExplorer/Browse'), location.origin).pathname.replace(
      /\/FranchiseExplorer\/Browse$/,
      '',
    );
    const stripped =
      prefix && u.pathname.startsWith(prefix + '/') ? u.pathname.slice(prefix.length) : u.pathname;
    if (!/^\/(?:Items\/|FranchiseExplorer\/Artwork\/)/i.test(stripped))
      throw Error('This artwork path is not supported.');
    if (/^\/Items\/[a-f\d-]+\/Images\//i.test(stripped)) {
      for (const name of ['maxWidth', 'maxHeight']) {
        const key = [...u.searchParams.keys()].find((entry) => entry.toLowerCase() === name.toLowerCase()) || name,
          value = Number(u.searchParams.get(key));
        if (!Number.isFinite(value) || value <= 0 || value > 1200) u.searchParams.set(key, '1200');
      }
    }
    return { url: serverUrl(stripped + u.search) };
  }
  async function image(route) {
    const address = imageAddress(route);
    if (address.remote) return address.remote;
    const url = address.url;
    if (!blobCache.has(url)) {
      const pending = fetch(url, { headers: headers(), signal: AbortSignal.timeout(45000) })
        .then(async (response) => {
          if (!response.ok) {
            const advice = response.status === 401 || response.status === 403
              ? ' Sign in again and check your library access.' : ' Select it again to retry.';
            throw Error('Artwork could not be loaded (HTTP ' + response.status + ').' + advice);
          }
          const blob = await response.blob();
          if (!blob.type.toLowerCase().startsWith('image/'))
            throw Error('Jellyfin returned a non-image response for this artwork. Select it again to retry.');
          return blob;
        })
        .catch((error) => {
          if (blobCache.get(url) === pending) blobCache.delete(url);
          throw error;
        });
      blobCache.set(url, pending);
    }
    return blobCache.get(url);
  }
  async function forgetImage(route, source) {
    if (!source) return;
    try {
      const { url } = imageAddress(route),
        cached = url && blobCache.get(url);
      if (cached && await cached === source && blobCache.get(url) === cached) blobCache.delete(url);
    } catch (_) { /* No cached image exists for an invalid path. */ }
  }
  async function persist() {
    if (!loaded) throw Error('Wait for the plugin configuration to load.');
    if (saving || automation?.isBusy()) throw Error('Wait for the current server operation to finish.');
    saving = true;
    try {
      const latest = await ApiClient.getPluginConfiguration(pluginId), normalized = C.normalize(latest);
      if (fingerprint(normalized) !== baseline)
        throw Error('The saved configuration changed on the server. Reload before saving your edits.');
      const safe = C.normalize(model), next = {
        ...latest,
        NavigationLabel: safe.NavigationLabel, Nodes: safe.Nodes, Rows: safe.Rows,
        MediaLinks: safe.MediaLinks, ImdbLists: safe.ImdbLists,
        AutoFranchises: safe.AutoFranchises, MediaRecovery: safe.MediaRecovery,
      };
      await ApiClient.updatePluginConfiguration(pluginId, next);
      model = C.normalize(await ApiClient.getPluginConfiguration(pluginId));
      baseline = fingerprint(model);
      dirty = false;
      $('save-state').textContent = 'All changes saved';
      $('save-state').classList.remove('dirty');
      render();
      void automation?.afterLoad();
      notify('Configuration saved');
    } finally { saving = false; }
  }
  async function load(reload = false) {
    const raw = await ApiClient.getPluginConfiguration(pluginId),
      next = C.normalize(raw);
    if (reload && loaded) remember();
    model = next;
    itemCache.clear();
    baseline = fingerprint(next);
    loaded = true;
    dirty = false;
    revision++;
    $('save-state').textContent = 'All changes saved';
    $('save-state').classList.remove('dirty');
    $('save').disabled = false;
    render();
    void automation?.afterLoad();
  }

  function grip(kind, id, name, parent = '') {
    return (
      '<button class="grip" data-drag-kind="' +
      kind +
      '" data-drag-id="' +
      id +
      (parent ? '" data-drag-parent="' + esc(parent) : '') +
      '" aria-label="Move ' +
      esc(name) +
      '" data-help="' +
      (kind === 'item'
        ? 'Drag up or down within this row. Press Enter for position choices, or Alt+Up/Down to move one place.'
        : 'Drag to rearrange, or press Enter for placement options.') +
      '">' +
      icon('grip') +
      '</button>'
    );
  }
  function action(kind, id, name, operation, glyph) {
    return (
      '<button class="icon-button quiet node-menu ' +
      (operation === 'delete' ? 'danger' : '') +
      '" data-' +
      operation +
      '-' +
      kind +
      '="' +
      id +
      '" aria-label="' +
      esc(operation + ' ' + name) +
      '">' +
      icon(glyph) +
      '</button>'
    );
  }
  function actions(kind, id, name) {
    return (
      '<div class="' +
      (kind === 'row' ? 'row-actions' : 'node-actions') +
      '">' +
      action(kind, id, name, 'settings', 'gear') +
      action(kind, id, name, 'add', 'add') +
      action(kind, id, name, 'delete', 'trash') +
      '</div>'
    );
  }
  function refName(ref) {
    const sn = (n) => 'S' + String(n).padStart(2, '0'),
      en = (n) => 'E' + String(n).padStart(2, '0');
    let name = ref.DisplayName || itemCache.get(ref.JellyfinItemId)?.Name || 'Jellyfin media';
    if (ref.ItemType === 'Series' && ref.RangeMode === 'Seasons')
      name +=
        ' · ' +
        sn(ref.StartSeason) +
        (ref.EndSeason === ref.StartSeason ? '' : '–' + sn(ref.EndSeason));
    if (ref.ItemType === 'Series' && ref.RangeMode === 'Episodes') {
      const a = sn(ref.StartSeason) + en(ref.StartEpisode),
        b = sn(ref.EndSeason) + en(ref.EndEpisode);
      name += ' · ' + a + (a === b ? '' : '–' + b);
    }
    return name;
  }
  function mediaList(row, manage) {
    const refs = references(row),
      reorderable = !!getRow(row.Id);
    return refs.length
      ? '<div class="media-list"' +
          (reorderable ? ' data-media-list="' + row.Id + '"' : '') +
          '>' +
          refs
            .map(
              (ref) =>
                '<div class="media-entry ' +
                (manage ? '' : 'media-readonly') +
                '" data-media-item="' +
                ref.Id +
                '"' +
                (reorderable ? ' data-drop="media" data-media-row="' + row.Id + '"' : '') +
                '>' +
                (reorderable ? grip('item', ref.Id, refName(ref), row.Id) : '') +
                icon(
                  ref.ItemType === 'Series' ? 'tv' : ref.ItemType === 'BoxSet' ? 'box' : 'film',
                ) +
                '<span class="media-title">' +
                esc(refName(ref)) +
                '<span class="media-availability" data-media-native-id="' +
                esc(ref.JellyfinItemId) + '" data-media-reference-id="' + ref.Id + '" hidden></span>' +
                '</span>' +
                (manage
                  ? '<div class="media-actions"><button class="quiet recover-reference" data-recover-reference="' +
                    ref.Id + '" hidden>Review reference</button>' +
                    '<button class="icon-button quiet" data-settings-item="' +
                    ref.Id +
                    '" data-item-row="' +
                    row.Id +
                    '" aria-label="Artwork for ' +
                    esc(refName(ref)) +
                    '">' +
                    icon('gear') +
                    '</button>' +
                    (ref.ItemType === 'Series'
                      ? '<button class="quiet edit-range" data-edit-library-item="' +
                        ref.Id +
                        '" data-item-row="' +
                        row.Id +
                        '">Edit range</button>'
                      : '') +
                    '<button class="icon-button quiet danger" data-remove-item="' +
                    ref.Id +
                    '" data-item-row="' +
                    row.Id +
                    '" aria-label="Remove ' +
                    esc(refName(ref)) +
                    '">' +
                    icon('trash') +
                    '</button></div>'
                  : '') +
                '</div>',
            )
            .join('') +
          '</div>'
      : '<div class="empty-media">No media added</div>';
  }
  function resolveMediaAvailability(scope) {
    for (const label of scope.querySelectorAll('[data-media-native-id]')) {
      void item(label.dataset.mediaNativeId).then((media) => {
        if (!label.isConnected) return;
        const status = automation?.referenceStatus?.(label.dataset.mediaReferenceId),
          needsReview = !media || !!status && status !== 'Healthy';
        label.hidden = !needsReview;
        label.textContent = !media ? 'Unavailable in Jellyfin' : needsReview ? 'Reference needs review' : '';
        label.title = needsReview ? 'This saved reference is retained. Check Media Recovery before removing it.' : '';
        const action = label.closest('.media-entry')?.querySelector('[data-recover-reference]');
        if (action) action.hidden = !needsReview;
        scheduleBoardLayout();
      });
    }
  }
  function refreshMediaAvailability() {
    resolveMediaAvailability($('board'));
    if ($('media-dialog').open) resolveMediaAvailability($('media-current'));
  }
  const collapsedRows = new Set();
  function rowGroups(row) {
    return row.NodeIds.map(getNode).filter(Boolean);
  }
  function rowView(row, ancestors) {
    const groups = rowGroups(row),
      open = openRows.has(row.Id) || (groups.length > 0 && !collapsedRows.has(row.Id)),
      count = groups.length ? groups.length + ' groups' : references(row).length;
    return (
      '<div class="row-entry" data-row-entry="' +
      row.Id +
      '"><div class="tree-row" data-drop="row" data-id="' +
      row.Id +
      '">' +
      grip('row', row.Id, row.Name) +
      '<button class="expand" data-toggle-row="' +
      row.Id +
      '" aria-expanded="' +
      open +
      '" aria-label="Expand ' +
      esc(row.Name) +
      '" style="transform:rotate(' +
      (open ? 90 : 0) +
      'deg)">' +
      icon('chevron') +
      '</button><button class="tree-name" data-row-select="' +
      row.Id +
      '" data-help="' +
      esc(row.Name) +
      '">' +
      icon(typeIcon(category(row))) +
      '<span class="row-title-text">' +
      esc(row.Name) +
      '</span><span class="row-count">' +
      count +
      '</span></button>' +
      actions('row', row.Id, row.Name) +
      '</div>' +
      (open
        ? '<div class="row-contents">' +
          (groups.length
            ? '<div class="row-groups">' + groups.map((node) => nodeView(node, false, ancestors, row.Id)).join('') + '</div>'
            : '') +
          (references(row).length || !groups.length ? mediaList(row, false) : '') +
          '</div>'
        : '') +
      '</div>'
    );
  }
  function nodeView(node, root = true, ancestors = new Set(), rowId = '') {
    // Membership is a presentation reference. Keep ownership in ParentId and
    // guard each rendering path independently so a node can appear in two rows.
    if (ancestors.has(node.Id)) return '<div class="empty-media">Group already shown in this path</div>';
    const branch = new Set(ancestors).add(node.Id),
      ownedRows = rows(node.Id),
      unassignedMedia = franchiseMedia(node.Id),
      assigned = new Set(ownedRows.flatMap((row) => row.NodeIds));
    const open = expanded.has(node.Id),
      tag = root ? 'article' : 'div';
    return (
      '<' +
      tag +
      ' class="' +
      (root ? 'node-card' : 'subgroup') +
      (selected === node.Id ? ' selected' : '') +
      '" data-drop="node" data-id="' +
      node.Id +
      '" data-axis="' +
      (root ? 'grid' : 'y') +
      (rowId ? '" data-group-row="' + rowId : '') +
      '"><div class="node-head">' +
      grip('node', node.Id, node.Name, rowId) +
      '<button class="expand" data-expand="' +
      node.Id +
      '" aria-expanded="' +
      open +
      '" aria-label="Expand ' +
      esc(node.Name) +
      '" style="transform:rotate(' +
      (open ? 90 : 0) +
      'deg)">' +
      icon('chevron') +
      '</button><button class="node-title" data-select="' +
      node.Id +
      '" data-help="' +
      esc(node.Name) +
      '">' +
      esc(node.Name) +
      '</button>' +
      actions('node', node.Id, node.Name) +
      '</div>' +
      (open
        ? '<div class="' +
          (root ? 'node-body' : 'subgroup-body') +
          '">' +
          ownedRows.map((row) => rowView(row, branch)).join('') +
          (unassignedMedia.MediaLinkIds.length
            ? '<section class="franchise-media" data-node-media="' + node.Id +
              '"><h4>Franchise media · ' + unassignedMedia.MediaLinkIds.length + '</h4>' +
              mediaList(unassignedMedia, true) + '</section>' : '') +
          children(node.Id)
            .filter((child) => !assigned.has(child.Id))
            .map((child) => nodeView(child, false, branch))
            .join('') +
          '</div>'
        : '') +
      '<div class="drop-inside" data-drop="inside" data-id="' +
      node.Id +
      '">Move inside ' +
      esc(node.Name) +
      '</div></' +
      tag +
      '>'
    );
  }
  let boardLayoutFrame = 0;
  const boardResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => scheduleBoardLayout()) : null;
  function scheduleBoardLayout() {
    if (!boardLayoutFrame) boardLayoutFrame = requestAnimationFrame(layoutBoard);
  }
  function layoutBoard() {
    boardLayoutFrame = 0;
    const board = $('board');
    if (!board?.isConnected || !board.clientWidth) return;
    const cards = [...board.querySelectorAll(':scope > .node-card')],
      gap = 12,
      width = board.clientWidth,
      columns = Math.max(1, Math.floor((width + gap) / (330 + gap))),
      cardWidth = (width - gap * (columns - 1)) / columns,
      heights = Array(columns).fill(0);
    // Absolute positions preserve the saved DOM and tab sequence. Reading each
    // card after setting its width also accounts for wrapped mobile titles.
    for (const card of cards) {
      const value = cardWidth + 'px';
      if (!card.style.width || Math.abs(parseFloat(card.style.width) - cardWidth) > .001) card.style.width = value;
      const column = heights.indexOf(Math.min(...heights)),
        position = 'translate(' + Number((column * (cardWidth + gap)).toFixed(3)) + 'px, ' + heights[column] + 'px)';
      if (card.style.transform !== position) card.style.transform = position;
      heights[column] += card.getBoundingClientRect().height + gap;
    }
    const height = Math.max(85, Math.max(...heights) - gap) +
      (page.classList.contains('is-dragging') && !page.classList.contains('is-dragging-media') ? 72 : 0),
      value = height + 'px';
    if (!board.style.height || Math.abs(parseFloat(board.style.height) - height) > .001) board.style.height = value;
  }
  function render() {
    const active = $('board').contains(document.activeElement) ? document.activeElement : null,
      focused = active ? { data: { ...active.dataset }, row: active.closest('[data-group-row]')?.dataset.groupRow || '' } : null,
      roots = children('');
    $('franchise-count').textContent = roots.length + ' franchises';
    $('board').innerHTML =
      roots.map((n) => nodeView(n)).join('') +
      '<div class="board-drop" data-drop="root">Move to top level</div>' +
      (roots.length ? '' : '<div class="empty">No franchises. Add a franchise to begin.</div>');
    boardResize?.disconnect();
    boardResize?.observe($('board'));
    $('board').querySelectorAll(':scope > .node-card').forEach((card) => boardResize?.observe(card));
    resolveMediaAvailability($('board'));
    scheduleBoardLayout();
    if (focused) [...$('board').querySelectorAll('button')].find((button) =>
      (button.closest('[data-group-row]')?.dataset.groupRow || '') === focused.row &&
      Object.entries(focused.data).every(([key, value]) => button.dataset[key] === value))?.focus({ preventScroll: true });
    $('undo').disabled = !history.length;
    renderSavedLists();
    automation?.render();
    if ($('media-dialog').open) renderMedia(true);
  }
  function show(id) {
    hideHelp();
    if (!$(id).open) $(id).showModal();
  }
  function undo() {
    if (!history.length) return;
    model = history.pop();
    markDirty();
    render();
    notify('Edit undone');
  }
  $('undo').onclick = undo;
  $('media-undo').onclick = undo;
  $('save').onclick = () => attempt(persist);
  $('reset').onclick = () => attempt(() => load(true));
  $('save').disabled = true;
  $('add-franchise').onclick = () => {
    if (!loaded) return;
    $('new-name').value = '';
    $('new-description').value = '';
    $('new-name').setCustomValidity('');
    show('new-franchise-dialog');
    $('new-name').focus();
  };
  $('new-name').oninput = () => $('new-name').setCustomValidity('');
  $('create-manual').onclick = () =>
    attempt(() => {
      const name = $('new-name').value.trim();
      if (!name || children('').some((n) => n.Name.toLowerCase() === name.toLowerCase())) {
        $('new-name').setCustomValidity(name ? 'This franchise already exists.' : 'Enter a name.');
        $('new-name').reportValidity();
        return;
      }
      const node = newNode('', name);
      node.Overview = $('new-description').value;
      change(() => model.Nodes.push(node));
      selected = node.Id;
      expanded.add(node.Id);
      $('new-franchise-dialog').close();
      render();
    });

  function stageFields(draft) {
    draft.pendingRows ||= [];
    draft.pendingGroups ||= [];
    return draft;
  }
  function pending(draft) {
    return !!(draft.pendingRows?.length || draft.pendingGroups?.length);
  }
  function applyStructure(data, draft) {
    for (const row of draft.pendingRows || [])
      if (!data.Rows.some((r) => r.Id === row.Id)) data.Rows.push(C.clone(row));
    for (const node of draft.pendingGroups || [])
      if (!data.Nodes.some((n) => n.Id === node.Id)) data.Nodes.push(C.clone(node));
  }
  function pendingView() {
    for (const [id, draft] of [
      ['franchise-pending-structure', nodeDraft],
      ['row-pending-structure', rowDraft],
    ])
      $(id).innerHTML =
        draft && pending(draft)
          ? '<span class="pending-caption">To be added when saved</span><ul>' +
            [...draft.pendingRows.map((r) => r.Name), ...draft.pendingGroups.map((n) => n.Name)]
              .map((name) => '<li>' + esc(name) + '</li>')
              .join('') +
            '</ul>'
          : '';
  }
  let editingImdbList = '', sourcePicker = null;
  const canonicalSource = (value) => {
    try { return C.autoAdd.url(value); } catch (_) { return ''; }
  };
  function renderSavedLists() {
    $('saved-imdb-lists').innerHTML = (model.ImdbLists || []).map((list) =>
      '<div class="imdb-list-card"><div><strong>' + esc(list.Name) + '</strong><small>' +
      esc(list.Url) + (list.Enabled ? '' : ' · Unavailable for new selections') +
      '</small></div><div class="button-row"><button class="icon-button quiet" data-edit-imdb-list="' +
      list.Id + '" aria-label="Edit ' + esc(list.Name) + '">' + icon('gear') +
      '</button><button class="icon-button danger" data-delete-imdb-list="' + list.Id +
      '" aria-label="Delete saved list ' + esc(list.Name) + '">' + icon('trash') + '</button></div></div>',
    ).join('') || '<div class="empty">No saved IMDb lists.</div>';
  }
  function openImdbList(id = '') {
    const list = (model.ImdbLists || []).find((entry) => entry.Id === id);
    editingImdbList = id;
    $('imdb-list-heading').textContent = id ? 'Edit IMDb list' : 'Add IMDb list';
    $('imdb-list-name').value = list?.Name || '';
    $('imdb-list-url').value = list?.Url || '';
    $('imdb-list-enabled').checked = list?.Enabled !== false;
    show('imdb-list-dialog');
    $('imdb-list-name').focus();
  }
  $('add-imdb-list').onclick = () => openImdbList();
  $('saved-imdb-lists').onclick = (event) => {
    const edit = event.target.closest('[data-edit-imdb-list]'),
      remove = event.target.closest('[data-delete-imdb-list]');
    if (edit) openImdbList(edit.dataset.editImdbList);
    if (remove) {
      change(() => { model.ImdbLists = model.ImdbLists.filter((entry) => entry.Id !== remove.dataset.deleteImdbList); });
      notify('Saved list removed. Assigned Auto Add sources are preserved.');
    }
  };
  $('save-imdb-list').onclick = () => attempt(() => {
    const previous = (model.ImdbLists || []).find((entry) => entry.Id === editingImdbList),
      value = { ...(previous || {}), Id: previous?.Id || C.guid(),
        Name: $('imdb-list-name').value.trim(), Url: $('imdb-list-url').value.trim(),
        Enabled: $('imdb-list-enabled').checked },
      lists = (model.ImdbLists || []).map((entry) => entry.Id === editingImdbList ? value : entry);
    if (!previous) lists.push(value);
    const safe = C.normalizeImdbLists(lists);
    change(() => { model.ImdbLists = safe; });
    $('imdb-list-dialog').close();
    notify('IMDb list staged. Save changes to persist.');
  });
  function sourceSummary(sources) {
    return (sources || []).filter((source) => source.Enabled !== false).map((source) =>
      (model.ImdbLists || []).find((list) => canonicalSource(list.Url) === canonicalSource(source.Url))?.Name || source.Url,
    ).join(' · ') || 'No IMDb sources selected';
  }
  function rowSources(row) {
    if (row.AutoAddSources?.length) return row.AutoAddSources;
    return row.SourceUrl ? [{ Id: C.guid(), Url: row.SourceUrl, Enabled: true, Priority: 0,
      Categories: [C.categoryToAutoAdd(category(row))].filter(Boolean) }] : [];
  }
  function setPrimarySource(previous, value, categories) {
    const first = previous.find((source) => source.Enabled !== false) || previous[0];
    if (!value.trim()) return previous.filter((source) => source !== first);
    const duplicate = previous.find((source) => source !== first && canonicalSource(source.Url) &&
      canonicalSource(source.Url) === canonicalSource(value));
    if (duplicate) return previous.filter((source) => source !== first);
    return [{ ...(first || {}), Id: first?.Id || C.guid(), Url: value.trim(), Enabled: true,
      Priority: first?.Priority || 0, Categories: first?.Categories?.length ? first.Categories : categories },
      ...previous.filter((source) => source !== first)];
  }
  function pickerSources(target) {
    if (target.kind === 'node') return nodeDraft?.sourceNodes[target.id] || [];
    if (target.kind === 'node-row') return nodeDraft?.sourceRows[target.id]?.AutoAddSources || [];
    return rowDraft?.row.AutoAddSources || [];
  }
  function openSourcePicker(target) {
    sourcePicker = target;
    const assigned = new Set(pickerSources(target).map((source) => canonicalSource(source.Url)));
    $('imdb-source-options').innerHTML = (model.ImdbLists || []).map((list) => {
      const selected = assigned.has(canonicalSource(list.Url));
      return '<label class="saved-source-option"><input type="checkbox" data-saved-imdb-list="' +
        list.Id + '"' + (selected ? ' checked' : '') + (!list.Enabled && !selected ? ' disabled' : '') +
        '><span>' + esc(list.Name) + '<small>' + esc(list.Url) +
        (!list.Enabled ? ' · Unavailable for new selections' : '') + '</small></span></label>';
    }).join('') || '<div class="empty">Add named lists under Settings → Advanced settings.</div>';
    show('imdb-source-picker');
  }
  $('imdb-source-picker').addEventListener('close', () => { sourcePicker = null; });
  $('use-imdb-sources').onclick = () => attempt(() => {
    const target = sourcePicker;
    if (!target) return;
    const previous = pickerSources(target),
      presets = model.ImdbLists || [],
      known = new Set(presets.map((list) => canonicalSource(list.Url))),
      picked = new Set([...$('imdb-source-options').querySelectorAll('[data-saved-imdb-list]:checked')]
        .map((input) => input.dataset.savedImdbList)),
      categories = target.kind === 'node'
        ? ['Chronological Timeline', 'Movies', 'TV Shows', 'Collections']
        : [C.categoryToAutoAdd(category(target.kind === 'row' ? rowDraft.row : getRow(target.id)))].filter(Boolean),
      next = previous.filter((source) => !known.has(canonicalSource(source.Url)));
    for (const list of presets.filter((entry) => picked.has(entry.Id))) {
      const existing = previous.find((source) => canonicalSource(source.Url) === canonicalSource(list.Url));
      next.push(existing ? C.clone(existing) : { Id: C.guid(), Url: list.Url, Enabled: true,
        Priority: next.length, Categories: categories });
    }
    const sources = C.autoAdd.sources(next);
    if (target.kind === 'node') {
      if (!nodeDraft) return;
      nodeDraft.sourceNodes[target.id] = sources;
      if (target.id === nodeDraft.node.Id) $('franchise-imdb-url').value = sources.find((s) => s.Enabled)?.Url || '';
      renderSources();
    } else {
      const row = target.kind === 'row' ? rowDraft?.row : nodeDraft?.sourceRows[target.id];
      if (!row) return;
      row.AutoAddSources = sources;
      row.SourceUrl = sources.find((source) => source.Enabled)?.Url || '';
      if (target.kind === 'row') renderRowSources();
      else renderSources();
    }
    autoGeneration++;
    $('imdb-source-picker').close();
  });
  $('choose-franchise-imdb-lists').onclick = () => {
    if (nodeDraft) openSourcePicker({ kind: 'node', id: nodeDraft.node.Id });
  };
  $('choose-row-imdb-lists').onclick = () => {
    if (rowDraft) openSourcePicker({ kind: 'row', id: rowDraft.row.Id });
  };
  function openNode(id) {
    const node = getNode(id);
    if (!node) return;
    selected = id;
    nodeDraft = stageFields({ node: C.clone(node), sourceNodes: {}, sourceRows: {} });
    for (const n of model.Nodes.filter((n) => descendants(id).has(n.Id)))
      nodeDraft.sourceNodes[n.Id] = C.clone(n.AutoAddSources || []);
    for (const row of model.Rows.filter((r) => descendants(id).has(r.ParentNodeId)))
      nodeDraft.sourceRows[row.Id] = { SourceUrl: row.SourceUrl || '', AutoAddSources: C.clone(rowSources(row)),
        EpisodeFormat: row.EpisodeFormat || '' };
    $('detail-title').value = node.Name;
    $('detail-description').value = node.Overview;
    $('detail-title').setCustomValidity('');
    $('franchise-scope').textContent = path(id);
    $('franchise-structure-owner').textContent = 'Add to ' + path(id);
    $('franchise-advanced').open = false;
    $('franchise-imdb-fields').hidden = true;
    $('franchise-auto-add').setAttribute('aria-expanded', 'false');
    $('franchise-imdb-url').value =
      node.AutoAddSources?.find((s) => s.Enabled !== false)?.Url || '';
    $('franchise-episode-format').value = node.EpisodeFormat || 'Bundles';
    renderSources();
    pendingView();
    artwork.render(
      $('franchise-photos'),
      { kind: 'node', id },
      nodeDraft.node.Artwork,
      (value) => (nodeDraft.node.Artwork = value),
    );
    render();
    show('franchise-dialog');
    $('franchise-dialog').querySelector('.dialog-content').scrollTop = 0;
    $('detail-title').focus({ preventScroll: true });
  }
  function renderSources() {
    if (!nodeDraft) return;
    $('franchise-source-summary').textContent = sourceSummary(nodeDraft.sourceNodes[nodeDraft.node.Id]);
    const branch = descendants(nodeDraft.node.Id);
    $('source-list').innerHTML = model.Nodes.filter((n) => branch.has(n.Id))
      .map(
        (n) =>
          '<section class="source-group"><h3 class="source-heading">' +
          esc(path(n.Id)) +
          '</h3><label class="field"><span>IMDb URL</span><input type="url" data-source-node="' +
          n.Id +
          '" value="' +
          esc(nodeDraft.sourceNodes[n.Id]?.find((s) => s.Enabled !== false)?.Url || '') +
          '" placeholder="https://www.imdb.com/list/ls…/"></label><button data-choose-source-node="' +
          n.Id + '">Choose saved lists</button><div class="saved-source-summary">' +
          esc(sourceSummary(nodeDraft.sourceNodes[n.Id])) + '</div>' +
          rows(n.Id)
            .map(
              (row) =>
                '<label class="field"><span>' +
                esc(row.Name) +
                ' · Row URL</span><input type="url" data-source-row="' +
                row.Id +
                '" value="' +
                esc(nodeDraft.sourceRows[row.Id]?.SourceUrl || '') +
                '" placeholder="Optional row source"></label><button data-choose-source-row="' + row.Id +
                '">Choose saved lists for ' + esc(row.Name) + '</button><div class="saved-source-summary">' +
                esc(sourceSummary(nodeDraft.sourceRows[row.Id]?.AutoAddSources)) + '</div>' +
                (category(row) === 'Chronological Order' ? '<label class="field"><span>' + esc(row.Name) +
                  ' · Episode format</span><select data-source-row-format="' + row.Id + '"><option value="">Use franchise setting</option>' +
                  ['Bundles', 'Individual'].map((format) => '<option value="' + format + '"' +
                    (nodeDraft.sourceRows[row.Id]?.EpisodeFormat === format ? ' selected' : '') + '>' +
                    (format === 'Bundles' ? 'Episode bundles' : 'Individual episodes') + '</option>').join('') + '</select></label>' : ''),
            )
            .join('') +
          '</section>',
      )
      .join('');
  }
  function updateNodeSource(id, value) {
    if (!nodeDraft) return;
    nodeDraft.sourceNodes[id] = setPrimarySource(nodeDraft.sourceNodes[id] || [], value,
      ['Chronological Timeline', 'Movies', 'TV Shows', 'Collections']);
    $('franchise-source-summary').textContent = sourceSummary(nodeDraft.sourceNodes[nodeDraft.node.Id]);
  }
  $('source-list').oninput = (e) => {
    if (!nodeDraft) return;
    e.target.setCustomValidity('');
    if (e.target.dataset.sourceNode) {
      updateNodeSource(e.target.dataset.sourceNode, e.target.value);
      if (e.target.dataset.sourceNode === nodeDraft.node.Id)
        $('franchise-imdb-url').value = e.target.value;
    }
    if (e.target.dataset.sourceRow) {
      const id = e.target.dataset.sourceRow, row = nodeDraft.sourceRows[id];
      row.AutoAddSources = setPrimarySource(row.AutoAddSources || [], e.target.value,
        [C.categoryToAutoAdd(category(getRow(id)))].filter(Boolean));
      row.SourceUrl = e.target.value;
    }
  };
  $('source-list').onclick = (event) => {
    const node = event.target.closest('[data-choose-source-node]'),
      row = event.target.closest('[data-choose-source-row]');
    if (node) openSourcePicker({ kind: 'node', id: node.dataset.chooseSourceNode });
    if (row) openSourcePicker({ kind: 'node-row', id: row.dataset.chooseSourceRow });
  };
  $('source-list').onchange = (event) => {
    const id = event.target.dataset.sourceRowFormat;
    if (id && nodeDraft) nodeDraft.sourceRows[id].EpisodeFormat = event.target.value;
  };
  $('franchise-imdb-url').oninput = () => {
    if (!nodeDraft) return;
    updateNodeSource(nodeDraft.node.Id, $('franchise-imdb-url').value);
    const linked = $('source-list').querySelector('[data-source-node="' + nodeDraft.node.Id + '"]');
    if (linked) linked.value = $('franchise-imdb-url').value;
  };
  $('detail-title').oninput = () => $('detail-title').setCustomValidity('');
  $('franchise-episode-format').onchange = () => {
    if (nodeDraft) nodeDraft.node.EpisodeFormat = $('franchise-episode-format').value;
  };
  function nodeDraftModel() {
    if (!nodeDraft) throw Error('Open a franchise first.');
    const next = C.clone(model),
      node = next.Nodes.find((n) => n.Id === nodeDraft.node.Id);
    if (!node) throw Error('This franchise no longer exists.');
    const title = $('detail-title').value.trim();
    if (!title) {
      $('detail-title').setCustomValidity('Enter a title.');
      $('detail-title').reportValidity();
      return null;
    }
    Object.assign(node, C.clone(nodeDraft.node), {
      Name: title,
      Overview: $('detail-description').value,
    });
    for (const [id, sources] of Object.entries(nodeDraft.sourceNodes)) {
      const n = next.Nodes.find((n) => n.Id === id);
      if (n) n.AutoAddSources = C.autoAdd.sources(sources);
    }
    for (const [id, settings] of Object.entries(nodeDraft.sourceRows)) {
      const row = next.Rows.find((r) => r.Id === id);
      if (row) Object.assign(row, { SourceUrl: settings.SourceUrl.trim() ? C.autoAdd.url(settings.SourceUrl) : '',
        AutoAddSources: C.autoAdd.sources(settings.AutoAddSources), EpisodeFormat: settings.EpisodeFormat || '' });
    }
    applyStructure(next, nodeDraft);
    return C.normalize(next);
  }
  $('save-franchise').onclick = () =>
    attempt(() => {
      const next = nodeDraftModel();
      if (!next) return;
      if (fingerprint(next) !== fingerprint(model)) {
        remember();
        model = next;
        markDirty();
        render();
      }
      $('franchise-dialog').close();
    });
  $('franchise-dialog').addEventListener('close', () => (nodeDraft = null));
  $('franchise-auto-add').onclick = () => {
    $('franchise-imdb-fields').hidden = false;
    $('franchise-auto-add').setAttribute('aria-expanded', 'true');
    $('franchise-imdb-url').focus();
  };
  function renderRowDraft() {
    if (!rowDraft) return;
    const row = rowDraft.row,
      type = category(row);
    $('edit-row-type').innerHTML = C.categories
      .map((c) => '<option' + (c === type ? ' selected' : '') + '>' + esc(c) + '</option>')
      .join('');
    $('edit-row-custom-field').hidden = type !== 'Custom';
    $('edit-row-custom').value = rowDraft.customName;
    $('edit-row-group-field').hidden = type !== 'Sub Group';
    $('edit-row-group-name').value = rowDraft.groupName;
    $('row-structure-tools').hidden = !rowDraft.originalId;
    $('row-structure-owner').textContent = 'Add to ' + path(row.ParentNodeId);
    $('row-auto-settings').hidden = type === 'Sub Group';
    $('row-format-field').hidden = type !== 'Chronological Order';
    renderRowSources();
    artwork.render(
      $('row-photos'),
      { kind: 'row', id: row.Id, parentId: row.ParentNodeId, category: type },
      row.Artwork,
      (value) => (row.Artwork = value),
    );
    pendingView();
  }
  function renderRowSources() {
    if (!rowDraft) return;
    $('row-imdb-url').value = rowDraft.row.SourceUrl || '';
    $('row-source-summary').textContent = sourceSummary(rowDraft.row.AutoAddSources);
    $('row-episode-format').value = rowDraft.row.EpisodeFormat || '';
  }
  $('row-auto-add').onclick = () => {
    $('row-imdb-fields').hidden = false;
    $('row-auto-add').setAttribute('aria-expanded', 'true');
    $('row-imdb-url').focus();
  };
  $('row-imdb-url').oninput = () => {
    if (!rowDraft) return;
    const row = rowDraft.row;
    row.AutoAddSources = setPrimarySource(row.AutoAddSources || [], $('row-imdb-url').value,
      [C.categoryToAutoAdd(category(row))].filter(Boolean));
    row.SourceUrl = $('row-imdb-url').value;
    $('row-source-summary').textContent = sourceSummary(row.AutoAddSources);
  };
  $('row-episode-format').onchange = () => {
    if (rowDraft) rowDraft.row.EpisodeFormat = $('row-episode-format').value;
  };
  function rowDraftModel() {
    if (!rowDraft) throw Error('Open a row first.');
    if (rowDraft.convert || category(rowDraft.row) === 'Sub Group')
      throw Error('Save the subgroup before using Auto Add.');
    const next = C.clone(model), row = C.clone(rowDraft.row);
    if (!row.Name.trim()) throw Error('Enter a row name.');
    applyStructure(next, rowDraft);
    const existing = next.Rows.find((entry) => entry.Id === row.Id);
    if (existing) Object.assign(existing, row);
    else next.Rows.push(row);
    return C.normalize(next);
  }
  function openRow(id = '', parent = selected) {
    const row = id ? getRow(id) : newRow(parent, 'Movies', 'Movies');
    if (!row) return;
    rowDraft = stageFields({
      row: C.clone(row),
      originalId: id,
      customName: row.Name,
      groupName: row.Name,
    });
    rowDraft.row.AutoAddSources = C.clone(rowSources(row));
    $('row-imdb-fields').hidden = true;
    $('row-auto-add').setAttribute('aria-expanded', 'false');
    $('row-heading').textContent = id ? 'Edit row' : 'Add group / row';
    $('row-owner').textContent = path(row.ParentNodeId);
    $('edit-row-custom').setCustomValidity('');
    $('edit-row-group-name').setCustomValidity('');
    renderRowDraft();
    show('row-dialog');
    $('row-dialog').querySelector('.dialog-content').scrollTop = 0;
    $('edit-row-type').focus({ preventScroll: true });
  }
  $('edit-row-type').onchange = () => {
    if (!rowDraft) return;
    const type = $('edit-row-type').value;
    rowDraft.convert =
      type === 'Sub Group' &&
      !!rowDraft.originalId &&
      category(getRow(rowDraft.originalId)) !== 'Sub Group';
    rowDraft.row.Category = type;
    rowDraft.row.RowType = C.rowTypeForCategory(type);
    rowDraft.row.Name = type === 'Custom' ? rowDraft.customName : type;
    renderRowDraft();
  };
  $('edit-row-custom').oninput = () => {
    if (rowDraft) {
      rowDraft.customName = $('edit-row-custom').value;
      rowDraft.row.Name = rowDraft.customName;
    }
    $('edit-row-custom').setCustomValidity('');
  };
  $('edit-row-group-name').oninput = () => {
    if (rowDraft) rowDraft.groupName = $('edit-row-group-name').value;
    $('edit-row-group-name').setCustomValidity('');
  };
  function convertRow() {
    if (!rowDraft) return;
    rowDraft.convert = true;
    rowDraft.groupName = rowDraft.row.Name;
    rowDraft.row.Category = 'Sub Group';
    rowDraft.row.RowType = 'Groups';
    renderRowDraft();
    $('edit-row-group-name').focus();
  }
  $('row-convert-subgroup').onclick = convertRow;
  $('save-row').onclick = () =>
    attempt(() => {
      if (!rowDraft) return;
      const draft = rowDraft,
        row = draft.row,
        type = category(row);
      if (type === 'Custom' && !row.Name.trim()) throw Error('Enter a custom name.');
      const next = C.clone(model);
      applyStructure(next, draft);
      if (type === 'Sub Group' && (!draft.originalId || draft.convert)) {
        const title = draft.groupName.trim();
        if (
          !title ||
          next.Nodes.some(
            (n) => n.ParentId === row.ParentNodeId && n.Name.toLowerCase() === title.toLowerCase(),
          )
        )
          throw Error(
            title ? 'A subgroup with that name already exists.' : 'Enter a subgroup name.',
          );
        const node = newNode(row.ParentNodeId, title);
        node.Artwork = C.clone(row.Artwork || C.emptyArt());
        if (draft.originalId) {
          const original = next.Rows.find((r) => r.Id === draft.originalId);
          const linked = new Set(original.MediaLinkIds);
          for (const other of next.Rows.filter(
            (r) => r.Id !== original.Id && r.ParentNodeId !== original.ParentNodeId,
          ))
            if (other.MediaLinkIds.some((id) => linked.has(id)))
              throw Error(
                'This row shares references with another subgroup. Move those references before converting it.',
              );
          for (const id of original.NodeIds) {
            const child = next.Nodes.find((n) => n.Id === id);
            if (child?.ParentId === original.ParentNodeId) child.ParentId = node.Id;
          }
          for (const id of original.MediaLinkIds) {
            const ref = next.MediaLinks.find((l) => l.Id === id);
            if (ref) ref.NodeId = node.Id;
          }
          original.ParentNodeId = node.Id;
        }
        next.Nodes.push(node);
        expanded.add(node.Id);
        expandPath(row.ParentNodeId);
      } else {
        if (type === 'Sub Group') row.Name = draft.groupName.trim() || row.Name;
        if (draft.originalId)
          Object.assign(
            next.Rows.find((r) => r.Id === draft.originalId),
            row,
          );
        else next.Rows.push(row);
      }
      const safe = C.normalize(next);
      if (fingerprint(safe) !== fingerprint(model)) {
        remember();
        model = safe;
        markDirty();
        expandPath(row.ParentNodeId);
        render();
      }
      $('row-dialog').close();
    });
  $('row-dialog').addEventListener('close', () => (rowDraft = null));
  function openStructure(source, kind) {
    const draft = source === 'franchise' ? nodeDraft : rowDraft;
    if (!draft) return;
    structure = {
      source,
      kind,
      draft,
      parent: source === 'franchise' ? draft.node.Id : draft.row.ParentNodeId,
    };
    $('structure-heading').textContent = kind === 'row' ? 'Add group / row' : 'Add subgroup';
    $('structure-owner').textContent = 'Add to ' + path(structure.parent);
    $('structure-type-field').hidden = kind !== 'row';
    $('structure-type').innerHTML = C.categories.map((c) => '<option>' + c + '</option>').join('');
    $('structure-type').value = 'Movies';
    $('structure-name').value = '';
    updateStructure();
    show('structure-dialog');
  }
  function updateStructure() {
    if (!structure) return;
    const isGroup = structure.kind !== 'row' || $('structure-type').value === 'Sub Group';
    $('structure-name-field').hidden = !isGroup && $('structure-type').value !== 'Custom';
    $('structure-name-label').textContent = isGroup ? 'Subgroup name' : 'Custom name';
    $('structure-name').setCustomValidity('');
  }
  $('structure-type').onchange = updateStructure;
  $('structure-name').oninput = () => $('structure-name').setCustomValidity('');
  $('confirm-structure').onclick = () =>
    attempt(() => {
      if (!structure) return;
      const { draft, parent, kind } = structure,
        type = $('structure-type').value,
        name = $('structure-name').value.trim(),
        group = kind !== 'row' || type === 'Sub Group';
      if ((group || type === 'Custom') && !name) throw Error('Enter a name.');
      if (group) {
        if (
          [...children(parent), ...draft.pendingGroups].some(
            (n) => n.Name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw Error('A subgroup with that name already exists.');
        const node = newNode(parent, name);
        draft.pendingGroups.push(node);
        if (structure.source === 'row') draft.row.NodeIds.push(node.Id);
      } else draft.pendingRows.push(newRow(parent, type, name));
      pendingView();
      $('structure-dialog').close();
    });
  $('structure-dialog').addEventListener('close', () => (structure = null));
  for (const [id, source, kind] of [
    ['franchise-add-row', 'franchise', 'row'],
    ['franchise-add-subgroup', 'franchise', 'group'],
    ['row-add-row', 'row', 'row'],
    ['row-add-subgroup', 'row', 'group'],
  ])
    $(id).onclick = () => openStructure(source, kind);
  function openSubgroup(parent, rowId = '') {
    subgroupParent = parent;
    subgroupRowId = rowId;
    $('subgroup-name').value = '';
    $('subgroup-name').setCustomValidity('');
    show('subgroup-dialog');
    $('subgroup-name').focus();
  }
  $('subgroup-name').oninput = () => $('subgroup-name').setCustomValidity('');
  $('confirm-subgroup').onclick = () =>
    attempt(() => {
      const name = $('subgroup-name').value.trim();
      if (
        !name ||
        children(subgroupParent).some((n) => n.Name.toLowerCase() === name.toLowerCase())
      ) {
        $('subgroup-name').setCustomValidity(
          name ? 'A subgroup with that name already exists.' : 'Enter a name.',
        );
        $('subgroup-name').reportValidity();
        return;
      }
      const node = newNode(subgroupParent, name), row = getRow(subgroupRowId);
      if (subgroupRowId && (!row || row.ParentNodeId !== subgroupParent))
        throw Error('The destination row no longer exists.');
      change(() => {
        model.Nodes.push(node);
        if (row) row.NodeIds.push(node.Id);
      });
      if (row) {
        collapsedRows.delete(row.Id);
        openRows.add(row.Id);
      }
      expandPath(subgroupParent);
      render();
      $('subgroup-dialog').close();
    });

  function searchState(kind, id) {
    const key = kind + ':' + id;
    if (!searches.has(key))
      searches.set(key, {
        kind,
        id,
        query: '',
        destination: 'auto',
        selected: new Set(),
        results: [],
        generation: 0,
        timer: null,
      });
    return searches.get(key);
  }
  function destination(state, media, create = false) {
    let row, parent;
    if (state.kind === 'row') row = getRow(state.id);
    else {
      parent = getNode(state.id);
      if (!parent) return null;
      if (state.destination !== 'auto')
        row = rows(parent.Id).find((r) => r.Id === state.destination);
      else {
        const type = { Movie: 'Movies', Series: 'TV Shows', BoxSet: 'Collection' }[media.Type];
        row = rows(parent.Id).find((r) => category(r) === type);
        if (!row && create && type) {
          row = newRow(parent.Id, type, type);
          model.Rows.push(row);
        }
      }
    }
    if (row && !C.mediaTypesForCategory(category(row)).includes(media.Type)) return null;
    return row
      ? { row, parent: getNode(row.ParentNodeId) }
      : parent && state.destination === 'auto'
        ? { row: null, parent }
        : null;
  }
  function allowedTypes(state) {
    if (state.kind === 'row') return C.mediaTypesForCategory(category(getRow(state.id)));
    const owner = getNode(state.id);
    if (!owner) return [];
    if (state.destination === 'auto') return ['Movie', 'Series', 'BoxSet'];
    const row = rows(owner.Id).find((r) => r.Id === state.destination);
    return row ? C.mediaTypesForCategory(category(row)) : [];
  }
  function matches(state) {
    return state.results.filter((i) => allowedTypes(state).includes(i.Type));
  }
  function duplicate(
    state,
    media,
    range = { RangeMode: 'Full', StartSeason: 0, EndSeason: 0, StartEpisode: 0, EndEpisode: 0 },
    exclude = '',
  ) {
    const row = destination(state, media)?.row;
    return (
      !!row &&
      references(row).some(
        (r) =>
          r.Id !== exclude &&
          C.linkIdentity(r) === C.linkIdentity({ JellyfinItemId: media.Id, ...range }),
      )
    );
  }
  function resultMarkup(state) {
    return matches(state)
      .map((media) => {
        const added = duplicate(state, media);
        return (
          '<div class="library-result" data-library-result="' +
          media.Id +
          '"><input type="checkbox" data-library-check="' +
          media.Id +
          '" aria-label="Select ' +
          esc(media.Name) +
          '" ' +
          (added ? 'disabled' : '') +
          (state.selected.has(media.Id) ? ' checked' : '') +
          '><span><span class="library-result-title">' +
          esc(media.Name) +
          '</span><span class="library-result-meta">' +
          esc(shortType(media.Type)) +
          (media.ProductionYear ? ' · ' + media.ProductionYear : '') +
          (added ? ' · Already added' : '') +
          '</span></span><button class="quiet" data-library-' +
          (media.Type === 'Series' ? 'range' : 'add') +
          '="' +
          media.Id +
          '" ' +
          (added && media.Type !== 'Series' ? 'disabled' : '') +
          '>' +
          (media.Type === 'Series' ? 'Choose TV Show range' : added ? 'Added' : '＋ Add') +
          '</button></div>'
        );
      })
      .join('');
  }
  function libraryMarkup(state) {
    const owner = state.kind === 'node' ? getNode(state.id) : null;
    if (
      owner &&
      state.destination !== 'auto' &&
      !rows(owner.Id).some((r) => r.Id === state.destination)
    ) {
      state.destination = 'auto';
      state.selected.clear();
    }
    return (
      '<div class="library-picker" data-library-scope="' +
      state.kind +
      ':' +
      state.id +
      '">' +
      (owner
        ? '<label class="field library-destination"><span>Add to</span><select data-library-destination><option value="auto">Create or use matching rows</option>' +
          rows(owner.Id)
            .filter((r) => category(r) !== 'Sub Group')
            .map(
              (r) =>
                '<option value="' +
                r.Id +
                '" ' +
                (state.destination === r.Id ? 'selected' : '') +
                '>' +
                esc(r.Name) +
                '</option>',
            )
            .join('') +
          '</select></label>'
        : '') +
      '<label class="field"><span>Search library</span><input type="search" data-library-search placeholder="Search titles…" autocomplete="off" value="' +
      esc(state.query) +
      '"></label><div class="library-status" role="status">' +
      esc(state.status || 'Enter at least 2 characters') +
      '</div><div class="library-results">' +
      resultMarkup(state) +
      '</div><div class="library-bulk"><button class="quiet" data-library-select-all>Select all</button><button class="quiet" data-library-clear>Clear selection</button><button class="primary" data-library-add-selected disabled>Add selected (0)</button></div></div>'
    );
  }
  function activeSearch() {
    return mediaScope ? searchState(mediaScope.kind, mediaScope.id) : null;
  }
  function updateSelection() {
    const state = activeSearch();
    if (!state) return;
    const allowed = new Set(
      matches(state)
        .filter((i) => !duplicate(state, i))
        .map((i) => i.Id),
    );
    for (const id of state.selected) if (!allowed.has(id)) state.selected.delete(id);
    const scope = $('media-library');
    for (const box of scope.querySelectorAll('[data-library-check]'))
      box.checked = state.selected.has(box.dataset.libraryCheck);
    const button = scope.querySelector('[data-library-add-selected]');
    if (button) {
      button.textContent = 'Add selected (' + state.selected.size + ')';
      button.disabled = !state.selected.size;
    }
  }
  function refreshResults() {
    const state = activeSearch();
    if (!state) return;
    $('media-library').querySelector('.library-results').innerHTML = resultMarkup(state);
    $('media-library').querySelector('.library-status').textContent = state.status;
    updateSelection();
  }
  async function runSearch(state) {
    const generation = ++state.generation,
      query = state.query.trim(),
      types = allowedTypes(state);
    if (query.length < 2 || !types.length) {
      state.results = [];
      state.status = types.length
        ? 'Enter at least 2 characters'
        : 'This group row contains subgroups. Add a media row to search.';
      if (state === activeSearch()) refreshResults();
      return;
    }
    state.status = 'Searching Jellyfin…';
    if (state === activeSearch()) refreshResults();
    try {
      const response = await items({
        searchTerm: query,
        recursive: true,
        includeItemTypes: types.join(','),
        limit: 40,
        startIndex: 0,
        enableImages: true,
        enableTotalRecordCount: false,
      });
      if (generation !== state.generation) return;
      state.results = (response.Items || response.items || []).filter(
        (i) => C.validGuid(i.Id) && types.includes(i.Type),
      );
      state.status = state.results.length + ' matches';
      for (const i of state.results)
        itemCache.set(i.Id.replace(/-/g, '').toLowerCase(), Promise.resolve(i));
    } catch (error) {
      if (generation !== state.generation) return;
      state.results = [];
      state.status = error.message;
    }
    if (state === activeSearch()) refreshResults();
  }
  function currentMedia() {
    if (!mediaScope) return;
    if (mediaScope.kind === 'row') {
      $('media-current').innerHTML = getRow(mediaScope.id)
        ? mediaList(getRow(mediaScope.id), true)
        : '';
      return;
    }
    const owner = getNode(mediaScope.id);
    if (!owner) return;
    const state = activeSearch(),
      selectedRows =
        state.destination === 'auto'
          ? rows(owner.Id)
          : rows(owner.Id).filter((r) => r.Id === state.destination);
    let content = selectedRows
      .map(
        (r) =>
          '<section class="media-current-group"><h4>' +
          esc(r.Name) +
          ' · ' +
          references(r).length +
          '</h4>' +
          mediaList(r, true) +
          '</section>',
      )
      .join('');
    const unassigned = franchiseMedia(owner.Id);
    if (unassigned.MediaLinkIds.length)
      content +=
        '<section class="media-current-group"><h4>Franchise media</h4>' +
        mediaList(unassigned, true) +
        '</section>';
    $('media-current').innerHTML =
      content || '<div class="empty-media">No media added in this category</div>';
  }
  function renderMedia(preserve = false) {
    if (!mediaScope) return;
    const row = mediaScope.kind === 'row' ? getRow(mediaScope.id) : null,
      owner = mediaScope.kind === 'node' ? getNode(mediaScope.id) : getNode(row?.ParentNodeId);
    if (!owner) {
      $('media-dialog').close();
      return;
    }
    const body = $('media-body'),
      scroll = body.scrollTop,
      focus = document.activeElement,
      caret = focus?.matches('[data-library-search]')
        ? [focus.selectionStart, focus.selectionEnd]
        : null;
    $('media-scope').textContent = path(owner.Id) + (row ? ' / ' + row.Name : '');
    $('media-group-tools').hidden = false;
    $('media-structure-owner').textContent = 'Add to ' + path(owner.Id);
    $('media-convert-row').hidden = !row;
    $('media-library').innerHTML = libraryMarkup(activeSearch());
    currentMedia();
    resolveMediaAvailability($('media-current'));
    updateSelection();
    $('media-undo').disabled = !history.length;
    if (preserve) {
      body.scrollTop = scroll;
      if (caret) {
        const input = $('media-library').querySelector('[data-library-search]');
        input.focus({ preventScroll: true });
        input.setSelectionRange(...caret);
      }
    }
  }
  function openMedia(kind, id) {
    if (kind === 'row' ? !getRow(id) : !getNode(id)) return;
    mediaScope = { kind, id };
    renderMedia();
    show('media-dialog');
    $('media-body').scrollTop = 0;
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
      focusTarget = touch
        ? $('media-dialog').querySelector('[data-close="media-dialog"]')
        : $('media-library').querySelector('[data-library-search]');
    focusTarget.focus({ preventScroll: true });
  }
  $('media-dialog').addEventListener('close', () => {
    if (mediaScope) activeSearch().generation++;
    mediaScope = null;
    $('media-library').replaceChildren();
    $('media-current').replaceChildren();
  });
  $('media-library').oninput = (e) => {
    if (!e.target.matches('[data-library-search]')) return;
    const state = activeSearch();
    if (!state) return;
    state.query = e.target.value;
    state.selected.clear();
    clearTimeout(state.timer);
    state.timer = setTimeout(() => runSearch(state), 300);
  };
  $('media-library').onchange = (e) => {
    const state = activeSearch();
    if (!state) return;
    if (e.target.matches('[data-library-destination]')) {
      state.destination = e.target.value;
      state.selected.clear();
      currentMedia();
      void runSearch(state);
    } else if (e.target.matches('[data-library-check]')) {
      e.target.checked
        ? state.selected.add(e.target.dataset.libraryCheck)
        : state.selected.delete(e.target.dataset.libraryCheck);
      updateSelection();
    }
  };
  function addMedia(state, entries) {
    const adding = entries.filter(
      ({ media, range }) => destination(state, media) && !duplicate(state, media, range),
    );
    if (!adding.length) {
      notify('No compatible new titles to add.');
      return;
    }
    change(() => {
      for (const { media, range } of adding) {
        const target = destination(state, media, true);
        if (!target?.row || duplicate(state, media, range)) continue;
        target.row.Items.push({
          Id: C.guid(),
          JellyfinItemId: media.Id,
          DisplayName: media.Name,
          ItemType: media.Type,
          ...C.rangeFields({ ItemType: media.Type, ...range }),
        });
        target.row.MediaOrder.push(target.row.Items.at(-1).Id);
        expandPath(target.parent.Id);
        openRows.add(target.row.Id);
      }
      state.selected.clear();
    });
    notify('Media added. Save changes to persist.');
  }
  $('media-library').onclick = (e) =>
    attempt(() => {
      const state = activeSearch();
      if (!state) return;
      const direct = e.target.closest('[data-library-add]'),
        range = e.target.closest('[data-library-range]');
      if (direct || range) {
        const media = state.results.find(
          (i) => i.Id === (direct?.dataset.libraryAdd || range?.dataset.libraryRange),
        );
        if (!media || !destination(state, media)) return;
        if (range) openRange(state, media);
        else addMedia(state, [{ media, range: { RangeMode: 'Full' } }]);
      } else if (e.target.closest('[data-library-select-all]')) {
        for (const i of matches(state)) if (!duplicate(state, i)) state.selected.add(i.Id);
        updateSelection();
      } else if (e.target.closest('[data-library-clear]')) {
        state.selected.clear();
        updateSelection();
      } else if (e.target.closest('[data-library-add-selected]'))
        addMedia(
          state,
          matches(state)
            .filter((i) => state.selected.has(i.Id))
            .map((media) => ({ media, range: { RangeMode: 'Full' } })),
        );
    });
  $('choose-add-row').onclick = () => {
    const parent =
      mediaScope?.kind === 'row' ? getRow(mediaScope.id)?.ParentNodeId : mediaScope?.id;
    if (!parent) return;
    $('media-dialog').close();
    openRow('', parent);
  };
  $('choose-add-subgroup').onclick = () => {
    const rowId = mediaScope?.kind === 'row' ? mediaScope.id : '';
    const parent =
      mediaScope?.kind === 'row' ? getRow(mediaScope.id)?.ParentNodeId : mediaScope?.id;
    if (!parent) return;
    $('media-dialog').close();
    openSubgroup(parent, rowId);
  };
  $('media-convert-row').onclick = () => {
    if (mediaScope?.kind !== 'row') return;
    const id = mediaScope.id;
    $('media-dialog').close();
    openRow(id);
    convertRow();
  };
  function stopSpecificRequest(draft = rangeDraft) {
    if (!draft) return;
    draft.pickerSerial = (draft.pickerSerial || 0) + 1;
    draft.pickerController?.abort();
    clearTimeout(draft.pickerTimeout);
    draft.pickerController = null;
  }
  function specificCurrent(draft, serial) {
    return rangeDraft === draft && draft.pickerSerial === serial &&
      $('library-range-mode').value === 'specific';
  }
  function specificRequest(draft) {
    stopSpecificRequest(draft);
    const controller = new AbortController(), serial = draft.pickerSerial;
    draft.pickerController = controller;
    draft.pickerTimeout = setTimeout(() => controller.abort(), 45000);
    return { serial, signal: controller.signal };
  }
  async function specificPages(route, params, signal) {
    const result = [], seen = new Set(), limit = 200;
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const response = await request(route + '?' + new URLSearchParams({
        ...params, startIndex: offset, limit,
      }), { signal });
      const batch = response?.Items || response?.items || [],
        total = response?.TotalRecordCount ?? response?.totalRecordCount;
      let added = 0;
      for (const item of batch) {
        const key = String(item?.Id || '').replace(/-/g, '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key); result.push(item); added++;
      }
      offset += batch.length;
      if (!batch.length || (Number.isFinite(total) ? offset >= total : batch.length < limit))
        return result;
      if (!added) throw Error('Jellyfin returned repeated episode pages. Try loading again.');
    }
    throw Error('The TV Show exceeds the episode selection scan limit.');
  }
  function specificLabel(episode) {
    return 'S' + String(episode.ParentIndexNumber).padStart(2, '0') +
      'E' + String(episode.IndexNumber).padStart(2, '0') + ' · ' + (episode.Name || 'Episode');
  }
  function specificChoice() {
    const draft = rangeDraft,
      episode = draft?.pickerEpisodes?.find((item) => item.Id === $('library-specific-episode').value);
    return episode && episode.ParentIndexNumber === Number($('library-specific-season').value)
      ? episode : null;
  }
  function syncSpecificChoice() {
    const episode = specificChoice();
    $('confirm-library-range').disabled = !episode;
    $('library-specific-status').textContent = episode ? specificLabel(episode) : '';
  }
  function specificFailure(message) {
    $('library-range-error').textContent = message;
    $('library-range-error').hidden = false;
    $('library-specific-status').textContent = '';
    $('library-specific-retry').hidden = false;
    $('confirm-library-range').disabled = true;
  }
  async function loadSpecificEpisodes(draft, season, desiredEpisode = '') {
    const { serial, signal } = specificRequest(draft);
    draft.pickerEpisodes = [];
    $('library-specific-episode').innerHTML = '<option value="">Loading episodes…</option>';
    $('library-specific-episode').disabled = true;
    $('confirm-library-range').disabled = true;
    $('library-range-error').hidden = true;
    $('library-specific-retry').hidden = true;
    $('library-specific-status').textContent = 'Loading episodes…';
    try {
      const episodes = await specificPages('Shows/' + encodeURIComponent(draft.media.Id) + '/Episodes', {
        userId: ApiClient.getCurrentUserId?.() || '', season,
        isMissing: false, enableTotalRecordCount: true,
      }, signal);
      if (!specificCurrent(draft, serial)) return;
      draft.pickerEpisodes = episodes.filter((item) => item?.Type === 'Episode' &&
        C.validGuid(item.Id) && item.ParentIndexNumber === Number(season) &&
        Number.isInteger(item.IndexNumber) && item.IndexNumber >= 1 && item.IndexNumber <= 999 &&
        item.IsMissing !== true && item.IsVirtualItem !== true && item.LocationType !== 'Virtual')
        .sort((a, b) => a.IndexNumber - b.IndexNumber || String(a.Name || '').localeCompare(b.Name || ''));
      $('library-specific-episode').innerHTML = '<option value="">Choose an episode</option>' +
        draft.pickerEpisodes.map((episode) => '<option value="' + esc(episode.Id) + '">' +
          esc(specificLabel(episode)) + '</option>').join('');
      $('library-specific-episode').disabled = !draft.pickerEpisodes.length;
      const selected = draft.pickerEpisodes.find((episode) => episode.IndexNumber === Number(desiredEpisode));
      $('library-specific-episode').value = selected?.Id || '';
      draft.specificEpisode = selected?.IndexNumber ?? '';
      syncSpecificChoice();
      if (!draft.pickerEpisodes.length)
        specificFailure('No available episodes were found for this season.');
      else if (desiredEpisode !== '' && !selected)
        specificFailure('The saved episode is no longer available. Choose an available episode.');
    } catch (error) {
      if (specificCurrent(draft, serial))
        specificFailure('Could not load episodes. ' + error.message);
    } finally {
      if (specificCurrent(draft, serial)) clearTimeout(draft.pickerTimeout);
    }
  }
  async function loadSpecificSeasons() {
    const draft = rangeDraft;
    if (!draft || $('library-range-mode').value !== 'specific') return;
    const { serial, signal } = specificRequest(draft);
    draft.pickerEpisodes = [];
    $('library-specific-season').innerHTML = '<option value="">Loading seasons…</option>';
    $('library-specific-season').disabled = true;
    $('library-specific-episode').innerHTML = '<option value="">Choose an episode</option>';
    $('library-specific-episode').disabled = true;
    $('confirm-library-range').disabled = true;
    $('library-range-error').hidden = true;
    $('library-specific-retry').hidden = true;
    $('library-specific-status').textContent = 'Loading seasons…';
    try {
      const seasons = await specificPages('Shows/' + encodeURIComponent(draft.media.Id) + '/Seasons', {
        userId: ApiClient.getCurrentUserId?.() || '', isMissing: false,
      }, signal);
      if (!specificCurrent(draft, serial)) return;
      const seen = new Set();
      draft.pickerSeasons = seasons.filter((season) => {
        if (!C.validGuid(season?.Id) || season.Type !== 'Season' ||
            !Number.isInteger(season.IndexNumber) || season.IndexNumber < 0 ||
            season.IndexNumber > 999 || seen.has(season.IndexNumber)) return false;
        seen.add(season.IndexNumber); return true;
      }).sort((a, b) => a.IndexNumber - b.IndexNumber);
      $('library-specific-season').innerHTML = draft.pickerSeasons.map((season) =>
        '<option value="' + season.IndexNumber + '">' +
        esc(season.IndexNumber === 0 ? 'Specials · Season 0' : season.Name || 'Season ' + season.IndexNumber) +
        '</option>').join('');
      if (!draft.pickerSeasons.length) {
        specificFailure('No available seasons with episode numbers were found for this TV Show.');
        return;
      }
      const season = (draft.specificSeason !== '' &&
          draft.pickerSeasons.find((value) => value.IndexNumber === Number(draft.specificSeason))) ||
        draft.pickerSeasons.find((value) => value.IndexNumber > 0) || draft.pickerSeasons[0],
        desiredEpisode = season.IndexNumber === Number(draft.specificSeason) ? draft.specificEpisode : '';
      $('library-specific-season').value = String(season.IndexNumber);
      $('library-specific-season').disabled = false;
      draft.specificSeason = season.IndexNumber;
      await loadSpecificEpisodes(draft, season.IndexNumber, desiredEpisode);
    } catch (error) {
      if (specificCurrent(draft, serial))
        specificFailure('Could not load seasons. ' + error.message);
    } finally {
      if (specificCurrent(draft, serial)) clearTimeout(draft.pickerTimeout);
    }
  }
  function rangeFieldsVisibility() {
    const mode = $('library-range-mode').value;
    stopSpecificRequest();
    $('library-range-endpoints').hidden = mode === 'full' || mode === 'specific';
    $('library-specific-picker').hidden = mode !== 'specific';
    page
      .querySelectorAll('#library-range-endpoints .episode-field')
      .forEach((el) => (el.hidden = mode !== 'episodes'));
    $('library-range-error').hidden = true;
    $('confirm-library-range').disabled = mode === 'specific';
    if (mode === 'specific') void loadSpecificSeasons();
  }
  function openRange(state, media, existing = null) {
    stopSpecificRequest();
    rangeDraft = { state, media, existing, pickerEpisodes: [], pickerSerial: 0 };
    const ref = existing?.ref;
    $('library-range-title').textContent = media.Name;
    const singleton = ref?.RangeMode === 'Episodes' && ref.StartSeason === ref.EndSeason &&
      ref.StartEpisode === ref.EndEpisode;
    $('library-range-mode').value = singleton ? 'specific' :
      { Full: 'full', Seasons: 'seasons', Episodes: 'episodes' }[ref?.RangeMode] || 'full';
    rangeDraft.specificSeason = singleton ? ref.StartSeason : '';
    rangeDraft.specificEpisode = singleton ? ref.StartEpisode : '';
    for (const [id, key, fallback] of [
      ['library-from-season', 'StartSeason', 1],
      ['library-to-season', 'EndSeason', 1],
      ['library-from-episode', 'StartEpisode', 1],
      ['library-to-episode', 'EndEpisode', 3],
    ])
      $(id).value = ref?.[key] ?? fallback;
    $('confirm-library-range').textContent = ref ? 'Save range' : 'Add to row';
    rangeFieldsVisibility();
    show('library-range-dialog');
  }
  $('library-range-mode').onchange = rangeFieldsVisibility;
  $('library-specific-season').onchange = () => {
    if (!rangeDraft) return;
    const season = Number($('library-specific-season').value);
    if (!rangeDraft.pickerSeasons?.some((entry) => entry.IndexNumber === season)) return;
    rangeDraft.specificSeason = season;
    rangeDraft.specificEpisode = '';
    void loadSpecificEpisodes(rangeDraft, season);
  };
  $('library-specific-episode').onchange = () => {
    if (!rangeDraft) return;
    rangeDraft.specificEpisode = specificChoice()?.IndexNumber ?? '';
    $('library-range-error').hidden = true;
    $('library-specific-retry').hidden = true;
    syncSpecificChoice();
  };
  $('library-specific-retry').onclick = () => void loadSpecificSeasons();
  $('confirm-library-range').onclick = () => {
    try {
      if (!rangeDraft) return;
      const { state, media, existing } = rangeDraft,
        mode = $('library-range-mode').value,
        episode = mode === 'specific' ? specificChoice() : null;
      if (mode === 'specific' && !episode) throw Error('Choose an available episode first.');
      const fields = C.rangeFields(mode === 'specific' ? {
          ItemType: 'Series', RangeMode: 'Episodes',
          StartSeason: episode.ParentIndexNumber, EndSeason: episode.ParentIndexNumber,
          StartEpisode: episode.IndexNumber, EndEpisode: episode.IndexNumber,
        } : {
          ItemType: 'Series',
          RangeMode: { full: 'Full', seasons: 'Seasons', episodes: 'Episodes' }[
            $('library-range-mode').value
          ],
          StartSeason: $('library-from-season').value,
          EndSeason: $('library-to-season').value,
          StartEpisode: $('library-from-episode').value,
          EndEpisode: $('library-to-episode').value,
        });
      if (existing) {
        const located = reference(existing.rowId, existing.ref.Id);
        if (!located) throw Error('The original reference no longer exists.');
        if (located.row && !C.mediaTypesForCategory(category(located.row)).includes('Series'))
          throw Error('This row no longer accepts TV Shows.');
        if (
          located.row &&
          references(located.row).some(
            (r) =>
              r.Id !== located.ref.Id &&
              C.linkIdentity(r) === C.linkIdentity({ JellyfinItemId: media.Id, ...fields }),
          )
        )
          throw Error('This TV Show range is already in the row.');
        change(() => {
          Object.assign(located.ref, fields);
          if (fields.RangeMode !== 'Full') automation?.recordManualChoice(manualChoice(located.row?.ParentNodeId || located.ref.NodeId, located.row?.Id || '', located.ref, media, 'AllowedRange'));
        });
      } else {
        if (!destination(state, media)) throw Error('This row no longer accepts TV Shows.');
        if (duplicate(state, media, fields))
          throw Error('This TV Show range is already in the row.');
        addMedia(state, [{ media, range: fields }]);
      }
      $('library-range-dialog').close();
    } catch (error) {
      $('library-range-error').textContent = error.message;
      $('library-range-error').hidden = false;
    }
  };
  $('library-range-dialog').addEventListener('close', () => {
    stopSpecificRequest();
    rangeDraft = null;
  });
  async function editRange(rowId, id) {
    const found = reference(rowId, id);
    if (!found) return;
    const media = await item(found.ref.JellyfinItemId);
    if (!media) throw Error('Jellyfin could not resolve this show.');
    openRange(null, media, { ...found, rowId });
  }
  function manualChoice(nodeId, rowId, ref, media = null, scope = '') {
    const owner = getNode(nodeId), identity = ref.Identity || {},
      parentIdentity = media?.Type === 'Episode' ? identity.SeriesProviderIds : identity.ProviderIds,
      imdb = (parentIdentity || []).find((entry) => entry.Name?.toLowerCase() === 'imdb')?.Value ||
        (media?.Type === 'Episode' ? '' : Object.entries(media?.ProviderIds || {}).find(([key]) => key.toLowerCase() === 'imdb')?.[1]) || '',
      type = ref.ItemType || media?.Type,
      season = media?.ParentIndexNumber ?? ref.StartSeason,
      number = media?.IndexNumber ?? ref.StartEpisode;
    const choice = { FranchiseNodeId: owner?.Id || nodeId, RowId: rowId || '',
      Scope: scope || (type === 'Series' ? ref.RangeMode === 'Full' ? 'WholeShow' : ref.RangeMode === 'Seasons' ? 'Season' : 'Episode' : type === 'Episode' ? 'Episode' : 'Movie'),
      ProviderName: 'Imdb', ProviderId: imdb,
      JellyfinItemId: media?.Type === 'Episode' ? media.SeriesId || ref.JellyfinItemId : ref.JellyfinItemId || media?.Id || '',
      StartSeason: season || 0, EndSeason: media?.Type === 'Episode' ? season : ref.EndSeason || season || 0,
      StartEpisode: number || 0, EndEpisode: media?.Type === 'Episode' ? media.IndexNumberEnd || number : ref.EndEpisode || number || 0,
      Reason: scope === 'AllowedRange' ? 'Keep the episode range selected by you' : 'Removed or skipped by you' };
    // Season-only permitted ranges include every episode in those seasons.
    if (scope === 'AllowedRange' && ref.RangeMode === 'Seasons') { choice.StartEpisode = 1; choice.EndEpisode = 999; }
    return choice;
  }
  function recordRemovedReference(rowId, found) {
    const affected = found.row ? [found.row] : model.Rows.filter((row) => row.MediaLinkIds.includes(found.ref.Id));
    if (!affected.length) automation?.recordManualChoice(manualChoice(found.ref.NodeId, '', found.ref));
    for (const row of affected) automation?.recordManualChoice(manualChoice(row.ParentNodeId, row.Id, found.ref));
  }
  function cleanupReferences() {
    const nodes = new Set(model.Nodes.map((n) => n.Id)),
      links = new Set(model.MediaLinks.map((l) => l.Id)),
      rowIds = new Set(model.Rows.map((r) => r.Id));
    for (const r of model.Rows) {
      r.NodeIds = r.NodeIds.filter((id) => nodes.has(id));
      r.MediaLinkIds = r.MediaLinkIds.filter((id) => links.has(id));
      const refs = new Set([...r.MediaLinkIds, ...r.Items.map((i) => i.Id)]);
      r.MediaOrder = r.MediaOrder.filter((id) => refs.has(id));
    }
    for (const n of model.Nodes) {
      // Retain the mapped row ID after deletion so Auto Add respects the deletion.
      // The model accepts these mappings; scopedJobs skips a missing mapped row.
      n.AutoAddRecords = n.AutoAddRecords.filter(
        (r) =>
          (!r.ScopeRowId || rowIds.has(r.ScopeRowId)) &&
          (r.RowId
            ? model.Rows.some(
                (row) => row.Id === r.RowId && row.Items.some((i) => i.Id === r.ReferenceId),
              )
            : links.has(r.ReferenceId)),
      );
    }
  }
  function deleteImpact(node) {
    return (
      '<li>' +
      esc(node.Name) +
      '<ul>' +
      rows(node.Id)
        .map((r) => '<li>' + esc(r.Name) + ' · ' + references(r).length + ' titles</li>')
        .join('') +
      children(node.Id).map(deleteImpact).join('') +
      '</ul></li>'
    );
  }
  function openDelete(kind, id, rowId = '') {
    const found =
      kind === 'node' ? getNode(id) : kind === 'row' ? getRow(id) : reference(rowId, id);
    if (!found) return;
    deletion = { kind, id, rowId };
    const name = kind === 'item' ? refName(found.ref) : found.Name;
    $('delete-heading').textContent =
      kind === 'item'
        ? 'Remove media reference?'
        : 'Delete ' + (kind === 'node' ? 'group' : 'row') + '?';
    if (kind === 'node') {
      const branch = descendants(id),
        count = model.Rows.filter((r) => branch.has(r.ParentNodeId)).length;
      $('delete-message').textContent =
        'Deleting “' +
        name +
        '” also removes all ' +
        (branch.size - 1) +
        ' nested groups, ' +
        count +
        ' rows, and media references owned by this branch.';
      $('delete-impact').innerHTML =
        '<ul class="delete-impact-list">' + deleteImpact(found) + '</ul>';
    } else {
      $('delete-message').textContent =
        kind === 'row'
          ? 'Delete “' +
            name +
            '” and its direct media entries? Shared franchise links and referenced groups keep their ownership.'
          : 'Remove “' +
            name +
            '”' +
            (found.row
              ? ' from this row?'
              : ' from the franchise and all rows using this reference?');
      $('delete-impact').replaceChildren();
    }
    $('confirm-delete').textContent = kind === 'item' ? 'Remove reference' : 'Delete';
    show('delete-dialog');
    $('delete-dialog').querySelector('.dialog-footer [data-close]').focus();
  }
  $('confirm-delete').onclick = () =>
    attempt(() => {
      if (!deletion) return;
      const { kind, id, rowId } = deletion;
      change(() => {
        if (kind === 'node') {
          const branch = descendants(id);
          for (const nodeId of branch) automation?.recordManualChoice({ kind: 'deleteFranchise', FranchiseNodeId: nodeId });
          model.Nodes = model.Nodes.filter((n) => !branch.has(n.Id));
          model.MediaLinks = model.MediaLinks.filter((l) => !branch.has(l.NodeId));
          model.Rows = model.Rows.filter((r) => !branch.has(r.ParentNodeId));
        } else if (kind === 'row') {
          automation?.recordManualChoice({ kind: 'deleteRow', FranchiseNodeId: getRow(id)?.ParentNodeId, RowId: id });
          const owned = model.Nodes.flatMap((n) =>
            n.AutoAddRecords.filter((r) => r.ScopeRowId === id && !r.RowId),
          ).map((r) => r.ReferenceId);
          model.Rows = model.Rows.filter((r) => r.Id !== id);
          model.MediaLinks = model.MediaLinks.filter(
            (l) => !owned.includes(l.Id) || model.Rows.some((r) => r.MediaLinkIds.includes(l.Id)),
          );
        } else {
          const found = reference(rowId, id);
          if (!found) return;
          recordRemovedReference(rowId, found);
          if (found.direct) found.row.Items = found.row.Items.filter((i) => i.Id !== id);
          else if (found.row)
            found.row.MediaLinkIds = found.row.MediaLinkIds.filter((key) => key !== id);
          else model.MediaLinks = model.MediaLinks.filter((l) => l.Id !== id);
        }
        cleanupReferences();
      });
      $('delete-dialog').close();
    });
  $('delete-dialog').addEventListener('close', () => (deletion = null));

  let autoGeneration = 0;
  async function fetchSource(source) {
    const response = await request(
      'FranchiseExplorer/AutoAdd/Source?url=' + encodeURIComponent(source.Url),
    );
    return {
      entries: (response.entries || response.Entries || []).map((e) => ({
        imdbId: e.imdbId || e.ImdbId,
        title: e.title || e.Title,
        year: e.year ?? e.Year,
        type: e.type || e.Type,
        position: e.position ?? e.Position,
      })),
      orderVerified: response.orderVerified ?? response.OrderVerified ?? false,
    };
  }
  function reviewKey(job, key) {
    return job.nodeId + ':' + job.scopeRowId + ':' + key;
  }
  function reviewWhere(job, group, show = false, rowIds = null) {
    const type = group?.entry?.item?.Type,
      eligible = show
        ? ['TV Shows']
        : type === 'Movie'
          ? ['Movies', 'Chronological Timeline', 'Other']
          : type === 'BoxSet'
            ? ['Collections', 'Other']
            : type === 'Series'
              ? ['Other']
              : ['Chronological Timeline', 'Other'];
    return job.mappings
      .filter((m) => (rowIds ? rowIds.includes(m.RowId) : eligible.includes(m.Category)))
      .map(
        (m) =>
          path(job.nodeId) +
          ' / ' +
          (review.base.Rows.find((r) => r.Id === m.RowId)?.Name || m.Category),
      );
  }
  function buildReviewCells() {
    review.cells = [];
    for (const job of review.jobs) {
      const titleAdds = new Map(
        job.diff.additions.filter((addition) => addition.kind === 'title').map((addition) => [addition.entry.imdbId, addition]),
      );
      for (const mapping of job.mappings.filter((entry) => entry.Category !== 'TV Shows')) {
        const format = mapping.Category === 'Chronological Timeline' ? job.episodeFormat : 'Bundles',
          plan = C.autoAdd.plan(job.entries.map((entry) =>
            titleAdds.get(entry.imdbId)?.rowIds?.includes(mapping.RowId)
              ? { ...entry, categories: [mapping.Category] } : { ...entry, status: 'excluded' }), undefined, format);
        for (const group of plan.groups) {
        const entries = group.episodes || [group.entry],
          adds = entries.map((e) => titleAdds.get(e.imdbId)).filter(Boolean);
        if (!adds.length) continue;
        const keys = adds.map((a) => reviewKey(job, a.key));
        review.cells.push({
          change: 'add',
          title: group.label,
          type: group.episodes ? (format === 'Individual' ? 'Episode' : 'TV Show') : shortType(group.entry.item.Type),
          where: reviewWhere(job, group, false, [mapping.RowId]),
          keys,
          children: group.episodes && group.episodes.length > 1
            ? adds.map((a) => ({ key: reviewKey(job, a.key), title: a.label }))
            : null,
        });
        }
      }
      for (const addition of job.diff.additions.filter((a) => a.kind === 'show'))
        review.cells.push({
          change: 'add',
          title: addition.label,
          type: 'TV Show',
          where: reviewWhere(job, null, true, addition.rowIds),
          keys: [reviewKey(job, addition.key)],
        });
      for (const removal of job.diff.removals) {
        const places = job.mappings
          .filter((m) => !removal.rowIds || removal.rowIds.includes(m.RowId))
          .map(
            (m) =>
              path(job.nodeId) +
              ' / ' +
              (review.base.Rows.find((r) => r.Id === m.RowId)?.Name || m.Category),
          );
        review.cells.push({
          change: 'remove',
          title: removal.label,
          type: 'Reference',
          where: places,
          keys: [reviewKey(job, removal.key)],
        });
      }
      for (const missing of job.diff.missing)
        review.cells.push({
          change: 'missing',
          title: missing.title,
          type: shortType(missing.type),
          where: job.mappings.map(
            (m) =>
              path(job.nodeId) +
              ' / ' +
              (review.base.Rows.find((r) => r.Id === m.RowId)?.Name || m.Category),
          ),
          keys: [],
        });
      for (const result of job.results.filter((r) => r.error))
        review.cells.push({
          change: 'missing',
          title: 'Source unavailable: ' + result.error,
          type: 'IMDb source',
          where: [path(job.nodeId)],
          keys: [],
        });
    }
  }
  function reconcileReviewSelection() {
    if (!review) return;
    for (const job of review.jobs)
      for (const addition of job.diff.additions)
        if (addition.requiresRemovals?.some((key) => !review.selected.has(reviewKey(job, key))))
          review.selected.delete(reviewKey(job, addition.key));
  }
  function renderReview() {
    if (!review) return;
    reconcileReviewSelection();
    $('review-format-controls').innerHTML = review.jobs.flatMap((job) => job.mappings
      .filter((mapping) => mapping.Category === 'Chronological Timeline')
      .map((mapping) => '<label class="field"><span>' +
        esc(review.base.Rows.find((row) => row.Id === mapping.RowId)?.Name || 'Chronological Order') +
        ' · Episode format</span><select data-review-format-row="' + mapping.RowId + '">' +
        ['Bundles', 'Individual'].map((format) => '<option value="' + format + '"' +
          (job.episodeFormat === format ? ' selected' : '') + '>' +
          (format === 'Bundles' ? 'Episode bundles' : 'Individual episodes') + '</option>').join('') + '</select></label>'))
      .join('');
    $('review-counts').innerHTML = ['add', 'remove', 'missing']
      .map(
        (type) =>
          '<span class="count-pill ' +
          type +
          '">' +
          review.cells.filter((c) => c.change === type).length +
          ' ' +
          { add: 'additions', remove: 'removals', missing: 'missing' }[type] +
          '</span>',
      )
      .join('');
    $('review-list').innerHTML =
      review.cells
        .map(
          (cell, index) =>
            '<tr><td><input type="checkbox" data-review-cell="' +
            index +
            '" aria-label="Select ' +
            esc(cell.title) +
            '" ' +
            (!cell.keys.length ? 'disabled' : '') +
            (cell.keys.length && cell.keys.every((key) => review.selected.has(key))
              ? ' checked'
              : '') +
            '></td><td class="change-title">' +
            (cell.children
              ? '<button class="range-expand" data-review-expand="' +
                index +
                '" aria-label="Choose episodes for ' +
                esc(cell.title) +
                '">' +
                (review.expanded.has(index) ? '⌃' : '⌄') +
                '</button>'
              : '') +
            esc(cell.title) +
            '</td><td class="type-cell">' +
            esc(cell.type) +
            '</td><td class="where-cell">' +
            cell.where.map(esc).join('<br>') +
            '</td><td><span class="change-pill ' +
            cell.change +
            '">' +
            { add: 'Add', remove: 'Remove', missing: 'Missing' }[cell.change] +
            '</span></td></tr>' +
            (cell.children && review.expanded.has(index)
              ? cell.children
                  .map(
                    (child) =>
                      '<tr class="child-change"><td><input type="checkbox" data-review-child="' +
                      esc(child.key) +
                      '" aria-label="Select episode ' +
                      esc(child.title) +
                      '" ' +
                      (review.selected.has(child.key) ? 'checked' : '') +
                      '></td><td class="change-title">' +
                      esc(child.title) +
                      '</td><td>Episode</td><td>' +
                      cell.where.map(esc).join('<br>') +
                      '</td><td></td></tr>',
                  )
                  .join('')
              : ''),
        )
        .join('') || '<tr><td colspan="5">No changes to apply.</td></tr>';
    for (const checkbox of $('review-list').querySelectorAll('[data-review-cell]')) {
      const cell = review.cells[Number(checkbox.dataset.reviewCell)],
        count = cell.keys.filter((key) => review.selected.has(key)).length;
      checkbox.indeterminate = count > 0 && count < cell.keys.length;
    }
    const all = review.cells.flatMap((c) => c.keys);
    $('review-all').checked = !!all.length && all.every((key) => review.selected.has(key));
    $('review-all').indeterminate = review.selected.size > 0 && !$('review-all').checked;
    $('selected-count').textContent = review.selected.size + ' selected';
    $('apply-selected').disabled = !review.selected.size && !review.deliberatelyUnchecked?.size;
  }
  async function previewAutoAdd(origin = 'node') {
    return attempt(async () => {
      const generation = ++autoGeneration,
        draft = origin === 'row' ? rowDraft : nodeDraft,
        base = origin === 'row' ? rowDraftModel() : nodeDraftModel();
      if (!base) return;
      const rowId = origin === 'row' ? draft.row.Id : '',
        nodeId = origin === 'row' ? draft.row.ParentNodeId : draft.node.Id,
        modelBefore = fingerprint(model),
        button = $(origin === 'row' ? 'row-preview' : 'franchise-preview');
      let jobs;
      if (rowId) {
        const row = base.Rows.find((entry) => entry.Id === rowId),
          owner = base.Nodes.find((node) => node.Id === nodeId),
          inherited = !row.SourceUrl && !row.AutoAddSources?.length,
          planning = C.clone(base),
          planned = C.scopedJobs(planning, nodeId),
          mapped = inherited && planned.find((job) => !job.scopeRowId && job.nodeId === nodeId &&
            job.mappings.some((mapping) => mapping.RowId === rowId));
        if (mapped) {
          const mappings = mapped.mappings.filter((mapping) => mapping.RowId === rowId),
            allowed = new Set(mappings.map((mapping) => mapping.Category));
          owner.AutoAddRows = [
            ...owner.AutoAddRows.filter((mapping) => !allowed.has(mapping.Category)),
            ...C.clone(mappings),
          ];
          jobs = [{ ...mapped, rowIds: [rowId], mappings,
            episodeFormat: row.EpisodeFormat || owner.EpisodeFormat || 'Bundles',
            sources: mapped.sources.map((source) => ({ ...source,
              Categories: source.Categories.filter((name) => allowed.has(name)) })).filter((source) => source.Categories.length) }];
        } else {
          if (inherited) {
            const name = C.categoryToAutoAdd(category(row));
            row.AutoAddSources = (owner.AutoAddSources || []).filter((source) => source.Enabled !== false)
              .map((source) => ({ ...C.clone(source), Id: C.guid(), Categories: [name] }));
            row.SourceUrl = row.AutoAddSources[0]?.Url || '';
          }
          jobs = C.scopedJobs(C.clone(base), nodeId).filter((job) => job.scopeRowId === rowId);
        }
      } else jobs = C.scopedJobs(base, nodeId);
      if (!jobs.length) throw Error('Add an IMDb URL to the franchise, subgroup or a media row.');
      button.disabled = true;
      notify('Reading IMDb and comparing your Jellyfin library…');
      try {
        const cache = new Map();
        for (const job of jobs) {
          job.results = [];
          for (const [index, source] of job.sources.entries()) {
            try {
              if (!cache.has(source.Url)) cache.set(source.Url, fetchSource(source));
              job.results.push({ source, index, ...(await cache.get(source.Url)) });
            } catch (error) {
              job.results.push({ source, index, error: error.message });
            }
          }
        }
        const library = [];
        const episodes = jobs.some((job) =>
          job.results.some((result) => result.entries?.some((e) => e.type === 'Episode')),
        );
        for (let start = 0; ; start += 200) {
          const response = await items({
            recursive: true,
            includeItemTypes: episodes ? 'Movie,Series,Episode,BoxSet' : 'Movie,Series,BoxSet',
            fields: 'ProviderIds',
            startIndex: start,
            limit: 200,
            enableTotalRecordCount: true,
          });
          const batch = response.Items || response.items || [];
          library.push(...batch);
          if (
            batch.length < 200 ||
            library.length >= (response.TotalRecordCount ?? response.totalRecordCount ?? Infinity)
          )
            break;
          if (start >= 100000) throw Error('The library scan limit was reached.');
        }
        if (
          generation !== autoGeneration ||
          (origin === 'row' ? rowDraft !== draft : nodeDraft !== draft) ||
          fingerprint(model) !== modelBefore
        )
          return;
        for (const job of jobs) {
          job.entries = C.autoAdd.preview(job.results, library).map((entry) => {
            const allowed = entry.categories.filter((name) => {
              const rowId = job.scopeRowId || job.mappings.find((mapping) => mapping.Category === name)?.RowId || '';
              return C.automationAllowed(base, job.nodeId, rowId, entry);
            });
            return allowed.length ? { ...entry, categories: allowed } : { ...entry, status: 'excluded' };
          });
          job.diff = C.autoAdd.changes(
            C.scopeModel(base, job),
            job.nodeId,
            job.entries,
            job.results,
          );
        }
        review = {
          base,
          jobs,
          nodeId,
          origin,
          rowId,
          modelBefore,
          cells: [],
          expanded: new Set(),
          deliberatelyUnchecked: new Set(),
          selected: new Set(
            jobs.flatMap((job) =>
              [...job.diff.additions, ...job.diff.removals].map((c) => reviewKey(job, c.key)),
            ),
          ),
        };
        buildReviewCells();
        renderReview();
        show('review');
      } finally {
        button.disabled = false;
      }
    });
  }
  $('franchise-preview').onclick = () => previewAutoAdd('node');
  $('row-preview').onclick = () => previewAutoAdd('row');
  $('franchise-dialog').addEventListener('close', () => autoGeneration++);
  $('row-dialog').addEventListener('close', () => autoGeneration++);
  for (const dialog of [$('franchise-dialog'), $('row-dialog')])
    dialog.addEventListener('input', () => autoGeneration++);
  $('review-list').onclick = (e) => {
    const toggle = e.target.closest('[data-review-expand]');
    if (toggle && review) {
      const index = Number(toggle.dataset.reviewExpand);
      review.expanded.has(index) ? review.expanded.delete(index) : review.expanded.add(index);
      renderReview();
    }
  };
  $('review-list').onchange = (e) => {
    if (!review) return;
    const keys =
      e.target.dataset.reviewCell !== undefined
        ? review.cells[Number(e.target.dataset.reviewCell)].keys
        : e.target.dataset.reviewChild
          ? [e.target.dataset.reviewChild]
          : [];
    for (const key of keys) {
      if (e.target.checked) { review.selected.add(key); review.deliberatelyUnchecked?.delete(key); }
      else { review.selected.delete(key); review.deliberatelyUnchecked?.add(key); }
    }
    renderReview();
  };
  $('review-format-controls').onchange = (event) => attempt(() => {
    const rowId = event.target.dataset.reviewFormatRow;
    if (!review || !rowId) return;
    const row = review.base.Rows.find((entry) => entry.Id === rowId);
    if (!row) return;
    row.EpisodeFormat = event.target.value;
    for (const job of review.jobs) {
      if (job.mappings.some((mapping) => mapping.RowId === rowId)) job.episodeFormat = event.target.value;
      job.diff = C.autoAdd.changes(C.scopeModel(review.base, job), job.nodeId, job.entries, job.results);
    }
    review.selected = new Set(review.jobs.flatMap((job) =>
      [...job.diff.additions, ...job.diff.removals].map((entry) => reviewKey(job, entry.key))));
    review.expanded.clear();
    review.deliberatelyUnchecked?.clear();
    buildReviewCells();
    renderReview();
  });
  function selectReview(all) {
    if (!review) return;
    review.selected.clear();
    review.deliberatelyUnchecked ||= new Set();
    for (const cell of review.cells) for (const key of cell.keys) {
      if (all) { review.selected.add(key); review.deliberatelyUnchecked.delete(key); }
      else review.deliberatelyUnchecked.add(key);
    }
    renderReview();
  }
  $('select-all').onclick = () => selectReview(true);
  $('clear-selection').onclick = () => selectReview(false);
  $('review-all').onchange = (e) => selectReview(e.target.checked);
  $('apply-selected').onclick = () =>
    attempt(() => {
      if (!review || (!review.selected.size && !review.deliberatelyUnchecked?.size)) return;
      if (fingerprint(model) !== review.modelBefore)
        throw Error('The configuration changed. Preview again.');
      let next = C.clone(review.base);
      for (const job of review.jobs) {
        const before = C.scopeModel(next, job),
          selectedKeys = new Set(
            [...job.diff.additions, ...job.diff.removals]
              .filter((entry) => review.selected.has(reviewKey(job, entry.key)))
              .map((entry) => entry.key),
          );
        const diff = C.autoAdd.changes(before, job.nodeId, job.entries, job.results),
          applied = C.autoAdd.applyChanges(
            before,
            job.nodeId,
            job.entries,
            diff,
            selectedKeys,
            C.guid,
          );
        next = C.mergeScope(next, before, applied.model, job);
      }
      const { nodeId, rowId, origin } = review;
      remember();
      model = C.normalize(next);
      for (const job of review.jobs) for (const addition of job.diff.additions) {
        const key = reviewKey(job, addition.key);
        if (review.selected.has(key) || !review.deliberatelyUnchecked?.has(key)) continue;
        // Dependency-driven deselection cannot create a persistent exclusion.
        if ((addition.requiresRemovals || []).some((id) => !review.selected.has(reviewKey(job, id)))) continue;
        const entries = job.entries.filter((entry) => entry.status === 'matched' && (addition.entryIds || []).includes(entry.imdbId));
        for (const entry of entries) for (const targetRow of addition.rowIds || []) {
          const media = addition.kind === 'show' ? entry.series || entry.item : entry.item,
            source = addition.kind === 'show' ? { ItemType: 'Series', JellyfinItemId: media.Id, RangeMode: 'Full' } :
              { ItemType: media.Type, JellyfinItemId: media.Id, RangeMode: 'Full' };
          automation?.recordManualChoice(manualChoice(job.nodeId, targetRow, source, media,
            addition.kind === 'show' ? 'WholeShow' : media.Type === 'Episode' ? 'Episode' : 'Movie'));
        }
      }
      markDirty();
      expandPath(nodeId);
      render();
      $('review').close();
      if (origin === 'row') openRow(rowId);
      else openNode(nodeId);
      notify('Review applied. Save changes to persist.');
    });

  function move(kind, id, parent, index, sourceRowId = '') {
    if (kind === 'item') return moveMedia(id, parent, index);
    if (kind === 'node' && parent.startsWith('row:')) {
      const row = getRow(parent.slice(4)), node = getNode(id);
      if (!row || !node) throw Error('The destination row no longer exists.');
      if (node.ParentId !== row.ParentNodeId)
        throw Error('Move the group to this row’s owning group first. Row membership keeps group ownership.');
      const ids = row.NodeIds.filter((key) => key !== id), previous = row.NodeIds.indexOf(id);
      if (previous >= 0 && previous < index) index--;
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
      const source = sourceRowId && sourceRowId !== row.Id ? getRow(sourceRowId) : null;
      if (JSON.stringify(ids) === JSON.stringify(row.NodeIds) && !source?.NodeIds.includes(id)) return;
      change(() => {
        row.NodeIds = ids;
        if (source) source.NodeIds = source.NodeIds.filter((key) => key !== id);
      });
      openRows.add(row.Id);
      collapsedRows.delete(row.Id);
      expandPath(row.ParentNodeId);
      render();
      return;
    }
    if (kind === 'row') {
      const row = getRow(id),
        branch = descendants(parent);
      if (
        row &&
        (row.MediaLinkIds.some(
          (key) => !branch.has(model.MediaLinks.find((link) => link.Id === key)?.NodeId),
        ) ||
          row.NodeIds.some((key) => getNode(key)?.ParentId !== parent))
      )
        throw Error(
          'This row references media or groups outside the destination. Move those entries first.',
        );
    }
    if (!getNode(parent) && parent) throw Error('Choose a valid destination.');
    if (kind === 'node' && descendants(id).has(parent))
      throw Error('A group cannot contain itself.');
    const moving = kind === 'node' ? getNode(id) : getRow(id),
      peers = kind === 'node' ? children(parent) : rows(parent),
      current = peers.findIndex((entry) => entry.Id === id),
      sameParent = moving && (kind === 'node' ? moving.ParentId : moving.ParentNodeId) === parent,
      sourceRow = kind === 'node' && sourceRowId ? getRow(sourceRowId) : null;
    if (sameParent && current === Math.max(0, Math.min(index - (current < index ? 1 : 0), peers.length - 1)) &&
        !sourceRow?.NodeIds.includes(id)) return;
    change(() => {
      const entry = kind === 'node' ? getNode(id) : getRow(id);
      if (!entry) throw Error('This entry no longer exists.');
      if (kind === 'row' && !parent) throw Error('A row needs an owning group.');
      const oldParent = kind === 'node' ? entry.ParentId : entry.ParentNodeId,
        destination = kind === 'node' ? children(parent) : rows(parent),
        previous = destination.findIndex((x) => x.Id === id);
      if (oldParent === parent && previous >= 0 && previous < index) index--;
      if (kind === 'node') {
        entry.ParentId = parent;
        // Remove obsolete memberships when ownership changes. Moving a displayed
        // reference out of a row removes only that contextual membership.
        for (const row of model.Rows)
          if (row.ParentNodeId !== parent || row.Id === sourceRowId)
            row.NodeIds = row.NodeIds.filter((key) => key !== id);
      }
      else entry.ParentNodeId = parent;
      const remaining = destination.filter((x) => x.Id !== id);
      remaining.splice(Math.max(0, Math.min(index, remaining.length)), 0, entry);
      remaining.forEach((x, i) => (x.SortOrder = i));
      if (parent) expandPath(parent);
    });
  }
  function mediaEntries(rowId) {
    const row = getRow(rowId);
    return row ? references(row) : [];
  }
  function focusMedia(id, rowId, reveal = false) {
    if ($('move-dialog').open) return;
    const scope = $('media-dialog').open ? $('media-current') : $('board');
    const handle = [...scope.querySelectorAll('[data-drag-kind="item"]')].find(
      (el) => el.dataset.dragId === id && el.dataset.dragParent === rowId,
    );
    if (reveal)
      handle?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    handle?.focus({ preventScroll: true });
  }
  function moveMedia(id, rowId, index, reveal = false) {
    const row = getRow(rowId),
      entries = mediaEntries(rowId);
    const previous = entries.findIndex((ref) => ref.Id === id);
    if (!row || previous < 0) throw Error('This media reference no longer exists in the row.');
    if (!Number.isInteger(index)) throw Error('Choose a valid position.');
    index = Math.max(0, Math.min(index, entries.length));
    if (previous < index) index--;
    if (previous === index) return;
    const order = entries.map((ref) => ref.Id);
    order.splice(previous, 1);
    order.splice(index, 0, id);
    // Memberships and reference IDs remain stable, including shared links and
    // separate ranges of the same show. Only this row's presentation order changes.
    change(() => {
      row.MediaOrder = order;
    });
    $('drag-status').textContent =
      refName(entries[previous]) +
      ' moved to position ' +
      (index + 1) +
      ' of ' +
      entries.length +
      ' in ' +
      row.Name;
    focusMedia(id, rowId, reveal);
  }
  function openMove(kind, id, parent = '') {
    if (kind === 'item') {
      const found = reference(parent, id);
      if (!found?.row) return;
      movePayload = { kind, id, parent };
      $('move-heading').textContent = 'Move ' + refName(found.ref);
      $('move-parent').closest('label').hidden = true;
      $('move-scope').hidden = false;
      $('move-scope').textContent = path(found.row.ParentNodeId) + ' / ' + found.row.Name;
      movePositions();
      show('move-dialog');
      return;
    }
    const entry = kind === 'node' ? getNode(id) : getRow(id);
    if (!entry) return;
    movePayload = { kind, id, parent };
    $('move-parent').closest('label').hidden = false;
    $('move-scope').hidden = true;
    $('move-heading').textContent = 'Move ' + entry.Name;
    const blocked = kind === 'node' ? descendants(id) : new Set();
    $('move-parent').innerHTML =
      (kind === 'node' ? '<option value="">Top level</option>' : '') +
      model.Nodes.filter((n) => !blocked.has(n.Id))
        .map((n) => '<option value="' + n.Id + '">' + esc(path(n.Id)) + '</option>')
        .join('') +
      (kind === 'node' ? rows(entry.ParentId).map((row) =>
        '<option value="row:' + row.Id + '">' + esc(path(row.ParentNodeId) + ' / ' + row.Name) + ' (row)</option>').join('') : '');
    $('move-parent').value = kind === 'node' && parent ? 'row:' + parent : kind === 'node' ? entry.ParentId : entry.ParentNodeId;
    movePositions();
    show('move-dialog');
  }
  function movePositions() {
    if (!movePayload) return;
    if (movePayload.kind === 'item') {
      const entries = mediaEntries(movePayload.parent);
      $('move-position').innerHTML =
        entries
          .map((ref, i) =>
            ref.Id === movePayload.id
              ? ''
              : '<option value="' + i + '">Before ' + esc(refName(ref)) + '</option>',
          )
          .join('') +
        '<option value="' +
        entries.length +
        '">Last</option>';
      const current = entries.findIndex((ref) => ref.Id === movePayload.id);
      $('move-position').value = String(current + 1);
      return;
    }
    const destination = $('move-parent').value,
      list = movePayload.kind === 'node' && destination.startsWith('row:')
        ? rowGroups(getRow(destination.slice(4)))
        : movePayload.kind === 'node' ? children(destination) : rows(destination);
    $('move-position').innerHTML =
      list.map((n, i) => '<option value="' + i + '">Before ' + esc(n.Name) + '</option>').join('') +
      '<option value="' +
      list.length +
      '">Last</option>';
    $('move-position').value = String(list.length);
  }
  $('move-parent').onchange = movePositions;
  $('confirm-move').onclick = () =>
    attempt(() => {
      move(
        movePayload.kind,
        movePayload.id,
        movePayload.kind === 'item' ? movePayload.parent : $('move-parent').value,
        Number($('move-position').value),
        movePayload.kind === 'node' ? movePayload.parent : '',
      );
      $('move-dialog').close();
    });
  $('move-dialog').addEventListener('close', () => {
    if (movePayload?.kind === 'item') focusMedia(movePayload.id, movePayload.parent, true);
    movePayload = null;
  });
  let drag = null;
  function clearDrop() {
    page
      .querySelectorAll('.drop-before,.drop-after,.drop-into')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
  }
  function dropAt(x, y) {
    const point = document.elementFromPoint(x, y);
    if (drag?.kind === 'item') {
      let el = point?.closest('[data-media-row]');
      if (!el) {
        const list = point?.closest('[data-media-list]');
        if (list?.dataset.mediaList === drag.parent) {
          const entries = [...list.querySelectorAll(':scope > [data-media-row]')];
          el = entries.find((entry) => y <= entry.getBoundingClientRect().bottom) || entries.at(-1);
        }
      }
      if (
        !el ||
        !page.contains(el) ||
        el.dataset.mediaRow !== drag.parent ||
        el.closest('dialog') !== drag.dialog
      )
        return null;
      const target = mediaEntries(drag.parent).findIndex((ref) => ref.Id === el.dataset.mediaItem);
      if (target < 0) return null;
      const box = el.getBoundingClientRect(),
        before = y < box.top + box.height / 2;
      return {
        parent: drag.parent,
        index: target + (before ? 0 : 1),
        style: before ? 'drop-before' : 'drop-after',
        el,
      };
    }
    let el = point?.closest('[data-drop]:not([data-drop="media"])');
    if (!el && drag?.kind === 'node' && point?.closest('#board')) {
      // Packed cards leave gaps between columns and below shorter cards. Resolve
      // those points to the nearest card in two dimensions, in saved DOM order.
      let distance = Infinity;
      for (const card of $('board').querySelectorAll(':scope > .node-card')) {
        const box = card.getBoundingClientRect(),
          next = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
        if (next < distance) { el = card; distance = next; }
      }
    }
    if (!el || !page.contains(el) || !drag) return null;
    let parent, index, style;
    if (el.dataset.drop === 'root') {
      if (drag.kind !== 'node') return null;
      parent = '';
      index = children('').length;
      style = 'drop-into';
    } else if (el.dataset.drop === 'inside') {
      parent = el.dataset.id;
      index = drag.kind === 'node' ? children(parent).length : rows(parent).length;
      style = 'drop-into';
    } else if (el.dataset.drop === 'row') {
      const row = getRow(el.dataset.id);
      if (!row) return null;
      parent = row.ParentNodeId;
      if (drag.kind === 'node') {
        if (getNode(drag.id)?.ParentId !== parent) return null;
        parent = 'row:' + row.Id;
        index = row.NodeIds.length;
        style = 'drop-into';
      } else {
        const box = el.getBoundingClientRect(),
          before = y < box.top + box.height / 2;
        index = rows(parent).findIndex((r) => r.Id === row.Id) + (before ? 0 : 1);
        style = before ? 'drop-before' : 'drop-after';
      }
    } else {
      const node = getNode(el.dataset.id);
      if (!node) return null;
      if (drag.kind === 'row') {
        parent = node.Id;
        index = rows(parent).length;
        style = 'drop-into';
      } else {
        const box = el.getBoundingClientRect(),
          before = el.dataset.axis === 'grid'
            ? y < box.top || (y <= box.bottom && x < box.left + box.width / 2)
            : y < box.top + box.height / 2;
        parent = el.dataset.groupRow ? 'row:' + el.dataset.groupRow : node.ParentId;
        const peers = el.dataset.groupRow ? rowGroups(getRow(el.dataset.groupRow)) : children(parent);
        index = peers.findIndex((n) => n.Id === node.Id) + (before ? 0 : 1);
        style = before ? 'drop-before' : 'drop-after';
      }
    }
    const owner = parent.startsWith('row:') ? getRow(parent.slice(4))?.ParentNodeId : parent;
    if (drag.kind === 'node' && owner && descendants(drag.id).has(owner)) return null;
    return { parent, index, style, el };
  }
  function dragScroll() {
    if (!drag?.active) return;
    const scroller = drag.scroller;
    const bounds = drag.dialog ? scroller.getBoundingClientRect() : null;
    const visible = drag.dialog?.querySelector('.dialog-content').getBoundingClientRect();
    const top = bounds
      ? Math.max(bounds.top, visible.top, 0) + 40
      : Math.max(70, page.querySelector('.top').getBoundingClientRect().bottom + 12);
    const bottom = bounds
      ? Math.min(bounds.bottom, visible.bottom, innerHeight) - 40
      : innerHeight - 60;
    const delta = drag.y < top ? -10 : drag.y > bottom ? 10 : 0;
    if (delta) {
      scroller.scrollBy(0, delta);
      clearDrop();
      drag.target = dropAt(drag.x, drag.y);
      drag.target?.el.classList.add(drag.target.style);
    }
    drag.frame = requestAnimationFrame(dragScroll);
  }
  function dragScroller(handle, dialog) {
    for (let el = handle.parentElement; el && el !== page; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
        return el;
    }
    return (
      dialog?.querySelector('.dialog-content') ||
      page.closest('.scrollY') ||
      document.scrollingElement
    );
  }
  page.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-id]');
    if (!handle || e.button !== 0 || drag || e.isPrimary === false) return;
    const dialog = handle.closest('dialog');
    if (
      page.querySelector('dialog[open]') &&
      (handle.dataset.dragKind !== 'item' ||
        dialog !== $('media-dialog') ||
        page.querySelector('dialog[open]:not(#media-dialog)'))
    )
      return;
    e.preventDefault();
    hideHelp();
    handle.setPointerCapture?.(e.pointerId);
    drag = {
      kind: handle.dataset.dragKind,
      id: handle.dataset.dragId,
      parent: handle.dataset.dragParent || '',
      dialog,
      scroller: dragScroller(handle, dialog),
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
    };
  });
  page.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      e.preventDefault();
      if (!drag.active) {
        drag.active = true;
        page.classList.add('is-dragging');
        page.classList.toggle('is-dragging-media', drag.kind === 'item');
        scheduleBoardLayout();
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'drag-ghost';
        drag.ghost.textContent =
          drag.kind === 'item'
            ? refName(reference(drag.parent, drag.id)?.ref || {})
            : (drag.kind === 'node' ? getNode(drag.id) : getRow(drag.id))?.Name || 'Moving';
        (drag.dialog || page).append(drag.ghost);
        drag.frame = requestAnimationFrame(dragScroll);
      }
      drag.ghost.style.left = e.clientX + 16 + 'px';
      drag.ghost.style.top = e.clientY + 12 + 'px';
      clearDrop();
      drag.target = dropAt(e.clientX, e.clientY);
      drag.target?.el.classList.add(drag.target.style);
    },
    { passive: false },
  );
  function endDrag(cancel = false) {
    if (!drag) return;
    const old = drag;
    drag = null;
    cancelAnimationFrame(old.frame);
    old.ghost?.remove();
    page.classList.remove('is-dragging', 'is-dragging-media');
    scheduleBoardLayout();
    clearDrop();
    if (old.active && !cancel && old.target)
      void attempt(() => move(old.kind, old.id, old.target.parent, old.target.index, old.parent));
  }
  page.addEventListener('pointerup', (e) => {
    if (drag?.pointerId === e.pointerId) endDrag();
  });
  page.addEventListener('pointercancel', (e) => {
    if (drag?.pointerId === e.pointerId) endDrag(true);
  });
  page.addEventListener('lostpointercapture', (e) => {
    if (drag?.pointerId === e.pointerId) endDrag(true);
  });
  $('media-dialog').addEventListener('close', () => endDrag(true));
  page.addEventListener('keydown', (e) => {
    const handle = e.target.closest('[data-drag-id]');
    if (
      handle?.dataset.dragKind === 'item' &&
      e.altKey &&
      ['ArrowUp', 'ArrowDown'].includes(e.key)
    ) {
      e.preventDefault();
      const entries = mediaEntries(handle.dataset.dragParent);
      const index = entries.findIndex((ref) => ref.Id === handle.dataset.dragId);
      void attempt(() =>
        moveMedia(
          handle.dataset.dragId,
          handle.dataset.dragParent,
          index + (e.key === 'ArrowUp' ? -1 : 2),
          true,
        ),
      );
    } else if (handle && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMove(handle.dataset.dragKind, handle.dataset.dragId, handle.dataset.dragParent);
    }
    if (e.key === 'Escape') {
      endDrag(true);
      hideHelp();
    }
  });
  $('export').onclick = () =>
    attempt(() => {
      const data = { ...C.clone(model), schemaVersion: 1 },
        url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = 'franchise-explorer-backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  $('import').onclick = () => $('import-file').click();
  $('import-file').onchange = () =>
    attempt(async () => {
      const file = $('import-file').files[0];
      if (!file) return;
      try {
        if (file.size > 24 * 1024 * 1024) throw Error('Choose a backup under 24 MB.');
        const raw = JSON.parse(await file.text());
        if (raw.schema === 'franchise-ui-prototype-v1' || !Array.isArray(raw.Nodes))
          throw Error('Choose a real Franchise Explorer backup, not a UI preview backup.');
        const next = C.normalize(raw);
        remember();
        model = { ...model, ...next };
        markDirty();
        expanded.clear();
        render();
        notify('Backup imported for review. Save changes to apply it.');
      } finally {
        $('import-file').value = '';
      }
    });
  let helpTimer, helpAnchor;
  function hideHelp() {
    clearTimeout(helpTimer);
    if (helpAnchor) helpAnchor.removeAttribute('aria-describedby');
    helpAnchor = null;
    $('help').hidden = true;
  }
  function scheduleHelp(anchor) {
    if (!anchor || anchor === helpAnchor) return;
    hideHelp();
    helpAnchor = anchor;
    helpTimer = setTimeout(() => {
      if (!anchor.isConnected) return;
      const tip = $('help');
      (anchor.closest('dialog') || page).append(tip);
      tip.textContent = anchor.dataset.help;
      tip.hidden = false;
      anchor.setAttribute('aria-describedby', 'help');
      const box = anchor.getBoundingClientRect(),
        size = tip.getBoundingClientRect();
      tip.style.left = Math.max(10, Math.min(box.left, innerWidth - size.width - 10)) + 'px';
      tip.style.top =
        (box.bottom + size.height + 15 > innerHeight
          ? Math.max(10, box.top - size.height - 8)
          : box.bottom + 8) + 'px';
    }, 2200);
  }
  page.addEventListener('pointerover', (e) => {
    if (!drag) scheduleHelp(e.target.closest('[data-help]'));
  });
  page.addEventListener('pointerout', (e) => {
    if (helpAnchor && !helpAnchor.contains(e.relatedTarget)) hideHelp();
  });
  page.addEventListener('focusin', (e) => scheduleHelp(e.target.closest('[data-help]')));
  page.addEventListener('focusout', (e) => {
    if (helpAnchor && !helpAnchor.contains(e.relatedTarget)) hideHelp();
  });
  page.addEventListener('scroll', hideHelp, true);
  page.addEventListener('click', hideHelp);
  page.addEventListener('input', hideHelp);
  function viewerPreferences() {
    let profileUserId = '', profileToken = '', profileRequest = 0;
    const identity = (value) => {
      const text = String(value || '').toLowerCase();
      return /^[a-f\d]{32}$|^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(text)
        ? text.replace(/-/g, '') : text;
    };
    const same = (left, right) => !!left && !!right && identity(left) === identity(right);
    const apiValue = (name) => {
      try {
        const value = ApiClient[name];
        return typeof value === 'function' ? value.call(ApiClient) : value;
      } catch (_) { return null; }
    };
    function preferenceKeys() {
      const token = apiValue('accessToken') || '',
        uid = apiValue('getCurrentUserId') || (token === profileToken ? profileUserId : ''),
        currentServer = apiValue('serverId') || apiValue('serverInfo')?.Id;
      if (!uid) return null;
      let servers = [];
      try {
        const cached = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
        if (Array.isArray(cached.Servers)) servers = cached.Servers;
      } catch (_) { /* The active API session can identify this account without cached credentials. */ }
      const matches = servers.filter((server) => server && server.Id && same(server.UserId, uid));
      let chosen;
      if (currentServer) {
        const matchingServer = matches.filter((server) => same(server.Id, currentServer));
        chosen = matchingServer.find((server) => token && server.AccessToken === token) || matchingServer[0];
      } else {
        const originMatches = matches.filter((server) =>
          ['ManualAddress', 'LocalAddress', 'RemoteAddress', 'LastConnectionAddress'].some((key) => {
            try { return new URL(server[key]).origin === location.origin; } catch (_) { return false; }
          }),
        );
        if (new Set(originMatches.map((server) => identity(server.Id))).size === 1)
          chosen = originMatches[0];
        else if (!originMatches.length && matches.length === 1) chosen = matches[0];
      }
      const serverId = chosen?.Id || currentServer, userId = chosen?.UserId || uid;
      if (!serverId) return null;
      return {
        serverId, userId,
        subtitles: 'fe-subtitles:' + serverId + ':' + userId,
        language: 'fe-subtitle-language:' + serverId + ':' + userId,
        native: 'fe-show-active-native-rows:' + location.origin + ':' + String(userId).toLowerCase(),
      };
    }
    function matchingKeys(keys, kind) {
      const primary = keys[kind], found = new Set([primary]),
        prefix = kind === 'native' ? 'fe-show-active-native-rows:' + location.origin + ':'
          : kind === 'subtitles' ? 'fe-subtitles:' : 'fe-subtitle-language:';
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        if (kind === 'native') {
          if (same(key.slice(prefix.length), keys.userId)) found.add(key);
        } else {
          const [serverId, userId] = key.slice(prefix.length).split(':');
          if (same(serverId, keys.serverId) && same(userId, keys.userId)) found.add(key);
        }
      }
      return [...found];
    }
    function readPreference(keys, kind) {
      for (const key of matchingKeys(keys, kind)) {
        const value = localStorage.getItem(key);
        if (value !== null) return value;
      }
      return null;
    }
    function savePreference(keys, kind, value) {
      const saved = matchingKeys(keys, kind).map((key) => [key, localStorage.getItem(key)]),
        written = [];
      try {
        for (const [key, previous] of saved) {
          localStorage.setItem(key, value);
          written.push([key, previous]);
        }
      } catch (error) {
        for (const [key, previous] of written.reverse()) {
          try {
            if (previous === null) localStorage.removeItem(key);
            else localStorage.setItem(key, previous);
          } catch (_) { /* Preserve the visible prior state and report the failed save. */ }
        }
        throw error;
      }
    }
    const codes =
        'ar bg ca cs da de el en es et fa fi fr he hi hr hu id is it ja ko lt lv ms nb nl pl pt ro ru sk sl sr sv th tr uk ur vi zh'.split(
          ' ',
        ),
      names =
        typeof Intl.DisplayNames === 'function'
          ? new Intl.DisplayNames(['en'], { type: 'language' })
          : null;
    $('language').innerHTML =
      '<option value="">Use Jellyfin preference</option>' +
      codes
        .map((code) => '<option value="' + code + '">' + esc(names?.of(code) || code) + '</option>')
        .join('');
    const show = (state) => {
      const { keys, enabled, hide, language } = state;
      for (const [id, value] of [
        ['subtitles', enabled],
        ['hide-native', hide],
      ]) {
        $(id).disabled = !keys;
        $(id).setAttribute('aria-checked', String(value));
        $(id).querySelector('.switch-label').textContent = value ? 'On' : 'Off';
      }
      $('language').disabled = !keys || !enabled;
      $('language').value = language;
    };
    let lastState = { keys: null, enabled: false, hide: false, language: '' };
    const sync = () => {
      const keys = preferenceKeys();
      try {
        lastState = { keys, enabled: !!keys && readPreference(keys, 'subtitles') === '1',
          hide: !!keys && readPreference(keys, 'native') === '0',
          language: keys ? readPreference(keys, 'language') || '' : '' };
        show(lastState);
        return lastState;
      } catch (_) {
        show({ ...lastState, keys: null });
        notify('Could not read viewer preferences. Allow browser storage and reopen settings.', true);
        return null;
      }
    };
    const subtitlesChanged = (keys) => {
      if (keys)
        window.dispatchEvent(
          new CustomEvent('franchise-subtitles-changed', {
            detail: { serverId: keys.serverId, userId: keys.userId },
          }),
        );
    };
    const changePreference = (kind, value) => {
      const before = sync();
      if (!before?.keys) return;
      try {
        const next = typeof value === 'function' ? value(before) : value;
        savePreference(before.keys, kind, next);
        const after = sync();
        if (after && kind !== 'native') subtitlesChanged(after.keys);
      } catch (_) {
        show(before);
        notify('Could not save viewer preferences. Allow browser storage and try again.', true);
      }
    };
    $('subtitles').onclick = () => {
      changePreference('subtitles', (state) => state.enabled ? '0' : '1');
    };
    $('hide-native').onclick = () => {
      changePreference('native', (state) => state.hide ? '1' : '0');
    };
    $('language').onchange = () => {
      changePreference('language', $('language').value);
    };
    sync();
    function loadProfile() {
      if (!ApiClient.getCurrentUser) return;
      const serial = ++profileRequest, token = apiValue('accessToken') || '';
      void Promise.resolve().then(() => ApiClient.getCurrentUser())
        .then((user) => {
          if (serial !== profileRequest || token !== (apiValue('accessToken') || '')) return;
          const uid = apiValue('getCurrentUserId'), profileId = user.Id || user.id || uid;
          if (uid && profileId && !same(uid, profileId)) return;
          profileUserId = profileId || '';
          profileToken = token;
          sync();
          const preferred =
            user.Configuration?.SubtitleLanguagePreference ||
            user.configuration?.subtitleLanguagePreference;
          if (preferred)
            $('language').options[0].textContent =
              'Use Jellyfin preference (' +
              (names?.of(
                { deu: 'de', ger: 'de', eng: 'en', fra: 'fr', fre: 'fr', spa: 'es', jpn: 'ja' }[
                  preferred
                ] || preferred,
              ) || preferred) +
              ')';
        })
        .catch(() => {});
    }
    page.addEventListener('pageshow', () => { sync(); loadProfile(); });
    $('settings').addEventListener('toggle', () => {
      if ($('settings').open) { sync(); loadProfile(); }
    });
    window.addEventListener('storage', (event) => {
      if (!event.key || event.key === 'jellyfin_credentials' ||
          ['fe-subtitles:', 'fe-subtitle-language:', 'fe-show-active-native-rows:'].some(
            (prefix) => event.key.startsWith(prefix))) sync();
    });
    loadProfile();
  }
  const artwork = window.FranchiseSettingsArtwork.create({
    page,
    $,
    core: C,
    getModel: () => model,
    rows,
    descendants,
    rootOf,
    path,
    references,
    reference,
    item,
    request,
    image,
    forgetImage,
    serverUrl,
    headers,
    notify,
    change,
    render,
  });
  page.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const data = target.dataset;
    if (data.close) $(data.close).close();
    else if (data.expand) {
      expanded.has(data.expand) ? expanded.delete(data.expand) : expanded.add(data.expand);
      render();
    } else if (data.toggleRow) {
      if (target.getAttribute('aria-expanded') === 'true') {
        openRows.delete(data.toggleRow);
        collapsedRows.add(data.toggleRow);
      } else {
        openRows.add(data.toggleRow);
        collapsedRows.delete(data.toggleRow);
      }
      render();
    } else if (data.select || data.settingsNode) openNode(data.select || data.settingsNode);
    else if (data.rowSelect || data.settingsRow) openRow(data.rowSelect || data.settingsRow);
    else if (data.addNode) openMedia('node', data.addNode);
    else if (data.addRow) openMedia('row', data.addRow);
    else if (data.deleteNode) openDelete('node', data.deleteNode);
    else if (data.deleteRow) openDelete('row', data.deleteRow);
    else if (data.removeItem) openDelete('item', data.removeItem, data.itemRow);
    else if (data.recoverReference) automation?.openRecovery?.(data.recoverReference);
    else if (data.editLibraryItem)
      void attempt(() => editRange(data.itemRow, data.editLibraryItem));
    else if (data.settingsItem) artwork.openItem(data.itemRow, data.settingsItem);
  });
  const wrap = page.querySelector('.fx-wrap');
  function fit() {
    if (!page.isConnected || !wrap) return;
    const box = page.getBoundingClientRect(),
      available = Math.max(
        240,
        Math.floor(
          (document.documentElement.clientWidth || innerWidth) - Math.max(0, box.left) - 14,
        ),
      );
    const width = Math.min(1150, available, page.parentElement?.clientWidth || available);
    wrap.style.maxWidth = width + 'px';
    if (box.right > innerWidth) {
      wrap.style.marginLeft = '0';
      wrap.style.marginRight = '0';
    }
  }
  addEventListener('resize', () => { fit(); scheduleBoardLayout(); });
  fit();
  window.FranchiseSettings = {
    getModel: () => C.clone(model),
    getRevision: () => revision,
    load: () => load(true),
    core: C,
  };
  automation = window.FranchiseSettingsAutomation?.init({
    page, $, core: C, getModel: () => model, load: () => load(true), notify, request,
    change, render, show, refreshMediaAvailability, isDirty: () => dirty || saving,
  }) || null;
  viewerPreferences();
  page.addEventListener('pageshow', () => {
    if (!loaded) void attempt(load);
  });
  void attempt(load);
})();
