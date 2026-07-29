import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useCollection } from '../context/CollectionContext';
import { colors, spacing, type } from '../theme';

/**
 * Adding a record Spotify has never heard of.
 *
 * Private pressings, bootlegs, most 7"s, and anything long out of print simply
 * aren't in the catalog — and a collection app that can only hold what a
 * streaming service knows about isn't a record of what's on the shelf. These
 * records carry no cover art or tracklist, so the form asks for the least that
 * still identifies a record: who made it and what it's called.
 *
 * Doubles as the editor for records added this way, since a typo would
 * otherwise only be fixable by deleting and starting again.
 */
export function ManualEntryScreen({ navigation, route }) {
  const existing = route.params?.record ?? null;
  const isEditing = Boolean(existing);

  const collection = useCollection();

  const [form, setForm] = useState({
    artist: existing?.artist ?? route.params?.artist ?? '',
    name: existing?.name ?? route.params?.name ?? '',
    year: existing?.year ?? route.params?.year ?? '',
    notes: existing?.notes ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (text) => {
    setForm((current) => ({ ...current, [field]: text }));
    setError(null);
  };

  const complete = Boolean(form.artist.trim() && form.name.trim());

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (isEditing) await collection.updateManual(existing.id, form);
      else await collection.addManual(form);
      navigation.goBack();
    } catch (saveError) {
      setError(saveError.message ?? 'Could not save this record.');
      setIsSaving(false);
    }
  }, [collection, existing, form, isEditing, navigation]);

  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            {isEditing
              ? 'This record was added by hand, so its details are yours to change.'
              : 'For records Spotify doesn’t carry. There’ll be no cover art or tracklist — just the record, on your shelf.'}
          </Text>

          <Field
            label="Artist"
            value={form.artist}
            onChangeText={update('artist')}
            placeholder="Sun Ra"
            autoFocus={!isEditing}
          />

          <Field
            label="Album"
            value={form.name}
            onChangeText={update('name')}
            placeholder="The Heliocentric Worlds of Sun Ra"
          />

          <Field
            label="Year"
            value={form.year}
            onChangeText={update('year')}
            placeholder="1965"
            keyboardType="number-pad"
            help="Optional — used for sorting by era."
          />

          <Field
            label="Notes"
            value={form.notes}
            onChangeText={update('notes')}
            placeholder="Original ESP-Disk pressing, mono"
            multiline
            help="Optional — pressing, condition, where you found it."
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Add to collection'}
            variant="primary"
            onPress={handleSave}
            disabled={!complete}
            loading={isSaving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  intro: {
    ...type.body,
    lineHeight: 21,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    lineHeight: 18,
  },
});
