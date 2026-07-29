/**
 * Reading getUserMedia failures.
 *
 * The browser reports every camera problem as a DOMException whose `name` is
 * the only reliable signal — the `message` is vendor-specific prose. "Blocked"
 * and "no camera attached" need completely different advice, so translate the
 * name rather than showing whatever string the browser happened to supply.
 */

export function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'This site isn’t allowed to use the camera.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app.';
    case 'OverconstrainedError':
      return 'No camera matched what Crate asked for.';
    case 'SecurityError':
      return 'The browser blocked camera access on this page.';
    default:
      return error?.message || 'The browser refused access to the camera.';
  }
}

/**
 * A refusal the page cannot undo.
 *
 * Browsers remember a camera denial per origin, and `getUserMedia` then
 * rejects immediately without prompting — so there is nothing a "try again"
 * button can do, and offering one is a lie. The block has to be lifted in
 * browser settings, which is what the steps below are for.
 */
export function isPermissionBlocked(error) {
  return error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
}

/** Where the setting actually lives, per browser. */
export const CAMERA_RECOVERY_STEPS = [
  'iPhone or iPad, in Safari: tap “aA” in the address bar → Website Settings → Camera → Ask or Allow.',
  'Chrome or Edge: tap the icon to the left of the address → Camera → Allow, then reload.',
  'Added to the Home Screen: iOS Settings → Crate → Camera.',
].join('\n\n');
