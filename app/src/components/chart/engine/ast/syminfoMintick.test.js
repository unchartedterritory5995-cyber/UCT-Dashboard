// app/src/components/chart/engine/ast/syminfoMintick.test.js
//
// ─── ⭐⭐ `syminfo.mintick` — THE SYMBOL'S REAL TICK, OR A REFUSAL BY NAME ────
//
// 2026-09-28. `syminfo.mintick` walled `deadband-hysteresis-filter-backquant`
// (`base := syminfo.mintick * tickThresh`) and sat inside several more corpus
// scripts. It is per-SYMBOL metadata, not semantics, so it enters evaluation
// through the channel `syminfo.ticker` already uses — `bind.js::bindingConstants`
// fed the chart's `{ticker, exchange}` — and the value comes from
// `symbolScope.json::tick_size`: the vendor's own `minmov / pricescale`, keyed by
// our store's exchange spelling, each entry backed by TradingView captures.
//
// ⛔ WHAT THIS FILE HOLDS THE DESIGN TO:
//   1. the table is DERIVED FROM CAPTURES — every served entry is re-read against
//      the vendor files it cites, and the vendor's own M01 plot is checked to be
//      minmov / pricescale on every bar;
//   2. a symbol whose exchange has no entry REFUSES BY NAME — no default, because
//      the captures prove a default would be wrong (OTC:AITX is 0.0001);
//   3. the value is PER SYMBOL — two bindings, two answers, in every lane;
//   4. the screener lane, whose rows carry no exchange, refuses at the door.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import SYMBOL_SCOPE from './symbolScope.json'
import {
  SYMBOL_TICK_SIZE, SYMBOL_EXCHANGE_CONFIRMED, tickText, symbolConstants,
  symbolConstantsWith, bindingConstants, foldBound, foldScalar, NotFoldable,
} from './bind.js'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from '../nativeRegistry'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor')
const LF = String.fromCharCode(10)

const SPY = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca' })
const AAPL = Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' })
const IMO = Object.freeze({ ticker: 'IMO', exchange: 'NYSE American' })
const AITX = Object.freeze({ ticker: 'AITX', exchange: 'OTC' })

const MINTICK = Object.freeze({
  type: 'textop', name: 'tonumber', args: [{ type: 'symtext', name: 'mintick' }],
})

/** Every vendor capture that carries a `symbol` block with a pricescale —
 *  DERIVED from the directory, never listed. */
function vendorCaptures() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.name.endsWith('.json')) continue
      const text = fs.readFileSync(p, 'utf8')
      if (!text.includes('"pricescale"')) continue
      let j
      try { j = JSON.parse(text) } catch { continue }
      if (j && j.symbol && typeof j.symbol === 'object' && j.symbol.pricescale !== undefined) {
        out.push({ file: path.relative(REPO, p).split(path.sep).join('/'), capture: j })
      }
    }
  }
  walk(VENDOR)
  return out
}
const CAPTURES = vendorCaptures()
const proName = (c) => c.symbol.pro_name || c.symbol.full_name

const SERVED = Object.entries(SYMBOL_SCOPE.tick_size).filter(([k]) => !k.startsWith('_'))

