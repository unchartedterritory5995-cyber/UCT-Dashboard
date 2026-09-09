// app/src/components/chart/engine/__tests__/primitiveGate.test.js
//
// ─── WHERE A LIGHTWEIGHT-CHARTS PRIMITIVE MAY BE ATTACHED, AND BY WHOM ───────
//
// `binder.js` opens with a promise: **flag off ⇒ `sync` returns having made ZERO
// calls of any kind.** `binder.test.js` proves that for the calls binder makes.
// It cannot prove anything about a primitive attached somewhere ELSE, and there
// are ten of those in `StockChart.jsx` today.
//
// ⭐ THE TEN ARE NOT ENGINE OUTPUT, AND THAT IS THE FINDING. They are chart
// CHROME — the watermark, session shading, prev-day levels, the earnings /
// split / dividend / IPO badges. Every one shipped before the indicator engine
// existed and none is gated by its flag, which is CORRECT: switching the Pine
// engine off must not take the watermark and the earnings badges with it. The
// lands-dark contract is a promise about the INDICATOR ENGINE, not a promise
// that nothing draws.
//
// ⛔ SO THE RULE THIS FILE ENFORCES IS THE ONE THAT ACTUALLY MATTERS:
//   1. Every `attachPrimitive` site is either inside `engine/binder.js` — where
//      the flag gate lives and is already tested — or is a named piece of chrome
//      with a written reason below.
//   2. A NEW Pine primitive attached outside `engine/` fails this test BY NAME.
//      That is the drift this exists to stop: the drawing layer R2 is about to
//      build is a dozen more primitives, and the cheapest way to lose the
//      lands-dark contract is to attach one of them next to the watermark
//      because that is where the existing examples are.
//
// ⛔⛔ THE REGISTER IS DERIVED FROM SOURCE, NEVER TYPED FROM MEMORY. A
// hand-maintained list of attach sites is the exact artefact this repository
// keeps discovering has gone stale (the writer-index `FOUR` beside six, the COT
// router's "4 routes" beside five). The sweep reads `StockChart.jsx`; the list
// below only says WHY each one is allowed to be there.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../../..')          // app/src
const STOCK_CHART = path.join(SRC, 'components/StockChart.jsx')
const ENGINE_DIR = path.join(SRC, 'components/chart/engine')

/** Every identifier that may hold a primitive attached OUTSIDE `engine/`, and the
 *  reason it is not under the engine flag. Adding a row is a deliberate act: it
 *  says "this draws even when the indicator engine is dark, and that is intended."
 *  ⛔ A Pine primitive NEVER belongs in this list — it belongs in `engine/`. */
const CHART_CHROME = {
  wmCtrlRef: 'Watermark (ticker/sector behind the candles). Chart identity, not indicator output.',
  sessionShadeRef: 'Session shading on the price pane — pre/post-market bands. Chart context.',
  sessionShadeVolRef: 'The same session shading on the volume pane; a second attach for a second pane.',
  swingCtrlRef: 'Swing high/low labels — a chart feature that predates the engine.',
  zonesCtlRef: 'Level zones (support/resistance bands) drawn from product data, not from a definition.',
  pdlCtlRef: 'Previous-day high/low/close levels. Session context, always available.',
  earnBadgeRef: 'Earnings badge on the bar that reported.',
  splitBadgeRef: 'Split badge — the same badge primitive with an S glyph.',
  divBadgeRef: 'Dividend badge — the same badge primitive with a D glyph.',
  ipoBadgeRef: 'IPO badge — the same badge primitive with an IPO glyph.',
}

/** Strip line and block comments so a commented-out example is not a call site. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `attachPrimitive(<identifier>…)` in a source, with the identifier that
 *  holds the primitive (the ARGUMENT, not the series it is attached to). */
function attachSites(src) {
  const out = []
  const rx = /attachPrimitive\(\s*([A-Za-z_$][\w$]*)/g
  let m
  while ((m = rx.exec(stripComments(src))) !== null) out.push(m[1])
  return out
}

function readAllEngineSources() {
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== '__fixtures__') walk(p)
      } else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) {
        files.push(p)
      }
    }
  }
  walk(ENGINE_DIR)
  return files
}

describe('a primitive is attached under the engine flag, or it is named chrome', () => {
  it('every attach site in StockChart.jsx is declared chrome, by name', () => {
    const found = [...new Set(attachSites(fs.readFileSync(STOCK_CHART, 'utf8')))]
    // ⛔ NON-VACUITY. A regex that matched nothing would pass this test while
    // saying nothing at all — the failure mode every sweep in this repo is
    // required to rule out before its assertion is believed.
    expect(found.length, 'the sweep found attach sites at all').toBeGreaterThan(5)

    const undeclared = found.filter((ref) => !(ref in CHART_CHROME))
    expect(undeclared,
      'a primitive is attached in StockChart.jsx that is not declared chrome. If it is a ' +
      'Pine primitive it belongs in chart/engine/ behind the flag; if it is chrome, add it ' +
      'to CHART_CHROME with the reason it draws while the engine is dark.',
    ).toEqual([])
  })

  it('every declared chrome entry is still attached — the list does not rot', () => {
    const found = new Set(attachSites(fs.readFileSync(STOCK_CHART, 'utf8')))
    // ⚰️ A register that keeps entries for primitives nobody attaches any more
    // becomes fiction, and fiction is what the next reader copies. Same rule as
    // the feature-flag ledger: fail in BOTH directions.
    const dead = Object.keys(CHART_CHROME).filter((ref) => !found.has(ref))
    expect(dead, 'declared chrome that is no longer attached anywhere').toEqual([])
  })

  it('⛔ binder.js is the ONLY file in engine/ that attaches a primitive', () => {
    const offenders = []
    for (const file of readAllEngineSources()) {
      const sites = attachSites(fs.readFileSync(file, 'utf8'))
      if (sites.length && path.basename(file) !== 'binder.js') {
        offenders.push(`${path.relative(SRC, file)} → ${sites.join(', ')}`)
      }
    }
    // binder.js holds the flag gate. A second engine file that attaches directly
    // is a second authority over "did the engine draw", and the lands-dark
    // contract would then be true of binder and false of the engine.
    expect(offenders, 'engine files other than binder.js attaching primitives').toEqual([])
  })

  it('⭐ the sweep can actually see a new attach site (control)', () => {
    // Without this, all three cases above pass for a sweep that silently matches
    // nothing — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    const planted = 'someSeries.attachPrimitive(brandNewPinePrimitiveRef.current.primitive)'
    expect(attachSites(planted)).toEqual(['brandNewPinePrimitiveRef'])
    expect('brandNewPinePrimitiveRef' in CHART_CHROME).toBe(false)
  })

  it('⭐ a commented-out attach is not a call site (control)', () => {
    const commented = '// someSeries.attachPrimitive(ghostRef.current.primitive)\n' +
                      '/* pane.attachPrimitive(otherGhostRef.current.primitive) */'
    expect(attachSites(commented)).toEqual([])
  })
})
