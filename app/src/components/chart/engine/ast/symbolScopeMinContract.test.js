// ─── ⭐⭐ W9-T4-F1 — `syminfo.mincontract`, held to its witness table ───────────
//
// `symbolScope.json::min_contract` serves `syminfo.mincontract` per witnessed
// exchange (our store's spelling), and the runtime hands the SAME value to the
// strategy broker as `ctx.minContract` (`runtimeColumns.js`). This rail:
//
//   1. re-reads every served row's capture files: the vendor's `M01_mincontract`
//      equals the row's value on every bar of every witness (non-vacuity control
//      `M03_len_ticker_CONTROL`), so a value TradingView did not print fails by name;
//   2. proves a row missing any of its five fields serves NOTHING (the loader);
//   3. drives the SERVING path with a synthetic table (`symbolConstantsWith`'s
//      parameter), and the production table's refusal path, through the fold and a
//      script — `lesson_built_tested_green_and_unreachable`.
//
// Today no capture exists, so the production table serves no row: every symbol
// refuses `syminfo.mincontract` by name. The day a capture lands a row, rail 1
// grades it with no edit here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import SYMBOL_SCOPE from './symbolScope.json'
import {
  symbolConstants, symbolConstantsWith, SYMBOL_MIN_CONTRACT, minContractTable, minContractOf,
  SYMBOL_EXCHANGE_CONFIRMED, SYMBOL_TICK_SIZE, SYMBOL_LISTING_FIELDS,
} from './bind'
import { BUILTIN_SYMBOL_NUMERIC } from './pine'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../tools/vendor_harness/schema.mjs'

const ROOT = path.resolve(process.cwd(), '..')
const raw = SYMBOL_SCOPE.min_contract
const rows = Object.entries(raw).filter(([k]) => !k.startsWith('_'))
const PROBE = 'tools/visual_conformance/probes/syminfo-mincontract.pine'
const REF = 'The smallest amount of the current symbol that can be traded. This limit is set by the exchange.'

function vendorColumns(cap) {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => {
    if (f === 'time') return
    out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i]))
  })
  return out
}

/**
 * ⭐⭐ r1 (review N1) — THE ONE CHECK A CITED CAPTURE MUST PASS, returned as named problems.
 * Provenance is the harness's own validator, `tools/vendor_harness/schema.mjs::validateCapture` — what
 * `verify_capture.mjs` runs, and what the `tick_size` / `listing_fields` rows' "receipt-verified,
 * verify_capture PASS" provenance means: the capture schema, the source text matching its sha256 and
 * the transport receipt over the whole body. Then: the harness tool that wrote it and its capture id,
 * the date the row claims, the COMMITTED probe as the script the vendor ran, the witness, and the
 * values. A hand-made JSON with matching plots fails here by name (the controls at the end).
 * ⚠️ The receipt is a transport check, not a signature: `sealCapture` can seal anything. What binds a
 * row to TradingView is the same as for every vendor fixture — the harness wrote it and a reviewer saw
 * the run — plus, here, the committed probe's sha256 and the witness symbol.
 */
function captureProblems(row, cap, probeText) {
  const out = []
  const v = validateCapture(cap)
  if (!v.ok) out.push(...v.errors.map((e) => `provenance: ${e}`))
  if (!cap || !cap.tool || cap.tool.snippet !== 'tools/vendor_harness/tv_capture.js'
    || !Number.isFinite(Number(cap.tool.version))) {
    out.push('provenance: not written by tools/vendor_harness/tv_capture.js')
  }
  if (!cap || typeof cap.id !== 'string' || !cap.id) out.push('provenance: no capture id')
  if (!cap || typeof cap.capturedAtUTC !== 'string' || !cap.capturedAtUTC.startsWith(row.captured)) {
    out.push(`provenance: captured ${cap && cap.capturedAtUTC}, the row says ${row.captured}`)
  }
  if (!cap || !cap.source || cap.source.sha256 !== sha256Hex(probeText)) out.push(`the vendor did not run ${PROBE}`)
  const pro = cap && cap.symbol && cap.symbol.pro_name
  if (!row.witnesses.includes(pro)) out.push(`a capture of ${pro}, not a witness of this row`)
  if (out.length) return out
  const cols = vendorColumns(cap)
  const ticker = pro.split(':').pop()
  const ctl = cols.get('M03_len_ticker_CONTROL')
  if (!(ctl && ctl.length > 0 && ctl.every((x) => x === ticker.length))) out.push('the control did not evaluate')
  const m = cols.get('M01_mincontract')
  if (!(m && m.length > 0 && m.every((x) => x === row.value))) out.push(`vendor ${m && m[0]} vs row ${row.value}`)
  return out
}

