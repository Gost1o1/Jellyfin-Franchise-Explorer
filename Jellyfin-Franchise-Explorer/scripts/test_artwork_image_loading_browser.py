"""Exercise production artwork rendering and uploads with browser-enforced CSP.

Run with --baseline to reproduce issue #7 before the canvas rendering fix.
The default mode verifies artwork without allowing blob: or data: image URLs.
"""

import argparse
import base64
import copy
import json
from pathlib import Path
import re
import shutil
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html").read_text()
NODE = f"{1:032x}"
MOVIE = f"{101:032x}"
LINK = f"{201:032x}"
ASSET = f"{801:032x}"
TOKEN = "fixture-artwork-token"
CONFIG = {
    "NavigationLabel": "Franchises",
    "Nodes": [{"Id": NODE, "ParentId": "", "Name": "Artwork fixture", "NodeType": "Franchise"}],
    "Rows": [],
    "MediaLinks": [{
        "Id": LINK, "NodeId": NODE, "JellyfinItemId": MOVIE,
        "DisplayName": "Fixture movie", "ItemType": "Movie", "RangeMode": "Full",
    }],
}
MOVIE_DATA = {"Id": MOVIE, "Name": "Fixture movie", "Type": "Movie", "ImageTags": {"Primary": "fixture"}}
BOOT = """
window.__config = %s;
window.ApiClient = {
  accessToken: () => %s,
  getCurrentUserId: () => 'fixture-viewer',
  getCurrentUser: async () => ({Id:'fixture-viewer', Configuration:{}}),
  getPluginConfiguration: async () => structuredClone(window.__config),
  updatePluginConfiguration: async (_id, value) => {window.__config = structuredClone(value);},
  getUrl: (route, query) => {
    const url = new URL(route.replace(/^\\//, ''), location.origin + '/jellyfin/');
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    return url.href;
  },
  getItem: async () => (%s),
  getItems: async () => ({Items:[],TotalRecordCount:0})
};
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', event => {
  window.__cspViolations.push({directive:event.effectiveDirective, blocked:event.blockedURI});
});
""" % (json.dumps(CONFIG), json.dumps(TOKEN), json.dumps(MOVIE_DATA))


def fixture_photos(page, width=6, height=4):
    """Use each browser's encoder to produce valid JPEG and WebP file bytes."""
    encoded = page.evaluate("""([width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').fillStyle = '#cc3366';
      canvas.getContext('2d').fillRect(0, 0, width, height);
      return ['image/jpeg', 'image/webp'].map(type => [type, canvas.toDataURL(type).split(',')[1]]);
    }""", [width, height])
    return [(mime, base64.b64decode(data)) for mime, data in encoded]


def is_rendered(page, selector, baseline):
    if baseline:
        return page.locator(selector + " img").first.evaluate(
            "image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0"
        )
    return page.locator(selector + " canvas").first.evaluate("""canvas => {
      if (!canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }""")


def wait_rendered(page, selector, baseline):
    if baseline:
        page.wait_for_function("selector => document.querySelector(selector + ' img')?.naturalWidth > 0", arg=selector)
    else:
        page.wait_for_function("""selector => {
          const canvas = document.querySelector(selector + ' canvas');
          if (!canvas?.width || !canvas.height) return false;
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          return pixels.some((value, index) => index % 4 === 3 && value > 0);
        }""", arg=selector)


