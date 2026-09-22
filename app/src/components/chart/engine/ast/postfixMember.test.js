// app/src/components/chart/engine/ast/postfixMember.test.js
//
// ─── ⭐⭐ A MEMBER READ ON THE RESULT OF AN EXPRESSION ───────────────────────
//
// Pine allows a member access or a method call on ANY expression, not only on a
// name. This engine's lexer accepted `.` ONLY between two idents, so every one
// of these was refused `pine:character` — "Pine has no character like this one"
// — about a dot the author wrote correctly:
//
//     array.get(levelGlow1Lines, i).set_x2(bar_index)
//     htfFVGs.first().area.delete()
//     k._box.pop().delete()
//     (l[1]).delete()
//     Candle.new().create()
//
// Measured over `corpus/committed`: 23 of 266 scripts, the largest single row
// in the object-lane census and every one of them THIS construct — read from
// `objectLaneCallSites.measure.test.js`, not inferred from the count. That
// distinction is the file's own reason for existing: this repo has sized three
// rows wrong by trusting a number instead of opening the sites.
//
// ⛔⛔ AND THE LEXER FIX ALONE WOULD HAVE SHIPPED A WRONG DRAWING. Two readers
// in this engine recognise a statement by its FIRST token and then take the
// first `(` as the whole call — so `box.new(…).delete()` emitted the create and
// dropped the delete, and `x = array.new_float(1).size()` registered a plan-time
// vector that crashed on first read. A box that stays on a member's chart
// forever, drawn by a line their script says to remove, is worse than a refusal.
// Section D is that rail and it is the load-bearing one in this file.
import { describe, it, expect } from 'vitest'
import { lexPine, parseWholeExpression, translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { buildObjectLane } from '../runtime/objectLane.js'

const H5 = '//@version=5\nindicator("t", overlay=true)\n'
const H6 = '//@version=6\nindicator("t")\n'
const BARS = Array.from({ length: 30 }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))

/** A parse tree with the token objects dropped, so two spellings can be compared. */
const shape = (n) => JSON.stringify(n, (k, v) => (k === 'tok' || k === 'endTok' ? undefined : v))
const parse = (src) => parseWholeExpression(lexPine(src).tokens)
const lane = (body, header = H5) => buildObjectLane(header + body, { bars: BARS, tf: 'D', newestBarIsForming: false })
const opsOf = (r) => (r.ok ? (r.objects.ops || []).map((o) => o.k) : null)

// --------------------------------------------------------------------------- //
// A — the lexer
// --------------------------------------------------------------------------- //