describe('W9-T4-F1 — every served min_contract row is what TradingView printed', () => {
  it('the loader serves exactly the rows in the file (a malformed row is not silently dropped)', () => {
    expect(Object.keys(SYMBOL_MIN_CONTRACT).sort()).toEqual(rows.map(([k]) => k).sort())
  })
  it('the table cites the v6 reference entry it serves, and states why nothing is served yet', () => {
    expect(raw._).toContain(REF)
    expect(raw._).toMatch(/often 1/)
    if (rows.length === 0) expect(raw._not_served).toMatch(/NO ROW IS SERVED YET/)
    expect(fs.existsSync(path.join(ROOT, 'tools/visual_conformance/probes/syminfo-mincontract.pine'))).toBe(true)
  })
  for (const [exchange, row] of rows) {
    it(`${exchange}: every witness has a capture, and every bar of it equals ${row.value}`, () => {
      const seen = new Set()
      const probeText = fs.readFileSync(path.join(ROOT, PROBE), 'utf8')
      for (const rel of row.captures) {
        const cap = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
        expect(captureProblems(row, cap, probeText), `${exchange} <- ${rel}`).toEqual([])
        seen.add(cap.symbol.pro_name)
      }
      expect([...seen].sort()).toEqual([...row.witnesses].sort())
    })
  }
})

describe('W9-T4-F1 — the loader: a row missing any field serves nothing', () => {
  const full = { value: 1, witnesses: ['NYSE:RDDT'], captured: '2026-11-08', how: 'h', captures: ['x.json'] }
  it('a complete row serves its value as decimal text', () => {
    expect(minContractTable({ NYSE: full })).toEqual({ NYSE: '1' })
    expect(minContractTable({ X: { ...full, value: 0.001 } })).toEqual({ X: '0.001' })
  })
  for (const drop of ['value', 'witnesses', 'captured', 'how', 'captures']) {
    it(`no \`${drop}\` ⇒ no row`, () => {
      const { [drop]: _gone, ...rest } = full
      expect(minContractTable({ NYSE: rest })).toEqual({})
    })
  }
  for (const [what, v] of [['empty witnesses', { witnesses: [] }], ['empty captures', { captures: [] }],
    ['a zero value', { value: 0 }], ['a negative value', { value: -1 }], ['a text value', { value: '1' }],
    ['a non-finite value', { value: Infinity }]]) {
    it(`${what} ⇒ no row`, () => { expect(minContractTable({ NYSE: { ...full, ...v } })).toEqual({}) })
  }
  it('an underscore key is commentary, never a row', () => {
    expect(minContractTable({ _x: full })).toEqual({})
  })
})

