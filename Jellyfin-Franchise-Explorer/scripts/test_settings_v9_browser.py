"""Live settings behavior against a mocked Jellyfin API, using the real production page."""
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import base64
import json
import os
import re
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
gid = lambda n: f'{n:032x}'
NODE, CHILD, MOVIES, TV, CHRONO, CUSTOM, COLLECTION, GROUPS, LINK = [gid(n) for n in range(1,10)]
MOVIE1, MOVIE2, SHOW, BOX, EP1, EP2, EP3, TRAILER = [gid(n) for n in range(101,109)]
def entry(n, media, name, kind='Movie', **extra):
    return dict(Id=gid(n), JellyfinItemId=media, DisplayName=name, ItemType=kind, RangeMode='Full', StartSeason=0,EndSeason=0,StartEpisode=0,EndEpisode=0,**extra)
def row(ident, name, kind, **extra):
    return dict(Id=ident,ParentNodeId=NODE,Name=name,RowType=kind,SortOrder=int(ident,16),NodeIds=[],MediaLinkIds=[],Items=[],MediaOrder=[],**extra)
CONFIG = dict(NavigationLabel='Franchises',FutureSetting={'retain':True},Nodes=[
    dict(Id=NODE,ParentId='',Name='Marvel',NodeType='Franchise',Overview='Existing description',SortOrder=0,Artwork={},AutoAddSources=[],AutoAddRows=[],AutoAddRecords=[],FutureNodeField=7),
    dict(Id=CHILD,ParentId=NODE,Name='Phase One',NodeType='Phase',SortOrder=0,Artwork={},AutoAddSources=[],AutoAddRows=[],AutoAddRecords=[])],
    MediaLinks=[dict(**entry(9,MOVIE1,'Captain America'),NodeId=NODE,Position=1,ViewingOrder='Custom')],Rows=[
        row(MOVIES,'Movies','Media'),row(TV,'TV Shows','Media'),row(CHRONO,'Chronological Timeline','Timeline'),row(CUSTOM,'Other','Mixed'),row(COLLECTION,'Collection','Media'),row(GROUPS,'Phases','Groups')])
CONFIG['Rows'][0].update(MediaLinkIds=[LINK],MediaOrder=[LINK])
CONFIG['Rows'][1].update(Items=[entry(201,SHOW,'Agent Carter','Series')],MediaOrder=[gid(201)])
CONFIG['Rows'][2].update(MediaLinkIds=[LINK],MediaOrder=[LINK])
CONFIG['Rows'][5]['NodeIds']=[CHILD]
LIBRARY = [dict(Id=MOVIE1,Name='Captain America',Type='Movie',ProductionYear=2011,ProviderIds={'Imdb':'tt1'},ImageTags={'Primary':'a'}),
 dict(Id=MOVIE2,Name='Iron Man',Type='Movie',ProductionYear=2008,ProviderIds={'Imdb':'tt2'},ImageTags={'Primary':'b'}),
 dict(Id=SHOW,Name='Agent Carter',Type='Series',ProductionYear=2015,ProviderIds={'Imdb':'tt3'},ImageTags={'Primary':'c'}),
 dict(Id=BOX,Name='Marvel Collection',Type='BoxSet',ProductionYear=2019,ProviderIds={},ImageTags={'Primary':'d'}),
 *[dict(Id=ident,Name=f'Episode {index}',Type='Episode',SeriesId=SHOW,ParentIndexNumber=1,IndexNumber=index,ProductionYear=2015,ProviderIds={'Imdb':f'tt{index+3}'}) for index,ident in enumerate([EP1,EP2,EP3],1)]]
