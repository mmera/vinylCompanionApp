import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  describeClaudeError,
  identifyAlbumCover,
  isRetryableClaudeError,
} from '../services/claude';
import { findAlbum } from '../services/spotify';

/**
 * Drives the continuous scan loop: capture a frame, downscale it, ask Claude
 * what it is, and resolve the answer against Spotify's catalog.
 *
 * The loop is self-scheduling rather than an interval — a new capture only
 * starts once the previous round trip has settled, so a slow response can
 * never stack requests on top of each other.
 */

const SCAN_INTERVAL_MS = 1800;
// Wide enough for Claude to read cover type, small enough to upload fast.
const FRAME_WIDTH = 768;
const BACKOFF_MS = 6000;

/**
 * The video element can genuinely lag the mount by a frame or two, so a single
 * "not ready" is not worth reporting. Several in a row means no stream is
 * coming at all — typically a camera the browser refused while still telling
 * expo-camera it was ready.
 */
const CAMERA_NOT_READY = 'ERR_CAMERA_NOT_READY';
const MAX_CAMERA_STALLS = 4;
const CAMERA_STALLED_MESSAGE =
  'The camera never started sending frames. Check that this site is allowed to use the camera, then reload the page.';

function isCameraNotReady(error) {
  return error?.code === CAMERA_NOT_READY;
}

export const ScanState = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  IDENTIFIED: 'identified',
  NOT_RECOGNIZED: 'not_recognized',
  ERROR: 'error',
};

/**
 * @param {object} params
 * @param {React.RefObject} params.cameraRef  Ref to a mounted `CameraView`.
 * @param {boolean} params.enabled            Whether the loop should be running.
 */
export function useAlbumScanner({ cameraRef, enabled }) {
  const [state, setState] = useState(ScanState.IDLE);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Bumped by `reset` to restart the loop after it parks on a result or a
  // fatal error — `enabled` alone never changes in that case.
  const [runToken, setRunToken] = useState(0);

  // Loop bookkeeping lives in refs so re-renders never restart the loop.
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const timerRef = useRef(null);
  const abortRef = useRef(null);
  // Suppress the "not recognized" flash until we've actually failed a round.
  const missesRef = useRef(0);
  // Consecutive captures that found no frame to capture.
  const cameraStallsRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Capture a frame and shrink it to something cheap to send. */
  const captureFrame = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return null;

    const photo = await camera.takePictureAsync({
      quality: 0.7,
      base64: false,
      skipProcessing: true,
      shutterSound: false,
      exif: false,
    });
    if (!photo?.uri) return null;

    const image = await ImageManipulator.manipulate(photo.uri)
      .resize({ width: FRAME_WIDTH })
      .renderAsync();
    const saved = await image.saveAsync({
      compress: 0.6,
      format: SaveFormat.JPEG,
      base64: true,
    });

    return saved.base64 ?? null;
  }, [cameraRef]);

  const runOnce = useCallback(async () => {
    const base64 = await captureFrame();
    if (!base64 || cancelledRef.current) return { kind: 'skip' };

    // A frame arrived, so whatever the camera was doing before, it works now.
    cameraStallsRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    const identification = await identifyAlbumCover(base64, { signal: controller.signal });
    if (cancelledRef.current) return { kind: 'skip' };

    if (!identification.identified) return { kind: 'miss' };

    // Claude gives us names; Spotify gives us the artwork, tracklist, and links.
    const album = await findAlbum({
      artist: identification.artist,
      album: identification.album,
    });
    if (cancelledRef.current) return { kind: 'skip' };

    if (!album) {
      // Recognized the sleeve but it isn't on Spotify — still worth showing.
      return {
        kind: 'hit',
        payload: {
          album: null,
          identification,
        },
      };
    }

    return { kind: 'hit', payload: { album, identification } };
  }, [captureFrame]);

  const scheduleNext = useCallback(
    (loop, delay) => {
      if (cancelledRef.current) return;
      clearTimer();
      timerRef.current = setTimeout(loop, delay);
    },
    [clearTimer],
  );

  useEffect(() => {
    if (!enabled) return undefined;

    cancelledRef.current = false;
    missesRef.current = 0;
    cameraStallsRef.current = 0;

    const loop = async () => {
      if (cancelledRef.current || runningRef.current) return;
      runningRef.current = true;

      let delay = SCAN_INTERVAL_MS;

      try {
        const outcome = await runOnce();

        if (cancelledRef.current) return;

        if (outcome.kind === 'hit') {
          setResult(outcome.payload);
          setError(null);
          setState(ScanState.IDENTIFIED);
          missesRef.current = 0;
          // A hit pauses the loop — the result card owns the screen until
          // the user dismisses it.
          return;
        }

        if (outcome.kind === 'miss') {
          missesRef.current += 1;
          setError(null);
          // One miss is just a blurry frame; two means we're really not seeing it.
          setState(missesRef.current >= 2 ? ScanState.NOT_RECOGNIZED : ScanState.SCANNING);
        }
      } catch (scanError) {
        if (cancelledRef.current || scanError?.name === 'AbortError') return;

        /*
         * A camera failure is not a Claude failure, and describing it as one
         * produced the worst message in the app: the raw internal string
         * "HTMLVideoElement does not have enough camera data to construct an
         * image yet", shown beside a Try again button that re-ran the same
         * doomed capture forever.
         */
        if (isCameraNotReady(scanError)) {
          cameraStallsRef.current += 1;

          if (cameraStallsRef.current >= MAX_CAMERA_STALLS) {
            setError(CAMERA_STALLED_MESSAGE);
            setState(ScanState.ERROR);
            return; // No amount of retrying conjures a stream.
          }

          // Early on this is just the video buffering — say nothing and retry.
          setError(null);
          setState(ScanState.SCANNING);
        } else {
          setError(describeClaudeError(scanError));

          if (!isRetryableClaudeError(scanError)) {
            setState(ScanState.ERROR);
            return; // Configuration problem — retrying would just burn requests.
          }

          // Transient (rate limit, network, 5xx): ease off before trying again.
          setState(ScanState.ERROR);
          delay = BACKOFF_MS;
        }
      } finally {
        runningRef.current = false;
        abortRef.current = null;
      }

      scheduleNext(loop, delay);
    };

    setState(ScanState.SCANNING);
    // Small delay on start so the camera preview has settled before frame one.
    scheduleNext(loop, 600);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      abortRef.current?.abort();
      abortRef.current = null;
      runningRef.current = false;
    };
  }, [enabled, runToken, runOnce, scheduleNext, clearTimer]);

  /** Dismiss the current result and resume scanning. */
  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    missesRef.current = 0;
    cameraStallsRef.current = 0;
    setState(enabled ? ScanState.SCANNING : ScanState.IDLE);
    setRunToken((token) => token + 1);
  }, [enabled]);

  return { state, result, error, reset };
}
