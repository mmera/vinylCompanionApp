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
import { useSpotifyAuth } from '../context/SpotifyAuthContext';
import { verifyClaudeCredentials } from '../services/claude';
import { verifySpotifyConnection } from '../services/spotify';
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
  const { credentials, save, clear, hasClaude, persistence, origin } = useCredentials();
  const spotify = useSpotifyAuth();
  const isOnboarding = route?.params?.onboarding ?? false;

  const [form, setForm] = useState({ claudeApiKey: '', claudeModel: '' });
  const [status, setStatus] = useState(null); // { kind, message }
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setForm({
      claudeApiKey: credentials.claudeApiKey,
      claudeModel: credentials.claudeModel,
    });
  }, [credentials]);

  const update = (field) => (text) => {
    setForm((current) => ({ ...current, [field]: text }));
    setStatus(null);
  };

  const complete = Boolean(form.claudeApiKey.trim());

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
      spotifyAlbum = await verifySpotifyConnection();
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
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{isOnboarding ? 'Welcome to Crate' : 'Settings'}</Text>
            <Text style={styles.intro}>
              Sign in with Spotify to browse the catalog. Cover recognition uses Claude, which
              is a paid API — that key is yours and stays on this device.
            </Text>
          </View>

          <SpotifySection spotify={spotify} />

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

          <StorageNote isConfigured={hasClaude} persistence={persistence} origin={origin} />

          {hasClaude && !isOnboarding ? (
            <Pressable
              onPress={handleClear}
              accessibilityRole="button"
              style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            >
              <Text style={styles.clearLabel}>Remove keys from this device</Text>
            </Pressable>
          ) : null}

          <Text style={styles.footnote}>
            Scanning is a paid Claude API call. It runs only while the Scanner tab is open, and
            stops the moment you leave it.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Spotify sign-in.
 *
 * No credentials to type: PKCE means the app carries only a public client ID
 * and the user authorises with their own account.
 */
function SpotifySection({ spotify }) {
  if (!spotify.isConfigured) {
    return (
      <View style={styles.storageNote}>
        <Text style={styles.fieldLabel}>Spotify</Text>
        <Text style={styles.storageNoteText}>
          This build has no Spotify client ID, so catalog search is unavailable. See the README
          for how to set EXPO_PUBLIC_SPOTIFY_CLIENT_ID.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.spotifySection}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>Spotify</Text>
        <Text style={styles.spotifyState}>
          {spotify.isSignedIn ? 'Signed in' : 'Not signed in'}
        </Text>
      </View>

      <Button
        label={spotify.isSignedIn ? 'Sign out of Spotify' : 'Log in with Spotify'}
        variant={spotify.isSignedIn ? 'secondary' : 'spotify'}
        onPress={spotify.isSignedIn ? spotify.signOut : spotify.signIn}
        disabled={!spotify.isSignedIn && !spotify.canSignIn}
        loading={spotify.isSigningIn}
      />

      {spotify.error ? <Text style={styles.spotifyError}>{spotify.error}</Text> : null}

      {!spotify.isSignedIn && spotify.redirectUri ? (
        <Text style={styles.storageNoteText}>
          If sign-in fails with an invalid redirect URI, add this exact value to your Spotify
          app&rsquo;s Redirect URIs:{'\n'}
          {spotify.redirectUri}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Where the keys live, and whether the browser has promised to keep them.
 *
 * Worth stating plainly: storage is per-origin, so opening the app at a
 * different address (http vs https, or a different domain) presents an empty
 * store and looks like the keys were lost.
 */
function StorageNote({ isConfigured, persistence, origin }) {
  if (!isConfigured) return null;

  const lines = [];

  if (origin) {
    lines.push(`Saved in this browser for ${origin}. Opening Crate at a different address means entering them again.`);
  } else {
    lines.push('Saved on this device.');
  }

  if (persistence.supported && persistence.persisted) {
    lines.push('This browser has marked the storage as persistent, so it will not be cleared automatically.');
  } else if (persistence.supported) {
    lines.push(
      'This browser has not granted persistent storage, so it may clear the keys if space runs low — or, on iOS, after about a week without a visit. Adding Crate to your Home Screen makes it far more likely to be granted.',
    );
  }

  return (
    <View style={styles.storageNote}>
      {lines.map((line) => (
        <Text key={line} style={styles.storageNoteText}>
          {line}
        </Text>
      ))}
    </View>
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
  spotifySection: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spotifyState: {
    ...type.caption,
    color: colors.textSecondary,
  },
  spotifyError: {
    ...type.caption,
    color: colors.danger,
    lineHeight: 18,
  },
  storageNote: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storageNoteText: {
    ...type.caption,
    lineHeight: 18,
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
