// app/src/lib/theme — the one way a canvas chart reads (and follows) the app theme.
export {
  resolveThemeColor, resolveThemeSize, resolveThemeInks, normalizeToken,
  withAlpha, lumaOf, isLightSurface, contrastRatio, ensureContrast,
} from './resolveThemeColor'
export { useThemeInk, useThemeVersion, subscribeTheme, getThemeVersion } from './useThemeInk'

/**
 * The semantic data inks every chart may ask for, with the dark-theme value as
 * the jsdom fallback. Spread it into a `useThemeInk` spec.
 */
export const SEMANTIC_INK = Object.freeze({
  gain: ['--gain', '#2faf68'],
  loss: ['--loss', '#df4646'],
  warn: ['--warn', '#dcbb5e'],
  info: ['--info', '#5ea8f7'],
  gold: ['--ut-gold', '#dcbb5e'],
})

/** Chart chrome inks (surface, rules, text), dark-theme fallbacks. */
export const CHROME_INK = Object.freeze({
  bg: ['--bg', '#101012'],
  surface: ['--bg-surface', '#17181b'],
  elevated: ['--bg-elevated', '#1d1f23'],
  border: ['--border', '#2a2c31'],
  borderAccent: ['--border-accent', '#383b41'],
  text: ['--text', '#f0efea'],
  muted: ['--text-muted', '#cfcac0'],
  bright: ['--text-bright', '#f8f7f3'],
  heading: ['--text-heading', '#ffffff'],
})

/** Type-scale sizes as canvas px (follow the phone comfort scale). */
export const SIZE_INK = Object.freeze({
  xs: { size: '--text-xs', fallback: 10 },
  sm: { size: '--text-sm', fallback: 11 },
  base: { size: '--text-base', fallback: 12 },
  md: { size: '--text-md', fallback: 13 },
})
