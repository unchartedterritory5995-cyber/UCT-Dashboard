// app/src/styles/tokens.test.js
//
// Tokens are CSS, not JS — so this is a source-text contract test, not a render
// test. It reads the real tokens.css off disk and asserts the research-kit
// token layer (spec §3.1/§3.2) exists with the exact values the kit components
// are built against.
//
// The heat ladder is deliberately checked CROSS-FILE against its source of
// truth (Breadth.module.css .bgG3….bgR3). If someone retunes Breadth, this
// fails instead of the two silently forking.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Strip comments so a brace or a `--token:` mentioned in prose can never
    // be mistaken for a declaration.
    .replace(/\/\*[\s\S]*?\*\//g, '')

const TOKENS = read('./tokens.css')
const BREADTH = read('../pages/Breadth.module.css')

/** Body text of the first block whose selector matches, by brace matching.
 *
 * M2: anchored with a boundary regex (selector followed by optional
 * whitespace then `,` or `{`) rather than `indexOf`, which would happily
 * match `.bgA` inside `.bgAlt`. The selector is escaped so a literal `.` in
 * e.g. `.t-num` isn't read as a regex wildcard. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*[,{]`)
  const m = re.exec(css)
  if (!m) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', m.index)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, j)
    }
  }
  throw new Error(`unterminated block: ${selector}`)
}

/** Declared value of a property inside a block body, or null. */
function decl(body, prop) {
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`)
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

const squash = (s) => (s == null ? null : s.replace(/\s+/g, ''))

const ROOT = block(TOKENS, ':root')
const OLED = block(TOKENS, '[data-theme="oled"]')
const LIGHT = block(TOKENS, '[data-theme="light"]')

describe('tokens.css — research-kit score ramp (§3.1)', () => {
  it('defines the 5 score tokens with the hexes scoreColor() hardcodes today', () => {
    expect(decl(ROOT, '--score-elite')).toBe('#3cb868')
    expect(decl(ROOT, '--score-strong')).toBe('#7fb84e')
    expect(decl(ROOT, '--score-neutral')).toBe('#c9a84c')
    expect(decl(ROOT, '--score-weak')).toBe('#e08a3c')
    expect(decl(ROOT, '--score-poor')).toBe('#e74c3c')
  })

  it('aliases letter grades onto the score ramp (never a second hex ladder)', () => {
    expect(decl(ROOT, '--grade-a')).toBe('var(--score-elite)')
    expect(decl(ROOT, '--grade-b')).toBe('var(--score-strong)')
    expect(decl(ROOT, '--grade-c')).toBe('var(--score-neutral)')
    expect(decl(ROOT, '--grade-d')).toBe('var(--score-weak)')
    expect(decl(ROOT, '--grade-f')).toBe('var(--score-poor)')
  })
})

describe('tokens.css — heat tiers match the Breadth ladder (§3.1)', () => {
  const PAIRS = [
    ['--heat-g3', '.bgG3'],
    ['--heat-g2', '.bgG2'],
    ['--heat-g1', '.bgG1'],
    ['--heat-a', '.bgA'],
    ['--heat-r1', '.bgR1'],
    ['--heat-r2', '.bgR2'],
    ['--heat-r3', '.bgR3'],
  ]

  it.each(PAIRS)('%s equals Breadth %s background', (token, cls) => {
    const tokenValue = squash(decl(ROOT, token))
    const breadthValue = squash(decl(block(BREADTH, cls), 'background'))
    expect(tokenValue).not.toBeNull()
    expect(breadthValue).not.toBeNull()
    expect(tokenValue).toBe(breadthValue)
  })
})

describe('tokens.css — glass surfaces (§3.1)', () => {
  it('defines the glass surface set on the dark default', () => {
    expect(decl(ROOT, '--glass-surface')).toBe('rgba(34, 37, 30, 0.55)')
    expect(decl(ROOT, '--glass-elevated')).toBe('rgba(42, 45, 36, 0.58)')
    expect(decl(ROOT, '--glass-border-neutral')).toBe('rgba(224, 218, 200, 0.10)')
    expect(decl(ROOT, '--glass-border-accent')).toBe('rgba(201, 168, 76, 0.42)')
    expect(decl(ROOT, '--glass-inner-glow')).not.toBeNull()
  })

  it('--glass-chrome is near-opaque so pinned text never sits on translucency', () => {
    const chrome = decl(ROOT, '--glass-chrome')
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(chrome)?.[1])
    expect(Number.isFinite(alpha)).toBe(true)
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('re-states the glass surfaces for the oled theme', () => {
    expect(decl(OLED, '--glass-surface')).not.toBeNull()
    expect(decl(OLED, '--glass-elevated')).not.toBeNull()
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(decl(OLED, '--glass-chrome'))?.[1])
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('does NOT define glass on the light theme — §3.2 defers it, deliberately', () => {
    // When the post-launch app-wide token sweep (§10) adapts glass to light,
    // DELETE this test in the same commit. Until then it keeps the deferral a
    // recorded decision instead of an accidental half-migration.
    expect(/--glass-[a-z-]+\s*:/.test(LIGHT)).toBe(false)
  })
})

describe('tokens.css — focus ring + display size (§3.1/§3.2)', () => {
  it('defines --focus-ring', () => {
    expect(decl(ROOT, '--focus-ring')).not.toBeNull()
  })

  it('defines --text-display at ~40px (the 24px scale cap is insufficient)', () => {
    expect(decl(ROOT, '--text-display')).toBe('40px')
  })
})

describe('tokens.css — .t-num utility (§3.2)', () => {
  it('exists as a global class and sets tabular-nums', () => {
    const body = block(TOKENS, '.t-num')
    expect(/font-variant-numeric\s*:\s*tabular-nums/.test(body)).toBe(true)
  })
})

// ─── Controller amendment: computed contrast floor (§3.2) ──────────────────
//
// The glass alpha values above were chosen by the plan author, not measured.
// §3.2's contrast floor is normative now, not deferred to a later polish
// phase — so this composites the dimmest permitted ink (--text-muted) and the
// body ink (--text) over --glass-surface atop --bg and asserts real WCAG AA
// (4.5:1) on the RESULT a user actually sees, not on the flat token in
// isolation (a translucent surface's effective color depends on what's
// behind it).
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function relLum([r, g, b]) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b) }
function contrast(a, b) { const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05) }
function composite(fg, alpha, bg) { return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) }

/** #rrggbb -> [r,g,b] */
function hexRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a hex color: ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/** rgba(r, g, b, a) -> { rgb: [r,g,b], alpha } */
function parseRgba(value) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(value)
  if (!m) throw new Error(`not an rgba() color: ${value}`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] != null ? Number(m[4]) : 1 }
}

describe('tokens.css — glass-surface contrast floor (§3.2, computed)', () => {
  it('--bg is the expected dark canvas (#101012, the catalog Graphite ramp) — sanity check on the fixture', () => {
    expect(decl(ROOT, '--bg')).toBe('#101012')
  })

  // C1: the floor covers every glass surface (--glass-surface/-elevated/-chrome)
  // against both inks permitted on glass (--text-muted, the dimmest; --text,
  // the body ink), for BOTH the dark :root defaults and the [data-theme="oled"]
  // overrides. oled never restates --text/--text-muted (they're theme-invariant
  // ink), so unresolved tokens fall through to :root — the composited color a
  // user actually sees on either theme, not the flat token in isolation.
  const resolveToken = (themeBlock, token) => decl(themeBlock, token) ?? decl(ROOT, token)
  const THEME_BLOCKS = { dark: ROOT, oled: OLED }
  const SURFACES = ['--glass-surface', '--glass-elevated', '--glass-chrome']
  // C1 (extended, P1F-B): --text-bright is the shell's heading ink and now sits
  // on --glass-elevated (the active rail item) and --glass-chrome (banner, rail,
  // footer), so it belongs in the matrix beside the body and dimmest inks.
  // --text-heading (final-wave addendum): IdentityBanner's price line
  // (`.price`, IdentityBanner.module.css) also sits directly on --glass-chrome
  // using this token, so it needs the same computed-contrast proof as the
  // other inks that render on glass.
  const INKS = ['--text-muted', '--text', '--text-bright', '--text-heading']

  const CASES = Object.keys(THEME_BLOCKS).flatMap((themeName) =>
    SURFACES.flatMap((surfaceToken) => INKS.map((inkToken) => [themeName, surfaceToken, inkToken])),
  )

  it.each(CASES)('%s theme: %s meets AA 4.5:1 for %s', (themeName, surfaceToken, inkToken) => {
    const themeBlock = THEME_BLOCKS[themeName]
    const bgRgb = hexRgb(resolveToken(themeBlock, '--bg'))
    const inkRgb = hexRgb(resolveToken(themeBlock, inkToken))
    const { rgb: surfRgb, alpha: surfAlpha } = parseRgba(resolveToken(themeBlock, surfaceToken))
    const composited = composite(surfRgb, surfAlpha, bgRgb)
    expect(contrast(inkRgb, composited)).toBeGreaterThanOrEqual(4.5)
  })
})
