"""Replay Jellyfin's real remembered-secondary switch with Chromium TextTracks.

The API transport is simulated; production preference enrollment/monitoring and
HTML track helpers run unchanged. Native/server PlaybackInfo has separate .NET
coverage. No running Jellyfin instance or media library is required.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
timeline = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js').read_text()
service = timeline.split('/* Franchise Explorer v0.8.9.5')[0]
home = (ROOT / 'src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js').read_text()
helper = home[home.index('  function disableBrowserTextTracks(){'):home.index('  // A local timeline intent')]
listeners = home[home.index("  window.addEventListener('franchise-subtitles-applied'"):
                 home.index("  window.addEventListener('franchise-subtitles-error'")]
contract = (ROOT / 'scripts/fixtures/jellyfin-web-subtitle-contract.js').read_text()

BOOT = r'''
const server='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222';
const first='33333333-3333-4333-8333-333333333333', second='44444444-4444-4444-8444-444444444444';
const other='55555555-5555-4555-8555-555555555555';
const auth={Id:server,UserId:user,AccessToken:'test-token'};
function localCredentials(){return auth;}
function deviceId(){return 'web-device';}
function itemMatch(a,b){return String(a).replaceAll('-','').toLowerCase()===String(b).replaceAll('-','').toLowerCase();}
window.__commands=[];window.__sessions=[];window.__applied=[];
window.__holdEnrollment=false;window.__releaseEnrollment=null;
window.addEventListener('franchise-subtitles-applied',event=>__applied.push(event.detail));
window.__data={subtitleStreamIndex:-1,secondarySubtitleStreamIndex:-1};
const video=document.querySelector('video');
const streams=new Map([7,11,13].map(index=>[index,{Index:index,DeliveryMethod:'External'}]));
const player={isLocalPlayer:true,setSubtitleStreamIndex(index){
  document.querySelector('#ass-caption').hidden=index<0;
  if(index<0)for(const track of video.textTracks)track.mode='disabled';
}};
const self={_currentPlayer:player,getSubtitleStream:(_,index)=>streams.get(index),
  playMethod:()=> 'DirectPlay',trackHasSecondarySubtitleSupport:()=>true,
  setSecondarySubtitleStreamIndex(index){__data.secondarySubtitleStreamIndex=index;
    document.querySelector('#secondary-caption').hidden=index<0;}};
createJellyfinSubtitleContract({self,enableLocalPlaylistManagement:()=>true,
  getCurrentSubtitleStream:()=>streams.get(__data.subtitleStreamIndex),
  changeStream:()=>{throw Error('External subtitles must not restart the video');},
  getCurrentTicks:()=>0,getPlayerData:()=>__data});
function response(value){return Promise.resolve(new Response(JSON.stringify(value),{status:200,
  headers:{'Content-Type':'application/json'}}));}
window.fetch=(url,options={})=>{
  if(url.endsWith('/ViewerPreferences'))return response({hasPreference:true,subtitleEnabled:false,subtitleLanguage:''});
  if(url.endsWith('/PlaybackPreferences')){
    const result={hasPreference:true,enabled:false,language:'',subtitleStreamIndex:-1,deviceId:'web-device'};
    if(__holdEnrollment)return new Promise(resolve=>{
      __releaseEnrollment=()=>{__holdEnrollment=false;__releaseEnrollment=null;resolve(response(result));};
    });
    return response(result);
  }
  if(url.endsWith('/Sessions'))return response(__sessions);
  if(url.endsWith('/Command')){
    const command=JSON.parse(options.body);__commands.push(command);
    self.setSubtitleStreamIndex(Number(command.Arguments.Index));
    __sessions[0].PlayState.SubtitleStreamIndex=__data.subtitleStreamIndex;
    return Promise.resolve(new Response(null,{status:204}));
  }
  throw Error('Unexpected API request '+url);
};
window.__start=(id,index=11)=>{
  const mediaSource=restoreJellyfinRememberedSecondary({DefaultSubtitleStreamIndex:-1},
    {DefaultSecondarySubtitleStreamIndex:index});
  __data.subtitleStreamIndex=mediaSource.DefaultSubtitleStreamIndex;
  __data.secondarySubtitleStreamIndex=index;
  document.querySelector('#ass-caption').hidden=false;
  document.querySelector('#secondary-caption').hidden=false;
  const track=video.addTextTrack('subtitles','Remembered forced track','eng');track.mode='showing';
  __sessions=[{Id:'actual-web-session',UserId:user,DeviceId:'web-device',NowPlayingItem:{Id:id},
    PlayState:{SubtitleStreamIndex:__data.subtitleStreamIndex}}];
};
window.__context={serverId:server,userId:user,deviceId:'web-device',token:'test-token',
  prefix:'/jellyfin',itemIds:[first,second]};
window.__first=first;window.__second=second;window.__other=other;
'''


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('http://jellyfin.test/**', lambda route: route.fulfill(content_type='text/html',
            body='<video></video><div id="ass-caption" hidden>ASS renderer</div>'
                 '<div id="secondary-caption" hidden>Secondary renderer</div>'))
        page.goto('http://jellyfin.test/web/index.html')
        page.add_script_tag(content=contract)
        page.add_script_tag(content=BOOT)
        page.add_script_tag(content=service)
        page.add_script_tag(content=helper + listeners)
        page.evaluate('async () => applySubtitlePreferences(await FranchiseSubtitlePreferences.prepare(__context))')
        page.wait_for_timeout(5100)  # The previous Off fallback stopped at 4.5s.
        page.evaluate('__start(__first)')
        assert page.evaluate('__data.subtitleStreamIndex') == 11, 'Real Jellyfin secondary promotion must reproduce the failure'
        expect(page.locator('#ass-caption')).to_be_hidden(timeout=4000)
        expect(page.locator('#secondary-caption')).to_be_hidden()
        assert page.evaluate('[...document.querySelector("video").textTracks].every(track=>track.mode==="disabled")')
        assert page.evaluate('__data.secondarySubtitleStreamIndex') == -1
        page.evaluate('__start(__second,7)')
        expect(page.locator('#ass-caption')).to_be_hidden(timeout=4000)
        assert page.evaluate('__commands.length') >= 2, 'Each native queue item must be corrected after actual start'
        # A renderer restoring its previous track well after startup is corrected too.
        page.evaluate('__start(__second,11)')
        expect(page.locator('#ass-caption')).to_be_hidden(timeout=4000)
        commands = page.evaluate('__commands.length')
        page.evaluate('__start(__other,13)')
        page.wait_for_timeout(2000)
        expect(page.locator('#ass-caption')).to_be_visible()
        expect(page.locator('#secondary-caption')).to_be_visible()
        assert page.evaluate('__commands.length') == commands, 'Ordinary playback must keep its own subtitle choices'
        assert page.evaluate('[...document.querySelector("video").textTracks].some(track=>track.mode==="showing")')

        # An enrollment response for A may arrive after ordinary title C has
        # replaced it on the same session. Exercise refresh without polling so
        # the delayed response is the only operation deciding what to command.
        page.reload()
        page.add_script_tag(content=contract)
        page.add_script_tag(content=BOOT)
        page.add_script_tag(content='window.setTimeout=()=>0;window.clearTimeout=()=>{};')
        page.add_script_tag(content=service)
        page.add_script_tag(content=helper + listeners)
        page.evaluate('''async () => {
          await FranchiseSubtitlePreferences.prepare(__context);
          __start(__first);__holdEnrollment=true;
          window.__pendingRefresh=FranchiseSubtitlePreferences.refresh();
        }''')
        page.wait_for_function('typeof __releaseEnrollment === "function"')
        page.evaluate('''async () => {
          __start(__other,13);__releaseEnrollment();await __pendingRefresh;
        }''')
        assert page.evaluate('__commands.length') == 0, 'Stale enrollment must not command an unrelated replacement title'
        assert page.evaluate('__applied.length') == 0, 'Stale enrollment must not send the HTML subtitle fallback to a replacement title'
        expect(page.locator('#ass-caption')).to_be_visible()
        expect(page.locator('#secondary-caption')).to_be_visible()
        assert page.evaluate('[...document.querySelector("video").textTracks].some(track=>track.mode==="showing")')
        page.evaluate('async () => {__start(__second,7);await FranchiseSubtitlePreferences.refresh();}')
        assert page.evaluate('__commands.length') == 1, 'A fresh enrolled queue item must still receive its subtitle preference'
        assert page.evaluate('__applied.length') == 1
        expect(page.locator('#ass-caption')).to_be_hidden()
        expect(page.locator('#secondary-caption')).to_be_hidden()
        assert not errors, errors
        browser.close()
    print('PASS Chromium: actual TextTracks, remembered-secondary promotion, custom renderer Off after slow startup, queue/late restoration, unrelated playback and delayed-enrollment isolation')


if __name__ == '__main__':
    run()