describe('⭐⭐ the tick table is DERIVED from vendor captures', () => {
  it('⛔ NON-VACUITY — captures were found and the table serves something', () => {
    expect(CAPTURES.length).toBeGreaterThanOrEqual(10)
    expect(Object.keys(SYMBOL_TICK_SIZE).length).toBeGreaterThan(0)
    // ⭐ The served set is EXACTLY the entries that name witnesses, derived.
    expect(Object.keys(SYMBOL_TICK_SIZE).sort())
      .toEqual(SERVED.filter(([, v]) => Array.isArray(v.witnesses) && v.witnesses.length).map(([k]) => k).sort())
  })

  it('⭐⭐ every witness has a capture, and every capture of it shows the entry\'s minmov / pricescale', () => {
    for (const [exchange, entry] of SERVED) {
      expect(SYMBOL_TICK_SIZE[exchange], exchange).toBe(tickText(entry.minmov, entry.pricescale))
      for (const witness of entry.witnesses) {
        const seen = CAPTURES.filter(({ capture }) => proName(capture) === witness)
        expect(seen.length, `${exchange}: no capture of witness ${witness}`).toBeGreaterThan(0)
        for (const { file, capture } of seen) {
          if (capture.symbol.minmov === undefined || capture.symbol.minmov === null) continue
          expect(capture.symbol.pricescale, `${file}`).toBe(entry.pricescale)
          expect(capture.symbol.minmov, `${file}`).toBe(entry.minmov)
        }
        // ⛔ At least ONE capture of the witness carries BOTH numbers — a witness
        // backed only by a pricescale (NVDA's meta files) is not a tick reading.
        expect(seen.some(({ capture }) => Number.isInteger(capture.symbol.minmov)),
          `${exchange}: witness ${witness} has no capture carrying minmov`).toBe(true)
      }
    }
  })

  it('⭐ a witness belongs to its STORE exchange — and a shared Pine prefix is not evidence', () => {
    // `confirmed` maps our store spelling to Pine's listed exchange. `AMEX` is
    // shared by `NYSE Arca` AND `NYSE American`, so an AMEX witness counts for
    // one of them only if it IS that key's own confirmed witness.
    const pineCount = {}
    for (const pine of Object.values(SYMBOL_EXCHANGE_CONFIRMED)) pineCount[pine] = (pineCount[pine] || 0) + 1
    for (const [exchange, entry] of SERVED) {
      const pine = SYMBOL_EXCHANGE_CONFIRMED[exchange]
      expect(pine, `${exchange} has no witnessed Pine prefix`).toBeTruthy()
      for (const witness of entry.witnesses) {
        const cap = CAPTURES.find(({ capture }) => proName(capture) === witness && capture.symbol.listed_exchange)
        expect(cap, witness).toBeTruthy()
        expect(cap.capture.symbol.listed_exchange, witness).toBe(pine)
        if (pineCount[pine] > 1) {
          expect(witness, `${exchange}: prefix ${pine} is shared, so only its own confirmed witness counts`)
            .toBe(SYMBOL_SCOPE.confirmed[exchange].witness)
        }
      }
    }
  })

  it('⭐⭐ the VENDOR\'s own M01 is minmov / pricescale on EVERY bar of every vw-mintick capture', () => {
    const minticks = CAPTURES.filter(({ capture }) => String(capture.id || '').startsWith('vw-mintick-'))
    // ⚰️ RE-PINNED 2026-10-04 (G16, the wave-16 gate): WAS 10. CAP round 4
    // (4ef702b60b, triage row 8) committed eight more vw-mintick captures on the
    // unserved listing classes (ARKK, BAC-PL, DFLIW, GRRRW, IMO, QQQ, XLK, YHNAU,
    // 2026-10-02). Every bar of all 18 still reads minmov / pricescale (below), so
    // the count moved because the evidence grew, not because a reading changed.
    expect(minticks.length).toBe(18)
    for (const { file, capture } of minticks) {
      const plot = capture.study.plots.find((p) => p.title === 'M01_mintick')
      expect(plot, file).toBeTruthy()
      const col = capture.plotValues.fields.indexOf(plot.id)
      const rows = capture.plotValues.rows
      expect(rows.length, file).toBeGreaterThanOrEqual(5)
      const want = capture.symbol.minmov / capture.symbol.pricescale
      for (const row of rows) expect(Math.abs(row[col] - want), `${file} @ ${row[0]}`).toBeLessThan(1e-12)
    }
  })

  it('⛔ OTC is the counter-example: measured 0.0001, and NOT served', () => {
    const aitx = CAPTURES.find(({ capture }) => proName(capture) === 'OTC:AITX')
    expect(aitx.capture.symbol.minmov / aitx.capture.symbol.pricescale).toBe(0.0001)
    expect(Object.keys(SYMBOL_TICK_SIZE)).not.toContain('OTC')
    for (const k of Object.keys(SYMBOL_SCOPE.tick_size._not_served).filter((x) => !x.startsWith('_'))) {
      expect(Object.keys(SYMBOL_TICK_SIZE), k).not.toContain(k)
    }
  })
})

describe('tickText — the vendor decimal, by integer arithmetic', () => {
  it('moves the point; refuses what is not a power-of-ten scale', () => {
    expect(tickText(1, 100)).toBe('0.01')
    expect(tickText(25, 100)).toBe('0.25')
    expect(tickText(1, 100000)).toBe('0.00001')
    expect(tickText(1, 10000)).toBe('0.0001')
    expect(tickText(1, 1)).toBe('1')
    expect(tickText(1, 3)).toBe(null)
    expect(tickText(0, 100)).toBe(null)
    expect(tickText(1.5, 100)).toBe(null)
    expect(tickText('1', 100)).toBe(null)
    // ⭐ and it parses back to exactly the vendor's quotient
    expect(Number(tickText(25, 100))).toBe(25 / 100)
    expect(Number(tickText(1, 100000))).toBe(1 / 100000)
  })
})

