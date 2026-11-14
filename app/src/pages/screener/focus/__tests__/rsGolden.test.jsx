// RS screens, unit U6 (integration): the client read against what the server REALLY serves.
//
// The five starters, the hidden seven and the Setup words below come from the server suite's own
// goldens (rsScreensFixture.js reads them; nothing about an RS starter is typed on this side).
// Three things are held here:
//   1. every assumption the client makes about that payload's SHAPE, by name, so a server change
//      that breaks one fails here and says which;
//   2. the "active option" reading through the REAL editor (useScreenSpec, which keeps ONE clause
//      per filter key) and through the URL codec: each of the five opens with every control on
//      its default, and choosing each option reads that option, before and after a refresh;
//   3. the member-facing Setup words are the server's own.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import useScreenSpec from '../../shell/useScreenSpec'
import { decodeSpec, encodeSpec } from '../../shell/specUrl'
import { activeOption, applyOption, controlStarterFor, controlsOf, defaultOption, isChanged, MAX_CONTROLS, sameSort, specWithOption } from '../rsScreens'
import { flagWords, rowColumns, rowConfigOf, setupWords, INDEX_PLACE } from '../rsRows'
import { GROUPS, groupOf, RS_DEFAULT_PINNED, defaultPinned } from '../screenGroups'
import { focusChipLabel } from '../plainWords'
import { whyItsHere } from '../whyItsHere'
import { chipLabel } from '../../chipLabel'
import { RS_STARTERS, HIDDEN_STARTERS, HIDDEN_IDS, STARTERS_ON, SERVED, TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS,
  readServerFixture } from './rsScreensFixture'

const FIVE = ['starter_rs_top_rating', 'starter_rs_new_high', 'starter_rs_nh_before_price', 'starter_rs_leaders', 'starter_rs_exit_warning_5']
// The operands the client compares, per operator (rsScreens.js `sig`; FocusScreener `normalSpec`).
const OPERANDS = { gte: ['min'], gt: ['min'], lte: ['max'], lt: ['max'], between: ['max', 'min'], eq: ['value'], in: ['values'], not_in: ['values'] }
// What rsRows.js can draw (its PARTS and TAGS tables).
const CAPTION_PARTS = ['setup', 'group', 'rs_high_age', 'below_high', 'moving', 'exit_warning'] // exit_warning: unit U7
const TAGS = ['before_price', 'down_day', 'flag', 'new']
const clausesOf = st => [...st.spec.filters, ...st.controls.flatMap(c => c.options.flatMap(o => o.filters))]
const everyOption = RS_STARTERS.flatMap(st => controlsOf(st).flatMap(c => c.options.map(o => [`${st.name} / ${c.label} / ${o.label}`, st, c, o])))
const everyControl = RS_STARTERS.flatMap(st => controlsOf(st).map(c => [`${st.name} / ${c.label}`, st, c]))

describe('the fixture IS the server golden', () => {
  test('the five are the file, object for object, in the payload order', () => {
    expect(RS_STARTERS).toEqual(readServerFixture('rs_screens_starters.json'))
    expect(RS_STARTERS.map(s => s.id)).toEqual(FIVE)
    expect([TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS]).toEqual(RS_STARTERS)
    expect(Object.isFrozen(TOP_RATING.spec.filters[0])).toBe(true)
  })
  test('the hidden seven are the file: hidden, resolvable, and carrying none of the new fields', () => {
    expect(HIDDEN_STARTERS).toEqual(readServerFixture('rs_screens_served.json').hidden)
    expect(HIDDEN_IDS).toHaveLength(7)
    for (const h of HIDDEN_STARTERS) {
      expect(h.hidden).toBe(true)
      expect(h.spec.filters.length).toBeGreaterThan(0)
      expect(['controls', 'row', 'empty'].filter(k => k in h)).toEqual([])
    }
    // In the whole payload the five stay together and no id is served twice.
    const ids = STARTERS_ON.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(ids.indexOf(FIVE[0]), ids.indexOf(FIVE[0]) + 5)).toEqual(FIVE)
  })
})

