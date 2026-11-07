// app/src/components/chart/engine/ast/ruling0927.test.js
//
// ─── RULING-0927 (2026-11-07): THE FOUR ROWS "BLOCKED BY A RULING, NOT BY A CAPTURE" ─────
//
// `docs/pine/capture-queue-2026-09-27.md` listed four names whose evidence was already on
// disk and which waited only on a decision about what we serve. Each ruling below is held
// to the capture that decides it; `docs/pine/evidence/2026-11-07-ruling-0927/EVIDENCE.md`
// records them.
//
//   barstate.isnew          stays REFUSED, with the reason the captures give (newest bar
//                           undetermined from our inputs)
//   input.time              SERVED at its default on the translator lanes (T16, every bar)
//   ta.nvi / ta.pvi         served on the pane, refused on a screen (already ruled; pinned)
//   time(<session>) on 1D   served on the pane, refused on a screen (already ruled; pinned)
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const load = (rel) => JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
const V5 = '//@version=5\nindicator("r")\n'
const pane = (src) => translatePine(src, { strict: true, basePeriod: 'D' })
const screen = (src) => translatePine(src, { basePeriod: 'D' })
const runtimeDoc = (src, outputs = { a: 0 }) => ({
  id: 'r0927', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:r0927', outputs, source: src },
})
const CLOSED = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const refusalText = (t) => [t.refusal, ...(t.outputs || []).map((o) => o.refusal)]
  .filter(Boolean).map((r) => `${r.guard || r.code} ${r.message}`).join('\n')

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('barstate.isnew: the captures fix history and leave the newest bar open', () => {
  it('history is 1 and the newest bar of the closed chart is 0 (barstate-full tail)', () => {
    const d = load('barstate-full-spy-1d-closed-2026-09-10.json')
    const col = 1 + d.columns.indexOf('N25_isnew')
    const hist = 1 + d.columns.indexOf('N23_ishistory')
    const tail = d.payload.tail
    expect(tail.length).toBe(5)
    expect(tail.slice(0, -1).map((r) => r[col])).toEqual([1, 1, 1, 1])
    expect(tail.slice(0, -1).map((r) => r[hist])).toEqual([1, 1, 1, 1])
    expect(tail[tail.length - 1][col]).toBe(0)
  })

  it('on the newest bar the vendor answers BOTH values while our clock answers one', () => {
    const rows = load('barstate-daily-timeline.json').rows
    expect(rows.length).toBeGreaterThanOrEqual(9)
    // isnew tracks the vendor's own ishistory on every row …
    for (const r of rows) expect(r.vendor.isnew, r.instantET).toBe(r.vendor.ishistory)
    // … which takes both values (non-vacuous) …
    const seen = new Set(rows.map((r) => r.vendor.isnew))
    expect([...seen].sort()).toEqual([0, 1])
    // … while every input this engine has answered the same thing at every instant.
    expect(new Set(rows.map((r) => r.session.ourSeamSaysForming))).toEqual(new Set([false]))
    expect(new Set(rows.map((r) => r.symbol + r.tf + r.chartSession)).size).toBe(1)
  })

  it('so it stays refused by name on the pane, the screen and the runtime lane, citing the ruling', () => {
    const src = `${V5}plot(barstate.isnew ? 1 : 0)\nplot(close)\n`
    for (const t of [pane(src), screen(src)]) {
      expect(refusalText(t)).toMatch(/barstate\.isnew[\s\S]*RULING-0927/)
      expect(refusalText(t)).toMatch(/per-tick/)
    }
    let err = null
    try { computeRuntimeColumns(runtimeDoc(src, { a: 0, b: 1 }), [{ t: 1700000000, o: 1, h: 1, l: 1, c: 1, v: 1 }], CLOSED) } catch (e) { err = e }
    expect(err && String(err.message)).toMatch(/RULING-0927/)
  })
})

