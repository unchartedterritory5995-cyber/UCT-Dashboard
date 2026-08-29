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
