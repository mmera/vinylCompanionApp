import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BackupProvider } from './src/context/BackupContext';
import { CollectionProvider } from './src/context/CollectionContext';
import { CredentialsProvider, useCredentials } from './src/context/CredentialsContext';
import { PreviewPlayerProvider } from './src/context/PreviewPlayerContext';
import { SpotifyAuthProvider } from './src/context/SpotifyAuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors, navigationTheme } from './src/theme';

// Closes the popup window that Spotify redirects back into on web. Must run
// at module scope, before the app renders, or the popup never hands the code
// back to the opener.
WebBrowser.maybeCompleteAuthSession();

/**
 * Credentials are read from device storage, so hold the UI until that load
 * finishes — otherwise the first frame flashes a "missing keys" state for
 * someone who has already entered them.
 */
function Shell() {
  const { isReady } = useCredentials();

  if (!isReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CredentialsProvider>
        <SpotifyAuthProvider>
          <CollectionProvider>
            {/* Inside the collection, since it mirrors it; above the UI, so
                backups keep running whether or not Settings is open. */}
            <BackupProvider>
              <PreviewPlayerProvider>
                <Shell />
              </PreviewPlayerProvider>
            </BackupProvider>
          </CollectionProvider>
        </SpotifyAuthProvider>
      </CredentialsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