describe('what the client assumes about the payload', () => {
  test('the five are in a group the picker knows, the hidden ones too', () => {
    // By its LABEL, never by groupOf's fallback (an unknown label is filed under Momentum leaders).
    const labels = GROUPS.map(g => g.label.toLowerCase())
    for (const st of RS_STARTERS) {
      expect(labels, st.id).toContain(String(st.group).toLowerCase())
      expect(groupOf(st), st.id).toBe('relative_strength')
    }
    for (const h of HIDDEN_STARTERS) expect(labels, h.id).toContain(String(h.group).toLowerCase())
  })
  test('a new member\'s pins are four of the five, and no default pin is a hidden starter', () => {
    const pins = defaultPinned(STARTERS_ON)
    expect(pins.slice(0, 4)).toEqual(RS_DEFAULT_PINNED)
    for (const id of RS_DEFAULT_PINNED) expect(FIVE).toContain(id)
    for (const id of pins) expect(HIDDEN_IDS).not.toContain(id)
  })
  test('every clause is an operator the client compares, with exactly its operands', () => {
    for (const st of RS_STARTERS) {
      for (const f of clausesOf(st)) {
        expect(Object.keys(OPERANDS), `${st.id} ${f.key}`).toContain(f.op)
        expect(Object.keys(f).filter(k => k !== 'key' && k !== 'op').sort(), `${st.id} ${f.key}`).toEqual(OPERANDS[f.op])
      }
    }
  })
  test('ONE clause per key, in every spec and every option: the editor keeps one', () => {
    for (const st of RS_STARTERS) {
      const keys = st.spec.filters.map(f => f.key)
      expect(new Set(keys).size, st.id).toBe(keys.length)
      for (const c of st.controls) for (const o of c.options) {
        const okeys = o.filters.map(f => f.key)
        expect(new Set(okeys).size, `${st.id}/${c.id}/${o.id}`).toBe(okeys.length)
        for (const k of okeys) expect(c.keys, `${st.id}/${c.id}/${o.id}`).toContain(k)
      }
    }
  })
  test('at most three controls, each with one default (only it says so) and an array of filters on every option', () => {
    for (const st of RS_STARTERS) {
      expect(st.controls.length).toBeGreaterThan(0)
      expect(st.controls.length).toBeLessThanOrEqual(MAX_CONTROLS)
      expect(controlsOf(st)).toEqual(st.controls)
      const seen = []
      for (const c of st.controls) {
        expect(c.options.filter(o => o.default === true), `${st.id}/${c.id}`).toHaveLength(1)
        expect(c.options.filter(o => 'default' in o), `${st.id}/${c.id}`).toHaveLength(1)
        for (const o of c.options) {
          expect(Array.isArray(o.filters), `${st.id}/${c.id}/${o.id}`).toBe(true)
          expect(typeof o.label === 'string' && o.label.length > 0).toBe(true)
        }
        for (const k of c.keys) { expect(seen, `${st.id}: two controls own ${k}`).not.toContain(k); seen.push(k) }
      }
    }
  })
  test('no two options of a control read the same to the client', () => {
    // The client tells options apart by their clauses on the control's keys and, on a screen
    // that is not ranked, by their sort. Two that read the same would both light up.
    for (const st of RS_STARTERS) {
      for (const c of st.controls) {
        const sigs = c.options.map(o => JSON.stringify([
          c.keys.map(k => { const f = o.filters.find(x => x.key === k); return f ? [f.op, f.min ?? null, f.max ?? null, f.value ?? null, f.values ?? null] : null }),
          st.spec.rank ? null : o.sort || null]))
        expect(new Set(sigs).size, `${st.id}/${c.id}`).toBe(sigs.length)
      }
    }
  })
  test('a control that sets a sort sets it on its default too, and a ranked screen has no such control', () => {
    for (const st of RS_STARTERS) {
      for (const c of st.controls) {
        if (!c.options.some(o => o.sort)) continue
        expect(st.spec.rank, `${st.id}/${c.id}`).toBeUndefined()
        expect(sameSort(defaultOption(c).sort, st.spec.sort), `${st.id}/${c.id}`).toBe(true)
      }
    }
    expect(LEADERS.spec.rank).toBeTruthy()
    expect(LEADERS.spec.sort).toBeUndefined()
  })
  test('each row recipe names only parts and tags the row can draw; a null place is sent as null', () => {
    for (const st of RS_STARTERS) {
      // unit U7: a ranked screen may also name its order (`sort_label`); a screen that is not ranked never does
      expect(Object.keys(st.row).sort(), st.id).toEqual(st.spec.rank ? ['caption', 'place', 'sort_label', 'tags'] : ['caption', 'place', 'tags'])
      for (const p of st.row.caption) expect(CAPTION_PARTS, `${st.id} caption`).toContain(p)
      for (const t of st.row.tags) expect(TAGS, `${st.id} tag`).toContain(t)
      const cfg = rowConfigOf(st)
      expect(cfg.caption).toEqual(st.row.caption)
      expect(cfg.tags).toEqual(st.row.tags)
      expect(rowColumns(cfg).length).toBeGreaterThan(0)
    }
    expect([TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS].map(s => s.row.place)).toEqual(['rs_rating_pos', null, null, INDEX_PLACE, null])
    expect(rowConfigOf(NEW_HIGHS).place).toBeNull()
  })
  test('the one empty state names a control and an option this payload has, and a starter it serves', () => {
    expect(RS_STARTERS.filter(s => s.empty).map(s => s.id)).toEqual(['starter_rs_nh_before_price'])
    const { text, actions } = BEFORE_PRICE.empty
    expect(typeof text).toBe('string')
    for (const a of actions) {
      expect(typeof a.label).toBe('string')
      if (a.open) expect(STARTERS_ON.map(s => s.id)).toContain(a.open)
      else expect(controlsOf(BEFORE_PRICE).find(c => c.id === a.control)?.options.map(o => o.id)).toContain(a.option)
    }
  })
})

