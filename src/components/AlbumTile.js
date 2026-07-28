import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlbumArt } from './AlbumArt';
import { spacing, type } from '../theme';

/** One cell of the collection grid: art, then artist, then title. */
export function AlbumTile({ album, width, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.artist}, ${album.name}`}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <AlbumArt
        uri={album.thumbnailUrl ?? album.imageUrl}
        size={width}
        label={album.name}
      />
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
