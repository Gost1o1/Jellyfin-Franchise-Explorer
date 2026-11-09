/* Artwork references remain credential-free; uploads are immutable plugin assets. */
(function (global) {
  'use strict';
  function create(host) {
    const { page, $, core: C } = host,
      bindings = new Map();
    let picker = null,
      itemDraft = null,
      generation = 0,
      previewWork = 0,
      galleryPreviews = null;
    const previewQueue = [];
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
    function previewSurface(label) {
      const surface = document.createElement('span');
      surface.className = 'art-image-surface';
      surface.dataset.label = label || 'Artwork preview';
      return surface;
    }
    async function decodePhoto(blob) {
      if (typeof global.createImageBitmap !== 'function')
        throw Error('Image previews need a newer browser. Update your browser and try again.');
      try {
        const bitmap = await global.createImageBitmap(blob);
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) {
          bitmap.close();
          throw Error('Choose a photo with no more than 40 million pixels.');
        }
        return bitmap;
      } catch (error) {
        if (/40 million/.test(error.message || '')) throw error;
        throw Error('This photo could not be decoded. Choose a valid JPEG, PNG, WebP or GIF image.');
      }
    }
    async function decodeExternal(image, source) {
      image.src = source;
      let timeout;
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error('Image loading timed out.')), 45000);
          }),
        ]);
      } catch (_) {
        image.removeAttribute('src');
        throw Error('This external image could not be shown. Check the URL or upload a photo.');
      } finally { clearTimeout(timeout); }
    }
    async function drawPreview(surface, source) {
      if (typeof source === 'string') {
        // External HTTPS artwork retains its direct-image behavior, without credentials.
        const image = document.createElement('img');
        image.alt = surface.dataset.label;
        surface.replaceChildren(image);
        await decodeExternal(image, source);
        return;
      }
      const bitmap = await decodePhoto(source);
      try {
        if (!surface.isConnected) return;
        const maximum = Number(surface.dataset.maxDimension) || 1200,
          scale = Math.min(1, maximum / bitmap.width, maximum / bitmap.height),
          canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', surface.dataset.label);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        surface.replaceChildren(canvas);
      } finally { bitmap.close(); }
    }
    function currentPreview(job) {
      return job.surface.isConnected && (!job.group || job.group.active);
    }
    function drainPreviews() {
      while (previewWork < 3 && previewQueue.length) {
        const job = previewQueue.shift();
        if (!currentPreview(job)) { job.resolve(); continue; }
        previewWork++;
        void (async () => {
          try {
            const source = await job.load();
            if (currentPreview(job)) await drawPreview(job.surface, source);
            job.resolve();
          } catch (error) { job.reject(error); }
          finally { previewWork--; drainPreviews(); }
        })();
      }
    }
    function queuePreview(surface, load, group = null) {
      return new Promise((resolve, reject) => {
        previewQueue.push({ surface, load, group, resolve, reject });
        drainPreviews();
      });
    }
    function paintPreview(surface, source) {
      // A local upload must not wait behind stalled gallery network requests.
      return drawPreview(surface, source);
    }
    function clearGalleryPreviews() {
      if (galleryPreviews) {
        galleryPreviews.active = false;
        galleryPreviews.observer?.disconnect();
        galleryPreviews = null;
      }
      for (let i = previewQueue.length - 1; i >= 0; i--) {
        if (!currentPreview(previewQueue[i])) previewQueue.splice(i, 1)[0].resolve();
      }
    }
    function previewImage(surface, route, source = null, group = null) {
      if (!route && !source) return;
      let loadedSource = source;
      const work = source ? paintPreview(surface, source) :
        queuePreview(surface, async () => loadedSource = await host.image(route), group);
      void work
        .catch((error) => {
          if (route) void host.forgetImage?.(route, loadedSource);
          if (!surface.isConnected || (group && !group.active)) return;
          const message = document.createElement('span');
          message.className = 'art-image-error';
          message.setAttribute('role', 'status');
          message.textContent = error.message || 'Artwork could not be loaded. Select it again to retry.';
          surface.replaceChildren(message);
        });
    }
    async function verifyImage(route) {
      const source = await host.image(route);
      if (typeof source === 'string') {
        await decodeExternal(new Image(), source);
      } else {
        try { const bitmap = await decodePhoto(source); bitmap.close(); }
        catch (error) { void host.forgetImage?.(route, source); throw error; }
      }
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
        const surface = previewSurface(slot);
        target.append(surface);
        previewImage(surface, route);
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
        const surface = previewSurface(asset.label || asset.mediaTitle || 'Uploaded image');
        preview.append(surface);
        previewImage(surface, asset.path, asset.preview);
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
      clearGalleryPreviews();
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
              '"><span class="art-image-surface"></span><span class="art-asset-name">' +
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
      if (!gallery.hidden) {
        const group = galleryPreviews = { active: true, observer: null },
          routes = new Map();
        if (typeof global.IntersectionObserver === 'function') {
          group.observer = new global.IntersectionObserver((observed) => {
            if (!group.active) return;
            for (const entry of observed) {
              if (!entry.isIntersecting) continue;
              group.observer.unobserve(entry.target);
              previewImage(entry.target, routes.get(entry.target), null, group);
            }
          }, { root: gallery, rootMargin: '120px' });
        }
        for (const button of gallery.querySelectorAll('[data-art-asset]')) {
          const asset = picker.assets.find((a) => a.id === button.dataset.artAsset),
            surface = button.querySelector('.art-image-surface');
          surface.dataset.label = asset.mediaTitle + ' · ' + asset.label;
          surface.dataset.maxDimension = '320';
          routes.set(surface, asset.path);
          if (group.observer) group.observer.observe(surface);
          else previewImage(surface, asset.path, null, group);
        }
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
      if (button && picker && !picker.busy) {
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
          await verifyImage(asset.path);
          art.PrimaryUrl = asset.path;
        } else {
          if (asset.kind === 'video') {
            await videoUrl(asset.videoId);
            art.BackdropVideoItemId = asset.videoId;
            try { await verifyImage(asset.path); art.BackdropUrl = asset.path; }
            catch (_) { art.BackdropUrl = ''; }
          } else {
            await verifyImage(asset.path);
            art.BackdropUrl = asset.path;
            art.BackdropVideoItemId = '';
          }
        }
        if (picker !== current || current.candidate !== asset) return;
        update(current.binding, art);
        $('artwork-dialog').close();
      } catch (error) {
        if (picker === current && current.candidate === asset) {
          current.busy = false;
          $('confirm-artwork').disabled = false;
          host.notify(error.message, true);
        }
      }
    };
    $('artwork-dialog').addEventListener('close', () => {
      generation++;
      picker = null;
      clearGalleryPreviews();
      $('artwork-preview').replaceChildren();
      $('artwork-gallery').replaceChildren();
      $('art-upload-preview').replaceChildren();
    });
    $('art-upload').onchange = async () => {
      if (!picker) return;
      const current = picker,
        file = $('art-upload').files[0];
      if (!file) return;
      const serial = current.uploadSerial = (current.uploadSerial || 0) + 1;
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
        const bitmap = await decodePhoto(file),
          canvas = document.createElement('canvas');
        try {
          const scale = Math.min(1, 2000 / bitmap.width, 2000 / bitmap.height);
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } finally { bitmap.close(); }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
        if (!blob || blob.size > 8 * 1024 * 1024) throw Error('Choose a smaller photo.');
        if (picker !== current || current.uploadSerial !== serial) return;
        const form = new FormData();
        form.append('file', blob, 'artwork.webp');
        const result = await host.request('FranchiseExplorer/Artwork/Assets', {
            method: 'POST',
            body: form,
          }),
          route = result.url || result.Url;
        if (!/^\/FranchiseExplorer\/Artwork\/Assets\/[a-f\d]{32}$/i.test(route || ''))
          throw Error('Invalid upload response.');
        if (picker !== current || current.uploadSerial !== serial) return;
        current.candidate = { id: C.guid(), kind: 'image', label: file.name, path: route, preview: blob };
        const surface = previewSurface('Uploaded photo preview');
        $('art-upload-preview').replaceChildren(surface);
        await paintPreview(surface, blob);
      } catch (error) {
        if (picker === current && current.uploadSerial === serial) {
          $('art-upload-error').textContent = error.message;
          $('art-upload-error').hidden = false;
        }
      } finally {
        if (picker === current && current.uploadSerial === serial) {
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
