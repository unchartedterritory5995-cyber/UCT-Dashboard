// app/src/components/chart/builder/memberPane/candleNotDrawn.test.js
//
// ─── ⛔⛔ H14, 2026-09-28 — A CANDLE IS NOT FOUR LINES ────────────────────────
//
// `MULTI_OUTPUT_CALLS` expands one `plotcandle(o, h, l, c)` into four outputs,
// and until this fix the member door carried every one as an ordinary plot. On
// production the committed corpus script `smt-divergence-ict-01…__3f66e16b3c`
// drew rows `open`, `high`, `low`, `close`, each `style: 'line'` — four lines
// where TradingView draws one candle.
//
// The rule: a candle or OHLC bar is WITHHELD and SAID BY NAME; the script's other
// plots still draw; a script whose only series is a candle is refused BY NAME.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const SMT = fs.readFileSync(path.join(REPO,
  'corpus/committed/smt-divergence-ict-01-tradingfinder-smart-money-technique__3f66e16b3c.pine'), 'utf8')

// ⚠️ A COMPUTED candle, on purpose: `plotcandle(open, high, low, close)` redraws
// the chart's own price series, which the translator already drops as a no-op
// (`pine.js`, "only when every arm is the unchanged price series"), so it never
// reaches this door and could not tell a fixed door from a broken one.
const script = (...body) => ['//@version=6', 'indicator("t", overlay = false)',
  'ho = ta.sma(open, 3)', 'hh = ta.sma(high, 3)', 'hl = ta.sma(low, 3)', 'hc = ta.sma(close, 3)',
  ...body, ''].join('\n')
const MIXED = script(
  'plot(ta.sma(close, 20), "SMA")',
  'plotcandle(ho, hh, hl, hc, "Candle")')
const CANDLE_ONLY = script('plotcandle(ho, hh, hl, hc, "Candle")')
const BAR_ONLY = script('plotbar(ho, hh, hl, hc, "Bars")')

const ROLES = ['open', 'high', 'low', 'close']
const id = `${MEMBER_PANE_DEF_PREFIX}-candle`
const labels = (r) => (r.rows || []).map((x) => x.label)

afterEach(() => { vi.unstubAllEnvs() })

describe('⛔⛔ a candle is withheld and named, never drawn as lines', () => {
  it('a script with a plot AND a candle draws the plot, withholds the candle, and says so', () => {
    const r = memberPaneDefinition({ source: MIXED, id })
    expect(r.reason).toBe(null)
    expect(r.ok).toBe(true)
    expect(labels(r)).toContain('SMA')
    for (const role of ROLES) expect(labels(r)).not.toContain(role)
    // Every carried row is the plot, or a hidden row derived from it — never a candle role.
    expect(r.rows.filter((x) => !x.hidden).map((x) => x.label)).toEqual(['SMA'])
    const note = r.notes.find((n) => n.name === '`plotcandle`')
    // ⭐ The wording carries the call's line since #233; #227 said it without one.
    expect(note && note.note).toMatch(/^This script's `plotcandle` \(line \d+\) draws candles, which this pane does not draw yet\.$/)
    // ⭐ ONE sentence for the four roles, and it rides on the saved document.
    expect(r.notes.filter((n) => n.name === '`plotcandle`')).toHaveLength(1)
    expect(r.definition.meta.disclosures).toContainEqual({ name: note.name, note: note.note })
  })

  it('a candle-only script is refused BY NAME, not as "declares nothing"', () => {
    const r = memberPaneDefinition({ source: CANDLE_ONLY, id })
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pane:not-drawn')
    expect(r.reason).toMatch(/^This script's `plotcandle` \(line \d+\) draws candles, which this pane does not draw yet\. It plots nothing else this pane can draw\.$/)
  })

  it('a bar-only script is refused BY NAME too', () => {
    const r = memberPaneDefinition({ source: BAR_ONLY, id })
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pane:not-drawn')
    expect(r.reason).toMatch(/`plotbar` \(line \d+\) draws OHLC bars, which this pane does not draw yet/)
  })

  // ⭐ THE LIVE SCRIPT, both flag states production could be in. Whatever else
  // the door decides about its drawings, it must never carry a candle role as a row.
  for (const [label, value] of [['objects-only OFF', ''], ['objects-only ON (production)', '1']]) {
    it(`the live smt-divergence script draws no candle-role line — ${label}`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', value)
      const r = memberPaneDefinition({ source: SMT, id })
      for (const role of ROLES) expect(labels(r)).not.toContain(role)
      if (r.ok) {
        expect(r.notes.map((n) => n.name)).toContain('`plotcandle`')
      } else {
        expect(r.reason).toMatch(/`plotcandle` \(line \d+\) draws candles/)
      }
    })
  }
})