// ── the real editor ────────────────────────────────────────────────────────
// useScreenSpec is what FocusScreener opens a screen with (applySpec) and what a quick control
// edits (setFilter / setSort). It stores filters KEYED BY FILTER KEY.
const open = st => {
  const hook = renderHook(() => useScreenSpec())
  act(() => hook.result.current.applySpec(st.spec))
  return hook
}
const reading = s => ({ filters: s.filters, sort: s.sort, rank: s.rank })
// The clauses the scan is sent, as a set: order is the editor's own, and the server ANDs them.
const asSet = list => list.map(f => JSON.stringify(Object.fromEntries(Object.entries(f).sort()))).sort()
// The contract's control semantics, on the starter's own filter LIST (what the server suite's
// `_apply` does): the option's clauses replace every clause on the control's keys.
const serverApply = (spec, c, o) => [...spec.filters.filter(f => !c.keys.includes(f.key)), ...o.filters]
// A refresh: the working spec through the URL codec and back into a fresh editor's shape.
const refreshed = s => decodeSpec(encodeSpec({ filters: s.filters, sort: s.sort, view: s.view, columns: s.columns, rank: s.rank, logic: s.logic }))

describe('the five, opened and edited through the real editor', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/screener') })

  test.each(RS_STARTERS.map(st => [st.name, st]))('%s opens with every control on its default, and the scan gets the starter\'s own clauses', (_n, st) => {
    const { result } = open(st)
    const s = result.current
    for (const c of controlsOf(st)) {
      expect(activeOption(c, reading(s))?.id, c.id).toBe(defaultOption(c).id)
      expect(isChanged(c, reading(s)), c.id).toBe(false)
    }
    expect(asSet(s.baseSpec.filters)).toEqual(asSet(st.spec.filters))
    expect(s.rank || null).toEqual(st.spec.rank || null)
    if (st.spec.sort) expect(s.sort).toEqual(st.spec.sort)
    expect(s.view).toBe(st.spec.view)
    // and after a refresh the screen is the same, with the same reading
    const back = refreshed(s)
    for (const c of controlsOf(st)) expect(activeOption(c, back)?.id, `${c.id} after a refresh`).toBe(defaultOption(c).id)
    expect(controlStarterFor(STARTERS_ON, s.baseSpec)?.id).toBe(st.id)
  })

  test.each(everyOption)('%s: chosen, it is the active option, the scan gets exactly its clauses, and a refresh keeps it', (_n, st, c, o) => {
    const { result } = open(st)
    act(() => applyOption(result.current, c, o))
    const s = result.current
    expect(activeOption(c, reading(s))?.id).toBe(o.id)
    expect(isChanged(c, reading(s))).toBe(!o.default)
    // every other control still reads its default
    for (const other of controlsOf(st).filter(x => x.id !== c.id)) expect(activeOption(other, reading(s))?.id, other.id).toBe(defaultOption(other).id)
    // what the scan is sent is what the server's own semantics make of the option
    expect(asSet(s.baseSpec.filters)).toEqual(asSet(serverApply(st.spec, c, o)))
    if (o.sort) expect(s.sort).toEqual(o.sort)
    // a ranked screen keeps its rank (a sort would have dropped it: useScreenSpec.setSort)
    expect(s.rank || null).toEqual(st.spec.rank || null)
    // a refresh (the URL carries the working spec) reads the same option, on the same starter
    const back = refreshed(s)
    expect(activeOption(c, back)?.id).toBe(o.id)
    if (o.sort) expect(back.sort).toEqual(o.sort)
    expect(controlStarterFor(STARTERS_ON, s.baseSpec)?.id).toBe(st.id)
    // and the one-step open with the choice remembered lands on the same clauses
    expect(asSet(specWithOption(st.spec, c, o).filters)).toEqual(asSet(s.baseSpec.filters))
  })

  test.each(everyControl)('%s: every option in turn, then back to the default, leaves the starter\'s own screen', (_n, st, c) => {
    const { result } = open(st)
    for (const o of [...c.options.filter(x => !x.default), defaultOption(c)]) {
      act(() => applyOption(result.current, c, o))
      expect(activeOption(c, reading(result.current))?.id).toBe(o.id)
    }
    expect(asSet(result.current.baseSpec.filters)).toEqual(asSet(st.spec.filters))
    if (st.spec.sort) expect(result.current.sort).toEqual(st.spec.sort)
  })

  test('a between and a two-clause option survive the editor and the URL exactly', () => {
    const { result } = open(BEFORE_PRICE)
    const below = controlsOf(BEFORE_PRICE).find(c => c.id === 'below')
    act(() => applyOption(result.current, below, below.options.find(o => o.id === 'p10')))
    expect(result.current.filters.px_below_high_pct).toEqual({ op: 'between', min: -25, max: -10 })
    expect(refreshed(result.current).filters.px_below_high_pct).toEqual({ op: 'between', min: -25, max: -10 })

    const top = open(TOP_RATING)
    const show = controlsOf(TOP_RATING).find(c => c.id === 'show')
    act(() => applyOption(top.result.current, show, show.options.find(o => o.id === 'new90')))
    expect(top.result.current.filters.rs_rank).toEqual({ op: 'gte', min: 90 })
    expect(top.result.current.filters.rs_rating_prev20).toEqual({ op: 'lt', max: 90 })
    const back = refreshed(top.result.current)
    expect(activeOption(show, back)?.id).toBe('new90')
    // "90 and up" shares the rs_rank clause with "New to 90+"; only one of them is active
    expect(show.options.filter(o => activeOption(show, back)?.id === o.id).map(o => o.id)).toEqual(['new90'])
  })

  test('opening the ranked screen after a sorted one keeps the rank, and its controls read their defaults', () => {
    const { result } = open(TOP_RATING)
    act(() => result.current.applySpec(LEADERS.spec))
    expect(result.current.rank).toEqual(LEADERS.spec.rank)
    for (const c of controlsOf(LEADERS)) expect(activeOption(c, reading(result.current))?.id).toBe(defaultOption(c).id)
    // and back again: the rank is gone and the place order is the sort
    act(() => result.current.applySpec(TOP_RATING.spec))
    expect(result.current.rank).toBeNull()
    expect(result.current.sort).toEqual(TOP_RATING.spec.sort)
  })
})

