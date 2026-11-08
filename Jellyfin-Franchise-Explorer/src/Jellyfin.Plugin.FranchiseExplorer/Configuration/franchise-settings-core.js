// Production settings model and reviewed IMDb engine. No browser or server data is synthesized.
(function (global) {
  'use strict';
  const validGuid = (value) =>
    /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(value || ''),
    );
  const guid = () =>
    global.crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const n = Math.floor(Math.random() * 16);
      return (character === 'x' ? n : (n & 3) | 8).toString(16);
    });
  const emptyArt = () => ({
    PrimaryUrl: '',
    BackdropUrl: '',
    BackdropVideoItemId: '',
    LogoUrl: '',
    ThumbUrl: '',
    BannerUrl: '',
  });
  // AUTOADD_ENGINE_BEGIN — pure functions shared by the editor and offline regression tests.
  const autoAdd = (() => {
    const categories = ['Chronological Timeline', 'Movies', 'TV Shows', 'Collections', 'Other'];
    const url = (value) => {
      const u = new URL(String(value).trim());
      if (
        u.protocol !== 'https:' ||
        !['imdb.com', 'www.imdb.com'].includes(u.hostname) ||
        u.port ||
        u.username ||
        u.password ||
        !/^\/list\/ls\d+\/?$/.test(u.pathname) ||
        u.search ||
        u.hash
      )
        throw new Error('Use an HTTPS IMDb list URL without query or fragment.');
      return 'https://www.imdb.com' + u.pathname.replace(/\/?$/, '/');
    };
    function sources(raw) {
      if (raw == null) return [];
      if (!Array.isArray(raw) || raw.length > 30)
        throw new Error('Maximum 30 IMDb sources per franchise.');
      const seen = new Set(),
        ids = new Set();
      return raw.map((s) => {
        const canonical = url(s.Url);
        if (seen.has(canonical))
          throw new Error('Duplicate IMDb source URL. Assign several categories to one source.');
        seen.add(canonical);
        if (
          !/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(s.Id) ||
          ids.has(s.Id.toLowerCase())
        )
          throw new Error('Invalid or duplicate source ID.');
        ids.add(s.Id.toLowerCase());
        const cats = categories.filter((c) => (s.Categories || []).includes(c));
        if (!cats.length) throw new Error('Assign at least one category to each source.');
        return {
          Id: s.Id,
          Url: canonical,
          Enabled: s.Enabled !== false,
          Priority: Math.max(0, Math.min(100000, Math.trunc(Number(s.Priority) || 0))),
          Categories: cats,
        };
      });
    }
    const itemId = (value) =>
      String(value || '')
        .replace(/-/g, '')
        .toLowerCase();
    const key = (s) =>
      String(s || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    function match(entry, library) {
      const compatible = library.filter(
        (i) =>
          ['Movie', 'Series', 'Episode', 'BoxSet'].includes(i.Type) &&
          (entry.type === 'Other' || i.Type === entry.type),
      );
      const exact = compatible.filter(
        (i) =>
          String(i.ProviderIds?.Imdb || i.ProviderIds?.imdb || '').toLowerCase() ===
          entry.imdbId.toLowerCase(),
      );
      // Conflicting known provider IDs must never fall back to title matching.
      const candidates = exact.length
        ? exact
        : compatible.filter(
            (i) =>
              !['Other', 'Episode'].includes(entry.type) &&
              !i.ProviderIds?.Imdb &&
              !i.ProviderIds?.imdb &&
              entry.year &&
              i.ProductionYear === entry.year &&
              key(i.Name) === key(entry.title),
          );
      return {
        status: candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'unmatched',
        item: candidates.length === 1 ? candidates[0] : null,
        candidates,
        method: exact.length ? 'IMDb ID' : 'title/year',
      };
    }
    function preview(sourceResults, library) {
      const seen = new Set(),
        out = [];
      const shows = new Map(
        library.filter((i) => i.Type === 'Series').map((i) => [itemId(i.Id), i]),
      );
      // Priority first, configured order breaks ties. Earlier source owns duplicate titles.
      sourceResults
        .slice()
        .sort((a, b) => a.source.Priority - b.source.Priority || a.index - b.index)
        .forEach((result) => {
          if (!result.source.Enabled || result.error) return;
          for (const entry of result.entries) {
            if (!/^tt\d+$/.test(entry.imdbId) || seen.has(entry.imdbId)) continue;
            seen.add(entry.imdbId);
            const matching = match(entry, library);
            out.push({
              ...entry,
              ...matching,
              series:
                matching.item?.Type === 'Episode'
                  ? shows.get(itemId(matching.item.SeriesId))
                  : null,
              sourceId: result.source.Id,
              categories: result.source.Categories.slice(),
              orderVerified: result.orderVerified === true,
            });
          }
        });
      return out;
    }
    function episodeInfo(entry) {
      const item = entry.item,
        show = entry.series;
      if (item?.Type !== 'Episode') return null;
      const season = item.ParentIndexNumber,
        first = item.IndexNumber,
        last = item.IndexNumberEnd ?? first;
      if (
        !show ||
        !show.Id ||
        !Number.isInteger(season) ||
        season < 0 ||
        !Number.isInteger(first) ||
        first < 1 ||
        !Number.isInteger(last) ||
        last < first
      )
        return null;
      return { show, season, first, last };
    }
    const covers = (link, info) => {
      if (itemId(link.JellyfinItemId) !== itemId(info.show.Id)) return false;
      if (!link.RangeMode || link.RangeMode === 'Full') return true;
      if (link.RangeMode === 'Seasons')
        return info.season >= link.StartSeason && info.season <= link.EndSeason;
      return link.RangeMode === 'Episodes' &&
        (info.season > link.StartSeason || (info.season === link.StartSeason && info.first >= link.StartEpisode)) &&
        (info.season < link.EndSeason || (info.season === link.EndSeason && info.last <= link.EndEpisode));
    };
    const referenceKey = (ref) => itemId(ref.JellyfinItemId) + ':' +
      [ref.StartSeason, ref.StartEpisode, ref.EndSeason, ref.EndEpisode].join(':');
    function timelineRow(model, nodeId) {
      const node = model.Nodes.find((n) => n.Id === nodeId),
        mapping = node?.AutoAddRows?.find((m) => m.Category === 'Chronological Timeline');
      return model.Rows.find((row) => row.ParentNodeId === nodeId &&
        (mapping ? row.Id === mapping.RowId : row.RowType === 'Timeline'));
    }
    function effectiveFormat(model, nodeId) {
      return timelineRow(model, nodeId)?.EpisodeFormat ||
        model.Nodes.find((n) => n.Id === nodeId)?.EpisodeFormat || 'Bundles';
    }
    const episodeLabel = (season, number) =>
      'S' + String(season).padStart(2, '0') + 'E' + String(number).padStart(2, '0');
    function plan(entries, blocked = () => false, episodeFormat = 'Bundles') {
      const groups = [],
        shows = new Map(),
        skipped = [];
      let pending = null;
      const flush = () => {
        if (pending) groups.push(pending);
        pending = null;
      };
      for (const entry of entries) {
        if (entry.status !== 'matched' || !entry.item) {
          flush();
          continue;
        }
        const item = entry.item,
          info = episodeInfo(entry);
        if (item.Type === 'Episode' && !info) {
          flush();
          skipped.push(entry);
          continue;
        }
        const show = info?.show || (item.Type === 'Series' ? item : null);
        if (show && entry.categories.includes('TV Shows')) shows.set(itemId(show.Id), show);
        if (blocked(entry)) {
          flush();
          continue;
        }
        if (!info) {
          flush();
          groups.push({ entry, label: entry.title, categories: entry.categories, episodes: null });
          continue;
        }
        const same =
          episodeFormat !== 'Individual' &&
          pending &&
          entry.orderVerified &&
          pending.entry.orderVerified &&
          entry.sourceId === pending.entry.sourceId &&
          itemId(info.show.Id) === itemId(pending.show.Id) &&
          info.season === pending.season &&
          info.first === pending.last + 1 &&
          entry.position === pending.lastPosition + 1 &&
          JSON.stringify(entry.categories) === JSON.stringify(pending.categories);
        if (same) {
          pending.last = info.last;
          pending.lastPosition = entry.position;
          pending.episodes.push(entry);
        } else {
          flush();
          pending = {
            entry,
            show: info.show,
            season: info.season,
            first: info.first,
            last: info.last,
            lastPosition: entry.position,
            categories: entry.categories,
            episodes: [entry],
          };
        }
      }
      flush();
      for (const group of groups)
        if (group.episodes)
          group.label =
            group.show.Name +
            ' · ' +
            episodeLabel(group.season, group.first) +
            (group.first !== group.last ? '–' + episodeLabel(group.season, group.last) : '');
      return { groups, shows: [...shows.values()], skipped };
    }
    const stable = (value) =>
      JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, v[k]]),
            )
          : v,
      );
    function signature(model, record) {
      const row = record.RowId ? model.Rows.find((r) => r.Id === record.RowId) : null;
      const ref = row
        ? (row.Items || []).find((i) => i.Id === record.ReferenceId)
        : model.MediaLinks.find((l) => l.Id === record.ReferenceId);
      if (!ref) return '';
      return stable({
        ref,
        memberships: model.Rows.filter(
          (r) => r.Id === record.RowId || (r.MediaLinkIds || []).includes(record.ReferenceId),
        ).map((r) => ({
          Id: r.Id,
          Name: r.Name,
          ParentNodeId: r.ParentNodeId,
          RowType: r.RowType,
          Index: (r.MediaOrder || []).indexOf(record.ReferenceId),
        })),
      });
    }
    function removeReferences(model, records) {
      const next = JSON.parse(JSON.stringify(model)),
        links = new Set(records.filter((r) => !r.RowId && !r.DetachOnly).map((r) => r.ReferenceId)),
        items = new Set(records.filter((r) => r.RowId).map((r) => r.ReferenceId));
      next.MediaLinks = next.MediaLinks.filter((l) => !links.has(l.Id));
      for (const row of next.Rows) {
        const detached = new Set(records.filter((record) => record.DetachOnly &&
          record.rowIds?.includes(row.Id)).map((record) => record.ReferenceId));
        row.MediaLinkIds = (row.MediaLinkIds || []).filter((id) => !links.has(id) && !detached.has(id));
        row.Items = (row.Items || []).filter((i) => !items.has(i.Id));
        row.MediaOrder = (row.MediaOrder || []).filter((id) => !links.has(id) && !items.has(id) && !detached.has(id));
      }
      for (const node of next.Nodes)
        node.AutoAddRecords = (node.AutoAddRecords || [])
          .filter(
            (r) => !records.some((x) => !x.DetachOnly && x.ReferenceId === r.ReferenceId && x.RowId === r.RowId),
          )
          .map((r) =>
            r.Signature && signature(model, r) === r.Signature
              ? { ...r, Signature: signature(next, r) }
              : r,
          );
      return next;
    }
    function changes(model, nodeId, entries, sourceResults) {
      const node = model.Nodes.find((n) => n.Id === nodeId),
        success = new Set(
          sourceResults.filter((r) => !r.error && r.source.Enabled).map((r) => r.source.Id),
        ),
        present = new Set(entries.map((e) => e.imdbId));
      const removals = [],
        protectedRefs = [];
      const chronological = timelineRow(model, nodeId),
        rowRefs = chronological ? [...(chronological.Items || []),
          ...(chronological.MediaLinkIds || []).map((id) => model.MediaLinks.find((link) => link.Id === id)).filter(Boolean)] : [],
        matched = new Map(entries.filter((entry) => entry.status === 'matched' && entry.orderVerified)
          .map((entry) => [entry.imdbId, entry])),
        eligible = (node.AutoAddRecords || []).filter((record) =>
          rowRefs.some((ref) => ref.Id === record.ReferenceId && ref.RangeMode === 'Episodes') &&
          record.SourceIds.length && record.SourceIds.every((id) => success.has(id)) &&
          record.ImdbIds.length && record.ImdbIds.every((id) => matched.has(id))),
        editable = new Set(eligible.filter((record) => record.Signature && signature(model, record) === record.Signature)
          .map((record) => record.ReferenceId));
      const desired = plan(entries.map((entry) => entry.categories.includes('Chronological Timeline')
        ? { ...entry, categories: ['Chronological Timeline'] } : { ...entry, status: 'excluded' }),
      (entry) => rowRefs.some((ref) => !editable.has(ref.Id) &&
        (itemId(ref.JellyfinItemId) === itemId(entry.item.Id) ||
          (episodeInfo(entry) && covers(ref, episodeInfo(entry))))), effectiveFormat(model, nodeId));
      const desiredKeys = new Set(desired.groups.filter((group) => group.episodes).map((group) =>
        referenceKey({ JellyfinItemId: group.show.Id, StartSeason: group.season, StartEpisode: group.first,
          EndSeason: group.season, EndEpisode: group.last })));
      for (const record of node.AutoAddRecords || []) {
        if (
          !record.SourceIds.length ||
          !record.ImdbIds.length ||
          !record.SourceIds.every((id) => success.has(id))
        )
          continue;
        const absent = record.RowId
          ? record.ImdbIds.every((id) => !present.has(id))
          : record.ImdbIds.some((id) => !present.has(id));
        const ref = record.RowId
          ? model.Rows.find((r) => r.Id === record.RowId)?.Items.find((i) => i.Id === record.ReferenceId)
          : model.MediaLinks.find((l) => l.Id === record.ReferenceId),
          reformat = !!ref && eligible.includes(record) && !desiredKeys.has(referenceKey(ref));
        if (!absent && !reformat) continue;
        if (!record.Signature || signature(model, record) !== record.Signature) {
          protectedRefs.push(record);
          continue;
        }
        if (ref)
          removals.push({
            ...record,
            key: 'remove:' + record.ReferenceId,
            label:
              ref.DisplayName +
              (ref.RangeMode === 'Episodes'
                ? ' · ' +
                  episodeLabel(ref.StartSeason, ref.StartEpisode) +
                  '–' +
                  episodeLabel(ref.EndSeason, ref.EndEpisode)
                : ''),
            DetachOnly: !record.RowId && (!!record.__scopeExternalRows?.length ||
              (reformat && model.Rows.some((row) => row.Id !== chronological?.Id &&
                row.MediaLinkIds?.includes(record.ReferenceId)))),
            rowIds: model.Rows.filter(
              (r) => r.Id === record.RowId || (r.MediaLinkIds || []).includes(record.ReferenceId),
            ).filter((row) => !reformat || row.Id === chronological?.Id).map((r) => r.Id),
            reason: reformat ? 'Change chronological episode format' : 'No longer in the enabled IMDb source',
          });
      }
      let previewSequence = 0;
      const base = removeReferences(model, removals),
        candidate = apply(base, nodeId, entries, () => 'preview-' + ++previewSequence),
        addedRefs = candidate.model.MediaLinks.filter(
          (l) => !base.MediaLinks.some((old) => old.Id === l.Id),
        );
      const additions = [];
      for (const entry of entries) {
        if (entry.status !== 'matched' || !entry.item) continue;
        const info = episodeInfo(entry);
        const covered = addedRefs.filter((l) =>
          info
            ? itemId(l.JellyfinItemId) === itemId(info.show.Id) &&
              l.RangeMode === 'Episodes' &&
              l.StartSeason === info.season &&
              l.StartEpisode <= info.first &&
              l.EndEpisode >= info.last
            : itemId(l.JellyfinItemId) === itemId(entry.item.Id) &&
              (l.RangeMode || 'Full') === 'Full',
        );
        if (covered.length) {
          const requiresRemovals = removals
            .filter((record) => {
              const ref = record.RowId
                ? null
                : model.MediaLinks.find((l) => l.Id === record.ReferenceId);
              if (!ref) return false;
              if (itemId(ref.JellyfinItemId) === itemId(entry.item.Id)) return true;
              return (
                info &&
                itemId(ref.JellyfinItemId) === itemId(info.show.Id) &&
                (ref.RangeMode === 'Full' ||
                  (ref.RangeMode === 'Episodes' &&
                    ref.StartSeason === info.season &&
                    ref.StartEpisode <= info.first &&
                    ref.EndEpisode >= info.last))
              );
            })
            .map((r) => r.key);
          additions.push({
            key: 'add:' + entry.imdbId,
            kind: 'title',
            entryIds: [entry.imdbId],
            label: entry.title,
            entry,
            requiresRemovals,
            rowIds: candidate.model.Rows.filter((r) =>
              (r.MediaLinkIds || []).some((key) => covered.some((l) => l.Id === key)),
            ).map((r) => r.Id),
          });
        }
      }
      const oldItemIds = new Set(base.Rows.flatMap((r) => (r.Items || []).map((i) => i.Id)));
      const mapping = candidate.model.Nodes.find((n) => n.Id === nodeId).AutoAddRows?.find(
        (m) => m.Category === 'TV Shows',
      );
      const tv = candidate.model.Rows.find((r) => r.Id === mapping?.RowId);
      for (const card of (tv?.Items || []).filter((i) => !oldItemIds.has(i.Id)))
        additions.push({
          key: 'show:' + itemId(card.JellyfinItemId),
          kind: 'show',
          label: card.DisplayName + ' · TV show with all episodes',
          rowIds: [tv.Id],
          entryIds: entries
            .filter(
              (e) =>
                e.status === 'matched' &&
                itemId(e.series?.Id || e.item?.Id) === itemId(card.JellyfinItemId),
            )
            .map((e) => e.imdbId),
        });
      const skipped = new Set(plan(entries).skipped.map((e) => e.imdbId));
      const missing = entries.filter((e) => e.status !== 'matched' || skipped.has(e.imdbId));
      return { additions, removals, missing, protectedRefs };
    }
    function applyChanges(model, nodeId, entries, diff, selected, id) {
      const removals = diff.removals.filter((r) => selected.has(r.key)),
        base = removeReferences(model, removals),
        titles = new Set(),
        shows = new Set();
      for (const add of diff.additions.filter((a) => selected.has(a.key) &&
          (a.requiresRemovals || []).every((key) => selected.has(key))))
        for (const imdb of add.entryIds) (add.kind === 'show' ? shows : titles).add(imdb);
      const picked = entries.map((e) =>
        !titles.has(e.imdbId) && !shows.has(e.imdbId)
          ? { ...e, status: 'excluded' }
          : {
              ...e,
              categories: e.categories.filter((c) =>
                c === 'TV Shows' ? shows.has(e.imdbId) : titles.has(e.imdbId),
              ),
            },
      );
      const result = apply(base, nodeId, picked, id),
        next = result.model;
      const oldRecords = model.Nodes.find((n) => n.Id === nodeId).AutoAddRecords || [],
        records = next.Nodes.find((n) => n.Id === nodeId).AutoAddRecords || [];
      const editable = new Set(
        records
          .filter(
            (r) =>
              !oldRecords.some((old) => old.ReferenceId === r.ReferenceId) ||
              oldRecords.some(
                (old) =>
                  old.ReferenceId === r.ReferenceId && old.Signature === signature(model, old),
              ),
          )
          .map((r) => r.ReferenceId),
      );
      const ranks = new Map(
        records
          .filter((r) => editable.has(r.ReferenceId))
          .map((r) => [
            r.ReferenceId,
            Math.min(
              ...r.ImdbIds.map((imdb) => entries.findIndex((e) => e.imdbId === imdb)).filter(
                (i) => i >= 0,
              ),
            ),
          ]),
      );
      function place(oldOrder, current, newIds) {
        const sequence = current.filter((key) => !newIds.has(key));
        for (const key of [...newIds].sort(
          (a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity),
        )) {
          const rank = ranks.get(key) ?? Infinity;
          let index = sequence.findIndex((other) => ranks.has(other) && ranks.get(other) > rank);
          if (index < 0) {
            const lower = sequence
              .map((other, i) => (ranks.has(other) && ranks.get(other) <= rank ? i : -1))
              .filter((i) => i >= 0);
            if (lower.length) index = lower[lower.length - 1] + 1;
          }
          if (index < 0) {
            const removedIndex = oldOrder.findIndex((old) =>
              removals.some((r) => r.ReferenceId === old),
            );
            if (removedIndex >= 0) {
              const prior = oldOrder
                .slice(0, removedIndex)
                .reverse()
                .find((old) => sequence.includes(old));
              index = prior ? sequence.indexOf(prior) + 1 : 0;
            } else index = sequence.length;
          }
          sequence.splice(index, 0, key);
        }
        return sequence;
      }
      const newLinkIds = new Set(
        next.MediaLinks.filter((l) => !base.MediaLinks.some((old) => old.Id === l.Id)).map(
          (l) => l.Id,
        ),
      );
      if (newLinkIds.size) {
        const oldOrder = model.MediaLinks.filter((l) => l.NodeId === nodeId)
            .sort((a, b) => a.Position - b.Position)
            .map((l) => l.Id),
          current = next.MediaLinks.filter((l) => l.NodeId === nodeId)
            .sort((a, b) => a.Position - b.Position)
            .map((l) => l.Id);
        place(oldOrder, current, newLinkIds).forEach((key, index) => {
          if (editable.has(key) && !records.some((record) => record.ReferenceId === key && record.__scopeExternalRows?.length))
            next.MediaLinks.find((l) => l.Id === key).Position = index + 1;
        });
      }
      for (const row of next.Rows) {
        const old = model.Rows.find((r) => r.Id === row.Id),
          before = base.Rows.find((r) => r.Id === row.Id);
        const added = new Set(
          (row.MediaOrder || []).filter((key) => !(before?.MediaOrder || []).includes(key)),
        );
        if (added.size) row.MediaOrder = place(old?.MediaOrder || [], row.MediaOrder, added);
      }
      for (const record of records)
        if (editable.has(record.ReferenceId)) record.Signature = signature(next, record);
      return { ...result, removed: removals.length };
    }
    function apply(model, nodeId, entries, id) {
      // Existing references and their IDs remain intact; playback keys/history are never migrated.
      const next = JSON.parse(JSON.stringify(model));
      const node = next.Nodes.find((n) => n.Id === nodeId);
      if (!node) throw new Error('Select an existing franchise.');
      const descendant = new Set([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of next.Nodes)
          if (descendant.has(n.ParentId) && !descendant.has(n.Id)) {
            descendant.add(n.Id);
            changed = true;
          }
      }
      const rowMap = new Map();
      const configured = Array.isArray(node.AutoAddRows) && node.AutoAddRows.length > 0;
      if (!configured) node.AutoAddRows = [];
      categories.forEach((name, index) => {
        const mapping = node.AutoAddRows.find((m) => m.Category === name);
        let row = next.Rows.find(
          (r) =>
            r.ParentNodeId === nodeId && (configured ? r.Id === mapping?.RowId : r.Name === name),
        );
        if (configured && !row) return;
        if (!row) {
          row = {
            Id: id(),
            ParentNodeId: nodeId,
            Name: name,
            RowType: index === 0 ? 'Timeline' : 'Media',
            SortOrder:
              Math.max(
                -1,
                ...next.Rows.filter((r) => r.ParentNodeId === nodeId).map((r) => r.SortOrder),
              ) + 1,
            NodeIds: [],
            MediaLinkIds: [],
            Items: [],
            MediaOrder: [],
          };
          next.Rows.push(row);
        }
        if (!configured) node.AutoAddRows.push({ Category: name, RowId: row.Id });
        rowMap.set(name, row);
      });
      const assigned = new Set(next.Rows.flatMap((row) => row.MediaLinkIds || [])),
        external = new Set((node.AutoAddRecords || []).filter((record) => record.__scopeExternalRows?.length)
          .map((record) => record.ReferenceId)),
        unassigned = next.MediaLinks.filter((link) => descendant.has(link.NodeId) && !assigned.has(link.Id) && !external.has(link.Id)),
        layout = { ...plan(entries), groups: [] };
      // Block only references belonging to this destination. A bundled Custom
      // row must not prevent an independent chronological row from using singles.
      for (const [category, row] of rowMap) {
        if (category === 'TV Shows') continue;
        const existing = [...unassigned, ...(row.Items || []),
          ...(row.MediaLinkIds || []).map((id) => next.MediaLinks.find((link) => link.Id === id)).filter(Boolean)];
        const blocked = (entry) => existing.some((ref) =>
          itemId(ref.JellyfinItemId) === itemId(entry.item.Id) ||
          (episodeInfo(entry) && covers(ref, episodeInfo(entry))));
        const filtered = entries.map((entry) => entry.categories.includes(category)
          ? { ...entry, categories: [category] } : { ...entry, status: 'excluded' });
        layout.groups.push(...plan(filtered, blocked,
          category === 'Chronological Timeline' ? effectiveFormat(next, nodeId) : 'Bundles').groups);
      }
      node.AutoAddRecords ??= [];
      const freshRecords = [];
      let added = 0,
        showCards = 0;
      const tvRow = rowMap.get('TV Shows');
      if (tvRow && ['Media', 'Mixed'].includes(tvRow.RowType)) {
        const members = [
          ...(tvRow.Items || []),
          ...(tvRow.MediaLinkIds || [])
            .map((key) => next.MediaLinks.find((l) => l.Id === key))
            .filter(Boolean),
        ];
        for (const show of layout.shows) {
          if (members.some((l) => itemId(l.JellyfinItemId) === itemId(show.Id))) continue;
          const card = {
            Id: id(),
            JellyfinItemId: show.Id,
            DisplayName: show.Name,
            ItemType: 'Series',
            RangeMode: 'Full',
            StartSeason: 0,
            EndSeason: 0,
            StartEpisode: 0,
            EndEpisode: 0,
          };
          tvRow.Items ??= [];
          tvRow.MediaOrder ??= [];
          tvRow.Items.push(card);
          tvRow.MediaOrder.push(card.Id);
          members.push(card);
          showCards++;
          const owners = entries.filter(
            (e) =>
              e.status === 'matched' &&
              e.categories.includes('TV Shows') &&
              itemId(e.series?.Id || e.item?.Id) === itemId(show.Id),
          );
          freshRecords.push({
            ReferenceId: card.Id,
            RowId: tvRow.Id,
            SourceIds: [...new Set(owners.map((e) => e.sourceId))],
            ImdbIds: [...new Set(owners.map((e) => e.imdbId))],
          });
        }
      }
      const used = new Map();
      for (const group of layout.groups) {
        const entry = group.entry,
          item = entry.item;
        if (!['Movie', 'Series', 'Episode', 'BoxSet'].includes(item.Type)) continue;
        const eligible = group.categories.filter((category) => {
          const row = rowMap.get(category);
          if (!row || !['Media', 'Timeline', 'Mixed'].includes(row.RowType)) return false;
          // Direct row entries and node-owned links are two storage forms of
          // the same presentation reference. Keep a manual entry instead of
          // adding the imported title beside it; other destinations can add it.
          if (
            (row.Items || []).some((ref) =>
              group.episodes
                ? covers(ref, {
                    show: group.show,
                    season: group.season,
                    first: group.first,
                    last: group.last,
                  })
                : itemId(ref.JellyfinItemId) === itemId(item.Id),
            )
          )
            return false;
          if (category === 'TV Shows') return false; // Full-show browsing cards are independent of chronological ranges.
          if (category === 'Chronological Timeline')
            return entry.orderVerified && ['Movie', 'Episode'].includes(item.Type);
          if (category === 'Movies') return item.Type === 'Movie';
          if (category === 'Collections') return item.Type === 'BoxSet';
          return true;
        });
        if (!eligible.length) continue;
        const identity = group.episodes
          ? 'range:' +
            itemId(group.show.Id) +
            ':' +
            group.season +
            ':' +
            group.first +
            ':' +
            group.last
          : itemId(item.Id);
        if (used.has(identity)) {
          const existing = used.get(identity);
          for (const category of eligible) {
            const row = rowMap.get(category);
            if (!row.MediaLinkIds.includes(existing.Id)) row.MediaLinkIds.push(existing.Id);
            if (!row.MediaOrder.includes(existing.Id)) row.MediaOrder.push(existing.Id);
          }
          const record = freshRecords.find((record) => record.ReferenceId === existing.Id);
          record.SourceIds = [...new Set([...record.SourceIds, entry.sourceId])];
          record.ImdbIds = [...new Set([...record.ImdbIds, ...(group.episodes || [entry]).map((item) => item.imdbId)])];
          continue;
        }
        const link = {
          Id: id(),
          NodeId: nodeId,
          JellyfinItemId: group.episodes ? group.show.Id : item.Id,
          DisplayName: group.episodes ? group.show.Name : item.Name,
          ItemType: group.episodes ? 'Series' : item.Type,
          ViewingOrder: 'Custom',
          Position:
            Math.max(
              0,
              ...next.MediaLinks.filter((l) => l.NodeId === nodeId).map((l) => l.Position),
            ) + 1,
          RangeMode: group.episodes ? 'Episodes' : 'Full',
          StartSeason: group.episodes ? group.season : 0,
          EndSeason: group.episodes ? group.season : 0,
          StartEpisode: group.episodes ? group.first : 0,
          EndEpisode: group.episodes ? group.last : 0,
        };
        next.MediaLinks.push(link);
        used.set(identity, link);
        added++;
        freshRecords.push({
          ReferenceId: link.Id,
          RowId: '',
          SourceIds: [entry.sourceId],
          ImdbIds: (group.episodes || [entry]).map((e) => e.imdbId),
        });
        for (const category of eligible) {
          const row = rowMap.get(category);
          row.MediaLinkIds.push(link.Id);
          row.MediaOrder.push(link.Id);
        }
      }
      for (const record of freshRecords)
        node.AutoAddRecords.push({ ...record, Signature: signature(next, record) });
      return { model: next, added: added + showCards, showCards, skipped: layout.skipped.length };
    }
    return { categories, url, sources, match, preview, plan, apply, changes, applyChanges, signature };
  })();
  // AUTOADD_ENGINE_END
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function episodeFormat(value, inherit = false) {
    const format = String(value || (inherit ? '' : 'Bundles'));
    if (!['Bundles', 'Individual', ...(inherit ? [''] : [])].includes(format))
      throw new Error('Choose Episode bundles or Individual episodes.');
    return format;
  }
  function normalizeImdbLists(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > 100)
      throw new Error('Maximum 100 saved IMDb lists.');
    const ids = new Set(), urls = new Set();
    return raw.map((list) => {
      if (!list || !validGuid(list.Id)) throw new Error('Invalid saved IMDb list ID.');
      const id = String(list.Id).replace(/-/g, '').toLowerCase(), url = autoAdd.url(list.Url),
        name = String(list.Name || '').trim();
      if (ids.has(id)) throw new Error('Duplicate saved IMDb list ID.');
      if (urls.has(url)) throw new Error('This IMDb URL is already saved.');
      if (!name || name.length > 120) throw new Error('Enter an IMDb list name of 1–120 characters.');
      ids.add(id); urls.add(url);
      return { ...list, Id: String(list.Id), Name: name, Url: url, Enabled: list.Enabled !== false };
    });
  }
  const num = (value) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.min(100000, Math.trunc(Number(value)))) : 0;
  const categories = [
    'Sub Group',
    'TV Shows',
    'Movies',
    'Collection',
    'Chronological Order',
    'Custom',
  ];
  const categoryFromAutoAdd = (value) =>
    ({
      'Chronological Timeline': 'Chronological Order',
      Movies: 'Movies',
      'TV Shows': 'TV Shows',
      Collections: 'Collection',
      Other: 'Custom',
    })[value] || '';
  const categoryToAutoAdd = (value) =>
    ({
      'Chronological Order': 'Chronological Timeline',
      Movies: 'Movies',
      'TV Shows': 'TV Shows',
      Collection: 'Collections',
      Custom: 'Other',
    })[value] || '';
  const rowTypeForCategory = (value) =>
    value === 'Sub Group'
      ? 'Groups'
      : value === 'Chronological Order'
        ? 'Timeline'
        : value === 'Custom'
          ? 'Mixed'
          : 'Media';
  const mediaTypesForCategory = (value) =>
    ({
      Movies: ['Movie'],
      'TV Shows': ['Series'],
      Collection: ['BoxSet'],
      'Chronological Order': ['Movie', 'Series'],
      Custom: ['Movie', 'Series', 'BoxSet'],
      'Sub Group': [],
    })[value] || [];
  function categoryForRow(row, model) {
    if (categories.includes(row?.Category)) return row.Category;
    for (const node of model?.Nodes || []) {
      const mapping = (node.AutoAddRows || []).find(
        (entry) => String(entry.RowId).toLowerCase() === String(row?.Id).toLowerCase(),
      );
      const category = categoryFromAutoAdd(mapping?.Category);
      if (category) return category;
    }
    const name = String(row?.Name || '')
      .trim()
      .toLowerCase();
    const names = {
      movies: 'Movies',
      movie: 'Movies',
      'tv shows': 'TV Shows',
      collections: 'Collection',
      collection: 'Collection',
      'chronological timeline': 'Chronological Order',
      'chronological order': 'Chronological Order',
      'sub group': 'Sub Group',
      subgroups: 'Sub Group',
    };
    return (
      names[name] ||
      (row?.RowType === 'Timeline'
        ? 'Chronological Order'
        : row?.RowType === 'Groups'
          ? 'Sub Group'
          : 'Custom')
    );
  }
  function intRange(value, min, max) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  }
  function rangeFields(link) {
    const mode = String(link.RangeMode || 'Full');
    if (!['Full', 'Seasons', 'Episodes'].includes(mode))
      throw new Error('Invalid TV Show range type.');
    if (mode === 'Full')
      return { RangeMode: 'Full', StartSeason: 0, EndSeason: 0, StartEpisode: 0, EndEpisode: 0 };
    if (link.ItemType !== 'Series')
      throw new Error('Season/episode ranges require a Jellyfin TV Show.');
    const first = intRange(link.StartSeason, 0, 999),
      last = intRange(link.EndSeason, 0, 999);
    if (first === null || last === null || first > last)
      throw new Error('Invalid TV Show season range.');
    if (mode === 'Seasons')
      return {
        RangeMode: mode,
        StartSeason: first,
        EndSeason: last,
        StartEpisode: 0,
        EndEpisode: 0,
      };
    const from = intRange(link.StartEpisode, 1, 999),
      to = intRange(link.EndEpisode, 1, 999);
    if (from === null || to === null || (first === last && from > to))
      throw new Error('Invalid TV Show episode range.');
    return {
      RangeMode: mode,
      StartSeason: first,
      EndSeason: last,
      StartEpisode: from,
      EndEpisode: to,
    };
  }
  function linkIdentity(link) {
    return [
      String(link.JellyfinItemId || '')
        .replace(/-/g, '')
        .toLowerCase(),
      link.RangeMode || 'Full',
      link.StartSeason || 0,
      link.EndSeason || 0,
      link.StartEpisode || 0,
      link.EndEpisode || 0,
    ].join(':');
  }
  function artRef(value) {
    const path = String(value || '').trim();
    if (!path) return '';
    if (/[\\\u0000-\u001f]/.test(path)) throw new Error('Invalid artwork reference.');
    if (!(path.startsWith('https://') || (path.startsWith('/') && !path.startsWith('//'))))
      throw new Error('Artwork references must use HTTPS or an internal relative path.');
    const parsed = new URL(path, 'https://franchise.invalid');
    if (
      parsed.username ||
      parsed.password ||
      [...parsed.searchParams.keys()].some((key) =>
        /^(?:api[_-]?key|access[_-]?token|token)$/i.test(key),
      )
    )
      throw new Error('Artwork references must not contain credentials.');
    return path;
  }
  function normalizeArtwork(raw) {
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw)))
      throw new Error('Invalid artwork metadata.');
    const result = { ...emptyArt(), ...(raw || {}) };
    for (const key of [
      'PrimaryUrl',
      'BackdropUrl',
      'LogoUrl',
      'ThumbUrl',
      'BannerUrl',
      'BackdropVideoUrl',
      'PrimaryVideoUrl',
    ]) {
      if (Object.hasOwn(result, key)) result[key] = artRef(result[key]);
    }
    result.BackdropVideoItemId = String(result.BackdropVideoItemId || '');
    if (result.BackdropVideoItemId && !validGuid(result.BackdropVideoItemId))
      throw new Error('Invalid backdrop video ID.');
    return result;
  }
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid backup format.');
    const nodes = Array.isArray(raw.Nodes) ? raw.Nodes : [],
      links = Array.isArray(raw.MediaLinks) ? raw.MediaLinks : [],
      rows = Array.isArray(raw.Rows) ? raw.Rows : [];
    if (nodes.length > 250 || links.length > 3000 || rows.length > 250)
      throw new Error('Maximum 250 groups, 250 rows and 3,000 links.');
    const safeNodes = nodes.map((node) => {
      if (!node || !validGuid(String(node.Id || ''))) throw new Error('Invalid virtual group ID.');
      const collectionId = String(node.CollectionId || '').trim();
      if (collectionId && !validGuid(collectionId))
        throw new Error('Invalid associated Jellyfin collection ID.');
      return {
        ...node,
        Id: String(node.Id),
        ParentId: String(node.ParentId || ''),
        Name: String(node.Name || '')
          .trim()
          .slice(0, 120),
        NodeType: String(node.NodeType || 'Custom').slice(0, 40),
        CollectionId: collectionId,
        CollectionArtworkMode:
          node.CollectionArtworkMode === 'Preserve' ? 'Preserve' : 'Collection',
        Overview: String(node.Overview || '').slice(0, 1500),
        SortOrder: num(node.SortOrder),
        EpisodeFormat: episodeFormat(node.EpisodeFormat),
        AutoAddSources: autoAdd.sources(node.AutoAddSources),
        AutoAddRows: (Array.isArray(node.AutoAddRows) ? node.AutoAddRows : [])
          .filter(
            (mapping) =>
              autoAdd.categories.includes(mapping.Category) &&
              validGuid(String(mapping.RowId || '')),
          )
          .map((mapping) => ({
            ...mapping,
            Category: mapping.Category,
            RowId: String(mapping.RowId),
          })),
        AutoAddRecords: (Array.isArray(node.AutoAddRecords) ? node.AutoAddRecords : [])
          .slice(0, 6000)
          .filter((record) => validGuid(String(record.ReferenceId || '')))
          .map((record) => ({
            ...record,
            ReferenceId: String(record.ReferenceId),
            RowId: String(record.RowId || ''),
            SourceIds: (Array.isArray(record.SourceIds) ? record.SourceIds : []).filter((id) =>
              validGuid(String(id)),
            ),
            ImdbIds: (Array.isArray(record.ImdbIds) ? record.ImdbIds : []).filter((id) =>
              /^tt\d+$/.test(id),
            ),
            Signature: String(record.Signature || '').slice(0, 20000),
          })),
        Artwork: normalizeArtwork(node.Artwork),
      };
    });
    const nodeMap = new Map(safeNodes.map((node) => [node.Id.toLowerCase(), node]));
    if (nodeMap.size !== safeNodes.length) throw new Error('Duplicate group IDs.');
    for (const node of safeNodes) {
      if (!node.Name) throw new Error('Every group requires a name.');
      if (node.ParentId && !nodeMap.has(node.ParentId.toLowerCase()))
        throw new Error('A group points to a nonexistent parent.');
      const visited = new Set();
      let current = node;
      while (current) {
        const key = current.Id.toLowerCase();
        if (visited.has(key)) throw new Error('Circular parent relationship detected.');
        visited.add(key);
        current = current.ParentId ? nodeMap.get(current.ParentId.toLowerCase()) : null;
      }
    }
    const safeLinks = links.map((link) => {
      if (
        !link ||
        !validGuid(String(link.Id || '')) ||
        !validGuid(String(link.JellyfinItemId || '')) ||
        !nodeMap.has(String(link.NodeId || '').toLowerCase())
      )
        throw new Error('Invalid virtual media link.');
      const basic = {
        ...link,
        Id: String(link.Id),
        NodeId: String(link.NodeId),
        JellyfinItemId: String(link.JellyfinItemId),
        DisplayName: String(link.DisplayName || '').slice(0, 150),
        ItemType: String(link.ItemType || 'Movie').slice(0, 40),
        ViewingOrder: String(link.ViewingOrder || 'Custom').slice(0, 80),
        Position: num(link.Position),
      };
      if (Object.hasOwn(link, 'Artwork')) {
        const value = normalizeArtwork(link.Artwork);
        if (Object.values(value).some(Boolean)) basic.Artwork = value;
        else delete basic.Artwork;
      }
      return { ...basic, ...rangeFields(basic) };
    });
    const linkMap = new Map(safeLinks.map((link) => [link.Id.toLowerCase(), link]));
    if (linkMap.size !== safeLinks.length) throw new Error('Duplicate link IDs.');
    function belongs(nodeId, parentId) {
      let current = nodeMap.get(String(nodeId).toLowerCase());
      const visited = new Set();
      while (current && !visited.has(current.Id)) {
        if (current.Id.toLowerCase() === parentId.toLowerCase()) return true;
        visited.add(current.Id);
        current = nodeMap.get(current.ParentId.toLowerCase());
      }
      return false;
    }
    const unique = (values) => {
      const found = new Set();
      return values.filter((value) => {
        const key = value.toLowerCase();
        if (found.has(key)) return false;
        found.add(key);
        return true;
      });
    };
    const safeRows = rows
      .map((row) => {
        if (!row || !validGuid(String(row.Id || ''))) throw new Error('Invalid browse row ID.');
        const parentId = String(row.ParentNodeId || '');
        if (!nodeMap.has(parentId.toLowerCase())) return null;
        const type = ['Groups', 'Media', 'Timeline', 'Mixed'].includes(row.RowType)
          ? row.RowType
          : rowTypeForCategory(categoryForRow(row, { Nodes: safeNodes }));
        const nodeIds = unique(
          (Array.isArray(row.NodeIds) ? row.NodeIds : [])
            .map(String)
            .filter(
              (id) =>
                nodeMap.has(id.toLowerCase()) &&
                nodeMap.get(id.toLowerCase()).ParentId.toLowerCase() === parentId.toLowerCase(),
            ),
        );
        const linkIds = unique(
          (Array.isArray(row.MediaLinkIds) ? row.MediaLinkIds : [])
            .map(String)
            .filter(
              (id) =>
                linkMap.has(id.toLowerCase()) &&
                belongs(linkMap.get(id.toLowerCase()).NodeId, parentId),
            ),
        );
        const items = (Array.isArray(row.Items) ? row.Items : []).map((item) => {
          if (
            !item ||
            !validGuid(String(item.Id || '')) ||
            !validGuid(String(item.JellyfinItemId || ''))
          )
            throw new Error('Invalid direct row reference.');
          const itemType = String(item.ItemType || 'Movie');
          if (!['Movie', 'Series', 'BoxSet'].includes(itemType))
            throw new Error('A row can only reference a movie, TV Show or collection.');
          const result = {
            ...item,
            Id: String(item.Id),
            JellyfinItemId: String(item.JellyfinItemId),
            DisplayName: String(item.DisplayName || '').slice(0, 150),
            ItemType: itemType,
          };
          if (Object.hasOwn(item, 'Artwork')) {
            const value = normalizeArtwork(item.Artwork);
            if (Object.values(value).some(Boolean)) result.Artwork = value;
            else delete result.Artwork;
          }
          return { ...result, ...rangeFields(result) };
        });
        if (
          items.length > 3000 ||
          new Set(items.map((item) => item.Id.toLowerCase())).size !== items.length
        )
          throw new Error('Too many or duplicate row entries.');
        const available = [...linkIds, ...items.map((item) => item.Id)],
          availableSet = new Set(available.map((id) => id.toLowerCase()));
        const preferred = (Array.isArray(row.MediaOrder) ? row.MediaOrder : [])
          .map(String)
          .filter((id) => availableSet.has(id.toLowerCase()));
        const result = {
          ...row,
          Id: String(row.Id),
          ParentNodeId: parentId,
          Name:
            String(row.Name || 'Custom Row')
              .trim()
              .slice(0, 100) || 'Custom Row',
          RowType: type,
          Category: categoryForRow(row, { Nodes: safeNodes }),
          SourceUrl: row.SourceUrl ? autoAdd.url(row.SourceUrl) : '',
          AutoAddSources: autoAdd.sources(row.AutoAddSources),
          EpisodeFormat: episodeFormat(row.EpisodeFormat, true),
          SortOrder: num(row.SortOrder),
          NodeIds: nodeIds.slice(0, 250),
          MediaLinkIds: linkIds.slice(0, 3000),
          Items: items,
          MediaOrder: unique([...preferred, ...available]),
        };
        if (Object.hasOwn(row, 'Artwork')) result.Artwork = normalizeArtwork(row.Artwork);
        return result;
      })
      .filter(Boolean);
    if (new Set(safeRows.map((row) => row.Id.toLowerCase())).size !== safeRows.length)
      throw new Error('Duplicate browse row IDs.');
    if (safeRows.reduce((count, row) => count + row.Items.length, 0) > 3000)
      throw new Error('Maximum 3,000 direct row entries per plugin.');
    return {
      ...raw,
      NavigationLabel:
        String(raw.NavigationLabel || 'Franchises')
          .trim()
          .slice(0, 64) || 'Franchises',
      Nodes: safeNodes,
      MediaLinks: safeLinks,
      Rows: safeRows,
      ImdbLists: normalizeImdbLists(raw.ImdbLists),
    };
  }
  function scopedJobs(base, nodeId) {
    const branch = new Set([nodeId]);
    let changed;
    do {
      changed = false;
      for (const node of base.Nodes)
        if (branch.has(node.ParentId) && !branch.has(node.Id)) {
          branch.add(node.Id);
          changed = true;
        }
    } while (changed);
    const jobs = [];
    for (const node of base.Nodes.filter((n) => branch.has(n.Id))) {
      const ownRows = base.Rows.filter((r) => r.ParentNodeId === node.Id),
        mappings = [],
        mainSources = autoAdd.sources(node.AutoAddSources).filter((s) => s.Enabled);
      const hasOwnSources = (row) => !!row.SourceUrl || !!row.AutoAddSources?.length;
      for (const name of autoAdd.categories) {
        if (!mainSources.some((s) => s.Categories.includes(name))) continue;
        const category = categoryFromAutoAdd(name),
          previous = node.AutoAddRows.find((m) => m.Category === name);
        let row =
          ownRows.find((r) => r.Id === previous?.RowId && !hasOwnSources(r)) ||
          ownRows.find((r) => !hasOwnSources(r) && categoryForRow(r, base) === category);
        // Respect a deleted mapped row, or a row deliberately using its own source.
        if (
          !row &&
          (previous || ownRows.some((r) => hasOwnSources(r) && categoryForRow(r, base) === category))
        )
          continue;
        if (!row) {
          row = {
            Id: guid(),
            ParentNodeId: node.Id,
            Name: category,
            Category: category,
            RowType: rowTypeForCategory(category),
            SortOrder: Math.max(-1, ...ownRows.map((r) => r.SortOrder)) + 1,
            SourceUrl: '',
            NodeIds: [],
            MediaLinkIds: [],
            Items: [],
            MediaOrder: [],
          };
          base.Rows.push(row);
          ownRows.push(row);
        }
        mappings.push({ Category: name, RowId: row.Id });
      }
      if (mappings.length) {
        const enabled = new Set(mappings.map((m) => m.Category)),
          sources = mainSources
            .map((s) => ({ ...s, Categories: s.Categories.filter((c) => enabled.has(c)) }))
            .filter((s) => s.Categories.length);
        if (sources.length)
          jobs.push({
            nodeId: node.Id,
            scopeRowId: '',
            rowIds: mappings.map((m) => m.RowId),
            mappings,
            sources,
            episodeFormat: episodeFormat(ownRows.find((r) =>
              mappings.some((m) => m.Category === 'Chronological Timeline' && m.RowId === r.Id))?.EpisodeFormat || node.EpisodeFormat),
          });
        node.AutoAddRows = [
          ...node.AutoAddRows.filter((m) => !enabled.has(m.Category)),
          ...mappings,
        ];
      }
      for (const row of ownRows.filter(hasOwnSources)) {
        const name = categoryToAutoAdd(categoryForRow(row, base));
        if (!name) continue;
        const assigned = row.AutoAddSources?.length
          ? autoAdd.sources(row.AutoAddSources)
          : [{ Id: guid(), Url: autoAdd.url(row.SourceUrl), Enabled: true, Priority: 0, Categories: [name] }];
        row.AutoAddSources = assigned;
        const sources = assigned.filter((source) => source.Enabled)
          .map((source) => ({ ...source, Categories: [name] }));
        if (!sources.length) continue;
        jobs.push({
          nodeId: node.Id,
          scopeRowId: row.Id,
          rowIds: [row.Id],
          mappings: [{ Category: name, RowId: row.Id }],
          sources,
          episodeFormat: episodeFormat(row.EpisodeFormat || node.EpisodeFormat),
        });
      }
    }
    return jobs;
  }
  function scopeModel(full, job) {
    const next = clone(full),
      ids = new Set(job.rowIds),
      rows = full.Rows.filter((r) => ids.has(r.Id));
    const linked = new Set(rows.flatMap((r) => r.MediaLinkIds));
    const external = new Set(
      full.Rows.filter((r) => !ids.has(r.Id)).flatMap((r) => r.MediaLinkIds),
    );
    next.Rows = clone(rows);
    next.MediaLinks = clone(full.MediaLinks.filter((l) => linked.has(l.Id)));
    for (const node of next.Nodes) {
      if (node.Id !== job.nodeId) {
        node.AutoAddRecords = [];
        continue;
      }
      node.AutoAddRows = clone(job.mappings);
      node.AutoAddSources = clone(job.sources);
      node.EpisodeFormat = episodeFormat(job.episodeFormat || node.EpisodeFormat);
      node.AutoAddRecords = node.AutoAddRecords.filter(
        (r) =>
          String(r.ScopeRowId || '') === job.scopeRowId &&
          (r.RowId ? ids.has(r.RowId) : linked.has(r.ReferenceId)),
      );
    }
    const owner = next.Nodes.find((node) => node.Id === job.nodeId);
    for (const record of owner?.AutoAddRecords || []) {
      if (record.RowId || !external.has(record.ReferenceId)) continue;
      const clean = !!record.Signature && autoAdd.signature(full, record) === record.Signature;
      record.__scopeExternalRows = full.Rows.filter((row) => !ids.has(row.Id) &&
        row.MediaLinkIds.includes(record.ReferenceId)).map((row) => row.Id);
      record.__scopeOwnershipClean = clean;
      if (clean) record.Signature = autoAdd.signature(next, record);
    }
    return next;
  }
  function mergeScope(full, before, next, job) {
    const ids = new Set(job.rowIds),
      oldLinks = new Set(before.MediaLinks.map((l) => l.Id)),
      nextLinks = new Map(next.MediaLinks.map((l) => [l.Id, l]));
    full.Rows = full.Rows.map((row) =>
      ids.has(row.Id) ? clone(next.Rows.find((r) => r.Id === row.Id) || row) : row,
    );
    full.MediaLinks = full.MediaLinks.filter((l) => !oldLinks.has(l.Id) || nextLinks.has(l.Id)).map(
      (l) => (nextLinks.has(l.Id) ? clone(nextLinks.get(l.Id)) : l),
    );
    const current = new Set(full.MediaLinks.map((l) => l.Id));
    for (const link of next.MediaLinks)
      if (!current.has(link.Id)) {
        full.MediaLinks.push(clone(link));
        current.add(link.Id);
      }
    const owner = full.Nodes.find((n) => n.Id === job.nodeId),
      prior = before.Nodes.find((n) => n.Id === job.nodeId),
      imported = next.Nodes.find((n) => n.Id === job.nodeId);
    const processed = new Set(prior.AutoAddRecords.map((r) => r.ReferenceId + ':' + r.RowId));
    owner.AutoAddRecords = owner.AutoAddRecords.filter(
      (r) =>
        String(r.ScopeRowId || '') !== job.scopeRowId ||
        !processed.has(r.ReferenceId + ':' + r.RowId),
    );
    for (const raw of imported.AutoAddRecords) {
      const record = { ...clone(raw), ScopeRowId: job.scopeRowId };
      delete record.__scopeExternalRows;
      delete record.__scopeOwnershipClean;
      if (raw.__scopeOwnershipClean) record.Signature = autoAdd.signature(full, record);
      owner.AutoAddRecords.push(record);
    }
    return full;
  }
  global.FranchiseSettingsCore = {
    autoAdd,
    normalize,
    normalizeImdbLists,
    episodeFormat,
    guid,
    validGuid,
    emptyArt,
    rangeFields,
    linkIdentity,
    categoryForRow,
    rowTypeForCategory,
    mediaTypesForCategory,
    num,
    clone,
    artRef,
    normalizeArtwork,
    categoryToAutoAdd,
    categoryFromAutoAdd,
    categories,
    scopedJobs,
    scopeModel,
    mergeScope,
  };
})(typeof window !== 'undefined' ? window : globalThis);
