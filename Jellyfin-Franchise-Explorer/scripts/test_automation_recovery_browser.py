#!/usr/bin/env python3
"""Exercise the generated production settings page against authenticated server API fixtures."""
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json
import runpy

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = runpy.run_path(str(ROOT / 'scripts/build_settings_page.py'))['generate']()
gid = lambda value: f'{value:032x}'
NODE, ROW, REF, MEDIA, SHOW, NEW, WRONG = [gid(value) for value in range(1, 8)]
TVREF, IMPORT_KEEP, IMPORT_SKIP = [gid(value) for value in (11, 20, 21)]
LIBRARY = [
    dict(Id=MEDIA, Name='Existing movie', Type='Movie', ProductionYear=2001, ProviderIds={'Imdb': 'tt100'}),
    dict(Id=SHOW, Name='Range show', Type='Series', ProductionYear=2002, ProviderIds={'Imdb': 'tt140'}),
    dict(Id=IMPORT_KEEP, Name='Keep imported movie', Type='Movie', ProductionYear=2003, ProviderIds={'Imdb': 'tt120'}),
    dict(Id=IMPORT_SKIP, Name='Skip imported movie', Type='Movie', ProductionYear=2004, ProviderIds={'Imdb': 'tt121'}),
    *[dict(Id=gid(30 + number), Name=f'Episode {number}', Type='Episode', SeriesId=SHOW,
           ParentIndexNumber=1, IndexNumber=number, ProviderIds={'Imdb': f'tt14{number}'}) for number in (1, 2, 3)],
]
REGISTRY = [
    ('The Matrix', 'ls579565194'), ('Pirates Of The Caribbean', 'ls526615193'),
    ('Indiana Jones', 'ls526781175'), ('Terminator', 'ls024885449'),
    ('Transformers', 'ls592604450'), ('Men In Black', 'ls4104275763'),
    ('Marvel Cinematic Universe', 'ls539646485'), ('Alien', 'ls087871200'),
    ('The MonsterVerse', 'ls521872135'), ('Jurassic Park', 'ls539977081'),
    ('Star Wars', 'ls072034866'),
]


def lower(value):
    if isinstance(value, list):
        return [lower(entry) for entry in value]
    if isinstance(value, dict):
        return {key[0].lower() + key[1:]: lower(entry) for key, entry in value.items()}
    return value


def upper(value):
    if isinstance(value, list):
        return [upper(entry) for entry in value]
    if isinstance(value, dict):
        return {key[0].upper() + key[1:]: upper(entry) for key, entry in value.items()}
    return value


def config_fixture():
    registry = [dict(Id=gid(100 + index), Name=name, Url=f'https://www.imdb.com/list/{source}/',
                     Enabled=True, FranchiseNodeId=NODE if index == 0 else '', EpisodeFormat='Bundles',
                     Deleted=False, Rows=[]) for index, (name, source) in enumerate(REGISTRY)]
    rules = [dict(Id=gid(200 + index), RegistrationId=registry[0]['Id'], FranchiseNodeId=NODE,
                  RowId=ROW, Scope='Episode', ProviderName='Imdb', ProviderId='ttshow',
                  JellyfinItemId=SHOW, StartSeason=1, EndSeason=1, StartEpisode=index + 1,
                  EndEpisode=index + 1, Enabled=True, Reason=f'Skipped episode {index + 1}') for index in range(2)]
    pending = [dict(Id='held-episode', RegistrationId=registry[0]['Id'], FranchiseNodeId=NODE,
                    FranchiseName='The Matrix', Kind='Restore', Status='Pending', Safe=False,
                    Title='Protected episode', ItemType='Episode', ItemId=MEDIA, SeriesId=SHOW,
                    ProviderId='ttepisode', SeriesProviderId='ttshow', RowKind='Chronological Order',
                    RowId=ROW, ReferenceId=REF, SourceUrl=registry[0]['Url'], SourcePosition=3,
                    Reason='Episode excluded by you', Existing='Episode 1 skipped',
                    Proposed='Restore Episode 1 to Chronological Order', ExclusionIds=[rules[0]['Id']],
                    EpisodeIds=[MEDIA], StartSeason=1, EndSeason=1, StartEpisode=1, EndEpisode=1)]
    registry[1]['Deleted'] = True
    pending.append(dict(Id='deleted-franchise', RegistrationId=registry[1]['Id'], FranchiseNodeId=gid(90),
                        FranchiseName=registry[1]['Name'], Kind='Restore', Status='Pending', Safe=False,
                        Title='Deleted franchise movie', ItemType='Movie', SourceUrl=registry[1]['Url'],
                        SourcePosition=1, Reason='This franchise was deleted manually.', ExclusionIds=[]))
    return dict(NavigationLabel='Franchises', ConfigurationRevision=1, FutureField={'preserved': True}, ImdbLists=[],
                Nodes=[dict(Id=NODE, ParentId='', Name='Existing franchise', NodeType='Franchise',
                            Overview='', SortOrder=0, Artwork={}, AutoAddSources=[], AutoAddRows=[], AutoAddRecords=[])],
                Rows=[dict(Id=ROW, ParentNodeId=NODE, Name='Chronological Order', Category='Chronological Timeline',
                           RowType='Timeline', SortOrder=0, Items=[
                               dict(Id=REF, JellyfinItemId=MEDIA, DisplayName='Existing movie', ItemType='Movie',
                                    RangeMode='Full', Identity={'ProviderIds': [{'Name': 'Imdb', 'Value': 'tt100'}]}),
                               dict(Id=TVREF, JellyfinItemId=SHOW, DisplayName='Range show', ItemType='Series',
                                    RangeMode='Full', Identity={'ProviderIds': [{'Name': 'Imdb', 'Value': 'tt140'}]}),
                           ], NodeIds=[], MediaLinkIds=[], MediaOrder=[REF, TVREF])],
                MediaLinks=[], MediaRecovery=dict(Enabled=True, AutoReconnect=True),
                AutoFranchises=dict(Enabled=False, Registry=registry, Exclusions=rules,
                                    PendingChanges=pending, Ownership=[], LastRun=None, LastCompletedLocalDay=''))


