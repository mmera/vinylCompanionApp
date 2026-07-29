import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlbumArt } from './AlbumArt';
import { isManualRecord } from '../storage/collection';
import { colors, spacing, type } from '../theme';

/**
 * One record as a compact row.
 *
 * The list view exists because a grid trades text for pictures: two columns of
 * tiles truncate long titles and fit maybe six records on screen. When you are
 * looking for a specific record rather than browsing, names matter more than
 * artwork — this fits roughly twice as many and gives each one the full width
 * to spell itself out.
 */
export function AlbumRow({ album, onPress }) {
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
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AlbumArt uri={album.thumbnailUrl ?? album.imageUrl} size={52} label={album.name} />

      <View style={styles.text}>
        <Text style={styles.artist} numberOfLines={1}>
          {album.artist}
        </Text>
        <Text style={styles.title} numberOfLines={1}>
          {album.name}
        </Text>
      </View>

      {isManual ? <Text style={styles.badge}>✎</Text> : null}
      {album.year ? <Text style={styles.year}>{album.year}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  artist: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
  },
  title: {
    ...type.caption,
    fontSize: 13,
    color: colors.textSecondary,
  },
  badge: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  year: {
    ...type.caption,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.6,
  },
});
