// Wave 8 (Task 8.15): the builder's state. Undo and redo swap whole plans, the name follows the server's automatic
// name until the member types one, and history keeps at most 100 steps.
import { describe, it, expect } from 'vitest'
import { reducer, initState, blankPlan, nameOf, HISTORY_CAP, changeKind, PLAN_VERSION, normalizePlan } from './builderState'

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
    for (let i = 1; i <= 130; i += 1) s = reducer(s, { type: 'setSort', sort: { measure: 0, dir: 'desc', top: (i % 40) + 1 } })
    expect(HISTORY_CAP).toBe(100)
    expect(s.past).toHaveLength(100)
    // The oldest steps went first: undoing all 100 lands on step 30, never on the opening plan.
    for (let i = 0; i < 100; i += 1) s = reducer(s, { type: 'undo' })
    expect(s.plan.sort.top).toBe(31)
    expect(s.past).toHaveLength(0)
    expect(s.future).toHaveLength(100)
  })

  it('typing a target or a subtitle is one undo step; other display changes are their own', () => {
    let s = run(start(), { type: 'setDisplay', display: { target: 5 } }, { type: 'setDisplay', display: { target: 50 } },
      { type: 'setDisplay', display: { target: 500 } })
    expect(s.past).toHaveLength(1)
    expect(run(s, { type: 'undo' }).plan.display.target).toBe(null)
    s = run(s, { type: 'setDisplay', display: { accent: 'green' } }, { type: 'setDisplay', display: { accent: 'red' } })
    expect(s.past).toHaveLength(3)
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

// Wave 10 (Task 10.16): "Your own fields" in the plan (be plan.py W10-R2, W10-R3).
describe('builderState: your own fields', () => {
  const add = (s, formula = { name: 'Exit eff', expr: '[r] / 2', format: 'number' }) => reducer(s, { type: 'formula/add', formula })

  it('plan_version_three_only_when_used', () => {
    expect(PLAN_VERSION).toBe(3)
    // A plan that uses no formula writes no `formulas` key and keeps its own format: the dict it was in wave 9.
    const plain = start().plan
    expect(Object.hasOwn(plain, 'formulas')).toBe(false)
    expect(plain.v).toBe(1)
    expect(Object.hasOwn(normalizePlan({ ...blankPlan(), formulas: [] }), 'formulas')).toBe(false)
    // The format is what the plan NEEDS (be needed_version): 2 only for a routine or tracker read.
    expect(normalizePlan({ ...blankPlan(), v: 2 }).v).toBe(1)
    expect(normalizePlan({ ...blankPlan(), source: 'routine_history' }).v).toBe(2)
    // One formula: format 3 and the key.
    const one = add(start())
    expect(one.plan.v).toBe(3)
    expect(one.plan.formulas).toEqual([{ id: 'f1', name: 'Exit eff', expr: '[r] / 2', format: 'number' }])
    // Removing the last one takes the key and format 3 away again.
    const none = reducer(one, { type: 'formula/remove', id: 'f1' })
    expect(Object.hasOwn(none.plan, 'formulas')).toBe(false)
    expect(none.plan.v).toBe(1)
    expect(none.dirty).toBe(false)              // back to what was opened
    // A stored v3 plan with no formula reads as the format it needs.
    expect(normalizePlan({ ...blankPlan(), v: 3 }).v).toBe(1)
  })

  it('formula ids are the lowest free of f1..f5, and the cap is five', () => {
    let s = start()
    for (let i = 0; i < 7; i += 1) s = add(s, { name: `F${i}`, expr: '1', format: 'number' })
    expect(s.plan.formulas.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5'])
    s = reducer(s, { type: 'formula/remove', id: 'f2' })
    s = add(s, { name: 'Again', expr: '2', format: 'money' })
    expect(s.plan.formulas.map((f) => f.id)).toEqual(['f1', 'f3', 'f4', 'f5', 'f2'])
  })

  it('undo_restores_formula: each settled edit is one step, and undo brings the formula back', () => {
    let s = add(start())
    s = reducer(s, { type: 'formula/edit', id: 'f1', patch: { expr: '[r] / 3' } })
    s = reducer(s, { type: 'formula/edit', id: 'f1', patch: { name: 'Third' } })
    expect(s.past).toHaveLength(3)
    const back = reducer(s, { type: 'undo' })
    expect(back.plan.formulas[0]).toMatchObject({ name: 'Exit eff', expr: '[r] / 3' })
    expect(reducer(back, { type: 'undo' }).plan.formulas[0].expr).toBe('[r] / 2')
    // An edit to a field the plan does not have is nothing.
    expect(reducer(s, { type: 'formula/edit', id: 'f4', patch: { name: 'x' } })).toBe(s)
  })

  it('a formula measure is kept as {formula, agg}; removing the field removes what reads it, in one step', () => {
    let s = add(start())
    s = reducer(s, { type: 'setMeasures', measures: ['net_pnl', { formula: 'f1', agg: 'avg' }] })
    s = reducer(s, { type: 'addFilter', filter: { field: 'formula:f1', op: 'gt', values: [1], overridable: false } })
    s = reducer(s, { type: 'setSplit', split: { by: 'formula:f1', then: null } })
    expect(s.plan.measures).toEqual([{ key: 'net_pnl' }, { formula: 'f1', agg: 'avg' }])
    expect(normalizePlan(s.plan).measures).toEqual(s.plan.measures)
    const gone = reducer(s, { type: 'formula/remove', id: 'f1' })
    expect(gone.plan.measures).toEqual([{ key: 'net_pnl' }])
    expect(gone.plan.filters).toEqual([])
    expect(gone.plan.split).toBe(null)
    expect(gone.past).toHaveLength(s.past.length + 1)
    expect(reducer(gone, { type: 'undo' }).plan).toEqual(s.plan)
    // The only measure was the formula's: the sheet's fallback takes its place, never an empty widget.
    let only = reducer(add(start()), { type: 'setMeasures', measures: [{ formula: 'f1', agg: 'sum' }] })
    expect(reducer(only, { type: 'formula/remove', id: 'f1' })).toBe(only)
    only = reducer(only, { type: 'formula/remove', id: 'f1', measures: ['net_pnl'] })
    expect(only.plan.measures).toEqual([{ key: 'net_pnl' }])
  })

  it('another source drops the fields with the filters, in the same step', () => {
    const s = reducer(add(start()), { type: 'setSource', source: 'trading_days', measures: ['net_pnl'] })
    expect(Object.hasOwn(s.plan, 'formulas')).toBe(false)
    expect(reducer(s, { type: 'undo' }).plan.formulas).toHaveLength(1)
  })
})
