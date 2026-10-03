// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47SimpleSwitch.test.js
//
// ─── C47 — `switch` OVER A `simple string` ARGUMENT, PER CALL SITE (runtime lane) ─
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). artemis-oscillator-pro chooses its moving average with
//
//     smooth(series float s, simple int n, simple string m) =>
//         switch m
//             "EMA" => ta.ema(s, n)
//             "SMA" => ta.sma(s, n)
//             "RMA" => ta.rma(s, n)
//             "TMA" => ta.sma(ta.sma(s, n), n)
//             =>       ta.rma(s, n)
//
// and calls it three times: twice inside `drmEngine(src, len, method)` with the
// method the member chose for the oscillator ("RMA"), once for the signal line
// with the one chosen for the signal ("EMA"). The runtime lane compiles ONE body
// per function, where `m` is a frame slot, and refused the body (`pine:block@233`)
// — artemis's wall after C35.
//
// ⭐ WHAT C47 SERVES (`pineRuntimeFrontend.js`: `simpleSwitchShape`, `fixedTextOf`,
// `simpleSpecialisation`). Pine's rule for a `simple` argument is that it is fixed
// for its call site; so the arm a fixed text selects is fixed for the call site.
// A body that ends in `switch <parameter>` over quoted labels is held for its call
// sites, each text argument is read as it stands before bar 0 (a quoted string, an
// `input.string` at the value in force, a text the caller's own call site fixed),
// and the body is compiled once per distinct set of fixed arguments with the arm
// that text selects as its value. No other arm is lowered — Pine runs no other.
//
// ⭐ GRADED ON TRADINGVIEW'S OWN NUMBERS, WITH NOTHING SUBSTITUTED. C35's rail had
// to replace `smooth` by the one arm the capture takes. This one runs the vendor's
// `smooth` and `drmEngine` VERBATIM: the oscillator ("RMA", through two frames) and
// the signal line ("EMA") are TradingView's plots on every bar.
//
// ⛔ ARTEMIS ITSELF STILL STOPS IN THE RUNTIME LANE — on its NEXT wall, by name:
// `ta.percentile_linear_interpolation(oscVal, adaptLook, 80)` over a series this
// lane now computes itself (`runtime:call-windowed-state@281`), and behind that a
// dynamic bar offset (`runtime:history-dynamic-offset@332`). Its five KNN cells
// stay dropped (21 / 16). ⛔ WHAT WAS ASKED AND IS MEASURED: the KNN vote, lifted
// verbatim with everything it reads, COMPILES here and costs 4,944 VM instructions
// on its worst bar against INSTRUCTIONS_PER_BAR = 200,000 — it fits, 40 times
// over — and its last-bar confidence is the `80%` TradingView prints. ⛔ But as
// written its run STOPS on bar 7, by name: `array.min` over an `na` element, which
// no capture has measured (queued, Q-C47-3). The count is read with the three
// features' `na` filled, which the last bar's vote does not read.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'
import { Budget, DEFAULT_LIMITS } from '../../runtime/limits'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json')
const load = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

afterEach(() => { vi.unstubAllEnvs() })

/** A top-level definition of the captured source, verbatim: its header line
 *  through the last indented line under it. */
function definitionOf(source, head, bodyLines) {
  const lines = source.split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith(head))
  expect(at, `\`${head}\` is in the captured source`).toBeGreaterThan(0)
  const out = [lines[at]]
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i += 1) out.push(lines[i])
  expect(out.length, `\`${head}\` has ${bodyLines} body lines`).toBe(bodyLines + 1)
  return out
}
/** The captured source's lines from the one starting `from` through the one
 *  starting `to`, verbatim. */
function spanOf(source, from, to) {
  const lines = source.split(/\r?\n/)
  const a = lines.findIndex((l) => l.startsWith(from))
  const b = lines.findIndex((l, i) => i >= a && l.startsWith(to))
  expect(a, `\`${from}\``).toBeGreaterThan(0)
  expect(b, `\`${to}\``).toBeGreaterThanOrEqual(a)
  return lines.slice(a, b + 1)
}

