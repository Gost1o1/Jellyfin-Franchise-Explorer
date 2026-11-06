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
    revision = 0;
  let selected = '',
    nodeDraft = null,
    rowDraft = null,
    structure = null,
    subgroupParent = '',
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
    if (!itemCache.has(key))
      itemCache.set(
        key,
        (ApiClient.getItem
          ? ApiClient.getItem(ApiClient.getCurrentUserId?.(), id)
          : request(
              'Items/' + id + '?userId=' + encodeURIComponent(ApiClient.getCurrentUserId?.() || ''),
            )
        ).catch(() => null),
      );
    return itemCache.get(key);
  }
  async function image(route) {
    if (!route) return '';
    C.artRef(route);
    const u = new URL(route, location.origin);
    if (u.origin !== location.origin) return u.protocol === 'https:' ? u.href : '';
    const prefix = new URL(serverUrl('FranchiseExplorer/Browse'), location.origin).pathname.replace(
      /\/FranchiseExplorer\/Browse$/,
      '',
    );
    const stripped =
      prefix && u.pathname.startsWith(prefix + '/') ? u.pathname.slice(prefix.length) : u.pathname;
    if (!/^\/(?:Items\/|FranchiseExplorer\/Artwork\/)/i.test(stripped)) return '';
    const url = serverUrl(stripped + u.search);
    if (!blobCache.has(url))
      blobCache.set(
        url,
        fetch(url, { headers: headers() })
          .then((r) => {
            if (!r.ok) throw Error('Image unavailable');
            return r.blob();
          })
          .then((blob) => (blob.type.startsWith('image/') ? URL.createObjectURL(blob) : ''))
          .catch(() => ''),
      );
    return blobCache.get(url);
  }
  async function persist() {
    if (!loaded) throw Error('Wait for the plugin configuration to load.');
    const latest = await ApiClient.getPluginConfiguration(pluginId),
      normalized = C.normalize(latest);
    if (fingerprint(normalized) !== baseline)
      throw Error(
        'The saved configuration changed on the server. Reload before saving your edits.',
      );
    const safe = C.normalize(model),
      next = {
        ...latest,
        NavigationLabel: safe.NavigationLabel,
        Nodes: safe.Nodes,
        Rows: safe.Rows,
        MediaLinks: safe.MediaLinks,
      };
    await ApiClient.updatePluginConfiguration(pluginId, next);
    model = safe;
    baseline = fingerprint(safe);
    dirty = false;
    $('save-state').textContent = 'All changes saved';
    $('save-state').classList.remove('dirty');
    notify('Configuration saved');
  }
  async function load(reload = false) {
    const raw = await ApiClient.getPluginConfiguration(pluginId),
      next = C.normalize(raw);
    if (reload && loaded) remember();
    model = next;
    baseline = fingerprint(next);
    loaded = true;
    dirty = false;
    revision++;
    $('save-state').textContent = 'All changes saved';
    $('save-state').classList.remove('dirty');
    $('save').disabled = false;
    render();
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
                '</span>' +
                (manage
                  ? '<div class="media-actions">' +
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
  function rowView(row) {
    const open = openRows.has(row.Id);
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
      references(row).length +
      '</span></button>' +
      actions('row', row.Id, row.Name) +
      '</div>' +
      (open
        ? '<div class="row-contents">' +
          mediaList(row, false) +
          (row.NodeIds.length
            ? '<div class="empty-media">' +
              row.NodeIds.length +
              ' subgroup reference(s); groups remain in their hierarchy below.</div>'
            : '') +
          '</div>'
        : '') +
      '</div>'
    );
  }
  function nodeView(node, root = true) {
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
      (root ? 'x' : 'y') +
      '"><div class="node-head">' +
      grip('node', node.Id, node.Name) +
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
          rows(node.Id).map(rowView).join('') +
          children(node.Id)
            .map((child) => nodeView(child, false))
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
  function render() {
    const roots = children('');
    $('franchise-count').textContent = roots.length + ' franchises';
    $('board').innerHTML =
      roots.map((n) => nodeView(n)).join('') +
      '<div class="board-drop" data-drop="root">Move to top level</div>' +
      (roots.length ? '' : '<div class="empty">No franchises. Add a franchise to begin.</div>');
    $('undo').disabled = !history.length;
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
  function openNode(id) {
    const node = getNode(id);
    if (!node) return;
    selected = id;
    nodeDraft = stageFields({ node: C.clone(node), sourceNodes: {}, sourceRows: {} });
    for (const n of model.Nodes.filter((n) => descendants(id).has(n.Id)))
      nodeDraft.sourceNodes[n.Id] = C.clone(n.AutoAddSources || []);
    for (const row of model.Rows.filter((r) => descendants(id).has(r.ParentNodeId)))
      nodeDraft.sourceRows[row.Id] = row.SourceUrl || '';
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
          '" placeholder="https://www.imdb.com/list/ls…/"></label>' +
          rows(n.Id)
            .map(
              (row) =>
                '<label class="field"><span>' +
                esc(row.Name) +
                ' · Row URL</span><input type="url" data-source-row="' +
                row.Id +
                '" value="' +
                esc(nodeDraft.sourceRows[row.Id]) +
                '" placeholder="Optional row source"></label>',
            )
            .join('') +
          '</section>',
      )
      .join('');
  }
  function updateNodeSource(id, value) {
    if (!nodeDraft) return;
    const previous = nodeDraft.sourceNodes[id] || [],
      first = previous.find((s) => s.Enabled !== false) || previous[0];
    nodeDraft.sourceNodes[id] = value.trim()
      ? [
          {
            ...(first || {}),
            Id: first?.Id || C.guid(),
            Url: value.trim(),
            Enabled: true,
            Priority: first?.Priority || 0,
            Categories: first?.Categories?.length
              ? first.Categories
              : ['Chronological Timeline', 'Movies', 'TV Shows', 'Collections'],
          },
          ...previous.filter((s) => s !== first),
        ]
      : previous.filter((s) => s !== first);
  }
  $('source-list').oninput = (e) => {
    if (!nodeDraft) return;
    e.target.setCustomValidity('');
    if (e.target.dataset.sourceNode) {
      updateNodeSource(e.target.dataset.sourceNode, e.target.value);
      if (e.target.dataset.sourceNode === nodeDraft.node.Id)
        $('franchise-imdb-url').value = e.target.value;
    }
    if (e.target.dataset.sourceRow)
      nodeDraft.sourceRows[e.target.dataset.sourceRow] = e.target.value;
  };
  $('franchise-imdb-url').oninput = () => {
    if (!nodeDraft) return;
    updateNodeSource(nodeDraft.node.Id, $('franchise-imdb-url').value);
    const linked = $('source-list').querySelector('[data-source-node="' + nodeDraft.node.Id + '"]');
    if (linked) linked.value = $('franchise-imdb-url').value;
  };
  $('detail-title').oninput = () => $('detail-title').setCustomValidity('');
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
    for (const [id, url] of Object.entries(nodeDraft.sourceRows)) {
      const row = next.Rows.find((r) => r.Id === id);
      if (row) row.SourceUrl = url.trim() ? C.autoAdd.url(url) : '';
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
    artwork.render(
      $('row-photos'),
      { kind: 'row', id: row.Id, parentId: row.ParentNodeId, category: type },
      row.Artwork,
      (value) => (row.Artwork = value),
    );
    pendingView();
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
            if (child) child.ParentId = node.Id;
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
        draft.pendingGroups.push(newNode(parent, name));
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
  function openSubgroup(parent) {
    subgroupParent = parent;
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
      change(() => model.Nodes.push(newNode(subgroupParent, name)));
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
    const unassigned = model.MediaLinks.filter(
      (l) => l.NodeId === owner.Id && !model.Rows.some((r) => r.MediaLinkIds.includes(l.Id)),
    ).sort((a, b) => a.Position - b.Position);
    if (unassigned.length)
      content +=
        '<section class="media-current-group"><h4>Franchise media</h4>' +
        mediaList(
          {
            Id: 'node:' + owner.Id,
            Name: 'Franchise media',
            Items: [],
            MediaLinkIds: unassigned.map((l) => l.Id),
            MediaOrder: unassigned.map((l) => l.Id),
          },
          true,
        ) +
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
    const parent =
      mediaScope?.kind === 'row' ? getRow(mediaScope.id)?.ParentNodeId : mediaScope?.id;
    if (!parent) return;
    $('media-dialog').close();
    openSubgroup(parent);
  };
  $('media-convert-row').onclick = () => {
    if (mediaScope?.kind !== 'row') return;
    const id = mediaScope.id;
    $('media-dialog').close();
    openRow(id);
    convertRow();
  };
  function rangeFieldsVisibility() {
    const mode = $('library-range-mode').value;
    $('library-range-endpoints').hidden = mode === 'full';
    page
      .querySelectorAll('#library-range-endpoints .episode-field')
      .forEach((el) => (el.hidden = mode !== 'episodes'));
    $('library-range-error').hidden = true;
  }
  function openRange(state, media, existing = null) {
    rangeDraft = { state, media, existing };
    const ref = existing?.ref;
    $('library-range-title').textContent = media.Name;
    $('library-range-mode').value =
      { Full: 'full', Seasons: 'seasons', Episodes: 'episodes' }[ref?.RangeMode] || 'full';
    for (const [id, key, fallback] of [
      ['library-from-season', 'StartSeason', 1],
      ['library-to-season', 'EndSeason', 1],
      ['library-from-episode', 'StartEpisode', 1],
      ['library-to-episode', 'EndEpisode', 3],
    ])
      $(id).value = ref?.[key] || fallback;
    $('confirm-library-range').textContent = ref ? 'Save range' : 'Add to row';
    rangeFieldsVisibility();
    show('library-range-dialog');
  }
  $('library-range-mode').onchange = rangeFieldsVisibility;
  $('confirm-library-range').onclick = () => {
    try {
      if (!rangeDraft) return;
      const { state, media, existing } = rangeDraft,
        fields = C.rangeFields({
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
        change(() => Object.assign(located.ref, fields));
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
  $('library-range-dialog').addEventListener('close', () => (rangeDraft = null));
  async function editRange(rowId, id) {
    const found = reference(rowId, id);
    if (!found) return;
    const media = await item(found.ref.JellyfinItemId);
    if (!media) throw Error('Jellyfin could not resolve this show.');
    openRange(null, media, { ...found, rowId });
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
      n.AutoAddRows = n.AutoAddRows.filter((m) => rowIds.has(m.RowId));
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
          model.Nodes = model.Nodes.filter((n) => !branch.has(n.Id));
          model.MediaLinks = model.MediaLinks.filter((l) => !branch.has(l.NodeId));
          model.Rows = model.Rows.filter((r) => !branch.has(r.ParentNodeId));
        } else if (kind === 'row') {
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
          job.diff.additions.filter((a) => a.kind === 'title').map((a) => [a.entry.imdbId, a]),
        ),
        plan = C.autoAdd.plan(
          job.entries.map((e) => (titleAdds.has(e.imdbId) ? e : { ...e, status: 'excluded' })),
        );
      for (const group of plan.groups) {
        const entries = group.episodes || [group.entry],
          adds = entries.map((e) => titleAdds.get(e.imdbId)).filter(Boolean);
        if (!adds.length) continue;
        const keys = adds.map((a) => reviewKey(job, a.key));
        review.cells.push({
          change: 'add',
          title: group.label,
          type: group.episodes ? 'TV Show' : shortType(group.entry.item.Type),
          where: reviewWhere(job, group, false, [...new Set(adds.flatMap((a) => a.rowIds || []))]),
          keys,
          children: group.episodes
            ? adds.map((a) => ({ key: reviewKey(job, a.key), title: a.label }))
            : null,
        });
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
    $('apply-selected').disabled = !review.selected.size;
  }
  $('franchise-preview').onclick = () =>
    attempt(async () => {
      const generation = ++autoGeneration,
        base = nodeDraftModel();
      if (!base) return;
      const nodeId = nodeDraft.node.Id,
        jobs = C.scopedJobs(base, nodeId),
        modelBefore = fingerprint(model);
      if (!jobs.length) throw Error('Add an IMDb URL to the franchise, subgroup or a media row.');
      $('franchise-preview').disabled = true;
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
          !nodeDraft ||
          nodeDraft.node.Id !== nodeId ||
          fingerprint(model) !== modelBefore
        )
          return;
        for (const job of jobs) {
          job.entries = C.autoAdd.preview(job.results, library);
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
          modelBefore,
          cells: [],
          expanded: new Set(),
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
        $('franchise-preview').disabled = false;
      }
    });
  $('franchise-dialog').addEventListener('close', () => autoGeneration++);
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
    for (const key of keys)
      e.target.checked ? review.selected.add(key) : review.selected.delete(key);
    renderReview();
  };
  function selectReview(all) {
    if (!review) return;
    review.selected.clear();
    if (all) for (const cell of review.cells) for (const key of cell.keys) review.selected.add(key);
    renderReview();
  }
  $('select-all').onclick = () => selectReview(true);
  $('clear-selection').onclick = () => selectReview(false);
  $('review-all').onchange = (e) => selectReview(e.target.checked);
  $('apply-selected').onclick = () =>
    attempt(() => {
      if (!review || !review.selected.size) return;
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
      const nodeId = review.nodeId;
      remember();
      model = C.normalize(next);
      markDirty();
      expandPath(nodeId);
      render();
      $('review').close();
      openNode(nodeId);
      notify('Review applied. Save changes to persist.');
    });

  function move(kind, id, parent, index) {
    if (kind === 'item') return moveMedia(id, parent, index);
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
    change(() => {
      const entry = kind === 'node' ? getNode(id) : getRow(id);
      if (!entry) throw Error('This entry no longer exists.');
      if (kind === 'row' && !parent) throw Error('A row needs an owning group.');
      const oldParent = kind === 'node' ? entry.ParentId : entry.ParentNodeId,
        destination = kind === 'node' ? children(parent) : rows(parent),
        previous = destination.findIndex((x) => x.Id === id);
      if (oldParent === parent && previous >= 0 && previous < index) index--;
      if (kind === 'node') entry.ParentId = parent;
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
    movePayload = { kind, id };
    $('move-parent').closest('label').hidden = false;
    $('move-scope').hidden = true;
    $('move-heading').textContent = 'Move ' + entry.Name;
    const blocked = kind === 'node' ? descendants(id) : new Set();
    $('move-parent').innerHTML =
      (kind === 'node' ? '<option value="">Top level</option>' : '') +
      model.Nodes.filter((n) => !blocked.has(n.Id))
        .map((n) => '<option value="' + n.Id + '">' + esc(path(n.Id)) + '</option>')
        .join('');
    $('move-parent').value = kind === 'node' ? entry.ParentId : entry.ParentNodeId;
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
    const list =
      movePayload.kind === 'node' ? children($('move-parent').value) : rows($('move-parent').value);
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
    const el = point?.closest('[data-drop]:not([data-drop="media"])');
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
        index = children(parent).length;
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
          before =
            el.dataset.axis === 'x' ? x < box.left + box.width / 2 : y < box.top + box.height / 2;
        parent = node.ParentId;
        index = children(parent).findIndex((n) => n.Id === node.Id) + (before ? 0 : 1);
        style = before ? 'drop-before' : 'drop-after';
      }
    }
    if (drag.kind === 'node' && parent && descendants(drag.id).has(parent)) return null;
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
    clearDrop();
    if (old.active && !cancel && old.target)
      void attempt(() => move(old.kind, old.id, old.target.parent, old.target.index));
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
    let keys = null;
    try {
      const uid = ApiClient.getCurrentUserId?.(),
        servers = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}').Servers || [],
        matches = servers.filter((s) => s.UserId?.toLowerCase() === uid?.toLowerCase()),
        chosen =
          matches.find((s) =>
            ['ManualAddress', 'LocalAddress', 'RemoteAddress', 'LastConnectionAddress'].some(
              (k) => {
                try {
                  return new URL(s[k]).origin === location.origin;
                } catch (_) {
                  return false;
                }
              },
            ),
          ) || (matches.length === 1 ? matches[0] : null);
      if (chosen && uid)
        keys = {
          serverId: chosen.Id,
          userId: chosen.UserId,
          subtitles: 'fe-subtitles:' + chosen.Id + ':' + chosen.UserId,
          language: 'fe-subtitle-language:' + chosen.Id + ':' + chosen.UserId,
          native: 'fe-show-active-native-rows:' + location.origin + ':' + uid.toLowerCase(),
        };
    } catch (_) {}
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
    const sync = () => {
      const enabled = !!keys && localStorage.getItem(keys.subtitles) === '1',
        hide = !!keys && localStorage.getItem(keys.native) === '0';
      for (const [id, value] of [
        ['subtitles', enabled],
        ['hide-native', hide],
      ]) {
        $(id).disabled = !keys;
        $(id).setAttribute('aria-checked', String(value));
        $(id).querySelector('.switch-label').textContent = value ? 'On' : 'Off';
      }
      $('language').disabled = !keys || !enabled;
      $('language').value = keys ? localStorage.getItem(keys.language) || '' : '';
    };
    const subtitlesChanged = () => {
      if (keys)
        window.dispatchEvent(
          new CustomEvent('franchise-subtitles-changed', {
            detail: { serverId: keys.serverId, userId: keys.userId },
          }),
        );
    };
    $('subtitles').onclick = () => {
      if (keys)
        localStorage.setItem(
          keys.subtitles,
          localStorage.getItem(keys.subtitles) === '1' ? '0' : '1',
        );
      sync();
      subtitlesChanged();
    };
    $('hide-native').onclick = () => {
      if (keys)
        localStorage.setItem(keys.native, localStorage.getItem(keys.native) === '0' ? '1' : '0');
      sync();
    };
    $('language').onchange = () => {
      if (keys) localStorage.setItem(keys.language, $('language').value);
      sync();
      subtitlesChanged();
    };
    sync();
    if (ApiClient.getCurrentUser)
      void ApiClient.getCurrentUser()
        .then((user) => {
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
      openRows.has(data.toggleRow) ? openRows.delete(data.toggleRow) : openRows.add(data.toggleRow);
      render();
    } else if (data.select || data.settingsNode) openNode(data.select || data.settingsNode);
    else if (data.rowSelect || data.settingsRow) openRow(data.rowSelect || data.settingsRow);
    else if (data.addNode) openMedia('node', data.addNode);
    else if (data.addRow) openMedia('row', data.addRow);
    else if (data.deleteNode) openDelete('node', data.deleteNode);
    else if (data.deleteRow) openDelete('row', data.deleteRow);
    else if (data.removeItem) openDelete('item', data.removeItem, data.itemRow);
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
  addEventListener('resize', fit);
  fit();
  window.FranchiseSettings = {
    getModel: () => C.clone(model),
    getRevision: () => revision,
    load: () => load(true),
    core: C,
  };
  viewerPreferences();
  page.addEventListener('pageshow', () => {
    if (!loaded) void attempt(load);
  });
  void attempt(load);
})();
