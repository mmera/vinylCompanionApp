import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlbumTile } from '../components/AlbumTile';
import { EmptyState } from '../components/EmptyState';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { useCollection } from '../context/CollectionContext';
import { SORT_MODES, buildSections } from '../utils/collectionView';
import { colors, radius, spacing, type } from '../theme';

const COLUMNS = 2;

/**
 * Below this many records you can see everything by scrolling, and a search
 * box plus four sort buttons is just furniture. Above it, finding a specific
 * record by scrolling stops being realistic.
 */
const CONTROLS_THRESHOLD = 12;

/** The shelf: every record you own. */
export function CollectionScreen({ navigation }) {
  const { records, isLoading, error, refresh } = useCollection();
  const { width } = useWindowDimensions();
  // Just `stop` — the full context value changes identity on every playback tick.
  const { stop: stopPreview } = usePreviewPlayer();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added');

  const tileWidth = useMemo(
    () => (width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS,
    [width],
  );

  const { sections, total } = useMemo(
    () => buildSections(records, { sort, query, columns: COLUMNS }),
    [records, sort, query],
  );

  const showControls = records.length >= CONTROLS_THRESHOLD;
  const isFiltered = query.trim().length > 0;

  const openDetail = useCallback(
    (album) => {
      stopPreview();
      navigation.navigate('AlbumDetail', { albumId: album.id, album });
    },
    [navigation, stopPreview],
  );

  // One item is one row of the grid — SectionList has no numColumns, so the
  // columns are built here rather than by the list.
  const renderItem = useCallback(
    ({ item: row }) => (
      <View style={styles.row}>
        {row.map((album) => (
          <AlbumTile
            key={album.id}
            album={album}
            width={tileWidth}
            onPress={() => openDetail(album)}
          />
        ))}
        {/* Keeps a trailing odd record left-aligned instead of stretched. */}
        {row.length < COLUMNS ? <View style={{ width: tileWidth }} /> : null}
      </View>
    ),
    [tileWidth, openDetail],
  );

  const renderSectionHeader = useCallback(
    ({ section }) =>
      section.title ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      ) : null,
    [],
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
      {/*
        The header sits outside the list rather than in ListHeaderComponent:
        a TextInput inside a virtualised list's header loses focus whenever the
        list re-renders, which is every keystroke.
      */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Collection</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => navigation.navigate('Search')}
              accessibilityRole="button"
              accessibilityLabel="Add a record"
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
          {isFiltered
            ? `${total} of ${records.length} ${records.length === 1 ? 'record' : 'records'}`
            : `${records.length} ${records.length === 1 ? 'record' : 'records'}`}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {showControls ? (
          <View style={styles.controls}>
            <View style={styles.searchBar}>
              <Text style={styles.searchMark}>⌕</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your collection"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search your collection"
              />
              {/* iOS draws its own clear button; everywhere else needs one. */}
              {isFiltered && Platform.OS !== 'ios' ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Text style={styles.clearMark}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sortRow}>
              {SORT_MODES.map((mode) => {
                const active = mode.id === sort;
                return (
                  <Pressable
                    key={mode.id}
                    onPress={() => setSort(mode.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Sort by ${mode.label}`}
                    style={({ pressed }) => [
                      styles.sortPill,
                      active && styles.sortPillActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.sortLabel, active && styles.sortLabelActive]}>
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(row, index) => row[0]?.id ?? String(index)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        contentContainerStyle={[styles.content, sections.length === 0 && styles.contentEmpty]}
        keyboardShouldPersistTaps="handled"
        // Hundreds of records with remote artwork: keep offscreen rows cheap.
        initialNumToRender={8}
        windowSize={9}
        removeClippedSubviews={Platform.OS !== 'web'}
        ListEmptyComponent={
          isFiltered ? (
            <EmptyState
              mark="○"
              title="No match"
              message={`Nothing in your collection matches “${query.trim()}”.`}
              actionLabel="Clear search"
              onAction={() => setQuery('')}
              style={styles.empty}
            />
          ) : (
            <EmptyState
              mark="◉"
              title="No records yet"
              message="Point the camera at a sleeve and Crate will identify it, search Spotify, or add a record by hand."
              actionLabel="Scan a cover"
              onAction={() => navigation.navigate('Scanner')}
              secondaryActionLabel="Search instead"
              onSecondaryAction={() => navigation.navigate('Search')}
              style={styles.empty}
            />
          )
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
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
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
  controls: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchMark: {
    fontSize: 16,
    color: colors.textTertiary,
  },
  input: {
    flex: 1,
    height: 44,
    color: colors.text,
    fontSize: 15,
  },
  clearMark: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortPillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  sortLabel: {
    ...type.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sortLabelActive: {
    color: colors.background,
  },
  sectionHeader: {
    backgroundColor: colors.background,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...type.label,
    color: colors.textSecondary,
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
