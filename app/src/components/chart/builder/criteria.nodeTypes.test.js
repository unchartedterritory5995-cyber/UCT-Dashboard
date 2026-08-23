// ─── THE PICKER-STALENESS RAIL — one census over `parse.js::NODE_TYPES` ─────
//
// 🔴 WHY THIS FILE EXISTS, IN ONE SENTENCE: **a walker that has not learned a
// node REFUSES, and a refusal reads exactly like a decision.**
//
// `291c9d8a` added a fifth canonical node — `offset` — and five walkers learned
// it (`assert_canonical`, `ast_budget`, `ast_lint`, `ast_freshness`,
// `sentence.js`). The Conditions picker did not, for three commits. Nothing went
// red, because `criteria.js` answers `picker:node` for a shape it has no row
// for, and that is the SAME answer it gives for the shapes it deliberately
// refuses. So the gap was indistinguishable from a design decision, and it cost
// three separate tasks to find: the concierge port, the batch-2 starters, and
// the picker port itself — each of which measured the same refusal and had to
// re-adjudicate whether it was staleness or intent.
//
// ⛔ THE CHEAP TOOTH, AND IT IS DERIVED: every entry in `parse.js::NODE_TYPES`
// must OPEN in at least one formula the member can type, or be NAMED in an
// explicit exempt map with a reason sentence. `NODE_TYPES` is imported, never
// retyped, so a sixth node type fails BY NAME on the day it lands rather than
// silently joining the set of things the picker quietly refuses.
//
// ────────────────────────────────────────────────────────────────────────────
// WHY THIS LIVES BESIDE `criteria.test.js` AND NOT UNDER `engine/ast/`
// ────────────────────────────────────────────────────────────────────────────
// Both directories were read. `engine/ast/` owns the GRAMMAR: `parse.test.js`
// proves what the parser builds, and `closedTable.test.js` imports `NODE_TYPES`
// only to compose the manifest's own prose from it. Neither imports the picker,
// and a picker test there would be the first — an import edge pointing the wrong
// way, from the grammar's suite into a consumer of it.
//
// `builder/` owns PICKER ROUND-TRIPPING and nothing else does: `criteria.test.js`
// carries the generated identity corpus, the `must_refuse.json` fixture, the
// per-OPERATOR census and the source rail. This file is its missing axis. The
// operator census walks `TABLE.operators` and is therefore blind by construction
// to a node type that is not an operator — which is exactly what `offset` is,
// and exactly why it went unnoticed. Same suite, same subject, one axis over.
//
// ⛔ AND IT IS A SEPARATE FILE ON PURPOSE. `criteria.test.js` is a property test
// over a generated corpus; this is a CENSUS over a declared one. Mixing a
// census's small hand-written probe table into a file whose whole claim is that
// its cases are generated would invite the next reader to hand-write a case
// there too.

import { describe, it, expect } from 'vitest'
import { NODE_TYPES, parseFormula, TABLE } from '../engine/ast/parse'
import { fromSource, vocabulary, REFUSALS } from './criteria'

const VOCAB = vocabulary(TABLE)

// --------------------------------------------------------------------------- //
// the second axis: WHERE a node sits
// --------------------------------------------------------------------------- //
//
// ⭐ THE NODE TYPE ALONE IS TOO COARSE, AND THE MEASUREMENT SAYS SO. Taken by
// type alone, all five of today's node types open somewhere, so a type-level
// exempt map would be EMPTY — an idiom nobody exercises, which is the vacuity
// this rail is supposed to be immune to. The picker's own refusals are not per
// TYPE, they are per type IN A POSITION: an `op` opens as a comparator and
// refuses as arithmetic; a `call` opens as a crossing and as a term function and
// refuses nested inside another call. So the census cell is (type, position).
//
// ⛔ AND THE POSITIONS ARE THE MODULE'S OWN LAYERS, NOT A TAXONOMY INVENTED
// HERE. `criteria.js` has exactly these three readers and they are the three
// names below: `readCondition` (a thing that answers yes-or-no), `readTerm` (a
// side of a comparison), and `leafSource`/`readTerm`'s call branch (an argument,
// which is a term with FEWER shapes allowed — that narrowing is the whole reason
// it is its own layer rather than a term).
const CONDITION = 'condition'
const TERM = 'term'
const CALLARG = 'call-argument'
const POSITIONS = Object.freeze([CONDITION, TERM, CALLARG])

