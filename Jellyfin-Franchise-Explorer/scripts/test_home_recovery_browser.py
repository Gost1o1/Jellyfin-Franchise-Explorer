"""Home tracker failure, empty, and successful recovery with mocked HTTP responses."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
script=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
user='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';item='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';row='cccccccccccccccccccccccccccccccc'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox']);page=browser.new_page();mode=['failure']
 def route(r):
  url=r.request.url
  if url.endswith('/web/index.html'):r.fulfill(content_type='text/html',body='<section class="verticalSection"><h2>Continue Watching</h2><div class="itemsContainer"></div></section>');return
  if '/TimelineState' in url:
   if mode[0]=='failure':r.fulfill(status=503,body='unavailable');return
   r.fulfill(content_type='application/json',body=json.dumps([] if mode[0]=='empty' else [{'RowId':row,'Index':0,'Total':1,'PlaybackMode':'paused','QueueKeys':['x:'+item]}]));return
  if '/Catalog' in url:r.fulfill(content_type='application/json',body='{"nodes":[],"rows":[]}');return
  r.fulfill(content_type='application/json',body=json.dumps({'Id':item,'Name':'First Avenger','Type':'Movie'}))
 page.route('http://jellyfin.test/**',route)
 page.add_init_script("localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{UserId:'"+user+"',AccessToken:'mock',ManualAddress:'http://jellyfin.test'}]}));const original=setInterval;window.setInterval=(fn,ms)=>{if(ms===12000)window.refreshHome=fn;return original(fn,ms);};")
 page.goto('http://jellyfin.test/web/index.html');page.add_script_tag(content=script)
 page.get_by_text('Could not load franchise watch orders. Retrying automatically…').wait_for(timeout=10000)
 mode[0]='empty';page.get_by_role('button',name='Retry',exact=True).click();page.wait_for_function('!document.querySelector("#franchise-timeline-resume")?.isConnected')
 mode[0]='success';page.evaluate('window.dispatchEvent(new Event("pageshow"))');page.locator('.fe-resume-card').wait_for(timeout=10000);assert 'First Avenger' in page.locator('.fe-resume-card').inner_text()
 browser.close()
print('PASS Home tracker: visible failure, retry, confirmed empty, and successful recovery')