describe('the Setup words are the server\'s', () => {
  // The Filters drawer and the method page print the server's words; the row caption prints the
  // client's copy (the server sends codes for rows, never prose). One vocabulary, held here.
  test('every setup code and every flag code reads the same word on both sides', () => {
    for (const [code, word] of Object.entries(SERVED.words.setup)) expect(setupWords({ rs_setup: code, rs_tight: 0 }), code).toBe(word)
    for (const [code, word] of Object.entries(SERVED.words.flags)) expect(flagWords({ rs_flag: code }), code).toBe(word)
    expect(setupWords({ rs_setup: 'uptrend', rs_tight: 1 })).toBe(SERVED.words.tight)
    expect(setupWords({ rs_setup: 'at_pivot', rs_tight: 1 })).toBe(`${SERVED.words.setup.at_pivot}, ${SERVED.words.tight.toLowerCase()}`)
  })
  test('the codes a quick control filters on are codes the server writes', () => {
    const noext = controlsOf(LEADERS).find(c => c.id === 'show').options.find(o => o.id === 'noext')
    for (const code of noext.filters[0].values) expect(Object.keys(SERVED.words.setup)).toContain(code)
  })
})

// ── what a member READS for each clause, from the server's own registry entries ─────────────
// SERVED.meta.filters is GET /api/screener/meta for every key the five name. The chips in the
// Filters drawer, the empty state's pills and the why strip are all labelled from it.
describe('every clause the five carry reads as words, never as a stored code', () => {
  const defs = Object.fromEntries(SERVED.meta.filters.map(f => [f.key, f]))
  const clauses = RS_STARTERS.flatMap(st => clausesOf(st).map(f => [st.id, f]))
  // A stored code looks like `below_50` or `buyout_pending`: lower-case words joined by "_".
  const CODE = /[a-z0-9]+_[a-z0-9_]+/

  test('the registry serves an entry for every key the five filter on', () => {
    for (const [id, f] of clauses) expect(defs[f.key], `${id}: ${f.key}`).toBeTruthy()
  })
  test('no chip prints a code or a raw key', () => {
    for (const [id, f] of clauses) {
      const { key, ...spec } = f
      const label = focusChipLabel(defs[key], spec)
      expect(label, `${id}: ${key}`).toBeTruthy()
      expect(label, `${id}: ${key}`).not.toMatch(CODE)
    }
  })
  test('"Hide extended" reads its two Setup words, in the drawer and in the why strip', () => {
    const noext = controlsOf(LEADERS).find(c => c.id === 'show').options.find(o => o.id === 'noext')
    const { key, ...spec } = noext.filters[0]
    expect(focusChipLabel(defs[key], spec)).toBe('Setup: not Extended, Below its 50-day line')
    expect(chipLabel(defs[key], spec)).toBe('Setup: not Extended, Below its 50-day line')
    const filters = { rs_setup: spec }
    // a row that carries a label: its WORD is the value, with a tick
    expect(whyItsHere({ filters, metaFilters: SERVED.meta.filters, row: { rs_setup: 'at_pivot' } }).items)
      .toEqual([{ kind: 'check', label: 'Setup not Extended, Below its 50-day line', value: 'At pivot' }])
    // a row with no label passes the exclude list on the server (a NULL is kept): a tick, "None"
    expect(whyItsHere({ filters, metaFilters: SERVED.meta.filters, row: { rs_setup: null } }).items)
      .toEqual([{ kind: 'check', label: 'Setup not Extended, Below its 50-day line', value: 'None' }])
  })
  test('the stocks-only clause still reads as it did (only the two code enums changed)', () => {
    expect(focusChipLabel(defs.security_type, { op: 'not_in', values: ['ETF'] })).toBe('Type: not ETFs')
    expect(whyItsHere({ filters: { security_type: { op: 'not_in', values: ['ETF'] } }, metaFilters: SERVED.meta.filters, row: { security_type: null } }).items)
      .toEqual([{ kind: 'note', label: 'Type not ETF', value: '—' }])
    // a code the registry does not offer is printed as it is held, never dropped
    expect(chipLabel(defs.rs_setup, { op: 'not_in', values: ['extended', 'made_up'] })).toBe('Setup: not Extended, made_up')
  })
  test('the views the five open are served, each leading with the row\'s own four columns', () => {
    const views = Object.fromEntries(SERVED.meta.views.map(v => [v.key, v.columns]))
    for (const st of RS_STARTERS) {
      expect(views[st.spec.view], st.id).toBeTruthy()
      expect(views[st.spec.view].slice(0, 4), st.id).toEqual(['ticker', 'company', 'price', 'chg_pct_1d'])
    }
  })
})

