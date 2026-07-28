import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CollectionProvider } from './src/context/CollectionContext';
import { CredentialsProvider, useCredentials } from './src/context/CredentialsContext';
import { PreviewPlayerProvider } from './src/context/PreviewPlayerContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors, navigationTheme } from './src/theme';

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
        <CollectionProvider>
          <PreviewPlayerProvider>
            <Shell />
          </PreviewPlayerProvider>
        </CollectionProvider>
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
