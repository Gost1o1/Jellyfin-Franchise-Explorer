"""Specific-episode selection against generated production settings and a mock Jellyfin API."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('settings_builder', ROOT / 'scripts/build_settings_page.py')
builder = module_from_spec(spec)
spec.loader.exec_module(builder)
HTML = builder.generate()
gid = lambda number: f'{number:032x}'
NODE, ROW, SHOW, OTHER = gid(1), gid(2), gid(100), gid(101)
CONFIG = dict(NavigationLabel='Franchises', Nodes=[dict(Id=NODE, Name='Example franchise',
    ParentId='', NodeType='Franchise', Overview='', SortOrder=0)], MediaLinks=[], Rows=[dict(
    Id=ROW, ParentNodeId=NODE, Name='Chronological Order', Category='Chronological Order',
    RowType='Timeline', SortOrder=0, NodeIds=[], MediaLinkIds=[], MediaOrder=[], Items=[])])
LIBRARY = [dict(Id=SHOW, Name='Test Show', Type='Series'),
           dict(Id=OTHER, Name='Other Show', Type='Series')]
BOOT = r'''
window.__config = JSON.parse(localStorage.getItem('episode-picker-config') || 'null') || CONFIG;
window.__library = LIBRARY;
window.__metadata = []; window.__saved = false; window.__defer = false;
window.__delayed = []; window.__emptySeasons = false; window.__failSeasons = false;
window.__releaseEpisodes = () => { for (const release of __delayed.splice(0)) release(); };
localStorage.setItem('jellyfin_credentials', JSON.stringify({Servers:[{
  Id:'server',UserId:'viewer',AccessToken:'fixture-token',LocalAddress:location.origin
}]}));
const episode = (show, season, index) => ({Id:(10000+season*1000+index+(show==='OTHER_ID'?100000:0)).toString(16).padStart(32,'0'),
  Type:'Episode',SeriesId:show,ParentIndexNumber:season,IndexNumber:index,
  Name:'Episode '+index+(index===3?' <scr'+'ipt>untrusted title</scr'+'ipt>':'')});
window.ApiClient = {
  getCurrentUserId: () => 'viewer', accessToken: () => 'fixture-token',
  getCurrentUser: async () => ({Id:'viewer', Configuration:{SubtitleLanguagePreference:'eng'}}),
  getPluginConfiguration: async () => structuredClone(__config),
  updatePluginConfiguration: async (_id,value) => {
    __config=structuredClone(value); localStorage.setItem('episode-picker-config',JSON.stringify(value)); __saved=true;
  },
  getUrl: (route,query) => {const url=new URL(route.replace(/^\//,''),location.origin+'/emby/');
    for(const [key,value] of Object.entries(query||{}))url.searchParams.set(key,value);return url.href;},
  getItem: async (_user,id) => structuredClone(__library.find(item=>item.Id===id)),
  getItems: async (_user,query) => {const all=__library.filter(item=>
    (!query.includeItemTypes||query.includeItemTypes.split(',').includes(item.Type))&&
    (!query.searchTerm||item.Name.toLowerCase().includes(query.searchTerm.toLowerCase())));
    return {Items:structuredClone(all),TotalRecordCount:all.length};}
};
window.fetch = async (input,options={}) => {
  const url=new URL(input,location.href), path=url.pathname;
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const match=path.match(/\/Shows\/([a-f0-9]+)\/(Seasons|Episodes)$/);
  if(!match)return response({},404);
  const query=Object.fromEntries(url.searchParams),show=match[1];
  __metadata.push({show,kind:match[2],query,authorization:options.headers?.Authorization});
  if(match[2]==='Seasons'){
    if(__failSeasons)return response({error:'Season service unavailable'},503);
    const seasons=__emptySeasons?[]:[0,1,2,3,4,5].map(index=>({Id:(200+index).toString(16).padStart(32,'0'),
      Type:'Season',Name:index?'Season '+index:'Specials',IndexNumber:index}));
    return response({Items:seasons,TotalRecordCount:seasons.length});
  }
  const season=Number(query.season),start=Number(query.startIndex||0),limit=Number(query.limit||200);
  if(season===5)return response({error:'Episode service unavailable'},500);
  let all=season===4?[]:Array.from({length:season===3?202:season===1?3:1},(_,i)=>
    episode(show,season,season===2?7:show==='OTHER_ID'?9:i+1));
  if(season===2)all.push({...episode(show,2,8),IsMissing:true},
    {...episode(show,2,9),IsVirtualItem:true},episode(show,1,99));
  if(__defer&&season===1&&show==='SHOW_ID')await new Promise(resolve=>__delayed.push(resolve));
  return response({Items:all.slice(start,start+limit),TotalRecordCount:all.length});
};
'''.replace('CONFIG', json.dumps(CONFIG)).replace('LIBRARY', json.dumps(LIBRARY)).replace('SHOW_ID', SHOW).replace('OTHER_ID', OTHER)


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        for width in [1280, 390, 320]:
            context = browser.new_context(viewport={'width':width,'height':950},
                is_mobile=width<500,has_touch=width<500)
            page = context.new_page()
            errors = []
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.route('http://jellyfin.test/**',lambda route:route.fulfill(content_type='text/html',
                body=HTML.replace('<script type="text/javascript">','<script>'+BOOT+'</script><script type="text/javascript">',1)))
            page.goto('http://jellyfin.test/settings')
            page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
            board = page.locator('#board')
            media = page.locator('#media-dialog')
            picker = page.locator('#library-range-dialog')
            seasons = page.locator('#library-specific-season')
            episodes = page.locator('#library-specific-episode')
            confirm = page.locator('#confirm-library-range')
            mode = page.locator('#library-range-mode')
            error = page.locator('#library-range-error')
            model = lambda: page.evaluate('FranchiseSettings.getModel()')
            refs = lambda: next(row for row in model()['Rows'] if row['Id']==ROW)['Items']

            def expand():
                page.locator('#franchises > summary').click()
                board.locator(f'[data-expand="{NODE}"]').click()

            def open_media():
                board.locator(f'[data-add-row="{ROW}"]').click()

            def choose_show(show=SHOW):
                media.locator('[data-library-search]').fill('Test' if show==SHOW else 'Other')
                media.locator(f'[data-library-range="{show}"]').click()
                expect(picker).to_be_visible()

            def specific():
                mode.select_option('specific')
                expect(seasons).to_be_enabled()
                expect(episodes).to_be_enabled()

            def edit(ref):
                media.locator(f'[data-edit-library-item="{ref["Id"]}"]').click()
                expect(picker).to_be_visible()

            expand();open_media();choose_show()
            expect(mode).to_have_value('full')
            assert page.evaluate('__metadata.length')==0,'Full-show selection needs no episode requests'
            specific()
            expect(seasons).to_have_value('1')
            expect(confirm).to_be_disabled()
            assert episodes.locator('option').count()==4
            assert episodes.locator('script').count()==0,'Episode titles must stay escaped text'
            assert 'S01E03' in episodes.locator('option').last.inner_text()
            episodes.select_option(label='S01E03 · Episode 3 <script>untrusted title</script>')
            expect(confirm).to_be_enabled()
            expect(page.locator('#library-specific-status')).to_contain_text('S01E03')
            confirm.click()
            saved = refs()[0]
            assert (saved['RangeMode'],saved['StartSeason'],saved['EndSeason'],saved['StartEpisode'],saved['EndEpisode'])==('Episodes',1,1,3,3)
            assert saved['JellyfinItemId']==SHOW and saved['ItemType']=='Series'

            # Editing a singleton resolves real metadata and retains the reference ID.
            edit(saved)
            expect(mode).to_have_value('specific')
            expect(episodes).to_be_enabled()
            expect(episodes).to_have_value(gid(11003))
            seasons.select_option('2')
            expect(episodes).to_be_enabled()
            expect(confirm).to_be_disabled()
            assert episodes.locator('option').count()==2,'Missing, virtual and other-season episodes are excluded'
            episodes.select_option(label='S02E07 · Episode 7')
            confirm.click()
            changed=refs()[0]
            assert changed['Id']==saved['Id'] and changed['StartSeason']==changed['EndSeason']==2
            assert changed['StartEpisode']==changed['EndEpisode']==7

            # Fetch all pages, then retain the selected final-page episode through Save/reload.
            edit(changed);expect(episodes).to_be_enabled();seasons.select_option('3')
            expect(episodes.locator('option')).to_have_count(203)
            episodes.select_option(label='S03E202 · Episode 202')
            confirm.click()
            media.locator('[data-close="media-dialog"]').first.click()
            page.locator('#save').click();page.wait_for_function('__saved')
            reference_id=refs()[0]['Id']
            assert page.evaluate('__metadata.some(r=>r.kind==="Episodes"&&r.query.season==="3"&&r.query.startIndex==="200")')
            assert page.evaluate('__metadata.every(r=>r.query.userId==="viewer"&&r.authorization===\'MediaBrowser Token="fixture-token"\')')
            page.reload();page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
            assert refs()[0]['Id']==reference_id and refs()[0]['StartEpisode']==202
            expand();open_media();edit(refs()[0]);expect(episodes).to_be_enabled()
            expect(episodes).to_have_value(gid(13202))

            # Empty/error seasons cannot add an old episode. Retry recovers without a fake choice.
            seasons.select_option('4');expect(error).to_contain_text('No available episodes')
            expect(confirm).to_be_disabled()
            seasons.select_option('5');expect(error).to_contain_text('Episode service unavailable')
            expect(confirm).to_be_disabled()
            seasons.select_option('2');expect(episodes).to_be_enabled()
            episodes.select_option(label='S02E07 · Episode 7')
            page.evaluate('__defer=true')
            seasons.select_option('1');expect(episodes).to_be_disabled()
            seasons.select_option('2');expect(episodes).to_be_enabled()
            page.evaluate('__releaseEpisodes();__defer=false')
            page.wait_for_timeout(50)
            expect(seasons).to_have_value('2')
            assert episodes.locator('option').count()==2,'A stale season response must not replace the current season'
            expect(confirm).to_be_disabled()

            # A stale request from a closed picker cannot affect another TV Show.
            page.evaluate('__defer=true');seasons.select_option('1')
            expect(episodes).to_be_disabled()
            picker.locator('[data-close="library-range-dialog"]').first.click()
            choose_show(OTHER);specific()
            page.evaluate('__releaseEpisodes();__defer=false')
            page.wait_for_timeout(50)
            expect(page.locator('#library-range-title')).to_have_text('Other Show')
            assert 'S01E09' in episodes.locator('option').last.inner_text()
            episodes.select_option(label='S01E09 · Episode 9');confirm.click()
            assert refs()[-1]['JellyfinItemId']==OTHER and refs()[-1]['StartEpisode']==9

            # Preserve manual season/range controls and their endpoints, including specials.
            edit(refs()[0]);mode.select_option('episodes')
            expect(confirm).to_be_enabled()
            page.locator('#library-from-season').fill('0');page.locator('#library-to-season').fill('2')
            page.locator('#library-from-episode').fill('1');page.locator('#library-to-episode').fill('7')
            confirm.click();legacy=refs()[0]
            assert legacy['StartSeason']==0 and legacy['EndSeason']==2 and legacy['EndEpisode']==7
            edit(legacy);expect(mode).to_have_value('episodes')
            expect(page.locator('#library-from-season')).to_have_value('0')
            mode.select_option('seasons');confirm.click()
            assert refs()[0]['RangeMode']=='Seasons' and refs()[0]['StartSeason']==0 and refs()[0]['EndSeason']==2
            edit(refs()[0]);mode.select_option('full');confirm.click()
            assert refs()[0]['RangeMode']=='Full'

            # Seasons endpoint failures and empty seasons also stay disabled until recovery.
            choose_show();page.evaluate('__failSeasons=true');mode.select_option('specific')
            expect(error).to_contain_text('Season service unavailable');expect(confirm).to_be_disabled()
            page.evaluate('__failSeasons=false;__emptySeasons=true')
            page.locator('#library-specific-retry').click()
            expect(error).to_contain_text('No available seasons');expect(confirm).to_be_disabled()
            page.evaluate('__emptySeasons=false');page.locator('#library-specific-retry').click()
            expect(episodes).to_be_enabled();seasons.select_option('0');expect(episodes).to_be_enabled()
            episodes.select_option(label='S00E01 · Episode 1')
            expect(confirm).to_be_enabled()
            picker.locator('[data-close="library-range-dialog"]').first.click()
            assert refs()[0]['RangeMode']=='Full','Cancel must leave existing media unchanged'
            metrics=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
            assert metrics['scroll']<=metrics['width']+1,metrics
            assert not errors,errors
            context.close()
            print('PASS specific episode picker',width,'px')
        browser.close()
    print('PASS production episode selection: real metadata, pagination, singleton edit/save/reload, empty/error/retry, stale requests and legacy ranges')


if __name__=='__main__':
    run()