describe('⭐⭐ per SYMBOL — the binding decides, and an uncovered exchange refuses by name', () => {
  it('production table: listed witnessed exchanges answer, everything else is absent', () => {
    expect(symbolConstants(SPY)['syminfo.mintick']).toBe('0.01')
    expect(symbolConstants(AAPL)['syminfo.mintick']).toBe('0.01')
    expect(symbolConstants(IMO)).not.toHaveProperty('syminfo.mintick')
    expect(symbolConstants(AITX)).not.toHaveProperty('syminfo.mintick')
    expect(symbolConstants({ ticker: 'SPY', exchange: null })).not.toHaveProperty('syminfo.mintick')
    expect(symbolConstants({ ticker: 'X', exchange: 'NASDAQ Global Select' })).not.toHaveProperty('syminfo.mintick')
    expect(symbolConstants('SPY')).toEqual({})
  })

  it('⭐ TWO symbols, TWO answers — the value is read off the binding, not a constant', () => {
    const ticks = { NASDAQ: '0.01', CME: '0.25' }
    const a = symbolConstantsWith({}, { ticker: 'AAPL', exchange: 'NASDAQ' }, ticks)
    const b = symbolConstantsWith({}, { ticker: 'ES1!', exchange: 'CME' }, ticks)
    expect(foldScalar(MINTICK, a)).toBe(0.01)
    expect(foldScalar(MINTICK, b)).toBe(0.25)
    // …and the fold rewrites it WHEREVER it sits, not only in a window slot.
    const tree = { type: 'op', name: '*', args: [MINTICK, { type: 'num', value: 10 }] }
    expect(foldBound(tree, a).args[0]).toEqual({ type: 'num', value: 0.01 })
    expect(foldBound(tree, b).args[0]).toEqual({ type: 'num', value: 0.25 })
    // ⛔ it never mutates the saved tree — the next binding folds it afresh.
    expect(tree.args[0]).toBe(MINTICK)
  })

  it('⛔ an uncovered exchange STOPS the fold on `syminfo.mintick`, with the reason', () => {
    let err = null
    try { foldScalar(MINTICK, bindingConstants({ symbol: IMO })) } catch (e) { err = e }
    expect(err).toBeInstanceOf(NotFoldable)
    expect(err.what).toContain('syminfo.mintick')
    expect(err.what).toContain('tick_size')
    // and foldBound leaves it EXACTLY as it was, for the evaluator to refuse by name
    expect(foldBound(MINTICK, bindingConstants({ symbol: IMO }))).toBe(MINTICK)
  })
})

