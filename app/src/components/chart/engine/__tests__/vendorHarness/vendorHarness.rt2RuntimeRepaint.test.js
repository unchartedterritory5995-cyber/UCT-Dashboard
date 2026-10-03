// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt2RuntimeRepaint.test.js
//
// ─── ⭐⭐ RT2 — A RUNTIME DOCUMENT STATES ITS REPAINT CLASS, AND THE PANE SAYS IT ─
//
// RT1 declined every script whose source MENTIONED another timeframe or the live
// bar (`runtime:repaint-unstated`, 127 of the corpus with the runtime flag on),
// because the member pane labels repainting and the lane had no class to label.
// RT2 states the class (`runtime/runtimeRepaint.js`), in the host linter's
// vocabulary and by its reach -> class rule; this rail proves, on a committed
// vendor capture, that:
//   · the class rides the document the member door mints — every drawn row's
//     `mode` and `forward`, `meta.repaint`, and the pane's own repaint notice
//     (`repaintVerdict.js`, through `lint.js::lintDefinition`);
//   · stating a class changes NOTHING the pane draws: every vendor plot still
//     MATCHes, through the real door, on the capture's own bars;
//   · a request of other bars is declined BY NAME (the pane holds none), at the
//     door and at the run.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { repaintNotices, definitionRollUp } from '../../repaintVerdict'
import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { computeRuntimeColumns, probeRuntimeProgram } from '../../runtime/runtimeColumns'
import { runtimeRepaintOf } from '../../runtime/runtimeRepaint'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const OBJECTS = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const DEF_ID = 'u_member-pane-rt2'
const ADX = 'adx-and-di-for-v4-rddt-1d-2026-09-27.json'

const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
/** The capture, its script extended by `extra` lines that draw nothing. */
const withSource = (cap, extra) => ({ ...cap, source: { ...cap.source, text: `${cap.source.text}\n${extra}\n` } })

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  vi.unstubAllEnvs()
})

const on = () => { vi.stubEnv(OBJECTS, '1'); vi.stubEnv(FLAG, '1') }

const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

/** The extended script's document draws exactly what the captured script's
 *  document draws, and the captured one MATCHes the vendor (graded here). */
function expectSameDrawing(extended, built) {
  const cap = capture(ADX)
  const base = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
  expect(base.ok, base.reason).toBe(true)
  const { verdict } = gradeCapture(cap)
  expect(verdict.verdict, verdict.reason).toBe('MATCH')
  expect(verdict.plots.filter((p) => p.verdict === 'MATCH').length).toBe(cap.study.plots.length)
  const bars = toProductBars(cap)
  const a = computeRuntimeColumns(base.definition, bars, CTX)
  const b = computeRuntimeColumns(built.definition, toProductBars(extended), CTX)
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
  expect(Object.keys(a).length).toBe(cap.study.plots.length) // non-vacuity
  for (const k of Object.keys(a)) expect(b[k], k).toEqual(a[k])
}

describe('RT2 — the class rides the document, and the pane says it', () => {
  it('⭐ CONTROL: the script as captured is non-repainting — every row forward 0, no notice', () => {
    const cap = capture(ADX)
    on()
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(built.definition.meta.repaint).toBe('non-repainting')
    const drawn = built.definition.plots.filter((p) => Object.hasOwn(built.definition.compute.outputs, p.key))
    expect(drawn.length).toBeGreaterThan(0)
    for (const p of drawn) expect(p.forward, p.key).toBe(0)
    expect(definitionRollUp(built.definition)).toBe('non-repainting')
    expect(repaintNotices(built.definition)).toEqual([])
  })

  it('⭐⭐ a read of the right edge is STATED, labelled on every row — and the drawing still MATCHes', () => {
    // `barstate.islast` read into a value the script never draws: the class is
    // the WHOLE program's (conservative), the drawn columns are unchanged.
    const cap = withSource(capture(ADX), 'rt2Last = barstate.islast ? 1 : 0')
    on()
    expect(runtimeRepaintOf(cap.source.text).mode).toBe('preview-repaints')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    // RT1 declined this exact script (`runtime:repaint-unstated`); RT2 draws it
    expect(built.runtimeDeclined).toBeUndefined()
    expect(built.definition.meta.repaint).toBe('preview-repaints')
    expect(built.rows.every((r) => r.mode === 'preview-repaints')).toBe(true)
    const drawn = built.definition.plots.filter((p) => Object.hasOwn(built.definition.compute.outputs, p.key))
    for (const p of drawn) expect(p.forward, p.key).toBe(1)
    // the pane's own notice, through the linter's own step, names every drawn row
    const notices = repaintNotices(built.definition)
    expect(notices.map((n) => n.plotKey).sort()).toEqual(drawn.map((p) => p.key).sort())
    expect(notices.every((n) => n.mode === 'preview-repaints' && n.forward === 1)).toBe(true)
    expect(built.notes.some((n) => /barstate\.islast/.test(n.note))).toBe(true)
    // ⭐ nothing it draws moved: column for column, bit for bit, the document
    // draws what the captured script's document draws — and THAT one is graded
    // MATCH against the vendor through the real door (the harness refuses a
    // source whose sha256 differs from the capture's, so the extended script is
    // compared to the graded one rather than graded itself).
    expectSameDrawing(cap, built)
  })

  it('an unbounded read (`last_bar_index`) is `repaints`, forward "unbounded", and still MATCHes', () => {
    const cap = withSource(capture(ADX), 'rt2Far = bar_index > last_bar_index - 5 ? 1 : 0')
    on()
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.meta.repaint).toBe('repaints')
    const drawn = built.definition.plots.filter((p) => Object.hasOwn(built.definition.compute.outputs, p.key))
    for (const p of drawn) expect(p.forward, p.key).toBe('unbounded')
    expect(definitionRollUp(built.definition)).toBe('repaints')
    expectSameDrawing(cap, built)
  })
})

describe('RT2 — a request of other bars is declined by name', () => {
  const SRC = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\n'
    + 'w = request.security("SPY", "D", close)\nplot(s + w, title="Sum")\n'

  it('the probe counts the request the lowering did not fold', () => {
    const probe = probeRuntimeProgram(SRC)
    expect(probe.ok, probe.refusal && probe.refusal.message).toBe(true)
    expect(probe.requests).toBe(1)
    // ⭐ CONTROL: this chart at this chart's period folds away and counts nothing
    const own = SRC.replace('request.security("SPY", "D", close)', 'request.security(syminfo.tickerid, timeframe.period, close)')
    expect(probeRuntimeProgram(own).requests).toBe(0)
  })

  it('⛔ the run computes nothing for it, by name — never a column of `na`', () => {
    const cap = capture(ADX)
    const probe = probeRuntimeProgram(SRC)
    const k = probe.outputs.findIndex((o) => o.call === 'plot')
    expect(() => computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: SRC, outputs: { v: k } } },
      toProductBars(cap), { tf: 'D', newestBarIsForming: false, historyFromListing: true }))
      .toThrow(expect.objectContaining({ guard: 'runtime:request' }))
  })

  it('⛔ the member door declines it as `runtime:request` and reads the host refusal', () => {
    on()
    const built = memberPaneDefinition({ source: SRC, id: DEF_ID })
    expect(built.ok).toBe(false)
    expect(built.runtimeDeclined && built.runtimeDeclined.code).toBe('runtime:request')
  })
})
