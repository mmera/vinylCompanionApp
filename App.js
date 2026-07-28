import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CollectionProvider } from './src/context/CollectionContext';
import { PreviewPlayerProvider } from './src/context/PreviewPlayerContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationTheme } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <CollectionProvider>
        <PreviewPlayerProvider>
          <NavigationContainer theme={navigationTheme}>
            <StatusBar style="light" />
            <RootNavigator />
          </NavigationContainer>
        </PreviewPlayerProvider>
      </CollectionProvider>
    </SafeAreaProvider>
  );
}