def after_paint(page):
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def run_large_gallery(browser, browser_name):
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    page.set_default_timeout(10000)
    errors, images, pending = [], [], []
    image_fixture = []
    instrumentation = """
window.__galleryFetches = 0; window.__activeGalleryFetches = 0; window.__maxGalleryFetches = 0;
window.__galleryDecodes = 0; window.__activeGalleryDecodes = 0;
const originalFetch = window.fetch, originalBitmap = window.createImageBitmap;
window.fetch = function(input, options) {
  if (!/\\/Items\\/[^/]+\\/Images\\//.test(String(input))) return originalFetch.call(this, input, options);
  window.__galleryFetches++; window.__activeGalleryFetches++;
  window.__maxGalleryFetches = Math.max(window.__maxGalleryFetches, window.__activeGalleryFetches);
  return originalFetch.call(this, input, options).finally(() => window.__activeGalleryFetches--);
};
window.createImageBitmap = function(...args) {
  window.__galleryDecodes++; window.__activeGalleryDecodes++;
  return originalBitmap.apply(this, args).finally(() => window.__activeGalleryDecodes--);
};
"""
    page.on("pageerror", lambda error: errors.append(str(error)))

    def route(request):
        incoming = request.request
        path = urlsplit(incoming.url).path
        if path == "/settings":
            request.fulfill(content_type="text/html", headers={"Content-Security-Policy": "img-src 'self'"},
                            body=HTML.replace('<script type="text/javascript">',
                                              '<script>' + BOOT + instrumentation + '</script><script type="text/javascript">', 1))
        elif path.endswith("/Images"):
            request.fulfill(json=[{"ImageType": "Backdrop", "ImageIndex": index} for index in range(80)])
        elif "/Images/" in path:
            assert incoming.headers.get("authorization") == 'MediaBrowser Token="' + TOKEN + '"'
            assert TOKEN not in incoming.url
            query = parse_qs(urlsplit(incoming.url).query)
            assert query.get("maxWidth") == ["1200"] and query.get("maxHeight") == ["1200"], incoming.url
            images.append(int(path.rsplit("/", 1)[1]))
            pending.append(request)
        elif path.endswith(("/LocalTrailers", "/SpecialFeatures")):
            request.fulfill(json=[])
        elif path.endswith("/ThemeMedia"):
            request.fulfill(json={"ThemeVideosResult": {"Items": []}})
        else:
            request.fulfill(status=404)

    def drain_images():
        for _ in range(85):
            while pending:
                pending.pop(0).fulfill(content_type=image_fixture[0], body=image_fixture[1])
            after_paint(page)
            if not pending and page.evaluate("window.__activeGalleryFetches === 0 && window.__activeGalleryDecodes === 0"):
                after_paint(page)
                if not pending:
                    return
        raise AssertionError("Gallery preview work did not settle.")

    page.route("http://jellyfin.test/**", route)
    page.goto("http://jellyfin.test/settings")
    page.wait_for_function("window.FranchiseSettings && !document.querySelector('#save').disabled")
    image_fixture[:] = fixture_photos(page, 1600, 900)[0]
    page.locator("#franchises > summary").click()
    page.locator(f'[data-settings-node="{NODE}"]').click()
    page.locator('#franchise-photos [data-open-art="poster"]').click()
    cards = page.locator("#artwork-gallery [data-art-asset]")
    expect(cards).to_have_count(80)
    page.wait_for_function("window.__galleryFetches >= 3")
    after_paint(page)
    assert len(pending) == 3 and len(images) == 3, "Only three preview fetches may run while responses are held."
    drain_images()
    initial = set(images)
    near_viewport = page.locator("#artwork-gallery").evaluate("""gallery => {
      const root = gallery.getBoundingClientRect();
      return [...gallery.querySelectorAll('[data-art-asset]')].filter(card => {
        const box = card.querySelector('.art-image-surface').getBoundingClientRect();
        return box.bottom >= root.top - 120 && box.top <= root.bottom + 120;
      }).map(card => Number(card.dataset.artAsset.split(':').pop()));
    }""")
    assert 0 < len(initial) < 80 and initial.issubset(set(near_viewport)), (initial, near_viewport)
    assert page.evaluate("window.__galleryDecodes") == len(initial)
    assert page.locator("#artwork-gallery canvas").count() == len(initial)
    page.locator("#artwork-gallery").evaluate("gallery => { gallery.scrollTop = gallery.scrollHeight; }")
    after_paint(page)
    drain_images()
    assert 79 in images and len(set(images)) > len(initial)
    assert len(set(images)) < 80, "Scrolling to the end must not eagerly load all intervening images."
    assert page.evaluate("window.__maxGalleryFetches") <= 3
    assert page.locator("#artwork-gallery canvas").evaluate_all(
        "canvases => canvases.length > 0 && canvases.every(canvas => canvas.width <= 320 && canvas.height <= 320)"
    )
    page.locator(f'[data-art-asset="{MOVIE}:Backdrop:79"]').click()
    drain_images()
    wait_rendered(page, "#artwork-preview", False)
    assert page.locator("#artwork-preview canvas").evaluate("canvas => canvas.width") == 1200
    assert page.locator("#artwork-gallery canvas").evaluate_all(
        "canvases => canvases.length > 0 && canvases.every(canvas => canvas.width <= 320 && canvas.height <= 320)"
    )
    page.locator("#confirm-artwork").click()
    page.locator("#save-franchise").click()
    assert page.evaluate("FranchiseSettings.getModel().Nodes[0].Artwork.PrimaryUrl") == (
        "/Items/" + MOVIE + "/Images/Backdrop/79"
    )
    assert not page.evaluate("window.__cspViolations")
    assert not errors, errors
    print(json.dumps({"browser": browser_name, "large_gallery": 80, "initial_images": len(initial),
                      "scrolled_images": len(set(images)), "maximum_active_fetches": page.evaluate("window.__maxGalleryFetches")}))
    page.close()


