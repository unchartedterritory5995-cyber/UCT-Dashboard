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
    // Matched to the app's graphite: canvas = --bg #17181a, candles = the app's
    // --gain/--loss, sma50 = the brand gold accent. So a chart on Graphite reads
    // as the same surface as the rest of the app.
    bg: '#17181a', up: '#2faf68', down: '#df4646', grid: 'rgba(255,255,255,0.05)',
    text: '#9a968c', ma: ['#5ea8f7', '#f78fb5', '#dcbb5e', '#b07cff', 'rgba(160,160,160,0.5)'], watermark: '#4a4b4e' },
  { id: 'midnight', name: 'Midnight', family: 'dark',
    bg: '#0b1220', up: '#3ddc97', down: '#ff5c7a', grid: 'rgba(120,150,220,0.07)',
    text: '#7f8bb0', ma: ['#5b8def', '#e879f9', '#f59e0b', '#22d3ee', 'rgba(148,163,184,0.5)'], watermark: '#495073' },
  { id: 'deep-forest', name: 'Deep Forest', family: 'dark',
    bg: '#0a0f0c', up: '#57d38c', down: '#ef6a5f', grid: 'rgba(120,200,150,0.06)',
    text: '#86a08f', ma: ['#8bd450', '#4bb3fd', '#f0a03c', '#c98bff', 'rgba(150,170,150,0.5)'], watermark: '#4d6357' },
  { id: 'warm-charcoal', name: 'Warm Charcoal', family: 'dark',
    bg: '#14110e', up: '#37c98a', down: '#e8695b', grid: 'rgba(255,220,180,0.05)',
    text: '#a1968a', ma: ['#e0a34c', '#6cc5ff', '#f06ea9', '#9be36b', 'rgba(180,170,150,0.5)'], watermark: '#645a4e' },
  { id: 'slate', name: 'Slate', family: 'dark',
    bg: '#0f1216', up: '#2fd0b0', down: '#ff6b6b', grid: 'rgba(200,210,230,0.06)',
    text: '#8b95a5', ma: ['#6ea8fe', '#fe6ea8', '#ffd166', '#7bdff2', 'rgba(150,160,175,0.5)'], watermark: '#565f6d' },
  { id: 'obsidian', name: 'Obsidian', family: 'dark',
    bg: '#060708', up: '#00e08a', down: '#ff3b52', grid: 'rgba(255,255,255,0.045)',
    text: '#6f747c', ma: ['#4dabf7', '#f783ac', '#ffa94d', '#9775fa', 'rgba(140,140,145,0.5)'], watermark: '#42464c' },

  // ── Dark — matched to the UCT App Themes (same name + canvas color, so a
  //    trader can pair their chart look to their app look). ema9 = the app
  //    theme's accent. Candles stay the app's semantic green/red. ────────────
  { id: 'carbon', name: 'Carbon', family: 'dark',
    bg: '#0a0b0c', up: '#3cb868', down: '#e74c3c', grid: 'rgba(255,255,255,0.05)',
    text: '#7c7f85', ma: ['#4fd1c5', '#f78fb5', '#ffb454', '#7bdff2', 'rgba(150,155,160,0.5)'], watermark: '#4a4d52' },
  { id: 'midnight-navy', name: 'Midnight Navy', family: 'dark',
    bg: '#0b1020', up: '#3cb868', down: '#e74c3c', grid: 'rgba(120,150,220,0.07)',
    text: '#74809a', ma: ['#5b9bff', '#f78fb5', '#ffb454', '#7bdff2', 'rgba(140,150,175,0.5)'], watermark: '#47506a' },
  { id: 'espresso', name: 'Espresso', family: 'dark',
    bg: '#0f0b08', up: '#3cb868', down: '#e74c3c', grid: 'rgba(255,220,180,0.05)',
    text: '#897e6c', ma: ['#e0a35e', '#6cc5ff', '#f06ea9', '#9be36b', 'rgba(180,165,145,0.5)'], watermark: '#5a5044' },
  { id: 'plum', name: 'Plum', family: 'dark',
    bg: '#0f0a12', up: '#3cb868', down: '#e74c3c', grid: 'rgba(180,150,220,0.06)',
    text: '#837a8f', ma: ['#b48bf0', '#6cc5ff', '#ffb454', '#7bdff2', 'rgba(160,150,175,0.5)'], watermark: '#52495f' },
  { id: 'nord', name: 'Nord', family: 'dark',
    bg: '#12161c', up: '#3cb868', down: '#e74c3c', grid: 'rgba(200,210,230,0.06)',
    text: '#7e8797', ma: ['#88c0d0', '#f78fb5', '#ffb454', '#7bdff2', 'rgba(150,160,175,0.5)'], watermark: '#4e5766' },
  { id: 'gunmetal', name: 'Gunmetal', family: 'dark',
    bg: '#0d1013', up: '#3cb868', down: '#e74c3c', grid: 'rgba(200,210,220,0.05)',
    text: '#78818b', ma: ['#5ec8c2', '#f78fb5', '#ffb454', '#7bdff2', 'rgba(150,160,170,0.5)'], watermark: '#48515b' },
  { id: 'bordeaux', name: 'Bordeaux', family: 'dark',
    bg: '#120a0c', up: '#3cb868', down: '#e74c3c', grid: 'rgba(220,180,190,0.06)',
    text: '#8c777c', ma: ['#e07a90', '#6cc5ff', '#ffb454', '#9be36b', 'rgba(180,155,160,0.5)'], watermark: '#5c474c' },
  { id: 'storm', name: 'Storm', family: 'dark',
    bg: '#0e1013', up: '#3cb868', down: '#e74c3c', grid: 'rgba(150,160,240,0.06)',
    text: '#78808e', ma: ['#7c8cf8', '#f78fb5', '#ffb454', '#7bdff2', 'rgba(150,160,180,0.5)'], watermark: '#48505e' },
  { id: 'umber', name: 'Umber', family: 'dark',
    bg: '#0f0d0b', up: '#3cb868', down: '#e74c3c', grid: 'rgba(220,200,170,0.05)',
    text: '#877d6f', ma: ['#d98c5f', '#6cc5ff', '#f06ea9', '#9be36b', 'rgba(180,170,150,0.5)'], watermark: '#574d3f' },

  // ── Light ──────────────────────────────────────────────────────────────────
  { id: 'paper', name: 'Paper', family: 'light',
    bg: '#ffffff', up: '#1a9e4b', down: '#e0483d', upBorder: '#0e7a37', downBorder: '#a3271f',
    upWick: '#0e7a37', downWick: '#a3271f', grid: 'rgba(0,0,0,0.06)', text: '#5b6470', crosshair: '#98a1ad',
    ma: ['#2563eb', '#db2777', '#d97706', '#7c3aed', 'rgba(120,120,120,0.5)'], watermark: '#c4c9d0' },
  { id: 'cream', name: 'Cream', family: 'light',
    bg: '#faf7f0', up: '#2f9e6f', down: '#d1594b', upBorder: '#1f7a53', downBorder: '#a53f33',
    upWick: '#1f7a53', downWick: '#a53f33', grid: 'rgba(120,90,60,0.07)', text: '#7a6f5f',
    ma: ['#3b7bd6', '#c56cae', '#d98a3c', '#8a6fd6', 'rgba(150,140,120,0.5)'], watermark: '#cbbfa8' },
  { id: 'cool-gray', name: 'Cool Gray', family: 'light',
    bg: '#f7f8fa', up: '#0d9488', down: '#e11d48', upBorder: '#0a6d64', downBorder: '#a01236',
    upWick: '#0a6d64', downWick: '#a01236', grid: 'rgba(30,40,60,0.06)', text: '#64748b', crosshair: '#94a3b8',
    ma: ['#2563eb', '#db2777', '#ea580c', '#7c3aed', 'rgba(120,130,145,0.5)'], watermark: '#c4ccd6' },
  { id: 'soft-blue', name: 'Soft Blue', family: 'light',
    bg: '#f4f8fd', up: '#1f9d55', down: '#e04b59', upBorder: '#157a3f', downBorder: '#a53540',
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

  // ── Light — matched to the UCT App Themes (same name + canvas color). ──────
  { id: 'sand', name: 'Sand', family: 'light',
    bg: '#faf6f1', up: '#3f9d5a', down: '#cf5a4a', upBorder: '#2c7a41', downBorder: '#a34234',
    upWick: '#2c7a41', downWick: '#a34234', grid: 'rgba(150,110,60,0.08)', text: '#7b6a55',
    ma: ['#b5622f', '#3f86c0', '#c05a97', '#6f9d3f', 'rgba(160,140,110,0.5)'], watermark: '#cdbfa4' },
  { id: 'mint', name: 'Mint', family: 'light',
    bg: '#f4faf6', up: '#0f9d6b', down: '#e05264', upBorder: '#0a7a51', downBorder: '#a53948',
    upWick: '#0a7a51', downWick: '#a53948', grid: 'rgba(20,120,90,0.07)', text: '#5a7a70',
    ma: ['#1f8a4c', '#2f9fd0', '#d06fb0', '#d09a2f', 'rgba(120,150,140,0.5)'], watermark: '#bfe0d2' },

  // ── Gradient (top→bottom canvas gradient across both panes) ──────────────
  // A few are single-hue fades (top color → near-black); the rest BLEND TWO hues
  // top→bottom (green→red, green→blue, blue→teal, blue→purple, magenta→amber).
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
  // Two-hue: green (top) → red (bottom), TC2000 "cloud" feel.
  { id: 'forest-fire', name: 'Forest Fire', family: 'gradient',
    bgGradient: { top: '#123a1e', bottom: '#320f10' }, up: '#9be36b', down: '#ff5c5c',
    grid: 'rgba(200,180,120,0.05)', text: '#b0a888',
    ma: ['#ffd166', '#6cc5ff', '#ff8fb0', '#a3e635', 'rgba(190,175,130,0.5)'], watermark: '#5c4a3a' },
  // Two-hue: green (top) → deep blue (bottom).
  { id: 'aurora', name: 'Aurora', family: 'gradient',
    bgGradient: { top: '#0c3a30', bottom: '#0a1838' }, up: '#5eead4', down: '#fb7185',
    grid: 'rgba(120,200,210,0.06)', text: '#8fb5bc',
    ma: ['#818cf8', '#f0abfc', '#fbbf24', '#34d399', 'rgba(150,180,190,0.5)'], watermark: '#3f6068' },
  // Two-hue: blue (top) → teal (bottom).
  { id: 'ocean', name: 'Ocean', family: 'gradient',
    bgGradient: { top: '#0c2340', bottom: '#06302a' }, up: '#43d9a3', down: '#ff6b81',
    grid: 'rgba(90,170,190,0.06)', text: '#8098a0',
    ma: ['#5b8def', '#e879f9', '#f59e0b', '#22d3ee', 'rgba(140,170,180,0.5)'], watermark: '#3f5560' },
  // Two-hue: blue (top) → purple (bottom).
  { id: 'twilight', name: 'Twilight', family: 'gradient',
    bgGradient: { top: '#10224e', bottom: '#2a0f38' }, up: '#4ade80', down: '#f871a0',
    grid: 'rgba(150,150,240,0.06)', text: '#a09ad0',
    ma: ['#818cf8', '#f0abfc', '#fbbf24', '#34d399', 'rgba(165,160,215,0.5)'], watermark: '#4a4478' },
  // Two-hue: magenta (top) → amber (bottom).
  { id: 'dawn', name: 'Dawn', family: 'gradient',
    bgGradient: { top: '#2e0f38', bottom: '#3a1e0a' }, up: '#7ee0b0', down: '#ff6a5c',
    grid: 'rgba(220,160,140,0.06)', text: '#c0a0a0',
    ma: ['#37c2ff', '#ffd76a', '#ff8fd0', '#a56fff', 'rgba(190,160,150,0.5)'], watermark: '#5c4048' },

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

// Perceived luminance (0..1) of a #rrggbb color. Used to decide whether the
// OHLCV legend must be forced dark so it stays readable on a light canvas.
function _luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

// High-contrast readable ink for a given canvas color — bright on a dark canvas,
// near-black on a light one. Used for widget DATA text (symbol/price/volume/etc.),
// which must read crisply in dense rows rather than fade like the muted chart-axis
// text does. `theme.text` is intentionally subtle for the big chart canvas; widgets
// use this instead so their text always stands out.
export function readableInk(bg) {
  return _luminance(bg) > 0.55 ? '#14181d' : '#e8e8ec'
}

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

  // The legend + header title sit top-left, so a gradient's TOP color is what they
  // render over. Both are set EXPLICITLY every time (never left to inherit a stale
  // color from a prior theme) and chosen by background luminance so they stay
  // readable on any canvas — dark ink on a light canvas, light ink on a dark one.
  // `legend` is ONE color applied to BOTH the OHLCV labels and their values, so the
  // two always match (ChartPane feeds it to StockChart's single `legendColor`).
  const legendBg = bgGrad ? bgGrad.top : theme.bg
  const isLightBg = _luminance(legendBg) > 0.6
  const legend = theme.legend || (isLightBg ? '#1c2128' : '#d6d8dd')
  const title = theme.title || (isLightBg ? '#14181d' : '#e8e8ec')

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
      colors: { ...((s.header || {}).colors || {}), dayChangeUp: up, dayChangeDown: down, legend, title },
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

// Visible-but-not-bold gridline for a widget canvas — a light hairline on a dark
// canvas, a dark one on a light canvas. The raw `theme.grid` is tuned faint for a
// big chart and disappears in dense widget rows, so widgets derive their own.
export function readableGrid(bg) {
  return _luminance(bg) > 0.55 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.14)'
}