const OPTS = { inputs: {}, pane: true, basePeriod: 'D', tf: 'D', ...runtimeClockOpts(false, { tf: 'D' }) }
const build = (src, rows, opts = {}) => buildRuntimeIr(src, { bars: rows, ...OPTS, ...opts })
function exec(built, rows, budget) {
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  return execute(program, {
    bars: rows.length, series, columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t),
  }, undefined, budget ? { budget } : undefined)
}
function run(src, rows, opts) {
  const built = build(src, rows, opts)
  if (!built.ok) return { refusal: built.refusal, diagnostics: built.diagnostics }
  const res = exec(built, rows)
  return { columns: res.outputs.map((o) => Array.from(o)), diagnostics: built.diagnostics }
}

/** The vendor's two functions, verbatim, over the captured inputs. */
const engine = (source) => [
  '//@version=6',
  'indicator("c47 simple switch")',
  // the captured values of the script's own inputs (`study.inputs`)
  'int    drmLen    = input.int(14, "Period")',
  'string drmMethod = input.string("RMA", "Smoothing", options = ["EMA", "SMA", "RMA", "TMA"])',
  'int    sigLen    = input.int(7, "Period")',
  'string sigMethod = input.string("EMA", "Smoothing", options = ["EMA", "SMA", "RMA", "TMA"])',
  ...definitionOf(source, 'smooth(', 6),
  ...definitionOf(source, 'drmEngine(', 7),
]
const script = (source, ...tail) => [...engine(source), ...tail, ''].join('\n')

const vendorPlot = (cap, title) => {
  const p = cap.study.plots.find((x) => x.title === title)
  expect(p, `the capture plots "${title}"`).toBeTruthy()
  const col = cap.plotValues.fields.indexOf(p.id)
  return cap.plotValues.rows.map((r) => r[col])
}
const agree = (ours, vendor) => {
  let compared = 0
  const off = []
  for (let i = 0; i < vendor.length; i += 1) {
    const v = vendor[i]
    if (v === null || v === undefined) continue
    compared += 1
    if (!(Math.abs(ours[i] - v) <= 1e-9 * Math.max(1, Math.abs(v)))) off.push(`bar ${i}: ours ${ours[i]} vendor ${v}`)
  }
  return { compared, off }
}

describe('⭐ C47 — the vendor\'s own `smooth` and `drmEngine`, verbatim, are TradingView\'s plots', () => {
  it('⭐⭐ the oscillator (`"RMA"`, through two frames) on every bar — nothing substituted', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'plot(drmEngine(close, drmLen, drmMethod))'), rows)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    // `drmEngine`'s call, and inside its copy the two `smooth(…, len, method)` calls
    expect(r.diagnostics.specialisedCalls).toBe(3)
    const { compared, off } = agree(r.columns[0], vendorPlot(cap, 'DRM Oscillator'))
    expect(compared).toBe(rows.length)                      // non-vacuity: every bar carries it
    expect(off.slice(0, 5), `${off.length} bars disagree`).toEqual([])
  }, 60000)

  it('⭐⭐ the signal line (`"EMA"`, a DIFFERENT arm at its own call site) on every bar', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text,
      'float oscVal = drmEngine(close, drmLen, drmMethod)',
      'float sigVal = smooth(oscVal, sigLen, sigMethod)',
      'plot(oscVal)', 'plot(sigVal)'), rows)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.diagnostics.specialisedCalls).toBe(4)
    const osc = agree(r.columns[0], vendorPlot(cap, 'DRM Oscillator'))
    const sig = agree(r.columns[1], vendorPlot(cap, 'Signal Line'))
    expect(osc.off.slice(0, 5)).toEqual([])
    expect(sig.compared).toBeGreaterThan(600)
    expect(sig.off.slice(0, 5), `${sig.off.length} bars disagree`).toEqual([])
    // ⛔ CONTROL: the two arms really differ on this data — were the signal smoothed
    // by the oscillator's arm ("RMA"), it would not be TradingView's line.
    const wrong = run(script(cap.source.text,
      'float oscVal = drmEngine(close, drmLen, drmMethod)', 'plot(smooth(oscVal, sigLen, "RMA"))'), rows)
    expect(agree(wrong.columns[0], vendorPlot(cap, 'Signal Line')).off.length).toBeGreaterThan(500)
  }, 60000)
})

