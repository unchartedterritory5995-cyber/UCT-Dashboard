// ⭐⭐ THE CHART MUST NOT ACT ON A KEY WHILE A DIALOG IS OPEN.
//
// ⚰️ THE BUG THIS EXISTS FOR, MEASURED IN PRODUCTION 2026-08-10: with the
// New-formula builder open, text typed at the dialog landed in the CHART'S TICKER
// BOX. A screenshot caught the builder rendered on top and `SMA(CLOSE,` sitting in
// the symbol search behind it.
//
// ⛔ AND THE DIALOG'S OWN FOCUS TRAP CANNOT FIX IT, which is why the guard lives
// on the chart side. `StockChart`'s shortcut listener is on `document` — it fires
// wherever focus is — and `SymbolSearch` deliberately hands focus BACK to the
// chart pane when its dropdown closes. Both were guarding on "is the target an
// input?", and a dialog is full of buttons, labels and panels that are none of
// INPUT/TEXTAREA/SELECT.
//
// This file pins the helper. The two CALL SITES are pinned by an AST check below,
// because a helper nobody calls is the shape of every feature this repo has
// shipped green and unreachable.

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isModalOpen } from './modalOpen.js'

afterEach(() => { document.body.innerHTML = '' })

describe('isModalOpen', () => {
  it('is false on a bare page — the control', () => {
    // ⛔ Without this, a helper hard-wired to `true` would pass every case below
    // and silently kill every chart hotkey in the product.
    expect(isModalOpen()).toBe(false)
    expect(isModalOpen(document.body)).toBe(false)
  })

  it('sees each spelling a dialog in this app can use', () => {
    for (const html of [
      '<div role="dialog">x</div>',
      '<div aria-modal="true">x</div>',
      '<dialog open>x</dialog>',
    ]) {
      document.body.innerHTML = html
      expect(isModalOpen(), html).toBe(true)
      document.body.innerHTML = ''
    }
  })

  it('is true for a target INSIDE a dialog', () => {
    document.body.innerHTML = '<div role="dialog"><button id="b">go</button></div>'
    expect(isModalOpen(document.getElementById('b'))).toBe(true)
  })

  it('🔴 is true for a target OUTSIDE the dialog while one is open', () => {
    // ⭐ THE ACTUAL BUG SHAPE. The chart pane is outside the dialog and still had
    // focus, so the event target was the chart — not the dialog. A guard that only
    // asked "is the target inside a dialog?" would have missed the whole thing.
    document.body.innerHTML = '<div id="chart" tabindex="0"></div><div role="dialog">x</div>'
    expect(isModalOpen(document.getElementById('chart'))).toBe(true)
  })

  it('goes back to false when the dialog closes', () => {
    document.body.innerHTML = '<div role="dialog">x</div>'
    expect(isModalOpen()).toBe(true)
    document.body.innerHTML = ''
    expect(isModalOpen()).toBe(false)
  })
})

describe('🔴 both chart key handlers actually CONSULT it', () => {
  // ⛔ DERIVED FROM THE SOURCE, not asserted about behaviour in a mock. A unit
  // test of the helper stays green while the guard is deleted from either call
  // site — which is exactly how this bug shipped in the first place.
  const read = (rel) =>
    fs.readFileSync(path.resolve(process.cwd(), 'src', rel), 'utf8')

  const SITES = {
    'components/StockChart.jsx': 'the document-level shortcut listener',
    'components/chart/pane/ChartPane.jsx': 'the pane type-to-search handler',
  }

  for (const [rel, what] of Object.entries(SITES)) {
    it(`${rel} imports and calls it — ${what}`, () => {
      const src = read(rel)
      expect(src, `${rel} lost the import`).toMatch(/import\s+isModalOpen\s+from/)
      expect(src, `${rel} imports it and never calls it`)
        .toMatch(/if\s*\(\s*isModalOpen\s*\(/)
    })
  }

  it('⛔ THE CONTROL — the probe can tell a file that does NOT call it', () => {
    // Without this, the two assertions above would pass on a regex that matched
    // anything at all.
    const src = read('utils/modalOpen.js')
    expect(/import\s+isModalOpen\s+from/.test(src)).toBe(false)
  })
})
