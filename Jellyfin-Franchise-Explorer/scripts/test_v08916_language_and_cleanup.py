#!/usr/bin/env python3
"""Static regression contract for language-independent Home UI and safe reference cleanup."""
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
source = repo / 'src/Jellyfin.Plugin.FranchiseExplorer'
home = (source / 'Web/franchise-my-media.js').read_text(encoding='utf-8')
config = (source / 'Configuration/configPage.html').read_text(encoding='utf-8')
browse = (source / 'Configuration/browsePage.html').read_text(encoding='utf-8')
timeline = (source / 'Web/franchise-timeline.js').read_text(encoding='utf-8')
service = (source / 'Web/HomeTileRegistrationService.cs').read_text(encoding='utf-8')

assert 'function cardsContainer(section)' in home
assert '[data-type="CollectionFolder"]' in home
assert 'const first = sections[0]' in home
assert 'sammlungen' in home, 'German Collections label should retain preferred tile placement'
assert 'const tileSection = tile?.closest' in home, 'Home widget should anchor without English heading'
assert 'Weiterschauen' in home, 'German native row headings should be handled'

assert 'id="fx-subtitle-language"' in config
assert 'fe-subtitle-language:' in config
assert 'fe-subtitle-language:' in timeline
assert 'fe-subtitle-language:' in home
assert 'subtitleLanguage:intent.subtitleLanguage' in timeline
assert 'subtitleLanguage:owner.subtitleLanguage' in home
assert 'function selectPreferredBrowserSubtitle(language)' in home
assert "fetch(prefix+'/Users/Me'" in home
assert 'SubtitleLanguagePreference' in config and 'SubtitleLanguagePreference' in home
assert 'Use Jellyfin preference (' in config
assert 'subtitleLanguagePreferenceKey()' in browse

assert 'id="fx-remove-unassigned"' in config
assert 'id="fx-manage-links"' in config
assert 'if(!model.Rows.some(r=>r.ParentNodeId===selected))return;' in config
assert 'const assigned=new Set(model.Rows.flatMap' in config
assert "model.MediaLinks=model.MediaLinks.filter(l=>!ids.has(l.Id));" in config
assert 'Unassigned Movies & TV Shows' in browse
assert 'jellyfin-franchise-explorer-my-media-v08915' in service, 'new release must retire previous Injector script'

print('v0.8.9.16 subtitle-language, localized home tile, and unassigned-link safety contracts passed.')