BOOT = """
window.ApiClient = {
 getCurrentUserId:()=> 'admin', accessToken:()=> 'fixture-token',
 getCurrentUser:async()=>({Policy:{IsAdministrator:true},Configuration:{}}),
 getPluginConfiguration:async()=>{const r=await fetch('/emby/MockConfiguration',{headers:{Authorization:'MediaBrowser Token="fixture-token"'}});return r.json();},
 updatePluginConfiguration:async(_id,config)=>{const r=await fetch('/emby/MockConfiguration',{method:'POST',headers:{Authorization:'MediaBrowser Token="fixture-token"','Content-Type':'application/json'},body:JSON.stringify(config)});if(!r.ok)throw Error('Save failed');},
 getUrl:(route,query)=>{const u=new URL(route.replace(/^\\//,''),location.origin+'/emby/');for(const[k,v]of Object.entries(query||{}))u.searchParams.set(k,v);return u.href;},
 getItems:async(_user,query)=>{let all=window.__library.filter(item=>(query.includeItemTypes||'Movie,Series,BoxSet').split(',').includes(item.Type));if(query.searchTerm)all=all.filter(item=>item.Name.toLowerCase().includes(query.searchTerm.toLowerCase()));return {Items:structuredClone(all.slice(query.startIndex||0,(query.startIndex||0)+(query.limit||40))),TotalRecordCount:all.length};},
 getItem:async(_user,id)=>structuredClone(window.__library.find(item=>item.Id===id)||{Id:id,Name:'Media',Type:'Movie'})
};
"""


