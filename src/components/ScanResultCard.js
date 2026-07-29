import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { AlbumActions } from './AlbumActions';
import { AlbumArt } from './AlbumArt';
import { Button } from './Button';
import { useCollection } from '../context/CollectionContext';
import { getAlbumTracks } from '../services/spotify';
import { OWNED, WISHLIST } from '../storage/collection';
import { colors, radius, spacing, type } from '../theme';

/**
 * The card that slides up over the camera when a cover is identified.
 *
 * Artist is the headline; album title sits underneath it. The tracklist is
 * fetched lazily just to find a playable preview clip — the full list lives
 * on the detail screen.
 */
export function ScanResultCard({ result, onDismiss, onOpenDetail, onAddManually }) {
  const { album, identification } = result;
  const collection = useCollection();

  const [previewTrack, setPreviewTrack] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isWishlisting, setIsWishlisting] = useState(false);
  const [addError, setAddError] = useState(null);

  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide, album?.id]);

  // Spotify only returns preview URLs on the tracks endpoint, not on search
  // results, so we fetch the tracklist and take the first clip we can play.
  useEffect(() => {
    if (!album?.id) return undefined;

    let cancelled = false;
    setPreviewTrack(null);

    getAlbumTracks(album.id)
      .then((tracks) => {
        if (cancelled) return;
        setPreviewTrack(tracks.find((track) => track.previewUrl) ?? tracks[0] ?? null);
      })
      .catch(() => {
        // A missing preview is a degraded button, not an error worth surfacing here.
      });

    return () => {
      cancelled = true;
    };
  }, [album?.id]);

  const isOwned = album ? collection.owns(album.id) : false;
  const isWishlisted = album ? collection.isWishlisted(album.id) : false;

  const save = useCallback(
    async (status, setBusy) => {
      if (!album) return;
      setBusy(true);
      setAddError(null);
      try {
        await collection.add(album, { source: 'scan', status });
      } catch (error) {
        setAddError(error.message ?? 'Could not save this record.');
      } finally {
        setBusy(false);
      }
    },
    [album, collection],
  );

  const handleAdd = useCallback(() => save(OWNED, setIsAdding), [save]);
  const handleWishlist = useCallback(() => save(WISHLIST, setIsWishlisting), [save]);

  const translateY = useMemo(
    () => slide.interpolate({ inputRange: [0, 1], outputRange: [340, 0] }),
    [slide],
  );

  const artist = album?.artist ?? identification.artist;
  const title = album?.name ?? identification.album;
  const year = album?.year || identification.year;

  return (
    <Animated.View style={[styles.card, { transform: [{ translateY }], opacity: slide }]}>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss and keep scanning"
        style={styles.handleTarget}
        hitSlop={12}
      >
        <View style={styles.handle} />
      </Pressable>

      <View style={styles.header}>
        <AlbumArt uri={album?.imageUrl} size={76} label={title} />
        <View style={styles.headerText}>
          <Text style={styles.artist} numberOfLines={2}>
            {artist}
          </Text>
          <Text style={styles.album} numberOfLines={2}>
            {title}
          </Text>
          {year ? <Text style={styles.year}>{year}</Text> : null}
        </View>
      </View>

      {album ? (
        <>
          <AlbumActions
            album={album}
            previewTrack={previewTrack}
            onAdd={handleAdd}
            isOwned={isOwned}
            isAdding={isAdding}
            onWishlist={handleWishlist}
            isWishlisted={isWishlisted}
            isWishlisting={isWishlisting}
          />
          {addError ? <Text style={styles.error}>{addError}</Text> : null}

          <Pressable
            onPress={() => onOpenDetail(album)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.detailLink, pressed && styles.pressed]}
          >
            <Text style={styles.detailLinkLabel}>View tracklist →</Text>
          </Pressable>
        </>
      ) : (
        /*
         * Claude knows what this is; Spotify just doesn't stock it. That used
         * to be the end of the road — the card explained the gap and offered
         * nothing, discarding an identification good enough to save. Manual
         * records exist precisely for this, so hand the answer straight over.
         */
        <View style={styles.notOnSpotify}>
          <Text style={styles.notOnSpotifyText}>
            Recognized the cover, but this release isn&rsquo;t on Spotify — so there&rsquo;s no
            artwork, preview, or tracklist to pull in. You can still keep it by hand.
          </Text>
          <Button
            label="Add by hand"
            variant="primary"
            onPress={() =>
              onAddManually({
                artist: identification.artist,
                name: identification.album,
                year: identification.year,
              })
            }
            style={styles.manualAction}
          />
        </View>
      )}

      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <Text style={styles.dismissLabel}>Keep scanning</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  handleTarget: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  artist: {
    ...type.display,
    fontSize: 26,
  },
  album: {
    ...type.subtitle,
  },
  year: {
    ...type.caption,
    marginTop: spacing.xs,
  },
  detailLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  detailLinkLabel: {
    ...type.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  notOnSpotify: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  manualAction: {
    marginTop: spacing.xs,
  },
  notOnSpotifyText: {
    ...type.body,
    lineHeight: 21,
  },
  dismiss: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dismissLabel: {
    ...type.label,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
