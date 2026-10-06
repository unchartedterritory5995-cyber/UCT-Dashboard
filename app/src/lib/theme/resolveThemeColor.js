// app/src/lib/theme/resolveThemeColor.js
//
// ⭐ THE ONE PLACE A CANVAS CHART ASKS "WHAT COLOUR IS THIS TOKEN RIGHT NOW?"
//
// A canvas (ECharts, Chart.js, Lightweight Charts, a raw 2D context) cannot
// resolve `var(--token)`: handed one, it silently drops the colour or paints
// black. So a chart colour has to be the token's RESOLVED value, read off
// <html>, where both `[data-theme]` and the member's catalog theme
// (styles/appThemes.js writes its tokens as INLINE custom properties on <html>)
// land.
//
// ⛔ A TOKEN CAN RESOLVE TO SOMETHING A CANVAS STILL CANNOT PARSE. Some tokens
// are written as `color-mix(…)` or as a `var()` alias; the computed value of a
// custom property keeps `color-mix()` as text. Those go through a probe element
// (the browser does the mixing) and then through a 2D context's `fillStyle`,
// which serialises any colour it accepts back to `#rrggbb` / `rgba(…)` — the two
// forms every chart engine parses. jsdom has neither a colour engine nor a
// canvas, so there the fallback is returned instead of a string the chart would
// drop.
//
// Pure: no React, no subscriptions. `useThemeInk.js` is the hook that re-renders
// on a theme change.

const PLAIN = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i

/** `'gain'`, `'--gain'` and `'var(--gain)'` all name the same token. */
export function normalizeToken(token) {
  if (typeof token !== 'string') return ''
  const t = token.trim()
  const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(t)
  if (m) return m[1]
  return t.startsWith('--') ? t : `--${t}`
}

function rootEl() {
  if (typeof document === 'undefined') return null
  return document.documentElement || null
}

