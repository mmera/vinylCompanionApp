import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, radius, type } from '../theme';

/** Cover art with a typographic placeholder for albums that have none. */
export function AlbumArt({ uri, size, style, radius: cornerRadius = radius.sm, label }) {
  const dimensions = size ? { width: size, height: size } : null;

  if (!uri) {
    return (
      <View
        style={[styles.placeholder, dimensions, { borderRadius: cornerRadius }, style]}
        accessible
        accessibilityLabel={label ? `No cover art for ${label}` : 'No cover art'}
      >
        <Text style={styles.placeholderMark}>◉</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.image, dimensions, { borderRadius: cornerRadius }, style]}
      resizeMode="cover"
      accessible
      accessibilityLabel={label ? `Cover art for ${label}` : 'Album cover art'}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfaceRaised,
  },
  placeholder: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderMark: {
    ...type.title,
    color: colors.textTertiary,
    fontSize: 28,
  },
});