def run():
    state = dict(config=config_fixture(), fingerprint=1, requests=[], writes=[], error='', hold_run=False, held=None,
                 source=[dict(imdbId='tt120', title='Keep imported movie', type='Movie', year=2003, position=1),
                         dict(imdbId='tt121', title='Skip imported movie', type='Movie', year=2004, position=2)])
    recovery = dict(revision='configuration-1', libraryRevision='library-1', libraryHealthy=True,
                    enabled=True, autoReconnect=True, checkedUtc='2026-11-09T00:10:00Z', message='Three references need review.', entries=[
        dict(referenceId=REF, rowId=ROW, nodeId=NODE, oldItemId=MEDIA, title='Verified replacement', itemType='Movie',
             status='Verified', reason='Stable IMDb identity matches.', candidates=[
                 dict(itemId=NEW, title='Actual replacement', itemType='Movie', year=2025,
                      providerIds=[dict(name='Imdb', value='ttverified')], verified=True)]),
        dict(referenceId='ambiguous-ref', rowId=ROW, nodeId=NODE, oldItemId=MEDIA, title='Ambiguous movie', itemType='Movie',
             status='Ambiguous', reason='Two actual library items share an identity.', candidates=[
                 dict(itemId=WRONG, title='First actual candidate', itemType='Movie', year=2000, providerIds=[], verified=False),
                 dict(itemId=gid(8), title='Second actual candidate', itemType='Movie', year=2001, providerIds=[], verified=False)]),
        dict(referenceId='missing-ref', rowId=ROW, nodeId=NODE, oldItemId=MEDIA, title='Missing movie', itemType='Movie',
             status='Missing', reason='No current media has this identity.', candidates=[]),
    ])

    def status():
        return dict(settings=lower(state['config']['AutoFranchises']), fingerprint=f"fp-{state['fingerprint']}",
                    running=False, serverTimeZone='Europe/London', schedule='Daily at 00:00 server local time')

    def changed():
        state['fingerprint'] += 1
        state['config']['ConfigurationRevision'] += 1

    def finish_run(route):
        state['config']['AutoFranchises']['LastRun'] = dict(Status='Completed', StartedUtc='2026-11-09T00:00:00Z',
            CompletedUtc='2026-11-09T00:01:00Z', Message='Server completed the configured registry.', Added=1, Held=1, Errors=0)
        changed()
        route.fulfill(json=lower(state['config']['AutoFranchises']['LastRun']))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
                                    args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1280, 'height': 1050})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route(request):
            parsed = urlsplit(request.request.url)
            path = parsed.path
            if path == '/settings':
                boot = 'window.__library=' + json.dumps(LIBRARY) + ';' + BOOT
                request.fulfill(content_type='text/html', body=HTML.replace('<script type="text/javascript">', '<script>' + boot + '</script><script type="text/javascript">', 1))
                return
            if path.startswith('/emby/'):
                assert request.request.headers.get('authorization') == 'MediaBrowser Token="fixture-token"', path
            state['requests'].append((request.request.method, path))
            if request.request.method == 'POST':
                state['writes'].append(path)
            if path == '/emby/MockConfiguration':
                if request.request.method == 'POST':
                    state['config'] = request.request.post_data_json
                    changed()
                request.fulfill(json=state['config'])
                return
            if path.endswith('/Automation/Status'):
                request.fulfill(json=status())
                return
            if path.endswith('/Recovery/Status'):
                request.fulfill(json=recovery)
                return
            if path.endswith('/AutoAdd/Source'):
                request.fulfill(json={'entries': state['source'], 'orderVerified': True})
                return
            if path.endswith('/Automation/Settings'):
                body = request.request.post_data_json
                if body['expectedFingerprint'] != status()['fingerprint']:
                    request.fulfill(status=409, json={'error': 'Configuration changed. Reload settings.'})
                    return
                old = {entry['Id']: entry for entry in state['config']['AutoFranchises']['Registry']}
                registry = []
                for index, entry in enumerate(body['registry']):
                    entry = upper(entry)
                    entry['Id'] = entry.get('Id') or gid(500 + index)
                    registry.append({**old.get(entry['Id'], {}), **entry})
                state['config']['AutoFranchises'].update(Enabled=body['enabled'], Registry=registry)
                changed()
                request.fulfill(json=status())
                return
            if path.endswith('/Automation/Preview'):
                auto = state['config']['AutoFranchises']
                request.fulfill(json=dict(fingerprint=status()['fingerprint'], message='Preview complete.', plans=[dict(
                    registrationId=auto['Registry'][0]['Id'], franchiseName='The Matrix', sourceFailed=False,
                    safeAdditions=[dict(id='safe-show', title='Verified show', rowKind='TV Shows'), dict(id='safe-movie', title='Verified movie', rowKind='Movies'),
                                   dict(id='safe-episode', title='Verified episode', rowKind='Chronological Order')],
                    pending=lower([entry for entry in auto['PendingChanges'] if entry['Status'] == 'Pending']),
                    missing=[dict(title='Unavailable movie', reason='No current library match')])]))
                return
            if path.endswith('/Automation/Run'):
                if state['error']:
                    request.fulfill(status=503, json={'error': state['error']})
                elif state['hold_run']:
                    state['held'] = request
                else:
                    finish_run(request)
                return
            if path.endswith('/Automation/Decision'):
                body = request.request.post_data_json
                assert body['expectedFingerprint'] == status()['fingerprint']
                if body.get('registrationIds'):
                    assert body['registrationIds'] == [state['config']['AutoFranchises']['Registry'][0]['Id']]
                    state['preview_applied'] = body['changeIds']
                auto = state['config']['AutoFranchises']
                for entry in auto['PendingChanges']:
                    if entry['Id'] in body.get('changeIds', []):
                        entry['Status'] = 'Kept' if body['decision'] == 'Keep' else 'Applied'
                if body['decision'] == 'Restore':
                    for entry in auto['Exclusions']:
                        if entry['Id'] in body.get('exclusionIds', []):
                            entry['Enabled'] = False
                changed()
                request.fulfill(json=status())
                return
            if path.endswith('/Recovery/Check'):
                recovery['checkedUtc'] = '2026-11-09T02:00:00Z'
                request.fulfill(json=recovery)
                return
            if path.endswith('/Recovery/Candidates'):
                query = parse_qs(parsed.query)
                assert query['revision'] == [recovery['revision']]
                assert query['libraryRevision'] == [recovery['libraryRevision']]
                request.fulfill(json=[dict(itemId=gid(9), title='Located actual media', itemType='Movie', year=2026, providerIds=[], verified=False)])
                return
            if path.endswith('/Recovery/Apply'):
                body = request.request.post_data_json
                assert body['revision'] == recovery['revision']
                assert body['libraryRevision'] == recovery['libraryRevision']
                state['recovery_applied'] = body['choices']
                for entry in recovery['entries']:
                    if any(choice['referenceId'] == entry['referenceId'] for choice in body['choices']):
                        entry['status'] = 'Healthy'
                request.fulfill(json=recovery)
                return
            request.fulfill(status=404)

        page.route('http://jellyfin.test/**', route)
        page.goto('http://jellyfin.test/settings')
        page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
        expect(page.locator('#automation-notice')).to_be_visible()
        assert not page.locator('#advanced').evaluate('(element)=>element.open')
        page.locator('#automation-notice-review').click()
        inbox = page.locator('#auto-inbox-dialog')
        expect(inbox).to_be_visible()
        expect(inbox.locator('[data-auto-change]').first).not_to_be_checked()
        expect(inbox.locator('[data-auto-change]').first).to_be_disabled()
        expect(inbox.locator('[data-auto-change]').nth(1)).not_to_be_checked()
        expect(inbox).to_contain_text('restores the entire deleted franchise for future midnight updates')
        expect(inbox.locator('[data-auto-open-rules]')).to_be_visible()
        expect(inbox).to_contain_text('Episode 1 skipped')
        expect(inbox).to_contain_text('Restore Episode 1 to Chronological Order')
        expect(inbox).to_contain_text('Episode excluded by you')
        assert inbox.locator('a').first.get_attribute('href') == REGISTRY[0][1].join(['https://www.imdb.com/list/', '/'])
        page.locator('#auto-keep-choices').click()
        expect(page.locator('#auto-inbox-list')).to_contain_text('No pending changes')
        expect(page.locator('#automation-notice')).to_be_hidden()
        inbox.get_by_role('button', name='Close', exact=True).click()

        page.locator('#settings > summary').click()
        page.locator('#advanced > summary').click()
        expect(page.locator('#auto-enabled')).not_to_be_checked()
        expect(page.locator('#auto-schedule')).to_contain_text('12:00 AM')
        expect(page.locator('#auto-schedule')).to_contain_text('Europe/London')
        page.locator('#auto-manage').click()
        expect(page.locator('.automation-registry-entry')).to_have_count(11)
        assert page.locator('.automation-entry-summary strong').all_text_contents() == [entry[0] for entry in REGISTRY]
        assert page.locator('.automation-entry-summary a').evaluate_all('(elements)=>elements.map(element=>element.href)') == [f'https://www.imdb.com/list/{entry[1]}/' for entry in REGISTRY]

        # CRUD targets the actual existing franchise and persists format on the server.
        page.locator('[data-auto-edit]').first.click()
        page.locator('#auto-entry-mode').select_option('Individual')
        page.locator('#auto-entry-target').select_option(NODE)
        page.locator('#auto-entry-save').click()
        expect(page.locator('#auto-entry-dialog')).not_to_be_visible()
        assert state['config']['AutoFranchises']['Registry'][0]['EpisodeFormat'] == 'Individual'
        page.locator('#auto-add-entry').click()
        page.locator('#auto-entry-name').fill('Added explicitly')
        page.locator('#auto-entry-url').fill('https://www.imdb.com/list/ls999/')
        page.locator('#auto-entry-target').select_option(NODE)
        page.locator('#auto-entry-save').click()
        expect(page.locator('.automation-registry-entry')).to_have_count(12)
        page.locator('[data-auto-remove]').last.click()
        expect(page.locator('.automation-registry-entry')).to_have_count(11)
        assert len(state['config']['Nodes']) == 1

        # All registry actions remain inline and reachable on 320px and 390px screens.
        for width in (320, 390):
            page.set_viewport_size({'width': width, 'height': 850})
            actions = page.locator('.automation-actions').first
            expect(actions.locator('button')).to_have_count(2)
            boxes = [actions.locator('label').bounding_box(), *[element.bounding_box() for element in actions.locator('button').all()]]
            assert max(box['y'] for box in boxes) - min(box['y'] for box in boxes) < 15
            assert all(box['x'] >= 0 and box['x'] + box['width'] <= width + 1 for box in boxes)
        page.set_viewport_size({'width': 1280, 'height': 1050})
        page.locator('#auto-registry-dialog').get_by_role('button', name='Done', exact=True).click()

        page.locator('#auto-enabled').check()
        page.wait_for_function('document.querySelector("#auto-enabled").checked && !document.querySelector("#auto-run").disabled')
        assert state['config']['AutoFranchises']['Enabled'] is True
        page.locator('#auto-preview').click()
        expect(page.locator('#auto-preview-results')).to_contain_text('TV Shows')
        expect(page.locator('#auto-preview-results')).to_contain_text('Movies')
        expect(page.locator('#auto-preview-results')).to_contain_text('Chronological Order')
        expect(page.locator('#auto-preview-results')).to_contain_text('Unavailable movie')
        page.locator('#auto-preview-dialog').get_by_role('button', name='Close', exact=True).click()
        page.locator('#auto-run').click()
        expect(page.locator('#auto-run-status')).to_contain_text('Server completed the configured registry.')
        expect(page.locator('#automation-notice')).to_be_hidden()  # Kept proposal is not reannounced.

        page.locator('#auto-manage-choices').click()
        expect(page.locator('[data-auto-rule]')).to_have_count(2)
        expect(page.locator('[data-auto-rule]').first).not_to_be_checked()
        page.locator('[data-auto-rule]').first.check()
        page.locator('#auto-restore-rules').click()
        expect(page.locator('[data-auto-rule]')).to_have_count(1)
        assert state['config']['AutoFranchises']['Exclusions'][0]['Enabled'] is False
        assert state['config']['AutoFranchises']['Exclusions'][1]['Enabled'] is True
        page.locator('#auto-choices-dialog').get_by_role('button', name='Close', exact=True).click()

        # Selective preview application works while the midnight opt-in remains off.
        page.locator('#auto-enabled').uncheck()
        page.wait_for_function('!document.querySelector("#auto-enabled").checked && !document.querySelector("#auto-preview").disabled')
        page.locator('#auto-preview').click()
        expect(page.locator('[data-auto-preview-change]:checked')).to_have_count(3)
        page.locator('[data-auto-preview-change="safe-show"]').uncheck()
        page.locator('[data-auto-preview-change="safe-episode"]').uncheck()
        rules_before_preview_apply = deepcopy(state['config']['AutoFranchises']['Exclusions'])
        page.locator('#auto-preview-apply').click()
        expect(page.locator('#auto-preview-dialog')).not_to_be_visible()
        assert state['preview_applied'] == ['safe-movie']
        assert state['config']['AutoFranchises']['Enabled'] is False
        assert state['config']['AutoFranchises']['Exclusions'] == rules_before_preview_apply

        # Recovery includes verified, ambiguous and missing identities; apply exact selected item IDs.
        page.locator('#recovery-check').click()
        expect(page.locator('#recovery-dialog')).to_be_visible()
        results = page.locator('#recovery-results')
        for text in ('Verified replacement', 'Ambiguous', 'Missing movie'):
            expect(results).to_contain_text(text)
        results.locator('[data-recovery-choice]').first.select_option(NEW)
        results.locator('[data-recovery-choice]').nth(1).select_option(gid(8))
        page.locator('#recovery-apply').click()
        expect(results.locator('[data-recovery-choice]')).to_have_count(1)
        assert state['recovery_applied'] == [dict(referenceId=REF, itemId=NEW), dict(referenceId='ambiguous-ref', itemId=gid(8))]
        results.locator('[data-recovery-query]').fill('Located actual media')
        results.locator('[data-recovery-search]').click()
        expect(results).to_contain_text('Located actual media')
        results.locator('[data-recovery-choice]').select_option(gid(9))
        page.locator('#recovery-apply').click()
        expect(results).to_contain_text('No unresolved media references.')
        page.locator('#recovery-dialog').get_by_role('button', name='Close', exact=True).click()
        expect(page.locator('#recovery-status')).to_contain_text('Last check:')

        # Real main-controller removals create durable row-scoped exclusions only after confirmation.
        page.locator('#franchises > summary').click()
        board = page.locator('#board')
        board.locator(f'[data-expand="{NODE}"]').click()
        board.locator(f'[data-add-row="{ROW}"]').click()
        media = page.locator('#media-dialog')
        before_rules = deepcopy(page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions'))
        media.locator(f'[data-remove-item="{REF}"]').click()
        page.locator('#delete-dialog').get_by_role('button', name='Cancel', exact=True).click()
        assert page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') == before_rules
        media.locator(f'[data-remove-item="{REF}"]').click()
        page.locator('#confirm-delete').click()
        movie_rules = [entry for entry in page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') if entry['ProviderId'] == 'tt100']
        assert len(movie_rules) == 1 and movie_rules[0]['RowId'] == ROW and movie_rules[0]['Scope'] == 'Movie'
        media.get_by_role('button', name='Done', exact=True).click()
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')
        page.locator('#reset').click()
        page.wait_for_function('(id)=>!FranchiseSettings.getModel().Rows.find(row=>row.Id===id).Items.some(item=>item.ItemType==="Movie")', arg=ROW)
        assert any(entry['ProviderId'] == 'tt100' for entry in state['config']['AutoFranchises']['Exclusions'])

        # Successive explicit range edits replace only that range's rule and preserve its stable ID.
        board.locator(f'[data-add-row="{ROW}"]').click()
        for last_episode in (2, 3):
            media.locator(f'[data-edit-library-item="{TVREF}"]').click()
            page.locator('#library-range-mode').select_option('episodes')
            page.locator('#library-from-season').fill('1')
            page.locator('#library-to-season').fill('1')
            page.locator('#library-from-episode').fill('1')
            page.locator('#library-to-episode').fill(str(last_episode))
            page.locator('#confirm-library-range').click()
            range_rules = [entry for entry in page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') if entry['Scope'] == 'AllowedRange']
            assert len(range_rules) == 1 and range_rules[0]['EndEpisode'] == last_episode
            if last_episode == 2:
                stable_range_id = range_rules[0]['Id']
            else:
                assert range_rules[0]['Id'] == stable_range_id
        assert all(any(entry['Id'] == old['Id'] for entry in page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions')) for old in before_rules)
        media.get_by_role('button', name='Done', exact=True).click()
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')

        # Cancelled review never stores skips; only deliberately unchecked additions on Apply do.
        board.locator(f'[data-settings-node="{NODE}"]').click()
        page.locator('#franchise-auto-add').click()
        page.locator('#franchise-imdb-url').fill('https://www.imdb.com/list/ls123/')
        page.locator('#franchise-preview').click()
        review = page.locator('#review')
        expect(review).to_be_visible()
        before_rules = deepcopy(page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions'))
        for checkbox in review.locator('tr').filter(has_text='Skip imported movie').locator('[data-review-cell]').all():
            checkbox.uncheck()
        review.get_by_role('button', name='Cancel', exact=True).click()
        assert page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') == before_rules
        page.locator('#franchise-preview').click()
        expect(review).to_be_visible()
        for checkbox in review.locator('tr').filter(has_text='Skip imported movie').locator('[data-review-cell]').all():
            checkbox.uncheck()
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        skipped = [entry for entry in page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') if entry['ProviderId'] == 'tt121']
        assert skipped and all(entry['Scope'] == 'Movie' and entry['RowId'] for entry in skipped)
        assert not any(entry['ProviderId'] == 'tt120' for entry in page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions'))
        page.locator('#franchise-dialog').get_by_role('button', name='Cancel', exact=True).click()
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')
        assert any(entry['ProviderId'] == 'tt121' for entry in state['config']['AutoFranchises']['Exclusions'])

        # A refused bundle removal deselects its dependent episode additions without creating skips.
        state['source'] = [dict(imdbId=f'tt14{number}', title=f'Episode {number}', type='Episode', position=number) for number in (1, 2, 3)]
        page.locator('#add-franchise').click()
        page.locator('#new-name').fill('Dependency review')
        page.locator('#create-manual').click()
        dependency_node = next(node['Id'] for node in page.evaluate('FranchiseSettings.getModel().Nodes') if node['Name'] == 'Dependency review')
        board.locator(f'[data-settings-node="{dependency_node}"]').click()
        page.locator('#franchise-auto-add').click()
        page.locator('#franchise-imdb-url').fill('https://www.imdb.com/list/ls456/')
        page.locator('#franchise-preview').click()
        expect(review).to_be_visible()
        page.locator('#apply-selected').click()
        page.locator('#franchise-dialog').get_by_role('button', name='Cancel', exact=True).click()
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')
        board.locator(f'[data-settings-node="{dependency_node}"]').click()
        page.locator('#franchise-auto-add').click()
        page.locator('#franchise-episode-format').select_option('Individual')
        page.locator('#franchise-preview').click()
        expect(review).to_be_visible()
        removals = review.locator('tr').filter(has=page.locator('.change-pill.remove')).locator('[data-review-cell]')
        assert removals.count() > 0
        before_dependencies = deepcopy(page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions'))
        for checkbox in removals.all():
            checkbox.uncheck()
        dependent_adds = review.locator('tr').filter(has=page.locator('.change-pill.add')).locator('[data-review-cell]')
        assert dependent_adds.count() > 0
        for checkbox in dependent_adds.all():
            expect(checkbox).not_to_be_checked()
        page.locator('#apply-selected').click()
        expect(review).not_to_be_visible()
        assert page.evaluate('FranchiseSettings.getModel().AutoFranchises.Exclusions') == before_dependencies
        page.locator('#franchise-dialog').get_by_role('button', name='Cancel', exact=True).click()
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')

        # Local drafts block server mutations, and plugin saves preserve all protected fields.
        page.locator('#add-franchise').click()
        page.locator('#new-name').fill('Unsaved local draft')
        page.locator('#create-manual').click()
        count = len(state['writes'])
        page.locator('#auto-run').click()
        expect(page.locator('#automation-error')).to_contain_text('Save or reload')
        assert len(state['writes']) == count
        assert any(node['Name'] == 'Unsaved local draft' for node in page.evaluate('FranchiseSettings.getModel().Nodes'))
        page.locator('#save').click()
        expect(page.locator('#save-state')).to_have_text('All changes saved')
        assert state['config']['FutureField']['preserved']
        assert len(state['config']['AutoFranchises']['Registry']) == 11
        assert state['config']['AutoFranchises']['Exclusions'][1]['Enabled'] is True

        # A source/server failure does not reload or drop the current saved configuration.
        state['error'] = 'IMDb source unavailable. Existing franchise preserved.'
        before = deepcopy(state['config'])
        page.locator('#auto-run').click()
        expect(page.locator('#automation-error')).to_contain_text('IMDb source unavailable')
        assert state['config'] == before
        state['error'] = ''

        # New edits made while a server run is in flight survive its completion.
        state['hold_run'] = True
        page.locator('#auto-run').click()
        page.wait_for_timeout(80)
        assert state['held'] is not None
        page.locator('#add-franchise').click()
        page.locator('#new-name').fill('Draft during server run')
        page.locator('#create-manual').click()
        finish_run(state['held'])
        expect(page.locator('#automation-error')).to_contain_text('Your unsaved edits were kept')
        assert any(node['Name'] == 'Draft during server run' for node in page.evaluate('FranchiseSettings.getModel().Nodes'))
        assert not any(node['Name'] == 'Draft during server run' for node in state['config']['Nodes'])
        page.locator('#save').click()
        expect(page.locator('#toast')).to_contain_text('The saved configuration changed on the server')
        assert not any(node['Name'] == 'Draft during server run' for node in state['config']['Nodes'])
        assert not errors, errors
        browser.close()
    print('Automation/recovery browser checks passed: authenticated API, registry CRUD, inbox, selected restores, recovery, mobile and draft protection.')


if __name__ == '__main__':
    run()
