// ─── ⭐⭐ RT16 W1 — `time("", …)`: THE EMPTY TIMEFRAME IS THE CHART'S OWN ──────────
//
// Pine's reference defines `time`'s first argument's empty string as the chart's
// timeframe, in every version this engine reads (v4 "Resolution. An empty string
// is interpreted as the current resolution of the chart.", v5 "Timeframe. An empty
// string is interpreted as the current timeframe of the chart.", v6 "If the value
// is an empty string, the function uses the script's main timeframe." — extracted
// from TradingView's reference bundles 2026-10-04, quoted in
// `docs/pine/capture-queue-2026-10-04-rt16-clock.md`). So `time("", s[, tz])` and
// `time("")` are the measured `timeframe.period` forms, and nothing else is claimed:
// every value below is graded bar for bar against the vendor's own capture of the
// `timeframe.period` spelling.
//
// What it completes: `ict-killzone-index-version` (`time("", "0830-1201",
// "America/New_York")`) attaches at the member door.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { enterDoorState } from './harness'
import { translatePine } from '../../ast/pine.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const vendor = (cap, title) => {
  const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[c])
}
const same = (a, b) => (a === null || a === undefined || Number.isNaN(a))
  ? (b === null || b === undefined || Number.isNaN(b)) : Math.abs(a - b) <= 1e-9
const on = (capture, src) => runOurSide({ ...capture, source: { ...capture.source, text: src } })

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

// ── the session form, on the three `vw-time-session` captures ─────────────────────
// The probe's own source with every `time(timeframe.period, …)` re-spelled
// `time("", …)`. S15 ("2000-0000") is cut: the overnight window is refused for its
// own reason, whatever the timeframe is spelled.
const SESSION = ['vw-time-session-spy-1d-2026-09-28.json', 'vw-time-session-spy-60-rth-2026-09-28.json',
  'vw-time-session-spy-60-ext-2026-09-28.json']
const respell = (text) => text.split('\n')
  .filter((l) => !l.startsWith('tJ =') && !l.includes('"S15_'))
  .join('\n').split('time(timeframe.period, ').join('time("", ')
const SESSION_ROWS = ['S03_na_0930_1600', 'S04_secs_0930_1600', 'S05_na_0930_1000_OR_window', 'S06_secs_0930_1000',
  'S07_na_1000_1100_EXCLUDES_OPEN', 'S08_secs_1000_1100', 'S09_na_0930_1000_ALLDAYS',
  'S10_na_0930_1000_MON_FRI_23456', 'S11_na_OR_GMTminus4_CORPUS_FORM', 'S12_na_OR_GMTminus5',
  'S13_na_OR_America_New_York', 'S14_na_OR_syminfo_timezone', 'S16_na_0930_1030_IB_window', 'S17_secs_0930_1030']

