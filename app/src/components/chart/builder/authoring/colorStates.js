// app/src/components/chart/builder/authoring/colorStates.js
//
// ─── ⭐⭐ BATCH 2 — UP TO FOUR CONDITION-DRIVEN COLOURS, ON THE PALETTE THAT EXISTS ──
//
// "Bright green when positive and rising, dark green when positive and falling, red
// when negative and falling, orange when negative and rising." The renderer already
// draws an N-way colour: `colorMode: 'column:<key>'` + `colorPalette`, where the named
// column holds each bar's palette INDEX (`pool.columnColorsForPlot`,
// `binder.pointColour`) — every Pine colour chain imported since C1 draws this way,
// on plots and paints (candles / background) alike. This module writes and reads
// that shape for the conversation; there is no second colour engine.
//
//   the hidden STATE column (`<output>_cs`, or `candles_cs` / `background_cs`):
//       s0 ? 0 : (s1 ? 1 : (s2 ? 2 : E))
//   the palette:  [colour of s0, colour of s1, …]  (+ `otherwise` as entry E)
//
// ⛔ "OTHERWISE" IS AN ENTRY OR NOTHING. With an `otherwise` colour, E indexes it; without
// one, E is one past the palette and `binder.pointColour` gives the bar NO state colour
// (the line keeps its own colour, the candle its normal colour, the background none).
//
// ⛔ AN UNKNOWN BAR TAKES NO STATE COLOUR. A conversation-made definition is semantics 2,
// where a condition over an unknown value is unknown, so the index is unknown and
// `pointColour` answers no colour — never a neighbouring state's.
//
// ⭐ RELATIONS FOLLOW THEIR OUTPUT. A state may be one of eight tests of the coloured
// output itself ("positive and rising"); it is stored as the plain tree (`x > 0 &&
// x > x[1]`), RECOGNISED back structurally, and re-derived when that output's maths
// changes in a later turn — exactly like the Phase 5 "rising" helper.

import { astHash } from '../../engine/ast/parse'

const sameTree = (a, b) => { try { return !!a && !!b && astHash(a) === astHash(b) } catch { return false } }

export const STATES_SUFFIX = '_cs'
export const MAX_COLOR_STATES = 4
export const PAINT_STATE_KEYS = Object.freeze({ barcolor: 'candles_cs', bgcolor: 'background_cs' })

const num = (value) => ({ type: 'num', value })
const op = (name, args) => ({ type: 'op', name, args })
const back = (x) => (x && x.type === 'offset' && Number.isInteger(x.value)
  ? { type: 'offset', value: x.value + 1, args: x.args }
  : { type: 'offset', value: 1, args: [x] })

/** The eight tests of an output `x` a state may name. Order is the vocabulary's. */
export const RELATIONS = Object.freeze({
  positive: (x) => op('>', [x, num(0)]),
  negative: (x) => op('<', [x, num(0)]),
  rising: (x) => op('>', [x, back(x)]),
  falling: (x) => op('<', [x, back(x)]),
  positive_rising: (x) => op('&&', [op('>', [x, num(0)]), op('>', [x, back(x)])]),
  positive_falling: (x) => op('&&', [op('>', [x, num(0)]), op('<', [x, back(x)])]),
  negative_rising: (x) => op('&&', [op('<', [x, num(0)]), op('>', [x, back(x)])]),
  negative_falling: (x) => op('&&', [op('<', [x, num(0)]), op('<', [x, back(x)])]),
})
export const RELATION_NAMES = Object.freeze(Object.keys(RELATIONS))
export const RELATION_WORDS = Object.freeze({
  positive: 'above zero', negative: 'below zero', rising: 'rising', falling: 'falling',
  positive_rising: 'above zero and rising', positive_falling: 'above zero and falling',
  negative_rising: 'below zero and rising', negative_falling: 'below zero and falling',
})

/** `s0 ? 0 : (s1 ? 1 : … : E)` for condition trees `conds` and the else index `E`. */
export function stateIndexTree(conds, elseIndex) {
  let acc = num(elseIndex)
  for (let i = conds.length - 1; i >= 0; i -= 1) acc = op('?:', [conds[i], num(i), acc])
  return acc
}

/** `{conds, elseIndex}` when `tree` is exactly a state index tree, else null. */
export function decomposeStateTree(tree) {
  const conds = []
  let t = tree
  while (t && t.type === 'op' && t.name === '?:' && Array.isArray(t.args) && t.args.length === 3) {
    const [c, then, rest] = t.args
    if (!then || then.type !== 'num' || then.value !== conds.length) return null
    conds.push(c)
    t = rest
  }
  if (!conds.length || !t || t.type !== 'num' || t.value !== conds.length) return null
  return { conds, elseIndex: t.value }
}

/** The relation name a condition tree is, for owner tree `x`, or null. */
export function relationOf(cond, x) {
  if (!x) return null
  for (const name of RELATION_NAMES) if (sameTree(cond, RELATIONS[name](x))) return name
  return null
}

/**
 * The states a STATE column + palette say, or null when they are not this module's
 * shape. `ownerTree` (a plot's own tree) lets a condition read back as a relation.
 * @returns {{states: Array<{color, relation?: string, when?: object}>, otherwise?: string}|null}
 */
export function statesFrom({ helperTree, palette, ownerTree = null }) {
  const d = decomposeStateTree(helperTree)
  if (!d || !Array.isArray(palette)) return null
  const k = d.conds.length
  if (k > MAX_COLOR_STATES || !(palette.length === k || palette.length === k + 1)) return null
  if (palette.length === k && k < 2) return null
  const states = d.conds.map((c, i) => {
    const rel = relationOf(c, ownerTree)
    return rel ? { color: palette[i], relation: rel } : { color: palette[i], when: c }
  })
  return palette.length === k + 1 ? { states, otherwise: palette[k] } : { states }
}

/** The palette + index tree for states. `condOf(state)` → the state's condition tree. */
export function statesProgram(states, otherwise, condOf) {
  const conds = states.map(condOf)
  const palette = states.map((s) => s.color)
  if (typeof otherwise === 'string') palette.push(otherwise)
  return { tree: stateIndexTree(conds, states.length), palette }
}

/** Re-derive a state tree whose relations were of `before`, for the owner's new tree. */
export function rederiveStates(helperTree, before, after) {
  const d = decomposeStateTree(helperTree)
  if (!d) return null
  let touched = false
  const conds = d.conds.map((c) => {
    const rel = relationOf(c, before)
    if (!rel) return c
    touched = true
    return RELATIONS[rel](after)
  })
  return touched ? stateIndexTree(conds, d.elseIndex) : null
}
