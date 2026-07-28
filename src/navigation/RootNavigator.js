import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AlbumDetailScreen } from '../screens/AlbumDetailScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { ManualEntryScreen } from '../screens/ManualEntryScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, spacing, type } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/**
 * Two tabs, one shared stack. Album detail and search live above the tabs so
 * they can be reached from either side of the app.
 */
function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: styles.scene,
      }}
    >
      {/*
        Collection is first, and therefore the landing screen.
        Opening straight into the Scanner meant every launch turned on the
        camera and began billing Claude calls before the user had asked for
        anything. Scanning is now a deliberate act, and the camera permission
        prompt only appears when someone actually goes to scan.
      */}
      <Tab.Screen
        name="Collection"
        component={CollectionScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon mark="▦" color={color} />,
        }}
      />
      <Tab.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon mark="◎" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function TabIcon({ mark, color }) {
  return (
    <View style={styles.tabIcon}>
      <Text style={[styles.tabIconMark, { color }]}>{mark}</Text>
    </View>
  );
}

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: styles.header,
        headerTintColor: colors.text,
        headerTitleStyle: styles.headerTitle,
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: styles.scene,
      }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <Stack.Screen
        name="AlbumDetail"
        component={AlbumDetailScreen}
        options={{ title: 'Album', headerLargeTitle: false }}
      />
      {/*
        Both are modals, which on iOS you can swipe away — but on web there is
        no swipe and a modal without a header is a dead end. Always show a
        header with an explicit Done action.
      */}
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={({ navigation }) => ({
          title: 'Add a record',
          presentation: 'modal',
          headerRight: () => <HeaderDone onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        name="ManualEntry"
        component={ManualEntryScreen}
        options={({ navigation, route }) => ({
          title: route.params?.record ? 'Edit record' : 'Add by hand',
          presentation: 'modal',
          headerRight: () => <HeaderDone onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={({ navigation }) => ({
          title: 'Settings',
          presentation: 'modal',
          headerRight: () => <HeaderDone onPress={() => navigation.goBack()} />,
        })}
      />
    </Stack.Navigator>
  );
}

function HeaderDone({ onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={12}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Text style={styles.headerDone}>Done</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scene: {
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.background,
  },
  headerTitle: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
  },
  tabBar: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 84,
    paddingTop: spacing.sm,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconMark: {
    fontSize: 20,
  },
  headerDone: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