// ── buyout names are left out of the four list screens (coordinator decision, U6) ─────────────
describe('the buyout exclusion, as a member meets it', () => {
  const defs = Object.fromEntries(SERVED.meta.filters.map(f => [f.key, f]))
  const NO_BUYOUT = { key: 'rs_flag', op: 'not_in', values: ['buyout_pending'] }
  const LISTS = [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS]

  test('the four list screens carry the clause once, RS exit warnings does not, and no quick control owns it', () => {
    for (const st of LISTS) {
      expect(st.spec.filters.filter(f => f.key === 'rs_flag'), st.id).toEqual([NO_BUYOUT])
      // a control replaces every clause on its keys: one that owned `rs_flag` would drop the exclusion
      for (const c of controlsOf(st)) expect(c.keys, `${st.id}/${c.id}`).not.toContain('rs_flag')
    }
    expect(EXIT_WARNINGS.spec.filters.some(f => f.key === 'rs_flag')).toBe(false)
  })
  test('it survives every option of every control, through the real editor', () => {
    for (const st of LISTS) {
      for (const c of controlsOf(st)) for (const o of c.options) {
        const { result, unmount } = open(st)
        act(() => applyOption(result.current, c, o))
        expect(result.current.filters.rs_flag, `${st.id}/${c.id}/${o.id}`).toEqual({ op: 'not_in', values: ['buyout_pending'] })
        unmount()
      }
    }
  })
  test('it reads "Setup flag: not Buyout pending", and a row with no flag is a tick', () => {
    const { key, ...spec } = NO_BUYOUT
    expect(focusChipLabel(defs[key], spec)).toBe('Setup flag: not Buyout pending')
    const why = row => whyItsHere({ filters: { rs_flag: spec }, metaFilters: SERVED.meta.filters, row }).items
    expect(why({ rs_flag: null })).toEqual([{ kind: 'check', label: 'Setup flag not Buyout pending', value: 'None' }])
    expect(why({ rs_flag: 'new_issue' })).toEqual([{ kind: 'check', label: 'Setup flag not Buyout pending', value: 'New issue' }])
    // the drawer's pills for the whole screen name nothing by a stored code
    for (const f of TOP_RATING.spec.filters) {
      const { key: k, ...v } = f
      expect(focusChipLabel(defs[k], v), k).not.toMatch(/[a-z0-9]+_[a-z0-9_]+/)
    }
  })
})
