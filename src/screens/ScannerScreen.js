import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ScanResultCard } from '../components/ScanResultCard';
import { ScanState, useAlbumScanner } from '../hooks/useAlbumScanner';
import { useCredentials } from '../context/CredentialsContext';
import { useSpotifyAuth } from '../context/SpotifyAuthContext';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
import {
  CAMERA_RECOVERY_STEPS,
  describeCameraError,
  isPermissionBlocked,
} from '../utils/cameraErrors';
import { httpsUrl, isSecureContext } from '../utils/secureContext';
import { colors, radius, spacing, type } from '../theme';

/**
 * Point the phone at a sleeve and it identifies itself — no shutter button.
 * The camera analyses a frame roughly every two seconds while this tab is
 * focused, and parks on a result card once it recognizes something.
 */
export function ScannerScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  // Only `stop` is pulled off the context: the context value itself changes
  // identity on every playback tick, and depending on it here would tear the
  // camera down mid-preview.
  const { stop: stopPreview } = usePreviewPlayer();

  // Stop the camera (and the scan loop) whenever we leave the tab, so we're
  // not shipping frames to the API from a screen nobody is looking at.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
        setIsCameraReady(false);
        stopPreview();
      };
    }, [stopPreview]),
  );

  const { hasClaude } = useCredentials();
  const spotify = useSpotifyAuth();
  const isConfigured = hasClaude && spotify.isSignedIn;

  /*
   * On web, do NOT gate the camera behind a separate permission request.
   *
   * expo-camera's web `requestCameraPermissionsAsync` calls `getUserMedia`
   * and then immediately stops the tracks it was granted — so asking first
   * and *then* mounting CameraView triggers two prompts back to back. Safari
   * compounds this: it has no `navigator.permissions` entry for the camera
   * (so the check always reports "undetermined") and it doesn't persist the
   * grant for sites that aren't installed to the Home Screen.
   *
   * Mounting CameraView directly means exactly one getUserMedia call. A
   * refusal surfaces through `onMountError` instead, which we handle below.
   */
  const usesNativePermissionFlow = Platform.OS !== 'web';
  const [mountError, setMountError] = useState(null); // { message, blocked }

  /*
   * expo-camera's web stream hook calls `onMountError` and then calls
   * `onCameraReady()` anyway — unconditionally, in the same tick, even when
   * getUserMedia returned nothing (`resumeAsync` in useWebCameraStream, which
   * only skips the ready callback when the new and old streams match, and
   * `compareStreams(null, null)` is false).
   *
   * So "ready" arrives immediately after "failed". Clearing the error there
   * meant a denied camera looked live: the scan loop started against a video
   * element with no stream and every frame died with ERR_CAMERA_NOT_READY.
   * The ref lets the ready callback see a failure reported microseconds
   * earlier, which state set in the same tick cannot.
   */
  const mountErrorRef = useRef(null);

  const permissionSettled = usesNativePermissionFlow ? permission?.granted === true : !mountError;

  const scanningEnabled = isFocused && isCameraReady && isConfigured && permissionSettled;

  const { state, result, error, reset } = useAlbumScanner({
    cameraRef,
    enabled: scanningEnabled,
  });

  const openDetail = useCallback(
    (album) => {
      stopPreview();
      navigation.navigate('AlbumDetail', { albumId: album.id, album });
    },
    [navigation, stopPreview],
  );

  const dismiss = useCallback(() => {
    stopPreview();
    reset();
  }, [stopPreview, reset]);

  // Over plain HTTP the browser refuses camera access outright. The page tries
  // to upgrade itself to HTTPS on load, so reaching here means that failed —
  // usually a custom domain whose certificate hasn't been issued yet.
  if (!isSecureContext()) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <EmptyState
          mark="⚠"
          title="Camera needs a secure connection"
          message={`Browsers only allow camera access over HTTPS. This page was loaded over plain HTTP, so scanning can't start.\n\nTry ${httpsUrl()} — if that fails, the site's HTTPS certificate may still be pending.`}
        />
      </SafeAreaView>
    );
  }

  if (!isConfigured) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <EmptyState
          mark="⚙"
          title="Add your API keys"
          message={
            !spotify.isSignedIn && !hasClaude
              ? 'Scanning needs a Spotify sign-in and your Claude API key. Both are set up in Settings.'
              : !spotify.isSignedIn
                ? 'Sign in with Spotify so Crate can look up whatever it recognises.'
                : 'Cover recognition uses Claude. Add your API key in Settings — it stays on this device.'
          }
          actionLabel="Open Settings"
          onAction={() => navigation.navigate('Settings', { onboarding: true })}
        />
      </SafeAreaView>
    );
  }

  // Native: ask explicitly, which is the expected iOS pattern and only ever
  // produces one system prompt.
  if (usesNativePermissionFlow) {
    if (!permission) {
      return (
        <View style={[styles.fill, styles.centered]}>
          <ActivityIndicator color={colors.text} />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          {/*
            Once iOS has been told no, the app cannot ask again — so offer the
            one thing that works, which is a jump straight to Crate's own page
            in Settings, rather than a sentence telling the user to go find it.
          */}
          <EmptyState
            mark="◉"
            title="Camera access needed"
            message={
              permission.canAskAgain
                ? 'Crate identifies album covers straight from the camera. Nothing is recorded or stored — frames are analysed and discarded.'
                : 'Camera access is off for Crate, and iOS only lets you turn it back on from Settings.'
            }
            actionLabel={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
            onAction={permission.canAskAgain ? requestPermission : Linking.openSettings}
          />
        </SafeAreaView>
      );
    }
  }

  /*
   * Two ways to learn the camera isn't working, one thing to say about it.
   *
   * Mounting can fail outright, or it can "succeed" and then never deliver a
   * frame — which is what a browser-refused camera looks like from inside the
   * scan loop. Both end here rather than the loop growing its own copy of the
   * recovery advice.
   */
  const cameraFailure =
    mountError ??
    (state === ScanState.CAMERA_UNAVAILABLE
      ? { message: 'The camera never started sending frames.', blocked: true }
      : null);

  if (cameraFailure) {
    /*
     * A blocked camera and a dismissed prompt need different offers.
     *
     * Dismissing the prompt leaves the browser willing to ask again, so
     * remounting the camera genuinely re-prompts. An outright block is
     * remembered per origin and getUserMedia then rejects without prompting —
     * retrying can only fail, so the honest action is a reload, to be used
     * after the setting is changed.
     */
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <EmptyState
          mark="◉"
          title={cameraFailure.blocked ? 'Camera is blocked' : 'Camera unavailable'}
          message={
            cameraFailure.blocked
              ? `${cameraFailure.message}\n\nBrowsers remember this per site, so Crate can’t ask again — it has to be changed in your browser, then reloaded.\n\n${CAMERA_RECOVERY_STEPS}`
              : `${cameraFailure.message}\n\nIf you dismissed the permission prompt, try again and allow it.`
          }
          actionLabel={cameraFailure.blocked ? 'Reload page' : 'Try again'}
          onAction={() => {
            if (cameraFailure.blocked) {
              reloadPage();
              return;
            }
            // Clearing the error swaps this SafeAreaView back for the camera
            // view, which remounts CameraView and re-runs getUserMedia. The
            // reset clears any stall verdict the loop reached, which would
            // otherwise keep this screen up after a successful retry.
            mountErrorRef.current = null;
            setMountError(null);
            reset();
          }}
          secondaryActionLabel={cameraFailure.blocked ? undefined : 'Reload page'}
          onSecondaryAction={cameraFailure.blocked ? undefined : reloadPage}
        />
      </SafeAreaView>
    );
  }

  const showResult = state === ScanState.IDENTIFIED && result;

  return (
    <View style={styles.fill}>
      {isFocused ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          animateShutter={false}
          /*
           * `autofocus` is deliberately left at its default of "off", which
           * reads backwards: in expo-camera "off" means focus continuously as
           * needed, and "on" means focus once and then *lock*. Continuous is
           * what a scanner wants, and it matters most up close where depth of
           * field is shallow — setting this to "on" would lock focus and make
           * a hand-held sleeve blurrier, not sharper.
           */
          onCameraReady={() => {
            // Only trustworthy if mounting didn't just fail — see above.
            if (mountErrorRef.current) return;
            setIsCameraReady(true);
          }}
          onMountError={(event) => {
            // The DOMException is under `nativeEvent`; `event.message` is
            // undefined, which is how the real reason used to be lost.
            const cause = event?.nativeEvent ?? event;
            const failure = {
              message: describeCameraError(cause),
              blocked: isPermissionBlocked(cause),
            };
            mountErrorRef.current = failure;
            setIsCameraReady(false);
            setMountError(failure);
          }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraPlaceholder]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <StatusPill state={state} error={error} showResult={Boolean(showResult)} />
      </SafeAreaView>

      {/*
        Corner brackets spanning nearly the whole frame, not a small box in
        the middle.

        The capture is never cropped — the entire frame goes to Claude — so a
        260pt reticle on a ~390pt screen was asking people to fit a 12" sleeve
        into two-thirds of the frame width. That is about 13" away rather than
        the 8" the capture actually needs, and centring a record inside a small
        square while holding both it and the phone is what drives people to put
        the sleeve down on a table. The guide now shows what is really being
        looked at, which is all of it.
      */}
      {!showResult ? (
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.frameGuide}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <Text style={styles.reticleHint}>Hold it close — filling the frame is good</Text>
        </View>
      ) : null}

      <SafeAreaView style={styles.resultAnchor} edges={['bottom']} pointerEvents="box-none">
        {showResult ? (
          <ScanResultCard result={result} onDismiss={dismiss} onOpenDetail={openDetail} />
        ) : null}

        {state === ScanState.ERROR && error ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" onPress={reset} style={styles.errorAction} />
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

/**
 * Changing a site's camera setting doesn't affect the running page — Chrome
 * and Safari only apply it on the next load, so the reload is part of the fix
 * rather than a suggestion to try turning it off and on again.
 */
function reloadPage() {
  if (typeof window !== 'undefined' && window.location?.reload) window.location.reload();
}

/** Small live-status chip so it's always clear whether the loop is running. */
function StatusPill({ state, error, showResult }) {
  if (showResult) return null;

  const isWorking = state === ScanState.SCANNING || state === ScanState.IDLE;
  const label =
    state === ScanState.NOT_RECOGNIZED
      ? 'Not recognized — keep it steady'
      : state === ScanState.ERROR
        ? (error ?? 'Something went wrong')
        : 'Scanning…';

  return (
    <View style={styles.pill}>
      {isWorking ? <ActivityIndicator size="small" color={colors.text} /> : null}
      <Text style={styles.pillLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPlaceholder: {
    backgroundColor: colors.background,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.scrim,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    maxWidth: '86%',
  },
  pillLabel: {
    ...type.body,
    color: colors.text,
    fontSize: 14,
    flexShrink: 1,
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  // Square, because sleeves are — but as wide as the frame allows.
  frameGuide: {
    width: '88%',
    maxWidth: 460,
    aspectRatio: 1,
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: radius.sm,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: radius.sm,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: radius.sm,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: radius.sm,
  },
  reticleHint: {
    ...type.label,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  resultAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  errorBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorText: {
    ...type.body,
    color: colors.text,
    textAlign: 'center',
  },
  errorAction: {
    alignSelf: 'center',
    minWidth: 180,
  },
});
