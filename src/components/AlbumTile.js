import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlbumArt } from './AlbumArt';
import { isManualRecord } from '../storage/collection';
import { colors, radius, spacing, type } from '../theme';

/** One cell of the collection grid: art, then artist, then title. */
export function AlbumTile({ album, width, onPress }) {
  const isManual = isManualRecord(album);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        isManual
          ? `${album.artist}, ${album.name}, added by hand`
          : `${album.artist}, ${album.name}`
      }
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View>
        <AlbumArt
          uri={album.thumbnailUrl ?? album.imageUrl}
          size={width}
          label={album.name}
        />
        {/*
          Manual records have no cover art, so without a mark they read as
          artwork that failed to load rather than a deliberate entry.
        */}
        {isManual ? (
          <View style={styles.badge}>
            <Text style={styles.badgeMark}>✎</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.artist} numberOfLines={1}>
          {album.artist}
        </Text>
        <Text style={styles.title} numberOfLines={1}>
          {album.name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
  },
  badgeMark: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  text: {
    marginTop: spacing.sm,
    gap: 1,
  },
  artist: {
    ...type.body,
    color: type.display.color,
    fontWeight: '600',
    fontSize: 14,
  },
  title: {
    ...type.caption,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.6,
  },
});
