#!/usr/bin/env python3
"""CI contract: library typing must update only result DOM, not its parent row."""
from pathlib import Path
s=(Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html').read_text()
start=s.index("    search.addEventListener('input',()=>{",s.index('  function renderRowLibrary(row,pickers){'))
end=s.index('    container.append(header,help,search);',start)
handler=s[start:end]
assert 'renderRows()' not in handler, 'Input handler must not replace the entire row or focused search field.'
assert 'refreshRowSearchResults(row.Id)' in handler
assert 'state.timer=setTimeout(()=>searchRowLibrary' in handler
start=s.index('  async function searchRowLibrary(')
end=s.index('  function renderRowLibraryResults(',start)
async_handler=s[start:end]
assert 'renderRows()' not in async_handler, 'Async results must never rebuild the search field.'
assert 'refreshRowSearchResults(rowId)' in async_handler
assert "results.className='fx-library-results'" in s
assert 'host.replaceChildren()' in s
assert 'container.append(header,help,search)' in s
print('Row input focus contract passed; browser regression is test_row_search_focus.py.')
