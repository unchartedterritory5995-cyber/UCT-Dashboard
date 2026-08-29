// app/src/components/chart/builder/ImportBox.toScreen.test.jsx
//
// ─── 🔴 THE WIRE-CUT FILE FOR "A PASTED INDICATOR BECOMES A SCREEN" ──────────
//
// ⛔⛔ THE MEASUREMENT THIS EXISTS FOR. 41 corpus scripts translate; all 41 can be
// SAVED; only 19 can be run as a SCREEN. 148 translated columns yield 49 scannable
// ones, and every one of the 99 refusals is the same gate — `yields`: the tree
// returns a NUMBER and a screen needs a CONDITION. The gate is CORRECT; what was
// missing is the one thing the member has to say.
//
// ⛔ EVERY CASE DRIVES `BuilderSheet`, NOT THE BOX. `toCondition.js` can be perfect
// and fully unit-tested while no member can reach it — which is this branch's own
// recorded failure, eight features over. Cut the tab, the box, or the `onPick`
// wiring and these go red while every component stays correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { conditionFrom, COMPARISONS, operatorLabel } from './toCondition'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { treeYieldsBool, translatePine } from '../engine/ast/pine'

beforeEach(() => {
  vi.useFakeTimers()
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const tab = (name) => screen.getByRole('tab', { name })
const pasteField = () => screen.getByTestId('pine-box').querySelector('textarea')

async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pasteField(), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

/** ⭐ A REAL INDICATOR THAT PLOTS A NUMBER — the shape 22 of the 41 translating
 *  corpus scripts have, and the reason this feature exists. */
const NUMERIC = `//@version=5
indicator("RSI", overlay=false)
length = input.int(14, "Length")
plot(ta.rsi(close, length))
`

/** ⭐ …and one that already answers a screen's question, for the control. */
const CONDITION = `//@version=5
indicator("Above the 200", overlay=true)
plot(close > ta.sma(close, 200) ? 1 : 0)
`

describe('the fixtures are what this file claims — measured, not assumed', () => {
  it('⛔ one plots a NUMBER and the other a CONDITION', () => {
    // ⚰️ NON-VACUITY FIRST. If the "numeric" script already yielded a condition,
    // every case below would pass against a box that never renders the offer.
    const num = translatePine(NUMERIC)
    const cond = translatePine(CONDITION)
    expect(num.refusal, num.refusal && num.refusal.message).toBe(null)
    expect(cond.refusal, cond.refusal && cond.refusal.message).toBe(null)
    const f = (o) => o.outputs.find((x) => x.formula).formula
    expect(treeYieldsBool(parseFormula(f(num)).ast)).toBe(false)
    expect(treeYieldsBool(parseFormula(f(cond)).ast)).toBe(true)
  })
})

describe('🔴 a numeric paste offers the comparison, and it reaches the formula', () => {
  it('⭐⭐ the offer appears for a numeric column', async () => {
    mount()
    await flush()
    await paste(NUMERIC)
    const offer = screen.getByTestId('pine-to-screen')
    expect(offer.textContent).toMatch(/number/i)
    // ⭐ EVERY DERIVED OPERATOR IS OFFERED — a hand-typed subset in the JSX would
    // be a second authority over a set `toCondition` derives from the manifest.
    const opts = [...screen.getByTestId('pine-screen-op').querySelectorAll('option')]
      .map((o) => o.value)
    expect(opts.sort()).toEqual([...COMPARISONS].sort())
    for (const op of COMPARISONS) {
      expect(offer.textContent).toContain(operatorLabel(op))
    }
  })

  it('⛔⛔ a column that ALREADY screens is offered nothing — this is not decoration', async () => {
    // ⚰️ THE CONTROL. A box rendering the block unconditionally would satisfy the
    // case above while telling every member their working screen needs fixing.
    mount()
    await flush()
    await paste(CONDITION)
    expect(screen.queryByTestId('pine-to-screen')).toBe(null)
  })

  it('⭐⭐ typing a threshold produces the CONDITION the scan door wants', async () => {
    mount()
    await flush()
    await paste(NUMERIC)
    fireEvent.change(screen.getByTestId('pine-screen-op'), { target: { value: '<' } })
    fireEvent.change(screen.getByTestId('pine-screen-value'), { target: { value: '30' } })
    await flush()

    const preview = screen.getByTestId('pine-screen-preview').textContent
    // ⛔ THE EXPECTATION IS THE MODULE'S OWN ANSWER, never a retyped string — a
    // literal here would go stale the day the wrapping changes and still pass.
    const want = conditionFrom(
      translatePine(NUMERIC).outputs.find((o) => o.formula).formula, '<', 30)
    expect(want.ok).toBe(true)
    expect(preview).toBe(want.formula)

    // ⭐⭐ AND IT ANSWERS A SCREEN'S QUESTION, which is the whole point.
    expect(treeYieldsBool(parseFormula(preview).ast)).toBe(true)

    // 🔴 THE WIRE: "Use this formula" must hand the SHEET the condition, not the
    // number. Without this the offer is a preview of something nobody receives.
    fireEvent.click(screen.getByTestId('pine-use'))
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
    await flush()
    expect(screen.getByLabelText('Formula').value).toBe(want.formula)
  })

  it('⛔ leaving the threshold BLANK keeps the column — a number is still chartable', async () => {
    // ⭐ THE OFFER IS OPTIONAL BY DESIGN. A member who wants to chart RSI should not
    // be forced to invent a threshold to get past this box.
    mount()
    await flush()
    await paste(NUMERIC)
    expect(screen.queryByTestId('pine-screen-preview')).toBe(null)
    fireEvent.click(screen.getByTestId('pine-use'))
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
    await flush()
    const numeric = translatePine(NUMERIC).outputs.find((o) => o.formula).formula
    expect(screen.getByLabelText('Formula').value).toBe(numeric)
  })

  it('⛔ a threshold that is not a number says so rather than screening on zero', async () => {
    // ⚰️ `Number('')` IS 0. Left to the conversion alone, clearing the box would
    // have built "below zero" — a real, saveable, scannable formula answering
    // nothing on every symbol, with nothing anywhere saying so.
    mount()
    await flush()
    await paste(NUMERIC)
    fireEvent.change(screen.getByTestId('pine-screen-value'), { target: { value: 'thirty' } })
    await flush()
    expect(screen.getByTestId('pine-screen-why').textContent).toMatch(/number/i)
    expect(screen.queryByTestId('pine-screen-preview')).toBe(null)
  })
})
