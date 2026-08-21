// app/src/components/chart/chartThemes.js — UCT Chart Themes catalog + apply helper
//
// A "UCT theme" is a curated VISUAL SKIN for a chart. Unlike PRESETS/templates
// (chartDefaults.js), which snapshot a WHOLE settings blob (indicators,
// timeframes, header layout and all), a theme touches ONLY the visual layer:
// candle colors, canvas background, grid, text, crosshair, volume colors, the
// moving-average line colors, and the watermark tint — plus the up/down-derived
// bits (day-change readout, earnings markers, prev-day H/L lines) so the whole
// chart reads as one palette. Everything else the user set up is preserved.
//
// `applyThemeToSettings(settings, theme)` is a PURE merge: spread the existing
// blob, override the visual keys, mark `preset: 'custom'`. It never toggles an
// indicator, changes a timeframe favorite, or rewrites the header layout. The
// gallery UI lives in ChartThemesModal.jsx; the button that opens it is in
// ChartSettingsModal's header. "Apply to all charts" rides the same helper via
// the workspace (patchOptsWithTheme + ChartsWorkspace.applyThemeToAllCharts).

// The families, in gallery order. Each theme carries a `family` key matching one
// of these ids; the modal renders one filter pill per family (+ "All").
export const THEME_FAMILIES = [
  { id: 'dark',     label: 'Dark' },
  { id: 'light',    label: 'Light' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'vibrant',  label: 'Vibrant' },
  { id: 'muted',    label: 'Muted' },
  { id: 'mono',     label: 'Mono' },
  { id: 'contrast', label: 'High Contrast' },
]

