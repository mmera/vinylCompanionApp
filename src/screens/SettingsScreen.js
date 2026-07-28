import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { useCredentials } from '../context/CredentialsContext';
import { verifyClaudeCredentials } from '../services/claude';
import { verifySpotifyCredentials } from '../services/spotify';
import { DEFAULT_CLAUDE_MODEL } from '../storage/credentials';
import { colors, radius, spacing, type } from '../theme';

/**
 * Key entry.
 *
 * Crate is deployed as a public static site, so nothing is compiled into the
 * bundle — each person supplies their own credentials, which are saved only
 * to this device's storage. "Test connection" exercises both APIs for real,
 * which on web doubles as a CORS check.
 */
export function SettingsScreen({ navigation, route }) {
  const { credentials, save, clear, isConfigured } = useCredentials();
  const isOnboarding = route?.params?.onboarding ?? false;

  const [form, setForm] = useState({
    claudeApiKey: '',
    spotifyClientId: '',
    spotifyClientSecret: '',
    claudeModel: '',
  });
  const [status, setStatus] = useState(null); // { kind, message }
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setForm({
      claudeApiKey: credentials.claudeApiKey,
      spotifyClientId: credentials.spotifyClientId,
      spotifyClientSecret: credentials.spotifyClientSecret,
      claudeModel: credentials.claudeModel,
    });
  }, [credentials]);

  const update = (field) => (text) => {
    setForm((current) => ({ ...current, [field]: text }));
    setStatus(null);
  };

  const complete =
    form.claudeApiKey.trim() && form.spotifyClientId.trim() && form.spotifyClientSecret.trim();

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatus(null);
    try {
      await save(form);
      setStatus({ kind: 'success', message: 'Saved to this device.' });
      if (isOnboarding) navigation.goBack();
    } catch (error) {
      setStatus({ kind: 'error', message: error.message ?? 'Could not save.' });
    } finally {
      setIsSaving(false);
    }
  }, [form, save, isOnboarding, navigation]);

  // Save first, then test — the service layer reads from the store, not the form.
  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setStatus(null);
    try {
      await save(form);
    } catch (error) {
      setStatus({ kind: 'error', message: error.message ?? 'Could not save.' });
      setIsTesting(false);
      return;
    }

    const problems = [];
    let claudeModel = null;
    let spotifyAlbum = null;

    try {
      ({ model: claudeModel } = await verifyClaudeCredentials());
    } catch (error) {
      problems.push(`Claude — ${error.message}`);
    }

    try {
      spotifyAlbum = await verifySpotifyCredentials();
    } catch (error) {
      problems.push(`Spotify — ${error.message}`);
    }

    if (problems.length) {
      setStatus({ kind: 'error', message: problems.join('\n\n') });
    } else {
      setStatus({
        kind: 'success',
        message: `Both APIs reachable.\nClaude model: ${claudeModel}\nSpotify search: ${spotifyAlbum.artist} — ${spotifyAlbum.name}`,
      });
    }
    setIsTesting(false);
  }, [form, save]);

  const handleClear = useCallback(async () => {
    await clear();
    setStatus({ kind: 'success', message: 'Keys removed from this device.' });
  }, [clear]);

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{isOnboarding ? 'Welcome to Crate' : 'Settings'}</Text>
            <Text style={styles.intro}>
              Crate talks to Claude and Spotify directly from this device. Your keys are stored
              only here — they are never sent anywhere else, and nothing is baked into the app.
            </Text>
          </View>

          <Field
            label="Claude API key"
            value={form.claudeApiKey}
            onChangeText={update('claudeApiKey')}
            placeholder="sk-ant-..."
            secure
            help="platform.claude.com → Settings → API keys"
            onHelpPress={() => Linking.openURL('https://platform.claude.com/settings/keys')}
          />

          <Field
            label="Spotify client ID"
            value={form.spotifyClientId}
            onChangeText={update('spotifyClientId')}
            placeholder="32-character ID"
            help="developer.spotify.com/dashboard → your app → Settings"
            onHelpPress={() => Linking.openURL('https://developer.spotify.com/dashboard')}
          />

          <Field
            label="Spotify client secret"
            value={form.spotifyClientSecret}
            onChangeText={update('spotifyClientSecret')}
            placeholder="32-character secret"
            secure
          />

          <Field
            label="Claude model"
            value={form.claudeModel}
            onChangeText={update('claudeModel')}
            placeholder={DEFAULT_CLAUDE_MODEL}
            help="Optional — leave blank to use the default."
          />

          {status ? (
            <View
              style={[
                styles.status,
                status.kind === 'error' ? styles.statusError : styles.statusSuccess,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  status.kind === 'error' && styles.statusTextError,
                ]}
              >
                {status.message}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={isSaving ? 'Saving…' : isOnboarding ? 'Save & start scanning' : 'Save'}
              variant="primary"
              onPress={handleSave}
              disabled={!complete || isTesting}
              loading={isSaving}
            />
            <Button
              label="Test connection"
              onPress={handleTest}
              disabled={!complete || isSaving}
              loading={isTesting}
            />
          </View>

          {isConfigured && !isOnboarding ? (
            <Pressable
              onPress={handleClear}
              accessibilityRole="button"
              style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            >
              <Text style={styles.clearLabel}>Remove keys from this device</Text>
            </Pressable>
          ) : null}

          <Text style={styles.footnote}>
            Scanning is a paid Claude API call and runs continuously while the Scanner tab is
            open. Switch tabs to stop it.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, secure, help, onHelpPress }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {secure && value ? (
          <Pressable onPress={() => setRevealed((current) => !current)} hitSlop={10}>
            <Text style={styles.reveal}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={secure && !revealed}
        accessibilityLabel={label}
      />

      {help ? (
        onHelpPress ? (
          <Pressable onPress={onHelpPress} hitSlop={6}>
            <Text style={[styles.help, styles.helpLink]}>{help} ↗</Text>
          </Pressable>
        ) : (
          <Text style={styles.help}>{help}</Text>
        )
      ) : null}
    </View>
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
  header: {
    gap: spacing.sm,
  },
  title: {
    ...type.display,
  },
  intro: {
    ...type.body,
    lineHeight: 21,
  },
  field: {
    gap: spacing.sm,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    ...type.label,
  },
  reveal: {
    ...type.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  input: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
  },
  help: {
    ...type.caption,
  },
  helpLink: {
    color: colors.textSecondary,
  },
  status: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: colors.surface,
    borderColor: colors.spotify,
  },
  statusError: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
  },
  statusText: {
    ...type.body,
    color: colors.text,
    lineHeight: 20,
  },
  statusTextError: {
    color: colors.danger,
  },
  actions: {
    gap: spacing.sm,
  },
  clear: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  clearLabel: {
    ...type.body,
    color: colors.danger,
    fontWeight: '600',
  },
  footnote: {
    ...type.caption,
    lineHeight: 18,
    textAlign: 'center',
  },
});
