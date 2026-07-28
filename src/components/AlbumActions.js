import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { colors, spacing, type } from '../theme';

/**
 * The three actions that follow an album everywhere it appears:
 * preview a track, open it in Spotify, add it to the collection.
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
    try {
      await Linking.openURL(album.spotifyUri);
      return;
    } catch {
      // Spotify app isn't installed or the scheme is unavailable.
    }

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
      <Button
        label={
          isThisBuffering
            ? 'Loading…'
            : isThisPlaying
              ? 'Pause preview'
              : 'Preview on Spotify'
        }
        icon={isThisPlaying ? '❚❚' : '▶'}
        variant="primary"
        onPress={handlePreview}
        disabled={!previewUrl}
        loading={isThisBuffering}
      />

      {!previewUrl ? (
        <Text style={styles.note}>
          Spotify doesn&rsquo;t expose a preview clip for this release.
        </Text>
      ) : null}

      <Button label="Open in Spotify" variant="spotify" onPress={openInSpotify} />

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
  note: {
    ...type.caption,
    textAlign: 'center',
    marginTop: -spacing.xs,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
});
