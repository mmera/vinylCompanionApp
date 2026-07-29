import { Linking } from 'react-native';

/**
 * Open something in Spotify: the app if it's installed, the web player if not.
 *
 * Takes just the two link fields so it serves albums and individual tracks
 * alike — both shapes carry `spotifyUri` and `spotifyUrl`, and the logic for
 * choosing between them has nothing to do with which one it is.
 *
 * `canOpenURL` would need the scheme declared in app.json, which Expo Go
 * cannot do, so the deep link is simply attempted and its failure caught.
 *
 * @returns {Promise<boolean>} false when there was nowhere to go or nothing opened.
 */
export async function openInSpotify({ spotifyUri, spotifyUrl } = {}) {
  if (spotifyUri) {
    try {
      await Linking.openURL(spotifyUri);
      return true;
    } catch {
      // Spotify isn't installed, or the scheme is unavailable.
    }
  }

  if (!spotifyUrl) return false;

  try {
    await Linking.openURL(spotifyUrl);
    return true;
  } catch {
    return false;
  }
}