/** Every `<type>@<position>` pair a tree contains, walked the way the PICKER
 *  walks it.
 *
 *  ⛔ THE DISPATCH IS THE VOCABULARY'S, NEVER A TYPED NAME. Which operator is a
 *  join, which is the negation and which function is a crossing are all read off
 *  `vocabulary(TABLE)` — the same derivation `criteria.js` itself uses — so
 *  renaming `&&` or adding a third boolean function moves this walk with no edit
 *  here. A hand-list would be the source rail's own defect, one file over.
 */
export function pairsIn(node, vocab, position = CONDITION, out = new Set()) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return out
  if (!POSITIONS.includes(position)) {
    throw new Error(`the walk produced an undeclared position ${position}`)
  }
  out.add(`${node.type}@${position}`)
  const args = node.args || []

  if (node.type === 'offset') {
    // ⭐ A QUALIFIER READS ITS CHILD IN ITS OWN POSITION. `expr[N]` is an adverb
    // (`criteria.js`'s fifth shape): `(a < b)[1]` qualifies a CONDITION and
    // `high[1]` qualifies a TERM, and that difference is the whole distinction
    // between Remount and `close < sma(close, 50)[1]`.
    for (const a of args) pairsIn(a, vocab, position, out)
    return out
  }

  if (node.type === 'op') {
    // A join or the negation, standing where a condition goes, takes CONDITIONS.
    // Everything else takes operands of its own layer: a comparator at the top
    // opens the term layer, and an operator already inside the term or argument
    // layer keeps its children there.
    const takesConditions = position === CONDITION
      && (vocab.joinOf.has(node.name) || node.name === vocab.notOp)
    const child = takesConditions ? CONDITION : (position === CONDITION ? TERM : position)
    for (const a of args) pairsIn(a, vocab, child, out)
    return out
  }

  if (node.type === 'call') {
    // A CROSSING standing where a condition goes is a row, and its two operands
    // are terms. Every other call is a term function, and its operands are
    // ARGUMENTS — the narrower layer.
    const asCrossing = position === CONDITION && vocab.crossings.has(node.name)
    for (const a of args) pairsIn(a, vocab, asCrossing ? TERM : CALLARG, out)
    return out
  }

  // `num` and `series` are leaves — a scalar rides `series` (E-1), which is why
  // there is no `scalar` position and no `scalar` node type to look for.
  return out
}

// --------------------------------------------------------------------------- //
// the census
// --------------------------------------------------------------------------- //

/** One probe: a formula a member could type, the node type it exercises, and
 *  the position that node sits in. `opens` is the CLAIM; the tests measure it. */
const shape = (id, type, position, formula, opens) =>
  Object.freeze({ id, type, position, formula, opens })

/** ⭐ ONE PROBE PER CELL, AND TWO WHERE THE CELL SPLITS. `op@term` hosts both a
 *  refusal and an opening — arithmetic refuses, a negated LITERAL opens — so it
 *  declares two shapes rather than one verdict that would be half a lie. */
const SHAPES = Object.freeze([
  // ── the condition layer ──────────────────────────────────────────────────
  shape('num@condition', 'num', CONDITION, '1', false),
  shape('series@condition', 'series', CONDITION, 'above_50sma', true),
  shape('op@condition', 'op', CONDITION, 'close > open', true),
  shape('call@condition', 'call', CONDITION, 'crossOver(close, open)', true),
  shape('offset@condition', 'offset', CONDITION, '(close < sma(close, 50))[1]', true),

  // ── the term layer ───────────────────────────────────────────────────────
  shape('num@term', 'num', TERM, 'rs_rank >= 80', true),
  shape('series@term', 'series', TERM, 'close > open', true),
  shape('op@term:arithmetic', 'op', TERM, 'close - low > 0', false),
  shape('op@term:negated-literal', 'op', TERM, 'pct_vs_ema20 >= -2', true),
  shape('call@term', 'call', TERM, 'close > sma(close, 50)', true),
  shape('offset@term', 'offset', TERM, 'close > high[1]', true),

  // ── the call-argument layer ──────────────────────────────────────────────
  shape('num@call-argument', 'num', CALLARG, 'close > sma(close, 50)', true),
  shape('series@call-argument', 'series', CALLARG, 'close > sma(close, 50)', true),
  shape('op@call-argument', 'op', CALLARG, 'close > sma(close, -50)', false),
  shape('call@call-argument', 'call', CALLARG, 'close > sma(sma(close, 10), 50)', false),
  shape('offset@call-argument', 'offset', CALLARG, 'close > sma(close[1], 50)', false),
])

