// ─── THE 2026-09-27 VOCABULARY WAVE — two names that needed no new column ────
//
// Census: `docs/pine/capture-queue-2026-09-27.md` and PARITY-PROGRAMME.md's
// dated section. Of the vocabulary walls standing at the member door, two were
// implementable from evidence already on disk, and both are IDENTITIES onto a
// column this engine already carries — so neither adds a table name, and
// neither moves a frozen per-ast digest or the Python lane:
//
//   1. `ta.vwap(hlc3)` / v4 `vwap(hlc3)` → `vwap()`. VENDOR-PINNED:
//      `tests/fixtures/vendor/groupb-round-max-vwap-spy-1d-2026-09-10.json`.
//   2. `year|month|dayofmonth|dayofweek|hour|minute(time)` → the bare clock
//      field. PINE-REFERENCE-PINNED (`year(time, timezone)`, timezone defaulting
//      to `syminfo.timezone`, is the bare `year` by definition); the confirmation
//      capture is OWED — probe `tools/visual_conformance/probes/vw-clock-vwap.pine`.
//
// Each rail also pins the NEAR MISS that must keep refusing, because "we serve
// this" and "we refuse this" are both facts, and only a pin that asserts both can
// tell a narrowing from a silent widening.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const V6 = '//@version=6\nindicator("p")\n'
const V4 = '//@version=4\nstudy("p")\n'

const tr = (src) => translatePine(src, { strict: true })
const formulaOf = (src) => {
  const t = tr(src)
  const o = (t.outputs || [])[t.selected]
  return { t, formula: o ? o.formula : null }
}

describe('ta.vwap(hlc3) is the zero-argument vwap — vendor-pinned', () => {
  const capture = JSON.parse(fs.readFileSync(
    path.join(VENDOR, 'groupb-round-max-vwap-spy-1d-2026-09-10.json'), 'utf8'))
  const reading = capture.ta_vwap_default_source

  it('the capture says what this rail relies on (read, not restated)', () => {
    // The identity: hlc3 written out equals the bare form on every bar read.
    expect(reading.vwap_hlc3_minus_vwap_noarg.all_zero).toBe(true)
    expect(reading.vwap_hlc3_minus_vwap_noarg.bars_read).toBeGreaterThanOrEqual(40)
    // The control: another source is NOT the same column.
    expect(reading.vwap_close_minus_vwap_noarg.all_zero).toBe(false)
  })

  it('ta.vwap(hlc3), the spelled-out typical price, and v4 vwap(hlc3) all read back as vwap()', () => {
    const bare = formulaOf(`${V6}plot(ta.vwap)`)
    expect(bare.formula).toBe('vwap()')
    for (const src of [
      `${V6}plot(ta.vwap(hlc3))`,
      `${V6}plot(ta.vwap((high + low + close) / 3))`,
      `${V4}plot(vwap(hlc3))`,
    ]) {
      const got = formulaOf(src)
      expect(got.t.ok, src).toBe(true)
      expect(got.formula, src).toBe(bare.formula)
    }
  })

  it('any other source still refuses, by name, and says which spelling works', () => {
    for (const src of [`${V6}plot(ta.vwap(close))`, `${V4}plot(vwap(high))`]) {
      const t = tr(src)
      expect(t.ok, src).toBe(false)
      expect(t.refusal.guard, src).toBe('pine:arity')
      expect(t.refusal.message, src).toMatch(/was given a source/)
      expect(t.refusal.message, src).toMatch(/ta\.vwap\(hlc3\)/)
    }
  })

  it('the anchored two-argument form is untouched — still the arity refusal', () => {
    const t = tr(`${V6}plot(ta.vwap(hlc3, timeframe.change("D")))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
    expect(t.refusal.message).toMatch(/was given 2 arguments/)
  })
})

describe('clock(time) is the bare clock field — Pine-reference-pinned, capture owed', () => {
  const FIELDS = ['year', 'month', 'dayofmonth', 'dayofweek', 'hour', 'minute']

  it('each field(time) reads back as exactly the bare field', () => {
    for (const f of FIELDS) {
      const bare = formulaOf(`${V6}plot(${f})`)
      const called = formulaOf(`${V6}plot(${f}(time))`)
      expect(bare.formula, f).toBe(f)
      expect(called.t.ok, f).toBe(true)
      expect(called.formula, f).toBe(bare.formula)
    }
  })

  it('the timenow form is unchanged (lastbar column), and dayofweek has none', () => {
    for (const f of ['year', 'month', 'dayofmonth', 'hour', 'minute']) {
      expect(formulaOf(`${V6}plot(${f}(timenow))`).formula, f).toBe(`lastbar${f}`)
    }
    const t = tr(`${V6}plot(dayofweek(timenow))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
  })

  it('a different bar, a named zone and a versionless script still refuse', () => {
    const cases = [
      [`${V6}plot(year(time[1]))`, 'pine:builtin'],
      [`${V6}plot(hour(time, "America/New_York"))`, 'pine:text-value'],
      [`${V6}plot(year(time + 86400000))`, 'pine:builtin'],
      // No `//@version`: bare `time` is OUR seconds column, not Pine's, and the
      // units refusal fires before this door is reached.
      ['study("p")\nplot(year(time))', 'pine:builtin'],
    ]
    for (const [src, guard] of cases) {
      const t = tr(src)
      expect(t.ok, src).toBe(false)
      expect(t.refusal.guard, src).toBe(guard)
    }
  })

  it('the refusal names the forms that DO work', () => {
    const t = tr(`${V6}plot(month(time[1]))`)
    expect(t.refusal.message).toMatch(/`month\(time\)`/)
    expect(t.refusal.message).toMatch(/`month\(timenow\)`/)
  })
})
