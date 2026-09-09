// app/src/components/chart/engine/ast/pineTimeframeAlias.test.js
//
// ─── ⭐⭐ THE DOTTED SPELLING OF A COLUMN THE ENGINE ALREADY HAD ──────────────
//
// `timeframe.isdaily` refused `pine:builtin` — *"this Pine built-in names
// something the engine grammar does not hold"* — while `closedTable.json::clock`
// has declared `isdaily`, `isweekly`, `ismonthly` and `isintraday` since
// 2026-08-26, with sentences that ARE Pine's definitions word for word.
//
// ⚰️ THIS IS THE SAME DEFECT `dayofweek.friday` HAD, ONE NAMESPACE OVER. The bare
// lane was swept when the clock landed and the dotted lane was not, so a guard's
// sentence quietly became untrue: the engine holds the name, it simply was not
// asked under that spelling.
//
// ⛔ SO THIS FILE'S SUBJECT IS THE MAP'S TWO DIRECTIONS. An alias pointing at a
// column the manifest does not declare is a refusal waiting to happen; a clock
// predicate with NO alias is the half that actually rots, because it is invisible
// until a member pastes a script that uses it.

import { describe, it, expect } from 'vitest'
import { translatePine, BUILTIN_TIMEFRAME_ALIAS, BUILTIN_BARSTATE_ALIAS, BUILTIN_CONSTANT_TREE, BUILTIN_CALENDAR_TREE } from './pine.js'
import { TABLE } from './parse.js'

const plot = (expr) => `//@version=6\nindicator("t")\nplot(${expr})\n`

/** Every clock entry whose name reads as a timeframe predicate. */
const clockPredicates = () => Object.keys(TABLE.clock || {})
  .filter((n) => /^is[a-z]+$/.test(n))
  .sort()

describe('the alias map points at real columns, in both directions', () => {
  it('⛔ every alias VALUE is a clock column the manifest declares', () => {
    const names = Object.values(BUILTIN_TIMEFRAME_ALIAS)
    expect(names.length, 'the map is empty — the rail below proves nothing')
      .toBeGreaterThan(0)
    for (const n of names) {
      expect(TABLE.clock, `${n} is aliased but the manifest declares no such clock column`)
        .toHaveProperty(n)
    }
  })

  it('⛔⛔ every clock PREDICATE is REACHABLE under some Pine name — the direction that rots', () => {
    // ⭐ ADDING `clock.isseconds` AND FORGETTING THE MAP IS INVISIBLE until a
    // member pastes `timeframe.isseconds` and is told the engine has no such
    // name — while the engine has exactly that name. Derived from the manifest,
    // so a new predicate is covered on the day it lands.
    //
    // ⚰️ WIDENED 2026-09-09, AND THE INTENT IS UNCHANGED. This asserted a
    // `timeframe.` alias specifically, which was right while every bool clock
    // column WAS a timeframe predicate. The six barstate columns broke that
    // premise without weakening the rule: what a member needs is that the column
    // be reachable under the name THEY write, whichever namespace that is. So the
    // rail now unions the namespaces — and asserts they stay DISJOINT, because a
    // column reachable under two Pine names would be two authorities over it.
    const tf = Object.values(BUILTIN_TIMEFRAME_ALIAS)
    const bs = Object.values(BUILTIN_BARSTATE_ALIAS)
    const overlap = tf.filter((n) => bs.includes(n))
    expect(overlap, `column(s) ${overlap.join(', ')} are reachable under BOTH `
      + '`timeframe.` and `barstate.` — one column, two Pine names').toEqual([])

    const aliased = new Set([...tf, ...bs])
    const missing = clockPredicates().filter((n) => !aliased.has(n))
    expect(missing, `clock predicate(s) ${missing.join(', ')} have no Pine alias `
      + '— the engine holds the column and the door will refuse the name a member '
      + 'actually writes').toEqual([])
  })

  it('⛔ and the barstate map points at real columns too', () => {
    const names = Object.values(BUILTIN_BARSTATE_ALIAS)
    expect(names.length, 'the barstate map is empty — the rail above proves nothing')
      .toBeGreaterThan(0)
    for (const n of names) {
      expect(TABLE.clock, `${n} is aliased but the manifest declares no such clock column`)
        .toHaveProperty(n)
    }
    for (const [key, col] of Object.entries(BUILTIN_BARSTATE_ALIAS)) {
      expect(key).toBe(`barstate.${col}`)
    }
  })

  it('⭐ the key is exactly `timeframe.` + the column name', () => {
    // A map whose keys drifted from its values would translate the wrong column
    // and nothing above would notice.
    for (const [key, col] of Object.entries(BUILTIN_TIMEFRAME_ALIAS)) {
      expect(key).toBe(`timeframe.${col}`)
    }
  })
})

