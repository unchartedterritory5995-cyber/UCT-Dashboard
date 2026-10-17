import { render, act, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import { useEffect, useRef, useState } from 'react'

// ⛔ THE OVERLAY MUST CLEAR ON THE FIRST PAINT OF EVERY STEP, NOT EVERY OTHER ONE.
//
// Production, 2026-10-16 after the close: stepping the Focus list alternated fast/slow.
// On the slow steps StockChart painted the new ticker at ~15 ms and called
// `onDrawnBarCount`, yet "Loading chart…" stayed until that ticker's /api/bars answer
// re-reported ~600-900 ms later. The step before each slow step was fast, and its own
// late re-report found the pane already 'ready'.
//
// The mechanism (React 19): that late re-report is an updater returning the SAME state,
// so React eagerly bails out and leaves the update UNPROCESSED in the hook queue at the
// passive-effect (Default) lane. The next ArrowDown renders at the discrete (Sync) lane,
// skips it, so the hook keeps a base queue — and a render-phase setState is applied only
// to the rendered state, not to the base state. The new ticker's first-paint report is
// then rebased onto the PREVIOUS ticker's state, fails its key check, and is lost.
//
// ⚠️ This harness does NOT reproduce the production loss (jsdom + React 19 kept every
// first-paint report in every variant tried); it pins the walk the fix must keep green:
// the real ChartPane: a stand-in chart that reports once
// on its first paint and once more later (the network re-report), and a list stepped by a
// real keydown (discrete), exactly the shape of the production walk.

vi.mock('../../../../components/StockChart', () => ({
  default: function FakeChart({ sym, onDrawnBarCount }) {
    const cb = useRef(onDrawnBarCount); cb.current = onDrawnBarCount
    const [phase, setPhase] = useState(0)
    useEffect(() => { const t = setTimeout(() => setPhase(1), 300); return () => clearTimeout(t) }, [sym])
    const data = useRef({})
    const k = `${sym}|${phase}`
    if (!data.current[k]) data.current[k] = Array.from({ length: 60 }, (_, i) => ({ time: i }))
    const ohlc = data.current[k]
    useEffect(() => { cb.current?.(ohlc.length) }, [ohlc])   // the real chart reports on every ohlcData change
    return <div data-testid="fake-chart" data-sym={sym} />
  },
}))
import ChartPane from '../ChartPane'

const rows = Array.from({ length: 10 }, (_, i) => ({ ticker: `R${i}` }))
const WHY = { items: [], more: 0 }
const noop = () => {}
let tickPx = null
function Walk() {
  const [i, setI] = useState(0)
  const [px, setPx] = useState(100)
  tickPx = setPx
  return (
    <div data-testid="walk" tabIndex={-1} onKeyDown={e => { if (e.key === 'ArrowDown') setI(n => n + 1) }}>
      <ChartPane row={rows[i]} livePx={px} why={WHY} onFlag={noop} onWatch={noop} />
    </div>
  )
}
const state = (c) => c.querySelector('[data-chart-state]').getAttribute('data-chart-state')
const ticker = (c) => c.querySelector('[data-testid="focus-chart-pane"]').getAttribute('aria-label')

test('every step of a keyboard walk is ready on its first paint, including after a late re-report', async () => {
  const { container, getByTestId } = render(<Walk />)
  await act(async () => { await new Promise(r => setTimeout(r, 450)) })   // R0 painted AND re-reported
  expect(state(container)).toBe('ready')
  const seen = []
  for (let k = 1; k <= 6; k++) {
    fireEvent.keyDown(getByTestId('walk'), { key: 'ArrowDown' })        // a DISCRETE update, like a real key
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })  // first paint only — well before the re-report
    seen.push(`${ticker(container)}=${state(container)}`)
    // Live price ticks re-render the pane between the first paint and the re-report, as in
    // production; how many there are decides which fiber buffer is current when it lands.
    for (let t = 0; t < (k % 3); t++) await act(async () => { tickPx(p => p + 1) })
    await act(async () => { await new Promise(r => setTimeout(r, 420)) }) // the late re-report lands
  }
  expect(seen).toEqual(rows.slice(1, 7).map(r => `${r.ticker} chart=ready`))
})