/** ⛔⛔ THE EXEMPT MAP — `closedTable.json::_scalars_excluded`'s idiom, applied
 *  to the picker. A shape in here is a RECORDED DECISION that the picker refuses
 *  it and why; a shape that refuses and is NOT in here is a walker that has gone
 *  stale, and the census below cannot tell those two apart any other way.
 *
 *  Each entry carries the GUARD the refusal must answer with as well as the
 *  reason, because "it refuses" and "it refuses for the reason we decided" are
 *  different facts — a shape that started refusing at a different door has
 *  changed even if it still refuses.
 *
 *  ⚠️ THE REASONS ARE `criteria.js`'s OWN, RESTATED IN ONE SENTENCE — the file
 *  header states each of them at length. If one of these ever disagrees with
 *  that header, the header is the authority and this map is the stale copy.
 */
const NOT_PICKABLE = Object.freeze({
  'num@condition': {
    guard: 'picker:not-a-condition',
    why: 'a bare number is not a yes-or-no answer, so there is no condition for '
      + 'the picker to show — this is the manifest\'s `yields` rule reaching the '
      + 'picker, not a missing walker, and it must stay refused.',
  },
  'op@term:arithmetic': {
    guard: 'picker:term',
    why: '🔴 THE ONE LIVE GAP, AND IT IS A DECISION ON THE RECORD. Arithmetic '
      + 'makes a TERM a tree one layer below the row, so taking it would turn '
      + 'every term slot in every row shape into a recursive editor — a '
      + 'different grammar for the operand, and a phase of its own rather than a '
      + 'patch. Kicker Candle is the setup that paid for it: its first clause '
      + 'was `(close - low) / (high - low)` until 2026-08-23, when it was '
      + 're-expressed in the firm\'s own `close_position` column instead.',
  },
  'op@call-argument': {
    guard: 'picker:term',
    why: 'an argument\'s controls are a name picker and a window box, so a '
      + 'negative or computed argument would put `sma(close, 20)` on screen for '
      + 'a formula that says something else. Refused in BOTH directions '
      + '(`leafSource` and `readTerm`\'s call branch) so they cannot disagree.',
  },
  'call@call-argument': {
    guard: 'picker:term',
    why: 'ONE LEVEL of call, by design: a nested call is a real formula and the '
      + 'formula field is the door that shows one. Spelling a nested call here '
      + 'would produce source the picker could not read back, which is the '
      + 'asymmetry the identity property exists to catch.',
  },
  'offset@call-argument': {
    guard: 'picker:term',
    why: '`sma(close[1], 20)` is a legal formula whose picker would render as '
      + '`sma(close, 20)` — an argument row has no bar-count control — so the '
      + 'qualifier is refused inside a call for the same reason a negative '
      + 'literal is, and in both directions.',
  },
})

/** ⭐ THE TYPE-LEVEL EXEMPT MAP, AND IT IS EMPTY — WHICH IS THE FINDING.
 *
 *  Every one of today's five canonical node types opens in at least one formula.
 *  That is a genuine measurement and it is why the (type, position) axis exists
 *  above: a rail that only asked "does each TYPE open somewhere" would carry an
 *  empty exclusion map, and an exclusion idiom with nothing in it is one nobody
 *  maintains. This map is kept anyway, empty, because the day a SIXTH node type
 *  lands with no picker row at all, the honest answer is a named entry here —
 *  not a silent refusal, and not a rail somebody edits until it passes.
 */
const TYPES_NOT_PICKABLE = Object.freeze({})

// --------------------------------------------------------------------------- //
// the checks, as PURE FUNCTIONS so the controls can run them on mutated input
// --------------------------------------------------------------------------- //

/** Cells of `nodeTypes x positions` that no shape probes, and shape types the
 *  grammar does not declare. ⭐ BOTH DIRECTIONS: a node type added to the
 *  grammar shows up as gaps; a shape left behind after a type was removed or
 *  renamed shows up as `unknown`. */