describe('C47 — the arm is the CALL SITE\'s', () => {
  const served = (r) => {
    expect(r.refusal, r.refusal && `${r.refusal.guard}@${r.refusal.line}: ${r.refusal.message}`).toBeUndefined()
    return r.columns[0]
  }
  const each = (cap, rows, m) => served(run(script(cap.source.text, `plot(smooth(close, 5, "${m}"))`), rows))
  const direct = (rows, expr) => served(run(['//@version=6', 'indicator("d")', `plot(${expr})`, ''].join('\n'), rows))
  const same = (a, b) => {
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i += 1) {
      if (Number.isNaN(b[i])) expect(Number.isNaN(a[i]), `bar ${i}`).toBe(true)
      else expect(a[i], `bar ${i}`).toBeCloseTo(b[i], 9)
    }
  }

  it('each label takes its own arm; a text no label names takes the default arm', () => {
    const cap = load()
    const rows = toProductBars(cap)
    same(each(cap, rows, 'EMA'), direct(rows, 'ta.ema(close, 5)'))
    same(each(cap, rows, 'SMA'), direct(rows, 'ta.sma(close, 5)'))
    same(each(cap, rows, 'RMA'), direct(rows, 'ta.rma(close, 5)'))
    same(each(cap, rows, 'no such label'), direct(rows, 'ta.rma(close, 5)'))
    // control: the arms are not all one series
    const ema = each(cap, rows, 'EMA')
    const sma = each(cap, rows, 'SMA')
    expect(ema.filter((v, i) => Math.abs(v - sma[i]) > 1e-6).length).toBeGreaterThan(500)
  }, 60000)

  it('⛔ an arm this lane cannot lower refuses ONLY the call site that selects it (`"TMA"`: a window over a window)', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const tma = run(script(cap.source.text, 'plot(smooth(close, 5, "TMA"))'), rows)
    expect(tma.refusal && tma.refusal.guard).toBe('runtime:history-expression')
    expect(String(tma.refusal.message)).toContain('`ta.sma` over an expression')
    // …and every other call site is untouched by that arm's being there (the five above)
  }, 60000)

  it('two call sites with different texts run two arms, each with its own state', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const both = run(script(cap.source.text, 'plot(smooth(close, 5, "EMA") - smooth(close, 5, "SMA"))'), rows)
    expect(both.diagnostics.specialisedCalls).toBe(2)
    const want = each(cap, rows, 'EMA').map((v, i) => v - each(cap, rows, 'SMA')[i])
    same(both.columns[0], want)
  }, 60000)

  it('a `switch` with no default arm and no matching label is `na`', () => {
    const rows = toProductBars(load())
    const src = ['//@version=6', 'indicator("d")', 'pick(float s, simple string m) =>', '    switch m',
      '        "A" => s * 2', '        "B" => s * 3', 'plot(pick(close, "A"))', 'plot(pick(close, "Z"))', ''].join('\n')
    const r = run(src, rows)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.columns[0][10]).toBe(rows[10].c * 2)
    expect(r.columns[1].every((v) => Number.isNaN(v))).toBe(true)
  }, 60000)

  it('a text handed on through a caller\'s own parameter is fixed at the CALLER\'s call site', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const src = (call) => script(cap.source.text, 'wrap(float s, string mode) => smooth(s, 5, mode)', `plot(${call})`)
    const ema = run(src('wrap(close, "EMA")'), rows)
    const sma = run(src('wrap(close, "SMA")'), rows)
    same(served(ema), direct(rows, 'ta.ema(close, 5)'))
    same(served(sma), direct(rows, 'ta.sma(close, 5)'))
    // `wrap`'s copy, and `smooth`'s inside it
    expect(ema.diagnostics.specialisedCalls).toBe(2)
  }, 60000)

  it('⭐ the MEMBER\'S choice selects the arm, not the author\'s default', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const src = script(cap.source.text, 'plot(smooth(close, 5, sigMethod))')
    const dflt = run(src, rows)
    const sma = run(src, rows, { inputs: { sigMethod: 'SMA' } })
    same(dflt.columns[0], direct(rows, 'ta.ema(close, 5)'))
    same(sma.columns[0], direct(rows, 'ta.sma(close, 5)'))
  }, 60000)
})