// ── "Apply to all WIDGETS" — theme every widget type ─────────────────────────
//
// Each widget type exposes a DIFFERENT subset of appearance keys. This descriptor
// says, per type: which key(s) carry the DATA text (`text`), whether it has an
// up/down color pair (`updown`) or a pos/neg pair (`posneg`, calendar), a gridline
// (`grid`), or a %-flash tint (`tint`). `mapThemeToWidgetSettings` writes only the
// keys a type understands, merged over its current blob so unrelated prefs (logos,
// fontSize, columns) survive. Text uses high-contrast `readableInk` (never the
// muted chart-axis color); grid uses `readableGrid`; up/down come from the theme.
//
// Two storage models: PER-WIDGET types keep appearance in `opts.settings` (patched
// here); GLOBAL types read a single pref (`WIDGET_GLOBAL_PREF_KEYS`) and are written
// by the workspace instead.
const _WIDGET_THEME_MAP = {
  watchlist:    { text: ['textColor'],              updown: true, grid: true, tint: true },
  scanner:      { text: ['textColor'],              updown: true, grid: true, tint: true },
  themes:       { text: ['symColor'],               updown: true, tint: true },
  fundamentals: { text: ['textColor'],              updown: true },
  breadth:      { text: ['headerColor', 'valueColor'], updown: true },
  optionsflow:  { text: ['textColor'],              updown: true },
  calendar:     { text: ['textColor'],              posneg: true },
  alerts:       { text: ['textColor'] },
  profile:      { text: ['textColor', 'headerColor'], updown: true },
  news:         { text: ['textColor', 'headerColor'], updown: true },
  nhnl:         { text: ['textColor'],              updown: true },
  aisearch:     { text: ['textColor'] },
}