describe('input.time: the default, in milliseconds, on every bar (vw-time-tf T16)', () => {
  const CAP = 'vw-time-tf-spy-1d-2026-09-27.json'
  const T16 = 'T16_input_time_default_DAYS'
  const T16_LINE = 'startTime = input.time(timestamp("18 May 2022 00:00 +0000"), "Start Date")\n'
    + 'plot(startTime / 86400000.0, "T16_input_time_default_DAYS")\n'

  const capture = () => {
    const d = load(CAP)
    const col = 1 + d.study.plots.map((p) => p.title).indexOf(T16)
    expect(col).toBeGreaterThan(0)
    const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    const index = new Map(d.bars.rows.map((r, i) => [r[0], i]))
    return { d, col, bars, index }
  }

  it('the capture embeds the probe line this rail translates', () => {
    expect(load(CAP).source.text).toContain('input.time(timestamp("18 May 2022 00:00 +0000"), "Start Date")')
  })

  it('the pane lane matches T16 on every bar of the vendor source, byte-exact', () => {
    const { d, col, bars, index } = capture()
    const t = pane(d.source.text)
    const o = t.outputs.find((x) => x.title === T16)
    expect(o && o.formula, refusalText(t)).toBe('1652832000000 / 86400000')
    const ours = interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined, { tf: 'D' })
    expect(d.plotValues.rows.length).toBeGreaterThanOrEqual(8000)
    let bad = 0
    for (const r of d.plotValues.rows) if (!Object.is(ours[index.get(r[0])], r[col])) bad += 1
    expect(bad).toBe(0)
    expect(d.plotValues.rows[0][col]).toBe(19130)
  })

  it('the runtime lane agrees, on the same bars, byte-exact', () => {
    const { d, col, bars, index } = capture()
    const out = computeRuntimeColumns(runtimeDoc(`${V5}${T16_LINE}`), bars, CLOSED)
    let bad = 0
    for (const r of d.plotValues.rows) if (!Object.is(out.a[index.get(r[0])], r[col])) bad += 1
    expect(bad).toBe(0)
  })

  it('the screen lane folds the same constant (no viewer, no fetch dependence)', () => {
    const t = screen(`${V5}${T16_LINE}plot(close)\n`)
    expect(t.outputs.find((x) => x.title === T16).formula).toBe('1652832000000 / 86400000')
  })

  it('a default bound to a name follows the binding, as the runtime lane does (the kNN shape)', () => {
    const src = `${V5}int sd = timestamp("01 Jan 2021 00:00 +0000")\ns = input.time(sd, "S")\nplot(s / 86400000.0)\n`
    expect(pane(src).outputs[0].formula).toBe(`${Date.UTC(2021, 0, 1)} / 86400000`)
    const out = computeRuntimeColumns(runtimeDoc(src), [{ t: 1700000000, o: 1, h: 1, l: 1, c: 1, v: 1 }], CLOSED)
    expect(out.a[0]).toBe(Date.UTC(2021, 0, 1) / 86400000)
  })

  it('a default the runtime lane cannot read exactly is refused here with ITS sentence', () => {
    const t = pane(`${V5}s = input.time(timestamp(2021, 1, 1), "S")\nplot(time >= s ? close : open)\n`)
    expect(refusalText(t)).toMatch(/pine:input-kind[\s\S]*exchange's time zone/)
  })

  it('a member value for it is refused by name, never read in an unpinned unit', () => {
    const t = translatePine(`${V5}s = input.time(timestamp("01 Jan 2021 00:00 +0000"), "S")\nplot(time >= s ? close : open)\n`,
      { strict: true, basePeriod: 'D', inputValues: { s: Date.UTC(2022, 0, 1) } })
    expect(refusalText(t)).toMatch(/`s` is an `input.time`: this lane serves its default only/)
  })
})

describe('ta.nvi / ta.pvi and time(<session>) on daily bars: already ruled, pinned here', () => {
  it('nvi/pvi: the pane serves the level, the screen refuses it by name', () => {
    const src = `${V5}plot(ta.nvi)\nplot(ta.pvi)\n`
    const p = pane(src)
    expect(p.outputs.every((o) => o.formula)).toBe(true)
    expect(refusalText(screen(src))).toMatch(/ta\.nvi[\s\S]*RULED[\s\S]*ta\.pvi/)
  })

  it('nvi/pvi seed at exactly 1 on the first bar of the FULL-history capture, and the pane matches it', () => {
    const d = load('vw-nvi-pvi-spy-1d-full-2026-09-27.json')
    const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    const t = pane(`${V5}plot(ta.nvi)\nplot(ta.pvi)\n`)
    const titles = d.study.plots.map((x) => x.title)
    const nviCol = 1 + titles.findIndex((x) => /nvi/i.test(x) && !/pvi/i.test(x))
    const pviCol = 1 + titles.findIndex((x) => /pvi/i.test(x) && !/nvi/i.test(x))
    expect(nviCol).toBeGreaterThan(0)
    expect(pviCol).toBeGreaterThan(0)
    const [nvi, pvi] = t.outputs.map((o) => interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined, { tf: 'D' }))
    const first = d.plotValues.rows[0]
    expect(first[nviCol]).toBe(1)
    expect(first[pviCol]).toBe(1)
    let worst = 0
    for (let i = 0; i < d.plotValues.rows.length; i += 1) {
      const r = d.plotValues.rows[i]
      worst = Math.max(worst, Math.abs(nvi[i] - r[nviCol]) / r[nviCol], Math.abs(pvi[i] - r[pviCol]) / r[pviCol])
    }
    // exp(cum(ln)) is the same product in another association order: ~1e-12, not bit-exact.
    expect(worst).toBeLessThan(1e-9)
  })

  it('time(<session>) on a daily bar: the pane serves it, the screen refuses it by name', () => {
    const src = `${V5}plot(time(timeframe.period, "0930-1600:23456", "America/New_York"))\n`
    expect(pane(src).outputs[0].formula).toBeTruthy()
    expect(refusalText(screen(src))).toMatch(/SESSION CLOCK[\s\S]*A chart pane serves it; a screen does not/)
  })
})
