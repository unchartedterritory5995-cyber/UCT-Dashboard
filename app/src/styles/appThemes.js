/* ── UCT App Themes ──────────────────────────────────────────────────────────
   A catalog of app-wide visual "skins" (the app-theme sibling of the /charts UCT
   Chart Themes). Each theme restyles the page chrome only — background/surface/
   border tones, text tone, and a single per-theme accent that replaces the brand
   gold. It does NOT touch charts (StockChart ignores the app theme) and it does
   NOT change gain=green / loss=red (those stay constant across every theme).

   HOW IT'S APPLIED (see components/Layout.jsx): the stored `theme` pref holds a
   value like `uct:slate`. We set data-theme to the theme's BASE ('oled' for dark
   themes, 'light' for light themes) so every token the theme doesn't override
   falls back to a sensible, already-legible value (gain/loss, glass, shadows,
   menus…), THEN write the theme's specific tokens as inline custom properties on
   <html>. Switching away clears those inline properties.

   OLED Black and Light remain the two always-present base themes and are NOT in
   this catalog — they're plain data-theme values with no inline overrides. */

// "#rrggbb" -> "r, g, b"
function triplet(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

// Expand an accent hex into the three gold-slot tokens the UI reads for accents.
// --accent is defined as var(--ut-gold) in tokens.css, so overriding --ut-gold
// cascades to every var(--accent) use for free. dim = subtle fill, glow = border.
function accentVars(hex, dim, glow) {
  const t = triplet(hex)
  return {
    '--ut-gold': hex,
    '--ut-gold-dim': `rgba(${t}, ${dim})`,
    '--ut-gold-glow': `rgba(${t}, ${glow})`,
  }
}

// Dark-family theme. `p` = { bg, surface, elevated, hover, border, borderAccent,
// text, muted, bright, heading, accent }.
function dark(id, name, p) {
  return {
    id, name, family: 'dark', accent: p.accent,
    tokens: {
      '--bg': p.bg, '--bg-surface': p.surface, '--bg-elevated': p.elevated,
      '--bg-hover': p.hover, '--border': p.border, '--border-accent': p.borderAccent,
      '--text': p.text, '--text-muted': p.muted, '--text-bright': p.bright,
      '--text-heading': p.heading,
      // OWNER DECISION (2026-08-24): the app accent is PINNED to the warm brand
      // gold on every theme (themes vary bg/text tones only). Was p.accent — the
      // per-theme accent. Restore per-theme accents by swapping '#dcbb5e' → p.accent.
      ...accentVars('#dcbb5e', 0.12, 0.30),
    },
  }
}

// Light-family theme. Base = the [data-theme="light"] block, which already inverts
// text to near-black and darkens gain/loss, so a light theme mainly retints the
// background ramp + border and supplies a darkened accent legible on white.
function light(id, name, p) {
  return {
    id, name, family: 'light', accent: p.accent,
    tokens: {
      '--bg': p.bg, '--bg-surface': p.surface, '--bg-elevated': p.elevated,
      '--bg-hover': p.hover, '--border': p.border, '--border-accent': p.borderAccent,
      ...(p.text ? { '--text': p.text, '--text-muted': p.muted, '--text-bright': p.bright, '--text-heading': p.heading } : {}),
      // Pinned gold (darkened for legibility on light bg) — see the dark() note.
      ...accentVars('#7a5c16', 0.10, 0.24),
    },
  }
}

export const APP_THEME_FAMILIES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]

