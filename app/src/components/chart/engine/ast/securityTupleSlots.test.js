// app/src/components/chart/engine/ast/securityTupleSlots.test.js
//
// ─── ⭐⭐ R18 — A SECURITY TUPLE IS A PLAN-TIME VECTOR OF SLOTS ──────────────
//
// `[a, b] = request.security(s, tf, [x, y])` is **two slots** — slot 0 is
// `request.security(s, tf, x)`, slot 1 is `request.security(s, tf, y)` — each an
// ordinary call tree. A destructured name folds to its slot's tree. **No tuple node,
// no statement form, no 12th `NODE_TYPES` member.** Mechanism A, exactly as arrays.
//
// ⭐⭐ THE MODEL ALREADY SHIPS FOR THE UDF FORM, which is why R18 is small:
//
//     f() => [high, low]
//     [a, b] = request.security("AAPL", "D", f())
//     plot(a - b)          -> op('-', [sym(AAPL,[high]), sym(AAPL,[low])])
//
// `destructureBindings` binds each name as `{kind:'tuplePart', fn, args, index}` and
// `pine.js` ≈4749 resolves part *k* through `securityAsNode(bound.call)`. R18 adds a
// SECOND ENTRANCE to that same path — never a parallel one.
//
// ⚰️ THE PARSE GAP, MEASURED (2.1): the parser already SEES `[high, low]` in an
// argument and returns `{type:'collection', tok}` — but `pine.js` ≈3556 skips to the
// matching `]` by depth-counting and **discards the elements**, deliberately, so that
// `options=["A","B"]` (which nothing reads) is a note rather than a throw. So the gap
// was never "no array-literal node": the node is a PLACEHOLDER whose contents are
// dropped, which is why there were no parts to take. ⭐ `collection` is a PARSE-tree
// type and is absent from `NODE_TYPES`, so retaining its elements adds no output node.
//
// ⛔ THE `options=` CASE IS THE CONSTRAINT THIS MUST NOT BREAK, and it has its own
// control below: parsing the elements must not make a collection nothing reads start
// refusing.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')

/** ⭐ THREE NAMED CORPUS SCRIPTS THAT ACTUALLY REFUSE `pine:tuple` TODAY, across two
 *  sources — measured, not picked by grep.
 *
 *  ⚰️ v1 of this list was picked by grepping for the FORM and all three were wrong:
 *  one produced zero outputs (nothing read a destructured name) and none of the three
 *  refused `pine:tuple` at all. The non-vacuity control caught it on the first run.
 *
 *  ⚠️ AND THE HUNT FOUND SOMETHING WORTH CARRYING: only **6 scripts** in the whole
 *  corpus refuse `pine:tuple` with this form, against **90** array-literal uses. The
 *  other uses sit in scripts that refuse earlier for their own reasons, or whose
 *  destructured names nothing reads. **90 uses is not 90 refusals**, and the
 *  re-baseline is sized by the 6, not the 90. */
const SPECIMENS = [
  'corpus/committed/smt-divergence-ict-01-tradingfinder-smart-money-technique__3f66e16b3c.pine',
  'corpus/committed/volatility-stop-mtf__K5XG42uHV9.pine',
  'tests/fixtures/pine_oos/long_tail__12-setup-grader.pine',
]

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const tupleRefusals = (t) => (t.refusals || []).filter((r) => r.guard === 'pine:tuple')

/** The two-slot fixture, with both slot trees written out below. */
const TWO_SLOT = 'indicator("x")\n'
  + '[a, b] = request.security("AAPL", "D", [high, low])\n'
  + 'plot(a - b)\n'

/** The same shape through a user function — the path that already works. */
const UDF = 'indicator("x")\nf() =>\n    [high, low]\n'
  + '[a, b] = request.security("AAPL", "D", f())\n'
  + 'plot(a - b)\n'

