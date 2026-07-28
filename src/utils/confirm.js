import { Alert, Platform } from 'react-native';

/**
 * A confirmation prompt that actually appears on both platforms.
 *
 * react-native-web ships `Alert` as `class Alert { static alert() {} }` — an
 * empty function. Any confirm-then-destroy flow written against it therefore
 * does nothing at all in a browser, silently, which is exactly where Crate is
 * mostly used. The button looks live, the record never goes away.
 *
 * @returns {Promise<boolean>} whether the action was confirmed.
 */
export function confirmDestructive({ title, message, confirmLabel = 'OK' }) {
  if (Platform.OS !== 'web') {
    return new Promise((resolve) => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  }

  // No `window.confirm` means we cannot ask — proceed rather than leave a
  // button that does nothing, since pressing it was itself the intent.
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return Promise.resolve(true);
  }

  return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
}
