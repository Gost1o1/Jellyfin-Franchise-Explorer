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
    elif path.endswith("/Items/" + EPISODE):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": EPISODE, "Name": "Bridge and Tunnel", "Type": "Episode",
            "SeriesName": "Agent Carter", "SeriesId": SERIES,
            "ParentIndexNumber": 1, "IndexNumber": 2,
        }))
    elif path.endswith("/Items/" + SERIES):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "Id": SERIES, "Name": "Agent Carter", "Type": "Series",
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
        assert page.locator(".fe-resume-card").first.inner_text().find("Marvel Cinematic Universe") >= 0
        assert page.locator(".fe-resume-card").first.inner_text().find("Agent Carter") >= 0
        assert "S1:E2 – Bridge and Tunnel" in page.locator(".fe-resume-card").first.inner_text()
        assert "0.24% complete" in page.locator(".fe-resume-card").first.inner_text()
        assert "Star Wars" in page.locator(".fe-resume-card").nth(1).inner_text()
        assert "The Phantom Menace" in page.locator(".fe-resume-card").nth(1).inner_text()
        assert "/FranchiseExplorer/Browse?timeline=" in page.locator(".fe-resume-play").first.get_attribute("href")
        page.wait_for_function("document.querySelector('.fe-resume-art img')?.src.startsWith('blob:')")
        tile = page.locator("#franchise-explorer-my-media-tile")
        assert tile.count() == 1
        tile.locator(".fe-settings-toggle").click()
        assert tile.locator(".fe-settings-menu").is_visible()
        assert "configurationpage?name=Franchise%20Explorer" in tile.locator(".fe-settings-link").get_attribute("href")
        page.locator("#next").click()
        assert not tile.locator(".fe-settings-menu").is_visible()

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
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        print("PASS v0.8.9.2 homepage / menu / hard refresh at", width, "px")
        page.close()
    browser.close()
print("v0.8.9.2 mock tests passed; live Jellyfin validation remains required.")
