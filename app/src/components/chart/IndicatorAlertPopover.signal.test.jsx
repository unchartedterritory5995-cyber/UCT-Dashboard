import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// ─── P1 SIGNAL — THE POPOVER'S THRESHOLD DEFECT ON A YES/NO OUTPUT ──────────
//
// BEFORE: a user formula's plot was offered the four LEVEL conditions and its
// empty threshold box was prefilled from the current value — on a 0/1 output,
// `1` — so the default submit was `cross_above 1`, which can never fire on a
// {0, 1} column. AFTER: a CONDITION / EVENTS output (typed by the ONE authority
// from the installed definition, else by the server's own derivation served on
// the catalog plot) is offered trigger policies instead; a numeric SERIES keeps
// the numeric conditions exactly as before.

const H = vi.hoisted(() => ({
  catalog: { catalog: [], isLoading: false, error: null, refusals: [] },
  alerts: [],
  created: [],
  valueCalls: [],
  defs: {},
}))

vi.mock('../../hooks/useIndicatorAlerts', () => ({
  useIndicatorAlerts: () => ({ alerts: H.alerts, isLoading: false, refresh: () => {} }),
  useIndicatorAlertCatalog: () => H.catalog,
  createIndicatorAlert: (payload) => { H.created.push(payload); return Promise.resolve({ ok: true, id: 1 }) },
  deleteIndicatorAlert: () => {},
  toggleIndicatorAlert: () => {},
  fetchCurrentValue: (args) => { H.valueCalls.push(args); return Promise.resolve(1) },
}))

vi.mock('./engine/nativeRegistry', async (orig) => {
  const real = await orig()
  return { ...real, getDefinition: (id) => H.defs[id] || null }
})

import IndicatorAlertPopover from './IndicatorAlertPopover'
import { parseFormula } from './engine/ast/parse'

const LEVEL = [
  { value: 'above', label: 'Above', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true },
  { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
  { value: 'below', label: 'Below', needs_threshold: true },
]
const userEntry = (id, outputType) => ({
  indicator: id, label: 'Mine', source: 'user', conditions: LEVEL, default_threshold: null,
  plots: [{ value: `${id}.value`, label: 'Mine', conditions: LEVEL, default_threshold: null,
    inputs: {}, output_type: outputType }],
})
const astDef = (id, src) => ({ id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
  compute: { kind: 'ast', fn: id, ast: parseFormula(src).ast } })

const C1 = 'u_51a1000000c1'
const S1 = 'u_51a1000000c2'

beforeEach(() => {
  H.alerts = []
  H.created.length = 0
  H.valueCalls.length = 0
  H.defs = {}
})
afterEach(cleanup)

describe('IndicatorAlertPopover — a yes/no output alerts by trigger policy, not by a threshold', () => {
  it('BEFORE→AFTER: a CONDITION output offers is true / becomes true / becomes false, no Threshold box, no current-value prefill, and submits the policy', async () => {
    H.catalog = { catalog: [userEntry(C1, 'condition')], isLoading: false, error: null, refusals: [] }
    render(<IndicatorAlertPopover sym="aapl" onClose={() => {}} />)
    const sel = screen.getByLabelText('Trigger policy')
    expect([...sel.options].map((o) => o.value)).toEqual(['becomes_true', 'becomes_false', 'is_true'])
    expect(screen.queryByLabelText('Threshold')).toBeNull()
    expect(screen.queryByLabelText('Condition')).toBeNull()
    fireEvent.change(sel, { target: { value: 'becomes_false' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0]).toEqual({ sym: 'AAPL', indicator: `${C1}.value`, tf: 'D',
      trigger_policy: 'becomes_false', condition: 'cross_below', threshold: 0.5 })
    expect(H.valueCalls).toHaveLength(0)
  })

  it('a numeric SERIES output keeps the numeric conditions and the prefill, unchanged', async () => {
    H.catalog = { catalog: [userEntry(S1, 'series')], isLoading: false, error: null, refusals: [] }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.queryByLabelText('Trigger policy')).toBeNull()
    expect(screen.getByLabelText('Condition')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Threshold').value).toBe('1'))
  })

  it('the INSTALLED definition is the type authority: a served label cannot make a SERIES a signal', () => {
    H.defs[S1] = astDef(S1, 'sma(close, 5)')
    H.catalog = { catalog: [userEntry(S1, 'condition')], isLoading: false, error: null, refusals: [] }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.queryByLabelText('Trigger policy')).toBeNull()
  })

  // ⭐ PHASE 5 SUPERSEDES this rule: the alert lane SUPPLIES another symbol now, so a
  // yes/no reading SPY arms; one reading an AMBIGUOUS spelling (VIX) is still blocked.
  it('the shared gate preflight blocks arming a yes/no that reads a symbol the alert lane cannot supply, with the gate\'s sentence', () => {
    H.defs[C1] = astDef(C1, "close > sym('VIX', close)")
    H.catalog = { catalog: [userEntry(C1, 'condition')], isLoading: false, error: null, refusals: [] }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    const why = screen.getByTestId('alert-signal-refused')
    expect(why.getAttribute('data-guard')).toBe('alert:withheld')
    expect(why.textContent).toMatch(/another\s+symbol it cannot load/)
    expect(screen.getByRole('button', { name: /add alert/i })).toBeDisabled()
  })

  it('⭐ PHASE 5 — a yes/no that reads SPY is NOT blocked: the alert lane loads SPY itself', () => {
    H.defs[C1] = astDef(C1, "close > sym('SPY', close)")
    H.catalog = { catalog: [userEntry(C1, 'condition')], isLoading: false, error: null, refusals: [] }
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.queryByTestId('alert-signal-refused')).toBeNull()
  })

  it('a stored policy alert reads as its policy, never as "@ 0.5"', () => {
    H.catalog = { catalog: [userEntry(C1, 'condition')], isLoading: false, error: null, refusals: [] }
    H.alerts = [{ id: 9, sym: 'AAPL', indicator: `${C1}.value`, condition: 'cross_above', threshold: 0.5,
      tf: 'D', active: 1, trigger_count: 0 }]
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByText(/Mine Becomes true · D/)).toBeTruthy()
    expect(screen.queryByText(/@ 0\.5/)).toBeNull()
  })
})
