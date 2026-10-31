#!/usr/bin/env python3
"""Offline Jellyfin Web mock for v0.8.9.2 (not a live-server guarantee)."""
import base64
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js").read_text()
BROWSE = (ROOT / "src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html").read_text()
REPO = ROOT.parent

assert 'id="fe-config-settings"' in BROWSE
assert "'fe-config-settings').href" in BROWSE
assert (REPO / "docs/Gost1o1-logo.png").is_file()
assert (REPO / "docs/franchise-explorer-preview.png").is_file()
README = (REPO / "README.md").read_text()
assert 'src="docs/Gost1o1-logo.png"' in README
assert "docs/franchise-explorer-preview.png" in README

ORIGIN = "http://jellyfin.test"
USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ROOT_MCU = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
ROOT_SW = "cccccccc-cccc-cccc-cccc-cccccccccccc"
ROW_MCU = "11111111-1111-1111-1111-111111111111"
ROW_SW = "22222222-2222-2222-2222-222222222222"
EPISODE = "33333333-3333-3333-3333-333333333333"
EPISODE_NEXT = "66666666-6666-6666-6666-666666666666"
OTHER_EPISODE = "77777777-7777-7777-7777-777777777777"
SERIES = "44444444-4444-4444-4444-444444444444"
MOVIE = "55555555-5555-5555-5555-555555555555"

HTML = """<!doctype html><html><head><style>
body{margin:0;background:#101114;color:white;font-family:Arial}
.verticalSection{padding:18px 3%}.itemsContainer{display:flex;gap:12px}
.card{flex:0 0 230px}.poster{height:130px;background:#115368}
.card span{display:block}
</style></head><body>
<section id="my-media" class="verticalSection"><h2>My Media</h2><div class="itemsContainer">
<div class="card"><div class="poster"></div><span>Books</span></div>
<div class="card"><div class="poster"></div><span>Collections</span></div>
<div class="card"><div class="poster"></div><span>Movies</span></div>
</div></section>
<section id="continue" class="verticalSection"><h2>Continue Watching</h2>
<div class="itemsContainer"><div class="card">Agent Carter</div></div></section>
<section id="next" class="verticalSection"><h2>Next Up</h2></section>
</body></html>"""
HTML = HTML.replace('<div class="card">Agent Carter</div>',
    f'<div class="card" data-id="{EPISODE}">Agent Carter</div>'
    f'<div class="card" data-id="{OTHER_EPISODE}">Firefly</div>')
HTML = HTML.replace('<section id="next" class="verticalSection"><h2>Next Up</h2></section>',
    f'<section id="next" class="verticalSection"><h2>Next Up</h2><div class="itemsContainer">'
    f'<div class="card" data-id="{EPISODE_NEXT}">Agent Carter S1E2</div>'
    f'<div class="card" data-id="{OTHER_EPISODE}">Firefly S1E2</div></div></section>')

STATE_MCU = {
    "RowId": ROW_MCU, "ParentNodeId": ROOT_MCU, "Name": "Chronological Order",
    "Index": 1, "Total": 422, "PlaybackMode": "paused",
    "QueueKeys": [f"x:{MOVIE}", f"x:{EPISODE}"],
    "CompletedKeys": [f"x:{MOVIE}"],
}
STATE_SW = {
    "RowId": ROW_SW, "ParentNodeId": ROOT_SW, "Name": "Chronological Order",
    "Index": 0, "Total": 11, "PlaybackMode": "paused",
    "QueueKeys": [f"x:{MOVIE}"], "CompletedKeys": [],
}
CATALOG = {
    "nodes": [
        {"id": ROOT_MCU, "parentId": "", "name": "Marvel Cinematic Universe"},
        {"id": ROOT_SW, "parentId": "", "name": "Star Wars"},
    ],
    "rows": [
        {"id": ROW_MCU, "parentNodeId": ROOT_MCU, "name": "Chronological Order"},
        {"id": ROW_SW, "parentNodeId": ROOT_SW, "name": "Chronological Order"},
    ],
}
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kS8AAAAASUVORK5CYII="
)