export function coverageGaps(shapes, nodeTypes, positions = POSITIONS) {
  const seen = new Set(shapes.map((s) => `${s.type}@${s.position}`))
  const gaps = []
  for (const type of nodeTypes) {
    for (const position of positions) {
      if (!seen.has(`${type}@${position}`)) gaps.push(`${type}@${position}`)
    }
  }
  const unknown = [...new Set(shapes.map((s) => s.type))]
    .filter((t) => !nodeTypes.includes(t)).sort()
  return { gaps, unknown }
}

/** Shapes whose probe does NOT actually contain the node type at the position it
 *  claims. ⛔ THE NON-VACUITY CORE: without this a census passes by choosing
 *  formulas that open for some other reason entirely. */
export function containmentFailures(shapes, vocab) {
  const out = []
  for (const s of shapes) {
    const parsed = parseFormula(s.formula)
    if (!parsed.ok) { out.push(`${s.id}: does not parse (${parsed.error})`); continue }
    const pairs = pairsIn(parsed.ast, vocab)
    if (!pairs.has(`${s.type}@${s.position}`)) {
      out.push(`${s.id}: \`${s.formula}\` contains no ${s.type}@${s.position} `
        + `(it contains ${[...pairs].sort().join(', ')})`)
    }
  }
  return out
}

/** Shapes whose MEASURED picker verdict disagrees with the census. */
export function verdictFailures(shapes, exempt, vocab) {
  const out = []
  for (const s of shapes) {
    const res = fromSource(s.formula, vocab)
    if (s.opens) {
      if (!res.ok) {
        out.push(`${s.id}: \`${s.formula}\` was expected to OPEN and refused `
          + `${res.guard} — either the picker went stale on ${s.type}@${s.position}, `
          + 'or this is a decision that has to be recorded in NOT_PICKABLE');
      }
      continue
    }
    const declared = exempt[s.id]
    if (!declared) {
      out.push(`${s.id}: refuses ${res.guard} and is named in no exempt map — `
        + 'a refusal nobody recorded is indistinguishable from a stale walker')
      continue
    }
    if (res.ok) {
      out.push(`${s.id}: is listed as NOT PICKABLE and the picker OPENS it — the `
        + 'exemption is stale and its reason is now teaching a gap that closed')
      continue
    }
    if (res.guard !== declared.guard) {
      out.push(`${s.id}: refuses ${res.guard}, but the exemption records `
        + `${declared.guard} — it still refuses, at a different door`)
    }
  }
  return out
}

/** Exempt entries naming a shape the census does not probe. ⛔ THE
 *  `_scalars_excluded` HAZARD: an exclusion list with a stale entry is a lie
 *  that reads as documentation. */
export function exemptOrphans(shapes, exempt) {
  const ids = new Set(shapes.map((s) => s.id))
  return Object.keys(exempt).filter((k) => !ids.has(k)).sort()
}

/** Does the SHIPPED picker open this probe? ⛔ MEASURED, never read off the
 *  census's own `opens` claim — a tooth that trusted the table it is checking
 *  would go green by editing the table, which is the failure it exists to
 *  prevent. (`verdictFailures` is the other direction: it holds the CLAIM to the
 *  measurement, so the two together catch drift from either side.) */
const measuredOpens = (s) => fromSource(s.formula, VOCAB).ok

/** Node types with no OPENING shape at all — the coarse tooth the prior three
 *  tasks would each have been spared. */
export function typesWithNoOpenShape(shapes, nodeTypes, opensOf = measuredOpens) {
  const opening = new Set(shapes.filter(opensOf).map((s) => s.type))
  return nodeTypes.filter((t) => !opening.has(t))
}

// --------------------------------------------------------------------------- //

