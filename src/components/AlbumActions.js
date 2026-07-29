import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { openInSpotify } from '../utils/openInSpotify';
import { colors, spacing, type } from '../theme';

/**
 * The actions that follow an album everywhere it appears.
 *
 * Each one renders only when it can actually do something. Previews in
 * particular: Spotify stopped returning `preview_url` to apps registered after
 * 2024-11-27, so for most installs there is no clip for any track, ever — and a
 * permanently disabled button next to an apology is worse than no button. The
 * test is per-album rather than global so that anyone whose Spotify app
 * predates the cutoff still gets working previews.
 */
export function AlbumActions({
  album,
  previewTrack,
  onAdd,
  isOwned,
  isAdding,
  onWishlist,
  isWishlisted,
  isWishlisting,
}) {
  const player = usePreviewPlayer();
  const [linkError, setLinkError] = useState(null);

  const previewUrl = previewTrack?.previewUrl ?? null;
  const previewId = previewTrack?.id ?? null;
  const isThisPlaying = player.isActive(previewId) && player.isPlaying;
  const isThisBuffering = player.isActive(previewId) && player.isBuffering;

  const handleOpen = useCallback(async () => {
    if (!album) return;
    setLinkError(null);
    if (!(await openInSpotify(album))) setLinkError('Could not open Spotify.');
  }, [album]);

  const handlePreview = useCallback(() => {
    if (!previewUrl) return;
    player.toggle({
      id: previewId,
      url: previewUrl,
      title: `${previewTrack.name} — ${album?.artist ?? ''}`,
    });
  }, [player, previewId, previewUrl, previewTrack, album]);

  return (
    <View style={styles.container}>
      {previewUrl ? (
        <Button
          label={
            isThisBuffering ? 'Loading…' : isThisPlaying ? 'Pause preview' : 'Preview on Spotify'
          }
          icon={isThisPlaying ? '❚❚' : '▶'}
          variant="primary"
          onPress={handlePreview}
          loading={isThisBuffering}
        />
      ) : null}

      {/*
        Asks whether there is a link to follow, not whether the record is
        manual — the general question, which happens to answer the specific
        one. Manual records carry null for both fields.
      */}
      {album?.spotifyUrl || album?.spotifyUri ? (
        <Button label="Open in Spotify" variant="spotify" onPress={handleOpen} />
      ) : null}

      {onAdd ? (
        <Button
          label={isOwned ? 'In your collection' : isWishlisted ? 'Got it — add to collection' : 'Add to Collection'}
          icon={isOwned ? '✓' : '+'}
          variant="secondary"
          onPress={onAdd}
          disabled={isOwned}
          loading={isAdding}
        />
      ) : null}

      {/*
        Hidden once owned: a record on the shelf has no business going back on
        a list of things to look for.
      */}
      {onWishlist && !isOwned ? (
        <Button
          label={isWishlisted ? 'On your wishlist' : 'Add to wishlist'}
          icon={isWishlisted ? '♥' : '♡'}
          variant="secondary"
          onPress={onWishlist}
          disabled={isWishlisted}
          loading={isWishlisting}
        />
      ) : null}

      {linkError ? <Text style={styles.error}>{linkError}</Text> : null}
      {player.error && player.isActive(previewId) ? (
        <Text style={styles.error}>{player.error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
});
