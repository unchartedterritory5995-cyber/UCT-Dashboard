// RS screens (unit U5), item 2: the quick controls' semantics, exactly as the contract's
// "Control semantics" paragraph says them, over the contract fixture's five starters.
import { describe, expect, test, vi } from 'vitest'
import {
  controlsOf, defaultOption, activeOption, isChanged, applyOption, specWithOption, specWithChoices,
  choicesFor, withChoice, withoutChoices, controlStarterFor, sameSort, MAX_CONTROLS,
} from '../rsScreens'
import { RS_STARTERS, TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, PLAIN_STARTERS, STARTERS_ON } from './rsScreensFixture'

// The working spec as useScreenSpec holds it: keyed filters, a sort, a rank.
const working = spec => ({
  filters: Object.fromEntries((spec.filters || []).map(({ key, ...rest }) => [key, rest])),
  sort: spec.sort || { key: 'uct_composite', dir: 'desc' }, rank: spec.rank || null,
})
// An editor that records what it was asked, over a working spec it also updates.
function editorOver(spec) {
  const w = working(spec)
  const ed = {
    setFilter: vi.fn((k, v) => { if (v) w.filters[k] = v; else delete w.filters[k] }),
    setSort: vi.fn(v => { w.sort = v; w.rank = null }),
  }
  return { ed, w }
}
const control = (starter, id) => controlsOf(starter).find(c => c.id === id)
const option = (starter, cid, oid) => control(starter, cid).options.find(o => o.id === oid)

describe('every control of every RS starter', () => {
  const cases = RS_STARTERS.flatMap(st => controlsOf(st).map(c => [st.name, c.label, st, c]))

  test.each(cases)('%s / %s: the starter opens on the default option, unchanged', (_n, _l, st, c) => {
    const w = working(st.spec)
    expect(defaultOption(c)).toBeTruthy()
    expect(activeOption(c, w)?.id).toBe(defaultOption(c).id)
    expect(isChanged(c, w)).toBe(false)
  })

  test.each(cases)('%s / %s: choosing each option makes it the active one and edits only its keys', (_n, _l, st, c) => {
    for (const o of c.options) {
      const { ed, w } = editorOver(st.spec)
      const before = working(st.spec)
      applyOption(ed, c, o)
      // exactly the option's clauses on the control's keys, nothing else on them
      for (const k of c.keys) {
        const want = (o.filters || []).find(f => f.key === k)
        if (want) { const { key: _k, ...clause } = want; expect(w.filters[k]).toEqual(clause) } else expect(w.filters[k]).toBeUndefined()
      }
      // every other filter untouched
      for (const k of Object.keys(before.filters).filter(k => !c.keys.includes(k))) expect(w.filters[k]).toEqual(before.filters[k])
      expect(ed.setFilter.mock.calls.map(([k]) => k).sort()).toEqual([...c.keys].sort())
      // the sort is set when, and only when, the option carries one
      if (o.sort) expect(ed.setSort).toHaveBeenCalledWith(o.sort); else expect(ed.setSort).not.toHaveBeenCalled()
      expect(activeOption(c, w)?.id).toBe(o.id)
      expect(isChanged(c, w)).toBe(!o.default)
    }
  })
})

test('Top RS Rating, Rank by: Rising fastest sets its three clauses and the two-key sort', () => {
  const { ed, w } = editorOver(TOP_RATING.spec)
  applyOption(ed, control(TOP_RATING, 'rank_by'), option(TOP_RATING, 'rank_by', 'rising'))
  expect(w.filters.rs_rating_pos).toEqual({ op: 'gte', min: 1 })
  expect(w.filters.rs_rating_chg_20).toEqual({ op: 'gte', min: 1 })
  expect(w.filters.pct_vs_sma50).toEqual({ op: 'gt', min: 0 })
  expect(w.sort).toEqual({ key: 'rs_rating_chg_20', dir: 'desc', then: { key: 'rs_rating_pos', dir: 'asc' } })
  // going on to 1M drops the two clauses Rising added and swaps the place column
  applyOption(ed, control(TOP_RATING, 'rank_by'), option(TOP_RATING, 'rank_by', 'm1'))
  expect(w.filters.rs_rating_pos).toBeUndefined()
  expect(w.filters.rs_rating_chg_20).toBeUndefined()
  expect(w.filters.pct_vs_sma50).toBeUndefined()
  expect(w.filters.rs_pos_1m).toEqual({ op: 'gte', min: 1 })
  expect(w.sort).toEqual({ key: 'rs_pos_1m', dir: 'asc' })
})