describe('⭐ the door — served on the chart pane, refused BY NAME on a screen', () => {
  const HEAD = `//@version=6${LF}indicator("t")${LF}`

  it('host lane: resolves to the bind-time node, not a number and not a refusal', () => {
    const t = translatePine(`${HEAD}plot(close + syminfo.mintick * 10)${LF}`, { strict: true })
    expect(t.ok, t.refusal && t.refusal.message).toBe(true)
    expect(t.outputs[t.selected].formula).toContain("text_tonumber(syminfo('mintick'))")
  })

  it('⛔ screener lane: refused at the door, naming the field and why a screen cannot', () => {
    const t = translatePine(`${HEAD}plot(close + syminfo.mintick * 10)${LF}`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
    expect(t.refusal.message).toContain('`syminfo.mintick`')
    expect(t.refusal.message).toContain('not on a screen')
    expect(t.refusal.message).not.toContain('the engine grammar does not hold')
  })

  it('⭐ the `math.max(…, syminfo.mintick)` offer is the SCREEN\'s alone', () => {
    const src = `${HEAD}plot(math.max(high - low, syminfo.mintick) > 1 ? 1 : 0)${LF}`
    const screen = translatePine(src)
    expect(screen.ok).toBe(false)
    expect(screen.refusal.suggest).toBe('(high - low)')
    expect(screen.refusal.message).toContain('math.max(high - low, syminfo.mintick)')
    const host = translatePine(src, { strict: true })
    expect(host.ok, host.refusal && host.refusal.message).toBe(true)
  })

  it('⛔ a number is not text: `str.length(syminfo.mintick)` names the FIELD', () => {
    const t = translatePine(`${HEAD}plot(close + str.length(syminfo.mintick))${LF}`, { strict: true })
    expect(t.ok).toBe(false)
    const said = [t.refusal, ...(t.refusals || [])].filter(Boolean).map((x) => x.message || '').join(' ')
    expect(said).toContain('`syminfo.mintick` is a NUMBER')
  })
})

describe('⭐⭐ the HOST lane end to end — computeFor with the chart\'s own symbol', () => {
  const SRC = `//@version=6${LF}indicator("t", overlay = true)${LF}plot(close + syminfo.mintick * 100)${LF}`
  const BARS = Array.from({ length: 30 }, (_, i) => ({
    t: `2026-01-${String(i + 1).padStart(2, '0')}`, o: 100, h: 101, l: 99, c: 100 + i, v: 1000,
  }))
  const run = (symbol) => {
    const built = memberPaneDefinition({ source: SRC })
    expect(built.ok, JSON.stringify(built.refusal || built.error || null)).toBe(true)
    const cols = computeFor(built.definition, BARS, {}, { tf: 'D', sym: symbol && symbol.ticker, symbol, newestBarIsForming: false })
    return { cols, errs: columnErrors(cols) || {} }
  }

  it('SPY (NYSE Arca, witnessed 1/100): close + 1 on every bar', () => {
    const { cols, errs } = run(SPY)
    expect(errs).toEqual({})
    const key = Object.keys(cols).find((k) => cols[k] && cols[k].length === BARS.length)
    expect(key).toBeTruthy()
    for (let i = 0; i < BARS.length; i += 1) expect(cols[key][i]).toBeCloseTo(BARS[i].c + 1, 10)
  })

  it('⛔ IMO (NYSE American, no capture) and no symbol at all: refused NAMING the field', () => {
    // ⭐ A single-plot definition THROWS its refusal (`computeFor`'s one-tree
    // path); a multi-plot one records it per column. Either way the sentence
    // must name the field — collect both shapes rather than assume one.
    for (const symbol of [IMO, null]) {
      let said = []
      try {
        const { errs } = run(symbol)
        said = Object.values(errs).map((e) => `${e.guard}: ${e.message}`)
      } catch (e) {
        said = [`${e.guard}: ${e.message}`]
      }
      expect(said.length, JSON.stringify(symbol)).toBeGreaterThan(0)
      expect(said.some((s) => s.includes('interpret:bind-time-text') && s.includes('syminfo.mintick')),
        JSON.stringify(said)).toBe(true)
    }
  })
})

describe('⭐⭐ the RUNTIME lane — state carried over the real tick', () => {
  const N = 6
  const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000 }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const SRC = `//@version=6${LF}indicator("t")${LF}var float acc = 0.0${LF}acc := acc + syminfo.mintick${LF}plot(acc)${LF}`

  it('SPY accumulates 0.01 a bar; an uncovered exchange refuses by name', () => {
    const built = buildRuntimeIr(SRC, { bars: BARS, inputs: {}, symbol: SPY })
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    const program = lowerIrProgram(built.ir)
    const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    const out = Array.from(r.outputs[0])
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBeCloseTo(0.01 * (i + 1), 12)

    for (const symbol of [IMO, undefined]) {
      const refused = buildRuntimeIr(SRC, { bars: BARS, inputs: {}, symbol })
      expect(refused.ok).toBe(false)
      expect(String(refused.refusal.message)).toContain('syminfo.mintick')
    }
  })

  it('⭐ deadband-hysteresis walks PAST its `syminfo.mintick` wall on a witnessed symbol', () => {
    // The script's `base := syminfo.mintick * tickThresh` (line 42). Without a
    // symbol the lane stops naming the field; with SPY it goes further and the
    // wall it meets next is NOT mintick. (On this base that next wall is the
    // runtime lane's `input.color` declaration — recorded in PARITY-PROGRAMME.)
    const src = fs.readFileSync(path.join(REPO,
      'corpus/committed/deadband-hysteresis-filter-backquant__3fb3d09595.pine'), 'utf8')
    const opts = { ...runtimeClockOpts(false), tf: 'D' }
    const without = buildRuntimeIr(src, opts)
    const withSym = buildRuntimeIr(src, { ...opts, symbol: SPY })
    const unwitnessed = buildRuntimeIr(src, { ...opts, symbol: IMO })
    expect(String(without.refusal && without.refusal.message)).toContain('syminfo.mintick')
    expect(String(unwitnessed.refusal && unwitnessed.refusal.message)).toContain('syminfo.mintick')
    if (!withSym.ok) {
      expect(String(withSym.refusal.message)).not.toContain('syminfo.mintick')
      expect(withSym.diagnostics.statements).toBeGreaterThan(without.diagnostics.statements)
    }
  })
})