describe('R18 — a security tuple is a vector of slots', () => {
  it('⛔⛔ NON-VACUITY CONTROL — each specimen really carries the form and reads a name', () => {
    // Without this, "no pine:tuple refusal" passes over a script that never had one.
    for (const rel of SPECIMENS) {
      expect(fs.existsSync(path.join(REPO, rel)), `${rel} is not on disk`).toBe(true)
      const src = read(rel)
      expect(/\[[^\]]+\]\s*=\s*(request\.)?security\s*\(/.test(src),
        `${rel} does not carry the array-literal destructure form`).toBe(true)
      const t = translatePine(src, {})
      expect((t.outputs || []).length,
        `${rel} produces no outputs, so nothing reads a destructured name`)
        .toBeGreaterThan(0)
    }
    // …and the fixture must currently be REFUSED, or there is nothing to fix.
    expect(tupleRefusals(translatePine(TWO_SLOT, {})).length
      + tupleRefusals(translatePine(TWO_SLOT, { strict: true })).length,
    'the two-slot fixture already translates — this rail asserts nothing')
      .toBeGreaterThan(0)
  })

  it.fails('⭐⭐ THE SLOT TREES, WRITTEN OUT — `[a,b] = security(S,D,[high,low])`', () => {
    // slot 0 : sym('AAPL', [ series high ])
    // slot 1 : sym('AAPL', [ series low  ])
    // plot   : op('-', [ slot0, slot1 ])
    const t = translatePine(TWO_SLOT, {})
    expect(tupleRefusals(t)).toEqual([])
    const ast = (t.outputs || [])[0] && t.outputs[0].ast
    expect(ast, 'no output tree at all').toBeTruthy()
    expect(ast.type).toBe('op')
    expect(ast.name).toBe('-')
    const [slot0, slot1] = ast.args
    expect(slot0).toMatchObject({ type: 'sym', value: 'AAPL' })
    expect(slot0.args[0]).toMatchObject({ type: 'series', name: 'high' })
    expect(slot1).toMatchObject({ type: 'sym', value: 'AAPL' })
    expect(slot1.args[0]).toMatchObject({ type: 'series', name: 'low' })
  })

  it.fails('⭐⭐ the three named corpus specimens stop refusing `pine:tuple`', () => {
    for (const rel of SPECIMENS) {
      const t = translatePine(read(rel), {})
      expect(tupleRefusals(t).map((r) => `${r.guard}@${r.line}`),
        `${rel} still refuses its security tuple`).toEqual([])
    }
  })

  it.fails('⛔ an element that READS A SIBLING is refused by name — a guard, not a fix', () => {
    // ⚰️ MEASURED: the corpus contains ZERO of these. The census reported one and it
    // was a false positive — `\blog\b` matching `math.log(...)`, a method name. So
    // this is a guard against a shape that genuinely cannot expand (the elements are
    // independent calls; one cannot read another's result), tested with a SYNTHETIC
    // fixture because no corpus script exercises it.
    const src = 'indicator("x")\n[p, q] = request.security("AAPL", "D", [close, p + 1])\nplot(p + q)\n'
    const t = translatePine(src, {})
    const r = (t.refusals || []).find((x) => x.guard === 'pine:tuple')
    expect(r, 'an element reading a sibling must refuse by name').toBeTruthy()
    expect(String(r.message)).toMatch(/sibling|another element|independent/)
  })

  // ── CONTROLS: what R18 must not move.

  it('⛔⛔ CONTROL — the UDF-returning path is BYTE-IDENTICAL', () => {
    // R18 adds a second entrance to one path. If this tree moves, it built a
    // parallel path instead.
    const t = translatePine(UDF, {})
    expect((t.refusals || []).length).toBe(0)
    expect(JSON.stringify(t.outputs[0].ast)).toBe(JSON.stringify({
      type: 'op',
      name: '-',
      args: [
        { type: 'sym', value: 'AAPL', args: [{ type: 'series', name: 'high' }] },
        { type: 'sym', value: 'AAPL', args: [{ type: 'series', name: 'low' }] },
      ],
    }))
  })

  it('⛔⛔ CONTROL — `options=[…]`, which nothing reads, still does NOT refuse', () => {
    // ⚰️ This is the exact reason `pine.js` ≈3556 discards collection elements today:
    // *"throwing here made the one collection literal every published script carries
    // — `input(…, options=["A","B"])` — refuse the whole script from a line no column
    // depends on."* Parsing the elements must not resurrect that.
    const t = translatePine(
      'indicator("x")\nm = input.string("A", "Mode", options = ["A", "B"])\n'
      + 'plot(m == "A" ? close : 0)\n', {})
    expect((t.refusals || []).filter((r) => r.guard === 'pine:collection')).toEqual([])
    expect((t.outputs || []).length).toBeGreaterThan(0)
  })
})
