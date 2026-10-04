// app/src/components/chart/builder/memberPane/h8ConstantRows.test.js
//
// ─── ⭐⭐ H8 (step 95) — A CONSTANT TRADINGVIEW DRAWS IS DRAWN ─────────────────
//
// `pine.js` stamps `hidden` (+ `hiddenReason: 'constant'`) on a row whose tree
// reads no bar. That is the SCREENER's rule (`f19a350581`: a constant is a scan
// that matches nothing on every symbol) and it stays. The member pane read the
// same flag as "draw no series", so `plot(0)`, `plot(syminfo.mintick)` and
// `ta.cum(1)` were missing from the member's chart while TradingView draws them.
// The chart now asks `hiddenOnChart`: hidden for every reason but a constant,
// and for a constant only when it IS `na` (TradingView draws nothing there either:
// cc-yata's b1..b5 / s1..s5).
//
// Both directions are railed here; the vendor captures are railed in
// `vendorHarness.f8Ungraded.test.js` / `vendorHarness.h8ConstantRows.test.js`.

import { describe, it, expect, afterEach } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { translatePine, hiddenOnChart } from '../../engine/ast/pine'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'

const SRC = [
  '//@version=5',
  'indicator("h8 constants")',
  'b = input.bool(false, "B")',
  'plot(close, "Close")',
  'plot(0, "Zero")',
  'plot(syminfo.mintick, "Tick")',
  'plot(ta.cum(1), "Count")',
  'plot(na, "Nothing")',
  'plotshape(b ? close > open : na, "Gated")',
  'plot(2, "AuthorHid", display = display.none)',
  ''].join('\n')

const installed = []
afterEach(() => {
  while (installed.length) registry.uninstallUserDefinition(installed.pop())
})

const rowOf = (t, title) => t.outputs.find((o) => o.title === title)

describe('H8 — `hiddenOnChart` separates the chart from the screen', () => {
  const t = translatePine(SRC, { strict: true })

  it('the SCREENER rule is unchanged: every constant row is still `hidden` with its reason', () => {
    for (const title of ['Zero', 'Tick', 'Count', 'Nothing', 'Gated']) {
      expect(rowOf(t, title).hidden, title).toBe(true)
      expect(rowOf(t, title).hiddenReason, title).toBe('constant')
    }
    expect(rowOf(t, 'AuthorHid').hiddenReason).toBe('author')
  })

  it('a constant TradingView draws is NOT hidden on the chart', () => {
    for (const title of ['Zero', 'Tick', 'Count']) expect(hiddenOnChart(rowOf(t, title)), title).toBe(false)
    expect(hiddenOnChart(rowOf(t, 'Close'))).toBe(false)
  })

  it('⛔ a constant that IS `na`, and an author-hidden row, stay hidden on the chart', () => {
    for (const title of ['Nothing', 'Gated', 'AuthorHid']) expect(hiddenOnChart(rowOf(t, title)), title).toBe(true)
  })
})

describe('H8 — the member pane draws what `hiddenOnChart` draws', () => {
  it('the zero line, the tick and the count are drawn rows; na and display.none are not', () => {
    const r = memberPaneDefinition({ source: SRC, id: `${MEMBER_PANE_DEF_PREFIX}-h8a` })
    expect(r.ok, r.reason).toBe(true)
    const plots = r.definition.plots.filter((p) => !p.conditionFor && p.colourFor === undefined)
    const byLabel = new Map(plots.map((p) => [p.label, p]))
    for (const l of ['Close', 'Zero', 'Tick', 'Count']) {
      expect(byLabel.has(l), l).toBe(true)
      expect(byLabel.get(l).hidden === true, l).toBe(false)
    }
    // `Gated` is not asserted here: the member door keeps `input.bool` as a live
    // parameter (a member can switch it on), so its tree is not a constant there.
    for (const l of ['Nothing', 'AuthorHid']) {
      expect(byLabel.has(l), l).toBe(true)
      expect(byLabel.get(l).hidden, l).toBe(true)
    }
    const { installed: got, errors } = registry.installUserDefinitions([r.definition])
    expect(errors || []).toEqual([])
    expect(got).toHaveLength(1)
    installed.push(r.definition.id)
  })

  it('a script whose only plot is `plot(0)` is drawn (TradingView draws its zero line)', () => {
    const r = memberPaneDefinition({ source: '//@version=5\nindicator("z")\nplot(0, "Zero")\n', id: `${MEMBER_PANE_DEF_PREFIX}-h8b` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.definition.plots.find((p) => p.label === 'Zero').hidden === true).toBe(false)
  })

  it('⛔ a script whose only plot is `plot(na)` still declares nothing a chart can draw', () => {
    const r = memberPaneDefinition({ source: '//@version=5\nindicator("n")\nplot(na, "Nothing")\n', id: `${MEMBER_PANE_DEF_PREFIX}-h8c` })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/nothing a chart can draw/)
  })
})