// ── The catalog ──────────────────────────────────────────────────────────────
// Per-theme keys (all optional except id/name/family/bg/up/down):
//   bg           solid canvas color  (mutually exclusive with bgGradient)
//   bgGradient   { top, bottom }     top→bottom canvas gradient
//   up / down    candle body colors
//   upWick/downWick, upBorder/downBorder   default to up/down when omitted
//   grid         gridline color (rgba recommended)
//   text         axis/scale text color (also seeds crosshair + watermark)
//   crosshair    crosshair line color (defaults to `text`)
//   volUp/volDown  volume bar colors (default to up/down)
//   volMa        volume MA line color (optional)
//   ma           [ema9, ema20, sma50, sma200, sma5] overlay line colors
//   watermark    watermark tint (defaults to `text`)
export const CHART_THEMES = [
  // ── Dark ───────────────────────────────────────────────────────────────────
  { id: 'graphite', name: 'Graphite', family: 'dark',
    bg: '#0e0f12', up: '#26c281', down: '#e34a4a', grid: 'rgba(255,255,255,0.05)',
    text: '#8a8f99', ma: ['#5aa9ff', '#f78fb5', '#ffb454', '#b07cff', 'rgba(160,160,160,0.5)'], watermark: '#5c616b' },
  { id: 'midnight', name: 'Midnight', family: 'dark',
    bg: '#0b1220', up: '#3ddc97', down: '#ff5c7a', grid: 'rgba(120,150,220,0.07)',
    text: '#7f8bb0', ma: ['#5b8def', '#e879f9', '#f59e0b', '#22d3ee', 'rgba(148,163,184,0.5)'], watermark: '#495073' },
  { id: 'deep-forest', name: 'Deep Forest', family: 'dark',
    bg: '#0c1310', up: '#57d38c', down: '#ef6a5f', grid: 'rgba(120,200,150,0.06)',
    text: '#86a08f', ma: ['#8bd450', '#4bb3fd', '#f0a03c', '#c98bff', 'rgba(150,170,150,0.5)'], watermark: '#4d6357' },
  { id: 'warm-charcoal', name: 'Warm Charcoal', family: 'dark',
    bg: '#14110e', up: '#37c98a', down: '#e8695b', grid: 'rgba(255,220,180,0.05)',
    text: '#a1968a', ma: ['#e0a34c', '#6cc5ff', '#f06ea9', '#9be36b', 'rgba(180,170,150,0.5)'], watermark: '#645a4e' },
  { id: 'slate', name: 'Slate', family: 'dark',
    bg: '#12151a', up: '#2fd0b0', down: '#ff6b6b', grid: 'rgba(200,210,230,0.06)',
    text: '#8b95a5', ma: ['#6ea8fe', '#fe6ea8', '#ffd166', '#7bdff2', 'rgba(150,160,175,0.5)'], watermark: '#565f6d' },
  { id: 'obsidian', name: 'Obsidian', family: 'dark',
    bg: '#060708', up: '#00e08a', down: '#ff3b52', grid: 'rgba(255,255,255,0.045)',
    text: '#6f747c', ma: ['#4dabf7', '#f783ac', '#ffa94d', '#9775fa', 'rgba(140,140,145,0.5)'], watermark: '#42464c' },

  // ── Light ──────────────────────────────────────────────────────────────────
  { id: 'paper', name: 'Paper', family: 'light',
    bg: '#ffffff', up: '#1a9e4b', down: '#e0483d', upBorder: '#0e7a37', downBorder: '#a3271f',
    upWick: '#0e7a37', downWick: '#a3271f', grid: 'rgba(0,0,0,0.06)', text: '#5b6470', crosshair: '#98a1ad',
    ma: ['#2563eb', '#db2777', '#d97706', '#7c3aed', 'rgba(120,120,120,0.5)'], watermark: '#c4c9d0' },
  { id: 'cream', name: 'Cream', family: 'light',
    bg: '#faf6ee', up: '#2f9e6f', down: '#d1594b', upBorder: '#1f7a53', downBorder: '#a53f33',
    upWick: '#1f7a53', downWick: '#a53f33', grid: 'rgba(120,90,60,0.07)', text: '#7a6f5f',
    ma: ['#3b7bd6', '#c56cae', '#d98a3c', '#8a6fd6', 'rgba(150,140,120,0.5)'], watermark: '#cbbfa8' },
  { id: 'cool-gray', name: 'Cool Gray', family: 'light',
    bg: '#f4f6f8', up: '#0d9488', down: '#e11d48', upBorder: '#0a6d64', downBorder: '#a01236',
    upWick: '#0a6d64', downWick: '#a01236', grid: 'rgba(30,40,60,0.06)', text: '#64748b', crosshair: '#94a3b8',
    ma: ['#2563eb', '#db2777', '#ea580c', '#7c3aed', 'rgba(120,130,145,0.5)'], watermark: '#c4ccd6' },
  { id: 'soft-blue', name: 'Soft Blue', family: 'light',
    bg: '#eef3fb', up: '#1f9d55', down: '#e04b59', upBorder: '#157a3f', downBorder: '#a53540',
    upWick: '#157a3f', downWick: '#a53540', grid: 'rgba(40,80,160,0.07)', text: '#566a8a',
    ma: ['#2f6fed', '#e15fae', '#e58a2f', '#7a5fed', 'rgba(120,140,180,0.5)'], watermark: '#bcccea' },
  { id: 'warm-sand', name: 'Warm Sand', family: 'light',
    bg: '#f7f1e7', up: '#3f9d5a', down: '#cf5a4a', upBorder: '#2c7a41', downBorder: '#a34234',
    upWick: '#2c7a41', downWick: '#a34234', grid: 'rgba(150,110,60,0.08)', text: '#7b6a55',
    ma: ['#c07a2f', '#3f86c0', '#c05a97', '#6f9d3f', 'rgba(160,140,110,0.5)'], watermark: '#cdbfa4' },
  { id: 'mint-light', name: 'Mint Light', family: 'light',
    bg: '#f2faf6', up: '#0f9d6b', down: '#e05264', upBorder: '#0a7a51', downBorder: '#a53948',
    upWick: '#0a7a51', downWick: '#a53948', grid: 'rgba(20,120,90,0.07)', text: '#5a7a70',
    ma: ['#2f9fd0', '#d06fb0', '#d09a2f', '#6f7fd0', 'rgba(120,150,140,0.5)'], watermark: '#bfe0d2' },

  // ── Gradient (top→bottom canvas gradient across both panes) ──────────────
  { id: 'ember', name: 'Ember', family: 'gradient',
    bgGradient: { top: '#3a0e13', bottom: '#0d0507' }, up: '#35d07f', down: '#ff5b5b',
    grid: 'rgba(255,130,130,0.055)', text: '#c39090', crosshair: '#c39090',
    ma: ['#f0b45a', '#6cc5ff', '#ff8fb0', '#9be36b', 'rgba(200,160,150,0.5)'], watermark: '#7a4a4a' },
  { id: 'emerald', name: 'Emerald', family: 'gradient',
    bgGradient: { top: '#0e3a24', bottom: '#05130c' }, up: '#6ee7a0', down: '#ff6b6b',
    grid: 'rgba(150,220,170,0.06)', text: '#8bb59c',
    ma: ['#a3e635', '#4bb3fd', '#f0a03c', '#c98bff', 'rgba(150,190,160,0.5)'], watermark: '#4d6b57' },
  { id: 'teal-night', name: 'Teal Night', family: 'gradient',
    bgGradient: { top: '#0a3330', bottom: '#04110f' }, up: '#3ee0c4', down: '#ff5c8a',
    grid: 'rgba(90,220,205,0.06)', text: '#7fb8b0',
    ma: ['#37c2ff', '#ffcf5a', '#ff8fd0', '#a3e635', 'rgba(140,190,185,0.5)'], watermark: '#3f7068' },
  { id: 'ocean', name: 'Ocean', family: 'gradient',
    bgGradient: { top: '#0c2340', bottom: '#060d18' }, up: '#43d9a3', down: '#ff6b81',
    grid: 'rgba(90,150,230,0.06)', text: '#8098c0',
    ma: ['#5b8def', '#e879f9', '#f59e0b', '#22d3ee', 'rgba(140,160,200,0.5)'], watermark: '#3f5578' },
  { id: 'indigo', name: 'Indigo', family: 'gradient',
    bgGradient: { top: '#201b4d', bottom: '#0b0a1f' }, up: '#4ade80', down: '#f871a0',
    grid: 'rgba(150,140,240,0.07)', text: '#a29ad0',
    ma: ['#818cf8', '#f0abfc', '#fbbf24', '#34d399', 'rgba(170,160,220,0.5)'], watermark: '#514a7a' },
  { id: 'sunset', name: 'Sunset', family: 'gradient',
    bgGradient: { top: '#3a1c0d', bottom: '#130a05' }, up: '#8be36b', down: '#ff6a4d',
    grid: 'rgba(255,180,120,0.06)', text: '#c2a184',
    ma: ['#ffd166', '#6cc5ff', '#ff8fb0', '#a3e635', 'rgba(200,170,130,0.5)'], watermark: '#6b4f38' },
  { id: 'plum', name: 'Plum', family: 'gradient',
    bgGradient: { top: '#2e0f30', bottom: '#120714' }, up: '#5ce0b0', down: '#ff5c9c',
    grid: 'rgba(220,110,200,0.06)', text: '#b58fb0',
    ma: ['#37c2ff', '#ffd76a', '#ff8fd0', '#a56fff', 'rgba(190,150,185,0.5)'], watermark: '#6b3f60' },
  { id: 'steel', name: 'Steel', family: 'gradient',
    bgGradient: { top: '#1b2735', bottom: '#090e15' }, up: '#35d0a0', down: '#ff6b6b',
    grid: 'rgba(180,200,220,0.05)', text: '#8794a5',
    ma: ['#9bb6c4', '#c4a0b0', '#ffd166', '#7bdff2', 'rgba(150,165,180,0.5)'], watermark: '#4a5560' },

  // ── Vibrant ──────────────────────────────────────────────────────────────
  { id: 'neon', name: 'Neon', family: 'vibrant',
    bg: '#0a0a12', up: '#00ffa3', down: '#ff2d78', grid: 'rgba(255,255,255,0.05)',
    text: '#9aa0b5', ma: ['#00c2ff', '#ff00e5', '#ffd500', '#8b5cff', 'rgba(160,160,170,0.5)'], watermark: '#565b74' },
  { id: 'synthwave', name: 'Synthwave', family: 'vibrant',
    bgGradient: { top: '#241b3a', bottom: '#0e0a1a' }, up: '#2bffd9', down: '#ff477e',
    grid: 'rgba(255,120,220,0.07)', text: '#b59ad6', crosshair: '#b59ad6',
    ma: ['#22d3ee', '#ff6ad5', '#ffd76a', '#9b6aff', 'rgba(180,150,210,0.5)'], watermark: '#6d5b8a' },
  { id: 'electric', name: 'Electric', family: 'vibrant',
    bg: '#08111a', up: '#22e3b8', down: '#ff5252', grid: 'rgba(0,200,255,0.07)',
    text: '#6fb0c8', ma: ['#00b4ff', '#ff5cf0', '#ffc400', '#7c4dff', 'rgba(120,170,190,0.5)'], watermark: '#3f6572' },
  { id: 'citrus-pop', name: 'Citrus Pop', family: 'vibrant',
    bg: '#12100a', up: '#b6ff2e', down: '#ff6a3d', grid: 'rgba(255,230,120,0.06)',
    text: '#a99e7a', ma: ['#ffd400', '#4dd0ff', '#ff5ca8', '#8be34b', 'rgba(180,170,120,0.5)'], watermark: '#6a6550' },
  { id: 'magenta-dusk', name: 'Magenta Dusk', family: 'vibrant',
    bgGradient: { top: '#2a1030', bottom: '#120814' }, up: '#4dffc3', down: '#ff3d9a',
    grid: 'rgba(255,100,200,0.07)', text: '#c58fb8',
    ma: ['#37c2ff', '#ff8fd0', '#ffcf5a', '#a56fff', 'rgba(190,140,180,0.5)'], watermark: '#7a4d6b' },
  { id: 'aqua-neon', name: 'Aqua Neon', family: 'vibrant',
    bg: '#04121a', up: '#2ff5c0', down: '#ff4d6d', grid: 'rgba(0,220,220,0.07)',
    text: '#5fb8c0', ma: ['#00e0ff', '#ff5cd0', '#ffd23f', '#5c7cff', 'rgba(110,180,185,0.5)'], watermark: '#3f7a80' },

  // ── Muted ──────────────────────────────────────────────────────────────────
  { id: 'dust', name: 'Dust', family: 'muted',
    bg: '#16161a', up: '#8fbf9f', down: '#cf9b98', grid: 'rgba(255,255,255,0.045)',
    text: '#8a8a92', ma: ['#93b7d6', '#d6a3c4', '#d6c193', '#b3a3d6', 'rgba(150,150,155,0.45)'], watermark: '#55555c' },
  { id: 'sage', name: 'Sage', family: 'muted',
    bg: '#131714', up: '#9dbf94', down: '#c99a8f', grid: 'rgba(200,210,190,0.05)',
    text: '#8b938a', ma: ['#a7c5b0', '#c9a7b8', '#c9c1a7', '#b0a7c9', 'rgba(150,160,150,0.45)'], watermark: '#565c54' },
  { id: 'fog', name: 'Fog', family: 'muted',
    bg: '#171a1f', up: '#86b3b0', down: '#c79a9a', grid: 'rgba(200,215,230,0.05)',
    text: '#8a929c', ma: ['#9db4cc', '#cca3bd', '#ccc19d', '#b09dcc', 'rgba(150,158,168,0.45)'], watermark: '#565d66' },
  { id: 'clay', name: 'Clay', family: 'muted',
    bg: '#1a1613', up: '#a8bd8f', down: '#cf9a83', grid: 'rgba(230,200,170,0.05)',
    text: '#9a8f80', ma: ['#c2a86f', '#8fb0c2', '#c28fa8', '#a8c28f', 'rgba(165,150,130,0.45)'], watermark: '#5f574a' },
  { id: 'heather', name: 'Heather', family: 'muted',
    bg: '#17161c', up: '#a3b8a0', down: '#c39aad', grid: 'rgba(210,205,225,0.05)',
    text: '#918d9c', ma: ['#a6a3cf', '#cfa3c0', '#cfc7a3', '#a3cfb6', 'rgba(155,150,168,0.45)'], watermark: '#585463' },
  { id: 'stonewash', name: 'Stonewash', family: 'muted',
    bg: '#15181a', up: '#8fb8ad', down: '#c99a95', grid: 'rgba(200,215,220,0.05)',
    text: '#879199', ma: ['#9bb6c4', '#c4a0b0', '#c4bd9b', '#a99bc4', 'rgba(148,158,164,0.45)'], watermark: '#545c63' },

  // ── Mono ─────────────────────────────────────────────────────────────────
  { id: 'grayscale', name: 'Grayscale', family: 'mono',
    bg: '#121212', up: '#d4d4d4', down: '#6e6e6e', upBorder: '#eaeaea', downBorder: '#4a4a4a',
    upWick: '#c0c0c0', downWick: '#5a5a5a', grid: 'rgba(255,255,255,0.05)', text: '#8a8a8a',
    ma: ['#bdbdbd', '#8f8f8f', '#6f6f6f', '#a5a5a5', 'rgba(120,120,120,0.5)'], watermark: '#555555' },
  { id: 'paper-mono', name: 'Paper Mono', family: 'mono',
    bg: '#f7f7f5', up: '#2b2b2b', down: '#b8b8b8', upBorder: '#111111', downBorder: '#9a9a9a',
    upWick: '#111111', downWick: '#9a9a9a', grid: 'rgba(0,0,0,0.06)', text: '#6a6a6a', crosshair: '#9a9a9a',
    ma: ['#555555', '#888888', '#333333', '#aaaaaa', 'rgba(140,140,140,0.5)'], watermark: '#c9c9c9' },
  { id: 'blue-mono', name: 'Blue Mono', family: 'mono',
    bg: '#0d1119', up: '#7fb0ff', down: '#34507f', upBorder: '#a9c9ff', downBorder: '#24375c',
    upWick: '#a9c9ff', downWick: '#24375c', grid: 'rgba(120,160,230,0.06)', text: '#7f8bab',
    ma: ['#9db8ff', '#5f78b0', '#3f5590', '#b8c9ff', 'rgba(120,140,190,0.5)'], watermark: '#3f4d6b' },
  { id: 'green-mono', name: 'Green Mono', family: 'mono',
    bg: '#0b120d', up: '#6fe0a0', down: '#2f6b4a', upBorder: '#a3f0c6', downBorder: '#1f4a33',
    upWick: '#a3f0c6', downWick: '#1f4a33', grid: 'rgba(120,200,150,0.06)', text: '#7fa08c',
    ma: ['#9be0b8', '#4f9070', '#2f6b4a', '#c3f0d6', 'rgba(120,170,140,0.5)'], watermark: '#3f5c4a' },
  { id: 'amber-mono', name: 'Amber Mono', family: 'mono',
    bg: '#14100a', up: '#f0c27f', down: '#8f5f2f', upBorder: '#ffdca3', downBorder: '#6b451f',
    upWick: '#ffdca3', downWick: '#6b451f', grid: 'rgba(230,190,120,0.06)', text: '#a8947a',
    ma: ['#f0d2a3', '#b08050', '#8f5f2f', '#ffe4c3', 'rgba(180,150,110,0.5)'], watermark: '#6b543a' },
  { id: 'slate-mono', name: 'Slate Mono', family: 'mono',
    bg: '#101418', up: '#b8c4d0', down: '#55606c', upBorder: '#dae2ea', downBorder: '#3c454e',
    upWick: '#dae2ea', downWick: '#3c454e', grid: 'rgba(200,210,225,0.05)', text: '#808a95',
    ma: ['#c4ccd6', '#7f8a95', '#5f6a75', '#dae2ea', 'rgba(130,140,150,0.5)'], watermark: '#4d565f' },

  // ── High Contrast ────────────────────────────────────────────────────────
  { id: 'bold', name: 'Bold', family: 'contrast',
    bg: '#000000', up: '#00e676', down: '#ff1744', grid: 'rgba(255,255,255,0.08)',
    text: '#cfcfcf', ma: ['#2196f3', '#ffeb3b', '#ff9800', '#e040fb', 'rgba(200,200,200,0.55)'], watermark: '#4a4a4a' },
  { id: 'ink-on-white', name: 'Ink on White', family: 'contrast',
    bg: '#ffffff', up: '#007a3d', down: '#c40023', upBorder: '#004d26', downBorder: '#7a0016',
    upWick: '#004d26', downWick: '#7a0016', grid: 'rgba(0,0,0,0.1)', text: '#1a1a1a', crosshair: '#444444',
    ma: ['#0645ad', '#b3006b', '#a35200', '#5b1fb3', 'rgba(80,80,80,0.6)'], watermark: '#b0b0b0' },
  { id: 'blue-orange', name: 'Blue / Orange', family: 'contrast',
    bg: '#0b0e13', up: '#2f9bff', down: '#ff8c1a', grid: 'rgba(255,255,255,0.07)',
    text: '#c2c8d2', ma: ['#ffd23f', '#c86bff', '#3fe0a0', '#ff6ad0', 'rgba(190,195,205,0.55)'], watermark: '#4a5260' },
  { id: 'teal-magenta', name: 'Teal / Magenta', family: 'contrast',
    bg: '#07100f', up: '#00d0b0', down: '#ff2e93', grid: 'rgba(255,255,255,0.07)',
    text: '#bfd0cc', ma: ['#ffd23f', '#6ab0ff', '#b6ff5a', '#c07bff', 'rgba(180,195,190,0.55)'], watermark: '#3f5c56' },
  { id: 'hi-vis', name: 'Hi-Vis', family: 'contrast',
    bg: '#101010', up: '#7cfc00', down: '#ff3030', grid: 'rgba(255,255,255,0.08)',
    text: '#e0e0e0', ma: ['#00bfff', '#ffd700', '#ff69b4', '#ba55d3', 'rgba(210,210,210,0.55)'], watermark: '#505050' },
  { id: 'sunlight', name: 'Sunlight', family: 'contrast',
    bg: '#fbfbf7', up: '#1b7f3b', down: '#cc1f2d', upBorder: '#0e5527', downBorder: '#8a141e',
    upWick: '#0e5527', downWick: '#8a141e', grid: 'rgba(0,0,0,0.09)', text: '#2a2a2a', crosshair: '#555555',
    ma: ['#1552d6', '#c21f86', '#c26a12', '#6a1fc2', 'rgba(90,90,90,0.6)'], watermark: '#b6b6ae' },
]

