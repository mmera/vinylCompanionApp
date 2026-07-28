import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

/**
 * Buttons come in three weights: `primary` (white, one per screen),
 * `spotify` (brand green, for anything that leaves the app), and
 * `secondary` (outlined, everything else).
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  loading = false,
  icon = null,
  style,
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.background : colors.text}
        />
      ) : (
        <View style={styles.content}>
          {icon ? <Text style={[styles.icon, styles[`${variant}Label`]]}>{icon}</Text> : null}
          <Text style={[styles.label, styles[`${variant}Label`]]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  spotify: {
    backgroundColor: colors.spotify,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  icon: {
    fontSize: 14,
  },
  primaryLabel: {
    color: colors.background,
  },
  secondaryLabel: {
    color: colors.text,
  },
  spotifyLabel: {
    color: '#FFFFFF',
  },
});