describe('⛔ C47 — what the call-site rule does NOT serve', () => {
  it('⛔ a text only known while the bar runs is refused BY NAME, at the call', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'plot(smooth(close, 5, close > open ? "EMA" : "SMA"))'), rows)
    expect(r.refusal && r.refusal.guard).toBe('runtime:block-value')
    expect(r.refusal.message).toContain('`m` is declared `simple` in `smooth` and selects the arm of a `switch` there')
  }, 60000)

  it('⛔ …and through a caller\'s parameter the refusal names the CALLER\'s parameter', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'wrap(float s, string mode) => smooth(s, 5, mode)',
      'plot(wrap(close, close > open ? "EMA" : "SMA"))'), rows)
    expect(r.refusal && r.refusal.guard).toBe('runtime:block-value')
    expect(r.refusal.message).toContain('`mode` selects the arm of a `switch` in `wrap`')
  }, 60000)

  it('⛔ a text variable the script REASSIGNS is not fixed, whatever it was first given', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'string pick = "EMA"', 'pick := bar_index > 10 ? "SMA" : pick',
      'plot(smooth(close, 5, pick))'), rows)
    expect(r.refusal && r.refusal.guard).toBe('runtime:block-value')
    // control: the same name, never reassigned, is fixed
    const fixed = run(script(cap.source.text, 'string pick = "EMA"', 'plot(smooth(close, 5, pick))'), rows)
    expect(fixed.refusal, fixed.refusal && fixed.refusal.message).toBeUndefined()
  }, 60000)

  it('⛔ a text the author\'s `options` do not offer is the input\'s own refusal', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'plot(smooth(close, 5, sigMethod))'), rows, { inputs: { sigMethod: 'WMA' } })
    expect(r.refusal && r.refusal.guard).toBe('runtime:statement')
    expect(r.refusal.message).toContain('was given "WMA"')
  }, 60000)

  it('⛔ a subject declared `series`, a block arm, a label that is not a quoted string: the refusal each had', () => {
    const rows = toProductBars(load())
    const wrap = (def) => ['//@version=6', 'indicator("d")', ...def, 'plot(pick(close, "A"))', ''].join('\n')
    const series = run(wrap(['pick(float s, series string m) =>', '    switch m', '        "A" => s * 2', '        => s']), rows)
    const block = run(wrap(['pick(float s, simple string m) =>', '    switch m', '        "A" =>', '            s * 2', '        => s']), rows)
    const label = run(wrap(['string K = "A"', 'pick(float s, simple string m) =>', '    switch m', '        K => s * 2', '        => s']), rows)
    const afterDefault = run(wrap(['pick(float s, simple string m) =>', '    switch m', '        => s', '        "A" => s * 2']), rows)
    const twoDefaults = run(wrap(['pick(float s, simple string m) =>', '    switch m', '        "B" => s * 2', '        => s * 5', '        => s']), rows)
    const notAParameter = run(wrap(['string G = "A"', 'pick(float s, simple string m) =>', '    switch G', '        "A" => s * 2', '        => s']), rows)
    for (const [name, r] of Object.entries({ series, block, label, afterDefault, twoDefaults, notAParameter })) {
      expect(r.refusal, `${name}: still refused`).toBeTruthy()
      expect(r.refusal.guard, name).toBe('pine:block')
    }
    // control: the same definition in the served shape is served
    const ok = run(wrap(['pick(float s, simple string m) =>', '    switch m', '        "A" => s * 2', '        => s']), rows)
    expect(ok.refusal, ok.refusal && ok.refusal.message).toBeUndefined()
  }, 60000)

  it('⛔ artemis as written still stops, on its NEXT wall: a windowed builtin over a series this lane computes', () => {
    const cap = load()
    const built = buildRuntimeIr(cap.source.text, { bars: toProductBars(cap), ...OPTS })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:call-windowed-state')
    expect(built.refusal.line).toBe(281)
    expect(String(built.refusal.message)).toContain('ta.percentile_linear_interpolation')
    expect(built.diagnostics.specialisedCalls).toBe(4)
  }, 60000)

  it('⛔ graded: artemis\'s cells stay 21 / 16 — the five KNN cells are dropped, not drawn', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = load()
    const { verdict, integrity } = gradeCapture(cap)
    expect(integrity.ok).toBe(true)
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    expect(counts.tableCells).toEqual([21, 16])
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_artemis', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.translation.objectDiagnostics.runtimeRefused).toBe('runtime:call-windowed-state')
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({ 'cell:text': 5 })
  }, 60000)
})

