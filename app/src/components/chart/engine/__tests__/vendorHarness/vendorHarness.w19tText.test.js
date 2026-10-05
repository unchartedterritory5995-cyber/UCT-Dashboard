// ─── ⭐⭐ W19-T — TEXT VALUES AND INPUTS (wave-19 lane T) ─────────────────────────
//
// Three walls, each served from a capture and graded against it:
//   W1  a v4 generic `input("EMA", options = […])` whose default is a written string
//       is a TEXT input on the runtime lane (the kind is its default's, the rule RT6
//       applies to a colour default) — macd-with-filter-visual-backtest-module-sample,
//       williams-fractal-trailing-stops;
//   W2  `str.tostring(<text>)` is that text on the host lane (Q-RT11a,
//       `vw-rt11-builtins` A01-A05 on AMEX:SPY 1D / 60 / 1, CAP5 2026-10-04) —
//       scalping-strategy-with-williams-r-macd-and-sma-1-minute-only;
//   W3  `input.time(timestamp("DD Mon YYYY HH:MM +0000"))` is that UTC instant in
//       milliseconds (`vw-time-tf` T16, 18 captures) — session-hilo.
// Everything else in the family is refused by name and queued
// (`docs/pine/capture-queue-2026-10-05-w19-t.md`).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { enterDoorState } from './harness'
import { translatePine, witnessedTimestampMs } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const vendor = (cap, title) => {
  const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[c])
}
const same = (a, b) => (a === null || a === undefined || Number.isNaN(a))
  ? (b === null || b === undefined || Number.isNaN(b)) : Math.abs(a - b) <= 1e-9
const on = (capture, src) => runOurSide({ ...capture, source: { ...capture.source, text: src } })
const corpus = (slug) => {
  const dir = path.join(REPO, 'corpus', 'committed')
  const f = fs.readdirSync(dir).find((x) => x.startsWith(`${slug}__`))
  return fs.readFileSync(path.join(dir, f), 'utf8')
}
const door = (src, state) => {
  enterDoorState(state)
  try {
    const d = enterMemberDoor(src)
    return { attached: !!d.def, lane: d.built && d.built.lane ? d.built.lane : (d.def ? 'host' : null), refusal: d.refusal }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    vi.unstubAllEnvs()
  }
}
const host = (body, opts = {}) => translatePine(`//@version=5\nindicator("t")\n${body}\n`, { strict: true, ...opts })

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

