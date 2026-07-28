import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { spacing, type } from '../theme';

export function EmptyState({
  mark,
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      {mark ? <Text style={styles.mark}>{mark}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant={secondaryActionLabel ? 'primary' : 'secondary'}
          style={styles.action}
        />
      ) : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <Button label={secondaryActionLabel} onPress={onSecondaryAction} style={styles.secondary} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  mark: {
    fontSize: 34,
    marginBottom: spacing.xs,
    opacity: 0.5,
  },
  title: {
    ...type.title,
    textAlign: 'center',
  },
  message: {
    ...type.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    marginTop: spacing.md,
    minWidth: 220,
  },
  secondary: {
    minWidth: 220,
  },
});