test('an option that carries a sort is active only while the spec has that sort', () => {
  const c = control(TOP_RATING, 'rank_by')
  const w = working(TOP_RATING.spec)
  expect(activeOption(c, w).id).toBe('overall')
  // the member re-sorts from the Sort menu: no option matches, so the control reads Custom
  expect(activeOption(c, { ...w, sort: { key: 'price', dir: 'desc' } })).toBeNull()
  expect(isChanged(c, { ...w, sort: { key: 'price', dir: 'desc' } })).toBe(true)
  // the second sort key is part of the sort
  const rising = working(specWithOption(TOP_RATING.spec, c, option(TOP_RATING, 'rank_by', 'rising')))
  expect(activeOption(c, rising).id).toBe('rising')
  expect(activeOption(c, { ...rising, sort: { key: 'rs_rating_chg_20', dir: 'desc' } })).toBeNull()
})

test('a clause no option carries reads Custom, and Custom is changed', () => {
  const c = control(NEW_HIGHS, 'min')
  const w = working(NEW_HIGHS.spec)
  w.filters.rs_rank = { op: 'gte', min: 77 }
  expect(activeOption(c, w)).toBeNull()
  expect(isChanged(c, w)).toBe(true)
  // the same key with another operator is not the option either
  w.filters.rs_rank = { op: 'lte', max: 80 }
  expect(activeOption(c, w)).toBeNull()
  // a label or other dressing on the clause does not stop the match
  w.filters.rs_rank = { op: 'gte', min: 80, label: 'RS Rank: ≥ 80' }
  expect(activeOption(c, w).id).toBe('r80')
})

test('controls on one screen are independent: one changed leaves the other on its default', () => {
  const { ed, w } = editorOver(BEFORE_PRICE.spec)
  applyOption(ed, control(BEFORE_PRICE, 'below'), option(BEFORE_PRICE, 'below', 'p10'))
  expect(isChanged(control(BEFORE_PRICE, 'below'), w)).toBe(true)
  expect(isChanged(control(BEFORE_PRICE, 'when'), w)).toBe(false)
  expect(isChanged(control(BEFORE_PRICE, 'min'), w)).toBe(false)
})

test('UCT RS Leaders is ranked: choosing an option keeps the rank and needs no sort', () => {
  const { ed, w } = editorOver(LEADERS.spec)
  applyOption(ed, control(LEADERS, 'show'), option(LEADERS, 'show', 'noext'))
  expect(w.filters.rs_setup).toEqual({ op: 'not_in', values: ['extended', 'below_50'] })
  expect(w.filters.rs_near_buy).toBeUndefined()
  expect(ed.setSort).not.toHaveBeenCalled()
  expect(w.rank).toEqual(LEADERS.spec.rank)
  expect(activeOption(control(LEADERS, 'show'), w).id).toBe('noext')
})

test('at most three controls, and a starter without controls has none', () => {
  expect(MAX_CONTROLS).toBe(3)
  const four = { controls: [...NEW_HIGHS.controls, { id: 'x', label: 'X', keys: ['price'], options: [] }] }
  expect(controlsOf(four)).toHaveLength(3)
  for (const st of PLAIN_STARTERS) expect(controlsOf(st)).toEqual([])
  expect(controlsOf(null)).toEqual([])
})

test('sameSort compares key, direction and the second key', () => {
  expect(sameSort({ key: 'a', dir: 'asc' }, { key: 'a', dir: 'asc' })).toBe(true)
  expect(sameSort({ key: 'a', dir: 'asc' }, { key: 'a', dir: 'desc' })).toBe(false)
  expect(sameSort({ key: 'a', dir: 'asc', then: { key: 'b', dir: 'desc' } }, { key: 'a', dir: 'asc' })).toBe(false)
  expect(sameSort({ key: 'a', dir: 'asc', then: { key: 'b', dir: 'desc' } }, { key: 'a', dir: 'asc', then: { key: 'b', dir: 'desc' } })).toBe(true)
  expect(sameSort({ key: 'a', dir: 'asc', then: { key: 'b', dir: 'desc' } }, { key: 'a', dir: 'asc', then: { key: 'b', dir: 'asc' } })).toBe(false)
  expect(sameSort(null, { key: 'a' })).toBe(false)
})

