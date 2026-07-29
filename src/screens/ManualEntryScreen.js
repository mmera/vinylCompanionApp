import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useCollection } from '../context/CollectionContext';
import { OWNED, WISHLIST } from '../storage/collection';
import { colors, radius, spacing, type } from '../theme';

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
  // Editing keeps whatever list the record is already on; only a new record
  // asks, and defaults to owned because that is the common case.
  const [status, setStatus] = useState(existing?.status ?? route.params?.status ?? OWNED);
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
      if (isEditing) {
        await collection.updateManual(existing.id, form);
        if (status !== existing.status) await collection.setStatus(existing.id, status);
      } else {
        await collection.addManual(form, { status });
      }
      navigation.goBack();
    } catch (saveError) {
      setError(saveError.message ?? 'Could not save this record.');
      setIsSaving(false);
    }
  }, [collection, existing, form, isEditing, navigation, status]);

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

          <View style={styles.statusField}>
            <Text style={styles.statusLabel}>Where does it go?</Text>
            <View style={styles.statusChoices}>
              {[
                { id: OWNED, label: 'I own it' },
                { id: WISHLIST, label: 'Wishlist' },
              ].map((choice) => {
                const active = choice.id === status;
                return (
                  <Pressable
                    key={choice.id}
                    onPress={() => setStatus(choice.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.statusChoice,
                      active && styles.statusChoiceActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[styles.statusChoiceLabel, active && styles.statusChoiceLabelActive]}
                    >
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={
              isSaving
                ? 'Saving…'
                : isEditing
                  ? 'Save changes'
                  : status === WISHLIST
                    ? 'Add to wishlist'
                    : 'Add to collection'
            }
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
  statusField: {
    gap: spacing.sm,
  },
  statusLabel: {
    ...type.label,
  },
  statusChoices: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusChoice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusChoiceActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  statusChoiceLabel: {
    ...type.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  statusChoiceLabelActive: {
    color: colors.background,
  },
  pressed: {
    opacity: 0.6,
  },
});
