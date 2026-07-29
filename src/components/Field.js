import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

/**
 * A labelled text input.
 *
 * `secure` adds a show/hide toggle for API keys; `multiline` grows the box for
 * notes. Settings and manual entry had grown separate copies of this that
 * differed only in which of those two they supported.
 */
export function Field({
  label,
  help,
  onHelpPress,
  secure = false,
  multiline = false,
  value,
  ...inputProps
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.field}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        {secure && value ? (
          <Pressable onPress={() => setRevealed((current) => !current)} hitSlop={10}>
            <Text style={styles.reveal}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>

      <TextInput
        {...inputProps}
        value={value}
        multiline={multiline}
        secureTextEntry={secure && !revealed}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, multiline && styles.inputMultiline]}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={label}
      />

      {help ? (
        onHelpPress ? (
          <Pressable onPress={onHelpPress} hitSlop={6}>
            <Text style={[styles.help, styles.helpLink]}>{help} ↗</Text>
          </Pressable>
        ) : (
          <Text style={styles.help}>{help}</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...type.label,
  },
  reveal: {
    ...type.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  help: {
    ...type.caption,
  },
  helpLink: {
    color: colors.textSecondary,
  },
});
