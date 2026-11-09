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

const ROOT = path.resolve(process.cwd(), '..')
const raw = SYMBOL_SCOPE.min_contract
const rows = Object.entries(raw).filter(([k]) => !k.startsWith('_'))
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
      for (const rel of row.captures) {
        const cap = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
        const pro = cap.symbol && cap.symbol.pro_name
        expect(row.witnesses, `${rel} is a capture of ${pro}, not a witness of ${exchange}`).toContain(pro)
        seen.add(pro)
        const cols = vendorColumns(cap)
        const ticker = pro.split(':').pop()
        const ctl = cols.get('M03_len_ticker_CONTROL')
        expect(ctl && ctl.length > 0 && ctl.every((v) => v === ticker.length), `${rel}: control`).toBe(true)
        const m = cols.get('M01_mincontract')
        expect(m && m.every((v) => v === row.value), `${rel}: vendor ${m && m[0]} vs row ${row.value}`).toBe(true)
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
