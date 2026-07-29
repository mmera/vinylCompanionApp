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

import { AlbumRow } from '../components/AlbumRow';
import { AlbumTile } from '../components/AlbumTile';
import { EmptyState } from '../components/EmptyState';
import { useCollectionPreferences } from '../hooks/useCollectionPreferences';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import { useCollection } from '../context/CollectionContext';
import { SORT_MODES, buildSections } from '../utils/collectionView';
import { colors, radius, spacing, type } from '../theme';

const GRID_COLUMNS = 2;

/** The shelf: every record you own. */
export function CollectionScreen({ navigation }) {
  const { records, isLoading, error, refresh } = useCollection();
  const { width } = useWindowDimensions();
  // Just `stop` — the full context value changes identity on every playback tick.
  const { stop: stopPreview } = usePreviewPlayer();

  const [query, setQuery] = useState('');
  const { view, sort, setView, setSort } = useCollectionPreferences();

  const isGrid = view === 'grid';
  const columns = isGrid ? GRID_COLUMNS : 1;

  const tileWidth = useMemo(
    () => (width - spacing.lg * 2 - spacing.md * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
    [width],
  );

  const { sections, total } = useMemo(
    () => buildSections(records, { sort, query, columns }),
    [records, sort, query, columns],
  );

  /*
   * Shown as soon as there is anything to organise.
   *
   * These used to appear only past twelve records, on the theory that a search
   * box over three of them is furniture. The effect was that nobody knew the
   * feature existed — including while testing it — because a small collection
   * looks exactly like the version without it. A control you cannot find is
   * worth less than one you occasionally don't need.
   */
  const showControls = records.length > 0;
  const isFiltered = query.trim().length > 0;
  const countLabel = `${records.length} ${records.length === 1 ? 'record' : 'records'}`;

  const openDetail = useCallback(
    (album) => {
      stopPreview();
      navigation.navigate('AlbumDetail', { albumId: album.id, album });
    },
    [navigation, stopPreview],
  );

  // One item is one row — SectionList has no numColumns, so the columns are
  // built here rather than by the list. In list view a row holds one record.
  const renderItem = useCallback(
    ({ item: row }) => {
      if (!isGrid) {
        return <AlbumRow album={row[0]} onPress={() => openDetail(row[0])} />;
      }

      return (
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
          {row.length < GRID_COLUMNS ? <View style={{ width: tileWidth }} /> : null}
        </View>
      );
    },
    [isGrid, tileWidth, openDetail],
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
          {isFiltered ? `${total} of ${countLabel}` : countLabel}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {showControls ? (
          <View style={styles.controls}>
            {/*
              Search and the view toggle share a row: four sort pills plus a
              toggle overflows a narrow phone, and search is the control that
              wants the width.
            */}
            <View style={styles.searchRow}>
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

              <View style={styles.viewToggle}>
                {[
                  { id: 'grid', mark: '▦', label: 'Grid view' },
                  { id: 'list', mark: '▤', label: 'List view' },
                ].map((mode) => {
                  const active = view === mode.id;
                  return (
                    <Pressable
                      key={mode.id}
                      onPress={() => setView(mode.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={mode.label}
                      style={({ pressed }) => [
                        styles.viewButton,
                        active && styles.viewButtonActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.viewMark, active && styles.viewMarkActive]}>
                        {mode.mark}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewToggle: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  viewButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewButtonActive: {
    backgroundColor: colors.surfaceRaised,
  },
  viewMark: {
    fontSize: 16,
    color: colors.textTertiary,
  },
  viewMarkActive: {
    color: colors.text,
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