describe('⭐⭐ A — a postfix `.` lexes where a VALUE has just closed', () => {
  it('a member call on a call result is tokens, not a refused character', () => {
    const toks = lexPine('array.new_float(1).size()').tokens
    expect(toks.map((t) => t.value))
      .toEqual(['array.new_float', '(', 1, ')', '.', 'size', '(', ')'])
  })

  it('a member call on a `]` lexes too — `(l[1]).delete()`', () => {
    const toks = lexPine('(l[1]).delete()').tokens
    expect(toks.map((t) => t.value))
      .toEqual(['(', 'l', '[', 1, ']', ')', '.', 'delete', '(', ')'])
  })

  it('⛔ THE SEGMENT IS SINGLE, NEVER DOTTED — a chain stays a chain', () => {
    // ⭐ `f().area.delete()` must lex as `. area . delete`, not `. area.delete`.
    // The receiver of `delete` is the FIELD; one glued name loses that seam and
    // addresses the wrong object with no error anywhere.
    const toks = lexPine('f().area.delete()').tokens
    expect(toks.map((t) => t.value))
      .toEqual(['f', '(', ')', '.', 'area', '.', 'delete', '(', ')'])
  })

  it('⛔⛔ A NEWLINE STILL NEVER JOINS ONE — the direction that invents a name', () => {
    // The rule `lexerGaps.test.js` pays for. Here `x` is a complete statement
    // and `.foo` begins another; joining them would produce a dotted name the
    // author never wrote. It must still fail AT THE DOT.
    const r = buildRuntimeIr(`${H6}x = close\nx\n.foo\nplot(close)`, { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:character')
    expect(r.refusal.token).toBe('.')
  })

  it('⛔ CONTROL — a `.` after a `)` on the NEXT line is still refused', () => {
    // ⭐ The same rule, in the shape this capability could have broken it: the
    // dot is admitted only where a value closed on THIS line. Without the line
    // test, a continuation would glue two statements together.
    expect(() => lexPine('f()\n.size()')).toThrow(/character/)
  })

  it('⛔ CONTROL — `math .max` is STILL one name and the SAME program', () => {
    // 20 of 266 scripts carry a spaced dot. The ident rule runs first and
    // consumes it; this rail fails if the postfix rule ever gets there first.
    const spaced = buildRuntimeIr(`${H6}x = math .max(1, 2)\nplot(close + x)`, { bars: BARS, inputs: {} })
    const tight = buildRuntimeIr(`${H6}x = math.max(1, 2)\nplot(close + x)`, { bars: BARS, inputs: {} })
    expect(tight.ok).toBe(true)
    expect(spaced.ok).toBe(true)
    expect(spaced.diagnostics.statements).toBe(tight.diagnostics.statements)
  })
})

// --------------------------------------------------------------------------- //
// B — the parser
// --------------------------------------------------------------------------- //

describe('⭐⭐ B — a NAME receiver is the dotted name itself, not a second shape', () => {
  it('`(a).size()` is THE SAME TREE as `a.size()`', () => {
    // ⭐ Not "both are accepted" — the same program. `lexerGaps.test.js` holds
    // the spaced dot to exactly this standard, and for the same reason: one
    // construct with two representations hands every downstream reader a choice
    // it has no way to make correctly.
    expect(shape(parse('(a).size()'))).toBe(shape(parse('a.size()')))
  })

  it('`(a).size` is THE SAME TREE as `a.size` — the field form too', () => {
    expect(shape(parse('(a).size'))).toBe(shape(parse('a.size')))
  })

  it('and it survives arguments computed from series data', () => {
    // ⛔ RULE 5. A literal-only fixture folds to a constant and leaves the
    // argument path unrailed. These arguments cannot fold.
    expect(shape(parse('(a).set_x2(close > 0 ? bar_index : bar_index - 1)')))
      .toBe(shape(parse('a.set_x2(close > 0 ? bar_index : bar_index - 1)')))
  })

  it('⛔ CONTROL — a NON-name receiver keeps the receiver as a SUBTREE', () => {
    // There is no dotted spelling for `f().m` — no name to append to — so the
    // desugar above must NOT fire here. Without this the previous three cases
    // would pass with a rule that folded everything into a string.
    const n = parse('array.new_float(1).size()')
    expect(n.type).toBe('method')
    expect(n.recv.type).toBe('call')
    expect(n.recv.name).toBe('array.new_float')
    expect(n.name).toBe('size')
  })

  it('an index receiver parses — `(l[1]).delete()`', () => {
    const n = parse('(l[1]).delete()')
    expect(n.type).toBe('method')
    expect(n.recv.type).toBe('offset')
    expect(n.name).toBe('delete')
  })

  it('a chain nests, field then method', () => {
    const n = parse('f().a.b()')
    expect(n.type).toBe('method')
    expect(n.name).toBe('b')
    expect(n.recv.type).toBe('member')
    expect(n.recv.name).toBe('a')
    expect(n.recv.recv.type).toBe('call')
  })

  it('a postfix method takes NAMED arguments, as the corpus writes them', () => {
    // `Marker.new().set(name = name, left = left, …)` — volume-profile-plus L306.
    const n = parse('Marker.new().set(name = sym, left = bar_index)')
    expect(n.type).toBe('method')
    expect(n.args.map((a) => a.name)).toEqual(['name', 'left'])
  })
})

// --------------------------------------------------------------------------- //
// C — the refusal says WHERE, in BOTH lanes
// --------------------------------------------------------------------------- //

describe('⭐ C — an unlowerable postfix refuses BY NAME and WITH A POSITION', () => {
  const SRC = `${H6}plot(close + array.new_float(1, 5.0).size())`

  it('the host lane names the member and points at it', () => {
    const t = translatePine(SRC, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:member')
    expect(t.refusal.line).toBe(3)
    expect(t.refusal.column).toBeGreaterThan(0)
    expect(t.refusal.message).toContain('`.size`')
  })

  it('⭐ and the RUNTIME lane answers alike — same guard, same line', () => {
    // A refusal whose wording depends on which lane reached it first is the
    // one-value-two-authorities trade this engine refuses elsewhere.
    const r = buildRuntimeIr(SRC, { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:member')
    expect(r.refusal.line).toBe(3)
  })

  it('⛔⛔ AND A BINDING NO LONGER CRASHES INTO A POSITIONLESS REFUSAL', () => {
    // ⚰️ `x = array.new_float(1).size()` was read as a plan-time VECTOR — the
    // recogniser took "everything to the last token" as the creation's
    // arguments — so the binding had no node and the first read of `x` threw a
    // TypeError, arriving as `pine:statement` with line AND column NULL. That
    // is the defect `lexerGaps.test.js`'s header calls the expensive half.
    const t = translatePine(`${H6}x = array.new_float(1, 5.0).size()\nplot(close + x)`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:member')
    expect(t.refusal.line).toBe(3)
    expect(t.refusal.message).not.toMatch(/Cannot read properties/)
  })

  it('⛔ CONTROL — a plain creation STILL registers as a vector', () => {
    // The span guard must refuse only a creation that is NOT the whole
    // right-hand side. Without this control the guard could be `return null`
    // and every case above would still pass.
    const t = translatePine(`${H6}var x = array.new_float(2, 5.0)\nplot(close)`, { strict: true })
    const codes = (t.notes || []).map((n) => n.code)
    expect(codes).toContain('pine:vector')
  })
})

// --------------------------------------------------------------------------- //
// D — THE WRONG DRAWING (the load-bearing rail)
// --------------------------------------------------------------------------- //

describe('⛔⛔ D — a postfix statement is never HALF-read into a wrong drawing', () => {
  // Every coordinate here is series data, so nothing folds to a constant.
  const BOX = 'box.new(bar_index - 2, high, bar_index, low)'

  it('⛔ CONTROL — the create ALONE draws, so the case below is not vacuous', () => {
    const r = lane(`if close > open\n    ${BOX}\nplot(close)`)
    expect(r.ok).toBe(true)
    expect(opsOf(r)).toEqual(['create'])
  })

  it('⛔⛔ `box.new(…).delete()` MUST NOT emit a lone create', () => {
    // ⚰️ It did. The object pass read the statement as `box.new(…)`, emitted
    // the create, and the `.delete()` vanished without a word — a box drawn by
    // a line the script says to remove, on a member's chart, forever.
    const r = lane(`if close > open\n    ${BOX}.delete()\nplot(close)`)
    expect(opsOf(r)).not.toEqual(['create'])
  })

  it('⛔ CONTROL — the NAME form still emits BOTH ops', () => {
    // Proves the guard above refuses only the half-read statement, and has not
    // simply broken every delete.
    const r = lane(`if close > open\n    b = ${BOX}\n    box.delete(b)\nplot(close)`)
    expect(r.ok).toBe(true)
    expect(opsOf(r)).toContain('create')
    expect(opsOf(r)).toContain('delete')
  })

  it('a bound postfix create is not half-read either', () => {
    const r = lane(`if close > open\n    b = ${BOX}.delete()\nplot(close)`)
    expect(opsOf(r)).not.toEqual(['create'])
  })
})

// --------------------------------------------------------------------------- //
// E — the lowering
// --------------------------------------------------------------------------- //

describe('⭐⭐ E — a postfix method on a collection read LOWERS to its op', () => {
  // ⛔⛔ ASSERTED ON THE OBJECT PASS, NOT ON `buildObjectLane`, AND THE REASON
  // IS THE FINDING ITSELF. A drawing ARRAY is refused by the runtime lane at
  // creation (`pine:drawing` — `array.new_line` makes an array OF drawings),
  // so no collection-based script can draw end to end today whichever spelling
  // it uses. The object pass is the layer this lowering is IN; asserting
  // through a lane with a second, unrelated blocker would test that blocker.
  // The lane-level product number is reported by `objectLaneCensus`, honestly.
  //
  // ⛔ RULE 5 — the index is computed from series data. `array.get(ls, 0)` folds
  // to a constant and leaves the index-binding path completely unrailed; this
  // one has to survive as a tree.
  const IDX = 'close > open ? 0 : 1'
  const MK = 'var line[] ls = array.new_line()\nif barstate.islast\n'
    + '    l = line.new(bar_index - 2, low, bar_index, high)\n'
    + '    array.push(ls, l)\n'
  const pass = (body) => translatePine(H5 + MK + body, {
    strict: true, objects: true, objectRawTrees: true, objectIterTrees: true,
  })
  const kinds = (t) => ((t.objects && t.objects.ops) || []).map((o) => o.k)

  it('`array.get(ls, <computed>).set_x2(bar_index)` emits an UPDATE', () => {
    const t = pass(`    array.get(ls, ${IDX}).set_x2(bar_index)\nplot(close)`)
    expect(kinds(t)).toContain('update')
  })

  it('and `.delete()` on the same receiver emits a DELETE', () => {
    const t = pass(`    array.get(ls, ${IDX}).delete()\nplot(close)`)
    expect(kinds(t)).toContain('delete')
  })

  it('⭐⭐ THE SAME PROGRAM as the name form — byte for byte', () => {
    // ⛔ `line.set_x2(l, n)` and `<expr>.set_x2(n)` are ONE Pine operation
    // written two ways. Emitting them from two code paths would put a second
    // opinion on which methods are deletes and which property each setter
    // writes; `emitMethodOn` is the one place, and this is what says so.
    const post = pass(`    array.get(ls, ${IDX}).set_x2(bar_index)\nplot(close)`)
    const name = pass(`    line.set_x2(array.get(ls, ${IDX}), bar_index)\nplot(close)`)
    expect(JSON.stringify(post.objects.ops)).toBe(JSON.stringify(name.objects.ops))
  })

  it('⛔ AND THE COMPUTED INDEX SURVIVES AS A TREE, not a folded constant', () => {
    // Rule 5's other half: a target whose index folded to `{v:'const'}` would
    // address the same line on every bar, which is a wrong drawing rather than
    // a missing one — and every assertion above would still pass.
    const t = pass(`    array.get(ls, ${IDX}).set_x2(bar_index)\nplot(close)`)
    const up = t.objects.ops.find((o) => o.k === 'update')
    expect(up.target.r).toBe('coll')
    expect(up.target.index.v).toBe('tree')
  })

  it('⛔ CONTROL — a receiver this pass cannot address emits NOTHING, and COUNTS it', () => {
    // `box.new(…)` is not a collection read, so there is no target to address.
    // It must be dropped and counted, never guessed at — the control that keeps
    // the cases above from passing under a rule that emits for anything.
    const t = pass('    box.new(bar_index - 2, high, bar_index, low).set_bgcolor(color.red)\nplot(close)')
    expect(kinds(t)).not.toContain('update')
    expect(t.objectDiagnostics.unsupported).toContain('box.new')
  })

  it('⛔ CONTROL — a GETTER is recorded as a getter, never lowered', () => {
    // A getter reads runtime object state back into a VALUE, which the object
    // program has no node for. The postfix spelling must not be a back door.
    const t = pass(`    array.get(ls, ${IDX}).get_x1()\nplot(close)`)
    expect(kinds(t)).not.toContain('update')
    expect(t.objectDiagnostics.getters).toContain('line.get_x1')
  })

  it('⛔ CONTROL — a chained FIELD is not lowered as a method on its receiver', () => {
    // `array.get(ls, i).area.delete()` deletes the FIELD, not the line. The
    // receiver of `delete` is a `member` node this pass cannot address, so it
    // must emit nothing — never a delete aimed at the collection element.
    const t = pass(`    array.get(ls, ${IDX}).area.delete()\nplot(close)`)
    expect(kinds(t)).not.toContain('delete')
  })
})
