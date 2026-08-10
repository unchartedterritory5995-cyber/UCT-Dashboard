// ─── THE TC2000 READER, MEASURED ────────────────────────────────────────────
//
// The question this file answers is NOT "does the parser parse". It is: can a
// member who already writes PCF walk in, and when they cannot, are they told
// which token stopped them and where. So the corpus is genuine published
// TC2000 (`tests/fixtures/ast/pcf_corpus.json`, cited per case), the accepted
// half is proved by `astHash` EQUALITY with the native spelling — the same tree
// the engine already runs on both lanes at 1e-9, so this layer adds no numeric
// surface — and the refused half asserts the DOOR and the CHARACTER, because a
// refusal from the wrong door reads identically to the right one.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  parsePcf, detectDialect, pcfCoverage, priceLetters,
  offsetBinding,
  PCF_REFUSALS, PCF_FUSED, PCF_CALLS, PcfRefusal,
} from './pcf.js'
import { parseFormula, astHash, TABLE, NODE_TYPES, REFUSALS as PARSE_REFUSALS } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS, interpret } from './interpret.js'
import { REFUSALS as BUDGET_REFUSALS, checkBudget } from './budget.js'
import { REFUSALS as SENTENCE_REFUSALS, sentenceFor } from './sentence.js'
import { lintRepaint } from './lint.js'

/** The repo root, found by walking up — the same helper the neighbouring test
 *  files use, and it THROWS rather than defaulting, because a helper that
 *  returned a default would make every fixture-driven case below read nothing
 *  and pass. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`ast/pcf.test: could not find the repo root from ${process.cwd()}`)
})()

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const CORPUS = readJson('tests/fixtures/ast/pcf_corpus.json')
const NATIVE_CORPUS = readJson('tests/fixtures/ast/corpus.json')
const STARTERS = readJson('app/src/components/chart/engine/ast/starterScans.json')

/** A table with one edit, for the derivation rails. ⚠️ A DEEP CLONE, because
 *  `TABLE` is deep-frozen and a shallow copy would share the frozen sections. */
const clone = () => JSON.parse(JSON.stringify(TABLE))

/** Every `offset` node anywhere in a tree. ⛔ BY WALKING, never by reading the
 *  root: `AVGC50.1 > C1` carries two and a root check would see neither. */
function offsetNodesIn(root) {
  const found = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'offset') found.push(n)
    for (const a of n.args || []) stack.push(a)
  }
  return found
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. REAL TC2000, END TO END
// ═════════════════════════════════════════════════════════════════════════════

