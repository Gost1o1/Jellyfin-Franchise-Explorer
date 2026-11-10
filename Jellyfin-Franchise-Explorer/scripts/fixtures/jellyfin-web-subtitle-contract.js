/* Jellyfin Web subtitle contract, copied from src/components/playback/playbackmanager.js.
 * Upstream: https://github.com/jellyfin/jellyfin-web (GPL-2.0).
 * This fixture preserves the actual remembered-secondary promotion and subtitle
 * switch implementation inspected 2026-11-10; the browser test supplies player
 * dependencies and actual HTML TextTracks rather than substituting the switch.
 */
window.createJellyfinSubtitleContract = function(dependencies) {
    const {self, enableLocalPlaylistManagement, getCurrentSubtitleStream, changeStream,
        getCurrentTicks, getPlayerData} = dependencies;
        function getDeliveryMethod(subtitleStream) {
            // This will be null for internal subs for local items
            if (subtitleStream.DeliveryMethod) {
                return subtitleStream.DeliveryMethod;
            }

            return subtitleStream.IsExternal ? 'External' : 'Embed';
        }

        self.setSubtitleStreamIndex = function (index, player) {
            player = player || self._currentPlayer;
            if (player && !enableLocalPlaylistManagement(player)) {
                return player.setSubtitleStreamIndex(index);
            }

            const currentStream = getCurrentSubtitleStream(player);

            const newStream = self.getSubtitleStream(player, index);

            if (!currentStream && !newStream) {
                return;
            }

            let selectedTrackElementIndex = -1;

            const currentPlayMethod = self.playMethod(player);

            if (currentStream && !newStream) {
                if (getDeliveryMethod(currentStream) === 'Encode' || (getDeliveryMethod(currentStream) === 'Embed' && currentPlayMethod === 'Transcode')) {
                    // Need to change the transcoded stream to remove subs
                    changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: -1 });
                }
            } else if (!currentStream && newStream) {
                if (getDeliveryMethod(newStream) === 'External') {
                    selectedTrackElementIndex = index;
                } else if (getDeliveryMethod(newStream) === 'Embed' && currentPlayMethod !== 'Transcode') {
                    selectedTrackElementIndex = index;
                } else {
                    // Need to change the transcoded stream to add subs
                    changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: index });
                }
            } else if (currentStream && newStream) {
                // Switching tracks
                // We can handle this clientside if the new track is external or the new track is embedded and we're not transcoding
                if (getDeliveryMethod(newStream) === 'External' || (getDeliveryMethod(newStream) === 'Embed' && currentPlayMethod !== 'Transcode')) {
                    selectedTrackElementIndex = index;

                    // But in order to handle this client side, if the previous track is being added via transcoding, we'll have to remove it
                    if (getDeliveryMethod(currentStream) !== 'External' && getDeliveryMethod(currentStream) !== 'Embed') {
                        changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: -1 });
                    }
                } else {
                    // Need to change the transcoded stream to add subs
                    changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: index });
                }
            }

            player.setSubtitleStreamIndex(selectedTrackElementIndex);

            // Also disable secondary subtitles when disabling the primary
            // subtitles, or if it doesn't support a secondary pair
            if (selectedTrackElementIndex === -1 || !self.trackHasSecondarySubtitleSupport(newStream)) {
                self.setSecondarySubtitleStreamIndex(-1);
            }

            getPlayerData(player).subtitleStreamIndex = index;
        };

    return self;
};
window.restoreJellyfinRememberedSecondary = function(mediaSource, trackOptions) {
                    if (trackOptions.DefaultSecondarySubtitleStreamIndex != null) {
                        mediaSource.DefaultSecondarySubtitleStreamIndex = trackOptions.DefaultSecondarySubtitleStreamIndex;
                    }

                    if (mediaSource.DefaultSubtitleStreamIndex == null || mediaSource.DefaultSubtitleStreamIndex < 0) {
                        if (mediaSource.DefaultSecondarySubtitleStreamIndex != null) {
                            mediaSource.DefaultSubtitleStreamIndex = mediaSource.DefaultSecondarySubtitleStreamIndex;
                        }
                        mediaSource.DefaultSecondarySubtitleStreamIndex = -1;
                    }

    return mediaSource;
};
