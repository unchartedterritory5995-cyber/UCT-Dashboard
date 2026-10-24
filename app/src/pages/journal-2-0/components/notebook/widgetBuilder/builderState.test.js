// Wave 8 (Task 8.15): the builder's state. Undo and redo swap whole plans, the name follows the server's automatic
// name until the member types one, and history keeps at most 100 steps.
import { describe, it, expect } from 'vitest'
import { reducer, initState, blankPlan, nameOf, HISTORY_CAP, changeKind } from './builderState'

const start = () => initState(blankPlan())
const run = (state, ...actions) => actions.reduce(reducer, state)

describe('builderState', () => {
  it('undo_redo_round_trip', () => {
    const s0 = start()
    const s1 = run(s0,
      { type: 'setRange', range: { token: 'last_30d' } },
      { type: 'setMeasures', measures: ['net_pnl', 'win_rate'] },
      { type: 'addFilter', filter: { field: 'setup', op: 'in', values: ['Flag'], overridable: false } })
    expect(s1.past).toHaveLength(3)
    expect(s1.dirty).toBe(true)
    const back = run(s1, { type: 'undo' }, { type: 'undo' }, { type: 'undo' })
    expect(back.plan).toEqual(s0.plan)
    expect(back.dirty).toBe(false)               // every edit undone: clean again
    expect(back.future).toHaveLength(3)
    const again = run(back, { type: 'redo' }, { type: 'redo' }, { type: 'redo' })
    expect(again.plan).toEqual(s1.plan)
    expect(again.dirty).toBe(true)
    // A new edit after an undo drops what could have been redone.
    const forked = run(s1, { type: 'undo' }, { type: 'setRange', range: { token: 'ytd' } })
    expect(forked.future).toHaveLength(0)
    // An edit that changes nothing is not a step.
    expect(run(s1, { type: 'setRange', range: { token: 'last_30d' } }).past).toHaveLength(3)
    // Undo with nothing to undo is a no-op.
    expect(run(s0, { type: 'undo' })).toBe(s0)
  })

  it('name_follows_default_until_typed', () => {
    let s = run(start(), { type: 'followName', name: 'Net P&L, last 90 days' })
    expect(nameOf(s)).toBe('Net P&L, last 90 days')
    expect(s.dirty).toBe(false)                   // the server's name is not a member edit
    expect(s.past).toHaveLength(0)
    s = run(s, { type: 'setSplit', split: { by: 'setup', then: null } }, { type: 'followName', name: 'Net P&L by setup, last 90 days' })
    expect(nameOf(s)).toBe('Net P&L by setup, last 90 days')
    expect(s.plan.display.titleAuto).toBe(true)
    // The member types: from then on it is theirs.
    s = run(s, { type: 'setName', name: 'M' }, { type: 'setName', name: 'My' }, { type: 'setName', name: 'My setups' })
    expect(s.nameTouched).toBe(true)
    expect(nameOf(s)).toBe('My setups')
    expect(s.plan.display).toMatchObject({ title: 'My setups', titleAuto: false })
    s = run(s, { type: 'followName', name: 'Net P&L by symbol, last 90 days' })
    expect(nameOf(s)).toBe('My setups')           // a later preview never overwrites it
    // Typing is ONE undo step (undo removes the name, not its last letter).
    const undone = run(s, { type: 'undo' })
    expect(undone.nameTouched).toBe(false)
    expect(nameOf(undone)).toBe('Net P&L by symbol, last 90 days')
    // Clearing the name hands it back to the plan.
    const cleared = run(s, { type: 'setName', name: '   ' })
    expect(cleared.nameTouched).toBe(false)
    expect(cleared.plan.display).toMatchObject({ title: '', titleAuto: true })
  })

  it('history_capped_100', () => {
    let s = start()
    for (let i = 1; i <= 130; i += 1) s = reducer(s, { type: 'setDisplay', display: { target: i } })
    expect(HISTORY_CAP).toBe(100)
    expect(s.past).toHaveLength(100)
    // The oldest steps went first: undoing all 100 lands on target 30, never on the opening plan.
    for (let i = 0; i < 100; i += 1) s = reducer(s, { type: 'undo' })
    expect(s.plan.display.target).toBe(30)
    expect(s.past).toHaveLength(0)
    expect(s.future).toHaveLength(100)
  })

  it('loadPlan resets history; keepBase keeps a resumed draft dirty', () => {
    const opened = run(start(), { type: 'setRange', range: { token: 'ytd' } })
    const fresh = reducer(opened, { type: 'loadPlan', plan: { ...blankPlan(), source: 'trading_days' } })
    expect(fresh.past).toHaveLength(0)
    expect(fresh.dirty).toBe(false)
    const resumed = reducer(fresh, { type: 'loadPlan', plan: { ...blankPlan(), source: 'open_positions' }, keepBase: true })
    expect(resumed.dirty).toBe(true)
    expect(resumed.plan.source).toBe('open_positions')
  })

  it('a named plan opens touched', () => {
    const s = initState({ ...blankPlan(), display: { title: 'Equity curve', titleAuto: false } })
    expect(s.nameTouched).toBe(true)
    expect(nameOf(s)).toBe('Equity curve')
  })

  it('changeKind: a title or colour change is display-only; anything counted is content', () => {
    const a = blankPlan()
    expect(changeKind(a, { ...a, display: { ...a.display, title: 'X', titleAuto: false, accent: 'green' } })).toBe('display')
    expect(changeKind(a, { ...a, filters: [{ field: 'setup', op: 'in', values: ['Flag'], overridable: false }] })).toBe('content')
    expect(changeKind(a, { ...a, measures: [{ key: 'win_rate' }] })).toBe('content')
    expect(changeKind(a, { ...a, split: { by: 'setup', then: null } })).toBe('content')
  })
})