describe('remembered choices', () => {
  test('the preference records one choice per control per starter, without mutating what it was given', () => {
    const a = withChoice(undefined, 'starter_rs_new_high', 'when', 'month')
    expect(a).toEqual({ starter_rs_new_high: { when: 'month' } })
    const b = withChoice(a, 'starter_rs_new_high', 'min', 'r80')
    const c = withChoice(b, 'starter_rs_leaders', 'show', 'near')
    expect(c).toEqual({ starter_rs_new_high: { when: 'month', min: 'r80' }, starter_rs_leaders: { show: 'near' } })
    expect(a).toEqual({ starter_rs_new_high: { when: 'month' } })
    expect(choicesFor(c, 'starter_rs_new_high')).toEqual({ when: 'month', min: 'r80' })
    expect(choicesFor(c, 'starter_rs_top_rating')).toBeNull()
    expect(choicesFor('nonsense', 'starter_rs_new_high')).toBeNull()
    expect(withChoice(['bad'], 's', 'c', 'o')).toEqual({ s: { c: 'o' } })
  })

  test('Reset forgets one starter only, and writes nothing when there was nothing', () => {
    const all = { starter_rs_new_high: { when: 'month' }, starter_rs_leaders: { show: 'near' } }
    expect(withoutChoices(all, 'starter_rs_new_high')).toEqual({ starter_rs_leaders: { show: 'near' } })
    expect(withoutChoices(all, 'starter_rs_top_rating')).toBeUndefined()
    expect(withoutChoices(null, 'starter_rs_new_high')).toBeUndefined()
  })

  test('opening a starter with remembered choices lays them over its own spec in one step', () => {
    const spec = specWithChoices(NEW_HIGHS.spec, NEW_HIGHS, { when: 'month', min: 'r80' })
    const w = working(spec)
    expect(w.filters.rs_nh_bars_ago).toEqual({ op: 'between', min: 0, max: 20 })
    expect(w.filters.rs_rank).toEqual({ op: 'gte', min: 80 })
    expect(activeOption(control(NEW_HIGHS, 'when'), w).id).toBe('month')
    expect(activeOption(control(NEW_HIGHS, 'down'), w).id).toBe('all')
    // the starter's own spec object is not edited
    expect(NEW_HIGHS.spec.filters.find(f => f.key === 'rs_nh_bars_ago')).toEqual({ key: 'rs_nh_bars_ago', op: 'between', min: 0, max: 4 })
    // a remembered sort option carries its sort
    const top = specWithChoices(TOP_RATING.spec, TOP_RATING, { rank_by: 'm3' })
    expect(top.sort).toEqual({ key: 'rs_pos_3m', dir: 'asc' })
  })

  test('an option id the starter no longer offers, or no choices at all, changes nothing', () => {
    expect(specWithChoices(NEW_HIGHS.spec, NEW_HIGHS, { when: 'gone' })).toBe(NEW_HIGHS.spec)
    expect(specWithChoices(NEW_HIGHS.spec, NEW_HIGHS, null)).toBe(NEW_HIGHS.spec)
    expect(specWithChoices(PLAIN_STARTERS[0].spec, PLAIN_STARTERS[0], { when: 'month' })).toBe(PLAIN_STARTERS[0].spec)
  })
})

describe('naming a screen from its spec alone (refresh, Back, List to Table and back)', () => {
  test('a starter spec changed only by its quick controls is still that starter', () => {
    const c = control(BEFORE_PRICE, 'below')
    const spec = specWithOption(specWithOption(BEFORE_PRICE.spec, c, option(BEFORE_PRICE, 'below', 'p5')), control(BEFORE_PRICE, 'when'), option(BEFORE_PRICE, 'when', 'today'))
    expect(controlStarterFor(STARTERS_ON, spec)?.id).toBe('starter_rs_nh_before_price')
    // each of the five, on its own defaults and on every single option
    for (const st of RS_STARTERS) {
      expect(controlStarterFor(STARTERS_ON, st.spec)?.id).toBe(st.id)
      for (const ctl of controlsOf(st)) for (const o of ctl.options) expect(controlStarterFor(STARTERS_ON, specWithOption(st.spec, ctl, o))?.id).toBe(st.id)
    }
  })

  test('the carried pool, and a re-sort, do not stop the match', () => {
    const spec = { ...NEW_HIGHS.spec, filters: [...NEW_HIGHS.spec.filters, { key: 'universe', op: 'eq', value: 'uct' }], sort: { key: 'price', dir: 'desc' } }
    expect(controlStarterFor(STARTERS_ON, spec)?.id).toBe('starter_rs_new_high')
  })

  test('any other edit is a custom screen: a filter outside the controls, a Custom reading, a changed rank', () => {
    const extra = { ...NEW_HIGHS.spec, filters: [...NEW_HIGHS.spec.filters, { key: 'adr_pct', op: 'gte', min: 4 }] }
    expect(controlStarterFor(STARTERS_ON, extra)).toBeNull()
    const custom = { ...NEW_HIGHS.spec, filters: [...NEW_HIGHS.spec.filters, { key: 'rs_rank', op: 'gte', min: 77 }] }
    expect(controlStarterFor(STARTERS_ON, custom)).toBeNull()
    expect(controlStarterFor(STARTERS_ON, { ...LEADERS.spec, rank: { ...LEADERS.spec.rank, top_n: 20 } })).toBeNull()
    const dropped = { ...EXIT_WARNINGS.spec, filters: EXIT_WARNINGS.spec.filters.filter(f => f.key !== 'price') }
    expect(controlStarterFor(STARTERS_ON, dropped)).toBeNull()
  })

  test('a starter without controls is never named this way', () => {
    expect(controlStarterFor(PLAIN_STARTERS, PLAIN_STARTERS[0].spec)).toBeNull()
    expect(controlStarterFor([], NEW_HIGHS.spec)).toBeNull()
  })
})
