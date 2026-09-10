// app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js
//
// ─── ⛔⛔ THE GATE: pineRuntimeFrontend.js MAY NOT BE WIRED YET ──────────────
//
// `pineRuntimeFrontend.js` is the JS lane that would render a member's script on
// a pane. It reads the six `barstate.*` columns through `interpret()`, and the
// four CLOCK_REALTIME ones are decided by `opts.newestBarIsForming` — a
// TRI-STATE produced on the Python side by `indicator_compute.bar_close_state`,
// because that is where the trading calendar lives.
//
// ⛔ NOTHING PRODUCES IT FOR THE JS LANE TODAY. Not one caller of `interpret()`
// in `app/src` sets `newestBarIsForming`; the pane's own path
// (`binder.js` → `nativeRegistry.computeFor` → `interpret`) carries `{ sym, tf }`
// and stops there. So the four columns render BLANK — correctly, by the
// fail-closed contract, but blank.
//
// ⭐ THAT IS SAFE ONLY WHILE NOBODY CAN SEE IT. This module has zero importers,
// so no route reaches it and no member meets the blanks. The day someone wires
// it up, the blanks become member-visible with no other test going red — which
// is precisely the failure this file exists to prevent.
//
// ⚰️ MEASURED, so the gate is not an opinion:
//   · at `35ba654da` the lane was ALREADY BLANK — its `computeClock` failed
//     closed without a `now`, and nothing supplied one either.
//   · at `3a1d9d4a3` it was CONFIDENTLY WRONG — the third argument defaulted to
//     `false`, so a forming bar reported `isconfirmed = 1`.
//   Blank is the better of those two, and neither is shippable to a member.
//
// ⭐⭐ WHEN THIS GOES RED, THE FIX IS NOT TO EDIT THIS FILE. Build the producer —
// carry `bar_close_state`'s answer from the Python response through to
// `interpret`'s `opts` — and then DELETE this test, in the same commit that
// wires the module. A gate retired because its precondition was met is the
// intended ending; a gate edited to keep passing is the defect.
//
// Recorded in `docs/pine/barstate.md` and against items 6-10 in
// `docs/pine/SESSION-STATE.md`.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..', '..')      // app/src
const SUBJECT = path.resolve(HERE, '..', 'ast', 'pineRuntimeFrontend.js')

/** Every `.js`/`.jsx` under `app/src`, excluding the subject itself. */
function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      sources(p, out)
    } else if (/\.(jsx?|mjs)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** Files that name the module in an import/require/dynamic-import position.
 *  ⭐ TEXT, DELIBERATELY, NOT AN AST. This asks "does any file MENTION it in a
 *  module position", which is strictly broader than the import graph — a wiring
 *  attempt through a shape this rail did not anticipate still trips it. Over-
 *  broad is the right direction for a gate. */
function referrers() {
  const re = /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*pineRuntimeFrontend[^'"]*['"]/
  return sources(SRC)
    .filter((p) => path.resolve(p) !== path.resolve(SUBJECT))
    .filter((p) => re.test(fs.readFileSync(p, 'utf-8')))
    .map((p) => path.relative(SRC, p).replace(/\\/g, '/'))
}

describe('⛔⛔ the pane lane stays unwired until a tri-state producer exists', () => {
  it('⛔ NON-VACUITY FIRST — the subject exists and the scan can see files', () => {
    expect(fs.existsSync(SUBJECT), 'pineRuntimeFrontend.js is gone — if it was '
      + 'deleted on purpose, delete this gate too').toBe(true)
    expect(sources(SRC).length, 'the source scan found nothing — the walker is '
      + 'broken and every assertion below is vacuous').toBeGreaterThan(500)
  })

  it('⭐ THE CONTROL — the scan really can find a referrer when one exists', () => {
    // Without this, "zero referrers" is indistinguishable from a regex that
    // matches nothing. `indicators.js` is imported all over `app/src`.
    const re = /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*indicators(?:\.js)?['"]/
    const seen = sources(SRC).filter((p) => re.test(fs.readFileSync(p, 'utf-8')))
    expect(seen.length, 'the referrer scan found no importer of indicators.js '
      + 'either — it is not measuring what it claims').toBeGreaterThan(0)
  })

  it('⛔⛔ pineRuntimeFrontend.js has NO importer outside its own tests', () => {
    const live = referrers().filter((p) => !/\.test\.[jt]sx?$/.test(p))
    expect(live, 'pineRuntimeFrontend.js is now imported by ' + live.join(', ')
      + '.\n\n'
      + 'THE JS LANE RENDERS THE FOUR CLOCK_REALTIME COLUMNS BLANK: nothing '
      + 'supplies `opts.newestBarIsForming`, so `computeClock` fails closed.\n'
      + 'Wiring the module makes those blanks member-visible.\n\n'
      + 'THE CORRECT EDIT IS NOT TO THIS FILE. Build the producer — carry '
      + '`indicator_compute.bar_close_state`\'s tri-state through the response '
      + 'into `interpret`\'s opts — then DELETE this gate in the same commit. '
      + 'See docs/pine/barstate.md.').toEqual([])
  })
})