describe('genuine TC2000 formulas produce the tree the engine already runs', () => {
  it('the corpus is real and cited, and it is big enough to mean something', () => {
    // ⚠️ A FLOOR, NOT A COUNT — a count beside the list it describes is this
    // repo's most repeated documentation defect. The floor is what stops the
    // corpus being quietly emptied.
    const every = [...CORPUS.accepted, ...CORPUS.refused, ...CORPUS.offset_dependent]
    expect(CORPUS.accepted.length).toBeGreaterThanOrEqual(30)
    expect(CORPUS.refused.length).toBeGreaterThanOrEqual(25)
    expect(CORPUS.offset_dependent.length).toBeGreaterThanOrEqual(7)
    expect(every.length).toBeGreaterThanOrEqual(65)
    const ids = every.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of every) {
      expect(CORPUS._sources[c.cite], `${c.id} cites ${c.cite}`).toBeTruthy()
      expect(typeof c.source, `${c.id} has no source`).toBe('string')
    }
  })

  it.each(CORPUS.accepted.map((c) => [c.id, c]))(
    '%s — the PCF tree IS the native tree, by astHash', (_id, c) => {
      const pcf = parsePcf(c.source)
      expect(pcf.ok, `${c.source} → ${pcf.error}`).toBe(true)
      const native = parseFormula(c.native)
      expect(native.ok, `${c.native} → ${native.error}`).toBe(true)
      // ⭐ THE WHOLE ARGUMENT OF THIS LAYER, IN ONE ASSERTION. Equal hashes mean
      // the PCF lane persists exactly what the native lane persists, so the
      // budget, the linter, the read-back, `ast_interpret.py` and the 1e-9
      // conformance log all already cover it. An `expect(tree).toEqual(tree)`
      // would prove the same thing; `astHash` is used because it is the value
      // that actually decides a rev bump, and it asserts canonicality on the way.
      expect(astHash(pcf.ast)).toBe(astHash(native.ast))
    })

  it.each(CORPUS.accepted.map((c) => [c.id, c]))(
    '%s — parses, fits the budget, reads back in English and lints', (_id, c) => {
      const { ast } = parsePcf(c.source)
      const budget = checkBudget(ast, undefined)
      expect(budget.ok, `${c.source}: ${budget.error}`).toBe(true)
      const sentence = sentenceFor(ast, {})
      expect(typeof sentence).toBe('string')
      expect(sentence.length).toBeGreaterThan(0)
      // The member sees what we understood. A read-back that quietly degraded
      // to a placeholder would be a read-back nobody can rely on.
      expect(sentence).not.toMatch(/undefined|\{\d\}|\[object/)
      expect(lintRepaint(ast, {}).mode).toBe('non-repainting')
    })

  it('a TC2000 condition COMPUTES, on real bars, through the shipped interpreter', () => {
    // ⛔ NOT A MOCK OF THE ENGINE. This is the whole lane a scan runs: PCF text
    // → canonical tree → `interpret` → the 0/1 column the scan, the chart and
    // the alert all read. `_booleans` says a condition IS a 0/1 column, and this
    // is where a PCF condition either honours that or does not.
    const bars = []
    for (let i = 0; i < 60; i++) {
      const c = 100 + i
      bars.push({ o: c - 1, h: c + 1, l: c - 2, c, v: 1000 + i })
    }
    const uptrend = parsePcf('(C > AVGC10) AND (AVGC10 > AVGC20)')
    expect(uptrend.ok).toBe(true)
    const col = interpret(uptrend.ast, bars, {}, undefined, {})
    expect(col.length).toBe(bars.length)
    // A rising series is above both averages once the 20-bar window fills.
    expect(col[59]).toBe(1)
    // ⚠️ THE WARMUP BAR IS 0, NOT NaN, AND THAT IS THE TABLE'S RULE RATHER THAN
    // AN ACCIDENT: `interpret.js` makes a comparison against NaN 0 (both lanes
    // agree by luck there) while `&&` propagates NaN. Bar 5's averages are NaN,
    // so both comparisons are 0 and the AND of two zeros is 0. Pinned here
    // because a TC2000 member reads a 0 as "did not happen" and this is the one
    // place the two languages could quietly differ.
    expect(col[5]).toBe(0)
    for (const v of col) expect(v === 0 || v === 1 || Number.isNaN(v)).toBe(true)

    // …and the same source through the native spelling gives the same column,
    // value for value, because it is the same tree.
    const native = interpret(
      parseFormula('(close > sma(close, 10)) && (sma(close, 10) > sma(close, 20))').ast,
      bars, {}, undefined, {})
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(col[i])) expect(Number.isNaN(native[i])).toBe(true)
      else expect(col[i]).toBe(native[i])
    }
  })

  it('a TC2000 INDICATOR computes a real column, not just a condition', () => {
    const bars = []
    for (let i = 0; i < 40; i++) bars.push({ o: 10, h: 12, l: 9, c: 10 + i, v: 5 })
    const { ok, ast } = parsePcf('AVGC5 - AVGC35')
    expect(ok).toBe(true)
    const col = interpret(ast, bars, {}, undefined, {})
    // A series rising by 1/bar: the 5-bar mean leads the 35-bar mean by 15.
    expect(col[39]).toBeCloseTo(15, 9)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE REFUSAL CORPUS — BY NAME, AT THE CHARACTER
// ═════════════════════════════════════════════════════════════════════════════

describe('every unsupported construct refuses by name at its exact position', () => {
  it.each(CORPUS.refused.map((c) => [c.id, c]))(
    '%s — the declared guard fires at the declared character', (_id, c) => {
      const r = parsePcf(c.source)
      expect(r.ok, `${c.source} was ACCEPTED and must not be`).toBe(false)
      expect(r.guard, `${c.source}: ${r.error}`).toBe(c.guard)
      expect(r.index, `${c.source}: ${r.error}`).toBe(c.at)
      expect(r.token).toBe(c.names)
      // ⛔ THE MESSAGE MUST NAME THE THING. A guard that fires at the right
      // character with a generic sentence is a refusal a member cannot act on.
      expect(r.error.startsWith(PCF_REFUSALS[c.guard])).toBe(true)
      if (c.names) expect(r.error).toContain(c.names)
    })

  it('every declared guard is exercised by the corpus, both directions', () => {
    // ⭐ THE IDENTITY, NOT ONE HALF OF IT. A guard with no case is a gate nobody
    // has seen fire; a case declaring a guard that does not exist is a rail
    // aimed at nothing.
    const declared = new Set(Object.keys(PCF_REFUSALS))
    const fired = new Set(CORPUS.refused.map((c) => c.guard))
    // `pcf:empty`, `pcf:depth`, `pcf:function` and `pcf:signature` are not
    // reachable from a published TC2000 formula — they are reached below,
    // deliberately, and named here so the identity still closes.
    for (const c of CORPUS.offset_dependent) fired.add(c.guard)
    // ⚰️ `pcf:operator` JOINED THIS LIST WHEN `^`/`\\`/`MOD` BECAME SUPPORTED.
    // Its old call site refused those three by name and is gone; the guard
    // itself SURVIVES in `operator()`, where it fires if this reader ever emits
    // an operator `closedTable` does not declare. That is an internal invariant,
    // not something a member can type — so it is unreachable from the corpus in
    // exactly the way the four below are, and is named here for the same reason.
    for (const g of ['pcf:empty', 'pcf:depth', 'pcf:function', 'pcf:signature',
                     'pcf:operator']) fired.add(g)
    expect([...fired].sort()).toEqual([...declared].sort())
  })

  it('the blank box refuses at `pcf:empty`, and never throws', () => {
    for (const blank of ['', '   ', '\n', null, undefined, 42]) {
      const r = parsePcf(blank)
      expect(r.ok).toBe(false)
      expect(r.guard).toBe('pcf:empty')
    }
  })

  it('a formula nested past the reader refuses at `pcf:depth` rather than dying', () => {
    // ⛔ A GUARD THAT CRASHES IS NOT A REFUSAL. A descent parser is the one
    // place in this directory that cannot be made iterative, so it counts.
    const deep = `${'('.repeat(400)}C${')'.repeat(400)}`
    const r = parsePcf(deep)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:depth')
    expect(typeof r.index).toBe('number')
  })

  it('the reader NEVER throws, on anything', () => {
    const nasty = ['((((', '))))', ',,,', 'C > > O', 'AVG(', 'AVG()', 'IIF()',
      'XUP(C)', '...', '1.2.3.4', 'C1.2', '\\\\', 'AND', 'NOT', '-', '@#$%^&*']
    for (const s of nasty) {
      expect(() => parsePcf(s)).not.toThrow()
      expect(parsePcf(s).ok).toBe(false)
    }
  })

  it('the refusal sentences are DISJOINT across all five doors, both ways', () => {
    // ⛔ Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
    // deleted, and that has happened in this repo. The substring half is the one
    // a set-equality misses.
    const all = [
      ...Object.values(PARSE_REFUSALS),
      ...Object.values(INTERPRET_REFUSALS),
      ...Object.values(BUDGET_REFUSALS),
      ...Object.values(SENTENCE_REFUSALS),
      ...Object.values(PCF_REFUSALS),
    ]
    expect(new Set(all).size).toBe(all.length)
    for (const a of all) {
      const containing = all.filter((b) => b.includes(a))
      expect(containing, `${JSON.stringify(a)} is a substring of another refusal`).toHaveLength(1)
    }
  })

  it('every PCF guard is namespaced `pcf:` and NOTHING ELSE is', () => {
    for (const g of Object.keys(PCF_REFUSALS)) expect(g.startsWith('pcf:')).toBe(true)
    for (const g of [...Object.keys(PARSE_REFUSALS), ...Object.keys(INTERPRET_REFUSALS),
      ...Object.keys(BUDGET_REFUSALS), ...Object.keys(SENTENCE_REFUSALS)]) {
      expect(g.startsWith('pcf:')).toBe(false)
    }
  })

  it('PcfRefusal is its own class — a parse guard cannot cover a PCF one', () => {
    const err = new PcfRefusal('pcf:name', 'x', 3, 'x')
    expect(err.name).toBe('PcfRefusal')
    expect(err.guard).toBe('pcf:name')
    expect(err.index).toBe(3)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. ⭐ THE OFFSET SURFACE — REFUSED BY NAME, NEVER APPROXIMATED
// ═════════════════════════════════════════════════════════════════════════════

describe('⭐ the bar offset — PCF\'s most-used feature, and the engine now has one', () => {
  // ⭐⭐ THE EXPECTATION IS DERIVED FROM THE ENGINE'S OWN VOCABULARY, NEVER
  // WRITTEN DOWN. An offset-free PCF is not PCF, so these are the cases that
  // decide whether a member notices a discrepancy — and if the suite only
  // asserted the refusal it would go silently green the day the engine grew the
  // capability and this reader failed to use it. Both halves run: the shipped
  // vocabulary, and a four-type one that removes the node.
  const BOUND = offsetBinding()
  const WITHOUT = ['num', 'series', 'op', 'call']

  it.each(CORPUS.offset_dependent.map((c) => [c.id, c]))(
    '%s — carries the engine\'s offset node, and refuses by name without it', (_id, c) => {
      // The refusal half, driven by a vocabulary with no offset in it. ⛔ IT IS
      // A REAL BRANCH, not a comment: a gate nobody has seen fire is not a gate,
      // and once the node ships this is the only way to see this one fire.
      const off = parsePcf(c.source, TABLE, WITHOUT)
      expect(off.ok, `${c.source} parsed with no offset node declared`).toBe(false)
      expect(off.guard, off.error).toBe(c.guard)
      expect(off.index, off.error).toBe(c.at)
      expect(off.token).toBe(c.names)
      // ⛔ THE MESSAGE NAMES THE MISSING CAPABILITY, not a language limitation.
      expect(off.error.startsWith(PCF_REFUSALS['pcf:offset'])).toBe(true)

      // …and the support half, against what the engine actually ships.
      if (!BOUND) return
      const r = parsePcf(c.source)
      expect(r.ok, `${c.source} → ${r.error}`).toBe(true)
      expect(offsetNodesIn(r.ast).length, `${c.source} carries no offset node`).toBeGreaterThan(0)
      for (const n of offsetNodesIn(r.ast)) {
        // The shape `parse.js` defines, and nothing else. `value` is a NUMBER ON
        // THE NODE — a shape with no slot for an expression cannot hold one, so
        // "the offset is a constant" is true by construction.
        expect(Object.keys(n).sort()).toEqual(['args', 'type', 'value'])
        expect(Number.isInteger(n.value) && n.value > 0).toBe(true)
        expect(n.args).toHaveLength(1)
      }
      // Canonical, budgeted, and — the property the whole repaint linter rests
      // on — reaching FORWARD ZERO.
      expect(() => astHash(r.ast)).not.toThrow()
      expect(checkBudget(r.ast, undefined).ok, `${c.source} is over budget`).toBe(true)
      expect(lintRepaint(r.ast, {}).forward).toBe(0)
    })

  it('⭐⭐ THE SEAM IS THE ENGINE\'S OWN VOCABULARY, not a name this file guessed', () => {
    // ⛔ THE FAILURE MODE A HAND-LIST WOULD HAVE HAD, CLOSED BY CONSTRUCTION.
    // `parse.js` EXPORTS `NODE_TYPES`; "does this engine have a bar offset" is
    // therefore a question the engine answers about itself. There is no
    // candidate list here to rot, and this asserts the two really are the same
    // fact rather than two facts that happen to agree today.
    expect(offsetBinding(NODE_TYPES)).toEqual({ kind: 'node', type: 'offset' })
    expect(offsetBinding(WITHOUT)).toBeNull()
    expect(NODE_TYPES.includes('offset')).toBe(BOUND !== null)
  })

  it('⭐ the shipped reader emits the shipped node, for every TC2000 spelling of one', () => {
    // TC2000 writes an offset THREE ways and they all mean the same thing.
    // ⛔ ASSERTED AGAINST `parseFormula`'s OWN OUTPUT, never against a tree typed
    // here: `close[1]` is the native spelling of the same thing, so `astHash`
    // equality proves the PCF lane persists exactly what the native lane does —
    // and that is what makes the 1e-9 conformance log cover this too.
    if (!BOUND) return
    const native = parseFormula('close[1]')
    expect(native.ok, native.error).toBe(true)
    for (const src of ['C1', 'C.1', 'C(1)']) {
      const r = parsePcf(src)
      expect(r.ok, `${src} → ${r.error}`).toBe(true)
      expect(astHash(r.ast), `${src} is not close[1]`).toBe(astHash(native.ast))
    }
  })

  it('⭐ THE OFFSET WRAPS THE WHOLE INDICATOR, not its source series', () => {
    // `AVGC50.1` is *the 50-bar average as it stood one bar ago*. Offsetting the
    // CLOSE instead and re-averaging gives the same number for an SMA and a
    // DIFFERENT number for an EMA, an RSI or an ATR — a silent misread on every
    // recursive indicator the manifest declares, and one no refusal can catch.
    if (!BOUND) return
    const r = parsePcf('XAVGC12.1')
    expect(r.ok, r.error).toBe(true)
    expect(r.ast.type).toBe('offset')
    expect(r.ast.value).toBe(1)
    expect(r.ast.args[0]).toEqual({
      type: 'call', name: 'ema',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 12 }],
    })
    expect(astHash(r.ast)).toBe(astHash(parseFormula('ema(close, 12)[1]').ast))
  })

  it('the offset composes into the LOOKBACK, so the budget counts it', () => {
    // ⭐ `maxLookback` stays a TREE SUM: `value + maxLookback(child)`. Nothing in
    // this reader does arithmetic about that — it emits the node and the linter
    // adds it up, which is the entire reason the node shape is what it is.
    if (!BOUND) return
    const plain = parsePcf('MAXC252')
    const back = parsePcf('MAXC252.1')
    expect(lintRepaint(back.ast, {}).back).toBe(lintRepaint(plain.ast, {}).back + 1)
  })

  it('offset ZERO is the current bar and is admitted, in every spelling', () => {
    // ⚠️ THE OTHER DIRECTION. A gate that refused `z = 0` would refuse the syntax
    // table's own definition of "the current bar" and would be indistinguishable,
    // in a green suite, from one that refused everything. It holds with the node
    // present AND absent, because zero never needs one.
    for (const types of [NODE_TYPES, WITHOUT]) {
      for (const [src, want] of [['C0', 'close'], ['C.0', 'close'], ['C(0)', 'close'],
        ['V0', 'volume'], ['AVGC50.0', null]]) {
        const r = parsePcf(src, TABLE, types)
        expect(r.ok, `${src} → ${r.error}`).toBe(true)
        if (want) expect(r.ast).toEqual({ type: 'series', name: want })
      }
    }
  })

  it('⛔ NO FORWARD REFERENCE IS EXPRESSIBLE, with the node or without it', () => {
    // ⭐ THE PROPERTY THE WHOLE REPAINT LINTER RESTS ON. The offset decision was
    // re-opened on the condition that a forward reference stay inexpressible;
    // this reader must not open that door from the side, and the check runs with
    // the node PRESENT because that is the only state in which a door exists.
    for (const types of [NODE_TYPES, WITHOUT]) {
      // `C-1` is subtraction. There is no negative-offset syntax in PCF.
      expect(parsePcf('C-1', TABLE, types).ast).toEqual({
        type: 'op',
        name: '-',
        args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }],
      })
      // `C(-1)` is the one spelling that could smuggle one in: it parses as unary
      // minus, so it is not a literal, and it is refused AT PARSE.
      expect(parsePcf('C(-1)', TABLE, types).guard).toBe('pcf:window')
      // …and neither a computed offset nor a fractional one is a bar count.
      expect(parsePcf('C(V)', TABLE, types).guard).toBe('pcf:window')
    }
    // Every tree in the accepted corpus reaches forward exactly 0.
    for (const c of CORPUS.accepted) {
      const { ast } = parsePcf(c.source)
      expect(lintRepaint(ast, {}).forward, `${c.id} reaches forward`).toBe(0)
    }
    // …and so does every offset case, which is the case that could have broken it.
    if (!BOUND) return
    for (const c of CORPUS.offset_dependent) {
      const r = parsePcf(c.source)
      expect(lintRepaint(r.ast, {}).forward, `${c.id} reaches forward`).toBe(0)
    }
  })

  it('the crossing idiom that NEEDS an offset in TC2000 keeps its own primitive', () => {
    // TC2000 defines `XUP(C, AVGC10)` as `C >= AVGC10 AND C1 <= AVGC10.1`. The
    // offset lives inside TC2000's definition, not the member's formula, so the
    // one-bar crossing maps to this product's own crossing — which is what the
    // read-back can say in English and what the picker builds.
    const r = parsePcf('XUP(C, AVGC50)')
    expect(r.ok).toBe(true)
    expect(astHash(r.ast)).toBe(astHash(parseFormula('crossOver(close, sma(close, 50))').ast))
  })

  it('a crossing measured N bars back is TC2000\'s own definition, spelled out', () => {
    // ⭐ THERE IS NO PRIMITIVE FOR IT, so this is the published definition
    // verbatim — through the SAME seam every `.z` goes through, never a second
    // offset representation.
    if (!BOUND) return
    const r = parsePcf('XUP(C, 5, 3)')
    expect(r.ok, r.error).toBe(true)
    expect(astHash(r.ast))
      .toBe(astHash(parseFormula('(close >= 5) && (close[3] < (5)[3])').ast))
    // …and XDOWN is its mirror, both boundaries flipped.
    const d = parsePcf('XDOWN(C, 5, 3)')
    expect(d.ast.args[0].name).toBe('<=')
    expect(d.ast.args[1].name).toBe('>')
  })

  it('the coverage map reports the offset state and how to change it', () => {
    const cov = pcfCoverage()
    const row = cov.refused.find((r) => r.guard === 'pcf:offset')
    expect(row).toBeTruthy()
    expect(row.toSupport.length).toBeGreaterThan(40)
    expect(cov.offset.binding).toEqual(offsetBinding())
    expect(cov.offset.node).toBe('offset')
    if (BOUND) expect(row.state).toContain('SUPPORTED')
    else expect(row.state).toContain('REFUSED')
    // …and it moves with the vocabulary, like everything else here.
    expect(pcfCoverage(TABLE, WITHOUT).refused
      .find((r) => r.guard === 'pcf:offset').state).toContain('REFUSED')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. ⭐ THE MAPPING IS DERIVED FROM THE TABLE, AND THIS IS THE RAIL THAT PROVES IT
// ═════════════════════════════════════════════════════════════════════════════

describe('the engine functions come from closedTable.json at run time', () => {
  it('a REMOVED function takes its TC2000 spelling with it, naming both', () => {
    // ⭐ THE E-4 RAIL. A hand-list agreeing with today's manifest leaves 825 of
    // 826 tests green; this is the one that goes red. Nothing about the source
    // changes — only the TABLE — and the answer must move.
    expect(parsePcf('AVGC50').ok).toBe(true)
    const without = clone()
    delete without.functions.sma
    const r = parsePcf('AVGC50', without)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:function')
    expect(r.error).toContain('sma')
    expect(r.error).toContain('AVGC50')
  })

  it('a RENAMED-SHAPE function refuses rather than being filled wrong', () => {
    // ⛔ THE SILENT-MISREAD DIRECTION. A signature change that this reader kept
    // filling from its own idea of the shape would produce a tree that parses,
    // lints, saves and computes the wrong number.
    const reshaped = clone()
    reshaped.functions.sma.args = ['series', 'int', 'int']
    const r = parsePcf('AVGC50', reshaped)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:signature')
    expect(r.error).toContain('series, int, int')
  })

  it('a function this reader has a spelling for LANDS the moment the table declares it', () => {
    // The other direction, and the one that makes the indicator work land for
    // free. `stdev` is used as the stand-in because it is already declared with
    // the shape `WRSI`/`ATR`-style families need; the point is that NO EDIT
    // HERE is required for the mapping to change its answer.
    const withoutRsi = clone()
    delete withoutRsi.functions.rsi
    expect(parsePcf('WRSI14', withoutRsi).guard).toBe('pcf:function')

    const withRsi = clone()
    withRsi.functions.rsi = { args: ['series', 'int'], lookback: 'arg1', yields: 'num', sentence: 'x' }
    const r = parsePcf('WRSI14', withRsi)
    expect(r.ok, r.error).toBe(true)
    expect(r.ast).toEqual({
      type: 'call',
      name: 'rsi',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }],
    })
  })

  it('the price letters are READ OFF `TABLE.series`, not typed', () => {
    expect(Object.fromEntries(priceLetters())).toEqual({
      C: 'close', O: 'open', H: 'high', L: 'low', V: 'volume',
    })
    // A renamed series moves the letter with it…
    const renamed = clone()
    delete renamed.series.close
    renamed.series.settle = { field: 'c', doc: 'x' }
    const letters = priceLetters(renamed)
    expect(letters.has('C')).toBe(false)
    expect(letters.get('S')).toBe('settle')
    expect(parsePcf('C > 1', renamed).guard).toBe('pcf:name')

    // …and an ambiguous first letter resolves to NOTHING rather than guessing.
    const ambiguous = clone()
    ambiguous.series.hlc3 = { field: 'x', doc: 'x' }
    expect(priceLetters(ambiguous).has('H')).toBe(false)
    expect(parsePcf('H > 1', ambiguous).guard).toBe('pcf:name')
  })

  it('every operator emitted is checked against `TABLE.operators` first', () => {
    const without = clone()
    delete without.operators['&&']
    const r = parsePcf('(C > O) AND (V > 1)', without)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:operator')
    expect(r.error).toContain('&&')
  })

  it('every mapping target in this file is a name the table declares TODAY', () => {
    // ⚠️ A MEASUREMENT OF THE SHIPPED PAIR, not a second list. If a family here
    // points at a name nobody declares, that family is unreachable — which is
    // legal (it refuses by name) but should be a decision, so it is reported.
    const cov = pcfCoverage()
    for (const row of cov.blocked) {
      // eslint-disable-next-line no-console
      console.log(`[pcf coverage] ${row.spelling} is blocked: ${row.reason}`)
    }
    expect(cov.live.length).toBeGreaterThanOrEqual(9)
    for (const row of cov.live) expect(Object.keys(TABLE.functions)).toContain(row.fn)
  })

  it('the coverage map MOVES with the table', () => {
    const before = pcfCoverage().live.map((r) => r.fn)
    const without = clone()
    delete without.functions.highest
    const after = pcfCoverage(without).live.map((r) => r.fn)
    expect(before).toContain('highest')
    expect(after).not.toContain('highest')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. ⛔ THE SEMANTIC TRAPS THE RESEARCH FOUND
// ═════════════════════════════════════════════════════════════════════════════

describe('where PCF and this table disagree about what a word means', () => {
  it('PCF `MIN`/`MAX` are ROLLING, and `LEAST`/`GREATEST` are elementwise', () => {
    // ⛔ THE SILENT MISREAD THIS WHOLE MODULE EXISTS TO AVOID. Both mappings
    // parse; only one is right, and no refusal surface can tell them apart.
    expect(parsePcf('MIN(C, 10)').ast.name).toBe('lowest')
    expect(parsePcf('MAX(C, 10)').ast.name).toBe('highest')
    expect(parsePcf('LEAST(C, O)').ast.name).toBe('min')
    expect(parsePcf('GREATEST(C, O)').ast.name).toBe('max')
  })

  it('PCF `=` is EQUALITY and `<>` is inequality — there is no assignment', () => {
    expect(parsePcf('C = O').ast.name).toBe('==')
    expect(parsePcf('C <> O').ast.name).toBe('!=')
    // The native reader refuses `=` at its own door, which is why the two
    // dialects cannot share one parser.
    expect(parseFormula('close = open').ok).toBe(false)
  })

  it('PCF is CASE-INSENSITIVE and this table is not', () => {
    const hashes = ['AVGC50', 'avgc50', 'AvgC50', 'aVgC50']
      .map((s) => astHash(parsePcf(s).ast))
    expect(new Set(hashes).size).toBe(1)
    // ⚠️ THE NATIVE SIDE IS CASE-SENSITIVE, AND ITS REFUSAL COMES FROM A
    // DIFFERENT DOOR: `parse.js` deliberately does not validate names, so
    // `SMA(close, 50)` PARSES and is refused at `resolve:function` when the
    // budget resolves it. Asserting `parseFormula(...).ok === false` here would
    // have been a green test measuring the wrong gate.
    const upper = parseFormula('SMA(close, 50)')
    expect(upper.ok).toBe(true)
    expect(() => checkBudget(upper.ast, undefined)).toThrow(/unknown function/)
  })

  it('a boolean is a 0/1 NUMBER in both languages, so PCF\'s guard idiom works', () => {
    // The published Chaikin Money Flow divides by `(Hz - Lz - (Hz = Lz))`,
    // which only means anything if a comparison is a number. `_booleans` says
    // it is; this asserts the two agree.
    const r = parsePcf('H - L - (H = L)')
    expect(r.ok).toBe(true)
    expect(astHash(r.ast)).toBe(astHash(parseFormula('high - low - (high == low)').ast))
  })

  it('`NOT(x)` is the prefix operator, not a call — one tree, either spelling', () => {
    expect(astHash(parsePcf('NOT(C > O)').ast)).toBe(astHash(parsePcf('NOT (C > O)').ast))
    expect(parsePcf('NOT(C > O)').ast).toEqual({
      type: 'op',
      name: '!',
      args: [{ type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }] }],
    })
  })

  it('AND binds tighter than OR, and a comparison tighter than both', () => {
    expect(astHash(parsePcf('C > O AND V > 1 OR H > L').ast))
      .toBe(astHash(parseFormula('close > open && volume > 1 || high > low').ast))
  })

  it('an `int` argument must be a literal, in both dialects, for the same reason', () => {
    // A window that is not decidable statically stops `maxLookback` being a
    // tree sum, which is the trade `_no_offset` refuses on the owner's behalf.
    expect(parsePcf('AVG(C, V)').guard).toBe('pcf:window')
    expect(parsePcf('AVG(C, 0)').guard).toBe('pcf:window')
    expect(parsePcf('AVG(C, 2.5)').guard).toBe('pcf:window')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE DIALECT DECISION — IT MUST NOT BE ABLE TO TAKE A NATIVE FORMULA AWAY
// ═════════════════════════════════════════════════════════════════════════════

describe('detectDialect', () => {
  it('⭐ NOT ONE COMMITTED NATIVE SOURCE IS READ AS TC2000', () => {
    // ⛔ THE REGRESSION THIS DETECTOR COULD CAUSE, MEASURED RATHER THAN
    // ASSUMED. Every formula this product has ever shipped is native; if the
    // detector claimed one, the member would get a TC2000 refusal for a
    // formula that works. The corpus is the committed one, not a sample.
    const sources = [
      ...CORPUS.accepted.map((c) => c.native),
      ...Object.values(STARTERS.starters).map((s) => s.source),
      ...NATIVE_CORPUS.cases.map((c) => c.source).filter(Boolean),
      'close', 'sma(close, 20)', 'market_cap > 1e9', 'rsi14 > 50',
      'abs(change(close)) / close * 100 > 5', 'close * lineWidth',
      'min(close, open)', 'max(high, low)', 'stdev(close, 20)',
    ]
    expect(sources.length).toBeGreaterThan(30)
    for (const s of sources) {
      expect(detectDialect(s), `${JSON.stringify(s)} was read as TC2000`).toBe('native')
    }
  })

  it('every accepted TC2000 source IS read as TC2000', () => {
    for (const c of CORPUS.accepted) {
      expect(detectDialect(c.source), `${c.source} was read as native`).toBe('pcf')
    }
  })

  it('an unambiguously-native marker always wins', () => {
    // A member pasting a half-translated formula gets the native reader, whose
    // refusal names the native door — not a TC2000 door describing a native typo.
    expect(detectDialect('close > sma(close,50) && C1 > 0')).toBe('native')
    expect(detectDialect('(a > b) ? 1 : 0')).toBe('native')
  })

  it('a blank box is native, so nothing about the empty state changes', () => {
    expect(detectDialect('')).toBe('native')
    expect(detectDialect('   ')).toBe('native')
    expect(detectDialect(null)).toBe('native')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. THE SHAPE OF WHAT THIS FILE DECLARES
// ═════════════════════════════════════════════════════════════════════════════

describe('the declarations themselves', () => {
  it('every fused family declares `offset` LAST, or does not declare one at all', () => {
    // ⭐ THE OFFSET GATE DEPENDS ON THIS. Parameters fill left to right, so an
    // `offset` that is not last would swallow a real parameter's value and the
    // refusal would name the wrong number.
    for (const [name, family] of Object.entries(PCF_FUSED)) {
      const at = family.params.indexOf('offset')
      expect(at === -1 || at === family.params.length - 1, `${name}`).toBe(true)
      expect(family.spelling, `${name} has no spelling`).toBeTruthy()
      expect(family.field === true || Array.isArray(family.series), `${name}`).toBe(true)
    }
  })

  it('every declared mapping target resolves or is reported, never assumed', () => {
    const targets = [
      ...Object.values(PCF_FUSED).map((f) => f.fn),
      ...Object.values(PCF_CALLS).map((c) => c.fn),
    ]
    const cov = pcfCoverage()
    const seen = new Set([...cov.live, ...cov.blocked].map((r) => r.fn))
    for (const fn of targets) expect(seen.has(fn), `${fn} is in neither half`).toBe(true)
  })

  it('the coverage map names the offset refusal explicitly', () => {
    // The report quotes this, so it is asserted rather than trusted.
    const cov = pcfCoverage()
    // ⭐ EVERY REFUSED CONSTRUCT CARRIES ITS OWN `toSupport` — the third column
    // that turns a limitation into a plan. Asserted rather than trusted, because
    // the report quotes this object rather than restating it.
    expect(cov.refused.length).toBeGreaterThanOrEqual(9)
    for (const row of cov.refused) {
      expect(typeof row.construct).toBe('string')
      expect(typeof row.state).toBe('string')
      expect(row.toSupport.length, `${row.construct} has no remedy`).toBeGreaterThan(40)
    }
    expect(cov.refused.some((r) => r.construct.includes('AVGC50.1'))).toBe(true)
    expect(Object.keys(cov.priceLetters).sort()).toEqual(['C', 'H', 'L', 'O', 'V'])
  })
})
