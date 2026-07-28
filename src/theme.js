/**
 * Design tokens for Crate.
 *
 * Minimal and typography-forward: near-black canvas, white text for the thing
 * that matters (the artist), and progressively dimmer grays for everything else.
 */

export const colors = {
  background: '#0F0F0F',
  surface: '#171717',
  surfaceRaised: '#1F1F1F',
  border: '#2A2A2A',

  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#6B6B6B',

  accent: '#FFFFFF',
  spotify: '#1DB954',
  danger: '#E5484D',

  scrim: 'rgba(15, 15, 15, 0.92)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const type = {
  // Artist name — the loudest thing on any screen.
  display: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  // Album title — secondary to the artist.
  subtitle: {
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.2,
    color: colors.textSecondary,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textTertiary,
  },
};

export const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.text,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '900' },
  },
};