SOURCE = dict(entries=[dict(imdbId='tt1',title='Captain America',year=2011,type='Movie',position=1),dict(imdbId='tt2',title='Iron Man',year=2008,type='Movie',position=2),*[dict(imdbId=f'tt{i+3}',title=f'Episode {i}',year=2015,type='Episode',position=i+2) for i in range(1,4)],dict(imdbId='tt99',title='Missing movie',year=2025,type='Movie',position=6)],orderVerified=True)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=')
BOOT='''window.__config=%s;window.__library=%s;window.__saved=null;window.__queries=[];
localStorage.setItem('jellyfin_credentials',JSON.stringify({Servers:[{Id:'server',UserId:'viewer',LocalAddress:location.origin,AccessToken:'fixture-token'}]}));
window.ApiClient={getCurrentUserId:()=> 'viewer', accessToken:()=> 'fixture-token',
 getCurrentUser:async()=>({Configuration:{SubtitleLanguagePreference:'deu'}}),
 getPluginConfiguration:async()=>structuredClone(window.__config),
 updatePluginConfiguration:async(id,config)=>{window.__config=JSON.parse(JSON.stringify(config,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));window.__saved=structuredClone(config);},
 getUrl:(route,query)=>{const u=new URL(route.replace(/^\\//,''),location.origin+'/emby/');for(const [k,v]of Object.entries(query||{}))u.searchParams.set(k,v);return u.href;},
 getItem:async(uid,id)=>structuredClone(window.__library.find(i=>i.Id===id)||{Id:id,Name:'Trailer',Type:'Video',ImageTags:{Primary:'t'}}),
 getItems:async(uid,query)=>{window.__queries.push(structuredClone(query));let all=window.__library.filter(i=>(query.includeItemTypes||'Movie,Series,BoxSet').split(',').includes(i.Type));if(query.searchTerm)all=all.filter(i=>(i.Name+' '+i.ProductionYear).toLowerCase().includes(query.searchTerm.toLowerCase()));return {Items:structuredClone(all.slice(query.startIndex||0,(query.startIndex||0)+(query.limit||40))),TotalRecordCount:all.length};}};
''' % (json.dumps(CONFIG),json.dumps(LIBRARY))