def run_case(browser, browser_name, policy, baseline, retry=False, external=False, external_timeout=False):
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    page.set_default_timeout(10000)
    errors, uploads, images, external_images, pending_external = [], [], [], [], []
    defer_upload, pending_uploads, response_asset = [False], [], [ASSET]
    defer_image, pending_images, image_index = [False], [], [0]
    image_fixture = []
    config = copy.deepcopy(CONFIG)
    if external:
        config["Nodes"][0]["Artwork"] = {"PrimaryUrl": "https://artwork.test/poster.jpg"}
    boot = BOOT.replace(json.dumps(CONFIG), json.dumps(config), 1)
    page.on("pageerror", lambda error: errors.append(str(error)))
    if external_timeout:
        page.add_init_script("""(() => {
          const originalTimeout = window.setTimeout, originalCreate = Document.prototype.createElement;
          window.__createdArtworkImages = [];
          window.setTimeout = function(callback, delay, ...args) {
            return originalTimeout.call(this, callback, delay === 45000 ? 25 : delay, ...args);
          };
          Document.prototype.createElement = function(tag, ...args) {
            const element = originalCreate.call(this, tag, ...args);
            if (String(tag).toLowerCase() === 'img') window.__createdArtworkImages.push(element);
            return element;
          };
        })();""")

    def route(request):
        incoming = request.request
        path = urlsplit(incoming.url).path
        if urlsplit(incoming.url).hostname == "artwork.test":
            assert "authorization" not in incoming.headers
            assert TOKEN not in incoming.url
            assert incoming.resource_type == "image", "Remote artwork must keep its direct-image behavior."
            external_images.append(incoming.url)
            if external_timeout:
                pending_external.append(request)
                return
            request.fulfill(content_type=image_fixture[0], body=image_fixture[1])
        elif path == "/settings":
            request.fulfill(content_type="text/html", headers={"Content-Security-Policy": policy},
                            body=HTML.replace('<script type="text/javascript">',
                                              '<script>' + boot + '</script><script type="text/javascript">', 1))
        elif re.search(r"/Items/[a-f0-9]+/Images$", path):
            request.fulfill(json=[{"ImageType": "Primary", "ImageIndex": image_index[0]}])
        elif "/Images/" in path or "/Artwork/Assets/" in path:
            assert incoming.headers.get("authorization") == 'MediaBrowser Token="' + TOKEN + '"'
            assert TOKEN not in incoming.url
            assert path.startswith("/jellyfin/"), path
            images.append(incoming.url)
            if defer_image[0] and "/Items/" in path:
                defer_image[0] = False
                pending_images.append(request)
                return
            if retry and len(images) == 1:
                request.fulfill(status=503)
                return
            request.fulfill(content_type=image_fixture[0], body=image_fixture[1])
        elif path.endswith("/Artwork/Assets"):
            assert incoming.method == "POST"
            assert incoming.headers.get("authorization") == 'MediaBrowser Token="' + TOKEN + '"'
            assert "multipart/form-data; boundary=" in incoming.headers.get("content-type", "")
            assert b"RIFF" in incoming.post_data_buffer and b"WEBP" in incoming.post_data_buffer
            uploads.append(incoming.post_data_buffer)
            if defer_upload[0]:
                defer_upload[0] = False
                pending_uploads.append(request)
                return
            request.fulfill(json={"url": "/FranchiseExplorer/Artwork/Assets/" + response_asset[0]})
        elif path.endswith(("/LocalTrailers", "/SpecialFeatures")):
            request.fulfill(json=[])
        elif path.endswith("/ThemeMedia"):
            request.fulfill(json={"ThemeVideosResult": {"Items": []}})
        else:
            request.fulfill(status=404)

    page.route("http://jellyfin.test/**", route)
    page.route("https://artwork.test/**", route)
    page.goto("http://jellyfin.test/settings")
    page.wait_for_function("window.FranchiseSettings && !document.querySelector('#save').disabled")
    photos = fixture_photos(page)
    image_fixture[:] = photos[0]
    page.locator("#franchises > summary").click()
    page.locator(f'[data-settings-node="{NODE}"]').click()
    if external_timeout:
        expect(page.locator("#franchise-photos .art-image-error[role=status]")).to_contain_text("external image could not be shown")
        assert len(pending_external) == 1
        assert page.evaluate("window.__createdArtworkImages.length === 1 && !window.__createdArtworkImages[0].hasAttribute('src')")
        pending_external[0].fulfill(content_type=image_fixture[0], body=image_fixture[1])
    elif external:
        page.wait_for_function("document.querySelector('#franchise-photos img')?.naturalWidth > 0")
        assert external_images == ["https://artwork.test/poster.jpg"]
    page.locator('#franchise-photos [data-open-art="poster"]').click()
    gallery = page.locator("#artwork-gallery [data-art-asset]")
    expect(gallery).to_have_count(1)
    if retry:
        expect(page.locator("#artwork-gallery .art-image-error[role=status]")).to_contain_text("HTTP 503")
        assert len(images) == 1
        gallery.click()
    blocked = baseline and "blob:" not in policy
    if baseline:
        page.wait_for_function("document.querySelector('#artwork-gallery img')?.src.startsWith('blob:')")
        page.wait_for_function("document.querySelector('#artwork-gallery img')?.complete")
    else:
        wait_rendered(page, "#artwork-gallery", baseline)
    assert is_rendered(page, "#artwork-gallery", baseline) != blocked
    gallery.click()
    if baseline:
        page.wait_for_function("document.querySelector('#artwork-preview img')?.complete")
    else:
        wait_rendered(page, "#artwork-preview", baseline)
    assert is_rendered(page, "#artwork-preview", baseline) != blocked
    if retry:
        assert len(images) == 2, "Selecting a failed image should retry the fetch instead of caching its failure."
    if not baseline:
        for width in (1280, 320):
            page.set_viewport_size({"width": width, "height": 1000})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            geometry = gallery.locator(".art-image-surface").evaluate("""surface => {
              const box = surface.getBoundingClientRect(), canvas = surface.querySelector('canvas').getBoundingClientRect();
              return {ratio:box.width / box.height, right:canvas.right, width:canvas.width, surfaceWidth:box.width};
            }""")
            assert abs(geometry["ratio"] - 4 / 3) < 0.02, geometry
            assert geometry["right"] <= width + 1 and geometry["width"] <= geometry["surfaceWidth"] + 1, geometry
        page.set_viewport_size({"width": 1280, "height": 1000})
    assert images, "Library artwork must be fetched using the authenticated server request."
    page.locator('[data-art-filter="upload"]').click()
    messages = []
    for index, (mime, data) in enumerate(photos, 1):
        page.locator("#art-upload").set_input_files({
            "name": "fixture." + ("jpg" if mime == "image/jpeg" else "webp"),
            "mimeType": mime, "buffer": data,
        })
        if blocked:
            expect(page.locator("#art-upload-error")).to_be_visible()
            messages.append(page.locator("#art-upload-error").inner_text())
            assert not uploads, "The decode failure should occur before any upload POST."
            if browser_name == "firefox":
                assert messages[-1] == "Invalid image request.", messages[-1]
        else:
            expect(page.locator("#confirm-artwork")).to_be_enabled()
            expect(page.locator("#art-upload-error")).to_be_hidden()
            assert len(uploads) == index
            wait_rendered(page, "#art-upload-preview", baseline)
            assert is_rendered(page, "#art-upload-preview", baseline)

    if not blocked:
        # Reject broken input before POST, then allow a later valid upload.
        page.locator("#art-upload").set_input_files({
            "name": "broken.jpg", "mimeType": "image/jpeg", "buffer": b"not a JPEG image",
        })
        expect(page.locator("#art-upload-error")).to_be_visible()
        assert page.locator("#art-upload-error").inner_text().strip()
        assert len(uploads) == 2
        mime, data = photos[0]
        page.locator("#art-upload").set_input_files({
            "name": "recovered.jpg", "mimeType": mime, "buffer": data,
        })
        expect(page.locator("#confirm-artwork")).to_be_enabled()
        expect(page.locator("#art-upload-error")).to_be_hidden()
        assert len(uploads) == 3
        page.locator("#confirm-artwork").click()
        wait_rendered(page, "#franchise-photos", baseline)
        assert is_rendered(page, "#franchise-photos", baseline)
        assert any("/Artwork/Assets/" in url for url in images)
        page.locator("#save-franchise").click()
        assert page.evaluate("FranchiseSettings.getModel().Nodes[0].Artwork.PrimaryUrl") == (
            "/FranchiseExplorer/Artwork/Assets/" + ASSET
        )

    if not baseline and not retry and not external and policy == "img-src 'self'":
        # Finish the first request after a newer file has been chosen. Its response
        # must not replace the current selection or the persisted artwork route.
        page.locator(f'[data-settings-node="{NODE}"]').click()
        page.locator('#franchise-photos [data-open-art="poster"]').click()
        page.locator('[data-art-filter="upload"]').click()
        page.evaluate("""() => {
          const input = document.querySelector('#art-upload'), onchange = input.onchange;
          window.__uploadCompletions = 0; window.__uploadStarts = 0;
          input.onchange = async function(...args) {
            try { return await onchange.apply(this, args); }
            finally { window.__uploadCompletions++; }
          };
          const originalFetch = window.fetch;
          window.fetch = function(input, options) {
            if (String(input).endsWith('/Artwork/Assets') && options?.method === 'POST') window.__uploadStarts++;
            return originalFetch.call(this, input, options);
          };
        }""")
        defer_upload[0] = True
        mime, data = photos[0]
        page.locator("#art-upload").set_input_files({"name": "older.jpg", "mimeType": mime, "buffer": data})
        page.wait_for_function("window.__uploadStarts === 1")
        newest_asset = f"{802:032x}"
        response_asset[0] = newest_asset
        mime, data = photos[1]
        page.locator("#art-upload").set_input_files({"name": "newest.webp", "mimeType": mime, "buffer": data})
        page.wait_for_function("window.__uploadCompletions === 1")
        expect(page.locator("#artwork-selection")).to_have_text("newest.webp")
        assert len(pending_uploads) == 1
        pending_uploads[0].fulfill(json={"url": "/FranchiseExplorer/Artwork/Assets/" + ASSET})
        page.wait_for_function("window.__uploadCompletions === 2")
        expect(page.locator("#artwork-selection")).to_have_text("newest.webp")
        expect(page.locator("#confirm-artwork")).to_be_enabled()
        page.locator("#confirm-artwork").click()
        page.locator("#save-franchise").click()
        assert page.evaluate("FranchiseSettings.getModel().Nodes[0].Artwork.PrimaryUrl") == (
            "/FranchiseExplorer/Artwork/Assets/" + newest_asset
        )

        # A confirmation can be waiting for a library image while a new upload
        # replaces the candidate. Completing that old GET must not commit it.
        image_index[0] = 17
        defer_image[0] = True
        page.evaluate("""() => {
          window.__confirmationImageStarts = 0; window.__confirmationCompletions = 0;
          const originalFetch = window.fetch;
          window.fetch = function(input, options) {
            if (/\\/Images\\/Primary\\/17(?:\\?|$)/.test(String(input))) window.__confirmationImageStarts++;
            return originalFetch.call(this, input, options);
          };
          const button = document.querySelector('#confirm-artwork'), onclick = button.onclick;
          button.onclick = async function(...args) {
            try { return await onclick.apply(this, args); }
            finally { window.__confirmationCompletions++; }
          };
        }""")
        page.locator(f'[data-settings-node="{NODE}"]').click()
        page.locator('#franchise-photos [data-open-art="poster"]').click()
        expect(page.locator("#artwork-gallery [data-art-asset]")).to_have_count(1)
        page.wait_for_function("window.__confirmationImageStarts === 1")
        page.locator("#artwork-gallery [data-art-asset]").click()
        page.locator("#confirm-artwork").click()
        expect(page.locator("#confirm-artwork")).to_be_disabled()
        page.locator('[data-art-filter="upload"]').click()
        confirmation_asset = f"{803:032x}"
        response_asset[0] = confirmation_asset
        mime, data = photos[0]
        page.locator("#art-upload").set_input_files({"name": "confirmation-newest.jpg", "mimeType": mime, "buffer": data})
        page.wait_for_function("window.__uploadCompletions === 3")
        expect(page.locator("#artwork-selection")).to_have_text("confirmation-newest.jpg")
        assert len(pending_images) == 1
        pending_images[0].fulfill(content_type=image_fixture[0], body=image_fixture[1])
        page.wait_for_function("window.__confirmationCompletions === 1")
        expect(page.locator("#artwork-dialog")).to_be_visible()
        expect(page.locator("#artwork-selection")).to_have_text("confirmation-newest.jpg")
        expect(page.locator("#confirm-artwork")).to_be_enabled()
        page.locator("#confirm-artwork").click()
        page.locator("#save-franchise").click()
        assert page.evaluate("FranchiseSettings.getModel().Nodes[0].Artwork.PrimaryUrl") == (
            "/FranchiseExplorer/Artwork/Assets/" + confirmation_asset
        )

    violations = page.evaluate("window.__cspViolations")
    if blocked:
        assert any(v["directive"] == "img-src" and v["blocked"] == "blob" for v in violations), violations
        assert any(v["directive"] == "img-src" and v["blocked"] == "data" for v in violations), violations
    else:
        assert not violations, violations
    assert not errors, errors
    result = {"browser": browser_name, "csp": policy, "retry": retry, "external": external,
              "external_timeout": external_timeout,
              "gallery_rendered": not blocked,
              "uploads": len(uploads), "upload_errors": messages,
              "csp_violations": violations}
    print(json.dumps(result))
    page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true", help="Assert the original CSP failure for issue #7.")
    parser.add_argument("--browser", choices=["chromium", "firefox", "all"], default="all")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        for name in (["chromium", "firefox"] if args.browser == "all" else [args.browser]):
            options = {"headless": True}
            if name == "chromium":
                options.update(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
            browser = getattr(playwright, name).launch(**options)
            for policy in ("img-src 'self' blob: data:", "img-src 'self'"):
                run_case(browser, name, policy, args.baseline)
            if not args.baseline:
                run_case(browser, name, "img-src 'self'", False, retry=True)
                run_case(browser, name, "img-src 'self' https://artwork.test", False, external=True)
                run_case(browser, name, "img-src 'self' https://artwork.test", False, external=True, external_timeout=True)
                run_large_gallery(browser, name)
            browser.close()
    print("PASS production artwork image loading, authenticated requests, JPEG/WebP uploads and CSP profiles")


if __name__ == "__main__":
    main()