export const CHART_THEME_BY_ID = Object.fromEntries(CHART_THEMES.map(t => [t.id, t]))

/**
 * Merge a theme's VISUAL layer over an existing chart-settings blob. Pure — never
 * mutates `settings`. Non-visual settings (indicators, timeframes, header layout,
 * chart type, scales, comparisons, drawings) pass straight through untouched.
 *
 * `settings` may be a fully-merged blob, a partial stored blob, or a seed — the
 * spread preserves whatever is there and only the visual keys below are replaced.
 */
export function applyThemeToSettings(settings, theme) {
  if (!theme) return settings
  const s = settings || {}
  const up = theme.up
  const down = theme.down
  const upWick = theme.upWick || up
  const downWick = theme.downWick || down
  const upBorder = theme.upBorder || up
  const downBorder = theme.downBorder || down
  const maColors = Array.isArray(theme.ma) ? theme.ma : []

  // Overlays merge POSITIONALLY (same rule mergeChartSettings uses): only recolor
  // each slot that has a themed color, keep enabled/type/period exactly as the
  // user has them. A slot past the theme's palette keeps its current color.
  const overlays = Array.isArray(s.overlays)
    ? s.overlays.map((o, i) => (maColors[i] ? { ...o, color: maColors[i] } : { ...o }))
    : s.overlays

  const bgGrad = theme.bgGradient
  const wm = theme.watermark || theme.text

  return {
    ...s,
    preset: 'custom',
    // Canvas
    background: bgGrad ? bgGrad.bottom : (theme.bg || s.background),
    bgMode: bgGrad ? 'gradient' : 'solid',
    bgGradient: bgGrad ? { top: bgGrad.top, bottom: bgGrad.bottom } : (s.bgGradient),
    textColor: theme.text || s.textColor,
    grid: { ...(s.grid || {}), color: theme.grid || (s.grid || {}).color },
    crosshair: { ...(s.crosshair || {}), color: theme.crosshair || theme.text || (s.crosshair || {}).color },
    // Candles
    candles: {
      ...(s.candles || {}),
      upColor: up, downColor: down,
      upWick, downWick, upBorder, downBorder,
      oneColor: up,
    },
    // Volume
    volume: {
      ...(s.volume || {}),
      upColor: theme.volUp || up,
      downColor: theme.volDown || down,
      ...(theme.volMa ? { maColor: theme.volMa } : {}),
    },
    overlays,
    watermark: { ...(s.watermark || {}), ...(wm ? { color: wm } : {}) },
    // Up/down-derived readouts so the whole chart reads as one palette. These are
    // COLORS only (not layout): the header day-change pair, earnings E-badge, and
    // the prev-day High/Low reference lines are all semantically up/down colored.
    header: {
      ...(s.header || {}),
      colors: { ...((s.header || {}).colors || {}), dayChangeUp: up, dayChangeDown: down },
    },
    markers: { ...(s.markers || {}), earningsBeat: up, earningsMiss: down },
    prevDayLevels: {
      ...(s.prevDayLevels || {}),
      high:  { ...((s.prevDayLevels || {}).high  || {}), color: up },
      low:   { ...((s.prevDayLevels || {}).low   || {}), color: down },
      close: { ...((s.prevDayLevels || {}).close || {}), ...(theme.text ? { color: theme.text } : {}) },
    },
  }
}

/**
 * Apply a theme to a widget's `opts` for the "apply to all charts" broadcast:
 * skins the main-tab settings AND every extra chart tab's settings. `seed` is the
 * global chart_settings blob an un-customized surface inherits, so an unedited
 * widget keeps the user's global indicators/layout and only its look changes.
 */
export function patchOptsWithTheme(opts, theme, seed) {
  const o = opts || {}
  const base = o.settings || seed || {}
  const next = { ...o, settings: applyThemeToSettings(base, theme) }
  if (Array.isArray(o.chartTabs)) {
    next.chartTabs = o.chartTabs.map(t =>
      t && typeof t === 'object'
        ? { ...t, settings: applyThemeToSettings(t.settings || seed || {}, theme) }
        : t)
  }
  return next
}
