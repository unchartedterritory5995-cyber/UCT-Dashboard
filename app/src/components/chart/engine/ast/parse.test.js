import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ⚠️ `./parse.js` FIRST, AND THE ORDER IS LOAD-BEARING. `jsep` is a SINGLETON
// and `parse.js` reconfigures it at module scope; importing the raw module
// before it would still be fine (ESM evaluates the graph before any test body
// runs) but the order says out loud which module owns that configuration.
import {
  parseFormula, canonicalise, astHash, sha256Hex, assertCanonical,
  TABLE, NODE_TYPES, REFUSALS, TableRefusal,
} from './parse.js'
import jsep from 'jsep'

/** The repo root, found by walking up. `import.meta.url` is an http: URL under
 *  this environment's vite transform, and `process.cwd()` is `app/` for the
 *  documented runner and the repo root for some editors — walking finds both and
 *  THROWS BY NAME if neither, because a helper that returns a default here would
 *  make every fixture-driven case below silently read nothing. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`ast/parse.test: could not find the repo root from ${process.cwd()}`)
})()

const PKG = path.join(ROOT, 'app', 'package.json')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

const CORPUS = readJson('tests/fixtures/ast/corpus.json')
const ESCAPES = readJson('tests/fixtures/ast/escapes.json')

/** Does the CONFIGURED parser accept this source? Measured, never declared. */
const parses = (source) => { try { jsep(source); return true } catch { return false } }

/** Every key that appears anywhere in a tree. */
const keysIn = (root) => {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (Array.isArray(n)) { stack.push(...n); continue }
    if (!n || typeof n !== 'object') continue
    for (const k of Object.keys(n)) seen.add(k)
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v)
  }
  return seen
}

const typesIn = (root) => {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (Array.isArray(n)) { stack.push(...n); continue }
    if (!n || typeof n !== 'object') continue
    if (typeof n.type === 'string') seen.add(n.type)
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v)
  }
  return seen
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the persisted tree is the contract, and it is jsep-independent', () => {
  it('the AST is jsep-INDEPENDENT after canonicalisation', () => {
    // ⭐ THIS IS THE WHOLE REASON `canonicalise` EXISTS. `compute.ast` is the
    // PERSISTED artifact — it goes into a database, over a wire, and into a
    // Python tree walker that has never heard of jsep. A stored tree carrying
    // jsep's own node shapes would make a jsep upgrade a data migration.
    const { ast } = parseFormula('sma(close, 20)')
    expect([...keysIn(ast)].sort()).toEqual(['args', 'name', 'type', 'value'])
  })

  it('the canonical node-type set is EXACTLY four, over every corpus case', () => {
    // ⛔ ASSERTED BY WALKING PARSED TREES, NOT BY READING `NODE_TYPES` BACK. A
    // test that reads the constant it is checking measures a re-typed copy —
    // this branch has already shipped a control that compared a hand-copy to a
    // hand-copy. Seventeen real sources are walked instead.
    const seen = new Set()
    const keys = new Set()
    for (const c of CORPUS.cases) {
      const res = parseFormula(c.source)
      expect(res.ok, `${c.id}: ${c.source} — ${res.error}`).toBe(true)
      for (const t of typesIn(res.ast)) seen.add(t)
      for (const k of keysIn(res.ast)) keys.add(k)
    }
    expect([...seen].sort()).toEqual([...NODE_TYPES].sort())
    expect([...keys].sort()).toEqual(['args', 'name', 'type', 'value'])
  })

  // ⭐⭐ THE RAIL TASK 2 DECLARED ITSELF BLIND TO, AND HANDED HERE BY NAME.
  // Every `ast` in `corpus.json` is HAND-WRITTEN — deliberately, because a
  // corpus generated from the thing it measures is not an oracle — which makes
  // that file blind to a `parse(source) !== ast` fork. Two lanes could agree
  // perfectly on a tree that is not what the user typed. This is the only place
  // the SOURCE and the TREE are ever compared.
  it('canonicalise(parse(source)) deep-equals the hand-written tree, for all 17 cases', () => {
    expect(CORPUS.cases.length, 'the corpus shrank; a round-trip over fewer cases proves less')
      .toBeGreaterThanOrEqual(17)
    const mismatches = []
    for (const c of CORPUS.cases) {
      const res = parseFormula(c.source)
      if (!res.ok) { mismatches.push(`${c.id}: REFUSED — ${res.error}`); continue }
      if (JSON.stringify(res.ast) !== JSON.stringify(c.ast)) {
        mismatches.push(`${c.id}: parsed ${JSON.stringify(res.ast)} != declared ${JSON.stringify(c.ast)}`)
      }
    }
    expect(mismatches, 'the parser and the committed corpus disagree about what a source means')
      .toEqual([])
  })

  it('the SOURCE spells unary minus `-` and the ternary `? :`; the TREE spells them `u-` and `?:`', () => {
    // The one place the two vocabularies are allowed to differ, pinned so the
    // difference stays the canonicaliser's job and never leaks into the table.
    expect(parseFormula('-change(close)').ast.name).toBe('u-')
    expect(parseFormula('close > open ? high : low').ast.name).toBe('?:')
    expect(parseFormula('close - open').ast.name).toBe('-')
  })

  it('`true` and `false` are 1 and 0 — the table has no boolean node type', () => {
    // NOT AN INVENTION: the manifest declares `!`, `&&`, `||` and `?:` over a
    // table whose only literal is a number, so a condition is a 0/1 column by
    // construction. Both lane walkers must agree, so it is pinned here rather
    // than assumed twice.
    expect(parseFormula('true').ast).toEqual({ type: 'num', value: 1 })
    expect(parseFormula('false').ast).toEqual({ type: 'num', value: 0 })
  })
})

