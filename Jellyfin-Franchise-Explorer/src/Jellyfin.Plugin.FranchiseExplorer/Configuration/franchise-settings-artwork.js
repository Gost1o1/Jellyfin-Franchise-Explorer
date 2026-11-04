/* Artwork references remain credential-free; uploads are immutable plugin assets. */
(function (global) {
  'use strict';
  function create(host) {
    const { page, $, core: C } = host,
      bindings = new Map();
    let picker = null,
      itemDraft = null,
      generation = 0;
    const esc = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
    const icon = (name) =>
      '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    const safeId = (id) =>
      String(id || '')
        .replace(/-/g, '')
        .toLowerCase();
    function sourceReferences(context) {
      const model = host.getModel();
      if (context.kind === 'item') {
        const ref = host.reference(context.rowId, context.id)?.ref;
        return ref ? [ref] : [];
      }
      let owner,
        filter = null;
      if (context.kind === 'node') owner = model.Nodes.find((n) => n.Id === context.id);
      else {
        const row = model.Rows.find((r) => r.Id === context.id),
          parent = row?.ParentNodeId || context.parentId;
        owner = host.rootOf(parent);
        const category = context.category || C.categoryForRow(row, model);
        filter = { Movies: 'Movie', 'TV Shows': 'Series', Collection: 'BoxSet' }[category] || null;
      }
      if (!owner) return [];
      const branch = host.descendants(owner.Id),
        refs = [
          ...model.MediaLinks.filter((l) => branch.has(l.NodeId)),
          ...model.Rows.filter((r) => branch.has(r.ParentNodeId)).flatMap((r) => r.Items),
        ];
      for (const n of model.Nodes.filter((n) => branch.has(n.Id) && C.validGuid(n.CollectionId)))
        refs.push({ JellyfinItemId: n.CollectionId, ItemType: 'BoxSet' });
      return filter ? refs.filter((r) => r.ItemType === filter) : refs;
    }
    async function sources(context) {
      const ids = [
          ...new Set(
            sourceReferences(context)
              .map((r) => r.JellyfinItemId)
              .filter(C.validGuid),
          ),
        ],
        result = [];
      for (let start = 0; start < ids.length; start += 6) {
        const batch = await Promise.all(ids.slice(start, start + 6).map((id) => host.item(id)));
        result.push(...batch.filter((i) => i && ['Movie', 'Series', 'BoxSet'].includes(i.Type)));
      }
      return result;
    }
    function previewImage(element, route) {
      if (!route) return;
      void host
        .image(route)
        .then((url) => {
          if (!url || !element.isConnected) return;
          element.src = url;
        })
        .catch(() => {});
    }
    async function videoUrl(id) {
      const body = await host.request(
          'FranchiseExplorer/Artwork/VideoPreview/' + encodeURIComponent(id),
          { method: 'POST' },
        ),
        route = body.url || body.Url;
      if (!/^\/FranchiseExplorer\/Artwork\/VideoPreview\/[a-f\d-]{32,36}$/i.test(route || ''))
        throw Error('Invalid video preview response.');
      return host.serverUrl(route);
    }
    function playVideo(element, id, autoplay = false) {
      element.muted = true;
      element.loop = true;
      element.playsInline = true;
      element.preload = 'metadata';
      void videoUrl(id)
        .then((url) => {
          if (!element.isConnected || !element.closest('dialog')?.open) return;
          element.src = url;
          if (autoplay) void element.play().catch(() => {});
        })
        .catch(() => {
          if (element.isConnected) element.hidden = true;
        });
    }
    page.addEventListener(
      'close',
      (event) => {
        if (!event.target.matches('dialog')) return;
        for (const video of event.target.querySelectorAll('video')) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
      },
      true,
    );
    function slotPreview(target, art, slot) {
      target.replaceChildren();
      const key = slot === 'poster' ? 'PrimaryUrl' : 'BackdropUrl',
        route = art[key];
      if (route) {
        const image = document.createElement('img');
        image.alt = slot;
        previewImage(image, route);
        target.append(image);
      }
      if (slot === 'backdrop' && C.validGuid(art.BackdropVideoItemId)) {
        const video = document.createElement('video');
        target.append(video);
        playVideo(video, art.BackdropVideoItemId, true);
      }
      if (!route && !(slot === 'backdrop' && art.BackdropVideoItemId))
        target.innerHTML =
          '<span class="art-empty">' + icon('image') + '<span>Choose ' + slot + '</span></span>';
    }
    function render(container, context, value, onchange) {
      const art = C.normalizeArtwork(value);
      bindings.set(container.id, { container, context, art, onchange });
      container.innerHTML =
        '<h3>Photos</h3><div class="artwork-slots">' +
        ['poster', 'backdrop']
          .map(
            (slot) =>
              '<div class="artwork-slot" data-art-slot="' +
              slot +
              '"><div class="art-slot-heading"><span>' +
              (slot === 'poster' ? 'Poster' : 'Backdrop') +
              '</span><button class="icon-button quiet danger" data-clear-art="' +
              slot +
              '" aria-label="Delete ' +
              slot +
              '" data-help="Remove this override. The source artwork stays in Jellyfin." ' +
              (!(slot === 'poster' ? art.PrimaryUrl : art.BackdropUrl || art.BackdropVideoItemId)
                ? 'disabled'
                : '') +
              '>' +
              icon('trash') +
              '</button></div><button class="art-slot-preview ' +
              slot +
              '" data-open-art="' +
              slot +
              '" aria-label="Choose ' +
              slot +
              '"></button></div>',
          )
          .join('') +
        '</div>';
      for (const slot of ['poster', 'backdrop'])
        slotPreview(container.querySelector('[data-open-art="' + slot + '"]'), art, slot);
    }
    function update(binding, value) {
      binding.art = C.normalizeArtwork(value);
      binding.onchange(C.clone(binding.art));
      render(binding.container, binding.context, binding.art, binding.onchange);
    }
    async function mediaAssets(media) {
      const assets = [],
        id = media.Id;
      let imageList;
      try {
        imageList = await host.request('Items/' + id + '/Images');
      } catch (_) {
        imageList = Object.keys(media.ImageTags || {}).map((type) => ({
          ImageType: type,
          ImageIndex: 0,
        }));
        for (let i = 0; i < (media.BackdropImageTags || []).length; i++)
          imageList.push({ ImageType: 'Backdrop', ImageIndex: i });
      }
      for (const image of Array.isArray(imageList) ? imageList : imageList?.Items || []) {
        const type = image.ImageType || image.imageType,
          index = image.ImageIndex ?? image.imageIndex ?? 0;
        if (!/^[a-z]+$/i.test(type || '') || !Number.isInteger(Number(index)) || Number(index) < 0)
          continue;
        const route = '/Items/' + id + '/Images/' + type + '/' + Number(index);
        assets.push({
          id: id + ':' + type + ':' + index,
          mediaId: id,
          mediaTitle: media.Name,
          mediaType: media.Type,
          kind: 'image',
          label: type + (Number(index) ? ' ' + (Number(index) + 1) : ''),
          path: route,
        });
      }
      const uid = ApiClient.getCurrentUserId?.() || '';
      const extras = await Promise.allSettled(
        ['LocalTrailers', 'SpecialFeatures', 'ThemeMedia'].map((kind) =>
          host.request('Items/' + id + '/' + kind + '?userId=' + encodeURIComponent(uid)),
        ),
      );
      const seen = new Set();
      for (const extra of extras)
        if (extra.status === 'fulfilled') {
          const value = extra.value,
            videos = Array.isArray(value)
              ? value
              : value.ThemeVideosResult?.Items ||
                value.themeVideosResult?.items ||
                value.Items ||
                [];
          for (const video of videos)
            if (
              C.validGuid(video.Id) &&
              !seen.has(safeId(video.Id)) &&
              !['Audio', 'MusicAlbum'].includes(video.Type)
            ) {
              seen.add(safeId(video.Id));
              assets.push({
                id: id + ':video:' + video.Id,
                mediaId: id,
                mediaTitle: media.Name,
                mediaType: media.Type,
                kind: 'video',
                label: video.Name || 'Associated video',
                videoId: video.Id,
                path: '/Items/' + video.Id + '/Images/Primary/0',
              });
            }
        }
      return assets;
    }
    function candidatePreview() {
      const preview = $('artwork-preview');
      preview.replaceChildren();
      if (!picker?.candidate) {
        preview.innerHTML = '<div class="art-preview-empty">Select an image or video</div>';
        $('artwork-selection').textContent = '';
        return;
      }
      const asset = picker.candidate;
      if (asset.kind === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        preview.append(video);
        playVideo(video, asset.videoId);
      } else {
        const image = document.createElement('img');
        image.alt = asset.label || asset.mediaTitle || 'Uploaded image';
        if (asset.preview) image.src = asset.preview;
        else previewImage(image, asset.path);
        preview.append(image);
      }
      $('artwork-selection').textContent =
        (asset.mediaTitle || asset.label || '') +
        (asset.kind === 'video' && picker.slot === 'poster'
          ? ' · Poster uses the video thumbnail'
          : '');
    }
    function renderPicker() {
      if (!picker) return;
      for (const button of $('artwork-filters').querySelectorAll('[data-art-filter]'))
        button.setAttribute('aria-pressed', String(button.dataset.artFilter === picker.filter));
      $('art-upload-panel').hidden = picker.filter !== 'upload';
      $('artwork-gallery').hidden = picker.filter === 'upload';
      const query = $('artwork-search').value.trim().toLowerCase(),
        entries = picker.assets.filter(
          (a) =>
            (picker.filter === 'all' ||
              (picker.filter === 'images' && a.kind === 'image') ||
              (picker.filter === 'videos' && a.kind === 'video')) &&
            (a.mediaTitle + ' ' + a.label).toLowerCase().includes(query),
        );
      const gallery = $('artwork-gallery');
      gallery.innerHTML =
        entries
          .map(
            (asset) =>
              '<button class="art-asset ' +
              (picker.candidate?.id === asset.id ? 'selected' : '') +
              '" data-art-asset="' +
              esc(asset.id) +
              '" data-art-media-id="' +
              asset.mediaId +
              '" data-art-media-type="' +
              esc(asset.mediaType) +
              '"><img alt="" loading="lazy"><span class="art-asset-name">' +
              esc(asset.mediaTitle) +
              '</span><span class="art-asset-type">' +
              esc(asset.kind === 'video' ? 'Video · ' + asset.label : asset.label) +
              '</span></button>',
          )
          .join('') ||
        '<div class="art-empty-results">' +
          (picker.loading
            ? 'Reading associated Jellyfin artwork…'
            : 'No associated artwork. Add media to this category, or upload a photo.') +
          '</div>';
      for (const button of gallery.querySelectorAll('[data-art-asset]')) {
        const asset = picker.assets.find((a) => a.id === button.dataset.artAsset);
        previewImage(button.querySelector('img'), asset.path);
      }
      $('confirm-artwork').disabled = !picker.candidate || picker.busy;
      candidatePreview();
    }
    async function open(binding, slot) {
      const ticket = ++generation;
      picker = {
        binding,
        slot,
        filter: 'all',
        assets: [],
        candidate: null,
        busy: false,
        loading: true,
      };
      $('artwork-heading').textContent = 'Choose ' + (slot === 'poster' ? 'Poster' : 'Backdrop');
      $('artwork-scope').textContent =
        binding.context.kind === 'node'
          ? host.path(binding.context.id)
          : binding.context.kind === 'row'
            ? host.path(
                binding.context.parentId ||
                  host.getModel().Rows.find((r) => r.Id === binding.context.id)?.ParentNodeId,
              )
            : host.reference(binding.context.rowId, binding.context.id)?.ref.DisplayName || 'Media';
      $('artwork-search').value = '';
      $('art-upload').value = '';
      $('art-upload-error').hidden = true;
      $('art-upload-preview').replaceChildren();
      renderPicker();
      $('artwork-dialog').showModal();
      try {
        const media = await sources(binding.context),
          assets = [];
        for (let start = 0; start < media.length; start += 4) {
          assets.push(
            ...(await Promise.all(media.slice(start, start + 4).map(mediaAssets))).flat(),
          );
          if (!picker || generation !== ticket) return;
        }
        picker.assets = assets;
        picker.loading = false;
        renderPicker();
      } catch (error) {
        if (generation === ticket && picker) {
          picker.loading = false;
          $('artwork-gallery').textContent = error.message;
        }
      }
    }
    page.addEventListener('click', (e) => {
      const section = e.target.closest('.photos-section');
      if (!section) return;
      const binding = bindings.get(section.id);
      if (!binding) return;
      const openButton = e.target.closest('[data-open-art]'),
        clear = e.target.closest('[data-clear-art]');
      if (openButton) void open(binding, openButton.dataset.openArt);
      else if (clear) {
        const art = C.clone(binding.art);
        if (clear.dataset.clearArt === 'poster') art.PrimaryUrl = '';
        else {
          art.BackdropUrl = '';
          art.BackdropVideoItemId = '';
        }
        update(binding, art);
      }
    });
    $('artwork-filters').onclick = (e) => {
      const button = e.target.closest('[data-art-filter]');
      if (button && picker) {
        picker.filter = button.dataset.artFilter;
        renderPicker();
      }
    };
    $('artwork-search').oninput = renderPicker;
    $('artwork-gallery').onclick = (e) => {
      const button = e.target.closest('[data-art-asset]');
      if (button && picker) {
        picker.candidate = picker.assets.find((a) => a.id === button.dataset.artAsset);
        $('art-upload-error').hidden = true;
        renderPicker();
      }
    };
    $('confirm-artwork').onclick = async () => {
      if (!picker?.candidate || picker.busy) return;
      const current = picker,
        asset = current.candidate;
      current.busy = true;
      $('confirm-artwork').disabled = true;
      try {
        const art = C.clone(current.binding.art);
        if (current.slot === 'poster') {
          if (asset.kind === 'video' && !(await host.image(asset.path)))
            throw Error('This video has no image thumbnail. Choose an image or upload a photo.');
          art.PrimaryUrl = asset.path;
        } else {
          if (asset.kind === 'video') {
            await videoUrl(asset.videoId);
            art.BackdropVideoItemId = asset.videoId;
            art.BackdropUrl = (await host.image(asset.path)) ? asset.path : '';
          } else {
            art.BackdropUrl = asset.path;
            art.BackdropVideoItemId = '';
          }
        }
        if (picker !== current) return;
        update(current.binding, art);
        $('artwork-dialog').close();
      } catch (error) {
        if (picker === current) {
          current.busy = false;
          $('confirm-artwork').disabled = false;
          host.notify(error.message, true);
        }
      }
    };
    $('artwork-dialog').addEventListener('close', () => {
      generation++;
      picker = null;
      $('artwork-preview').replaceChildren();
      $('artwork-gallery').replaceChildren();
      $('art-upload-preview').replaceChildren();
    });
    $('art-upload').onchange = async () => {
      if (!picker) return;
      const current = picker,
        file = $('art-upload').files[0];
      if (!file) return;
      current.candidate = null;
      current.busy = true;
      $('art-upload-error').hidden = true;
      renderPicker();
      try {
        if (
          !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
          file.size > 8 * 1024 * 1024
        )
          throw Error('Choose a PNG, JPEG, WebP or GIF photo under 8 MB.');
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(Error('The photo could not be read.'));
            reader.readAsDataURL(file);
          }),
          image = new Image();
        image.src = data;
        await image.decode();
        if (image.naturalWidth * image.naturalHeight > 40000000)
          throw Error('Choose a smaller photo.');
        const scale = Math.min(1, 2000 / image.naturalWidth, 2000 / image.naturalHeight),
          canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
        if (!blob || blob.size > 8 * 1024 * 1024) throw Error('Choose a smaller photo.');
        const form = new FormData();
        form.append('file', blob, 'artwork.webp');
        const result = await host.request('FranchiseExplorer/Artwork/Assets', {
            method: 'POST',
            body: form,
          }),
          route = result.url || result.Url;
        if (!/^\/FranchiseExplorer\/Artwork\/Assets\/[a-f\d]{32}$/i.test(route || ''))
          throw Error('Invalid upload response.');
        if (picker !== current) return;
        const preview = canvas.toDataURL('image/webp', 0.88);
        current.candidate = { id: C.guid(), kind: 'image', label: file.name, path: route, preview };
        $('art-upload-preview').innerHTML = '<img alt="Uploaded photo preview">';
        $('art-upload-preview').querySelector('img').src = preview;
      } catch (error) {
        if (picker === current) {
          $('art-upload-error').textContent = error.message;
          $('art-upload-error').hidden = false;
        }
      } finally {
        if (picker === current) {
          current.busy = false;
          renderPicker();
        }
      }
    };
    function openItem(rowId, id) {
      const found = host.reference(rowId, id);
      if (!found) return;
      itemDraft = { rowId, id, art: C.normalizeArtwork(found.ref.Artwork) };
      $('item-art-title').textContent = found.ref.DisplayName || 'Jellyfin media';
      $('item-art-type').textContent =
        { Series: 'TV Show', BoxSet: 'Collection' }[found.ref.ItemType] || found.ref.ItemType;
      render(
        $('item-photos'),
        { kind: 'item', rowId, id },
        itemDraft.art,
        (value) => (itemDraft.art = value),
      );
      $('item-dialog').showModal();
    }
    $('save-item-artwork').onclick = () => {
      if (!itemDraft) return;
      const found = host.reference(itemDraft.rowId, itemDraft.id);
      if (!found) return;
      const next = C.normalizeArtwork(itemDraft.art);
      if (JSON.stringify(C.normalizeArtwork(found.ref.Artwork)) !== JSON.stringify(next))
        host.change(() => (found.ref.Artwork = next));
      $('item-dialog').close();
    };
    $('item-dialog').addEventListener('close', () => (itemDraft = null));
    return { render, openItem, sources };
  }
  global.FranchiseSettingsArtwork = { create };
})(window);