// ── W2 — Q-RT11a ─────────────────────────────────────────────────────────────────
describe('W2 — `str.tostring(<text>)` is that text (Q-RT11a)', () => {
  const ROWS = ['A01 tostring(tf.period)==tf.period', 'A02 tostring(ticker)==ticker',
    'A03 tostring(literal)==literal', 'A04 len(tostring(tf.period))', 'A05 len(tf.period) CONTROL']
  for (const file of ['vw-rt11-builtins-spy-1d-2026-10-04.json', 'vw-rt11-builtins-spy-60-2026-10-04.json',
    'vw-rt11-builtins-spy-1-2026-10-04.json']) {
    it(`${file}: A01-A05 equal TradingView bar for bar`, () => {
      const cap = load(file)
      // the probe's own A rows, verbatim (the rest of it refuses for other reasons)
      const lines = cap.source.text.split('\n')
      const rows = lines.filter((l) => /^plot\(.*"A0[1-5] /.test(l))
      expect(rows.length).toBe(5)
      const src = ['//@version=6', 'indicator("w19t A rows", overlay = false)', ...rows].join('\n')
      const ours = on(cap, src)
      expect(ours.ok, ours.refusal).toBe(true)
      let graded = 0
      for (const title of ROWS) {
        const theirs = vendor(cap, title)
        const row = ours.plots.find((p) => p.title === title)
        if (!row.column) {
          // ⛔ the harness binds the door's translation (made at `D`) to this chart; a
          // row that reads `timeframe.period` is withheld there BY NAME, never drawn
          // off the other period. Graded instead at this chart's own period: the row
          // folds to ONE constant, which must be TradingView's on every bar.
          expect(row.missingReason, title).toMatch(/bind:period-reads/)
          const t = translatePine(src, { strict: true, basePeriod: cap.timeframe })
          expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
          const out = t.outputs.find((o) => o.title === title)
          expect(new Set(theirs), title).toEqual(new Set([Number(out.formula)]))
          graded += 1
          continue
        }
        const mine = Array.from(row.column)
        expect(mine.length).toBe(theirs.length)
        expect(theirs.map((v, i) => (same(v, mine[i]) ? -1 : i)).filter((i) => i >= 0), title).toEqual([])
        graded += 1
      }
      expect(graded).toBe(ROWS.length)
      // non-vacuity: TradingView read the identity (1) on every bar
      expect(new Set(vendor(cap, ROWS[0]))).toEqual(new Set([1]))
    })
  }

  it('the fold reads its argument and nothing else: a number is not text, a definition shadows it', () => {
    const tree = (b, o) => { const t = host(b, o); expect(t.ok, JSON.stringify(t.refusal)).toBe(true); return t.outputs[t.selected].formula }
    expect(tree('plot(str.tostring(timeframe.period) == "D" ? close : open)', { basePeriod: 'D' })).toBe('close')
    expect(tree('plot(str.tostring(timeframe.period) == "1" ? close : open)', { basePeriod: 'D' })).toBe('open')
    expect(tree('plot(str.tostring(timeframe.period) == "1" ? close : open)', { basePeriod: '1' })).toBe('close')
    expect(tree('plot(str.tostring("abc") == "abc" ? close : open)')).toBe('close')
    // ⛔ a NUMBER: still not a string this fold knows
    expect(host('plot(str.tostring(close) == "1" ? close : open)').ok).toBe(false)
    // ⛔ a NUMBER symbol field is a formatting question (smarter-snr): the refusal
    // keeps naming the `str.*` call, never "a NUMBER, not text"
    const snr = host('plot(str.length(str.tostring(syminfo.mintick)))')
    expect(snr.ok).toBe(false)
    expect(snr.refusal.message).toMatch(/`str\.length`|`str\.tostring`/)
    expect(snr.refusal.message).not.toMatch(/not text/)
    // ⭐ a TEXT symbol field unwraps (A02's shape)
    expect(host('plot(str.tostring(syminfo.ticker) == syminfo.ticker ? close : open)').ok).toBe(true)
    // ⛔ two arguments (a format): not the identity that was measured
    expect(host('plot(str.tostring("abc", "#") == "abc" ? close : open)').ok).toBe(false)
  })

  it('scalping-strategy-with-williams-r-macd-and-sma-1-minute-only attaches (host lane)', () => {
    const src = corpus('scalping-strategy-with-williams-r-macd-and-sma-1-minute-only')
    expect(src).toMatch(/str\.tostring\(timeframe\.period\) == "1"/)
    const d = door(src, 'runtime')
    expect(d.attached, d.refusal).toBe(true)
    expect(d.lane).toBe('host')
  })
})

// ── W3 — `input.time` at its witnessed default ────────────────────────────────────
describe('W3 — `input.time(timestamp("… +0000"))` is that UTC instant (vw-time-tf T16)', () => {
  const T16 = 'T16_input_time_default_DAYS'
  for (const file of ['vw-time-tf-spy-1d-2026-09-28.json', 'vw-time-tf-spy-60-2026-09-28.json',
    'vw-time-tf-bitstamp-btcusd-1d-2026-09-30.json', 'vw-time-tf-spy-1w-2026-10-02.json']) {
    it(`${file}: T16 bar for bar`, () => {
      const cap = load(file)
      const lines = cap.source.text.split('\n')
      const keep = lines.filter((l) => l.startsWith('startTime = input.time(') || l.includes(`"${T16}"`))
      expect(keep.length).toBe(2)
      const ours = on(cap, ['//@version=6', 'indicator("w19t T16", overlay = false)', ...keep].join('\n'))
      expect(ours.ok, ours.refusal).toBe(true)
      const mine = Array.from(ours.plots.find((p) => p.title === T16).column)
      const theirs = vendor(cap, T16)
      expect(mine.length).toBe(theirs.length)
      expect(theirs.map((v, i) => (same(v, mine[i]) ? -1 : i)).filter((i) => i >= 0)).toEqual([])
      expect(new Set(theirs)).toEqual(new Set([19130])) // non-vacuity
    })
  }

  it('the instant composes with Pine `time` (milliseconds) as written', () => {
    const t = host('s = input.time(timestamp("18 May 2022 00:00 +0000"), "S")\nplot(time >= s ? close : open)')
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toMatch(/1652832000000/)
  })

  it('the witnessed grammar only — every other spelling refuses by name', () => {
    expect(witnessedTimestampMs('18 May 2022 00:00 +0000')).toBe(1652832000000)
    expect(witnessedTimestampMs('01 Jan 2023 00:00 +0000')).toBe(Date.UTC(2023, 0, 1))
    expect(witnessedTimestampMs('31 Feb 2023 00:00 +0000')).toBe(null)
    for (const s of ['18 May 2022 00:00', '01 Jan 2000 00:00:00 GMT+10', '2022-05-18T00:00:00Z', '18 May 2022 00:00 +0100']) {
      expect(witnessedTimestampMs(s), s).toBe(null)
      const t = host(`s = input.time(timestamp("${s}"), "S")\nplot(time >= s ? close : open)`)
      expect(t.ok, s).toBe(false)
      expect(t.refusal.guard).toBe('pine:input-kind')
      expect(t.refusal.message).toMatch(/no capture has read/)
    }
    const num = host('s = input.time(1652832000000, "S")\nplot(time >= s ? close : open)')
    expect(num.ok).toBe(false)
    expect(num.refusal.message).toMatch(/not written as `timestamp/)
    const conf = host('s = input.time(timestamp("18 May 2022 00:00 +0000"), "S", confirm = true)\nplot(time >= s ? close : open)')
    expect(conf.ok).toBe(false)
    expect(conf.refusal.message).toMatch(/confirm = true/)
  })

  it('locked: a member value is refused, never half-applied; no parameter is minted', () => {
    const src = 's = input.time(timestamp("18 May 2022 00:00 +0000"), "S")\nplot(time >= s ? close : open)'
    const moved = host(src, { inputValues: { s: 1700000000000 } })
    expect(moved.ok).toBe(false)
    expect(moved.refusal.message).toMatch(/`s` is an `input.time`/)
    const minted = host(src, { paramManifest: true })
    expect(minted.ok, JSON.stringify(minted.refusal)).toBe(true)
    expect((minted.inputParams || []).map((p) => p.sourceName)).not.toContain('s')
  })

  it('session-hilo attaches (host lane)', () => {
    const src = corpus('session-hilo')
    expect(src).toMatch(/defval=timestamp\('18 May 2022 00:00 \+0000'\)/)
    const d = door(src, 'runtime')
    expect(d.attached, d.refusal).toBe(true)
    expect(d.lane).toBe('host')
  })
})

// ── W1 — a v4 generic `input` with a string default is a text input ───────────────
describe('W1 — v4 `input("EMA", options = […])` is a text input on the runtime lane', () => {
  const N = 3
  const BARS = Array.from({ length: N }, (_, i) => (
    { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const V4 = '//@version=4\nstudy("t", overlay = true)\n'
  const build = (src, inputs) => buildRuntimeIr(V4 + src, { bars: BARS, inputs: inputs || {} })
  const runPine = (src, inputs) => {
    const built = build(src, inputs)
    if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
    const program = lowerIrProgram(built.ir)
    return Array.from(execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs[0])
  }
  const body = 'm = input("EMA", title = "MA", options = ["EMA", "SMA"])\nf(t) =>\n    float v = na\n    if (t == "EMA")\n        v := close\n    if (t == "SMA")\n        v := open\n    v\nplot(f(m))\n'

  it('the default, positional or named, is what the script sees', () => {
    expect(runPine(body)).toEqual(BARS.map((b) => b.c))
    expect(runPine(body.replace('input("EMA", title = "MA",', 'input(title = "MA", defval = "SMA",'))).toEqual(BARS.map((b) => b.o))
  })

  it("the member's value wins, and only inside the author's options", () => {
    expect(runPine(body, { m: 'SMA' })).toEqual(BARS.map((b) => b.o))
    const r = build(body, { m: 'WMA' })
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/`m` was given "WMA"/)
  })

  it('CONTROL: a numeric generic `input` keeps the numeric path', () => {
    expect(runPine('n = input(2, title = "N")\nplot(close * n)\n')).toEqual(BARS.map((b) => b.c * 2))
  })

  for (const slug of ['macd-with-filter-visual-backtest-module-sample', 'williams-fractal-trailing-stops']) {
    it(`${slug} attaches (runtime lane)`, () => {
      const d = door(corpus(slug), 'runtime')
      expect(d.attached, d.refusal).toBe(true)
      expect(d.lane).toBe('runtime')
    })
  }
})