describe('⭐ EVERY CANONICAL NODE TYPE OPENS IN THE PICKER, OR IS A NAMED REFUSAL', () => {
  it('the grammar this census reads is not empty', () => {
    // ⛔ A census over an empty roster passes for the worst possible reason.
    expect(NODE_TYPES.length).toBeGreaterThan(3)
    expect(SHAPES.length).toBeGreaterThanOrEqual(NODE_TYPES.length * POSITIONS.length)
    expect(VOCAB.crossings.size, 'no crossing declared — call@condition is unreachable')
      .toBeGreaterThan(0)
    expect(VOCAB.notOp).toBeTruthy()
  })

  it('🔴 THE TOOTH: every entry in `parse.js::NODE_TYPES` opens in some formula', () => {
    // This is the assertion that would have gone red the day `291c9d8a` landed:
    // `offset` was in NODE_TYPES and no formula containing one could be opened.
    // ⛔ THE VERDICT IS MEASURED THROUGH `fromSource`, so un-learning a node in
    // `criteria.js` reds this test — mutation-checked by disabling both `offset`
    // branches, which reproduces the exact three-commit gap.
    const closed = typesWithNoOpenShape(SHAPES, NODE_TYPES)
    const unrecorded = closed.filter((t) => !(t in TYPES_NOT_PICKABLE))
    expect(unrecorded, 'these canonical node types open in NO formula and are named in '
      + 'no exempt map — a walker has gone stale, or a decision was never written down')
      .toEqual([])
    // …and the exempt map may not outlive the grammar it excuses.
    expect(Object.keys(TYPES_NOT_PICKABLE).filter((t) => !NODE_TYPES.includes(t)))
      .toEqual([])
  })

  it('⛔ AND IT IS DERIVED: a SIXTH node type fails BY NAME, in every position', () => {
    // The control that makes the tooth above load-bearing rather than a list
    // somebody keeps in step by hand.
    const sixth = coverageGaps(SHAPES, [...NODE_TYPES, 'lambda'])
    expect(sixth.gaps).toEqual([
      'lambda@condition', 'lambda@term', 'lambda@call-argument',
    ])
    expect(typesWithNoOpenShape(SHAPES, [...NODE_TYPES, 'lambda'])).toEqual(['lambda'])
  })

  it('⛔ AND A DELETED CASE IS NAMED, not silently uncovered', () => {
    // Delete every `call` probe: the census must say which cells lost cover.
    const without = SHAPES.filter((s) => s.type !== 'call')
    expect(coverageGaps(without, NODE_TYPES).gaps).toEqual([
      'call@condition', 'call@term', 'call@call-argument',
    ])
    expect(typesWithNoOpenShape(without, NODE_TYPES)).toEqual(['call'])
    // …and the real table has none of that.
    expect(coverageGaps(SHAPES, NODE_TYPES)).toEqual({ gaps: [], unknown: [] })
  })

  it('⛔ AND THE TOOTH MEASURES — a census that merely CLAIMED to open would pass', () => {
    // The control on the control. A table asserting `opens: true` over a formula
    // the shipped picker refuses must still report the type as closed, or the
    // rail could be made green by editing the table instead of the walker.
    const liar = [{
      id: 'liar', type: 'offset', position: CALLARG, opens: true,
      formula: 'close > sma(close[1], 50)',
    }]
    expect(typesWithNoOpenShape(liar, ['offset'])).toEqual(['offset'])
    // …and with the claim believed instead of measured, it would say nothing.
    expect(typesWithNoOpenShape(liar, ['offset'], (s) => s.opens)).toEqual([])
  })

  it('⛔ AND A RENAMED TYPE is caught from BOTH sides', () => {
    // The failure mode a one-sided check misses: the shape table still probes
    // something, it is simply no longer the thing the grammar declares.
    const renamed = SHAPES.map((s) => (s.type === 'offset' ? { ...s, type: 'offsett' } : s))
    const got = coverageGaps(renamed, NODE_TYPES)
    expect(got.gaps).toEqual(['offset@condition', 'offset@term', 'offset@call-argument'])
    expect(got.unknown).toEqual(['offsett'])
  })
})

