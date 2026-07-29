import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
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
export function AlbumActions({ album, previewTrack, onAdd, isOwned, isAdding }) {
  const player = usePreviewPlayer();
  const [linkError, setLinkError] = useState(null);

  const previewUrl = previewTrack?.previewUrl ?? null;
  const previewId = previewTrack?.id ?? null;
  const isThisPlaying = player.isActive(previewId) && player.isPlaying;
  const isThisBuffering = player.isActive(previewId) && player.isBuffering;

  const openInSpotify = useCallback(async () => {
    if (!album) return;
    setLinkError(null);

    // Try the app first, then fall back to the web player. `canOpenURL` needs
    // the scheme declared in app.json, which Expo Go can't do — so we just
    // attempt the deep link and catch the failure.
    if (album.spotifyUri) {
      try {
        await Linking.openURL(album.spotifyUri);
        return;
      } catch {
        // Spotify app isn't installed or the scheme is unavailable.
      }
    }

    if (!album.spotifyUrl) return;

    try {
      await Linking.openURL(album.spotifyUrl);
    } catch {
      setLinkError('Could not open Spotify.');
    }
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
        <Button label="Open in Spotify" variant="spotify" onPress={openInSpotify} />
      ) : null}

      {onAdd ? (
        <Button
          label={isOwned ? 'In your collection' : 'Add to Collection'}
          icon={isOwned ? '✓' : '+'}
          variant="secondary"
          onPress={onAdd}
          disabled={isOwned}
          loading={isAdding}
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