let canvasCtx
function canvasNormalize(value) {
  try {
    if (canvasCtx === undefined) {
      canvasCtx = null
      // jsdom logs "Not implemented" for getContext — only ask in a real browser.
      if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return null
      const c = document.createElement('canvas')
      canvasCtx = c.getContext && c.getContext('2d')
    }
    if (!canvasCtx) return null
    // A sentinel first: an unparsable value leaves fillStyle unchanged.
    canvasCtx.fillStyle = '#010203'
    canvasCtx.fillStyle = value
    const out = String(canvasCtx.fillStyle)
    if (out === '#010203' && !/^#010203$/i.test(value)) return null
    return out
  } catch {
    return null
  }
}

function probeResolve(value, root) {
  try {
    const host = document.body || root
    const probe = document.createElement('span')
    probe.style.display = 'none'
    probe.style.color = value
    if (!probe.style.color) return null // the engine refused the value
    host.appendChild(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    if (!out) return null
    if (PLAIN.test(out)) return out
    return canvasNormalize(out)
  } catch {
    return null
  }
}

/**
 * The token's current colour, ready for a canvas.
 * @param {string} token  `--gain`, `gain` or `var(--gain)`
 * @param {string} fallback  returned when the token is unset or unresolvable
 *   (tests, a detached render, a server render).
 */
export function resolveThemeColor(token, fallback) {
  try {
    const root = rootEl()
    if (!root || typeof getComputedStyle !== 'function') return fallback
    const name = normalizeToken(token)
    if (!name) return fallback
    const raw = getComputedStyle(root).getPropertyValue(name).trim()
    if (!raw) return fallback
    if (PLAIN.test(raw)) return raw
    return probeResolve(raw, root) || fallback
  } catch {
    return fallback
  }
}

/**
 * A size token (`--text-xs`) as a number of px, for canvas `fontSize`s. Follows
 * the phone comfort scale (tokens.css lifts the small steps under 640px).
 */
export function resolveThemeSize(token, fallbackPx) {
  try {
    const root = rootEl()
    if (!root || typeof getComputedStyle !== 'function') return fallbackPx
    const raw = getComputedStyle(root).getPropertyValue(normalizeToken(token)).trim()
    const m = /^(-?[\d.]+)px$/.exec(raw)
    return m ? Number(m[1]) : fallbackPx
  } catch {
    return fallbackPx
  }
}

/**
 * Resolve a whole map at once.
 *   { gain: ['--gain', '#2faf68'], axis: { token: '--text-muted', fallback: '#cfcac0' },
 *     xs: { size: '--text-xs', fallback: 10 } }
 * → { gain: '#…', axis: '#…', xs: 10 }
 */
export function resolveThemeInks(spec) {
  const out = {}
  if (!spec || typeof spec !== 'object') return out
  for (const [key, entry] of Object.entries(spec)) {
    if (Array.isArray(entry)) out[key] = resolveThemeColor(entry[0], entry[1])
    else if (entry && typeof entry === 'object' && entry.size) out[key] = resolveThemeSize(entry.size, entry.fallback)
    else if (entry && typeof entry === 'object') out[key] = resolveThemeColor(entry.token, entry.fallback)
    else out[key] = entry
  }
  return out
}

/** `#rrggbb` / `#rgb` / `rgb(…)` → `rgba(r, g, b, a)`; anything else unchanged. */
export function withAlpha(color, alpha) {
  if (typeof color !== 'string') return color
  const c = color.trim()
  let r, g, b
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(x => x + x).join('') : hex[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
    if (!m) return color
    r = Math.round(+m[1]); g = Math.round(+m[2]); b = Math.round(+m[3])
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Rec. 601 luma of a resolved colour (0..255), or null when unparsable. */
export function lumaOf(color) {
  const c = withAlpha(color, 1)
  const m = /^rgba\((\d+), (\d+), (\d+)/.exec(c || '')
  if (!m) return null
  return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]
}

/** True when the resolved surface reads as a light background. */
export function isLightSurface(color) {
  const l = lumaOf(color)
  return l != null && l > 140
}

function rgbOf(color) {
  const c = withAlpha(color, 1)
  const m = /^rgba\((\d+), (\d+), (\d+)/.exec(c || '')
  return m ? [+m[1], +m[2], +m[3]] : null
}

function relLum([r, g, b]) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio of two resolved colours, or null when either is unparsable. */
export function contrastRatio(a, b) {
  const x = rgbOf(a), y = rgbOf(b)
  if (!x || !y) return null
  const [l1, l2] = [relLum(x), relLum(y)].sort((p, q) => q - p)
  return (l1 + 0.05) / (l2 + 0.05)
}

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')

/**
 * A series colour nudged until it clears `min`:1 against `surface` — darkened
 * toward black on a light surface, lightened toward white on a dark one, hue
 * kept. A colour that already clears is returned UNCHANGED (same string), and
 * so is anything unparsable or translucent (a ghost / fill is meant to recede).
 * 3:1 is WCAG's floor for non-text graphics (lines, bars, marks).
 */
export function ensureContrast(color, surface, min = 3) {
  if (typeof color !== 'string') return color
  const c = color.trim()
  if (/^rgba\(/i.test(c) && !/,\s*1(\.0+)?\s*\)$/.test(c)) return color
  if (/^#[0-9a-f]{8}$/i.test(c) || /^#[0-9a-f]{4}$/i.test(c)) return color
  const rgb = rgbOf(c), bg = rgbOf(surface)
  if (!rgb || !bg) return color
  const cr = contrastRatio(c, surface)
  if (cr == null || cr >= min) return color
  const toward = relLum(bg) > 0.4 ? 0 : 255
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = rgb.map((v) => v + (toward - v) * t)
    const out = `#${mixed.map(hex2).join('')}`
    if (contrastRatio(out, surface) >= min) return out
  }
  return toward === 0 ? '#000000' : '#ffffff'
}
