// ⛔ Options Flow's palette is a MIRROR of tokens.css. Mirrors drift.
//
// The page ran its own warm-olive ramp (#0e0f0d / #1a1c17 / #2e3127, the old
// gold #c9a84c, dim olive text) while the rest of the app moved to the cool
// graphite ramp. Two colour systems on one screen is what "doesn't match our
// theme" actually was.
//
// The values CANNOT be `var(--token)` strings — `flow.worker.js` imports this
// module and has no `document`, and call sites concatenate alpha onto them
// (`P.ac+"22"`). So they are hex copies, and a copy without a check is just the
// next drift. This is the check: tokens.css is the authority, P is verified
// against it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { P } from './flowCompute.js'

const tokensCss = fs.readFileSync(
  path.resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

/** Read a custom property from the :root block of tokens.css. */
function token(name) {
  // First declaration wins — :root is defined before any [data-theme] override,
  // and the dark default is what Options Flow renders against.
  const m = tokensCss.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  return m ? m[1].toLowerCase() : null
}

/** P key -> the token it mirrors. `sw`/`bk` are deliberately absent. */
const MIRRORS = {
  bg: 'bg',
  cd: 'bg-surface',
  al: 'bg-elevated',
  bd: 'border',
  bl: 'border-accent',
  bu: 'gain',
  be: 'loss',
  ac: 'ut-gold',
  ye: 'ut-gold',
  ma: 'ut-gold',
  tx: 'text',
  mt: 'text-muted',
  wh: 'text-bright',
  dm: 'menu-text-dim',
  uc: 'menu-text-dim',
}

describe('the Options Flow palette mirrors the app tokens', () => {
  it('the token reader actually finds values — the control', () => {
    // Every assertion below compares against `token(...)`. A reader that
    // returned null for everything would make them all vacuous.
    expect(token('bg')).toBe('#101012')
    expect(token('ut-gold')).toBe('#dcbb5e')
    expect(token('nonexistent-token-xyz')).toBeNull()
  })

  for (const [key, tok] of Object.entries(MIRRORS)) {
    it(`P.${key} matches --${tok}`, () => {
      const expected = token(tok)
      expect(expected, `--${tok} is not a 6-digit hex in tokens.css`).toBeTruthy()
      expect(P[key].toLowerCase()).toBe(expected)
    })
  }

  it('keeps the flow-specific sweep/block blue, which has no token', () => {
    // Not an oversight: it is a signal colour meaning "sweep"/"block", not part
    // of the app's surface/text ramp. Forcing it onto a token would make it mean
    // something it does not.
    expect(P.sw).toBe('#6ba3be')
    expect(P.bk).toBe('#6ba3be')
  })

  it('every value is a plain 6-digit hex, never a var()', () => {
    // `flow.worker.js` imports this module and has no document to resolve a CSS
    // variable, and call sites concatenate alpha onto these (`P.ac+"22"`).
    // A var() string would silently produce invalid colours at both.
    for (const [k, v] of Object.entries(P)) {
      expect(v, `P.${k}`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('no value is left from the retired olive ramp', () => {
    // Named explicitly so a partial revert is caught by NAME rather than by
    // someone noticing the page looks warm again.
    const retired = ['#0e0f0d', '#1a1c17', '#22251e', '#2e3127', '#3a3d32',
                     '#3cb868', '#e74c3c', '#c9a84c', '#a8a290', '#706b5e', '#e0dac8']
    const stillThere = Object.entries(P)
      .filter(([, v]) => retired.includes(v.toLowerCase()))
      .map(([k, v]) => `${k}=${v}`)
    expect(stillThere, 'old palette values are back').toEqual([])
  })
})

// ── the surface itself must not keep private copies of the old ramp ─────────
//
// The palette object was only half the problem. `OptionsFlow.jsx` hardcoded 57
// old-palette hex literals that bypassed `P` entirely (41 of them the old gold),
// and `DarkPool.jsx` — which renders as a TAB INSIDE Options Flow — carried its
// own full copy of the olive ramp and did not import `P` at all. Fixing only the
// object would have left the page visibly MIXED: some gold #dcbb5e, most of it
// still #c9a84c. That is worse than either palette used consistently.

describe('the Options Flow surface keeps no private copy of the retired ramp', () => {
  const FILES = ['src/pages/OptionsFlow.jsx', 'src/pages/DarkPool.jsx']
  const RETIRED = {
    '#0e0f0d': 'bg', '#1a1c17': 'card', '#22251e': 'elevated', '#2e3127': 'border',
    '#3a3d32': 'border-accent', '#3cb868': 'bull', '#e74c3c': 'bear',
    '#c9a84c': 'gold', '#a8a290': 'text', '#706b5e': 'dim', '#e0dac8': 'bright',
  }

  for (const rel of FILES) {
    it(`${rel} uses no retired palette literal`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      const found = Object.entries(RETIRED)
        .map(([hex, role]) => {
          const n = (src.match(new RegExp(hex, 'gi')) || []).length
          return n ? `${hex} (${role}) x${n}` : null
        })
        .filter(Boolean)
      expect(found, `retired colours are back in ${rel}`).toEqual([])
    })
  }

  it('the sweep/block blue is still there — the control', () => {
    // Every assertion above checks for ABSENCE, which a file-read that silently
    // returned '' would satisfy. This proves the files are actually being read
    // and that the one colour we deliberately kept was kept.
    for (const rel of FILES) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      expect(src.length, `${rel} read as empty`).toBeGreaterThan(1000)
    }
    const of = fs.readFileSync(path.resolve(process.cwd(), FILES[1]), 'utf8')
    expect(of).toMatch(/#6ba3be/i)
  })
})

// ── type scale: nothing below the design system's own floor ─────────────────
//
// Measured on the LIVE page 2026-08-29: **52.9% of all rendered text on Options
// Flow sat below 10px** — 157 elements at 9px, 42 at 8px, 19 at 7px, out of 412.
// The app's scale starts at --text-xs: 10px, so more than half the page was
// smaller than the smallest size the system defines. Combined with the old dim
// olive text it was genuinely hard to read, and it is the other half of "doesn't
// match our theme" after the palette.
//
// The fix is deliberately CONSERVATIVE: raise what is below the floor, touch
// nothing at or above it, so every existing hierarchy above 10px is preserved.
// Verified in-browser before shipping — 149 elements raised, ZERO horizontal
// overflow (scrollWidth === clientWidth), layout intact.

describe('Options Flow respects the design system type floor', () => {
  const FILES = ['src/pages/OptionsFlow.jsx', 'src/pages/DarkPool.jsx']

  // Read the floor from tokens.css rather than typing 10 — same single-authority
  // rule as the palette above. If the scale ever starts somewhere else, this
  // follows it instead of pinning a stale number.
  const floorPx = (() => {
    const m = tokensCss.match(/--text-xs\s*:\s*(\d+)px/)
    return m ? Number(m[1]) : null
  })()

  it('the floor is read from tokens.css, not typed — the control', () => {
    expect(floorPx).toBe(10)
  })

  for (const rel of FILES) {
    it(`${rel} sets no font size below ${floorPx}px`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      const offenders = [...src.matchAll(/fontSize:\s*(\d+)(?![\d.])/g)]
        .map((m) => Number(m[1]))
        .filter((px) => px < floorPx)
      expect([...new Set(offenders)].sort((a, b) => a - b),
        `${rel} has text below the ${floorPx}px floor`).toEqual([])
    })
  }

  it('sizes ABOVE the floor were left alone — the discriminating half', () => {
    // A "fix" that flattened everything to 10px would pass the assertions above
    // and destroy the page's hierarchy. Assert the larger tiers survive.
    const src = fs.readFileSync(path.resolve(process.cwd(), FILES[0]), 'utf8')
    const sizes = new Set([...src.matchAll(/fontSize:\s*(\d+)(?![\d.])/g)].map((m) => Number(m[1])))
    for (const px of [11, 12, 13, 14]) {
      expect(sizes.has(px), `the ${px}px tier disappeared — hierarchy was flattened`).toBe(true)
    }
  })
})


describe('Options Flow respects the design system RADIUS scale', () => {
  // The page carried 12 distinct numeric radii against a 6-token scale — the
  // same "mirror without a check" shape as the palette above, and the other
  // half of why it read as a different product.
  //
  // ⛔ THE SUB-4px VALUES ARE DELIBERATE AND ALLOWED. tokens.css floors at
  // --radius-sm: 4px, but this page is dense data UI: 1-3px on a table chip or
  // a heat cell is a considered choice, and snapping those to 4px visibly
  // bloats them. Everything AT OR ABOVE the floor must be a token — those were
  // arbitrary (5/10/14/20) and snapped with a <=2px visual delta.
  //
  // If a `--radius-xs: 2px` token is ever added to the design system, fold
  // {1,2,3} into it and delete this exception. That is a system-wide decision,
  // not one to make from inside this page.
  const TOKENS = new Set([4, 6, 8, 12, 16])
  const DENSE_UI_EXCEPTION = new Set([1, 2, 3])

  const SRC = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/OptionsFlow.jsx'), 'utf8')
  const numeric = [...SRC.matchAll(/borderRadius:\s*(\d+)\b/g)].map(m => Number(m[1]))

  it('uses no arbitrary radius at or above the 4px token floor', () => {
    const bad = [...new Set(numeric.filter(v => v >= 4 && !TOKENS.has(v)))].sort((a, b) => a - b)
    expect(bad,
      `these radii are >= the 4px floor but are not tokens (${[...TOKENS].sort((a,b)=>a-b).join('/')}px). `
      + 'Snap to the nearest token, or add one to tokens.css if the scale is genuinely missing a step')
      .toEqual([])
  })

  it('keeps the sub-floor values to the documented dense-UI set', () => {
    const bad = [...new Set(numeric.filter(v => v < 4 && !DENSE_UI_EXCEPTION.has(v)))]
    expect(bad, 'a new sub-4px radius appeared outside the documented set').toEqual([])
  })

  it('control: this check can actually fail', () => {
    // Non-vacuity — if the regex stopped matching, both assertions above would
    // pass forever on an empty array.
    expect(numeric.length).toBeGreaterThan(100)
    const probe = [...'borderRadius: 7'.matchAll(/borderRadius:\s*(\d+)\b/g)].map(m => Number(m[1]))
    expect(probe).toEqual([7])
    expect(TOKENS.has(7)).toBe(false)
  })
})
