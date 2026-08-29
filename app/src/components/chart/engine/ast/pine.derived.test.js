// ⭐ THE DERIVED PINE CALLS, AND THE TWO THAT REFUSE INSTEAD.
//
// `ta.roc` and `ta.avg` are EXACT expansions in this table's own vocabulary, so
// they cost the closed table zero new names — the same rule that governs `tr` and
// the four derived logical operators. `ta.cum` and `ta.barssince` are NOT
// expressible here, and they refuse BY NAME with the reason rather than resolving
// to a neighbour that would parse, lint, save, scan and be wrong.

import { describe, it, expect } from 'vitest'
import { translatePine, PINE_INEXPRESSIBLE } from './pine.js'
import { parseFormula, astHash, TABLE } from './parse.js'
import { interpret } from './interpret.js'
import { lintRepaint } from './lint.js'

/** A one-plot script, so the translator's own door is the thing under test. */
const script = (expr) => `//@version=5
indicator("t")
plot(${expr})
`

const treeOf = (expr) => {
  const r = translatePine(script(expr))
  const out = (r.outputs || []).find((o) => o.ast)
  if (!out) {
    const ref = (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal
    throw new Error(`refused: ${ref ? ref.guard + ' — ' + ref.message : 'no output'}`)
  }
  return out.ast
}

/** The canonical tree, or null when the translator refuses. ⛔ A HELPER, not a
 *  try/catch inlined at each call site: the sweep below asks this question 57
 *  times and a per-site catch is how one of them quietly starts swallowing a
 *  different error. */
const treeOfOrNull = (expr) => { try { return treeOf(expr) } catch { return null } }

const refusalOf = (expr) => {
  const r = translatePine(script(expr))
  return (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal || null
}

const BARS = Array.from({ length: 40 }, (_, i) => {
  const c = 100 + i
  return { o: c - 1, h: c + 1, l: c - 2, c, v: 1000 + i * 10 }
})
const col = (tree) => [...interpret(tree, BARS, {})]

describe('ta.roc — an exact expansion, not a new name', () => {
  it('IS the native tree, by astHash', () => {
    // TradingView's own definition: 100 * (src - src[n]) / src[n]
    const native = parseFormula('100 * (close - close[10]) / close[10]')
    expect(native.ok).toBe(true)
    expect(astHash(treeOf('ta.roc(close, 10)'))).toBe(astHash(native.ast))
  })

  it('computes the percentage change, checked by hand', () => {
    const out = col(treeOf('ta.roc(close, 10)'))
    // close rises by exactly 1 per bar, so at bar 20: 100*(120-110)/110
    expect(out[20]).toBeCloseTo((100 * 10) / 110, 9)
    // ⛔ AND THE LEFT EDGE IS NOT COMPUTABLE, never 0 — a zero would read as
    // "no change" and match every `roc < 1` screen on a stock's first bars.
    expect(Number.isNaN(out[9])).toBe(true)
  })

  it('a length that is not a written number REFUSES rather than guessing', () => {
    expect(refusalOf('ta.roc(close, close)')).toBeTruthy()
  })
})

describe('ta.avg — the mean of its ARGUMENTS, which is not a moving average', () => {
  it('IS the native tree, by astHash', () => {
    const native = parseFormula('(high + low) / 2')
    expect(native.ok).toBe(true)
    expect(astHash(treeOf('ta.avg(high, low)'))).toBe(astHash(native.ast))
  })

  it('⛔ IS NOT `sma`, AND THAT IS THE TRAP', () => {
    // Reading `ta.avg(a, b)` as a 2-bar moving average of `a` parses, scans and
    // is wrong on every bar. The hashes must differ.
    const wrong = parseFormula('sma(high, 2)')
    expect(astHash(treeOf('ta.avg(high, low)'))).not.toBe(astHash(wrong.ast))
  })

  it('averages three arguments too', () => {
    const out = col(treeOf('ta.avg(high, low, close)'))
    const b = BARS[15]
    expect(out[15]).toBeCloseTo((b.h + b.l + b.c) / 3, 9)
  })

  it('one argument REFUSES — an average of one thing is a typo, not a mean', () => {
    expect(refusalOf('ta.avg(close)')).toBeTruthy()
  })
})

describe('🔴 the two that CANNOT be expressed, and say so by name', () => {
  it('ta.cum refuses, and names the running-total reason', () => {
    const r = refusalOf('ta.cum(volume)')
    expect(r).toBeTruthy()
    expect(r.message).toMatch(/running total/i)
    // ⭐ AND IT POINTS AT THE HONEST ALTERNATIVE rather than just saying no.
    expect(r.message).toMatch(/sum\(source, n\)/)
  })

  it('ta.barssince refuses, and names the UNBOUNDED reason', () => {
    const r = refusalOf('ta.barssince(close > open)')
    expect(r).toBeTruthy()
    expect(r.message).toMatch(/unbounded/i)
  })

  it('⛔ NEITHER RESOLVES TO A NEIGHBOUR — the whole point of naming them', () => {
    // If `cum` ever silently became `sum`, this is what would catch it.
    for (const expr of ['ta.cum(volume)', 'ta.barssince(close > open)']) {
      expect(() => treeOf(expr)).toThrow(/refused/)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════ //
  // ⛔⛔ THE DOOR THAT **OPENS**
  // ═══════════════════════════════════════════════════════════════════════ //
  //
  // 🔴 THE MECHANISM, AND IT IS THE GENERAL HAZARD: `resolveTableCall` resolves a
  // Pine call by BARE-NAME COLLISION with `closedTable.json`. So declaring a table
  // entry OPENS A PINE DOOR IN A FILE NOBODY EDITED. W2a.5 declared `highestbars`
  // and `lowestbars`; `ta.highestbars(high, 5)` immediately translated green — and
  // Pine's offsets are NON-POSITIVE while ours are the positive distance, so a
  // member pasting real Pine got a SIGN-FLIPPED column: plausible on every bar,
  // wrong on every bar, no refusal, nothing red.
  //
  // ⛔ THE `PINE_INEXPRESSIBLE ∩ TABLE.functions` RAIL BELOW CANNOT SEE THIS. It
  // covers the direction that CLOSES a door (a refusal that stopped firing). An
  // opening door is a name that was refused yesterday and resolves today, and only
  // a sweep over the whole table can notice it.
  //
  // ⭐ SO THE SUBJECT IS EVERY DECLARED FUNCTION, and the assertion is a SET
  // EQUALITY in both directions: a name that starts resolving lands red as an
  // unvetted door, and a name that stops resolving lands red as a lost mapping.
  const TA_VETTED = Object.freeze({
    // — Pine spells these the same and MEANS the same. Ordinary reductions and
    //   pointwise math; no sign, no offset, no unit to get wrong.
    sma: 'ta.sma — same window mean', ema: 'ta.ema — same smoother',
    rma: 'ta.rma — Wilder, same', wma: 'ta.wma — same weighting',
    // ⭐ VETTED AGAINST TRADINGVIEW'S OWN PUBLISHED SOURCE, not against the name.
    // `ta.hma(_src, _length) => ta.wma(2 * ta.wma(_src, _length / 2) -
    // ta.wma(_src, _length), math.round(math.sqrt(_length)))`. Three things had to
    // match and all three do: ARGUMENT ORDER is (source, length) like ours;
    // `_length / 2` is INT division in Pine, which is our `floor(n / 2)`; and
    // `math.round` rounds half away from zero, which is our `round(sqrt(n))`
    // written out as `floor(x + 0.5)` in the Python lane. No sign, no offset.
    hma: 'ta.hma — same composition of wma, same two derived windows',
    stdev: 'ta.stdev — same population divisor', dev: 'ta.dev — Pine ta.dev IS mean-absolute',
    sum: 'ta.sum — same window sum', change: 'ta.change(src) 1-arg — the n-arg form is refused by arity',
    highest: 'ta.highest — a VALUE, so no offset convention to disagree about',
    lowest: 'ta.lowest — a VALUE, likewise',
    rsi: 'ta.rsi — same', macd: 'ta.macd — line only, shape-mapped',
    stoch: 'ta.stoch — %K, shape-mapped', crossOver: 'ta.crossover — same event',
    crossUnder: 'ta.crossunder — same event',
    vwap: 'ta.vwap — session accumulator', avwap: 'ta.vwap(anchor) — shape-mapped',
    // — VETTED WITH AN INDEX SHIFT, which is the case this list's warning is about.
    //   Pine RETURNS a pivot at its CONFIRMATION bar, `rightbars` after the pivot;
    //   this table's `pivothigh` emits ON the pivot bar. Same values, different
    //   index — exactly the class that "shipped green with the sign inverted".
    //   ⭐ SO THE MAPPING IS NOT THE BARE NAME: `PINE_NAMESPACED_TREE` expands
    //   `ta.pivothigh(src, L, R)` to `pivothigh(src, L, R)[R]`, and the offset
    //   cancels the child's forward reach so the result is `non-repainting` —
    //   which is WHY Pine publishes at the confirmation bar in the first place.
    //   The bare `pivothigh(…)` still resolves unshifted and still reads
    //   `preview-repaints`, because in our box the bare name means our function.
    pivothigh: 'ta.pivothigh — shifted to the CONFIRMATION bar, [rightbars]',
    pivotlow: 'ta.pivotlow — shifted to the CONFIRMATION bar, [rightbars]',
    //   And the SIGN pair, settled the same way: Pine returns the offset as a
    //   NON-POSITIVE number where this table returns the POSITIVE distance, so
    //   `PINE_NAMESPACED_TREE` expands `ta.highestbars(src, n)` to
    //   `-highestbars(src, n)`. `u-` is a declared operator; the refusal that
    //   used to sit here asked for exactly this and it was finally read.
    highestbars: 'ta.highestbars — NEGATED, Pine returns a non-positive offset',
    lowestbars: 'ta.lowestbars — NEGATED, Pine returns a non-positive offset',
    // — NOT `ta.` NAMES IN PINE AT ALL (they live in `math.*`), so `ta.x` is a
    //   spelling no real script contains. Resolving is harmless; refusing them
    //   would be inventing a rule about a name Pine does not have.
    //
    //   ⛔ NO COUNT IS WRITTEN IN THIS COMMENT. It said "nine are `math.*`" and
    //   the real number is FOURTEEN — a count in prose beside a list that is
    //   asserted elsewhere is the stale-width shape in miniature, and this repo
    //   has now paid for that shape five times. The group is DERIVED below
    //   instead, off these reasons, so it cannot drift from the list it counts.
    abs: 'math.abs', sqrt: 'math.sqrt', ln: 'math.log', log10: 'math.log10',
    exp: 'math.exp', sign: 'math.sign', round: 'math.round',
    min: 'math.min', max: 'math.max',
    sin: 'math.sin', cos: 'math.cos', tan: 'math.tan', atan: 'math.atan',
    sinh: 'math.sinh',
    na: 'na() is a Pine builtin, not ta.na',
    // — OURS ALONE. Pine has `ta.obv` (unbounded, refused — not in this table);
    //   `ta.obvN` is not a Pine name, so nothing can be mistranslated onto it.
    obvN: 'no Pine name collides — ta.obv is the unbounded one and stays refused',
    // — W2a.7. ⭐ VETTED RATHER THAN REFUSED, and the distinction from
    //   `ta.highestbars`/`ta.pivothigh` is the whole reason this list carries a
    //   REASON per name instead of a checkmark. Those two are real Pine builtins
    //   whose values disagree with ours by a sign and by an index; these three are
    //   spellings Pine does not define (`/pine-script-reference/v5/fun_ta.aroonup`
    //   404s), so no real pasted Pine can contain them.
    //   ⭐ AND AROON IS SAFE EVEN IF THAT IS EVER WRONG: it is a normalised 0-100
    //   oscillator with one published formula, and Pine's own construction
    //   `100*(highestbars(high, len+1)+len)/len` is OUR number written under
    //   Pine's negative-offset convention — the two agree by arithmetic.
    //   ⛔⛔ `bop` HAS ONLY THE FIRST GROUND, AND THE SECOND ONE WOULD FAIL —
    //   said here rather than left for a reader to infer from the bullet above,
    //   which covers three names with two arguments. TradingView's BOP is the
    //   UNSMOOTHED per-bar ratio `(close - open) / (high - low)`; ours is that
    //   ratio's `n`-bar MEAN. They coincide at `bop(1)` and nowhere else, which
    //   is arithmetic rather than an opinion and is measured on real bars in
    //   `interpret.test.js` ("aroon and bop, hand-computed in the JS lane"):
    //   `bop(1)` equals the raw ratio bar for bar, and `bop(5)` differs from it.
    //   ⚠️ SO THIS ROW RESTS ON A SINGLE OBSERVATION — `/pine-script-reference/
    //   v5/fun_ta.bop` 404s TODAY — AND A SINGLE MEASUREMENT IS A RUMOUR. If
    //   `ta.bop` ever becomes a Pine name, this door opens onto a
    //   MISTRANSLATION: a pasted `ta.bop(...)` would silently become our
    //   smoothed mean, plausible on every bar and wrong on every bar but the
    //   first. The move then is to REFUSE it here the way `ta.highestbars` is
    //   refused for its sign — NOT to widen this reason.
    aroonUp: 'ta.aroonup is not a Pine builtin; and the formula would agree anyway',
    aroonDown: 'ta.aroondown is not a Pine builtin; same published formula',
    bop: 'ta.bop is not a Pine builtin (TradingView ships BOP as an indicator, not a ta.* fn)'
      + ' — and UNLIKE the two above, the formulas would NOT agree if it became one:'
      + ' theirs is the unsmoothed per-bar ratio, ours is its n-bar mean (equal only at n=1)',
  })

  it('⛔⛔ EVERY declared name, offered under `ta.` — a door that OPENS lands RED', () => {
    const ARG = { series: 'close', int: '5' }
    const open = []
    for (const [name, spec] of Object.entries(TABLE.functions)) {
      const args = (spec.args || []).map((k) => ARG[k]).join(', ')
      if (treeOfOrNull(`ta.${name}(${args})`)) open.push(name)
    }
    open.sort()
    const vetted = Object.keys(TA_VETTED).sort()

    const opened = open.filter((n) => !TA_VETTED[n])
    expect(opened.join(', '), 'a NEW `ta.` door opened by a manifest entry. Pine '
      + 'resolves by BARE-NAME COLLISION, so declaring a name in closedTable.json '
      + 'makes `ta.<name>` translate in a file you never edited. Before adding it '
      + 'to TA_VETTED, check Pine\'s published definition — units, SIGN, and '
      + 'argument order. `ta.highestbars` shipped green with the sign inverted.')
      .toBe('')

    const closed = vetted.filter((n) => !open.includes(n))
    expect(closed.join(', '), 'a `ta.` mapping that used to work stopped. If that '
      + 'is deliberate (a new refusal), delete the name from TA_VETTED in the same '
      + 'commit — a vetted list that no longer matches is not a rail.')
      .toBe('')

    // NON-VACUITY: the sweep really exercised the table and really saw doors.
    expect(Object.keys(TABLE.functions).length).toBeGreaterThanOrEqual(50)
    expect(open.length).toBeGreaterThanOrEqual(30)

    // ⭐ AND THE GROUPS ARE DERIVED FROM THE REASONS, NOT COUNTED BY HAND. The
    // `math.*` half is the largest and the least interesting — those are names
    // Pine does not put under `ta.` at all — so it is the half most likely to be
    // described wrongly in a comment. Measured here so the description cannot be.
    const mathOnly = vetted.filter((n) => TA_VETTED[n].startsWith('math.'))
    expect(mathOnly.length, 'the `math.*` group')
      .toBe(vetted.length - vetted.filter((n) => !TA_VETTED[n].startsWith('math.')).length)
    expect(mathOnly.length).toBeGreaterThan(10)
    // …and every vetted entry carries a REASON, so none can be waved through by
    // being added to the list with an empty string.
    for (const n of vetted) {
      expect(TA_VETTED[n].length, `${n} is vetted with no reason`).toBeGreaterThan(4)
    }
  })

  it('⭐⭐ a SIGN-mismatch door now OPENS too, because the negation was applied', () => {
    // ⚰️⚰️ THIS CASE ASSERTED A REFUSAL FOR MONTHS, AND THE REFUSAL IT ASSERTED
    // CARRIED ITS OWN UNBLOCKER: "cite the Pine reference page that pins the sign,
    // then apply `-` at this door." Pine returns the offset as a NON-POSITIVE
    // number — 0 on this bar, −1 one bar back — where this table returns the
    // POSITIVE distance. So:
    //
    //     ta.highestbars(src, n)  ≡  -highestbars(src, n)
    //
    // ⛔ AND THE THING THAT KEPT IT SHUT WAS A MISREADING, NOT A MISSING NODE.
    // The entry was summarised for weeks as "a negation is not a shift and there
    // is no node for it" — while `u-` sat in the fifteen operators the manifest
    // declares. An actionable refusal is only worth what it costs to RE-READ it.
    for (const [expr, ours, src] of [['ta.highestbars(high, 5)', 'highestbars', 'high'],
                                     ['ta.lowestbars(low, 5)', 'lowestbars', 'low']]) {
      const tree = treeOfOrNull(expr)
      expect(tree, `${expr} should translate now that the negation is applied`).toBeTruthy()
      expect(tree.type, `${expr} must be NEGATED, not the bare call`).toBe('op')
      expect(tree.name).toBe('u-')
      expect(tree.args[0].name).toBe(ours)
      expect(tree.args[0].args[0]).toEqual({ type: 'series', name: src })
    }

    // ⛔ AND THE SIGN IS ASSERTED AS A VALUE, not merely as a `u-` node. A
    // negation applied twice, or applied to the wrong operand, still produces a
    // tree of exactly this shape — only the numbers tell those apart.
    const H = [10, 11, 15, 12, 11, 9, 14, 10]
    const bars = H.map((h, i) => ({ t: 20260801 + i, o: h, h, l: h, c: h, v: 1 }))
    const col = Array.from(interpret(treeOfOrNull('ta.highestbars(high, 3)'), bars))
    expect(col.slice(2)).toEqual([-0, -1, -2, -2, -0, -1])

    // ⭐ THE BARE SPELLING IS UNTOUCHED — in our box it means OUR function, and
    // ours is the positive distance.
    const bare = Array.from(interpret(treeOfOrNull('highestbars(high, 3)'), bars))
    expect(bare.slice(2)).toEqual([0, 1, 2, 2, 0, 1])
  })

  it('⭐⭐ an OFFSET-mismatch door now OPENS, because the shift was applied', () => {
    // ⛔⛔ THIS IS THE REFUSAL BEING ACTED ON, NOT OVERRIDDEN. The ruling it
    // carried was "refuse until somebody cites the Pine reference and APPLIES THAT
    // SHIFT" — an unblocker written down precisely so it could one day be done.
    // Pine returns a pivot at its CONFIRMATION bar, `rightbars` after the pivot,
    // which is why published scripts pair it with `offset=-rightbars`. So:
    //
    //     ta.pivothigh(src, L, R)  ≡  pivothigh(src, L, R)[R]
    //
    // ⭐ AND THE SHIFT DOES MORE THAN RE-INDEX. Stepping back exactly `R` bars
    // nets the child's forward reach to zero, so the translated column is
    // `non-repainting` where the bare call is `preview-repaints` — which is
    // exactly WHY Pine publishes at the confirmation bar. The badge is computed by
    // the reach walk, not awarded here.
    for (const [expr, ours, right] of [['ta.pivothigh(high, 5, 5)', 'pivothigh', 5],
                                       ['ta.pivotlow(low, 3, 2)', 'pivotlow', 2]]) {
      const tree = treeOfOrNull(expr)
      expect(tree, `${expr} should translate now that the shift is applied`).toBeTruthy()
      expect(tree.type, `${expr} must be SHIFTED, not the bare call`).toBe('offset')
      expect(tree.value).toBe(right)
      expect(tree.args[0].type).toBe('call')
      expect(tree.args[0].name).toBe(ours)
      expect(lintRepaint(tree).mode,
        `${expr} cancels its own look-ahead, so it cannot read as repainting`)
        .toBe('non-repainting')
    }

    // ⛔ AND THE BARE SPELLING IS UNTOUCHED — in our box it means OUR function,
    // unshifted, and it still declares the forward reach that implies.
    const bare = treeOfOrNull('pivothigh(high, 5, 5)')
    expect(bare.type).toBe('call')
    expect(lintRepaint(bare).mode).toBe('preview-repaints')
  })

  it('⛔ A BARE table name still RESOLVES — the refusal must not reject its own advice', () => {
    // ⚰️ THE MEASURED REGRESSION. Dropping the `!key` gate to restore
    // `ta.barssince`'s named reason ALSO refused the bare spelling, so
    // `plot(barssince(close > open, 10))` was rejected by a message ending
    // *"Write `barssince(condition, n)`"*. A signpost pointing at a locked door.
    for (const expr of ['barssince(close > open, 10)', 'highestbars(high, 5)',
                        'lowestbars(low, 5)']) {
      expect(treeOfOrNull(expr), `${expr} is OUR vocabulary and must resolve`).toBeTruthy()
    }
    // …while a bare name the table does NOT declare keeps its named reason rather
    // than falling through to the generic "this table declares abs, accum, …" list.
    const r = refusalOf('cum(volume)')
    expect(r).toBeTruthy()
    expect(r.message).toMatch(/running total/i)
    expect(r.message).toMatch(/sum\(source, n\)/)
  })

  it('⛔⛔ …AND A TABLE ENTRY OF THE SAME SPELLING DOES NOT LET ONE THROUGH', () => {
    // ⚰️ THE MEASURED REGRESSION. `barssince` landed in `closedTable.json` on
    // 2026-08-26 as the BOUNDED `barssince(condition, n)`. `PINE_INEXPRESSIBLE`
    // was consulted only when the table had NO such name, so `ta.barssince(cond)`
    // stopped reporting the unbounded reason and started reporting an ARITY
    // message — *"this table takes 2"* — which reads as "just add a number", and
    // the number a member adds silently CAPS a count Pine leaves uncapped.
    //
    // ⭐ THE SUBJECT IS DERIVED: every inexpressible name the table ALSO declares
    // is exercised, so the next collision is covered on the day it lands.
    const collisions = [...Object.keys(PINE_INEXPRESSIBLE)]
      .filter((n) => Object.prototype.hasOwnProperty.call(TABLE.functions, n))
    // NON-VACUITY — a rail about collisions with none to look at proves nothing.
    expect(collisions, 'no inexpressible name collides with the table any more; '
      + 'if that is deliberate, delete this rail rather than letting it pass '
      + 'vacuously').toContain('barssince')

    for (const name of collisions) {
      const spec = TABLE.functions[name]
      // The PINE spelling, with PINE's arity — one argument for `ta.barssince`.
      const r = refusalOf(`ta.${name}(close > open)`)
      expect(r, `ta.${name} resolved instead of refusing`).toBeTruthy()
      expect(r.guard, `ta.${name} refused at the wrong door`).toBe('pine:function')
      expect(r.message, `ta.${name}'s refusal lost its REASON and reports arity`)
        .not.toMatch(/different signature/i)
      // …and the reason names the engine's own bounded entry, so the member is
      // told what to write rather than only what not to.
      expect(r.message).toContain(`${name}(`)
      expect(spec.args.length, `${name} is a collision only while the arities differ`)
        .toBeGreaterThan(1)
    }
  })
})

// ─── ta.cross — the EITHER-direction crossing ────────────────────────────────
//
// `ta.crossover` and `ta.crossunder` already mapped; `ta.cross` did not, and it
// was the single blocker on a real published script in the corpus. The table
// declares both directions, so this costs zero new names — the `roc`/`avg` bar.
describe('ta.cross — either direction, spelled out', () => {
  it('IS the native either-direction tree, by astHash', () => {
    const native = parseFormula('crossOver(sma(close, 9), sma(close, 200))'
      + ' || crossUnder(sma(close, 9), sma(close, 200))')
    expect(native.ok, native.error).toBe(true)
    expect(astHash(treeOf('ta.cross(ta.sma(close, 9), ta.sma(close, 200))')))
      .toBe(astHash(native.ast))
  })

  it('🔴 IS NOT `crossover` ALONE — the near-miss that would answer half the question', () => {
    // ⛔ THE WHOLE REASON THIS IS WRITTEN DOWN. Resolving `ta.cross` to
    // `crossOver` parses, lints, saves and scans; it just silently drops every
    // downward cross. A member screening "the 9 crossed the 200" would get a
    // shorter list with nothing to indicate what was missing from it.
    expect(astHash(treeOf('ta.cross(close, ta.sma(close, 10))')))
      .not.toBe(astHash(treeOf('ta.crossover(close, ta.sma(close, 10))')))
  })

  it('fires on a DOWNWARD cross, which is the half a near-miss would lose', () => {
    // A series that rises, then falls back through its own average. `crossover`
    // alone is 0 on every bar of the fall; `cross` is not.
    const bars = []
    for (let i = 0; i < 30; i++) { const c = 100 + i; bars.push({ o: c, h: c + 1, l: c - 1, c, v: 1000 }) }
    for (let i = 0; i < 30; i++) { const c = 130 - i * 2; bars.push({ o: c, h: c + 1, l: c - 1, c, v: 1000 }) }
    const run = (e) => [...interpret(treeOf(e), bars, {})]
    const both = run('ta.cross(close, ta.sma(close, 10))')
    const up = run('ta.crossover(close, ta.sma(close, 10))')
    expect(both.filter((x) => x === 1).length).toBeGreaterThan(up.filter((x) => x === 1).length)
  })

  it('needs both series — arity refuses before the expansion builds', () => {
    const ref = refusalOf('ta.cross(close)')
    expect(ref && ref.guard).toBe('pine:arity')
    expect(ref.message).toContain('needs both')
  })
})

// ─── A `var` SEEDED `na` THAT NOTHING UPDATES ───────────────────────────────
//
// 🔴 THE WORST OUTCOME AVAILABLE IS NOT A REFUSAL — IT IS A SAVEABLE DEAD
// COLUMN. `accum(0/0, self, n)` never leaves its seed, so every bar is blank;
// it parses, budgets, lints `non-repainting` and clears the save gate. A member
// gets a scan that returns nothing and reads it as a quiet market.
//
// ⚠️ This was unreachable until `ta.cross` landed — the same expression refused
// earlier for the missing function, so the dead accumulator sat behind a louder
// refusal. Closing one gap is what exposed it.
describe('a `var` seeded `na` that nothing updates refuses, rather than going blank', () => {
  const anchored = `//@version=5
indicator("t")
var float acc = na
plot(ta.cross(close, acc) ? 1 : 0)
`

  it('refuses by name at pine:state, naming the variable', () => {
    const r = translatePine(anchored)
    const ref = (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal
    expect(ref, 'something must refuse').toBeTruthy()
    expect(ref.guard).toBe('pine:state')
    expect(ref.message).toContain('acc')
    expect(ref.message).toContain('blank')
  })

  it('⛔ …and the thing it prevents is a column that is NaN on EVERY bar', () => {
    // The proof the refusal is worth having: build the tree the translator would
    // have emitted and run it. Not one bar of 200 carries a value.
    const dead = parseFormula('accum(0 / 0, self, 250)')
    expect(dead.ok, dead.error).toBe(true)
    const bars = Array.from({ length: 200 }, (_, i) => ({ o: 10, h: 11, l: 9, c: 10 + i * 0.1, v: 1000 }))
    const col = [...interpret(dead.ast, bars, {})]
    expect(col.every((x) => x === null || Number.isNaN(x))).toBe(true)
  })

  it('a `var` with a CONSTANT seed is still unwrapped, not refused', () => {
    // ⛔ The guard must be narrow. `var k = 5` is a legitimate constant and was
    // already unwrapped; catching it here would refuse working scripts.
    const r = translatePine(`//@version=5
indicator("t")
var float k = 5
plot(close > k ? 1 : 0)
`)
    expect(r.ok, JSON.stringify((r.outputs || []).map((o) => o.refusal))).toBe(true)
  })

  it('…and a `var` seeded from a SERIES still keeps its accumulator', () => {
    // `var anchor = close` really does mean a bar in the past — it is not dead,
    // and refusing it would be the over-reach this narrowness exists to avoid.
    const r = translatePine(`//@version=5
indicator("t")
var float anchor = close
plot(close > anchor ? 1 : 0)
`)
    expect(r.ok, JSON.stringify((r.outputs || []).map((o) => o.refusal))).toBe(true)
  })
})
