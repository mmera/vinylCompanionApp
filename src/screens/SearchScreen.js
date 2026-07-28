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
    async (album) => {
      setAddingId(album.id);
      setError(null);
      try {
        await collection.add(album, { source: 'search' });
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

          <Pressable
            onPress={() => handleAdd(item)}
            disabled={isOwned || addingId === item.id}
            accessibilityRole="button"
            accessibilityLabel={isOwned ? 'Already in your collection' : `Add ${item.name}`}
            hitSlop={10}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            {addingId === item.id ? (
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
        <EmptyState
          mark="♫"
          title="Connect Spotify"
          message="Sign in with your Spotify account to search the catalog and pull in cover art and tracklists."
          actionLabel={spotify.isConfigured ? 'Log in with Spotify' : undefined}
          onAction={spotify.isConfigured ? spotify.signIn : undefined}
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
              message={`No albums matched "${query.trim()}". Try the artist name as well as the title.`}
            />
          ) : (
            <EmptyState
              mark="⌕"
              title="Find a record"
              message="Search Spotify's catalog and tap + to add it straight to your collection."
            />
          )
        }
      />
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
    width: 44,
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
  pressed: {
    opacity: 0.5,
  },
});