describe('RT16 W1 — `time("", session[, tz])` is the measured `timeframe.period` session clock', () => {
  for (const file of SESSION) {
    it(`${file}: every session row equals TradingView's, bar for bar`, () => {
      const cap = load(file)
      const src = respell(cap.source.text)
      // non-vacuity: the re-spelling happened, and no `timeframe.period` session read is left
      expect(src.match(/^t[A-K] = time\("", /gm).length).toBe(10)
      expect(src).not.toMatch(/^t[A-K] = time\(timeframe\.period, /m)
      const ours = on(cap, src)
      expect(ours.ok, ours.refusal).toBe(true)
      let compared = 0
      let inside = 0
      for (const title of SESSION_ROWS) {
        const mine = ours.plots.find((p) => p.title === title)
        expect(mine && mine.column, title).toBeTruthy()
        const col = Array.from(mine.column)
        const theirs = vendor(cap, title)
        expect(col.length).toBe(theirs.length)
        const wrong = theirs.map((v, i) => (same(v, col[i]) ? -1 : i)).filter((i) => i >= 0)
        expect(wrong, `${title}: first differing bars`).toEqual([])
        compared += col.length
        if (title.startsWith('S03')) inside += col.filter((v) => v === 0).length
      }
      expect(compared).toBe(SESSION_ROWS.length * cap.bars.rows.length)
      expect(inside).toBeGreaterThan(0) // non-vacuity: bars inside the session were answered
    })
  }
})

// ── the anchor form, `time("")`, against T05 (`time(timeframe.period)`) ───────────
const ANCHOR = ['vw-time-tf-spy-1d-full-2026-10-01.json', 'vw-time-tf-spy-15-2026-10-01.json',
  'vw-time-tf-spy-5-2026-10-01.json', 'vw-time-tf-spy-1w-2026-10-01.json', 'vw-time-tf-spy-1m-2026-10-01.json']

describe('RT16 W1 — `time("")` is the measured `time(timeframe.period)`', () => {
  for (const file of ANCHOR) {
    it(`${file}: T05 bar for bar`, () => {
      const cap = load(file)
      const src = ['//@version=6', 'indicator("rt16 empty tf", overlay = false)',
        'days(t) => na(t) ? -99999.0 : (t - time) / 86400000.0',
        'plot(days(time("")), "T05_timeSelf_minus_time_MUST_BE_0")'].join('\n')
      const ours = on(cap, src)
      expect(ours.ok, ours.refusal).toBe(true)
      const col = Array.from(ours.plots[0].column)
      const theirs = vendor(cap, 'T05_timeSelf_minus_time_MUST_BE_0')
      expect(col.length).toBe(theirs.length)
      expect(theirs.map((v, i) => (same(v, col[i]) ? -1 : i)).filter((i) => i >= 0)).toEqual([])
      expect(col.filter((v) => v === 0).length).toBe(col.length) // the vendor reads 0 on every bar
    })
  }
})

describe('RT16 W1 — one node, and only the empty string', () => {
  const tree = (expr) => {
    const t = translatePine(['//@version=5', 'indicator("x")', `plot(${expr})`].join('\n'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal || null)).toBe(true)
    return JSON.stringify(t.outputs[t.selected].ast)
  }
  const refusal = (expr) => {
    const t = translatePine(['//@version=5', 'indicator("x")', `plot(${expr})`].join('\n'), { strict: true })
    return t.ok ? null : `${t.refusal.guard}: ${t.refusal.message}`
  }

  it('the same tree as the `timeframe.period` spelling, session and anchor forms', () => {
    expect(tree('time("", "0830-1201", "America/New_York")'))
      .toBe(tree('time(timeframe.period, "0830-1201", "America/New_York")'))
    expect(tree('time("", "0930-1000:23456")')).toBe(tree('time(timeframe.period, "0930-1000:23456")'))
    expect(tree('time("")')).toBe(tree('time(timeframe.period)'))
  })

  it('a string of spaces is not empty, and `time_close("")` stays refused with `time_close(timeframe.period)`', () => {
    expect(refusal('time(" ", "0930-1600")')).toMatch(/OWN timeframe/)
    expect(refusal('time(" ")')).toMatch(/OPENING TIMESTAMP/)
    expect(refusal('time_close("")')).toBeTruthy()
    expect(refusal('time_close(timeframe.period)')).toBeTruthy()
  })
})

describe('RT16 W1 — what it completes', () => {
  it('ict-killzone-index-version attaches at the member door (objects pane on, and with the runtime lane)', () => {
    const corpus = path.join(REPO, 'corpus', 'committed')
    const f = fs.readdirSync(corpus).find((x) => x.startsWith('ict-killzone-index-version__'))
    const src = fs.readFileSync(path.join(corpus, f), 'utf8')
    expect(src).toMatch(/time\("", "0830-1201", "America\/New_York"\)/)
    for (const state of ['on', 'runtime']) {
      enterDoorState(state)
      try {
        const door = enterMemberDoor(src)
        expect(door.def, `${state}: ${door.refusal}`).toBeTruthy()
        expect(door.built.lane || 'host').toBe('host')
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        vi.unstubAllEnvs()
        vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      }
    }
  })
})
