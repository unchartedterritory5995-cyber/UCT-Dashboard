// app/src/components/chart/ChartSettingsModal.rowSummary.test.jsx
//
// ─── THE ACTIVE ROW SAYS WHERE IT DRAWS AND HOW ─────────────────────────────
//
// ⛔⛔ THE LIST USED TO SAY ONLY THE NAME. For an indicator that was enough —
// everyone knows where RSI draws. Universal Data broke it: `QQQ` and `SPY` sat in
// the same flat list as `EMA 9` and `Volume` with nothing to say they are
// INSTRUMENTS, in panes of their own, drawn as lines. Four questions a member had
// to open the row to answer.
//
// ⭐ THE SUMMARY IS NOT A SECOND OPINION. It reads the same seams the expanded
// controls do, so these cases also pin that it cannot drift from the selects
// directly beneath it — change the style through the real control and the
// collapsed row must agree.
//
// ⛔ AND IT MUST STAY OUT OF THE EXPANDER'S ACCESSIBLE NAME. The first version
// nested it inside that button, which both renamed the control for a screen
// reader and broke every rail that addresses a row as `/^QQQ$/`. The last case
// here is that lesson, kept.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'

vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: (sym) => (sym === 'UCTA50' ? 'breadth' : 'security') }
})

const TF = 'D'
const WINDOW = 400
const secBar = (t, base) => ({ t, o: base, h: base + 2, l: base - 1.5, c: base + 0.5, v: 1000 })

function withSeries(cs, symbol) {
  primeSecondaryBars(symbol, TF, WINDOW, {
    bars: Array.from({ length: 12 }, (_, i) => secBar(`2026-09-${String(i + 1).padStart(2, '0')}`, 100 + i)),
  })
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

/** ⚠️ STATEFUL ON PURPOSE. `ChartSettingsModal` is CONTROLLED: a select writes
 *  through `onChange` and nothing re-renders unless the new settings come back
 *  in. With a no-op handler the first two cases below read the pre-change row and
 *  looked like the summary was stale — it was the harness that was. */
function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open
      settings={cs}
      onChange={(next) => { if (seen) seen.cs = next; setCs(next) }}
      onClose={() => {}}
    />
  )
}
/** `seen.cs` is the LIVE settings after every write — the orphan case below needs
 *  the state the UI actually produced, not the one it started from. */
const show = (cs, seen) => render(<Host initial={cs} seen={seen} />)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))

/** The row block whose EXPANDER TEXT is exactly this name.
 *  ⛔ Anchored on purpose: that is the guarantee the summary must not break. */
const rowFor = (re) => [...document.body.querySelectorAll('[data-row-id]')]
  .find((r) => re.test((r.querySelector('[aria-expanded]')?.textContent || '').trim()))

const summaryOf = (re) => {
  const row = rowFor(re)
  expect(row, `no active row matching ${re}`).toBeTruthy()
  return (row.querySelector('[class*="actMeta"]')?.textContent || '').trim()
}

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('the active row states where it draws and how', () => {
  it('⭐⭐ a direct symbol series says its PRESENTATION and its PANE', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(summaryOf(/^QQQ$/)).toBe('Line · Own pane')
  })

  it('⭐ the summary FOLLOWS the real style control', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    fireEvent.click(rowFor(/^QQQ$/).querySelector('[aria-expanded]'))
    const sel = screen.getByLabelText(/QQQ plot style/i)
    expect([...sel.options].some((o) => o.value === 'candles')).toBe(true)
    fireEvent.change(sel, { target: { value: 'candles' } })
    expect(summaryOf(/^QQQ$/)).toBe('Candles · Own pane')
  })

  it('⛔⛔ NOTHING ON THE FIXTURES — "Line · Main chart" five times is furniture', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    for (const name of [/^EMA 9$/, /^SMA 200$/, /^Volume$/]) {
      expect(summaryOf(name)).toBe('')
    }
  })

  it('⛔ NO SOURCE WHEN THE NAME ALREADY IS THE SOURCE — `QQQ · Source: QQQ` says it twice', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(summaryOf(/^QQQ$/)).not.toMatch(/Source/)
  })

  it('⛔ BREADTH is offered no Candles, and the row says Line', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'UCTA50')
    show(cs); openIndicators()
    expect(summaryOf(/^UCTA50$/)).toBe('Line · Own pane')
    fireEvent.click(rowFor(/^UCTA50$/).querySelector('[aria-expanded]'))
    const sel = screen.getByLabelText(/UCTA50 plot style/i)
    expect([...sel.options].some((o) => o.value === 'candles')).toBe(false)
  })

  it('⭐⭐ a GUEST names its host pane, and says so when the host is gone', () => {
    // Two series; send the second into the first's pane, then delete the host.
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const seen = { cs: null }
    show(b.cs, seen); openIndicators()
    fireEvent.click(rowFor(/^SPY$/).querySelector('[aria-expanded]'))
    const where = screen.getByLabelText(/SPY display in/i)
    const host = [...where.options].find((o) => /QQQ/.test(o.textContent))
    expect(host, 'the host pane is not offered as a destination').toBeTruthy()
    fireEvent.change(where, { target: { value: host.value } })
    expect(summaryOf(/^SPY$/)).toBe('Line · QQQ')

    // ⛔ THE HOST LEAVES AND THE GUEST MUST SAY SO — not silently reattach, and
    // not quietly claim a pane it is no longer in. Before this summary a member
    // had to OPEN the row to discover it.
    cleanup()
    const live = seen.cs || b.cs
    const orphaned = { ...live, indicatorInstances: (live.indicatorInstances || []).filter((i) => i.instanceId !== a.id) }
    show(orphaned); openIndicators()
    expect(summaryOf(/^SPY$/)).toMatch(/unavailable/i)
  })

  it('⛔⛔ THE SUMMARY IS NOT PART OF THE EXPANDER\'S NAME', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    const expander = rowFor(/^QQQ$/).querySelector('[aria-expanded]')
    // Anchored: nested inside, this read "QQQ Line · Own pane" — a screen reader
    // would announce that as the control's name, and every rail addressing the
    // row as `QQQ` went red. The text must live BESIDE the button.
    expect((expander.textContent || '').trim()).toBe('QQQ')
    expect(expander.querySelector('[class*="actMeta"]')).toBeNull()
  })
})