describe('W9-T4-F1 — one authority: the fold and the broker read the same value', () => {
  const synth = { NYSE: '1', 'Frac Exchange': '0.001' }
  const withSynth = (symbol) => symbolConstantsWith(SYMBOL_EXCHANGE_CONFIRMED, symbol, SYMBOL_TICK_SIZE,
    SYMBOL_LISTING_FIELDS, synth)
  it('`syminfo.mincontract` is a numeric symbol field (refused as text, settled at bind)', () => {
    expect(BUILTIN_SYMBOL_NUMERIC['syminfo.mincontract']).toBe('mincontract')
  })
  it('a witnessed exchange settles it; minContractOf reads the same entry', () => {
    const c = withSynth({ ticker: 'RDDT', exchange: 'NYSE' })
    expect(c['syminfo.mincontract']).toBe('1')
    expect(minContractOf(c)).toBe(1)
    expect(minContractOf(withSynth({ ticker: 'Z', exchange: 'Frac Exchange' }))).toBe(0.001)
  })
  it('an unwitnessed, empty or missing exchange settles nothing (never a default 1)', () => {
    for (const s of [{ ticker: 'BTCUSD', exchange: '' }, { ticker: 'AITX', exchange: 'OTC' }, { ticker: 'X' }, null]) {
      const c = withSynth(s)
      expect(Object.prototype.hasOwnProperty.call(c, 'syminfo.mincontract')).toBe(false)
      expect(minContractOf(c)).toBeUndefined()
    }
  })
  it('minContractOf refuses anything but positive decimal text', () => {
    for (const v of ['', '0', '-1', 'abc', 1, null]) expect(minContractOf({ 'syminfo.mincontract': v })).toBeUndefined()
    expect(minContractOf({})).toBeUndefined()
    expect(minContractOf(null)).toBeUndefined()
  })
  it('the PRODUCTION table today: NYSE:RDDT settles no minimum contract', () => {
    expect(SYMBOL_MIN_CONTRACT).toEqual({})
    expect(minContractOf(symbolConstants({ ticker: 'RDDT', exchange: 'NYSE' }))).toBeUndefined()
    // the neighbours it shares a key with still settle: the table is independent evidence
    expect(symbolConstants({ ticker: 'RDDT', exchange: 'NYSE' })['syminfo.pointvalue']).toBe('1')
  })
})

describe('W9-T4-F1 — a script reading `syminfo.mincontract`', () => {
  const bars = Array.from({ length: 5 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 10, h: 11, l: 9, c: 10, v: 1 }))
  it('on the production table refuses BY NAME (the bind-time field it names), never a guessed 1', () => {
    const built = buildRuntimeIr('//@version=6\nindicator("m")\nplot(syminfo.mincontract * close)\n',
      { bars, inputs: {}, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, pane: true })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('interpret:bind-time-text')
    expect(built.refusal.message).toMatch(/did not settle syminfo\.mincontract/)
  })
  it('its sibling `syminfo.pointvalue` on the same symbol settles (control: the refusal is the table, not the lane)', () => {
    const built = buildRuntimeIr('//@version=6\nindicator("m")\nplot(syminfo.pointvalue * close)\n',
      { bars, inputs: {}, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, pane: true })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  })
  it('the fold quotes the measurement reason the manifest carries', () => {
    expect(SYMBOL_SCOPE.pending_measurement.mincontract).toMatch(/smallest amount of the symbol that can be traded/)
    expect(SYMBOL_SCOPE.unserved_on_a_screen.mincontract).toMatch(/chart pane only/)
  })
})

