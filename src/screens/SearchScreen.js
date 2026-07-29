import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlbumArt } from '../components/AlbumArt';
import { EmptyState } from '../components/EmptyState';
import { useSpotifyAuth } from '../context/SpotifyAuthContext';
import { searchAlbums } from '../services/spotify';
import { useCollection } from '../context/CollectionContext';
import { OWNED, WISHLIST } from '../storage/collection';
import { colors, radius, spacing, type } from '../theme';

const DEBOUNCE_MS = 350;

/** Manual entry path: type a record's name, pick it out of Spotify's catalog. */
export function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [addingId, setAddingId] = useState(null);

  const collection = useCollection();
  const spotify = useSpotifyAuth();

  /*
   * Scanning is the fastest way to add a record and the reason the app exists,
   * but it lived only behind its own tab — so "Add a record" offered every
   * route except the good one.
   *
   * The tab routes are nested inside the stack route `Tabs`, so a bare
   * navigate('Scanner') bubbles to the root stack, finds nothing and no-ops.
   * Targeting the parent dismisses this modal and selects the tab in one
   * dispatch; goBack() followed by navigate() races the dismissal animation.
   */
  const scanInstead = useCallback(
    () => navigation.navigate('Tabs', { screen: 'Scanner' }),
    [navigation],
  );
  // Guards against a slow early request overwriting a newer one's results.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setError(null);
      setHasSearched(false);
      setIsSearching(false);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const albums = await searchAlbums(trimmed);
        if (requestId !== requestIdRef.current) return;
        setResults(albums);
        setError(null);
      } catch (searchError) {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(searchError.message ?? 'Search failed.');
      } finally {
        if (requestId === requestIdRef.current) {
          setIsSearching(false);
          setHasSearched(true);
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const handleAdd = useCallback(
    async (album, status) => {
      setAddingId(`${album.id}:${status}`);
      setError(null);
      try {
        await collection.add(album, { source: 'search', status });
      } catch (addError) {
        setError(addError.message ?? 'Could not save this record.');
      } finally {
        setAddingId(null);
      }
    },
    [collection],
  );

  const renderItem = useCallback(
    ({ item }) => {
      const isOwned = collection.owns(item.id);
      const isWishlisted = collection.isWishlisted(item.id);
      return (
        <View style={styles.row}>
          <Pressable
            style={styles.rowMain}
            onPress={() => navigation.navigate('AlbumDetail', { albumId: item.id, album: item })}
            accessibilityRole="button"
            accessibilityLabel={`${item.artist}, ${item.name}`}
          >
            <AlbumArt uri={item.thumbnailUrl} size={56} label={item.name} />
            <View style={styles.rowText}>
              <Text style={styles.rowArtist} numberOfLines={1}>
                {item.artist}
              </Text>
              <Text style={styles.rowAlbum} numberOfLines={1}>
                {item.name}
              </Text>
              {item.year ? <Text style={styles.rowYear}>{item.year}</Text> : null}
            </View>
          </Pressable>

          {/* Wishlist first, collection second — the rightmost button is the
              one under the thumb, and owning is the more common outcome. */}
          <Pressable
            onPress={() => handleAdd(item, WISHLIST)}
            disabled={isOwned || isWishlisted || addingId !== null}
            accessibilityRole="button"
            accessibilityLabel={
              isWishlisted ? 'Already on your wishlist' : `Add ${item.name} to wishlist`
            }
            hitSlop={6}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            {addingId === `${item.id}:${WISHLIST}` ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text
                style={[styles.addMark, (isOwned || isWishlisted) && styles.addMarkOwned]}
              >
                {isWishlisted ? '♥' : '♡'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => handleAdd(item, OWNED)}
            disabled={isOwned || addingId !== null}
            accessibilityRole="button"
            accessibilityLabel={
              isOwned
                ? 'Already in your collection'
                : isWishlisted
                  ? `Move ${item.name} to your collection`
                  : `Add ${item.name}`
            }
            hitSlop={6}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            {addingId === `${item.id}:${OWNED}` ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={[styles.addMark, isOwned && styles.addMarkOwned]}>
                {isOwned ? '✓' : '+'}
              </Text>
            )}
          </Pressable>
        </View>
      );
    },
    [collection, navigation, handleAdd, addingId],
  );

  if (!spotify.isSignedIn) {
    return (
      <SafeAreaView style={styles.fill} edges={['bottom']}>
        {/*
          Manual entry needs no Spotify account, so this state offers it too —
          otherwise the only way to add a record is behind a sign-in.
        */}
        <EmptyState
          mark="♫"
          title="Connect Spotify"
          message="Sign in with your Spotify account to search the catalog and pull in cover art and tracklists. You can add records by hand without it."
          actionLabel={spotify.isConfigured ? 'Log in with Spotify' : undefined}
          onAction={spotify.isConfigured ? spotify.signIn : undefined}
          secondaryActionLabel="Add a record by hand"
          onSecondaryAction={() => navigation.replace('ManualEntry')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search albums or artists"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search Spotify for an album"
        />
        {isSearching ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
        <Pressable
          onPress={scanInstead}
          accessibilityRole="button"
          accessibilityLabel="Scan a cover instead"
          hitSlop={10}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.scanMark}>◎</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, results.length === 0 && styles.listEmpty]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isSearching ? null : hasSearched ? (
            <EmptyState
              mark="○"
              title="Nothing found"
              message={`No albums matched “${query.trim()}”. Try the artist name as well as the title — or, if it's a private pressing or out of print, add it by hand.`}
              actionLabel="Add by hand"
              onAction={() => navigation.replace('ManualEntry', { name: query.trim() })}
            />
          ) : (
            <EmptyState
              mark="⌕"
              title="Find a record"
              message="Search Spotify's catalog and tap + to add it straight to your collection."
              actionLabel="Add a record by hand"
              onAction={() => navigation.replace('ManualEntry')}
              secondaryActionLabel="Scan a cover"
              onSecondaryAction={scanInstead}
            />
          )
        }
      />

      {/*
        Also reachable with results on screen: Spotify returning ten wrong
        pressings is the common way a rare record "isn't there", and that state
        never renders the empty view.
      */}
      {results.length > 0 ? (
        <Pressable
          onPress={() => navigation.replace('ManualEntry', { name: query.trim() })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.manualLink, pressed && styles.pressed]}
        >
          <Text style={styles.manualLinkLabel}>Not the right record? Add it by hand</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    height: 48,
    color: colors.text,
    fontSize: 16,
  },
  scanMark: {
    fontSize: 20,
    color: colors.textSecondary,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  listEmpty: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  rowArtist: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
  },
  rowAlbum: {
    ...type.caption,
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowYear: {
    ...type.caption,
    marginTop: 1,
  },
  addButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMark: {
    fontSize: 24,
    color: colors.text,
    fontWeight: '300',
  },
  addMarkOwned: {
    fontSize: 18,
    color: colors.textTertiary,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  manualLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  manualLinkLabel: {
    ...type.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.5,
  },
});
