/* Server-owned automation and recovery. No registry, inbox or selection rules use browser storage. */
(function () {
  'use strict';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const list = (value) => Array.isArray(value) ? value : [];
  const get = (value, key, fallback = '') => value?.[key] ?? value?.[key[0].toUpperCase() + key.slice(1)] ?? fallback;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const camel = (value) => Array.isArray(value) ? value.map(camel) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key[0].toLowerCase() + key.slice(1), camel(entry)])) : value;
  const sourceLink = (url) => /^https:\/\/www\.imdb\.com\/list\/ls\d+\/?$/.test(url || '')
    ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : esc(url);
  const when = (value) => value ? new Date(value).toLocaleString() : 'Never';
  const range = (entry) => {
    if (!entry.startSeason && !entry.endSeason && !entry.startEpisode && !entry.endEpisode) return '';
    return ' · S' + String(entry.startSeason ?? 0).padStart(2, '0') +
      (entry.startEpisode ? 'E' + String(entry.startEpisode).padStart(2, '0') : '') +
      '–S' + String(entry.endSeason ?? entry.startSeason ?? 0).padStart(2, '0') +
      (entry.endEpisode ? 'E' + String(entry.endEpisode).padStart(2, '0') : '');
  };
  function init(context) {
    const { page, $, getModel, load, notify, request, change } = context;
    if (!$('auto-manage')) return null;
    let status = null, recovery = null, preview = null, busy = false, generation = 0, editingId = '',
      recoveryError = '', recoveryLoading = false, recoveryPreparing = false, recoveryReportUnavailable = false,
      recoveryFocus = '', lastStatusError = '', lastAutoRemapped = null;
    const selected = new Set(), selectedRules = new Set(), previewSelected = new Set(), recoveryChoices = new Map();
    const recoveryQueries = new Map(), recoveryLibrary = new Map(), recoveryLibraryChoices = new Map();
    const referenceKey = (value) => String(value || '').replace(/-/g, '').toLowerCase();
    const settings = () => camel((context.isDirty?.() && getModel().AutoFranchises) || status?.settings || getModel().AutoFranchises || {});
    const registrations = () => list(settings().registry);
    const pending = () => list(settings().pendingChanges).filter((entry) => entry.status === 'Pending');
    const rules = () => list(settings().exclusions).filter((entry) => entry.enabled !== false);
    const modelDirty = () => !!context.isDirty?.();
    const show = (id) => context.show ? context.show(id) : $(id).showModal();
    const post = (route, body) => request('FranchiseExplorer/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    function problem(message) {
      $('automation-error').textContent = message;
      $('automation-error').hidden = !message;
      if (message) notify(message, true);
    }
    function recoveryProblem(message) {
      recoveryError = message;
      if (message) notify(message, true);
    }
    const canSearchRecovery = () => !recoveryReportUnavailable && !!recovery &&
      (recovery.canSearch ?? recovery.libraryHealthy) === true;
    const automaticRecoveryEnabled = () => {
      const config = getModel().MediaRecovery || {};
      return (recovery?.enabled ?? get(config, 'enabled', true)) !== false &&
        (recovery?.autoReconnect ?? get(config, 'autoReconnect', true)) !== false;
    };
    const unresolved = () => list(recovery?.entries).filter((entry) => entry.status !== 'Healthy');
    const automaticMatches = () => unresolved().filter((entry) => entry.canAutoRemap === true);
    function savedReferenceCount() {
      const model = getModel();
      return list(model.MediaLinks).length + list(model.Rows).reduce((count, row) => count + list(row.Items).length, 0) +
        list(model.Nodes).filter((node) => node.CollectionId).length;
    }
    function changedServerReferences() {
      const model = getModel(),
        local = new Map([...list(model.MediaLinks), ...list(model.Rows).flatMap((row) => list(row.Items))]
          .map((entry) => [referenceKey(entry.Id), referenceKey(entry.JellyfinItemId)]));
      for (const node of list(model.Nodes)) if (node.CollectionId)
        local.set(referenceKey('collection:' + node.Id), referenceKey(node.CollectionId));
      return list(recovery?.entries).filter((entry) => local.has(referenceKey(entry.referenceId)) &&
        local.get(referenceKey(entry.referenceId)) !== referenceKey(entry.oldItemId)).length;
    }
    function recoverySummary() {
      if (recoveryError) return 'Media recovery could not be checked. ' + recoveryError;
      if (!recovery) return recoveryLoading ? 'Checking saved media references…' : 'Recovery has not checked your saved references yet.';
      const checked = recovery.referenceCount ?? list(recovery.entries).length,
        attention = recovery.attentionCount ?? unresolved().length,
        healthy = recovery.healthyCount ?? Math.max(0, checked - attention),
        ready = automaticMatches().length;
      return checked + ' saved references checked · ' + healthy + ' available · ' + attention + ' need attention. ' +
        (ready ? ready + ' can remap automatically; ' + Math.max(0, attention - ready) + ' need manual review. ' : '') +
        (lastAutoRemapped !== null ? 'Last auto remap: ' + lastAutoRemapped + ' references reconnected. ' : '') +
        (recovery.message || '') + (recovery.enabled === false ? ' Recovery is disabled.' : '') +
        (recovery.libraryHealthy === false
          ? canSearchRecovery() ? ' Original offline items stay protected; clear replacements for removed IDs can be remapped.'
            : ' Reconnection is paused until the library can be checked.'
          : '');
    }
    function renderRecoveryNotice() {
      const checked = recovery?.referenceCount ?? list(recovery?.entries).length,
        attention = recovery?.attentionCount ?? unresolved().length,
        localCount = savedReferenceCount(),
        unreported = !!recovery && checked === 0 && localCount > 0,
        paused = !!recovery && recovery.libraryHealthy === false && localCount > 0,
        changed = changedServerReferences();
      $('recovery-notice').hidden = !recoveryError && !attention && !paused && !unreported && !changed &&
        !(!recovery && localCount > 0);
      $('recovery-notice-count').textContent = changed && !recoveryError
        ? changed + ' media references changed on the server. Reload saved settings to show the reconnected items.' +
          (modelDirty() ? ' Your current draft is kept until you choose to reload.' : '')
        : unreported && !recoveryError
        ? localCount + ' saved references are not in the latest recovery report. Save or reload your settings, then check recovery.'
        : recoverySummary();
      $('recovery-notice-review').textContent = recoveryError ? 'Review recovery error' : 'Review media references';
      $('recovery-reload').hidden = !changed;
    }
    function syncBusy() {
      for (const element of page.querySelectorAll('[data-automation-action]')) element.disabled = busy;
      $('auto-restore-selected').disabled = busy || !selected.size;
      $('auto-restore-rules').disabled = busy || !selectedRules.size;
      $('auto-preview-apply').disabled = busy || !previewSelected.size;
      $('auto-preview-selected-count').textContent = previewSelected.size + ' selected';
      $('auto-keep-choices').disabled = busy || !pending().length;
      $('recovery-apply').disabled = busy || recoveryPreparing || modelDirty() || !recoveryChoices.size ||
        !canSearchRecovery() || recovery?.enabled === false;
      $('recovery-auto-remap').disabled = busy || recoveryPreparing || modelDirty() || !canSearchRecovery() || recovery?.enabled === false;
      for (const element of $('recovery-results').querySelectorAll('[data-recovery-read], [data-recovery-search], [data-recovery-choice], [data-recovery-query]'))
        element.disabled = busy || recoveryPreparing || !canSearchRecovery() || element.dataset.recoveryPageDisabled === 'true';
      $('auto-run').disabled = busy || !!status?.running;
    }
    async function act(action, { write = false, reload = write, recoveryAction = false } = {}) {
      if (busy) return null;
      if (write && modelDirty()) {
        (recoveryAction ? recoveryProblem : problem)('Save or reload your unsaved configuration changes before changing server automation or recovery.');
        render();
        return null;
      }
      if (write) generation++;
      busy = true; syncBusy(); (recoveryAction ? recoveryProblem : problem)('');
      try {
        const result = await action();
        if (reload) {
          if (modelDirty()) problem('The server update finished. Your unsaved edits were kept. Save or reload them before another server action.');
          else await load();
        }
        return result;
      } catch (error) {
        (recoveryAction ? recoveryProblem : problem)(error.message || 'The server operation failed. Your current choices were kept.');
        return null;
      } finally {
        busy = false; render();
      }
    }
    async function refresh() {
      const current = ++generation;
      recoveryLoading = true;
      render();
      const results = await Promise.allSettled([
        request('FranchiseExplorer/Automation/Status'), request('FranchiseExplorer/Recovery/Status'),
      ]);
      if (current !== generation) return;
      if (results[0].status === 'fulfilled') status = camel(results[0].value);
      recoveryLoading = false;
      if (results[1].status === 'fulfilled') {
        recovery = camel(results[1].value);
        recoveryError = '';
        recoveryReportUnavailable = false;
      } else {
        recoveryError = results[1].reason?.message || 'The recovery report could not be loaded.';
        recoveryReportUnavailable = true;
      }
      if (results[0].status === 'rejected') {
        lastStatusError = results[0].reason?.message || 'Automation status could not be loaded.';
        $('automation-error').textContent = lastStatusError;
        $('automation-error').hidden = false;
      } else if ($('automation-error').textContent === lastStatusError) {
        $('automation-error').textContent = '';
        $('automation-error').hidden = true;
        lastStatusError = '';
      }
      render();
      context.refreshMediaAvailability?.();
    }
    function render() {
      const config = settings(), queued = pending(), protectedRules = rules();
      $('auto-enabled').checked = config.enabled === true;
      $('auto-registry-count').textContent = registrations().filter((entry) => entry.enabled && !entry.deleted).length +
        ' of ' + registrations().length + ' enabled';
      $('auto-schedule').textContent = 'Daily · 12:00 AM · Jellyfin server local time' +
        (status?.serverTimeZone ? ' (' + status.serverTimeZone + ')' : '');
      $('auto-review').textContent = 'Pending review (' + queued.length + ')';
      $('auto-manage-choices').textContent = 'Saved choices (' + protectedRules.length + ')';
      $('automation-notice').hidden = !queued.length;
      $('automation-notice-count').textContent = queued.length + ' automation change' + (queued.length === 1 ? '' : 's') + ' need review';
      const last = config.lastRun;
      $('auto-run-status').textContent = last
        ? 'Last run: ' + (last.status || 'Completed') + ' · ' + when(last.completedUtc || last.startedUtc) +
          ' · ' + (last.message || '') + ' · ' + (last.added || 0) + ' added, ' + (last.held || 0) + ' held, ' + (last.errors || 0) + ' errors'
        : 'Last run: Never. Midnight updates are off until you enable them.';
      if (status?.running) $('auto-run-status').textContent += ' · A server run is active.';
      $('auto-registry-list').innerHTML = registrations().map((entry) => {
        const target = list(getModel().Nodes).find((node) => node.Id === entry.franchiseNodeId);
        return '<article class="automation-registry-entry"><div class="automation-entry-summary"><strong>' + esc(entry.name) +
          '</strong><div>' + sourceLink(entry.url) + '</div><small>' + esc(target?.Name || (entry.franchiseNodeId ? 'Saved franchise' : 'Create new franchise')) +
          ' · ' + (entry.episodeFormat === 'Individual' ? 'Individual episodes' : 'Episode bundles') +
          (entry.deleted ? ' · Deleted franchise protected' : '') + '</small></div><div class="automation-actions">' +
          '<label><input type="checkbox" data-auto-toggle="' + esc(entry.id) + '" aria-label="Enable ' + esc(entry.name) + '"' +
          (entry.enabled ? ' checked' : '') + ' data-automation-action> Enabled</label>' +
          '<button data-auto-edit="' + esc(entry.id) + '" data-automation-action>Edit</button>' +
          '<button data-auto-remove="' + esc(entry.id) + '" data-automation-action>Remove</button></div></article>';
      }).join('') || '<p>No auto franchises. Add an entry to include it in the midnight task.</p>';
      if ($('auto-inbox-dialog').open) renderInbox();
      if ($('auto-choices-dialog').open) renderRules();
      const recoveryConfig = getModel().MediaRecovery || {};
      $('recovery-enabled').checked = get(recoveryConfig, 'enabled', true) !== false;
      $('recovery-auto').checked = get(recoveryConfig, 'autoReconnect', true) !== false;
      $('recovery-status').textContent = recoverySummary() + (recovery ? ' Last check: ' + when(recovery.checkedUtc) : '');
      $('recovery-review').textContent = 'Review recovery (' + list(recovery?.entries).filter((entry) => entry.status !== 'Healthy').length + ')';
      renderRecoveryNotice();
      if ($('recovery-dialog').open) renderRecovery();
      syncBusy();
    }
    function openEntry(id = '') {
      editingId = id;
      const entry = registrations().find((item) => item.id === id) || {};
      $('auto-entry-heading').textContent = id ? 'Edit auto franchise' : 'Add auto franchise';
      $('auto-entry-name').value = entry.name || '';
      $('auto-entry-url').value = entry.url || '';
      $('auto-entry-target').innerHTML = '<option value="">Create new franchise</option>' + list(getModel().Nodes)
        .filter((node) => !node.ParentId && node.NodeType === 'Franchise')
        .map((node) => '<option value="' + esc(node.Id) + '">' + esc(node.Name) + '</option>').join('');
      $('auto-entry-target').value = entry.franchiseNodeId || '';
      $('auto-entry-mode').value = entry.episodeFormat || 'Bundles';
      $('auto-entry-enabled').checked = entry.enabled !== false;
      $('auto-entry-error').hidden = true;
      show('auto-entry-dialog');
    }
    async function saveRegistry(next, enabled = settings().enabled === true) {
      if (!status?.fingerprint) throw Error('Load server status before saving automation settings.');
      status = camel(await post('Automation/Settings', { expectedFingerprint: status.fingerprint, enabled, registry: next }));
    }
    function restorationScope(entry) {
      const registration = registrations().find((item) => item.id === entry.registrationId);
      if (registration?.deleted) return 'entire deleted franchise';
      if (list(registration?.rows).some((mapping) => mapping.rowId === entry.rowId && mapping.deleted)) return 'entire deleted row';
      return '';
    }
    function detail(entry) {
      const row = list(getModel().Rows).find((item) => item.Id === entry.rowId);
      const restoreScope = restorationScope(entry);
      return '<dl class="automation-details"><dt>Franchise</dt><dd>' + esc(entry.franchiseName || registrations().find((item) => item.id === entry.registrationId)?.name || 'Saved franchise') +
        '</dd><dt>Type / range</dt><dd>' + esc((entry.itemType || entry.scope || 'Media') + range(entry)) +
        '</dd><dt>Affected rows</dt><dd>' + esc(row?.Name || entry.rowKind || entry.rowId || 'All applicable rows') +
        '</dd><dt>Source / order</dt><dd>' + sourceLink(entry.sourceUrl || registrations().find((item) => item.id === entry.registrationId)?.url || '') +
        (entry.sourcePosition ? ' · #' + esc(entry.sourcePosition) : '') + '</dd><dt>Reason</dt><dd>' + esc(entry.reason || 'Protected choice requires review') +
        '</dd><dt>Before</dt><dd>' + esc(entry.existing || 'No current reference') + '</dd><dt>After</dt><dd>' + esc(entry.proposed || entry.kind || 'Restore selected choice') + '</dd></dl>' +
        (restoreScope ? '<p><strong>Applying this restores the ' + restoreScope + ' for future midnight updates; only selected media is added now.</strong></p>' : '') +
        (list(entry.exclusionIds).length || entry.kind === 'Excluded'
          ? '<p class="automation-dialog-note">A saved restriction protects this item. Restore only the intended restrictions in Saved choices, then preview or run again.</p><button data-auto-open-rules>Review saved choices</button>' : '');
    }
    function renderInbox() {
      const entries = pending();
      for (const id of selected) if (!entries.some((entry) => entry.id === id && !list(entry.exclusionIds).length && entry.kind !== 'Excluded')) selected.delete(id);
      $('auto-inbox-list').innerHTML = entries.map((entry) => '<article class="automation-change"><label class="automation-select"><input type="checkbox" data-auto-change="' + esc(entry.id) +
        '" aria-label="Select ' + esc(entry.title || entry.kind) + (restorationScope(entry) ? ' and restore ' + restorationScope(entry) : '') + '"' + (selected.has(entry.id) ? ' checked' : '') +
        (list(entry.exclusionIds).length || entry.kind === 'Excluded' ? ' disabled' : '') +
        '><strong>' + esc(entry.title || entry.kind) + '</strong><span>' + esc(entry.kind) + '</span></label>' + detail(entry) +
        (list(entry.episodeIds).length ? '<details><summary>Individual episodes (' + entry.episodeIds.length + ')</summary><ul>' + entry.episodeIds.map((id) => '<li>' + esc(id) + '</li>').join('') + '</ul></details>' : '') +
        '</article>').join('') || '<p>No pending changes. Kept choices stay saved without repeating the same notification.</p>';
      $('auto-keep-choices').disabled = busy || !entries.length;
      syncBusy();
    }
    function renderRules() {
      const entries = rules();
      for (const id of selectedRules) if (!entries.some((entry) => entry.id === id)) selectedRules.delete(id);
      $('auto-choices-list').innerHTML = entries.map((entry) => '<article class="automation-change"><label class="automation-select"><input type="checkbox" data-auto-rule="' + esc(entry.id) +
        '" aria-label="Restore ' + esc(entry.reason || entry.providerId || entry.jellyfinItemId) + '"' + (selectedRules.has(entry.id) ? ' checked' : '') + '><strong>' +
        esc(entry.reason || 'Saved exclusion') + '</strong></label><p>' + esc(entry.scope + range(entry) + ' · ' + (entry.providerName || 'Jellyfin') + ': ' + (entry.providerId || entry.jellyfinItemId)) +
        '</p><p>' + esc(registrations().find((item) => item.id === entry.registrationId)?.name || list(getModel().Nodes).find((node) => node.Id === entry.franchiseNodeId)?.Name || 'Saved franchise') +
        ' · ' + esc(list(getModel().Rows).find((row) => row.Id === entry.rowId)?.Name || 'All applicable rows') + '</p></article>').join('') || '<p>No saved exclusions.</p>';
      syncBusy();
    }
    function renderPreview() {
      $('auto-preview-results').innerHTML = list(preview?.plans).map((plan) => '<section class="automation-change"><h3>' + esc(plan.franchiseName) + '</h3>' +
        '<p>' + list(plan.safeAdditions).length + ' safe additions · ' + list(plan.pending).length + ' protected changes · ' + list(plan.missing).length + ' missing' +
        (plan.sourceFailed ? ' · Source retrieval failed; existing choices will be kept.' : '') + '</p>' +
        ['TV Shows', 'Movies', 'Chronological Order'].map((name) => {
          const kind = name === 'Chronological Order' ? 'Chronological' : name === 'TV Shows' ? 'TVShows' : 'Movies';
          const entries = list(plan.safeAdditions).filter((entry) => (entry.rowKind || '').replace(/\s/g, '').startsWith(kind));
          return '<div class="automation-preview-row"><strong>' + name + '</strong>' + entries.map((entry) => '<details><summary><label class="automation-select"><input type="checkbox" data-auto-preview-change="' + esc(entry.id) +
            '" aria-label="Apply ' + esc(entry.title) + ' to ' + name + '"' + (previewSelected.has(entry.id) ? ' checked' : '') + '>' + esc(entry.title + range(entry)) + '</label></summary>' + detail(entry) + '</details>').join('') + '</div>';
        }).join('') + list(plan.pending).map((entry) => '<details><summary><label class="automation-select"><input type="checkbox" data-auto-preview-change="' + esc(entry.id) + '" aria-label="Apply protected ' + esc(entry.title) + (restorationScope(entry) ? ' and restore ' + restorationScope(entry) : '') + '"' +
          (previewSelected.has(entry.id) ? ' checked' : '') + (list(entry.exclusionIds).length || entry.kind === 'Excluded' ? ' disabled' : '') + '>' + esc(entry.title + ' · ' + entry.kind + ' · Held for review') +
          '</label></summary>' + detail(entry) + '</details>').join('') +
        list(plan.missing).map((entry) => '<p>' + esc((entry.title || 'Missing title') + ' · ' + (entry.reason || 'No library match')) + '</p>').join('') + '</section>').join('') || '<p>' + esc(preview?.message || 'No enabled registrations to preview.') + '</p>';
      syncBusy();
    }
    function recoveryCandidates(entry) {
      const candidates = list(entry.candidates), chosen = recoveryLibraryChoices.get(entry.referenceId);
      return chosen && !candidates.some((candidate) => candidate.itemId === chosen.itemId) ? [...candidates, chosen] : candidates;
    }
    function jellyfinLink(candidate) {
      if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(candidate.itemId || '')) return '';
      try {
        const address = typeof window.ApiClient?.getUrl === 'function' ? window.ApiClient.getUrl('web/index.html') :
          (typeof window.ApiClient?.serverAddress === 'function' ? window.ApiClient.serverAddress() : window.location.origin).replace(/\/$/, '') + '/web/index.html';
        const server = new URL(address, window.location.href);
        if (!/^https?:$/.test(server.protocol)) return '';
        server.username = ''; server.password = ''; server.search = ''; server.hash = '';
        server.hash = '!/details?id=' + encodeURIComponent(candidate.itemId);
        return '<a href="' + esc(server.href) + '" data-recovery-open="' + esc(candidate.itemId) +
          '" target="_blank" rel="noopener noreferrer">Open in Jellyfin</a>';
      } catch (_) { return ''; }
    }
    function candidateDetail(candidate) {
      return '<strong>' + esc(candidate.title) + '</strong>' +
        '<span>' + esc((candidate.year ? candidate.year + ' · ' : '') + candidate.itemType + ' · ' + candidate.itemId) + '</span>' +
        (list(candidate.providerIds).length ? '<span>' + esc(candidate.providerIds.map((provider) => provider.name + ': ' + provider.value).join(', ')) + '</span>' : '') +
        jellyfinLink(candidate);
    }
    function libraryState(referenceId) {
      if (!recoveryLibrary.has(referenceId)) recoveryLibrary.set(referenceId,
        { open: false, itemType: '', query: '', items: [], totalRecordCount: 0, startIndex: 0, limit: 30, loaded: false, loading: false });
      return recoveryLibrary.get(referenceId);
    }
    function renderLibrary(entry) {
      const state = recoveryLibrary.get(entry.referenceId);
      if (!state?.open) return '';
      const id = esc(entry.referenceId), total = state.totalRecordCount || 0,
        first = total ? state.startIndex + 1 : 0, last = Math.min(state.startIndex + state.items.length, total),
        types = [['', 'All media'], ['Movie', 'Movies'], ['Series', 'TV shows'], ['BoxSet', 'Collections']];
      if (entry.itemType === 'Episode') types.push(['Episode', 'Episodes']);
      return '<section class="recovery-library" aria-label="Browse library for ' + esc(entry.title) + '">' +
        '<div class="recovery-library-heading"><h4>Browse your Jellyfin library</h4><button data-recovery-library-close="' + id + '" data-automation-action>Close browser</button></div>' +
        '<p>Inspect the actual library item, then choose it. Your saved reference changes only after Reconnect selected.</p>' +
        '<div class="recovery-library-controls"><label class="field"><span>Media type</span><select data-recovery-library-type="' + id + '" data-recovery-read>' +
        types.map(([value, label]) => '<option value="' + value + '"' + (state.itemType === value ? ' selected' : '') + '>' + label + '</option>').join('') +
        '</select></label><label class="field"><span>Search library (optional)</span><input type="search" maxlength="120" data-recovery-library-query="' + id +
        '" data-recovery-read value="' + esc(state.query) + '" placeholder="Leave blank to browse all titles"></label>' +
        '<button data-recovery-library-search="' + id + '" data-recovery-read data-automation-action>Search library</button></div>' +
        '<p role="status">' + (state.loading ? 'Loading library items…' : state.loaded ? first + '–' + last + ' of ' + total + ' library items' :
          'Library items could not be loaded. Search library to try again.') + '</p>' +
        (state.loaded && !state.items.length ? '<p>No library items match this filter. Try All media or leave the search blank.</p>' : '') +
        '<ul class="recovery-library-items">' + state.items.map((candidate) => '<li><div class="recovery-candidate-detail">' + candidateDetail(candidate) +
          '</div><button data-recovery-library-choose="' + esc(candidate.itemId) + '" data-recovery-read data-automation-action aria-label="Choose ' + esc(candidate.title) + '">' +
          (recoveryChoices.get(entry.referenceId) === candidate.itemId ? 'Selected' : 'Choose replacement') + '</button></li>').join('') + '</ul>' +
        '<div class="recovery-library-pagination"><button data-recovery-library-previous="' + id + '" data-recovery-read data-automation-action data-recovery-page-disabled="' +
        (!state.loaded || state.startIndex <= 0) + '">Previous page</button><button data-recovery-library-next="' + id +
        '" data-recovery-read data-automation-action data-recovery-page-disabled="' + (!state.loaded || state.startIndex + state.limit >= total) + '">Next page</button></div></section>';
    }
    function renderRecovery() {
      const ready = automaticMatches().length,
        entries = list(recovery?.entries).filter((entry) => entry.canAutoRemap !== true &&
          (entry.status !== 'Healthy' || referenceKey(entry.referenceId) === referenceKey(recoveryFocus))),
        searchable = canSearchRecovery(),
        labels = { Verified: 'Ready to reconnect', Ambiguous: 'Choose a version', Missing: 'Media missing',
          ManualReview: 'Choose a replacement', Healthy: 'Available in the library' };
      for (const [id, selectedId] of recoveryChoices)
        if (!entries.some((entry) => entry.status !== 'Healthy' && entry.referenceId === id && recoveryCandidates(entry).some((candidate) => candidate.itemId === selectedId))) {
          recoveryChoices.delete(id); recoveryLibraryChoices.delete(id);
        }
      $('recovery-dialog-status').textContent = recoverySummary() +
        (modelDirty() ? ' Your unsaved draft is kept. Save or reload it before automatic or selected reconnection.' : '');
      $('recovery-dialog-error').textContent = recoveryError;
      $('recovery-dialog-error').hidden = !recoveryError;
      if (recoveryPreparing) {
        $('recovery-dialog-status').textContent = modelDirty() ? 'Loading the saved recovery report. Your unsaved draft is kept.' :
          'Checking saved references and automatically reconnecting clear matches…';
        $('recovery-results').innerHTML = '<p role="status">Please wait while recovery checks the saved configuration.</p>';
        syncBusy(); return;
      }
      $('recovery-results').innerHTML = entries.map((entry) => '<article class="automation-change' +
        (referenceKey(entry.referenceId) === referenceKey(recoveryFocus) ? ' recovery-focused' : '') +
        '" data-recovery-entry="' + esc(entry.referenceId) + '"><h3>' + esc(entry.title) + '</h3><p><strong>' +
        esc(labels[entry.status] || entry.status) + '</strong> · ' + esc(entry.itemType) + ' · ' + esc(entry.reason) + '</p>' +
        '<p>' + esc(list(getModel().Nodes).find((node) => node.Id === entry.nodeId)?.Name || 'Saved franchise') + ' / ' +
        esc(list(getModel().Rows).find((row) => row.Id === entry.rowId)?.Name || 'Franchise media') + '</p>' +
        (entry.status === 'Healthy' ? '<p>This saved reference resolves on the server. If it cannot be opened here, check Jellyfin access and refresh the page.</p>' :
        '<label class="field"><span>Choose the actual library item</span><select data-recovery-choice="' + esc(entry.referenceId) + '"' +
        (!searchable || busy ? ' disabled' : '') + '><option value="">Keep current reference</option>' +
        recoveryCandidates(entry).map((candidate) => '<option value="' + esc(candidate.itemId) + '"' +
          (recoveryChoices.get(entry.referenceId) === candidate.itemId ? ' selected' : '') + '>' +
          esc(candidate.title + (candidate.year ? ' (' + candidate.year + ')' : '') + ' · ' + candidate.itemType + ' · ' + candidate.itemId +
            (candidate.verified ? ' · Verified identity' : ' · Manual choice')) + '</option>').join('') +
        '</select></label>' +
        (recoveryLibraryChoices.get(entry.referenceId)?.itemType && recoveryChoices.get(entry.referenceId) === recoveryLibraryChoices.get(entry.referenceId).itemId &&
          recoveryLibraryChoices.get(entry.referenceId).itemType !== entry.itemType ? '<p class="recovery-type-correction" role="status"><strong>Saved type: ' + esc(entry.itemType) +
          '. Selected library type: ' + esc(recoveryLibraryChoices.get(entry.referenceId).itemType) + '.</strong> Reconnect selected will correct this reference’s saved type to ' +
          esc(recoveryLibraryChoices.get(entry.referenceId).itemType) + '.</p>' : '') +
        '<div class="automation-recovery-search"><label class="field"><span>Find a library candidate</span><input data-recovery-query="' +
        esc(entry.referenceId) + '" type="search" maxlength="120" value="' +
        esc(recoveryQueries.get(entry.referenceId) ?? entry.title ?? '') + '" placeholder="Title in your Jellyfin library"' +
        (!searchable ? ' disabled' : '') + '></label><button data-recovery-search="' + esc(entry.referenceId) +
        '" data-automation-action>Find candidate</button></div><p>Search uses the saved media type. If it is incorrect or no match appears, browse All media and choose the actual item.</p>' +
        '<button data-recovery-browse="' + esc(entry.referenceId) + '" data-recovery-read data-automation-action aria-expanded="' + !!recoveryLibrary.get(entry.referenceId)?.open + '">Browse library</button>' +
        (recoveryCandidates(entry).length ? '<ul class="automation-candidate">' + recoveryCandidates(entry).map((candidate) => '<li class="recovery-candidate-detail">' + candidateDetail(candidate) +
          '</li>').join('') + '</ul>' : '<p>No replacement is selected. Search or browse for the matching library item; the saved reference is kept.</p>') + renderLibrary(entry)) + '</article>').join('') ||
        (recoveryError ? '<p>The recovery report is unavailable. Refresh the report to try again.</p>' :
          !recovery ? '<p>The recovery report is loading.</p>' :
          savedReferenceCount() > 0 && !(recovery.referenceCount ?? list(recovery.entries).length)
            ? '<p>Your settings contain saved media, but this report did not check it. Save or reload your settings, then check recovery.</p>'
            : ready ? '<p>No references need an individual selection. Auto remap can reconnect ' + ready + ' clear matches now.</p>'
            : '<p>All ' + (recovery.referenceCount ?? list(recovery.entries).length) + ' checked references resolve in the current library.</p>');
      syncBusy();
    }
    async function autoReconnect({ announce = false } = {}) {
      return act(async () => {
        const result = camel(await post('Recovery/Auto', {}));
        recovery = result.status;
        recoveryReportUnavailable = false;
        lastAutoRemapped = Number(result.remappedCount) || 0;
        context.refreshMediaAvailability?.();
        if (announce) notify('Auto remap reconnected ' + lastAutoRemapped + ' references. ' +
          unresolved().filter((entry) => entry.canAutoRemap !== true).length + ' remain for review.');
        return result;
      }, { write: true, recoveryAction: true });
    }
    async function openRecovery(referenceId = '') {
      if (busy || recoveryPreparing) return;
      recoveryFocus = referenceId || '';
      recoveryPreparing = true;
      show('recovery-dialog');
      renderRecovery();
      try {
        if (!modelDirty() && automaticRecoveryEnabled() && (!recovery || canSearchRecovery())) await autoReconnect();
        else await refresh();
      } finally { recoveryPreparing = false; render(); }
    }
    $('auto-manage').onclick = () => { render(); show('auto-registry-dialog'); };
    $('auto-add-entry').onclick = () => openEntry();
    $('auto-entry-save').onclick = () => {
      const name = $('auto-entry-name').value.trim(), rawUrl = $('auto-entry-url').value.trim();
      if (!name || !/^https:\/\/(?:www\.)?imdb\.com\/list\/ls\d+\/?$/i.test(rawUrl)) {
        $('auto-entry-error').textContent = 'Enter a name and a valid https://www.imdb.com/list/ls…/ URL.';
        $('auto-entry-error').hidden = false; return;
      }
      const entry = { ...(registrations().find((item) => item.id === editingId) || {}), id: editingId,
        name, url: 'https://www.imdb.com/list/' + rawUrl.match(/ls\d+/i)[0].toLowerCase() + '/',
        franchiseNodeId: $('auto-entry-target').value, episodeFormat: $('auto-entry-mode').value, enabled: $('auto-entry-enabled').checked };
      act(async () => {
        await saveRegistry(editingId ? registrations().map((item) => item.id === editingId ? entry : item) : [...registrations(), entry]);
        $('auto-entry-dialog').close();
      }, { write: true });
    };
    $('auto-registry-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-auto-edit]'), remove = event.target.closest('[data-auto-remove]');
      if (edit) openEntry(edit.dataset.autoEdit);
      if (remove) act(() => saveRegistry(registrations().filter((entry) => entry.id !== remove.dataset.autoRemove)), { write: true });
    });
    $('auto-registry-list').addEventListener('change', (event) => {
      const target = event.target.closest('[data-auto-toggle]');
      if (target) act(() => saveRegistry(registrations().map((entry) => entry.id === target.dataset.autoToggle ? { ...entry, enabled: target.checked } : entry)), { write: true });
    });
    $('auto-enabled').onchange = () => act(() => saveRegistry(registrations(), $('auto-enabled').checked), { write: true });
    $('auto-preview').onclick = () => act(async () => {
      preview = camel(await post('Automation/Preview', {}));
      previewSelected.clear();
      for (const plan of list(preview.plans)) for (const entry of list(plan.safeAdditions)) previewSelected.add(entry.id);
      renderPreview(); show('auto-preview-dialog');
    });
    $('auto-preview-results').addEventListener('change', (event) => {
      const target = event.target.closest('[data-auto-preview-change]');
      if (target) { if (target.checked) previewSelected.add(target.dataset.autoPreviewChange); else previewSelected.delete(target.dataset.autoPreviewChange); syncBusy(); }
    });
    $('auto-preview-apply').onclick = () => act(async () => {
      status = camel(await post('Automation/Decision', { expectedFingerprint: preview.fingerprint, decision: 'Apply',
        registrationIds: list(preview.plans).map((plan) => plan.registrationId), changeIds: [...previewSelected] }));
      previewSelected.clear(); $('auto-preview-dialog').close(); notify('Selected automation changes applied.');
    }, { write: true });
    $('auto-run').onclick = () => act(async () => {
      await post('Automation/Run', {});
      status = camel(await request('FranchiseExplorer/Automation/Status'));
      notify('Server automation run finished. Review held changes below.');
    }, { write: true });
    function openInbox() { selected.clear(); show('auto-inbox-dialog'); renderInbox(); }
    $('auto-review').onclick = openInbox;
    $('automation-notice-review').onclick = openInbox;
    function openSavedChoices() {
      selectedRules.clear();
      if ($('auto-inbox-dialog').open) $('auto-inbox-dialog').close();
      if ($('auto-preview-dialog').open) $('auto-preview-dialog').close();
      show('auto-choices-dialog'); renderRules();
    }
    $('auto-manage-choices').onclick = openSavedChoices;
    for (const container of [$('auto-inbox-list'), $('auto-preview-results')]) container.addEventListener('click', (event) => {
      if (event.target.closest('[data-auto-open-rules]')) openSavedChoices();
    });
    $('auto-inbox-list').addEventListener('change', (event) => {
      const target = event.target.closest('[data-auto-change]');
      if (target) { if (target.checked) selected.add(target.dataset.autoChange); else selected.delete(target.dataset.autoChange); syncBusy(); }
    });
    $('auto-choices-list').addEventListener('change', (event) => {
      const target = event.target.closest('[data-auto-rule]');
      if (target) { if (target.checked) selectedRules.add(target.dataset.autoRule); else selectedRules.delete(target.dataset.autoRule); syncBusy(); }
    });
    async function decide(decision, changeIds, exclusionIds = []) {
      status = camel(await post('Automation/Decision', { expectedFingerprint: status?.fingerprint, decision, changeIds, exclusionIds }));
      selected.clear(); selectedRules.clear();
    }
    $('auto-keep-choices').onclick = () => act(() => decide('Keep', selected.size ? [...selected] : pending().map((entry) => entry.id)), { write: true });
    $('auto-restore-selected').onclick = () => act(() => decide('Restore', [...selected]), { write: true });
    $('auto-restore-rules').onclick = () => act(() => decide('Restore', [], [...selectedRules]), { write: true });
    for (const id of ['recovery-enabled', 'recovery-auto']) $(id).onchange = () => change(() => {
      getModel().MediaRecovery = { ...(getModel().MediaRecovery || {}), Enabled: $('recovery-enabled').checked, AutoReconnect: $('recovery-auto').checked };
    });
    $('recovery-check').onclick = () => {
      if (automaticRecoveryEnabled() || modelDirty()) return openRecovery();
      show('recovery-dialog'); renderRecovery();
      return act(async () => {
        recovery = camel(await post('Recovery/Check', {})); recoveryChoices.clear();
        context.refreshMediaAvailability?.();
      }, { write: true, recoveryAction: true });
    };
    $('recovery-auto-remap').onclick = () => autoReconnect({ announce: true });
    $('recovery-review').onclick = () => openRecovery();
    $('recovery-notice-review').onclick = () => openRecovery();
    $('recovery-refresh').onclick = () => void refresh();
    $('recovery-reload').onclick = () => act(async () => {
      await load();
    }, { recoveryAction: true });
    $('recovery-results').addEventListener('input', (event) => {
      const target = event.target.closest('[data-recovery-query]');
      if (target) recoveryQueries.set(target.dataset.recoveryQuery, target.value);
      const libraryQuery = event.target.closest('[data-recovery-library-query]');
      if (libraryQuery) libraryState(libraryQuery.dataset.recoveryLibraryQuery).query = libraryQuery.value;
    });
    $('recovery-results').addEventListener('change', (event) => {
      const target = event.target.closest('[data-recovery-choice]');
      if (target) {
        const referenceId = target.dataset.recoveryChoice;
        if (target.value) recoveryChoices.set(referenceId, target.value); else recoveryChoices.delete(referenceId);
        if (recoveryLibraryChoices.get(referenceId)?.itemId !== target.value) recoveryLibraryChoices.delete(referenceId);
        renderRecovery();
      }
      const type = event.target.closest('[data-recovery-library-type]');
      if (type) {
        libraryState(type.dataset.recoveryLibraryType).itemType = type.value;
        void loadLibrary(type.dataset.recoveryLibraryType, 0);
      }
    });
    function checkedRecoverySnapshot() {
      if (!canSearchRecovery()) throw Error('Refresh the recovery report when the library is ready, then try again.');
      return { revision: recovery.revision, libraryRevision: recovery.libraryRevision };
    }
    function verifyRecoverySnapshot(snapshot) {
      if (recovery?.revision !== snapshot.revision || recovery?.libraryRevision !== snapshot.libraryRevision)
        throw Error('The recovery report changed while loading library items. Your choices were kept. Search or browse again.');
    }
    async function loadLibrary(referenceId, startIndex = 0) {
      if (busy || recoveryPreparing) return null;
      const state = libraryState(referenceId);
      state.open = true; state.loading = true;
      renderRecovery();
      return act(async () => {
        try {
          const snapshot = checkedRecoverySnapshot(), query = state.query.trim(), itemType = state.itemType;
          if (startIndex && (query !== state.appliedQuery || itemType !== state.appliedItemType)) startIndex = 0;
          const result = camel(await request('FranchiseExplorer/Recovery/Library?' + new URLSearchParams({
            referenceId, ...snapshot, query, itemType, startIndex: String(startIndex), limit: '30',
          })));
          verifyRecoverySnapshot(snapshot);
          Object.assign(state, { items: list(result.items), totalRecordCount: Number(result.totalRecordCount) || 0,
            startIndex: Number(result.startIndex) || 0, limit: Number(result.limit) || 30,
            appliedQuery: query, appliedItemType: itemType, loaded: true });
        } finally { state.loading = false; }
      }, { recoveryAction: true });
    }
    $('recovery-results').addEventListener('click', (event) => {
      const browse = event.target.closest('[data-recovery-browse]'), close = event.target.closest('[data-recovery-library-close]'),
        librarySearch = event.target.closest('[data-recovery-library-search]'), previous = event.target.closest('[data-recovery-library-previous]'),
        next = event.target.closest('[data-recovery-library-next]'), choose = event.target.closest('[data-recovery-library-choose]');
      if (browse) { void loadLibrary(browse.dataset.recoveryBrowse); return; }
      if (close) { libraryState(close.dataset.recoveryLibraryClose).open = false; renderRecovery(); return; }
      if (librarySearch) { void loadLibrary(librarySearch.dataset.recoveryLibrarySearch); return; }
      if (previous || next) {
        const referenceId = previous?.dataset.recoveryLibraryPrevious || next.dataset.recoveryLibraryNext, state = libraryState(referenceId);
        void loadLibrary(referenceId, Math.max(0, state.startIndex + (previous ? -state.limit : state.limit))); return;
      }
      if (choose) {
        const referenceId = choose.closest('[data-recovery-entry]').dataset.recoveryEntry,
          candidate = libraryState(referenceId).items.find((item) => item.itemId === choose.dataset.recoveryLibraryChoose);
        if (candidate && !busy && canSearchRecovery()) {
          recoveryLibraryChoices.set(referenceId, candidate); recoveryChoices.set(referenceId, candidate.itemId); renderRecovery();
        }
        return;
      }
      const button = event.target.closest('[data-recovery-search]');
      if (!button) return;
      const referenceId = button.dataset.recoverySearch;
      const query = [...$('recovery-results').querySelectorAll('[data-recovery-query]')].find((input) => input.dataset.recoveryQuery === referenceId)?.value.trim();
      if (!query) { problem('Enter a title to find a library candidate.'); return; }
      recoveryQueries.set(referenceId, query);
      void (async () => {
        if (!modelDirty() && automaticRecoveryEnabled()) {
          const result = await autoReconnect();
          if (!result || !unresolved().some((entry) => entry.referenceId === referenceId)) return;
        }
        await act(async () => {
          const snapshot = checkedRecoverySnapshot(), candidates = camel(await request('FranchiseExplorer/Recovery/Candidates?' +
            new URLSearchParams({ referenceId, query, ...snapshot })));
          verifyRecoverySnapshot(snapshot);
          const entry = recovery.entries.find((item) => item.referenceId === referenceId);
          if (entry) {
            const chosen = recoveryCandidates(entry).find((candidate) => candidate.itemId === recoveryChoices.get(referenceId));
            entry.candidates = candidates;
            if (chosen && !candidates.some((candidate) => candidate.itemId === chosen.itemId)) recoveryLibraryChoices.set(referenceId, chosen);
          }
        }, { recoveryAction: true });
      })();
    });
    $('recovery-results').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const libraryQuery = event.target.closest('[data-recovery-library-query]'), query = event.target.closest('[data-recovery-query]');
      if (!libraryQuery && !query) return;
      event.preventDefault();
      if (libraryQuery) void loadLibrary(libraryQuery.dataset.recoveryLibraryQuery);
      else [...$('recovery-results').querySelectorAll('[data-recovery-search]')].find((button) => button.dataset.recoverySearch === query.dataset.recoveryQuery)?.click();
    });
    $('recovery-apply').onclick = () => act(async () => {
      recovery = camel(await post('Recovery/Apply', { revision: recovery.revision, libraryRevision: recovery.libraryRevision,
        choices: [...recoveryChoices].map(([referenceId, itemId]) => {
          const choice = { referenceId, itemId }, candidate = recoveryLibraryChoices.get(referenceId),
            entry = recovery.entries.find((item) => item.referenceId === referenceId);
          if (candidate?.itemId === itemId && candidate.itemType !== entry?.itemType) choice.correctItemType = true;
          return choice;
        }) }));
      recoveryChoices.clear(); recoveryLibraryChoices.clear(); context.refreshMediaAvailability?.(); notify('Selected media references reconnected.');
    }, { write: true, recoveryAction: true });
    // These hooks run inside the main controller's local configuration transaction.
    // They never POST independently and therefore participate in Save, Undo and backup export.
    function recordManualChoice(choice) {
      const model = getModel(), config = model.AutoFranchises ||= { Enabled: false, Registry: [], Exclusions: [], PendingChanges: [], Ownership: [] };
      config.Registry ||= []; config.Exclusions ||= [];
      const nodeId = choice.FranchiseNodeId || choice.franchiseNodeId || choice.nodeId || '';
      const ancestry = new Set([nodeId]);
      let ancestor = list(model.Nodes).find((node) => node.Id === nodeId);
      while (ancestor?.ParentId && !ancestry.has(ancestor.ParentId)) {
        ancestry.add(ancestor.ParentId);
        ancestor = list(model.Nodes).find((node) => node.Id === ancestor.ParentId);
      }
      const registration = config.Registry.find((entry) => entry.Id === (choice.RegistrationId || choice.registrationId) ||
        (entry.FranchiseNodeId && ancestry.has(entry.FranchiseNodeId)));
      const kind = choice.kind || choice.Kind;
      if (kind === 'deleteFranchise') { if (registration?.FranchiseNodeId === nodeId) registration.Deleted = true; return; }
      if (kind === 'deleteRow') {
        const rowId = choice.RowId || choice.rowId;
        const mapping = registration?.Rows?.find((entry) => entry.RowId === rowId);
        if (mapping) mapping.Deleted = true;
        return;
      }
      const rule = { Id: context.core.guid(), RegistrationId: registration?.Id || choice.RegistrationId || '', FranchiseNodeId: registration?.FranchiseNodeId || nodeId,
        RowId: choice.RowId || choice.rowId || '', Scope: choice.Scope || choice.scope || 'Movie', ProviderName: choice.ProviderName || 'Imdb',
        ProviderId: choice.ProviderId || choice.providerId || '', JellyfinItemId: choice.JellyfinItemId || choice.itemId || '',
        StartSeason: choice.StartSeason || 0, EndSeason: choice.EndSeason || 0, StartEpisode: choice.StartEpisode || 0, EndEpisode: choice.EndEpisode || 0,
        Enabled: true, Reason: choice.Reason || 'Excluded by you', CreatedUtc: new Date().toISOString() };
      if (!rule.ProviderId && !rule.JellyfinItemId) return;
      if (rule.Scope === 'Range' || rule.Scope === 'RestrictedRange') rule.Scope = 'AllowedRange';
      if (rule.Scope === 'AllowedRange') {
        const previous = config.Exclusions.find((entry) => entry.Enabled !== false && entry.Scope === 'AllowedRange' &&
          entry.RegistrationId === rule.RegistrationId && entry.FranchiseNodeId === rule.FranchiseNodeId && entry.RowId === rule.RowId &&
          ((entry.ProviderId && rule.ProviderId && entry.ProviderName === rule.ProviderName && entry.ProviderId === rule.ProviderId) ||
            (entry.JellyfinItemId && entry.JellyfinItemId === rule.JellyfinItemId)));
        if (previous) { Object.assign(previous, rule, { Id: previous.Id, CreatedUtc: previous.CreatedUtc }); return; }
      }
      const signature = (entry) => JSON.stringify([entry.RegistrationId, entry.FranchiseNodeId, entry.RowId, entry.Scope, entry.ProviderName, entry.ProviderId,
        entry.JellyfinItemId, entry.StartSeason, entry.EndSeason, entry.StartEpisode, entry.EndEpisode]);
      if (!config.Exclusions.some((entry) => entry.Enabled !== false && signature(entry) === signature(rule))) config.Exclusions.push(rule);
    }
    render();
    return { afterLoad: refresh, render, isBusy: () => busy, openRecovery,
      referenceStatus: (id) => list(recovery?.entries).find((entry) => referenceKey(entry.referenceId) === referenceKey(id))?.status || null,
      getProtectedSettings: () => ({ AutoFranchises: clone(getModel().AutoFranchises || {}), MediaRecovery: clone(getModel().MediaRecovery || {}) }),
      recordManualChoice, excludeUncheckedReview: (choices) => choices.forEach(recordManualChoice) };
  }
  window.FranchiseSettingsAutomation = { init };
})();
