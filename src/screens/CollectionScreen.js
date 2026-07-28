import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlbumTile } from '../components/AlbumTile';
import { EmptyState } from '../components/EmptyState';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { useCollection } from '../context/CollectionContext';
import { colors, spacing, type } from '../theme';

const COLUMNS = 2;

/** The shelf: every record you own, newest first. */
export function CollectionScreen({ navigation }) {
  const { records, isLoading, error, refresh } = useCollection();
  const { width } = useWindowDimensions();
  // Just `stop` — the full context value changes identity on every playback tick.
  const { stop: stopPreview } = usePreviewPlayer();

  const tileWidth = useMemo(
    () => (width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS,
    [width],
  );

  const openDetail = useCallback(
    (album) => {
      stopPreview();
      navigation.navigate('AlbumDetail', { albumId: album.id, album });
    },
    [navigation, stopPreview],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <AlbumTile album={item} width={tileWidth} onPress={() => openDetail(item)} />
    ),
    [tileWidth, openDetail],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.fill, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={['top']}>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={COLUMNS}
        columnWrapperStyle={records.length ? styles.column : undefined}
        contentContainerStyle={[
          styles.content,
          records.length === 0 && styles.contentEmpty,
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Collection</Text>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => navigation.navigate('Search')}
                  accessibilityRole="button"
                  accessibilityLabel="Add a record by searching"
                  hitSlop={12}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.addLabel}>+ Add</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                  hitSlop={12}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.settingsMark}>⚙</Text>
                </Pressable>
              </View>
            </View>
            <Text style={styles.count}>
              {records.length} {records.length === 1 ? 'record' : 'records'}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            mark="◉"
            title="No records yet"
            message="Scan a cover with the camera, or search Spotify to add one by hand."
            actionLabel="Search for a record"
            onAction={() => navigation.navigate('Search')}
            style={styles.empty}
          />
        }
        onRefresh={refresh}
        refreshing={false}
      />
    </SafeAreaView>
  );
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
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  contentEmpty: {
    flexGrow: 1,
  },
  column: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...type.display,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addLabel: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
  },
  settingsMark: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  count: {
    ...type.caption,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  empty: {
    paddingBottom: spacing.xxl,
  },
  pressed: {
    opacity: 0.6,
  },
});