describe('the table is closed at the parse boundary', () => {
  // ⛔ EVERY jsep FEATURE THIS TABLE DOES NOT USE IS REMOVED AT CONFIGURE TIME.
  // Not blocked at interpret time — REMOVED, so it cannot parse. This case
  // asserts the ABSENCE ITSELF by reading the parser's own operator tables,
  // because "it returns an error" is satisfied by a blocklist too, and a
  // blocklist is a list of what somebody remembered.
  it('the parser carries ONLY the table\'s operators — the rest are REMOVED, not blocked', () => {
    const declaredBinary = Object.entries(TABLE.operators)
      .filter(([, s]) => s.arity === 2).map(([op]) => op).sort()

    // ⛔⛔ READ `jsep.Jsep.*`, NEVER `jsep.*`, AND THIS IS A MEASURED TRAP RATHER
    // THAN A STYLE NOTE. jsep's ESM build copies the class's static properties
    // ONTO the default-export function ONCE at module init
    // (`Object.getOwnPropertyNames(Jsep).forEach(m => jsep[m] = Jsep[m])`), and
    // `removeAllBinaryOps()` REPLACES `Jsep.binary_ops` with a fresh `{}`. So
    // `jsep.binary_ops` goes on answering with all twenty-three DEFAULTS for the
    // life of the process while the parser it describes has twelve. A control
    // that reads it is reading a photograph of a table that no longer exists.
    // The negative control at the bottom of this case is what pins that.
    const live = jsep.Jsep

    expect(Object.keys(live.binary_ops).sort(),
      'jsep ships **, %, &, |, ^, <<, >>, >>>, ??, === and !== by default. If any of ' +
      'them is here, a user formula can reach a walker that has no case for it.',
    ).toEqual(declaredBinary)

    expect(Object.keys(live.unary_ops).sort(),
      'jsep ships ~ and unary + by default; neither has a meaning in a column formula',
    ).toEqual(['!', '-'])

    expect(Object.keys(live.literals).sort(),
      'jsep ships `null` by default and the table has no null',
    ).toEqual(['false', 'true'])

    // …and the behaviour, so the two halves cannot drift apart.
    //
    // ⚠️ ASSERTED AGAINST `jsep` DIRECTLY, NOT THROUGH `parseFormula`. The claim
    // is that these do not PARSE — going through `parseFormula` would also be
    // satisfied by a canonicaliser that refused them afterwards, which is the
    // blocklist this case exists to rule out. It also decouples the case from
    // `parseFormula`'s error handling: measured, routing it through the door
    // made this test die under the unrelated "parseFormula throws" mutation too.
    for (const src of ['2 ** 3', '5 % 2', '1 & 2', '1 | 2', '1 ^ 2', '1 >>> 2',
      '1 << 2', 'close ?? open', 'close === open', '~close']) {
      expect(() => jsep(src), `${src} must not PARSE at all`).toThrow()
    }

    // ⚠️ `null` IS THE ONE THAT DOES NOT FAIL HERE, AND SAYING SO IS THE POINT.
    // Removing a LITERAL does not make the word unparseable — it makes it an
    // ordinary identifier, so `null` lands in exactly the lane `globalThis` and
    // `toString` land in and is refused by `resolve:name` (Task 6), not by this
    // boundary. Written down because "we removed it" and "it cannot parse" are
    // different claims for literals and identical claims for operators.
    expect(parseFormula('null')).toEqual({ ok: true, ast: { type: 'series', name: 'null' } })

    // ⚠️ THE NEGATIVE CONTROL FOR THE TRAP ABOVE. `jsep.binary_ops` — the stale
    // copy — must STILL carry `**`, because that is the whole reason this case
    // reads `jsep.Jsep` instead. If jsep ever fixes the aliasing this line goes
    // red and somebody re-reads the comment rather than inheriting a control
    // that quietly started measuring the right thing for the wrong reason. It
    // can only move on a deliberate version bump, which is what the exact pin is
    // for.
    expect(jsep.binary_ops['**'],
      'the stale default-export copy no longer shadows the live table; re-read this case',
    ).toBe(11)
    expect(live.binary_ops['**']).toBeUndefined()
  })

  it('every precedence the table needs is declared, and none that it does not', () => {
    // `jsep.addBinaryOp(op, undefined)` does not fail — it registers a broken
    // binding power and misparses. `parse.js` throws by name at load rather than
    // shipping that; this is the case that proves the two lists agree today.
    const declaredBinary = Object.entries(TABLE.operators)
      .filter(([, s]) => s.arity === 2).map(([op]) => op).sort()
    const registered = Object.entries(jsep.Jsep.binary_ops)
    expect(registered.every(([, bp]) => typeof bp === 'number' && bp > 0)).toBe(true)
    expect(registered.map(([op]) => op).sort()).toEqual(declaredBinary)
  })

  // ⭐ DRIVEN BY `escapes.json`, NEVER BY A LIST RE-TYPED HERE. The corpus is
  // the census's subject; a second copy of it in this file could agree with
  // itself while disagreeing with the thing Task 6 must drive to zero.
  it('every canonicalise:* escape is refused BY ITS DECLARED GUARD, with its declared fragment', () => {
    const cases = ESCAPES.cases.filter(c => String(c.guard).startsWith('canonicalise:'))
    expect(cases.length, 'the escape corpus lost its canonicalise cases').toBeGreaterThanOrEqual(7)

    const problems = []
    for (const c of cases) {
      if (!parses(c.source)) continue          // PARSER_REFUSED — measured below
      let err = null
      try { canonicalise(jsep(c.source)) } catch (e) { err = e }
      if (!err) { problems.push(`${c.id}: canonicalise ACCEPTED ${JSON.stringify(c.source)}`); continue }
      if (!(err instanceof TableRefusal)) { problems.push(`${c.id}: threw ${err.name}, not a TableRefusal`); continue }
      if (err.guard !== c.guard) { problems.push(`${c.id}: guard ${err.guard} != declared ${c.guard}`); continue }
      if (!err.message.includes(c.refuse)) {
        problems.push(`${c.id}: message ${JSON.stringify(err.message)} does not carry ${JSON.stringify(c.refuse)}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('a tree carrying SEVERAL offences reports one by a DECLARED order, not by traversal', () => {
    // `[1, 2][0]` is a MemberExpression whose object is an ArrayExpression. Task
    // 2 wrote that ambiguity down as an open question on the `array_literal`
    // case — "whichever guard Task 3's canonicaliser reaches first decides the
    // message". It does not: the scan collects every offence and picks by a
    // frozen priority, so the message cannot move when the walker is refactored.
    let err = null
    try { canonicalise(jsep('[1, 2][0]')) } catch (e) { err = e }
    expect(err?.guard).toBe('canonicalise:array')
    let err2 = null
    try { canonicalise(jsep('close["constructor"]')) } catch (e) { err2 = e }
    expect(err2?.guard).toBe('canonicalise:member')
  })

  it('the refusal messages are pairwise DISJOINT — no fragment is a substring of another', () => {
    // C Task 9 measured `raises(match=…)` STILL MATCHING with a safety deleted,
    // because two different gates shared a phrase. Ten guards, ten sentences,
    // and none contained in another.
    const values = Object.values(REFUSALS)
    const overlaps = []
    for (const a of values) {
      for (const b of values) if (a !== b && b.includes(a)) overlaps.push(`${JSON.stringify(a)} ⊂ ${JSON.stringify(b)}`)
    }
    expect(overlaps).toEqual([])
    expect(new Set(values).size).toBe(values.length)
  })

  it('an undeclared operator reaching canonicalise is refused, not passed through', () => {
    // Unreachable while `configureParser` holds — the case above is what asserts
    // that it holds. Exercised DIRECTLY so the belt is a tested belt rather than
    // a comment: a hand-built jsep node is exactly what a reconfigured parser
    // (or a future plugin) would hand this function.
    const node = {
      type: 'BinaryExpression', operator: '**',
      left: { type: 'Literal', value: 2, raw: '2' },
      right: { type: 'Literal', value: 3, raw: '3' },
    }
    expect(() => canonicalise(node)).toThrow(REFUSALS['canonicalise:operator'])
  })
})

describe('what the PARSER itself refuses — the measurement Task 2 handed forward', () => {
  // ⭐⭐ `parses` IN `escapes.json` WAS A DECLARATION; THIS MAKES IT A
  // MEASUREMENT. Task 2 set every case `parses: true` as the conservative
  // direction and wrote: "if Task 3's configured jsep refuses one of them
  // outright it moves to PARSER_REFUSED and the escape total goes DOWN, never
  // up." One did.
  it('every `parses` declaration in the escape corpus matches the configured parser', () => {
    const wrong = []
    for (const c of ESCAPES.cases) {
      if (!c.source || c.source.includes('...')) continue   // `too_many_nodes` is a prose sketch
      const measured = parses(c.source)
      if (measured !== c.parses) {
        wrong.push(`${c.id}: declares parses=${c.parses}, measured ${measured}`)
      }
    }
    expect(wrong, 'a `parses` declaration disagrees with the parser this task configured. ' +
      'Correct the FIXTURE — the census counts a case it never offered as an escape.').toEqual([])
  })

  it('jsep core has NO assignment operator — `x = 1` is PARSER_REFUSED', () => {
    // The correction, on its own line so it cannot be lost in a loop: the escape
    // census goes 16 -> 15 and that is a correction, not a regression. Asserted
    // against `jsep` DIRECTLY, so it stays true regardless of what
    // `parseFormula` does with a throw.
    expect(() => jsep('x = 1')).toThrow(/unexpected/i)
    expect(ESCAPES.cases.find(c => c.id === 'assignment').parses).toBe(false)
  })

  it('a name the table never declared still PARSES — `resolve:name` is not this task\'s guard', () => {
    // ⛔ DELIBERATE, AND IT IS THE HALF THAT KEEPS THE CENSUS HONEST. Refusing
    // an unknown identifier here would move `globalThis`, `toString` and
    // `hasOwnProperty` out from under `resolve:name` — the guard Task 6 has to
    // drive to zero — and its first zero would then mean less than it looks.
    for (const src of ['globalThis', 'toString', 'hasOwnProperty']) {
      expect(parseFormula(src)).toEqual({ ok: true, ast: { type: 'series', name: src } })
    }
    expect(parseFormula('rugpull(close, 3)').ok).toBe(true)
  })
})

describe('parseFormula is a door, not a cliff', () => {
  it('parseFormula RETURNS a failure; it does not throw', () => {
    // ⛔ A THROW FROM A PARSER REACHES THE BUILDER AS A BLANK SCREEN. The spec's
    // instance-state inventory has ten states and none of them is "the page
    // died"; state 4 is a red dot on the chip with the message in the tooltip.
    // And a parse failure is the NORMAL case here, not the exceptional one — the
    // whole surface is a text box a user is mid-way through typing into.
    const res = parseFormula('sma(close,')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unexpected|expected/i)
  })

  it('every half-typed prefix of a real formula returns a result object', () => {
    // The non-vacuity half: one source proves the happy path of the catch. A
    // user types a character at a time, so every prefix is a real input.
    const full = 'sma(close, 20) > ema(close, 50)'
    for (let i = 1; i <= full.length; i++) {
      const res = parseFormula(full.slice(0, i))
      expect(typeof res.ok, `prefix ${JSON.stringify(full.slice(0, i))}`).toBe('boolean')
      if (!res.ok) expect(typeof res.error).toBe('string')
    }
    expect(parseFormula('').ok).toBe(false)
    expect(parseFormula('   ').ok).toBe(false)
    expect(parseFormula(null).ok).toBe(false)
  })
})

describe('the hash that decides a rev bump', () => {
  it('canonicalisation is STABLE — two parses of the same source hash identically', () => {
    // The hash decides whether an edit bumps `compute.rev`, and a rev bump
    // force-migrates every binding, resets `last_value` and suppresses a cycle.
    // An unstable hash would migrate a user's alerts on a save that changed
    // nothing.
    expect(astHash(parseFormula('sma( close ,20 )').ast))
      .toBe(astHash(parseFormula('sma(close, 20)').ast))
  })

  it('a hash is NOT stable across a semantic change', () => {
    // The control. Without it the assertion above is satisfied by `() => "x"`.
    expect(astHash(parseFormula('sma(close, 20)').ast))
      .not.toBe(astHash(parseFormula('sma(close, 21)').ast))
    expect(astHash(parseFormula('close > open').ast))
      .not.toBe(astHash(parseFormula('close < open').ast))
    expect(astHash(parseFormula('sma(close, 20)').ast))
      .not.toBe(astHash(parseFormula('ema(close, 20)').ast))
  })

  it('KEY ORDER IS NOT SEMANTICS — a re-serialised tree hashes identically', () => {
    // ⭐ THE CASE THE PERSISTED ARTIFACT ACTUALLY NEEDS. `compute.ast` comes back
    // out of a database, over a wire, through `JSON.parse` — key order is
    // whatever the round trip left, and this module never sees the object it
    // built. A hash that depends on insertion order bumps `compute.rev` on a
    // save that changed nothing, which force-migrates every binding and resets
    // `last_value` for a user who edited a comma.
    const reorder = (n) => {
      if (Array.isArray(n)) return n.map(reorder)
      if (!n || typeof n !== 'object') return n
      const out = {}
      for (const k of Object.keys(n).reverse()) out[k] = reorder(n[k])
      return out
    }
    const built = parseFormula('sma(close, 20) + 2 * stdev(close, 20)').ast
    const flipped = reorder(built)
    expect(Object.keys(flipped)).not.toEqual(Object.keys(built))   // the mutation really applied
    expect(astHash(flipped)).toBe(astHash(built))
  })

  it('the hash is a real sha256 — known answers, not just self-consistency', () => {
    // A digest function that returns a constant satisfies "stable" perfectly.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    // 119 bytes: crosses the 55-byte and 64-byte padding boundaries the naive
    // implementations get wrong.
    expect(sha256Hex('a'.repeat(119)))
      .toBe('31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb')
    expect(astHash(parseFormula('sma(close, 20)').ast)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('astHash REFUSES a tree that is not canonical', () => {
    // `JSON.stringify` drops `undefined` silently, so a tree with a hole hashes
    // as though the hole were not there. The canonical form has no optional
    // keys precisely so that is detectable.
    expect(() => astHash({ type: 'num' })).toThrow(/exactly/)
    expect(() => astHash({ type: 'num', value: 3, extra: 1 })).toThrow(/exactly/)
    expect(() => astHash({ type: 'member', name: 'x', args: [] })).toThrow(/not one of/)
    expect(() => astHash({ type: 'num', value: undefined })).toThrow(/exactly|only/)
    expect(() => astHash({ type: 'num', value: NaN })).toThrow(/finite/)
    expect(assertCanonical(parseFormula('close').ast)).toEqual({ type: 'series', name: 'close' })
  })
})

describe('the manifest', () => {
  it('declares 5 series, 15 operators, 11 functions and 54 scalars — 85 names, one grammar', () => {
    expect(Object.keys(TABLE.series)).toHaveLength(5)
    expect(Object.keys(TABLE.operators)).toHaveLength(15)
    expect(Object.keys(TABLE.functions)).toHaveLength(11)
    // ⭐ THE FOURTH SECTION (Phase E Task 1). Counted SEPARATELY from the three
    // above, not folded into one total: 31 is the BAR vocabulary a corpus case
    // can exercise against 579 bars, and 54 is the per-symbol vocabulary that
    // has no bar behaviour at all and earns its own coverage floor. A single
    // number here would have been "fixed" to 85 with nobody able to see which
    // half moved.
    expect(Object.keys(TABLE.scalars)).toHaveLength(54)
    const bar = new Set([
      ...Object.keys(TABLE.series), ...Object.keys(TABLE.operators), ...Object.keys(TABLE.functions),
    ])
    expect(bar.size).toBe(31)
    const declared = new Set([...bar, ...Object.keys(TABLE.scalars)])
    expect(declared.size).toBe(85)
    // ⚠️ `tableVersion` STAYS 1 AND THAT IS A DECISION. It versions the GRAMMAR
    // — the four node types and the keys a persisted tree may carry — and Phase
    // E widened the VOCABULARY without touching either: a scalar rides the
    // existing `series` node, so every stored `astHash` is unmoved. Bumping it
    // would say a stored tree needs re-reading, which is false.
    expect(TABLE.tableVersion).toBe(1)
  })

  it('every function declares a lookback and a read-back sentence', () => {
    // ⚠️ `sentence` LIVES IN THE MANIFEST so the chip's plain-English read-back
    // and the interpreter's dispatch come from ONE declaration. A read-back with
    // its own phrase table is a second vocabulary, and this repo has measured
    // what two vocabularies cost.
    const bad = []
    for (const [name, spec] of Object.entries(TABLE.functions)) {
      if (!Array.isArray(spec.args) || spec.args.length === 0) bad.push(`${name}: no args`)
      if (typeof spec.sentence !== 'string' || !spec.sentence) bad.push(`${name}: no sentence`)
      const lb = spec.lookback
      const ok = (typeof lb === 'number' && lb >= 0)
        || (typeof lb === 'string' && /^arg\d+$/.test(lb) && Number(lb.slice(3)) < spec.args.length)
      if (!ok) bad.push(`${name}: lookback ${JSON.stringify(lb)} is neither a constant nor a real argument`)
      // Every `{n}` the sentence cites must be an argument that exists.
      for (const m of spec.sentence.matchAll(/\{(\d+)\}/g)) {
        if (Number(m[1]) >= spec.args.length) bad.push(`${name}: sentence cites {${m[1]}} but takes ${spec.args.length} args`)
      }
    }
    expect(bad).toEqual([])
  })

  it('there is NO `ref` / `offset` / backward-index form, and that is a decision', () => {
    // ⛔ A general `close[n]` turns the repaint linter from a lookback SUM into a
    // dataflow analysis, and it makes a FORWARD reference expressible in the
    // first place — the exact construction the repaint record names as the thing
    // the linter has to decide. Every lookback below is a constant or a named
    // argument, so `maxLookback(ast)` stays a tree sum.
    for (const name of ['ref', 'offset', 'shift', 'valueWhen', 'barsBack']) {
      expect(TABLE.functions[name], `${name} is a v2 SPEC question, not an implementation one`).toBeUndefined()
    }
    expect(TABLE._no_offset_reopened_by).toMatch(/owner/)
    // …and the reason is not just a comment: the property the linter depends on.
    for (const spec of Object.values(TABLE.functions)) {
      expect(typeof spec.lookback === 'number' || /^arg\d+$/.test(spec.lookback)).toBe(true)
    }
  })

  it('the table is FROZEN — a caller cannot edit the grammar at runtime', () => {
    expect(Object.isFrozen(TABLE)).toBe(true)
    expect(Object.isFrozen(TABLE.functions)).toBe(true)
    expect(Object.isFrozen(TABLE.functions.sma)).toBe(true)
  })
})

describe('the dependency', () => {
  it('jsep is pinned EXACT, like lightweight-charts', () => {
    // `lightweight-charts: "5.2.0"` is pinned exact and B1 recorded why: one
    // renderer under all baselines. The argument is STRONGER here — this
    // parser's output is PERSISTED, so a minor bump is a data migration.
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
    expect(pkg.dependencies.jsep).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.dependencies.jsep).toBe('1.4.0')
  })

  it('the lockfile agrees with the pin, and jsep brings nothing with it', () => {
    // A caret in `package.json` is one way a parser moves under a persisted AST;
    // a lockfile that resolved something else is the other.
    const lock = readJson('app/package-lock.json')
    expect(lock.packages['node_modules/jsep'].version).toBe('1.4.0')
    expect(lock.packages['node_modules/jsep'].dependencies).toBeUndefined()
  })
})
