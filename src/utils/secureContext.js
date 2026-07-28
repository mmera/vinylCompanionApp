import { Platform } from 'react-native';

/**
 * Browsers only expose the camera in a secure context (HTTPS, or localhost).
 * Over plain HTTP `getUserMedia` rejects and the preview stays black with
 * nothing but a console error — so check up front and say so plainly.
 *
 * Always true on native, where the concept doesn't apply.
 */
export function isSecureContext() {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return true;
  // `isSecureContext` is universally supported in browsers new enough to run
  // this app; treat an unexpected absence as "fine" rather than blocking.
  return window.isSecureContext !== false;
}

/** The current origin, for telling someone exactly what to switch to. */
export function httpsUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return `https://${window.location.host}${window.location.pathname}`;
}
