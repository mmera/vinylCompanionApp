import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AlbumActions } from '../components/AlbumActions';
import { AlbumArt } from '../components/AlbumArt';
import { Button } from '../components/Button';
import { getAlbum } from '../services/spotify';
import { useCollection } from '../context/CollectionContext';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { colors, radius, spacing, type } from '../theme';

/**
 * Full album view: art, tracklist, and the same preview / open / add actions.
 *
 * Navigated to with whatever album data the caller already had, so the header
 * renders instantly while the tracklist loads behind it.
 */
export function AlbumDetailScreen({ route, navigation }) {
  const { albumId, album: seedAlbum } = route.params;
  const { width } = useWindowDimensions();

  const [album, setAlbum] = useState(seedAlbum ?? null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  const collection = useCollection();
  // Just `stop` — the full context value changes identity on every playback
  // tick, which would re-subscribe the navigation listener continuously.
  const { stop: stopPreview } = usePreviewPlayer();

  const artSize = Math.min(width - spacing.lg * 2, 340);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const full = await getAlbum(albumId);
      setAlbum(full);
      setTracks(full.tracks ?? []);
    } catch (loadError) {
      setError(loadError.message ?? 'Could not load this album.');
    } finally {
      setIsLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    load();
  }, [load]);

  // Leaving the screen shouldn't leave a clip playing behind it.
  useEffect(
    () => navigation.addListener('beforeRemove', stopPreview),
    [navigation, stopPreview],
  );

  useEffect(() => {
    if (album?.name) navigation.setOptions({ title: album.name });
  }, [album?.name, navigation]);

  const isOwned = album ? collection.owns(album.id) : false;

  const handleAdd = useCallback(async () => {
    if (!album) return;
    setIsAdding(true);
    try {
      await collection.add(album, { source: 'search' });
    } catch (addError) {
      setError(addError.message ?? 'Could not save this record.');
    } finally {
      setIsAdding(false);
    }
  }, [album, collection]);

  const handleRemove = useCallback(() => {
    Alert.alert('Remove from collection?', `${album?.name} will be removed from Crate.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            stopPreview();
            await collection.remove(album.id);
            navigation.goBack();
          } catch (removeError) {
            setError(removeError.message ?? 'Could not remove this record.');
          }
        },
      },
    ]);
  }, [album, collection, navigation, stopPreview]);

  // The header's Preview button plays the first track that has a clip.
  const headerTrack = useMemo(
    () => tracks.find((track) => track.previewUrl) ?? tracks[0] ?? null,
    [tracks],
  );

  if (!album && isLoading) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (!album) {
    return (
      <View style={[styles.fill, styles.centered, styles.padded]}>
        <Text style={styles.errorTitle}>{error ?? 'Album unavailable.'}</Text>
        <Button label="Try again" onPress={load} style={styles.retry} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <AlbumArt uri={album.imageUrl} size={artSize} radius={radius.md} label={album.name} />
        <View style={styles.heroText}>
          <Text style={styles.artist}>{album.artist}</Text>
          <Text style={styles.album}>{album.name}</Text>
          <Text style={styles.meta}>
            {[album.year, album.totalTracks ? `${album.totalTracks} tracks` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>

      <AlbumActions
        album={album}
        previewTrack={headerTrack}
        onAdd={handleAdd}
        isOwned={isOwned}
        isAdding={isAdding}
      />

      <View style={styles.tracklist}>
        <Text style={styles.sectionLabel}>Tracklist</Text>

        {isLoading && tracks.length === 0 ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.tracksLoading} />
        ) : error && tracks.length === 0 ? (
          <View style={styles.tracksError}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={load} style={styles.retry} />
          </View>
        ) : (
          tracks.map((track) => (
            <TrackRow
              key={track.id ?? `${track.discNumber}-${track.trackNumber}`}
              track={track}
              album={album}
            />
          ))
        )}
      </View>

      {isOwned ? (
        <Pressable
          onPress={handleRemove}
          accessibilityRole="button"
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <Text style={styles.removeLabel}>Remove from collection</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function TrackRow({ track, album }) {
  const player = usePreviewPlayer();
  const isActive = player.isActive(track.id);
  const playable = Boolean(track.previewUrl);

  return (
    <Pressable
      onPress={() =>
        player.toggle({
          id: track.id,
          url: track.previewUrl,
          title: `${track.name} — ${album.artist}`,
        })
      }
      disabled={!playable}
      accessibilityRole="button"
      accessibilityLabel={
        playable ? `Preview ${track.name}` : `${track.name}, no preview available`
      }
      style={({ pressed }) => [styles.track, pressed && playable && styles.pressed]}
    >
      <Text style={[styles.trackNumber, isActive && styles.trackActive]}>
        {isActive && player.isPlaying ? '❚❚' : track.trackNumber}
      </Text>
      <View style={styles.trackText}>
        <Text
          style={[styles.trackName, isActive && styles.trackActive, !playable && styles.trackMuted]}
          numberOfLines={1}
        >
          {track.name}
        </Text>
      </View>
      <Text style={styles.trackDuration}>{formatDuration(track.durationMs)}</Text>
    </Pressable>
  );
}

function formatDuration(ms) {
  if (!ms) return '';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  padded: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
  heroText: {
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  artist: {
    ...type.display,
  },
  album: {
    ...type.subtitle,
    fontSize: 18,
  },
  meta: {
    ...type.caption,
    marginTop: spacing.xs,
  },
  tracklist: {
    gap: spacing.xs,
  },
  sectionLabel: {
    ...type.label,
    marginBottom: spacing.sm,
  },
  tracksLoading: {
    paddingVertical: spacing.lg,
  },
  tracksError: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trackNumber: {
    ...type.caption,
    width: 24,
    textAlign: 'center',
  },
  trackText: {
    flex: 1,
  },
  trackName: {
    ...type.body,
    color: colors.text,
    fontSize: 15,
  },
  trackMuted: {
    color: colors.textTertiary,
  },
  trackActive: {
    color: colors.spotify,
  },
  trackDuration: {
    ...type.caption,
  },
  remove: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  removeLabel: {
    ...type.body,
    color: colors.danger,
    fontWeight: '600',
  },
  errorTitle: {
    ...type.title,
    textAlign: 'center',
  },
  errorText: {
    ...type.body,
    textAlign: 'center',
  },
  retry: {
    alignSelf: 'center',
    minWidth: 180,
  },
  pressed: {
    opacity: 0.6,
  },
});