// Types whose appearance lives in a single GLOBAL pref (not opts.settings). The
// workspace writes these; patchWidgetOptsWithTheme leaves their opts untouched.
export const WIDGET_GLOBAL_PREF_KEYS = {
  themes: 'theme_tracker_settings',
  fundamentals: 'fundamentals_settings',
  breadth: 'breadth_widget_settings',
  aisearch: 'aisearch_settings',
}
const _PER_WIDGET_TYPES = new Set(['watchlist', 'scanner', 'optionsflow', 'calendar', 'alerts', 'profile', 'news', 'nhnl'])
const _hex6 = (c) => /^#[0-9a-f]{6}$/i.test(c || '')

export function mapThemeToWidgetSettings(base, theme, type) {
  const cfg = _WIDGET_THEME_MAP[type]
  if (!theme || !cfg) return base
  const b = base || {}
  const grad = theme.bgGradient
  const topBg = grad ? grad.top : theme.bg
  const ink = readableInk(topBg)
  const out = {
    ...b,
    bgMode: grad ? 'gradient' : 'solid',
    bg: grad ? grad.bottom : theme.bg,
    ...(grad ? { bgGradient: { top: grad.top, bottom: grad.bottom } } : {}),
  }
  for (const k of cfg.text) out[k] = ink
  if (cfg.updown) { out.upColor = theme.up; out.downColor = theme.down }
  if (cfg.posneg) { out.posColor = theme.up; out.negColor = theme.down }
  if (cfg.grid) out.gridColor = readableGrid(topBg)
  if (cfg.tint && _hex6(theme.up) && _hex6(theme.down)) {
    out.tintEnabled = true
    out.tintUp = theme.up + '47'    // ~28% alpha, matching the widget defaults
    out.tintDown = theme.down + '47'
  }
  return out
}

/**
 * Patch ONE PER-WIDGET widget's (or widget-tab's) opts to adopt `theme`. Charts get
 * the full chart mapping (incl. chart tabs); watchlist/scanner/optionsflow/calendar/
 * alerts/profile/news get their opts.settings mapped. GLOBAL-pref widgets (themes/
 * fundamentals/breadth/aisearch) are handled by the workspace via their pref, so
 * their opts pass through unchanged here.
 */
export function patchWidgetOptsWithTheme(type, opts, theme, chartSeed) {
  if (type === 'chart') return patchOptsWithTheme(opts, theme, chartSeed)
  if (_PER_WIDGET_TYPES.has(type)) {
    const o = opts || {}
    return { ...o, settings: mapThemeToWidgetSettings(o.settings || {}, theme, type) }
  }
  return opts || {}
}
