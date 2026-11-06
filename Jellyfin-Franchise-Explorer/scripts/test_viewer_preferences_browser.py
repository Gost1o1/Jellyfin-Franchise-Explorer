"""Exercise viewer preference switches in the generated production settings page."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('settings_builder', ROOT / 'scripts/build_settings_page.py')
builder = module_from_spec(spec)
spec.loader.exec_module(builder)
HTML = builder.generate()
SERVER = 'a1111111-b111-4111-8111-c11111111111'
USER = 'd2222222-e222-4222-8222-f22222222222'
OTHER_SERVER = '33333333-3333-4333-8333-333333333333'
OTHER_USER = '44444444-4444-4444-8444-444444444444'
compact = lambda value: value.replace('-', '')
subtitle_key = lambda server, user: 'fe-subtitles:' + server + ':' + user
language_key = lambda server, user: 'fe-subtitle-language:' + server + ':' + user
native_key = lambda user: 'fe-show-active-native-rows:http://jellyfin.test:' + user

BOOT = r'''
window.__options = OPTIONS;
window.__uid = __options.uid;
window.__events = [];
window.__profileResolvers = [];
window.__denyWrites = false;
window.__denyKey = '';
if (!localStorage.getItem('viewer-preference-test-seeded')) {
  if (__options.servers !== null)
    localStorage.setItem('jellyfin_credentials', JSON.stringify({Servers: __options.servers}));
  for (const [key, value] of Object.entries(__options.values || {})) localStorage.setItem(key, value);
  localStorage.setItem('viewer-preference-test-seeded', '1');
}
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(key, value) {
  if ((window.__denyWrites && key.startsWith('fe-')) || key === window.__denyKey)
    throw new DOMException('Browser storage is unavailable', 'QuotaExceededError');
  return originalSetItem.call(this, key, value);
};
window.addEventListener('franchise-subtitles-changed', event => {
  const stored = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key.startsWith('fe-')) stored[key] = localStorage.getItem(key);
  }
  window.__events.push({detail: event.detail, stored,
    checked: document.querySelector('#subtitles').getAttribute('aria-checked')});
});
const profile = () => ({Id: __options.profileId, Configuration: {SubtitleLanguagePreference: 'deu'}});
window.__resolveProfiles = () => {
  for (const resolve of window.__profileResolvers.splice(0)) resolve(profile());
};
window.ApiClient = {
  getCurrentUserId: () => window.__uid,
  accessToken: () => 'test-token',
  serverId: () => __options.serverInfoOnly ? null : __options.serverId,
  serverInfo: () => ({Id: __options.serverId}),
  getCurrentUser: () => __options.deferProfile
    ? new Promise(resolve => window.__profileResolvers.push(resolve)) : Promise.resolve(profile()),
  getPluginConfiguration: async () => ({Nodes: [], Rows: [], MediaLinks: []}),
  updatePluginConfiguration: async () => {},
  getUrl: route => location.origin + '/emby/' + route,
  getItems: async () => ({Items: [], TotalRecordCount: 0})
};
'''


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
            args=['--no-sandbox'])
        errors = []

        def open_case(**overrides):
            options = dict(uid=USER, serverId=SERVER, profileId=USER, deferProfile=False,
                servers=[dict(Id=SERVER, UserId=USER, AccessToken='test-token',
                              LocalAddress='http://jellyfin.test')],
                values={subtitle_key(SERVER, USER): '1'})
            options.update(overrides)
            context = browser.new_context(viewport={'width': 390, 'height': 850},
                                          is_mobile=True, has_touch=True)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            boot = BOOT.replace('OPTIONS', json.dumps(options), 1)
            page.route('http://jellyfin.test/**', lambda route: route.fulfill(
                content_type='text/html', body=HTML.replace('<script type="text/javascript">',
                    '<script>' + boot + '</script><script type="text/javascript">', 1)))
            page.goto('http://jellyfin.test/settings')
            page.wait_for_function('window.FranchiseSettings && !document.querySelector("#save").disabled')
            return context, page

        def storage(page, key):
            return page.evaluate('(key) => localStorage.getItem(key)', key)

        def expect_enabled(page, on=True):
            expect(page.locator('#subtitles')).to_be_enabled()
            expect(page.locator('#subtitles')).to_have_attribute('aria-checked', str(on).lower())
            expect(page.locator('#subtitles .switch-label')).to_have_text('On' if on else 'Off')
            (expect(page.locator('#language')).to_be_enabled if on else
             expect(page.locator('#language')).to_be_disabled)()

        # Reproduce the reported direction: start On, then disable using the setting label.
        context, page = open_case()
        page.locator('#settings > summary').click()
        expect_enabled(page)
        page.locator('#subtitles-label').click()
        expect_enabled(page, False)
        assert storage(page, subtitle_key(SERVER, USER)) == '0'
        events = page.evaluate('__events')
        assert len(events) == 1 and events[0]['checked'] == 'false'
        assert events[0]['stored'][subtitle_key(SERVER, USER)] == '0'
        assert events[0]['detail'] == {'serverId': SERVER, 'userId': USER}
        page.locator('#subtitles').click()
        expect_enabled(page)
        page.locator('#subtitles').click()
        expect_enabled(page, False)
        assert page.evaluate('__events.length') == 3, 'Each label/button click must toggle exactly once'
        page.reload()
        expect_enabled(page, False)
        context.close()

        # Compact, hyphenated and case-varied account aliases identify the same preference.
        cs, cu = compact(SERVER), compact(USER)
        values = {subtitle_key(cs, cu): '1', subtitle_key(SERVER.upper(), USER.upper()): '1',
                  language_key(cs, cu): 'fr', native_key(USER): '1', native_key(cu): '1',
                  subtitle_key(cs, OTHER_USER): '1'}
        context, page = open_case(servers=[dict(Id=cs, UserId=cu, AccessToken='test-token',
            LocalAddress='http://jellyfin.test')], values=values)
        page.locator('#settings > summary').click()
        expect_enabled(page)
        expect(page.locator('#language')).to_have_value('fr')
        page.locator('#subtitles').click()
        expect_enabled(page, False)
        assert storage(page, subtitle_key(cs, cu)) == '0'
        assert storage(page, subtitle_key(SERVER.upper(), USER.upper())) == '0'
        assert storage(page, subtitle_key(cs, OTHER_USER)) == '1'
        page.locator('#hide-label').click()
        assert storage(page, native_key(cu)) == storage(page, native_key(USER)) == '0'
        page.locator('#subtitles').click()
        page.locator('#language').select_option('de')
        assert storage(page, language_key(cs, cu)) == 'de'
        context.close()

        # The active API account works without the optional cached credential record.
        for info_only in [False, True]:
            context, page = open_case(servers=None, serverInfoOnly=info_only)
            page.locator('#settings > summary').click()
            expect_enabled(page)
            page.locator('#subtitles').click()
            expect_enabled(page, False)
            assert storage(page, subtitle_key(SERVER, USER)) == '0'
            context.close()

        # An old server on the same origin must not win over the current API server ID.
        values = {subtitle_key(cs, cu): '1', subtitle_key(OTHER_SERVER, USER): '1',
                  subtitle_key(SERVER, OTHER_USER): '1'}
        context, page = open_case(servers=[dict(Id=OTHER_SERVER, UserId=USER,
            LocalAddress='http://jellyfin.test')], values=values)
        page.locator('#settings > summary').click()
        expect_enabled(page)
        page.locator('#subtitles').click()
        expect_enabled(page, False)
        assert storage(page, subtitle_key(SERVER, USER)) == '0'
        assert storage(page, subtitle_key(cs, cu)) == '0'
        assert storage(page, subtitle_key(OTHER_SERVER, USER)) == '1'
        assert storage(page, subtitle_key(SERVER, OTHER_USER)) == '1'
        context.close()

        # Recover from delayed API identity on pageshow, opening Settings, or profile resolution.
        for trigger in ['pageshow', 'open', 'profile']:
            context, page = open_case(uid='', deferProfile=True)
            expect(page.locator('#subtitles')).to_be_disabled()
            if trigger == 'profile':
                page.evaluate('__resolveProfiles()')
            else:
                page.evaluate('(uid) => window.__uid = uid', USER)
                if trigger == 'pageshow':
                    page.evaluate('document.querySelector("#FranchiseExplorerConfigPage").dispatchEvent(new Event("pageshow"))')
                else:
                    page.locator('#settings > summary').click()
            expect_enabled(page)
            if trigger != 'open':
                page.locator('#settings > summary').click()
            page.locator('#subtitles').click()
            expect_enabled(page, False)
            assert storage(page, subtitle_key(SERVER, USER)) == '0'
            context.close()

        # A denied write reports a recoverable error and retains the old On state.
        context, page = open_case()
        page.locator('#settings > summary').click()
        expect_enabled(page)
        page.evaluate('window.__denyWrites = true')
        page.locator('#subtitles').click()
        expect(page.locator('#toast')).to_contain_text('Could not save viewer preferences')
        expect_enabled(page)
        assert storage(page, subtitle_key(SERVER, USER)) == '1'
        assert page.evaluate('__events.length') == 0
        page.evaluate('window.__denyWrites = false')
        page.locator('#subtitles').click()
        expect_enabled(page, False)
        assert page.evaluate('__events.length') == 1
        context.close()

        # If one alias fails after another was written, roll the earlier write back.
        alias = subtitle_key(cs, cu)
        context, page = open_case(values={subtitle_key(SERVER, USER): '1', alias: '1'})
        page.locator('#settings > summary').click()
        page.evaluate('(key) => window.__denyKey = key', alias)
        page.locator('#subtitles').click()
        expect_enabled(page)
        assert storage(page, subtitle_key(SERVER, USER)) == storage(page, alias) == '1'
        assert page.evaluate('__events.length') == 0
        expect(page.locator('#toast')).to_contain_text('Could not save viewer preferences')
        context.close()
        assert not errors, errors
        browser.close()
    print('PASS viewer preferences: On→Off, label/button clicks, alias persistence, active server/account, delayed identity, failed-write recovery')


if __name__ == '__main__':
    run()
