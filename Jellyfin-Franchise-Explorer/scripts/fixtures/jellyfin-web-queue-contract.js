/* Offline native shortcut contract extracted from Jellyfin Web's
 * src/components/shortcuts.js playAllFromHere (12.2/12.4) and the Episode
 * translator in components/playback/playbackmanager.js. The fixture supplies
 * mocked API/player dependencies; it is not a live Jellyfin playback test.
 * Keep the public shortcut's fetchData/startIndex behavior intact.
 */
function playAllFromHere(card, serverId, queue) {
    const parent = card.parentNode;
    const className = card.classList.length ? (`.${card.classList[0]}`) : '';
    const cards = parent.querySelectorAll(`${className}[data-id]`);
    const ids = [];
    let foundCard = false;
    let startIndex;
    for (let i = 0, length = cards.length; i < length; i++) {
        if (cards[i] === card) { foundCard = true; startIndex = i; }
        if (foundCard || !queue) ids.push(cards[i].getAttribute('data-id'));
    }
    const itemsContainer = dom.parentWithClass(card, 'itemsContainer');
    if (itemsContainer?.fetchData) {
        const queryOptions = queue ? { StartIndex: startIndex } : {};
        return itemsContainer.fetchData(queryOptions).then(result => {
            if (queue) return playbackManager.queue({items: result.Items});
            return playbackManager.play({items: result.Items, startIndex: startIndex});
        });
    }
    if (!ids.length) return;
    if (queue) return playbackManager.queue({ids: ids, serverId: serverId});
    return playbackManager.play({ids: ids, serverId: serverId, startIndex: startIndex});
}
function getEpisodePlaybackPromise(firstItem, options, items) {
    if (items.length === 1 && getPlayer(firstItem, options).supportsProgress !== false) {
        return getEpisodes(firstItem, options);
    } else return null;
}
const dom = {parentWithClass: (element, name) => element.closest('.' + name)};
const getPlayer = () => ({supportsProgress: true});
function getEpisodes(firstItem) {
    // The real translator returns null before issuing getEpisodes when this
    // hint is absent. Otherwise it requests the rest of the same SeriesId.
    if (!firstItem.SeriesId) return Promise.resolve(null);
    window.nativeExpansions++;
    return Promise.resolve({Items: [firstItem, ...window.seriesSuccessors(firstItem)]});
}
const playbackManager = {
    async play(options) {
        let items = options.items || options.ids.map(id => window.nativeLibrary[id]);
        const firstItem = items[0];
        if (firstItem.Type === 'Episode') {
            const translated = getEpisodePlaybackPromise(firstItem, options, items);
            if (translated) items = (await translated)?.Items || items;
        }
        window.nativeCalls.push({items, startIndex: options.startIndex || 0,
            startPositionTicks: options.startPositionTicks || 0});
        let cursor = options.startIndex || 0;
        window.finishNativeItem = () => {
            cursor++;
            if (cursor < items.length) window.startNativeItem(items[cursor]);
            else { window.started = false; window.currentId = ''; window.nativeFinished = true; }
        };
        window.startNativeItem(items[options.startIndex || 0]);
    },
    queue() { throw Error('Unexpected append call'); }
};
document.addEventListener('click', event => {
    const card = event.target.closest('.itemAction');
    if (!card) return;
    if (card.dataset.action === 'playallfromhere') void playAllFromHere(card, card.dataset.serverid);
    else if (['play', 'resume'].includes(card.dataset.action)) void playbackManager.play({
        ids: [card.dataset.id], serverId: card.dataset.serverid,
        startPositionTicks: Number(card.dataset.positionticks) || 0
    });
});