export const APP_THEMES = [
  // ── Dark (12) — muted, smooth, one accent each ──
  dark('slate', 'Slate', {
    bg: '#0f1216', surface: '#161a20', elevated: '#1c222a', hover: '#232a34',
    border: '#262d38', borderAccent: '#333d4a',
    text: '#b0b3b9', muted: '#7c8698', bright: '#dfe6ef', heading: '#f0f4f9', accent: '#6ea8fe' }),
  dark('graphite', 'Graphite', {
    bg: '#101012', surface: '#17181b', elevated: '#1d1f23', hover: '#24262b',
    border: '#2a2c31', borderAccent: '#383b41',
    text: '#b0b2b8', muted: '#7f8288', bright: '#e4e6ea', heading: '#f2f3f5', accent: '#9aa7b4' }),
  dark('carbon', 'Carbon', {
    bg: '#0a0b0c', surface: '#121315', elevated: '#191a1d', hover: '#202225',
    border: '#26282c', borderAccent: '#34373c',
    text: '#b0b2b7', muted: '#7c7f85', bright: '#e2e4e8', heading: '#f0f1f3', accent: '#4fd1c5' }),
  dark('navy', 'Midnight Navy', {
    bg: '#0b1020', surface: '#121a2e', elevated: '#182238', hover: '#1f2b44',
    border: '#26324c', borderAccent: '#33415f',
    text: '#b0b3ba', muted: '#74809a', bright: '#dbe3f2', heading: '#eef2fb', accent: '#5b9bff' }),
  dark('forest', 'Deep Forest', {
    bg: '#0a0f0c', surface: '#111813', elevated: '#16201a', hover: '#1d2921',
    border: '#24322a', borderAccent: '#324237',
    text: '#b0b4b0', muted: '#75847b', bright: '#dde8e1', heading: '#eef4f0', accent: '#46c37d' }),
  dark('espresso', 'Espresso', {
    bg: '#0f0b08', surface: '#17120d', elevated: '#1e1811', hover: '#262016',
    border: '#2e2519', borderAccent: '#3d3220',
    text: '#b8b2a6', muted: '#897e6c', bright: '#ece2d2', heading: '#f5ecdc', accent: '#e0a35e' }),
  dark('plum', 'Plum', {
    bg: '#0f0a12', surface: '#17111c', elevated: '#1e1724', hover: '#261e2e',
    border: '#2e2438', borderAccent: '#3d3149',
    text: '#b3afba', muted: '#837a8f', bright: '#e5dded', heading: '#f1ebf6', accent: '#b48bf0' }),
  dark('nord', 'Nord', {
    bg: '#12161c', surface: '#1a1f27', elevated: '#212731', hover: '#2a313c',
    border: '#313947', borderAccent: '#3f4a5b',
    text: '#b1b5bc', muted: '#7e8797', bright: '#e0e6ee', heading: '#eff3f8', accent: '#88c0d0' }),
  dark('gunmetal', 'Gunmetal', {
    bg: '#0d1013', surface: '#14181c', elevated: '#1a1f24', hover: '#21272d',
    border: '#282f36', borderAccent: '#363f48',
    text: '#b0b3b8', muted: '#78818b', bright: '#dfe5ea', heading: '#eef2f5', accent: '#5ec8c2' }),
  dark('bordeaux', 'Bordeaux', {
    bg: '#120a0c', surface: '#1a1013', elevated: '#221518', hover: '#2b1c20',
    border: '#342227', borderAccent: '#452e34',
    text: '#b9b2b4', muted: '#8c777c', bright: '#eddde1', heading: '#f6ebee', accent: '#e07a90' }),
  dark('storm', 'Storm', {
    bg: '#0e1013', surface: '#15181d', elevated: '#1b1f26', hover: '#22272f',
    border: '#2a303a', borderAccent: '#38404d',
    text: '#b0b3ba', muted: '#78808e', bright: '#dfe4ec', heading: '#eef1f7', accent: '#7c8cf8' }),
  dark('umber', 'Umber', {
    bg: '#0f0d0b', surface: '#17140f', elevated: '#1e1a14', hover: '#26211a',
    border: '#2e2820', borderAccent: '#3d352a',
    text: '#b6b1a6', muted: '#877d6f', bright: '#e9e0d3', heading: '#f3ebdf', accent: '#d98c5f' }),

  // ── Light (6) — soft, clean, darkened accent legible on white ──
  light('paper', 'Paper', {
    bg: '#ffffff', surface: '#f6f7f9', elevated: '#ffffff', hover: '#eef0f3',
    border: '#e4e7ec', borderAccent: '#cfd4db', accent: '#4f56d6' }),
  light('cream', 'Cream', {
    bg: '#faf7f0', surface: '#f3efe4', elevated: '#fffdf8', hover: '#ece7d9',
    border: '#e3ddcd', borderAccent: '#d3cbb5', accent: '#a9781f' }),
  light('coolgray', 'Cool Gray', {
    bg: '#f7f8fa', surface: '#eef1f4', elevated: '#ffffff', hover: '#e6eaef',
    border: '#dde2e8', borderAccent: '#c9d0d9', accent: '#275fd0' }),
  light('softblue', 'Soft Blue', {
    bg: '#f4f8fd', surface: '#e9f1fb', elevated: '#ffffff', hover: '#dfeaf7',
    border: '#d3e2f2', borderAccent: '#bcd2ea', accent: '#2f6fed' }),
  light('sand', 'Sand', {
    bg: '#faf6f1', surface: '#f2ebe1', elevated: '#fffdf9', hover: '#ece2d5',
    border: '#e2d8c8', borderAccent: '#d0c3ad', accent: '#b5622f' }),
  light('mint', 'Mint', {
    bg: '#f4faf6', surface: '#e8f3ec', elevated: '#ffffff', hover: '#ddeee3',
    border: '#d0e6d8', borderAccent: '#b8d9c4', accent: '#1f8a4c' }),
]

export const APP_THEME_BY_ID = Object.fromEntries(APP_THEMES.map(t => [t.id, t]))

// Every CSS custom property any theme may set — cleared before switching so a new
// theme never inherits a stale inline value from the previous one.
export const ALL_APP_THEME_VARS = [
  '--bg', '--bg-surface', '--bg-elevated', '--bg-hover', '--border', '--border-accent',
  '--text', '--text-muted', '--text-bright', '--text-heading',
  '--ut-gold', '--ut-gold-dim', '--ut-gold-glow',
]

// A `theme` pref value like "uct:slate" selects a catalog theme.
export const UCT_PREFIX = 'uct:'
export function isUctTheme(value) { return typeof value === 'string' && value.startsWith(UCT_PREFIX) }
export function uctThemeId(value) { return isUctTheme(value) ? value.slice(UCT_PREFIX.length) : null }
export function uctThemeValue(id) { return UCT_PREFIX + id }

// Remove every inline app-theme custom property from an element (returns to a
// plain base theme driven entirely by data-theme + tokens.css).
export function clearAppThemeVars(el) {
  for (const k of ALL_APP_THEME_VARS) el.style.removeProperty(k)
}

// Apply a catalog theme: base data-theme + inline token overrides. Clears first so
// switching between two UCT themes never leaves a stale property behind.
export function applyAppTheme(el, theme) {
  clearAppThemeVars(el)
  el.dataset.theme = theme.family === 'light' ? 'light' : 'oled'
  for (const [k, v] of Object.entries(theme.tokens)) el.style.setProperty(k, v)
}