describe('W9-T4-F1 r1 — the capture check refuses a forged or foreign capture (controls)', () => {
  const probeText = '//@version=6\nindicator("UCTPROBE_SYMINFO_MINCONTRACT")\nplot(syminfo.mincontract, "M01_mincontract")\n'
  const row = { value: 1, witnesses: ['NYSE:RDDT'], captured: '2026-11-08' }
  const T = [1762560000, 1762646400, 1762732800]
  const body = (over = {}) => ({
    schema: 'uct.vendor-capture/v1', id: 'w9t4f1-control', capturedAtUTC: '2026-11-08T21:00:00.000Z',
    tool: { snippet: 'tools/vendor_harness/tv_capture.js', version: 2 },
    symbol: { name: 'RDDT', pro_name: 'NYSE:RDDT' }, timeframe: '1D',
    source: { text: probeText, sha256: sha256Hex(probeText) },
    bars: { fields: ['time', 'open', 'high', 'low', 'close', 'volume'], timeUnit: 'unix-s', count: 3,
      rows: T.map((t) => [t, 100, 101, 99, 100.5, 1000]) },
    study: { plots: [{ id: 'plot_0', type: 'line', title: 'M01_mincontract' },
      { id: 'plot_1', type: 'line', title: 'M02_inverse' }, { id: 'plot_2', type: 'line', title: 'M03_len_ticker_CONTROL' }] },
    plotValues: { fields: ['time', 'plot_0', 'plot_1', 'plot_2'], rows: T.map((t) => [t, 1, 1, 4]) },
    ...over,
  })
  const problems = (cap) => captureProblems(row, cap, probeText).join('\n')
  it('POSITIVE control: a sealed, schema-valid capture of the committed probe on the witness passes', () => {
    expect(captureProblems(row, sealCapture(body()), probeText)).toEqual([])
  })
  it('a HAND-MADE JSON with the right plots but no receipt fails by name (provenance)', () => {
    expect(problems(body())).toMatch(/provenance: receipt: no receipt/)
  })
  it('a capture edited after sealing (M01 changed) fails its receipt', () => {
    const c = sealCapture(body())
    c.plotValues.rows[1][1] = 0.001
    expect(problems(c)).toMatch(/provenance: receipt: receipt/)
  })
  it('no schema id, no harness tool, or no capture id fails by name', () => {
    expect(problems(sealCapture(body({ schema: 'x' })))).toMatch(/provenance: schema must be/)
    expect(problems(sealCapture(body({ tool: { snippet: 'hand', version: 1 } }))))
      .toMatch(/not written by tools\/vendor_harness\/tv_capture\.js/)
    expect(problems(sealCapture(body({ id: '' })))).toMatch(/no capture id/)
  })
  it('a source sha256 that does not match its text fails (the harness validator)', () => {
    expect(problems(sealCapture(body({ source: { text: probeText, sha256: sha256Hex('other') } }))))
      .toMatch(/provenance: source\.sha256 does not match/)
  })
  it('a genuine-shaped capture of ANOTHER script fails: the vendor must have run the committed probe', () => {
    const other = probeText + '// edited\n'
    expect(problems(sealCapture(body({ source: { text: other, sha256: sha256Hex(other) } })))).toMatch(/the vendor did not run/)
  })
  it('a different date, a non-witness symbol, a dead control or another value each fail', () => {
    expect(problems(sealCapture(body({ capturedAtUTC: '2026-01-01T00:00:00Z' })))).toMatch(/the row says 2026-11-08/)
    expect(problems(sealCapture(body({ symbol: { name: 'AAPL', pro_name: 'NASDAQ:AAPL' } })))).toMatch(/not a witness/)
    const dead = body()
    dead.plotValues = { ...dead.plotValues, rows: T.map((t) => [t, 1, 1, 0]) }
    expect(problems(sealCapture(dead))).toMatch(/control did not evaluate/)
    const frac = body()
    frac.plotValues = { ...frac.plotValues, rows: T.map((t) => [t, 0.001, 1000, 4]) }
    expect(problems(sealCapture(frac))).toMatch(/vendor 0\.001 vs row 1/)
  })
  it('a REAL harness capture of another probe (the 2026-09-30 AAPL roster) fails: wrong script, wrong witness', () => {
    const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/vendor/harness/syminfo-roster-aapl-1d-2026-09-30.json'), 'utf8'))
    expect(validateCapture(cap).ok).toBe(true) // control: it IS a genuine harness capture
    const p = captureProblems(row, cap, fs.readFileSync(path.join(ROOT, PROBE), 'utf8')).join('\n')
    expect(p).toMatch(/the vendor did not run/)
    expect(p).toMatch(/not a witness/)
  })
})