def respond(route):
    path = urlparse(route.request.url).path
    headers = {"access-control-allow-origin": "*"}
    if path.endswith("/web/index.html"):
        route.fulfill(status=200, content_type="text/html", body=HTML)
    elif path.endswith("/FranchiseExplorer/TimelineState"):
        route.fulfill(status=200, content_type="application/json", body=json.dumps([STATE_MCU, STATE_SW]), headers=headers)
    elif path.endswith("/FranchiseExplorer/Catalog"):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(CATALOG), headers=headers)
    elif "/Images/" in path:
        route.fulfill(status=200, content_type="image/png", body=PNG)
    elif path.endswith("/Items/" + EPISODE) or path.endswith("/Items/" + EPISODE_NEXT):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": EPISODE if path.endswith(EPISODE) else EPISODE_NEXT,
            "Name": "Bridge and Tunnel", "Type": "Episode",
            "SeriesName": "Agent Carter", "SeriesId": SERIES,
            "ParentIndexNumber": 1, "IndexNumber": 2,
        }))
    elif path.endswith("/Items/" + OTHER_EPISODE):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": OTHER_EPISODE, "Type": "Episode", "SeriesName": "Firefly",
            "SeriesId": "88888888-8888-8888-8888-888888888888",
        }))
    elif path.endswith("/Items/" + SERIES):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": SERIES, "Name": "Agent Carter", "Type": "Series",
            "ImageTags": {"Primary": "poster-tag"},
            "BackdropImageTags": ["some-image-tag"],
        }))
    elif path.endswith("/Items/" + MOVIE):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": MOVIE, "Name": "The Phantom Menace", "Type": "Movie", "ProductionYear": 1999,
            "ImageTags": {"Thumb": "thumb-tag"},
        }))
    else:
        route.fulfill(status=404, body="Not found")


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path="/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None,
        args=["--no-sandbox"],
    )
    for width in [390, 1280]:
        page = browser.new_page(viewport={"width": width, "height": 900})
        page.route(ORIGIN + "/**", respond)
        page.add_init_script(
            f"localStorage.setItem('jellyfin_credentials', JSON.stringify({{Servers:[{{UserId:'{USER}', AccessToken:'mock-token', ManualAddress:'{ORIGIN}'}}]}}));"
        )
        page.goto(ORIGIN + "/web/index.html")
        page.add_script_tag(content=SCRIPT)
        page.wait_for_selector(".fe-resume-card", timeout=10000)
        assert page.locator(".fe-resume-card").count() == 2
        # innerText applies the CSS text-transform:uppercase used for the small
        # franchise label in Chromium. Verify the underlying content instead.
        first = page.locator(".fe-resume-card").first
        second = page.locator(".fe-resume-card").nth(1)
        assert first.locator(".fe-resume-franchise").text_content().strip() == "Marvel Cinematic Universe", first.inner_text()
        assert first.locator(".fe-resume-title").text_content().strip() == "Agent Carter", first.inner_text()
        assert "S1:E2 – Bridge and Tunnel" in first.locator(".fe-resume-next").text_content(), first.inner_text()
        assert "0.24% complete" in first.locator(".fe-resume-status").text_content(), first.inner_text()
        assert second.locator(".fe-resume-franchise").text_content().strip() == "Star Wars", second.inner_text()
        assert second.locator(".fe-resume-title").text_content().strip() == "The Phantom Menace", second.inner_text()
        assert "/FranchiseExplorer/Browse?timeline=" in page.locator(".fe-resume-play").first.get_attribute("href")
        page.wait_for_function("document.querySelector('.fe-resume-art img')?.src.startsWith('blob:')")
        expected_art = "poster" if width == 390 else "landscape"
        page.wait_for_function("expected => document.querySelector('.fe-resume-art img')?.dataset.feArtworkKind === expected", arg=expected_art)
        assert page.locator('.fe-resume-art img').first.get_attribute('data-fe-artwork-kind') == expected_art
        # A movie without Primary poster art keeps the existing horizontal image.
        if width == 390:
            page.wait_for_function("document.querySelectorAll('.fe-resume-art img')[1]?.dataset.feArtworkKind === 'landscape'")
            # Portrait -> landscape -> portrait without a full page refresh.
            page.set_viewport_size({"width": 950, "height": 430})
            page.wait_for_function("document.querySelector('.fe-resume-art img')?.dataset.feArtworkKind === 'landscape'")
            page.set_viewport_size({"width": 390, "height": 900})
            page.wait_for_function("document.querySelector('.fe-resume-art img')?.dataset.feArtworkKind === 'poster'")
        tile = page.locator("#franchise-explorer-my-media-tile")
        assert tile.count() == 1
        assert page.evaluate("window.__franchiseExplorerUiVersion") == "0.8.9.9"
        assert tile.get_attribute("data-fe-version") == "0.8.9.9"
        assert page.locator("#franchise-timeline-resume").get_attribute("data-fe-version") == "0.8.9.9"
        before_menu = page.url
        # The options button is hidden until the tile is hovered or focused.
        # Playwright's button.click() does not reliably establish hover when the
        # initial pointer-events:none makes the native artwork the hit target.
        page.evaluate('document.activeElement?.blur()')
        page.mouse.move(0, 0)
        tile.hover()
        page.wait_for_function("""() => {
          const button=document.querySelector('#franchise-explorer-my-media-tile .fe-settings-toggle');
          const holder=button?.closest('.fe-settings-holder');
          return button && getComputedStyle(button).opacity==='1' &&
            getComputedStyle(button).pointerEvents==='auto' &&
            getComputedStyle(holder).pointerEvents==='auto';
        }""")
        tile.locator(".fe-settings-toggle").click()
        assert tile.locator(".fe-settings-menu").is_visible()
        assert page.url == before_menu, "Clicking the three dots must not open browsing"
        assert "Open Franchises" in tile.locator(".fe-settings-menu").inner_text()
        assert "configurationpage?name=Franchise%20Explorer" in tile.locator(".fe-settings-link").last.get_attribute("href")
        page.locator("#next").click()
        assert not tile.locator(".fe-settings-menu").is_visible()

        preference_key = f"fe-show-active-native-rows:{ORIGIN}:{USER.lower()}"
        page.evaluate("([key]) => {localStorage.setItem(key,'0'); window.dispatchEvent(new Event('pageshow'));}", [preference_key])
        page.wait_for_function("document.querySelector('#continue .card[data-id=\"" + EPISODE + "\"]')?.classList.contains('fe-native-franchise-row-hidden')")
        page.wait_for_function("document.querySelector('#next .card[data-id=\"" + EPISODE_NEXT + "\"]')?.classList.contains('fe-native-franchise-row-hidden')")
        assert not page.locator(f'#continue .card[data-id="{OTHER_EPISODE}"]').evaluate('(el) => el.classList.contains("fe-native-franchise-row-hidden")')
        assert not page.locator(f'#next .card[data-id="{OTHER_EPISODE}"]').evaluate('(el) => el.classList.contains("fe-native-franchise-row-hidden")')
        assert page.locator('.fe-resume-card').count() == 2
        page.evaluate("([key]) => {localStorage.setItem(key,'1'); window.dispatchEvent(new Event('pageshow'));}", [preference_key])
        page.wait_for_function("!document.querySelector('#continue .card[data-id=\"" + EPISODE + "\"]')?.classList.contains('fe-native-franchise-row-hidden')")
        page.wait_for_function("!document.querySelector('#next .card[data-id=\"" + EPISODE_NEXT + "\"]')?.classList.contains('fe-native-franchise-row-hidden')")

        # Desktop hover reveals the button; touch-capable devices must not lose access.
        if width == 1280:
            page.evaluate('document.activeElement?.blur()')
            page.mouse.move(0, 0)
            page.wait_for_timeout(200)
            assert tile.locator('.fe-settings-toggle').evaluate('(el) => getComputedStyle(el).opacity') == '0'
            tile.hover()
            page.wait_for_function("getComputedStyle(document.querySelector('#franchise-explorer-my-media-tile .fe-settings-toggle')).opacity === '1'")
            page.evaluate("document.querySelector('#franchise-explorer-my-media-tile .fe-settings-toggle').focus()")
            page.mouse.move(0, 0)
            page.wait_for_function("getComputedStyle(document.querySelector('#franchise-explorer-my-media-tile .fe-settings-toggle')).opacity === '1'")

        # Jellyfin destroys both the custom section and its native anchor.
        # The observer must recreate/reparent the existing card immediately.
        for _ in range(3):
            page.evaluate("""() => {
              document.querySelector('#franchise-timeline-resume').remove();
              const old = document.querySelector('#continue');
              old.outerHTML='<section id="continue" class="verticalSection"><h2>Continue Watching</h2></section>';
            }""")
            page.wait_for_selector(".fe-resume-card", timeout=2500)
            assert page.locator("#franchise-timeline-resume").count() == 1
            assert page.evaluate("document.querySelector('#continue').nextElementSibling.id") == "franchise-timeline-resume"

        # Refresh should restore from the user-scoped session cache, and fresh
        # server progress must remain authoritative.
        page.reload()
        page.add_script_tag(content=SCRIPT)
        page.wait_for_selector(".fe-resume-card", timeout=10000)
        assert page.locator(".fe-resume-card").count() == 2
        page.wait_for_function("expected => document.querySelector('.fe-resume-art img')?.dataset.feArtworkKind === expected", arg=expected_art)
        # The mock Jellyfin My Media rail intentionally has native fixed-width
        # cards in a horizontally scrolling row. Its scrollWidth can exceed the
        # viewport at 390 px even with the plugin disabled. Test the franchise
        # section itself instead of incorrectly rejecting that native carousel.
        layout = page.evaluate("""() => {
          const section = document.querySelector('#franchise-timeline-resume');
          const grid = section?.querySelector('.fe-resume-grid');
          const rect = element => {
            const {left, right, width} = element.getBoundingClientRect();
            return {left, right, width, clientWidth:element.clientWidth,
              scrollWidth:element.scrollWidth};
          };
          return {viewport:window.innerWidth,
            nativePageScrollWidth:document.documentElement.scrollWidth,
            section:rect(section), grid:rect(grid),
            cards:[...grid.querySelectorAll('.fe-resume-card')].map(rect)};
        }""")
        assert layout["section"]["left"] >= -1, layout
        assert layout["section"]["right"] <= layout["viewport"] + 1, layout
        assert layout["grid"]["scrollWidth"] <= layout["grid"]["clientWidth"] + 1, layout
        assert all(card["left"] >= layout["grid"]["left"] - 1 and
                   card["right"] <= layout["grid"]["right"] + 1
                   for card in layout["cards"]), layout
        print("PASS v0.8.9.2 homepage / menu / hard refresh at", width, "px")
        page.close()
    browser.close()
print("v0.8.9.2 mock tests passed; live Jellyfin validation remains required.")