describe('the census probes what it says it probes', () => {
  it('every probe parses and really contains its node type IN ITS POSITION', () => {
    expect(containmentFailures(SHAPES, VOCAB)).toEqual([])
  })

  it('⛔ AND THE CONTAINMENT CHECK BITES — a probe pointed at the wrong cell fails', () => {
    const planted = [
      { id: 'planted', type: 'offset', position: TERM, formula: 'close > open', opens: true },
    ]
    const failures = containmentFailures(planted, VOCAB)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('planted')
    expect(failures[0]).toContain('offset@term')
  })

  it('⭐ THE WALK IS POSITION-SENSITIVE — the whole point of the second axis', () => {
    // `(a < b)[1]` and `a < b[1]` are two different questions (Remount is the
    // first). A walk that could not tell them apart would let one probe stand in
    // for both cells.
    const whole = pairsIn(parseFormula('(close < sma(close, 50))[1]').ast, VOCAB)
    expect(whole.has('offset@condition')).toBe(true)
    expect(whole.has('offset@term')).toBe(false)

    const side = pairsIn(parseFormula('close > high[1]').ast, VOCAB)
    expect(side.has('offset@term')).toBe(true)
    expect(side.has('offset@condition')).toBe(false)

    // …and an argument is not a term: `sma`'s operands are the narrower layer.
    const call = pairsIn(parseFormula('close > sma(close, 50)').ast, VOCAB)
    expect(call.has('call@term')).toBe(true)
    expect(call.has('num@call-argument')).toBe(true)
    expect(call.has('num@term')).toBe(false)
  })

  it('every position the census declares is actually reached', () => {
    const reached = new Set()
    for (const s of SHAPES) {
      for (const pair of pairsIn(parseFormula(s.formula).ast, VOCAB)) {
        reached.add(pair.split('@')[1])
      }
    }
    expect([...reached].sort()).toEqual([...POSITIONS].sort())
  })
})

describe('⛔ A REFUSAL IS A RECORDED DECISION OR IT IS A DEFECT', () => {
  it('every measured verdict agrees with the census, at the SAME door', () => {
    expect(verdictFailures(SHAPES, NOT_PICKABLE, VOCAB)).toEqual([])
  })

  it('⛔ AND AN UNRECORDED REFUSAL IS NAMED — the whole staleness class', () => {
    // Drop `op@term:arithmetic` from the exempt map: the census must report a
    // refusal nobody wrote down, which is exactly what `offset` looked like for
    // three commits.
    const thinned = { ...NOT_PICKABLE }
    delete thinned['op@term:arithmetic']
    const failures = verdictFailures(SHAPES, thinned, VOCAB)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('op@term:arithmetic')
    expect(failures[0]).toContain('named in no exempt map')
  })

  it('⛔ AND A STALE EXEMPTION IS NAMED TOO — the `_scalars_excluded` hazard', () => {
    // The opposite drift: a shape that USED to refuse and now opens. The reason
    // sentence would go on teaching a gap that closed, which is the defect this
    // whole file exists to prevent, pointed the other way.
    const stale = SHAPES.map((s) => (s.id === 'offset@term' ? { ...s, opens: false } : s))
    const exempt = {
      ...NOT_PICKABLE,
      'offset@term': { guard: 'picker:node', why: 'the picker has no bar-count control.' },
    }
    const failures = verdictFailures(stale, exempt, VOCAB)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('offset@term')
    expect(failures[0]).toContain('the picker OPENS it')
  })

  it('⛔ AND A REFUSAL THAT MOVED DOORS IS NAMED — "still refuses" is not enough', () => {
    const wrongDoor = {
      ...NOT_PICKABLE,
      'op@term:arithmetic': { ...NOT_PICKABLE['op@term:arithmetic'], guard: 'picker:node' },
    }
    const failures = verdictFailures(SHAPES, wrongDoor, VOCAB)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('at a different door')
  })

  it('the exempt map is NON-EMPTY, has no orphans, and every guard is declared', () => {
    // ⛔ A non-empty map is the difference between an idiom and a decoration.
    expect(Object.keys(NOT_PICKABLE).length).toBeGreaterThan(0)
    expect(exemptOrphans(SHAPES, NOT_PICKABLE)).toEqual([])
    expect(exemptOrphans([...SHAPES, { id: 'x' }], { ...NOT_PICKABLE, ghost: {} }))
      .toEqual(['ghost'])
    for (const [id, entry] of Object.entries(NOT_PICKABLE)) {
      expect(Object.keys(REFUSALS), id).toContain(entry.guard)
    }
  })

  it('every exemption carries a REASON a reader can act on, and no two are the same', () => {
    // The `_ungrounded` rails' shape: a reason short enough to be a label is a
    // refusal nobody adjudicated.
    const reasons = Object.values(NOT_PICKABLE).map((e) => e.why)
    for (const [id, entry] of Object.entries(NOT_PICKABLE)) {
      expect(entry.why.length, `${id} has no real reason`).toBeGreaterThan(80)
      expect(entry.why.trim().endsWith('.'), `${id}'s reason is not a sentence`).toBe(true)
    }
    expect(new Set(reasons).size, 'two exemptions share one reason — at least one of '
      + 'them was copied rather than decided').toBe(reasons.length)
  })
})
