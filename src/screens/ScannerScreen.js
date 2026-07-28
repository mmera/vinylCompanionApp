import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ScanResultCard } from '../components/ScanResultCard';
import { ScanState, useAlbumScanner } from '../hooks/useAlbumScanner';
import { useCredentials } from '../context/CredentialsContext';
import { usePreviewPlayer } from '../context/PreviewPlayerContext';
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

  const { isConfigured, missing } = useCredentials();
  const scanningEnabled =
    isFocused && isCameraReady && isConfigured && permission?.granted === true;

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

  if (!isConfigured) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <EmptyState
          mark="⚙"
          title="Add your API keys"
          message={`Crate needs your ${missing.join(' and ')} before it can scan. They stay on this device.`}
          actionLabel="Open Settings"
          onAction={() => navigation.navigate('Settings', { onboarding: true })}
        />
      </SafeAreaView>
    );
  }

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
        <EmptyState
          mark="◉"
          title="Camera access needed"
          message="Crate identifies album covers straight from the camera. Nothing is recorded or stored — frames are analysed and discarded."
          actionLabel={permission.canAskAgain ? 'Allow camera' : undefined}
          onAction={permission.canAskAgain ? requestPermission : undefined}
        />
        {!permission.canAskAgain ? (
          <Text style={styles.settingsHint}>
            Enable camera access for Crate in your device Settings.
          </Text>
        ) : null}
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
          onCameraReady={() => setIsCameraReady(true)}
          onMountError={() => setIsCameraReady(false)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraPlaceholder]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <StatusPill state={state} error={error} showResult={Boolean(showResult)} />
      </SafeAreaView>

      {!showResult ? (
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle} />
          <Text style={styles.reticleHint}>Point at an album cover</Text>
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
  reticle: {
    width: 260,
    height: 260,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  reticleHint: {
    ...type.label,
    color: 'rgba(255,255,255,0.7)',
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
  settingsHint: {
    ...type.caption,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
});