describe('it translates, on BOTH contracts, and folds nothing', () => {
  for (const col of Object.values(BUILTIN_TIMEFRAME_ALIAS)) {
    it(`⭐ timeframe.${col} translates for a screen AND for a pane`, () => {
      for (const opts of [{}, { strict: true }]) {
        const r = translatePine(plot(`timeframe.${col} ? close : open`), opts)
        expect(r.ok, r.refusal && JSON.stringify(r.refusal)).toBe(true)
      }
    })
  }

  it('⛔⛔ it resolves to the SERIES, not to a folded constant', () => {
    // ⭐ THE DISTINCTION THIS WHOLE MAP TURNS ON. `barstate.isconfirmed` folds to
    // a literal because of how this engine EVALUATES; `dayofweek.friday` folds
    // because a calendar says so. These fold to NOTHING — the value is decided
    // per bar by the engine, exactly as the bare spelling is. A fold here would
    // hard-code one timeframe into a saved definition and be wrong on every other.
    const r = translatePine(plot('timeframe.isdaily ? close : open'), { strict: true })
    const names = new Set()
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'series' && typeof n.name === 'string') names.add(n.name)
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(r.definition ?? r)
    expect(names.has('isdaily'),
      `no isdaily series in the tree; saw ${[...names].sort()}`).toBe(true)
  })

  it('⭐ the dotted and bare spellings produce the SAME tree', () => {
    // ⛔ THE ONLY THING THAT MAKES THIS AN ALIAS RATHER THAN A SECOND FEATURE.
    // If the two spellings diverged, one of them would be a different indicator
    // wearing the same name.
    const dotted = translatePine(plot('timeframe.isdaily ? close : open'), { strict: true })
    const bare = translatePine(plot('isdaily ? close : open'), { strict: true })
    expect(bare.ok, 'the BARE spelling stopped working — the control is broken').toBe(true)
    expect(JSON.stringify(dotted.definition ?? dotted))
      .toBe(JSON.stringify(bare.definition ?? bare))
  })
})

describe('the three dotted maps stay disjoint', () => {
  it('⛔ no name appears in two of them', () => {
    // ⚠️ THE SIZE OF `BUILTIN_CONSTANT_TREE` IS PINNED BY `pine.barstate.test.js`
    // *"so the split cannot GROW by accident — each one is a judgement about what
    // this engine's evaluation model does and does not decide"*. That count only
    // means something while the maps hold different KINDS of thing, so a name in
    // two of them is the failure, not merely untidy.
    const maps = {
      constant: Object.keys(BUILTIN_CONSTANT_TREE),
      calendar: Object.keys(BUILTIN_CALENDAR_TREE),
      timeframe: Object.keys(BUILTIN_TIMEFRAME_ALIAS),
    }
    const seen = new Map()
    for (const [which, keys] of Object.entries(maps)) {
      for (const k of keys) {
        expect(seen.has(k), `${k} is in both ${seen.get(k)} and ${which}`).toBe(false)
        seen.set(k, which)
      }
    }
    expect(seen.size).toBe(Object.values(maps).reduce((a, k) => a + k.length, 0))
  })
})
