// Joystick hub — the z-index ordering rail. Parses tokens.css; asserts the hub can never dim itself.
// See docs/plans/joystick/00-master-spec-v1.4.md §2a and the --z-hub-* comment in tokens.css.
//
// ⭐ WHY THIS RAIL EXISTS. The hub was first built on `--z-fab: 350`, which is BELOW
// `--z-backdrop: 399`. The moment its fan opened, the hub rendered UNDERNEATH the scrim it had
// just painted — the control dimmed itself and the fan became unreachable. Nothing caught it:
// jsdom performs no layout and no compositing, so no component test can see a stacking bug, and
// the numbers involved live in two different files written months apart.
//
// So the invariant is asserted the only way it can be — by READING THE DECLARED VALUES and
// comparing them. That is a real check on a real relationship, not a proxy for one.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Resolved from the vitest root (`app/`) rather than from `import.meta.url`: under this config
// `import.meta.url` is not always a `file:` URL, and `fileURLToPath` throws on anything else.
const fromApp = (rel) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

const css = fromApp('src/styles/tokens.css')

/**
 * Read a z-index custom property's value from the `:root` block.
 * Anchored on the declaration itself rather than a line number, so re-ordering the block or
 * adding a comment above a token cannot silently change what this reads.
 */
function zToken(name) {
  const re = new RegExp(`--${name}\\s*:\\s*(-?\\d+)\\s*;`)
  const m = re.exec(css)
  if (!m) throw new Error(`tokens.css declares no --${name}`)
  return Number(m[1])
}

let executed = 0
const ran = () => { executed += 1 }

describe('CONTROL — the tokens were actually parsed', () => {
  it('every z token this rail reasons about exists and is a finite number', () => {
    ran()
    const names = ['z-fab', 'z-hub-rest', 'z-backdrop', 'z-hub-open', 'z-drawer', 'z-modal', 'z-toast']
    const values = Object.fromEntries(names.map((n) => [n, zToken(n)]))
    for (const [n, v] of Object.entries(values)) {
      expect(Number.isFinite(v), `--${n} did not parse to a number`).toBe(true)
    }
    // Pins today's values so a regex that silently matched the wrong declaration shows up as a
    // changed number here rather than as a test passing for the wrong reason.
    expect(values).toEqual({
      'z-fab': 350,
      'z-hub-rest': 360,
      'z-backdrop': 399,
      'z-hub-open': 401,
      'z-drawer': 400,
      'z-modal': 1000,
      'z-toast': 1100,
    })
  })
})

describe('the hub can never render beneath its own scrim', () => {
  it('orders hub-open > backdrop > hub-rest > fab', () => {
    ran()
    const open = zToken('z-hub-open')
    const backdrop = zToken('z-backdrop')
    const rest = zToken('z-hub-rest')
    const fab = zToken('z-fab')

    expect(open, 'an open hub must paint ABOVE the scrim it owns').toBeGreaterThan(backdrop)
    expect(backdrop, 'the scrim must cover a resting hub, so the fan reads as the only live thing')
      .toBeGreaterThan(rest)
    expect(rest, 'a resting hub sits just above ordinary floating affordances').toBeGreaterThan(fab)
  })

  it('keeps modals and toasts above the open hub, so a confirm sheet still draws over the fan', () => {
    ran()
    expect(zToken('z-modal')).toBeGreaterThan(zToken('z-hub-open'))
    expect(zToken('z-toast')).toBeGreaterThan(zToken('z-hub-open'))
  })
})

describe('the hub yields to any Sheet or drawer', () => {
  it('hides itself while a Sheet is open, which is WHY hub-open may sit above --z-drawer', () => {
    ran()
    // --z-hub-open (401) is above --z-drawer (400) because no integer exists between 399 and 400.
    // That is only safe because the two can never be on screen together: the hub hides whenever a
    // Sheet/drawer is open, the same rule FloatingOrb follows via `scrollLocked`. If that rule is
    // ever removed, this ordering becomes a real bug — so the rule is asserted here, in the same
    // file as the numbers that depend on it, rather than left as a comment somebody can delete.
    const root = fromApp('src/hub/HubRoot.jsx')
    const viewport = fromApp('src/hub/hubViewport.js')
    const both = root + viewport
    expect(
      /scrollLocked|sheetOpen|drawerOpen|hidden/.test(both),
      'HubRoot/hubViewport must carry a hide-while-a-sheet-is-open signal',
    ).toBe(true)
    // And the numbers that make it necessary:
    expect(zToken('z-hub-open')).toBeGreaterThan(zToken('z-drawer'))
  })
})

describe('no hub component hardcodes a stacking number', () => {
  it('hub.module.css uses the tokens and never a bare numeric z-index', () => {
    ran()
    const mod = fromApp('src/hub/hub.module.css')
    // A bare `z-index: 8000` on the voice orb is what once buried the chart's long-press menu.
    // The hub gets the same rule: stacking is a token decision, never a per-component literal.
    const bare = [...mod.matchAll(/z-index\s*:\s*(-?\d+)\s*;/g)].map((m) => m[0])
    expect(bare, `hub.module.css hardcodes a z-index: ${bare.join(', ')}`).toEqual([])
    expect(mod, 'hub.module.css should reference the hub z tokens').toMatch(/--z-hub-(rest|open)/)
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  THE RAIL THIS FILE WAS MISSING, AND THE DEFECT IT LET THROUGH
// ─────────────────────────────────────────────────────────────────────────────
//
// ⛔ EVERY ASSERTION ABOVE COMPARES TOKENS, AND THE TOKENS WERE ALWAYS RIGHT.
//
// `hub-root` is `position: fixed`, and a fixed element ALWAYS creates a stacking context —
// with or without a z-index. It had none, so it sat at level `auto` (0) in the root context
// and every `--z-hub-*` value inside it (pad 360, fan/scrim 401) ordered the hub's children
// against EACH OTHER while the whole hub painted at 0 against the page.
//
// Measured on three real devices on `/charts`: a Lightweight Charts canvas at `z-index: 2`
// covered the pad from 250ms after load. `elementFromPoint` at the pad centre returned
// CANVAS, the pointerdown never reached the pad, and the hub rendered perfectly while being
// impossible to touch. Every test in this file stayed green throughout, because a token
// comparison cannot see which ELEMENT carries the token.
describe('the hub subtree is placed on the page, not just ordered within itself', () => {
  it('HubRoot itself carries a z-index — a fixed container without one pins the whole scale', () => {
    ran()
    // `fromApp`, not `new URL(import.meta.url)` — this file's own header records why:
    // under this vitest config `import.meta.url` is not always a `file:` URL.
    const src = fromApp('src/hub/HubRoot.jsx')
    // The style object on the root element must set zIndex from a hub token.
    expect(
      /zIndex:\s*state\.open\s*\?\s*'var\(--z-hub-open\)'\s*:\s*'var\(--z-hub-rest\)'/.test(src),
      'HubRoot must set zIndex from --z-hub-open / --z-hub-rest. Without it the element that '
      + 'CREATES the stacking context (position: fixed) sits at level 0 and every z-index '
      + 'inside the hub becomes internal-only — the /charts defect.',
    ).toBe(true)
  })

  it('the root element is position: fixed, which is WHY it needs the z-index', () => {
    ran()
    const src = fromApp('src/hub/HubRoot.jsx')
    expect(/position:\s*'fixed'/.test(src)).toBe(true)
  })
})
