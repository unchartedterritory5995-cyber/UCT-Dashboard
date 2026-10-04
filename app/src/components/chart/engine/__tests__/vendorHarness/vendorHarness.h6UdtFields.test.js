// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h6UdtFields.test.js
//
// ─── H6 (step 90) — a user-defined type's field read off a constant instance ──────
//
// `ast/udtConstFields.js` rewrites `theme.bull` to its constructor argument when the
// instance is the same on every bar (see that module's header for the rule). This
// rail grades it against TradingView's own colours: multicator-table's HUD draws
// five boxes and five labels whose colours are three `ThemePalette` fields
// (`hudBorder`, `hudBg`, `hudText`), and both captures record them. The HUD itself
// is withheld (`pine:object-removal-lost` — `visibleRange` is a tuple function the
// object lane cannot read, so its list pushes are lost), so a probe draws the SAME
// objects with the script's OWN type, helper and theme input, at the y TradingView
// recorded (the pairing key), through the member door on the capture's own bars.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, HARNESS_DIR } from './harness'
import { censusOf } from './colourColumn'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine, lexPine, blockStatements, isPunct, findTop, boundName } from '../../ast/pine'
import { resolveConstantUdtFields } from '../../ast/udtConstFields'

afterEach(() => { vi.unstubAllEnvs() })
const cap = (sym) => loadCapture(path.join(HARNESS_DIR, `multicator-table-${sym}-1d-2026-10-02.json`)).capture
const SCRIPT = fs.readFileSync(path.resolve(process.cwd(), '..', 'corpus/committed/multicator-table__486858895c.pine'), 'utf8')
const H = { blockStatements, isPunct, findTop, boundName }

/** The script's own header — the type, the helper, the inputs it reads — verbatim. */
const HEAD = SCRIPT.split(/\r?\n/).slice(0, 41)

function probe(capture, themeName = 'Dark') {
  const R = capture.objects.records
  const lines = [...HEAD.map((l) => (themeName !== 'Dark' ? l.replace("input.string('Dark', 'Theme'", `input.string('${themeName}', 'Theme'`) : l)),
    'if barstate.islast']
  R.boxes.forEach((b) => lines.push(`    box.new(bar_index - 39, ${b.y1}, bar_index, ${b.y2}, border_color = theme.hudBorder, bgcolor = theme.hudBg)`))
  R.labels.forEach((l) => lines.push(`    label.new(bar_index, ${l.y}, ${JSON.stringify(l.t)}, style = label.style_none, color = color.new(color.black, 100), textcolor = theme.hudText)`))
  const text = `${lines.join('\n')}\n`
  return sealCapture({ ...capture, source: { ...capture.source, text, sha256: sha256Hex(text) } })
}
function slots(capture, themeName) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const row = censusOf(probe(capture, themeName))
  expect(row.objects, row.refused || 'no object lane').toBeTruthy()
  return row.objects.rows.filter((r) => r.slot !== 'color' || r.kind !== 'label')
}

describe('⭐ H6 — the pre-pass on multicator-table itself', () => {
  it('every one of the 95 `theme.<field>` reads resolves (10 distinct fields)', () => {
    const r = resolveConstantUdtFields(lexPine(SCRIPT), H)
    expect(r.udtConstFields).toEqual([{ name: 'theme', type: 'ThemePalette', reads: 95,
      fields: ['bear', 'bull', 'frame', 'hudBg', 'hudBorder', 'hudText', 'neutral', 'tableBg', 'tableHeader', 'tableText'] }])
  })

  it('the object lane carries every colour property it used to drop (156 → 0), and still withholds the HUD', () => {
    const t = translatePine(SCRIPT, { strict: true })
    const d = t.objectDiagnostics
    expect(d.droppedProps || 0).toBe(0)
    expect(d.dropReasons['update:props']).toBe(2)
    // what remains is NOT a type: the HUD's `visibleRange` tuple and the HVN loop
    expect(d.collsDivergedWhy).toEqual(['hudBoxes: coll:push@607', 'hudLabels: coll:push@611'])
    expect(JSON.stringify(t.objectDiagnostics)).not.toMatch(/pine:type/)
  })
})

describe('⭐ H6 — graded: the HUD colours are TradingView\'s, both symbols', () => {
  it.each(['rddt', 'spy'])('%s: 5 boxes × (border, fill) + 5 label texts, every slot agrees', (sym) => {
    const rows = slots(cap(sym))
    expect(rows.length).toBe(15)
    const bad = rows.filter((r) => r.state !== 'agree')
    expect(bad.map((r) => `${r.kind}.${r.slot} ${r.where}: vendor ${r.vendor} ours ${r.ours} (${r.state})`)).toEqual([])
  })

  it('⛔ CONTROL: the Light theme (the other arm of every field) is NOT TradingView\'s colours', () => {
    const rows = slots(cap('rddt'), 'Light')
    expect(rows.length).toBe(15)
    expect(rows.filter((r) => r.state === 'carriedDiffers').length).toBe(15)
  })
})

describe('⛔ H6 — what stays refused (each fails closed to the old `pine:type`)', () => {
  const head = ['//@version=6', 'indicator("x")', 'type P', '    color a', '    float b = 2.0', 'mk(bool d) =>', '    P.new(d ? color.red : color.blue, 1.0)']
  const tr = (...body) => translatePine([...head, ...body, ''].join('\n'), { strict: true })
  const resolved = (...body) => resolveConstantUdtFields(lexPine([...head, ...body, ''].join('\n')), H).udtConstFields || []

  it('served: a helper-built constant instance, a direct `P.new`, `var`, a default field', () => {
    expect(resolved('flag = input.bool(true)', 't = mk(flag)', 'plot(close, color = t.a)')).toHaveLength(1)
    expect(resolved('var P t = P.new(color.red)', 'plot(t.b)')).toHaveLength(1)
    expect(tr('var P t = P.new(color.red)', 'plot(t.b)').outputs[0].formula).toBe('2')
    expect(tr('t = P.new(b = 3.5)', 'plot(close * t.b)').outputs[0].formula).toBe('close * 3.5')
  })

  it.each([
    ['a field written', ['t = mk(true)', 't.b := 3.0', 'plot(t.b)']],
    ['the instance reassigned', ['var t = mk(true)', 't := mk(false)', 'plot(t.b)']],
    ['a series argument (it would differ bar to bar)', ['t = P.new(color.red, close)', 'plot(t.b)']],
    ['the instance passed to a function', ['t = mk(true)', 'f(P p) => p.b', 'plot(f(t))']],
    ['the instance read through history', ['t = mk(true)', 'plot(t[1].b)']],
    ['a field the type does not declare', ['t = mk(true)', 'plot(t.zz)']],
    ['an argument a function parameter shadows', ['flag = input.bool(true)', 't = mk(flag)', 'g(bool flag) => t.a', 'plot(close, color = g(true))']],
    ['varip', ['varip t = P.new(color.red)', 'plot(t.b)']],
    ['an `input.*` call inside the constructor (its copies would move parameter ids)', ['t = P.new(color.red, input.float(2.0))', 'plot(t.b)']],
  ])('refused: %s', (_why, body) => {
    expect(resolved(...body)).toEqual([])
  })
})