def run():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1280,'height':1000},accept_downloads=True)
        errors=[]; requests=[];uploads=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('request',lambda request:requests.append(request.url))
        def route(request):
            path=urlsplit(request.request.url).path
            if path=='/settings':request.fulfill(content_type='text/html',body=HTML.replace('<script type="text/javascript">','<script>'+BOOT+'</script><script type="text/javascript">',1));return
            if path.endswith('/AutoAdd/Source'):request.fulfill(json=SOURCE);return
            if re.search(r'/Items/[a-f0-9]+/Images$',path):request.fulfill(json=[{'ImageType':'Primary','ImageIndex':0},{'ImageType':'Backdrop','ImageIndex':0},{'ImageType':'Backdrop','ImageIndex':1}]);return
            if '/Images/' in path or '/Artwork/Assets/' in path:request.fulfill(content_type='image/png',body=PNG);return
            if path.endswith('/LocalTrailers'):request.fulfill(json=[{'Id':TRAILER,'Name':'Trailer','Type':'Trailer'}] if MOVIE1 in path else []);return
            if path.endswith('/SpecialFeatures'):request.fulfill(json=[]);return
            if path.endswith('/ThemeMedia'):request.fulfill(json={'ThemeVideosResult':{'Items':[]}});return
            if path.endswith('/Artwork/Assets'):
                uploads.append(request.request.post_data_buffer);request.fulfill(json={'url':'/FranchiseExplorer/Artwork/Assets/'+gid(800+len(uploads))});return
            if '/Artwork/VideoPreview/' in path:
                if request.request.method=='POST':request.fulfill(json={'url':'/FranchiseExplorer/Artwork/VideoPreview/'+gid(900),'expiresAt':'2099-01-01T00:00:00Z'})
                else:request.fulfill(status=404)
                return
            request.fulfill(status=404)
        page.route('http://jellyfin.test/**',route)
        page.goto('http://jellyfin.test/settings')
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        model=lambda:page.evaluate('FranchiseSettings.getModel()')
        board=page.locator('#board'); media=page.locator('#media-dialog'); node=page.locator('#franchise-dialog'); rowdlg=page.locator('#row-dialog')
        def cancel(dialog):dialog.get_by_role('button',name='Cancel',exact=True).click()
        def closemedia():media.locator('[data-close="media-dialog"]').first.click()
        def expand(ident):
            control=board.locator(f'[data-expand="{ident}"]')
            if control.get_attribute('aria-expanded')!='true':control.click()
        def manage(ident):board.locator(f'[data-add-row="{ident}"]').click();return media.locator('[data-library-scope]')
        def search(scope,query):scope.locator('[data-library-search]').fill(query);page.wait_for_timeout(420)
        assert page.locator('main > details.panel').count()==2
        assert page.locator('#setup,.preview-badge').count()==0
        assert not re.search(r'Demo matches|prototype only changes', HTML)
        page.locator('#settings > summary').click()
        expect(page.locator('#language')).to_be_disabled()
        expect(page.locator('#language option').first).to_contain_text('German')
        page.locator('#subtitles').click();page.locator('#language').select_option('fr');page.locator('#hide-native').click()
        assert page.evaluate("localStorage.getItem('fe-subtitles:server:viewer')")=='1'
        assert page.evaluate("localStorage.getItem('fe-subtitle-language:server:viewer')")=='fr'
        assert page.evaluate("localStorage.getItem('fe-show-active-native-rows:http://jellyfin.test:viewer')")=='0'
        page.locator('#settings > summary').click()
        page.locator('#franchises > summary').click();expand(NODE)
        assert board.locator('[data-library-search],.library-section').count()==0
        page.locator('#save').click();page.wait_for_function('__saved!==null')
        assert page.evaluate('__saved.FutureSetting.retain')
        assert page.evaluate('__saved.Nodes[0].FutureNodeField')==7
        assert page.evaluate('__saved.MediaLinks[0].Id')==LINK

        # Existing group rows are presentation references: a no-op save must not convert them.
        before=model();board.locator(f'[data-settings-row="{GROUPS}"]').click();page.locator('#save-row').click()
        assert len(model()['Nodes'])==len(before['Nodes'])
        assert next(r for r in model()['Rows'] if r['Id']==GROUPS)['NodeIds']==[CHILD]

        # Node settings creation is transactional and preserves name/art drafts.
        board.locator(f'[data-settings-node="{CHILD}"]').click()
        page.locator('#detail-title').fill('Phase One draft');page.locator('#franchise-add-subgroup').click();page.locator('#structure-name').fill('Nested pending');page.locator('#confirm-structure').click()
        assert not any(n['Name']=='Nested pending' for n in model()['Nodes']);cancel(node)
        assert not any(n['Name']=='Nested pending' for n in model()['Nodes'])
        board.locator(f'[data-settings-node="{CHILD}"]').click();page.locator('#franchise-add-subgroup').click();page.locator('#structure-name').fill('Nested group');page.locator('#confirm-structure').click();page.locator('#save-franchise').click()
        nested=next(n for n in model()['Nodes'] if n['Name']=='Nested group');assert nested['ParentId']==CHILD

        # Pointer row reordering and keyboard reparenting both edit the real flat model.
        def drag_to(handle,target,x=.5,y=.25):
            handle.evaluate("(el)=>el.scrollIntoView({block:'center',behavior:'instant'})");target.scroll_into_view_if_needed()
            start=handle.bounding_box();end=target.bounding_box()
            page.mouse.move(start['x']+start['width']/2,start['y']+start['height']/2);page.mouse.down()
            page.mouse.move(end['x']+end['width']*x,end['y']+end['height']*y,steps=12);page.mouse.up()
        before=model()
        drag_to(board.locator(f'[data-drag-id="{COLLECTION}"]'),board.locator(f'.tree-row[data-id="{MOVIES}"]'))
        assert next(r for r in model()['Rows'] if r['Id']==COLLECTION)['SortOrder']==0
        page.locator('#undo').click();assert model()==before

        page.locator('#add-franchise').click();page.locator('#new-name').fill('Another franchise');page.locator('#create-manual').click()
        second=next(n for n in model()['Nodes'] if n['Name']=='Another franchise')
        drag_to(board.locator(f'[data-drag-id="{second["Id"]}"]'),board.locator(f'article[data-id="{NODE}"] > .node-head'),x=.25,y=.5)
        assert next(n for n in model()['Nodes'] if n['Id']==second['Id'])['SortOrder']==0
        assert next(n for n in model()['Nodes'] if n['Id']==NODE)['SortOrder']==1
        page.locator('#undo').click();page.locator('#undo').click();assert model()==before
        expand(CHILD);board.locator(f'[data-drag-id="{nested["Id"]}"]').press('Enter')
        assert page.locator(f'#move-parent option[value="{nested["Id"]}"]').count()==0
        page.locator('#move-parent').select_option(NODE);page.locator('#confirm-move').click()
        assert next(n for n in model()['Nodes'] if n['Id']==nested['Id'])['ParentId']==NODE
        page.locator('#undo').click();assert model()==before

        # A subgroup's + popup includes structure tools, not inline nested search panels.
        board.locator(f'[data-add-node="{CHILD}"]').click()
        expect(page.locator('#media-group-tools')).to_be_visible()
        page.locator('#choose-add-subgroup').click();page.locator('#subgroup-name').fill('From subgroup plus');page.locator('#confirm-subgroup').click()
        assert any(n['Name']=='From subgroup plus' and n['ParentId']==CHILD for n in model()['Nodes'])
        page.locator('#undo').click();assert model()==before

        # Live library requests are fixed to each row type, with grouped TV range editing.
        scope=manage(MOVIES);search(scope,'Iron');assert page.evaluate('__queries.at(-1).includeItemTypes')=='Movie'
        scope.locator(f'[data-library-add="{MOVIE2}"]').click();assert len(next(r for r in model()['Rows'] if r['Id']==MOVIES)['Items'])==1
        expect(scope.locator(f'[data-library-add="{MOVIE2}"]')).to_be_disabled();closemedia()
        scope=manage(TV);search(scope,'Agent');assert page.evaluate('__queries.at(-1).includeItemTypes')=='Series'
        scope.locator(f'[data-library-range="{SHOW}"]').click();page.locator('#library-range-mode').select_option('episodes');page.locator('#library-from-season').fill('1');page.locator('#library-to-season').fill('1');page.locator('#library-from-episode').fill('1');page.locator('#library-to-episode').fill('3');page.locator('#confirm-library-range').click()
        tvrow=next(r for r in model()['Rows'] if r['Id']==TV);limited=next(i for i in tvrow['Items'] if i['RangeMode']=='Episodes');assert limited['EndEpisode']==3
        media.locator(f'[data-edit-library-item="{limited["Id"]}"]').click();page.locator('#library-to-episode').fill('4');page.locator('#confirm-library-range').click();assert next(i for i in next(r for r in model()['Rows'] if r['Id']==TV)['Items'] if i['Id']==limited['Id'])['EndEpisode']==4;closemedia()
        scope=manage(COLLECTION);search(scope,'Marvel');assert page.evaluate('__queries.at(-1).includeItemTypes')=='BoxSet';scope.locator(f'[data-library-add="{BOX}"]').click();closemedia()
        scope=manage(CHRONO);search(scope,'20');assert set(page.evaluate('__queries.at(-1).includeItemTypes').split(','))=={'Movie','Series'};assert scope.locator(f'[data-library-result="{BOX}"]').count()==0;closemedia()
        scope=manage(CUSTOM);search(scope,'20');assert set(page.evaluate('__queries.at(-1).includeItemTypes').split(','))=={'Movie','Series','BoxSet'};closemedia()

        # Real gallery image paths, immutable upload URLs and parent Cancel semantics.
        board.locator(f'[data-settings-node="{NODE}"]').click();page.locator('#franchise-photos [data-open-art="poster"]').click()
        picker=page.locator('#artwork-dialog');expect(picker.locator('[data-art-asset]').first).to_be_visible();picker.locator('[data-art-filter="images"]').click();picker.locator('[data-art-asset]').first.click();page.locator('#confirm-artwork').click()
        assert not model()['Nodes'][0]['Artwork']['PrimaryUrl'];cancel(node)
        board.locator(f'[data-settings-node="{NODE}"]').click();page.locator('#franchise-photos [data-open-art="poster"]').click();picker.locator('[data-art-filter="upload"]').click();picker.locator('#art-upload').set_input_files({'name':'photo.png','mimeType':'image/png','buffer':PNG});expect(picker.locator('#confirm-artwork')).to_be_enabled();picker.locator('#confirm-artwork').click();page.locator('#save-franchise').click()
        assert model()['Nodes'][0]['Artwork']['PrimaryUrl'].startswith('/FranchiseExplorer/Artwork/Assets/') and len(uploads)==1
        board.locator(f'[data-settings-row="{MOVIES}"]').click();page.locator('#row-photos [data-open-art="poster"]').click();expect(picker.locator('[data-art-asset]').first).to_be_visible()
        assert set(picker.locator('[data-art-media-type]').evaluate_all('(els)=>els.map(e=>e.dataset.artMediaType)'))=={'Movie'};cancel(picker);cancel(rowdlg)
        board.locator(f'[data-settings-row="{CHRONO}"]').click();page.locator('#row-photos [data-open-art="poster"]').click();expect(picker.locator('[data-art-asset]').first).to_be_visible()
        assert set(picker.locator('[data-art-media-type]').evaluate_all('(els)=>els.map(e=>e.dataset.artMediaType)'))=={'Movie','Series','BoxSet'};cancel(picker);cancel(rowdlg)
        board.locator(f'[data-settings-node="{NODE}"]').click();page.locator('#franchise-photos [data-open-art="backdrop"]').click();expect(picker.locator('[data-art-asset]').first).to_be_visible()
        picker.locator('[data-art-filter="videos"]').click();picker.locator('[data-art-asset]').first.click();picker.locator('#confirm-artwork').click();page.locator('#save-franchise').click()
        assert model()['Nodes'][0]['Artwork']['BackdropVideoItemId']==TRAILER
        scope=manage(MOVIES);media.locator(f'[data-settings-item="{LINK}"]').click();page.locator('#item-photos [data-open-art="poster"]').click();expect(picker.locator('[data-art-asset]').first).to_be_visible();assert set(picker.locator('[data-art-media-id]').evaluate_all('(els)=>els.map(e=>e.dataset.artMediaId)'))=={MOVIE1};cancel(picker);cancel(page.locator('#item-dialog'));closemedia()

        # Reviewed IMDb sources preserve manual additions and group verified episodes.
        board.locator(f'[data-settings-node="{NODE}"]').click();page.locator('#franchise-auto-add').click();page.locator('#franchise-imdb-url').fill('https://www.imdb.com/list/ls123/');page.locator('#franchise-preview').click()
        review=page.locator('#review');expect(review).to_be_visible(timeout=15000);assert 'S01E01–S01E03' in review.inner_text();expect(page.locator('#review-all')).to_be_checked()
        expect(review.locator('tr').filter(has_text='Iron Man').locator('.where-cell')).not_to_contain_text('/ Movies')
        before=model();cancel(review);assert model()==before
        page.locator('#franchise-preview').click();expect(review).to_be_visible();page.locator('#apply-selected').click();expect(review).not_to_be_visible();cancel(node)
        ranges=[l for l in model()['MediaLinks'] if l['JellyfinItemId']==SHOW and l['RangeMode']=='Episodes'];assert len(ranges)==1 and ranges[0]['EndEpisode']==3
        assert any(i['JellyfinItemId']==MOVIE2 for i in next(r for r in model()['Rows'] if r['Id']==MOVIES)['Items'])
        movie_row=next(r for r in model()['Rows'] if r['Id']==MOVIES)
        assert sum(i['JellyfinItemId']==MOVIE2 for i in movie_row['Items'])+sum(l['JellyfinItemId']==MOVIE2 for l in model()['MediaLinks'] if l['Id'] in movie_row['MediaLinkIds'])==1
        page.locator('#save').click();page.wait_for_function('__saved.Nodes.some(n=>n.AutoAddSources.length)');assert page.evaluate('__saved.FutureSetting.retain')

        # Deleting a hierarchy root removes owned descendants but never calls library delete APIs.
        before=model();board.locator(f'[data-delete-node="{CHILD}"]').click();expect(page.locator('#delete-message')).to_contain_text('nested groups');cancel(page.locator('#delete-dialog'));assert model()==before
        board.locator(f'[data-delete-node="{CHILD}"]').click();page.locator('#confirm-delete').click();assert not any(n['Id'] in [CHILD,nested['Id']] for n in model()['Nodes']);page.locator('#undo').click();assert model()==before
        for width in (390,320):
            page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            aligned=board.locator('.node-head,.tree-row').evaluate_all('''els=>els.every(el=>{const buttons=[...el.querySelectorAll(':scope > .node-actions > button,:scope > .row-actions > button')];const title=el.querySelector(':scope > .node-title,:scope > .tree-name');if(!title||buttons.length!==3)return false;const r=title.getBoundingClientRect();return buttons.every(b=>{const a=b.getBoundingClientRect();return Math.abs((a.top+a.bottom-r.top-r.bottom)/2)<2&&a.right<=innerWidth+1;});})''')
            assert aligned,f'Header actions must remain on the title line at {width}px'
            board.locator(f'[data-add-row="{MOVIES}"]').click();assert media.evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth+1');closemedia()
        screenshot=Path(os.environ.get('FE_TEST_ARTIFACTS',tempfile.gettempdir()))/'settings-mobile-validation.png'
        page.screenshot(path=str(screenshot))
        # A real concurrent edit blocks persistence; JSON property order does not.
        saved=page.evaluate('JSON.stringify(__saved)')
        page.evaluate("__config.Nodes[0].Name='Changed by another administrator'")
        page.locator('#save').click();expect(page.locator('#toast')).to_contain_text('changed on the server')
        assert page.evaluate('JSON.stringify(__saved)')==saved
        assert not errors,errors
        assert all(url.startswith(('http://jellyfin.test/','blob:http://jellyfin.test/','data:')) for url in requests),requests
        browser.close();print('PASS production settings: compatible persistence, hierarchy drafts, live search/types/ranges, immutable artwork uploads/scopes, IMDb review/grouping, deletion/Undo and mobile layout')

if __name__=='__main__':run()
