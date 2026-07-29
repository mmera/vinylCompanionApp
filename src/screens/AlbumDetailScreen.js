import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { isManualId, isManualRecord } from '../storage/collection';
import { useCollection } from '../context/CollectionContext';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { confirmDestructive } from '../utils/confirm';
import { colors, radius, spacing, surfaces, type } from '../theme';

/**
 * Full album view: art, tracklist, and the same preview / open / add actions.
 *
 * Navigated to with whatever album data the caller already had, so the header
 * renders instantly while the tracklist loads behind it.
 */
export function AlbumDetailScreen({ route, navigation }) {
  const { albumId, album: seedAlbum } = route.params;
  const { width } = useWindowDimensions();

  // A manual record is the whole truth about itself — there is no catalog
  // entry to fetch, so the screen renders from what it was handed.
  const isManual = isManualRecord(seedAlbum) || isManualId(albumId);

  const [fetchedAlbum, setFetchedAlbum] = useState(seedAlbum ?? null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(!isManual);
  const [error, setError] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  const collection = useCollection();
  // Just `stop` — the full context value changes identity on every playback
  // tick, which would re-subscribe the navigation listener continuously.
  const { stop: stopPreview } = usePreviewPlayer();

  /**
   * A manual record is editable from this screen, so it has to be read from
   * the collection rather than held in local state — otherwise returning from
   * the editor redisplays the values the screen was opened with. Catalog
   * albums are immutable and come from the fetch.
   */
  const storedRecord = useMemo(
    () => collection.records.find((record) => record.id === albumId) ?? null,
    [collection.records, albumId],
  );
  // `fetchedAlbum` is seeded from the route params and never refetched for a
  // manual record, so it is the right fallback when the record is gone.
  const album = isManual ? (storedRecord ?? fetchedAlbum) : fetchedAlbum;

  const artSize = Math.min(width - spacing.lg * 2, 340);

  const load = useCallback(async () => {
    if (isManual) return;
    setIsLoading(true);
    setError(null);
    try {
      const full = await getAlbum(albumId);
      setFetchedAlbum(full);
      setTracks(full.tracks ?? []);
    } catch (loadError) {
      setError(loadError.message ?? 'Could not load this album.');
    } finally {
      setIsLoading(false);
    }
  }, [albumId, isManual]);

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

  const handleRemove = useCallback(async () => {
    const confirmed = await confirmDestructive({
      title: 'Remove from collection?',
      message: `${album?.name} will be removed from Crate.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    try {
      stopPreview();
      await collection.remove(album.id);
      navigation.goBack();
    } catch (removeError) {
      setError(removeError.message ?? 'Could not remove this record.');
    }
  }, [album, collection, navigation, stopPreview]);

  /*
   * The first track with a clip, or null when the album has none.
   *
   * Spotify serves previews to apps registered before 2024-11-27 and to no one
   * since, so in practice this is all-or-nothing per album. `AlbumActions`
   * renders the preview button on the strength of this being non-null, and the
   * tracklist drops its play affordances for the same reason — "did we find
   * one" and "are there any" are the same question, so it is asked once.
   */
  const headerTrack = useMemo(() => tracks.find((track) => track.previewUrl) ?? null, [tracks]);
  const hasPreviews = headerTrack !== null;

  if (!album && isLoading) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (!album) {
    // Retrying only means something for a catalog album — there is no remote
    // copy of a manual record to fetch again, so offer a way out instead of a
    // button that does nothing.
    return (
      <View style={[styles.fill, styles.centered, styles.padded]}>
        <Text style={styles.errorTitle}>
          {isManual ? 'This record is no longer in your collection.' : (error ?? 'Album unavailable.')}
        </Text>
        <Button
          label={isManual ? 'Back to collection' : 'Try again'}
          onPress={isManual ? navigation.goBack : load}
          style={styles.retry}
        />
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
            {[
              album.year,
              album.totalTracks ? `${album.totalTracks} tracks` : null,
              isManual ? 'Added by hand' : null,
            ]
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

      {isManual ? (
        <View style={styles.manualBlock}>
          <Text style={styles.sectionLabel}>Your notes</Text>
          <Text style={album.notes ? styles.notes : styles.notesEmpty}>
            {album.notes || 'No notes on this record.'}
          </Text>
          <Text style={styles.manualNote}>
            This record isn&rsquo;t in Spotify&rsquo;s catalog, so there&rsquo;s no cover art or
            tracklist to pull in.
          </Text>
          <Button
            label="Edit details"
            onPress={() => navigation.navigate('ManualEntry', { record: album })}
          />
        </View>
      ) : (
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
                previewable={hasPreviews}
              />
            ))
          )}
        </View>
      )}

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

/**
 * `previewable` is the album-wide answer, not this track's. When no track has
 * a clip the row is plain text at full contrast — nothing is broken, previews
 * simply aren't part of this album. Only in the mixed case does a track
 * without a clip get dimmed, where the dimming actually means something.
 */
function TrackRow({ track, album, previewable }) {
  const player = usePreviewPlayer();
  const isActive = player.isActive(track.id);
  const playable = Boolean(track.previewUrl);

  const body = (
    <>
      <Text style={[styles.trackNumber, isActive && styles.trackActive]}>
        {isActive && player.isPlaying ? '❚❚' : track.trackNumber}
      </Text>
      <View style={styles.trackText}>
        <Text
          style={[
            styles.trackName,
            isActive && styles.trackActive,
            // Only dim within an album that has previews, where a missing clip
            // is a fact about this track. When the album has none, dimming
            // every row would just look broken.
            previewable && !playable && styles.trackMuted,
          ]}
          numberOfLines={1}
        >
          {track.name}
        </Text>
      </View>
      <Text style={styles.trackDuration}>{formatDuration(track.durationMs)}</Text>
    </>
  );

  if (!previewable) return <View style={styles.track}>{body}</View>;

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
      {body}
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
  manualBlock: {
    ...surfaces.card,
    gap: spacing.sm,
  },
  notes: {
    ...type.body,
    color: colors.text,
    lineHeight: 21,
  },
  notesEmpty: {
    ...type.body,
    color: colors.textTertiary,
  },
  manualNote: {
    ...type.caption,
    lineHeight: 18,
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
