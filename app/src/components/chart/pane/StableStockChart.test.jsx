// app/src/components/chart/pane/StableStockChart.test.jsx
//
// The pane's StockChart memo boundary (StableStockChart.jsx): a render that only re-creates the listed
// callbacks does not re-render StockChart, and each listed callback still reaches the NEWEST function the
// pane passed; anything else (a value, an unlisted callback such as a `subscribe*`) renders it as before.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const R = vi.hoisted(() => ({ renders: 0, props: null }))
vi.mock('../../StockChart', () => ({
  default: (props) => { R.renders++; R.props = props; return null },
}))
const { default: StableStockChart } = await import('./StableStockChart')

const LISTED = ['onSettingsPersist', 'onSymbolChange', 'onTfChange', 'onWatermarkAdjustEnd', 'onWatermarkAnchor',
  'onTimeRangeChange', 'onDateNavApi', 'onDrawnBarCount']
const SETTINGS = Object.freeze({ k: 1 })
/** A pane render: the same values, and every callback a NEW function that records which render made it. */
const propsOf = (gen, calls, extra = {}) => ({
  sym: 'AAA', tf: 'D', settingsOverride: SETTINGS,
  ...Object.fromEntries(LISTED.map((k) => [k, (...a) => calls.push([gen, k, ...a])])),
  subscribeCrosshair: SUB,
  ...extra,
})
const SUB = () => () => {}

beforeEach(() => { cleanup(); R.renders = 0; R.props = null })

describe('StableStockChart', () => {
  it('⭐ new callback identities alone do not re-render StockChart, and every call reaches the newest callback', () => {
    const calls = []
    const v = render(<StableStockChart {...propsOf(1, calls)} />)
    expect(R.renders).toBe(1)
    const first = R.props
    v.rerender(<StableStockChart {...propsOf(2, calls)} />)
    v.rerender(<StableStockChart {...propsOf(3, calls)} />)
    expect(R.renders, 'StockChart renders after two callback-only pane renders').toBe(1)
    // StockChart still holds the functions it got first; each calls the pane's newest one
    for (const k of LISTED) first[k]('x')
    expect(calls).toEqual(LISTED.map((k) => [3, k, 'x']))
  })

  it('a value change renders StockChart, with the same trampolines', () => {
    const calls = []
    const v = render(<StableStockChart {...propsOf(1, calls)} />)
    const first = R.props
    v.rerender(<StableStockChart {...propsOf(2, calls, { sym: 'BBB' })} />)
    expect(R.renders).toBe(2)
    expect(R.props.sym).toBe('BBB')
    for (const k of LISTED) expect(R.props[k], k).toBe(first[k])
  })

  it('⛔ an UNLISTED callback keeps comparing by identity: a new `subscribeCrosshair` renders StockChart', () => {
    const calls = []
    const v = render(<StableStockChart {...propsOf(1, calls)} />)
    const sub2 = () => () => {}
    v.rerender(<StableStockChart {...propsOf(1, calls, { subscribeCrosshair: sub2 })} />)
    expect(R.renders).toBe(2)
    expect(R.props.subscribeCrosshair).toBe(sub2)
  })

  it('an absent callback stays absent (StockChart reads `typeof onX === "function"`)', () => {
    const calls = []
    render(<StableStockChart {...propsOf(1, calls, { onSymbolChange: undefined, onTfChange: null })} />)
    expect(R.props.onSymbolChange).toBeUndefined()
    expect(R.props.onTfChange).toBeNull()
    expect(typeof R.props.onTimeRangeChange).toBe('function')
  })
})
