import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

/**
 * A single app-wide player for Spotify's 30-second preview MP3s.
 *
 * One player instance is reused for every track (via `replace`) so that
 * starting a preview anywhere in the app implicitly stops whatever was
 * playing before — you never end up with two clips overlapping.
 */

const PreviewPlayerContext = createContext(null);

export function PreviewPlayerProvider({ children }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const [currentTrack, setCurrentTrack] = useState(null); // { id, url, title }
  const [error, setError] = useState(null);
  // Set when we swap the source and want playback to begin as soon as it loads.
  const autoPlayRef = useRef(false);

  useEffect(() => {
    // Previews should be audible even with the ringer switch flipped to silent —
    // tapping "Preview" is an explicit request to hear something.
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => {
      // Non-fatal: playback still works, it just respects the silent switch.
    });
  }, []);

  // `replace` is async under the hood, so start playback once the clip is ready.
  useEffect(() => {
    if (autoPlayRef.current && status.isLoaded && !status.playing) {
      autoPlayRef.current = false;
      try {
        player.play();
      } catch (playError) {
        setError(playError?.message ?? 'Could not play this preview.');
      }
    }
  }, [status.isLoaded, status.playing, player]);

  // A 30-second clip that runs out should reset, not sit at the end looking paused.
  useEffect(() => {
    if (status.didJustFinish) {
      setCurrentTrack(null);
      autoPlayRef.current = false;
      player.replace(null);
    }
  }, [status.didJustFinish, player]);

  const stop = useCallback(() => {
    autoPlayRef.current = false;
    setCurrentTrack(null);
    setError(null);
    try {
      player.pause();
      player.replace(null);
    } catch {
      // Already torn down — nothing to stop.
    }
  }, [player]);

  const play = useCallback(
    (track) => {
      if (!track?.url) {
        setError('Spotify did not provide a preview for this track.');
        return;
      }

      setError(null);
      setCurrentTrack({ id: track.id, url: track.url, title: track.title ?? '' });
      autoPlayRef.current = true;

      try {
        player.replace({ uri: track.url });
      } catch (replaceError) {
        autoPlayRef.current = false;
        setCurrentTrack(null);
        setError(replaceError?.message ?? 'Could not load this preview.');
      }
    },
    [player],
  );

  /** Tap the same track to pause/resume; tap a different one to switch. */
  const toggle = useCallback(
    (track) => {
      if (currentTrack?.id && track?.id === currentTrack.id) {
        if (status.playing) {
          player.pause();
        } else {
          player.play();
        }
        return;
      }
      play(track);
    },
    [currentTrack, status.playing, player, play],
  );

  const value = useMemo(
    () => ({
      currentTrackId: currentTrack?.id ?? null,
      isPlaying: status.playing,
      isBuffering: Boolean(currentTrack) && !status.isLoaded,
      position: status.currentTime ?? 0,
      duration: status.duration ?? 0,
      error,
      play,
      toggle,
      stop,
      isActive: (trackId) => currentTrack?.id === trackId,
    }),
    [currentTrack, status.playing, status.isLoaded, status.currentTime, status.duration, error, play, toggle, stop],
  );

  return <PreviewPlayerContext.Provider value={value}>{children}</PreviewPlayerContext.Provider>;
}

export function usePreviewPlayer() {
  const context = useContext(PreviewPlayerContext);
  if (!context) {
    throw new Error('usePreviewPlayer must be used inside a PreviewPlayerProvider.');
  }
  return context;
}