describe('C47 — measured: the KNN vote against INSTRUCTIONS_PER_BAR', () => {
  /** The vendor's KNN section, verbatim, with everything it reads — `edit` may
   *  change lines of it, and the test that passes one says which and why. */
  const knnScript = (source, edit = (l) => l) => {
    const src = [
      ...engine(source),
      'string vpSrc  = input.string("HLC3", "MFI Source", options = ["Close", "HL2", "OHLC4", "HLC3"])',
      'int    knnK   = input.int(5, "Neighbors (K)")',
      'int    knnLen = input.int(100, "Training Window")',
      ...definitionOf(source, 'compress(', 2),
      'float oscVal = drmEngine(close, drmLen, drmMethod)',
      'float sigVal = smooth(oscVal, sigLen, sigMethod)',
      ...spanOf(source, 'int   vpFastLen', 'float vpMid'),
      ...spanOf(source, 'var array<float> knnF1', 'int   knnConf').map(edit),
      'plot(knnVal)', 'plot(knnConf)', '',
    ].join('\n')
    // the lifted text really is the vendor's vote: its loop and its commit
    expect(src).toContain('    for i = 0 to kSize - 1')
    expect(src).toContain('        int mi = array.indexof(kDist, array.min(kDist))')
    expect(src).toContain('    if array.size(knnF1) > knnLen')
    return src
  }

  it('⛔ as written the vote COMPILES and the run STOPS, by name: `array.min` over an `na` element (unmeasured)', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const built = build(knnScript(cap.source.text), rows)
    expect(built.ok, JSON.stringify(built.refusal && { g: built.refusal.guard, l: built.refusal.line, m: built.refusal.message })).toBe(true)
    let err = null
    try { exec(built, rows) } catch (e) { err = e }
    expect(err && err.name).toBe('CollectionError')
    expect(String(err.message)).toContain('array.min over an na element')
  }, 120000)

  it('the vote with its three features\' `na` filled: TradingView\'s `80%`, at the product\'s own limits', () => {
    const cap = load()
    const rows = toProductBars(cap)
    // ⚠️ THE THREE EDITS, AND WHY. The features are `na` while their inputs warm
    // up, so the memory holds `na` distances on the early bars and `array.min`
    // stops the run there (the case above). Filling them lets the run reach the
    // last bar, where the 100-bar memory holds no `na` at all — so the last bar's
    // vote reads nothing the edits touched, and the COUNT is the vendor's loop's.
    const FILLED = new Map([
      ['float kf1  = oscVal / 100.0', 'float kf1  = nz(oscVal, 50.0) / 100.0'],
      ['float kf2  = vpMid  / 100.0', 'float kf2  = nz(vpMid, 50.0) / 100.0'],
      ['float kf3  = (oscVal - sigVal + 100.0) / 200.0', 'float kf3  = nz(oscVal - sigVal + 100.0, 100.0) / 200.0'],
    ])
    let edits = 0
    const src = knnScript(cap.source.text, (l) => { if (FILLED.has(l)) { edits += 1; return FILLED.get(l) } return l })
    expect(edits).toBe(3)
    const built = build(src, rows)
    expect(built.ok, JSON.stringify(built.refusal && { g: built.refusal.guard, l: built.refusal.line, m: built.refusal.message })).toBe(true)
    // ⭐ AT THE PRODUCT'S OWN LIMITS — no test ceiling. It runs.
    const budget = new Budget(DEFAULT_LIMITS)
    const res = exec(built, rows, budget)
    const last = rows.length - 1
    const knnVal = res.outputs[0][last]
    const knnConf = res.outputs[1][last]
    // TradingView's KNN panel on the last bar: the confidence cell reads `80%`
    const cells = cap.objects.records.tableCells.map((c) => c.t)
    expect(cells).toContain('80%')
    expect(knnConf).toBe(80)
    expect([20, 80]).toContain(knnVal)
    // the count the task asked for: the worst bar of the whole run
    expect(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR).toBe(200000)
    expect(budget.counts.INSTRUCTIONS_PER_BAR).toBeLessThan(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR)
    expect(budget.counts.INSTRUCTIONS_PER_BAR).toBe(4944)     // 2.5% of the ceiling
  }, 120000)
})
