// The Pine door: what it translates, what it refuses, and where it points.
//
// ⭐ THE REFUSAL CASES ARE THE SUBJECT OF THIS FILE, NOT ITS EDGE CASES. A
// translator that half-reads a script produces a scan that is confidently about
// something else, so every case below asserts the GUARD **and** the LINE and
// COLUMN — "it threw" is satisfiable by a translator that throws at the wrong
// place for the wrong reason.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  translatePine, printFormula, treeYieldsBool, lexPine,
  REFUSALS as PINE_REFUSALS,
} from './pine.js'
import { parseFormula, astHash, TABLE, REFUSALS as PARSE_REFUSALS } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS } from './interpret.js'
import { REFUSALS as BUDGET_REFUSALS } from './budget.js'
import { REFUSALS as SENTENCE_REFUSALS, sentenceFor, yieldsOf, compileRules } from './sentence.js'

const __dirnameSafe = path.dirname(fileURLToPath(import.meta.url))

const wrap = (body, head = '//@version=5\nindicator("t")\n') => `${head}plot(${body})\n`

/** The one output a single-plot script offers. */
function only(script) {
  const out = translatePine(script)
  expect(out.outputs.length, JSON.stringify(out.refusal)).toBeGreaterThan(0)
  return out
}

function formulaOf(script) {
  const out = only(script)
  const row = out.outputs[out.selected]
  expect(row && row.formula, JSON.stringify(out.refusal || out.outputs[0]?.refusal)).toBeTruthy()
  return row.formula
}

function refusalOf(script) {
  const out = translatePine(script)
  expect(out.ok).toBe(false)
  expect(out.refusal).toBeTruthy()
  return out.refusal
}

// --------------------------------------------------------------------------- //
// the vocabulary
// --------------------------------------------------------------------------- //

describe('the refusal vocabulary', () => {
  it('is pairwise disjoint ACROSS all five doors, in both directions', () => {
    // ⛔ THE UNION, NOT THIS MODULE'S OWN TABLE. Two gates sharing a phrase let a
    // `toThrow(/…/)` pass with the safety deleted, and the four existing doors
    // already assert this among themselves — a fifth that only checked itself
    // would reopen the hole from one side.
    const all = [
      ['pine', PINE_REFUSALS],
      ['parse', PARSE_REFUSALS],
      ['interpret', INTERPRET_REFUSALS],
      ['budget', BUDGET_REFUSALS],
      ['sentence', SENTENCE_REFUSALS],
    ].flatMap(([door, table]) => Object.entries(table).map(([guard, text]) => ({
      address: `${door}:${guard}`, text,
    })))

    const collisions = []
    for (const a of all) {
      for (const b of all) {
        if (a.address === b.address) continue
        if (a.text === b.text || a.text.includes(b.text)) {
          collisions.push(`${a.address} contains ${b.address}`)
        }
      }
    }
    expect(collisions).toEqual([])
    expect(all.length).toBeGreaterThan(40)
  })

  it('every guard this module can emit has a declared sentence', () => {
    for (const [guard, text] of Object.entries(PINE_REFUSALS)) {
      expect(typeof text, guard).toBe('string')
      expect(text.length, guard).toBeGreaterThan(20)
    }
  })
})

// --------------------------------------------------------------------------- //
// the derived mapping
// --------------------------------------------------------------------------- //

describe('the function map is DERIVED from closedTable.json', () => {
  it('a function the manifest gains is callable with no change to this module', () => {
    // ⭐⭐ THE CLAIM, MEASURED. `zigzaggery` exists nowhere in this repo. It is
    // callable from Pine the instant a manifest declares it, because the mapping
    // is `Object.keys(TABLE.functions)` and not a list.
    const invented = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        zigzaggery: { args: ['series', 'int'], lookback: 'arg1', yields: 'num', sentence: 'the {1}-bar zigzaggery of {0}' },
      },
    }
    const out = translatePine(wrap('ta.zigzaggery(close, 9)'), { table: invented })
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('zigzaggery(close, 9)')
  })

  it('...and the SAME script refuses against the shipped manifest, by name', () => {
    // ⛔ THE CONTROL. Without it the case above passes for a translator that
    // accepts every name it is handed.
    const out = translatePine(wrap('ta.zigzaggery(close, 9)'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
    expect(out.refusal.message).toContain('zigzaggery')
  })

  it('the arity a call must satisfy is the MANIFEST\'s, not Pine\'s', () => {
    const widened = {
      ...TABLE,
      functions: { ...TABLE.functions, sma: { args: ['series', 'int', 'int'], lookback: 'arg1', yields: 'num', sentence: 'x {0} {1} {2}' } },
    }
    const out = translatePine(wrap('ta.sma(close, 20)'), { table: widened })
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:arity')
    expect(out.refusal.message).toContain('sma(series, int, int)')
  })

  it('a Pine spelling that differs only in case or underscore resolves', () => {
    // `ta.crossover` → `crossOver`; the index normalises, so neither spelling is
    // written down anywhere in the translator.
    expect(formulaOf(wrap('ta.crossover(close, ta.sma(close, 20))')))
      .toBe('crossOver(close, sma(close, 20))')
  })
})

// --------------------------------------------------------------------------- //
// what translates
// --------------------------------------------------------------------------- //

describe('what a member can express', () => {
  it('v5 namespaced calls', () => {
    expect(formulaOf(wrap('ta.rsi(close, 14)'))).toBe('rsi(close, 14)')
  })

  it('v4 and v3 bare calls, and study() instead of indicator()', () => {
    expect(formulaOf(wrap('sma(close, 20)', '//@version=4\nstudy("t")\n'))).toBe('sma(close, 20)')
  })

  it('a script with no //@version line at all still reads (Pine assumes v1)', () => {
    const out = translatePine('plot(sma(close, 5))\n')
    expect(out.version).toBe(null)
    expect(out.ok).toBe(true)
  })

  it('and/or/not become the table operators, never JavaScript ones', () => {
    expect(formulaOf(wrap('close > open and volume > 1000')))
      .toBe('close > open && volume > 1000')
    expect(formulaOf(wrap('not (close > open)'))).toBe('!(close > open)')
    expect(formulaOf(wrap('close > open or close > high'))).toBe('close > open || close > high')
  })

  it('the ternary, which both languages spell the same way', () => {
    expect(formulaOf(wrap('close > open ? 1 : 0'))).toBe('close > open ? 1 : 0')
  })

  it('true and false, which this table stores as 1 and 0', () => {
    expect(formulaOf(wrap('close > open ? true : false'))).toBe('close > open ? 1 : 0')
  })

  it('hl2, hlc3, ohlc4 and hlcc4 expand to their Pine reference definitions', () => {
    expect(formulaOf(wrap('hl2'))).toBe('(high + low) / 2')
    expect(formulaOf(wrap('hlc3'))).toBe('(high + low + close) / 3')
    expect(formulaOf(wrap('ohlc4'))).toBe('(open + high + low + close) / 4')
    expect(formulaOf(wrap('hlcc4'))).toBe('(high + low + close + close) / 4')
  })

  it('inputs fold to their defaults, and the fold is REPORTED', () => {
    const script = '//@version=5\nindicator("t")\nlen = input.int(21, "Length", minval=1)\nplot(ta.sma(close, len))\n'
    const out = translatePine(script)
    expect(out.outputs[0].formula).toBe('sma(close, 21)')
    expect(out.outputs[0].inputsFolded).toHaveLength(1)
    expect(out.outputs[0].inputsFolded[0]).toMatchObject({ call: 'input.int', title: 'Length', folded: '21' })
  })

  it('input(close, …) folds to a SERIES, not to a number', () => {
    const script = '//@version=5\nindicator("t")\nsrc = input(hlc3, title="Source")\nplot(ta.sma(src, 5))\n'
    expect(translatePine(script).outputs[0].formula).toBe('sma((high + low + close) / 3, 5)')
  })

  it('a plot bound to a name is still a column — Pine returns a handle', () => {
    const script = '//@version=5\nindicator("t")\np = plot(ta.sma(close, 5), "Mean")\n'
    const out = translatePine(script)
    expect(out.ok).toBe(true)
    expect(out.outputs[0].title).toBe('Mean')
    expect(out.outputs[0].formula).toBe('sma(close, 5)')
  })

  it('alertcondition is a column too, and it is offered FIRST', () => {
    const script = '//@version=5\nindicator("t")\n'
      + 'plot(ta.rsi(close, 14), "RSI")\n'
      + 'alertcondition(ta.rsi(close, 14) < 30, "Oversold")\n'
    const out = translatePine(script)
    expect(out.outputs).toHaveLength(2)
    expect(out.selected).toBe(1)
    expect(out.outputs[1].formula).toBe('rsi(close, 14) < 30')
    expect(treeYieldsBool(out.outputs[1].ast)).toBe(true)
  })

  it('a constant plot is never the first offer', () => {
    // A published indicator plots a hidden zero baseline for `fill()`; offering
    // that as the member's scan is a screen that matches nothing.
    const script = '//@version=5\nindicator("t")\nz = plot(0.0, display=display.none)\nplot(ta.rsi(close, 14), "RSI")\n'
    const out = translatePine(script)
    expect(out.outputs[0].formula).toBe('0')
    expect(out.selected).toBe(1)
  })

  it('one bad plot does not take the good ones down with it', () => {
    const script = '//@version=5\nindicator("t")\n'
      + 'plot(ta.sma(close, 5), "Good")\n'
      + 'plot(request.security(syminfo.tickerid, "D", close), "Bad")\n'
    const out = translatePine(script)
    expect(out.ok).toBe(true)
    expect(out.outputs[0].formula).toBe('sma(close, 5)')
    expect(out.outputs[1].formula).toBe(null)
    expect(out.outputs[1].refusal.guard).toBe('pine:request')
  })

  it('a line nothing reaches is a NOTE, never a refusal', () => {
    // ⭐ THE RULE THAT MAKES REAL SCRIPTS TRANSLATE. Forty `input.symbol` rows and
    // an `hline` do not stop a `plot()` that never touches them.
    const script = '//@version=5\nindicator("t")\n'
      + "sym = input.symbol(title='1', defval='')\n"
      + 'h = hline(80, "Upper")\n'
      + 'plot(ta.sma(close, 5))\n'
    const out = translatePine(script)
    expect(out.ok).toBe(true)
    expect(out.notes.length).toBeGreaterThan(0)
    expect(out.notes.some((n) => n.code === 'pine:chart-only')).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
// the round trip
// --------------------------------------------------------------------------- //

describe('the Pine parity sweep — six functions, one order, one built-in', () => {
  // ⭐ EVERY ONE OF THESE WAS MEASURED, NOT WISHED FOR. A study of 21 real
  // published scripts found these to be the whole manifest half of what still
  // refused; each `it` below is the construct that unblocked a named script or a
  // named family of them.

  it('ta.rma — Wilder`s average, the one inside every RSI and ATR', () => {
    expect(formulaOf(wrap('ta.rma(close, 14)'))).toBe('rma(close, 14)')
  })

  it('ta.wma — the linearly weighted average', () => {
    expect(formulaOf(wrap('ta.wma(close, 9)'))).toBe('wma(close, 9)')
  })

  it('math.round and math.sign, and their v3 bare spellings', () => {
    expect(formulaOf(wrap('math.round(close)'))).toBe('round(close)')
    expect(formulaOf(wrap('math.sign(close - open)'))).toBe('sign(close - open)')
    expect(formulaOf(wrap('round(close)', '//@version=3\nstudy("t")\n'))).toBe('round(close)')
  })

  it('na(x) asks whether a value is unknown', () => {
    expect(formulaOf(wrap('na(ta.sma(close, 20)) ? 1 : 0')))
      .toBe('na(sma(close, 20)) ? 1 : 0')
  })

  it('nz(x, y) replaces it — and the replacement is IN THE TREE', () => {
    expect(formulaOf(wrap('nz(ta.sma(close, 20), close)'))).toBe('nz(sma(close, 20), close)')
  })

  it('⭐ the bare `na` VALUE is this engine`s not-computable, spelled 0 / 0', () => {
    // ⛔ IT USED TO REFUSE, and refusing was the expensive option: `cond ? x : na`
    // is a per-PLOT idiom, so one Ichimoku script lost FIFTEEN columns to it. The
    // arithmetic already had the value — `0 / 0` is IEEE NaN in JS natively and
    // `_binary_div` returns NaN for it explicitly in the Python lane — so only
    // the spelling was missing, and no name had to enter the sayable vocabulary
    // to supply it.
    expect(formulaOf(wrap('close > open ? close : na')))
      .toBe('close > open ? close : 0 / 0')
  })

  it('⭐ nz(x) fills its OWN zero rather than leaving a default invisible', () => {
    // ⛔ THE LITERAL GOES INTO THE TREE. Pine's one-argument form means "or 0";
    // this table has no one-argument form, because an unstated default zero is
    // the invisible half of `nz(market_cap, 0) > 1e9` — a broken symbol wearing a
    // quiet one's answer. Written out, the read-back says it and the member sees
    // what their script asked for.
    expect(formulaOf(wrap('nz(ta.sma(close, 20))'))).toBe('nz(sma(close, 20), 0)')
  })

  it('ta.atr(length) fills high, low and close in the order the table declares', () => {
    // ⭐ `pine:role-order` USED TO FIRE HERE, and it was right to: the translator
    // could see that `atr` exists and takes four arguments, and had no way to know
    // WHICH three series to fill. The order is declared now, in the same
    // `PINE_CALL_SHAPES` row shape `ta.wpr` already used.
    expect(formulaOf(wrap('ta.atr(14)'))).toBe('atr(high, low, close, 14)')
  })

  it('⭐ tr expands to the Pine reference manual`s own definition of it', () => {
    // ⛔ AN EXPANSION IS ONLY ADMISSIBLE WHEN IT IS AN IDENTITY. True Range IS
    // `max(high - low, max(abs(high - close[1]), abs(low - close[1])))`, and it
    // became sayable at all only when the bounded backward offset landed.
    expect(formulaOf(wrap('tr')))
      .toBe('max(high - low, max(abs(high - close[1]), abs(low - close[1])))')
  })

  it('…and a script that defines its OWN tr gets its own, not ours', () => {
    // ⛔ SHADOWING A BUILT-IN IS LEGAL PINE, and the script is the authority on
    // its own names. The expansion is consulted LAST, after every binding the
    // script wrote — without that ordering this feature would silently replace a
    // member's variable with different arithmetic.
    expect(formulaOf(wrap('tr', '//@version=5\nindicator("t")\ntr = ta.sma(close, 3)\n')))
      .toBe('sma(close, 3)')
  })
})

describe('the round trip is the proof nothing half-translated', () => {
  const CASES = [
    'ta.sma(close, 20) > ta.ema(close, 50)',
    '(close - ta.lowest(low, 20)) / (ta.highest(high, 20) - ta.lowest(low, 20))',
    'close > open and (ta.rsi(close, 14) < 30 or ta.rsi(close, 14) > 70)',
    'not (close > open) ? -1 : 1',
    'ta.stdev(close, 20) * 2 + ta.sma(close, 20)',
    'hl2 > ta.sma(hlc3, 10)',
    '-ta.change(close)',
    'math.abs(close - open) / (high - low)',
  ]

  for (const body of CASES) {
    it(`prints text that re-parses to the same tree: ${body}`, () => {
      const src = formulaOf(wrap(body))
      const reparsed = parseFormula(src)
      expect(reparsed.ok, src).toBe(true)
      // The read-back exists for it — a tree with no English is a tree the member
      // cannot confirm, and this is the door that says so.
      expect(typeof sentenceFor(reparsed.ast, {})).toBe('string')
    })
  }

  it('the AST the translator built and the AST the parser reads back are ONE hash', () => {
    for (const body of CASES) {
      const out = only(wrap(body))
      const row = out.outputs[out.selected]
      expect(astHash(parseFormula(row.formula).ast)).toBe(astHash(row.ast))
    }
  })

  it('a negative literal survives the trip (it is `u-` applied to a positive one)', () => {
    const script = '//@version=5\nindicator("t")\nk = input.float(-1.5, "K")\nplot(close * k)\n'
    const out = translatePine(script)
    expect(out.outputs[0].formula).toBe('close * -1.5')
    expect(astHash(parseFormula(out.outputs[0].formula).ast)).toBe(astHash(out.outputs[0].ast))
  })

  it('printFormula refuses a tree it cannot spell rather than spelling it wrong', () => {
    expect(() => printFormula({ type: 'op', name: '%', args: [{ type: 'num', value: 1 }, { type: 'num', value: 2 }] }))
      .toThrow(/could not read back/)
  })

  it('`yields` agrees with the sentence module on every translated tree', () => {
    for (const body of CASES) {
      const out = only(wrap(body))
      const row = out.outputs[out.selected]
      const mine = treeYieldsBool(row.ast)
      const theirs = yieldsOf(row.ast) === 'bool'
      expect(mine, body).toBe(theirs)
    }
  })

  /** The manifest's own name-bearing sections, READ OFF THE MANIFEST.
   *
   *  ⛔ `Object.keys`, NEVER A LIST TYPED HERE — `compileRules`'s own
   *  `PROBED_SECTIONS` is this same line two files away, and
   *  `definition_concierge._name_sections` is its Python twin. An `_`-prefixed
   *  key is the manifest's note convention and `tableVersion` is a scalar, so
   *  neither reaches this list. */
  const sectionsOf = (table) => Object.keys(table)
    .filter((k) => !k.startsWith('_') && table[k] && typeof table[k] === 'object')

  /** ⚠️ ONLY THE TWO CALLABLE SECTIONS ARE NAMED, AND THAT IS THE WHOLE
   *  DERIVATION: they are the ones that change the NODE TYPE. Everything else
   *  rides the `series` leaf, so a sixth series-riding section is swept the day
   *  it lands with no edit here. Exactly `definition_concierge`'s
   *  `_CALLABLE_SECTIONS` + `_LEAF_NODE` shape. */
  const NODE_OF = { operators: 'op', functions: 'call' }

  /** One minimal tree per declared entry, across every declared section. */
  const treesFor = (table) => sectionsOf(table).flatMap((section) =>
    Object.entries(table[section]).map(([name, spec]) => {
      const type = NODE_OF[section] || 'series'
      if (type === 'series') return { type, name }
      const arity = type === 'op' ? (spec.arity || 0) : ((spec && spec.args) || []).length
      return { type, name, args: Array.from({ length: arity }, () => ({ type: 'num', value: 1 })) }
    }))

  it('⛔ …and the sweep above is VACUOUS for whole sections — so every declared name is checked directly', () => {
    // ⛔⛔ THE PARITY RAIL ABOVE COULD NOT HAVE CAUGHT THE ONE DIVERGENCE THAT
    // ACTUALLY HAPPENED. It iterates PINE cases, and `PINE_KNOWN_BUILTINS`
    // refuses `hour` / `time` / `year`, so no Pine script can produce a clock
    // leaf — the whole `clock` section was outside its reach. When closed table
    // v2 gave five clock entries `yields: "bool"` and `treeYieldsBool` still
    // read only `table.scalars`, the two answers diverged on all five and this
    // file stayed green. A rail whose subject cannot contain the defect is not
    // a rail for it.
    //
    // ⭐ SO THE SUBJECT IS THE MANIFEST, NOT THE CORPUS: every declared name, in
    // every declared section, on the node type it rides — see `treesFor`, whose
    // section list is `Object.keys(table)` rather than five names typed here.
    // ⛔ THIS COMMENT USED TO CLAIM THAT PROPERTY WHILE THE CODE HAND-LISTED THE
    // FIVE SECTIONS, so a sixth left the sweep at 194 -> 194 and covered neither
    // new name. A comment asserting a property the code lacks is the same defect
    // as the diverging reader this rail exists to kill — measured, then fixed by
    // deriving rather than by editing the sentence.
    const trees = treesFor(TABLE)
    expect(trees.length).toBeGreaterThan(150)
    const disagree = trees.filter((t) => treeYieldsBool(t) !== (yieldsOf(t) === 'bool'))
    expect(disagree.map((t) => `${t.type}:${t.name}`)).toEqual([])

    // ⚠️ NON-VACUITY, BOTH DIRECTIONS: the sweep must contain names of each
    // answer, or an agreement over an all-`num` set proves nothing.
    const bools = trees.filter((t) => treeYieldsBool(t))
    expect(bools.length, 'nothing in the table yields bool').toBeGreaterThan(0)
    expect(trees.length - bools.length).toBeGreaterThan(0)
    // …and the clock is IN the sweep, which is the section the old rail missed.
    expect(bools.some((t) => Object.prototype.hasOwnProperty.call(TABLE.clock, t.name))).toBe(true)
  })

  it('⭐ THE CONTROL: a SIXTH section reaches the sweep with no edit to this file', () => {
    // ⛔ WITHOUT THIS, "the subject is the manifest" is a sentence rather than a
    // measurement — which is exactly how the hand-listed version passed review
    // once already. The perturbation is a whole new series-riding section; the
    // sweep must grow by exactly its entries and must ASK BOTH READERS about
    // them.
    const planted = {
      ...TABLE,
      zzSixthSection: {
        zzPlantedA: { lookback: 0, yields: 'bool', sentence: 'planted A' },
        zzPlantedB: { lookback: 0, yields: 'num', sentence: 'planted B' },
      },
    }
    const before = treesFor(TABLE)
    const after = treesFor(planted)
    expect(after.length).toBe(before.length + 2)
    expect(after.map((t) => t.name)).toEqual(expect.arrayContaining(['zzPlantedA', 'zzPlantedB']))

    // ⚠️ AND THE `_`-PREFIXED NOTE CONVENTION IS RESPECTED, or every prose note
    // in the manifest would arrive as a vocabulary of one name per character.
    const noted = { ...TABLE, _zzNote: { zzFromNote: { doc: 'a note, not a section' } } }
    expect(treesFor(noted).length).toBe(before.length)

    // ⛔ AND THE TWO READERS STILL AGREE ON THE PLANTED SECTION. They agree by
    // CONSTRUCTION now — `treeYieldsBool` IS `yieldsOf` — so this cannot fail
    // while that holds, and that is the point: it is the regression detector for
    // the day somebody re-forks the reader, and its SUBJECT is now complete.
    const rules = compileRules(planted)
    for (const tree of after.filter((t) => t.name.startsWith('zzPlanted'))) {
      expect(treeYieldsBool(tree, planted)).toBe(yieldsOf(tree, rules) === 'bool')
    }
  })

  it('⛔ `treeYieldsBool` holds NO section list of its own — it reaches the one resolver', () => {
    // ⛔ THE STRUCTURAL HALF, AND IT IS WHY THE FIX WAS A DELETION RATHER THAN A
    // CORRECTED COMMENT. A behavioural sweep passes the day two readers happen
    // to agree; what made them diverge was that there WERE two. This reads the
    // shipped source and fails if this function ever re-grows a manifest walk.
    const src = fs.readFileSync(path.join(__dirnameSafe, 'pine.js'), 'utf8')
    const start = src.indexOf('export function treeYieldsBool')
    expect(start, 'treeYieldsBool was renamed — this rail is now measuring nothing')
      .toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}', start) + 2)
    // ⛔ THE FORBIDDEN NAMES ARE THE MANIFEST'S OWN SECTIONS, not five strings
    // typed here — same derivation as `treesFor`, for the same reason: a second
    // reader of a SIXTH section would slip past a hand-list silently.
    const sections = sectionsOf(TABLE)
    expect(sections.length).toBeGreaterThanOrEqual(5)
    for (const section of sections) {
      expect(body, `treeYieldsBool re-reads table.${section} — that is a second yields authority`)
        .not.toMatch(new RegExp(`\\.${section}\\b|\\['${section}'\\]`))
    }
    expect(body).toMatch(/yieldsOf\(/)
  })
})

// --------------------------------------------------------------------------- //
// the refusal corpus
// --------------------------------------------------------------------------- //

describe('every unsupported construct refuses BY NAME, AT ITS OWN TOKEN', () => {
  /** `[script, guard, line, column, token]` — the column and the token are the
   *  point. A refusal that names the right guard at the wrong place sends a
   *  member looking at the wrong line. */
  const CASES = [
    ['strategy declaration',
      '//@version=5\nstrategy("S", overlay=true)\nplot(close)\n',
      'pine:declaration-strategy', 2, 1, 'strategy'],
    ['an order-placing call',
      '//@version=5\nindicator("t")\nstrategy.entry("L", strategy.long)\nplot(close)\n',
      'pine:strategy-call', 3, 1, 'strategy.entry'],
    ['library declaration',
      '//@version=5\nlibrary("L")\nplot(close)\n',
      'pine:declaration-library', 2, 1, 'library'],
    ['import',
      '//@version=5\nindicator("t")\nimport foo/bar/1 as b\nplot(close)\n',
      'pine:module', 3, 1, 'import'],
    ['request.security',
      '//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "D", close))\n',
      'pine:request', 3, 6, 'request.security'],
    ['bare v3/v4 security(), which is request.security under another spelling',
      '//@version=3\nstudy("t")\nplot(security(tickerid, "D", close))\n',
      'pine:request', 3, 6, 'security'],
    ['an array',
      '//@version=5\nindicator("t")\na = array.new_float(0)\nplot(array.get(a, 0))\n',
      'pine:collection', 4, 6, 'array.get'],
    ['a drawing',
      '//@version=5\nindicator("t")\nl = line.new(bar_index, high, bar_index, low)\nplot(line.get_y1(l))\n',
      'pine:drawing', 4, 6, 'line.get_y1'],
    ['a table',
      '//@version=5\nindicator("t")\nt = table.new(position.top_right, 1, 1)\nplot(table.cell_get_text(t, 0, 0) == "x" ? 1 : 0)\n',
      'pine:drawing', 4, 6, 'table.cell_get_text'],
    ['a user-defined type',
      '//@version=5\nindicator("t")\ntype Point\n    float x\np = Point.new(1.0)\nplot(p.x)\n',
      'pine:type', 6, 6, 'p.x'],
    // ⚠️ FOUR CASES USED TO SIT HERE AND THEY MOVED TO `pine.variables.test.js`,
    // WHERE THEY ARE NOW ASSERTED TO TRANSLATE: a `:=` inside a block, a compound
    // assignment, `v = if …`, and `f(x) => x * 2`. What is refused about a
    // reassignment was never the token — it is whether the value crosses a bar —
    // so the cases below are the ones that actually do.
    ['a reassignment that reads the previous bar, which is state with no var in sight',
      '//@version=5\nindicator("t")\nx = 0.0\nx := x[1] + volume\nplot(x)\n',
      'pine:state', 4, 7, '['],
    // ⚰️ `var state` AND `a var accumulator` SAT HERE AND NOW TRANSLATE. The
    // engine grew a bounded recurrence (`accum`) and this translator emits it —
    // see "Pine's `var` is the engine's `accum`" in `pine.variables.test.js`.
    // ⛔ `varip` REMAINS in this table below, and the distinction is not
    // cosmetic: it persists across INTRABAR TICKS, so its value depends on how
    // many times a forming bar updated. That is the one thing a closed-bar
    // engine can never reproduce.
    ['a := inside a `for`, which the fold never reads and the token scan always does',
      '//@version=5\nindicator("t")\nx = close\nfor i = 0 to 3\n    x := x + 1\nplot(x)\n',
      'pine:reassign', 5, 7, ':='],
    ['a block-valued binding whose branches carry no value',
      '//@version=5\nindicator("t")\nv = if close > open\n    y = 1\nelse\n    y = 0\nplot(v)\n',
      'pine:block', 3, 5, 'if'],
    ['a user-defined function whose body is more than one expression',
      '//@version=5\nindicator("t")\nf(x) =>\n    for i = 0 to 2\n        x\n    x * 2\nplot(f(close))\n',
      'pine:block', 4, 5, 'for'],
    ['a user-defined function that calls itself',
      '//@version=5\nindicator("t")\nf(x) => f(x) + 1\nplot(f(close))\n',
      'pine:cycle', 3, 9, 'f'],
    ['a tuple destructure',
      '//@version=5\nindicator("t")\n[a, b] = ta.macd(close, 12, 26, 9)\nplot(a)\n',
      'pine:tuple', 3, 1, '['],
    // ⚠️ `close[1]` IS NOT HERE, AND IT USED TO BE. It is SUPPORTED — the engine
    // grew a fifth canonical node for the bounded backward offset and this
    // translator emits it. What is still refused about `[n]` is a variable index
    // and a negative one, and both live in `pine.offset.test.js` beside the cases
    // that prove the supported form works.
    // ⚰️ `nz` WAS HERE, as "na wearing a hat", and it is now expressible — see
    // "the Pine parity sweep" below. The BARE `na` VALUE above still refuses, and
    // the two were never the same thing: `na(x)` and `nz(x, y)` ASK ABOUT and
    // REPLACE not-computable, while a bare `na` is a literal this table has no
    // spelling for. Collapsing all three into one refusal is what made the
    // distinction invisible for as long as it was.
    ['fixnan, which carries a value forward across bars with no stated bound',
      '//@version=5\nindicator("t")\nplot(fixnan(ta.sma(close, 5)))\n',
      'pine:na', 3, 6, 'fixnan'],
    ['a text value',
      '//@version=5\nindicator("t")\nplot(close > 0 ? "up" : "down")\n',
      'pine:text-value', 3, 18, 'up'],
    ['a colour value',
      '//@version=5\nindicator("t")\nplot(#FF0000)\n',
      'pine:colour-value', 3, 6, '#FF0000'],
    // ⚰️ WAS `bar_index` UNTIL 2026-08-27, and the swap is the point. `bar_index`
    // maps onto the closed table's `barindex`, so it now refuses with a sentence
    // saying the engine HOLDS that column — the generic reason no longer applies
    // to it. `timenow` is a built-in this engine genuinely does NOT hold, so the
    // generic sentence keeps a case that exercises it.
    ['a built-in this engine genuinely does not hold',
      '//@version=5\nindicator("t")\nplot(timenow)\n',
      'pine:builtin', 3, 6, 'timenow'],
    ['a name the script never bound',
      '//@version=5\nindicator("t")\nplot(mystery)\n',
      'pine:undefined', 3, 6, 'mystery'],
    ['the modulo operator, which this table has no counterpart for',
      '//@version=5\nindicator("t")\nplot(close % 2)\n',
      'pine:operator', 3, 12, '%'],
    ['a JavaScript negation, which is not Pine at all',
      '//@version=5\nindicator("t")\nplot(!(close > open) ? 1 : 0)\n',
      'pine:operator', 3, 6, '!'],
    ['a displaced plot',
      '//@version=5\nindicator("t")\nplot(ta.sma(close, 5), offset = -3)\n',
      'pine:plot-offset', 3, 24, 'offset'],
    ['a length that is not a literal',
      '//@version=5\nindicator("t")\nplot(ta.sma(close, 10 + 4))\n',
      'pine:window', 3, 20, '10'],
    ['a named argument onto a table position',
      '//@version=5\nindicator("t")\nplot(ta.sma(source = close, length = 20))\n',
      'pine:named-argument', 3, 13, 'source'],
    // ⚠️ THIS EXPECTED `pine:cycle` AND IT IS NOW `pine:undefined`, BECAUSE THE
    // MEANING OF THE SCRIPT CHANGED UNDER IT — not because a guard was weakened.
    // Once a binding carries the environment it was written in, `x = x + 1` reads
    // the `x` that existed BEFORE the line, and there is none: Pine itself
    // rejects this with "Undeclared identifier 'x'". `pine:cycle` stays reachable
    // through a self-calling function (the case above), which is the shape that
    // really is circular.
    ['a name defined in terms of itself before it exists',
      '//@version=5\nindicator("t")\nx = x + 1\nplot(x)\n',
      'pine:undefined', 3, 5, 'x'],
    ['a script with nothing to filter on',
      '//@version=5\nindicator("t")\nx = ta.rsi(close, 14)\n',
      'pine:no-output', null, null, null],
    ['nothing at all',
      '   \n',
      'pine:empty', null, null, null],
  ]

  // ── the clock sentence: a name this engine HOLDS ───────────────────────────
  //
  // ⛔ THIS CANNOT LIVE IN THE TABLE ABOVE, because that loop asserts the message
  // carries `REFUSALS[guard]` -- the GENERIC sentence -- and the whole point here
  // is that a clock name gets a DIFFERENT one. Same guard, different sentence.
  //
  // ⭐ The three properties that matter, and each is asserted separately:
  //   1. it is NOT `pine:undefined` -- the member did not make a mistake;
  //   2. it says the engine HOLDS the column, and names the manifest key;
  //   3. it names what would unblock it, so the refusal is countable.
  // Derived from `TABLE.clock`, so a clock entry added tomorrow is covered the
  // day it lands and a clock entry removed makes this fail rather than rot.
  describe('a clock name refuses BY NAME and does not blame the member', () => {
    const CLOCK = Object.keys(TABLE.clock || {}).filter((k) => !k.startsWith('_'))

    it('the manifest actually declares a clock section — else this proves nothing', () => {
      expect(CLOCK.length).toBeGreaterThan(5)
      expect(CLOCK).toContain('dayofweek')
    })

    // ⭐⭐ THESE NOW RESOLVE. The refusal these cases used to assert said so
    // itself — "TO UNBLOCK: teach this door to resolve a clock name the way it
    // already resolves a series name; nothing new has to be measured or
    // documented first" — and that is exactly what was done. A clock leaf IS a
    // `series` node (`parseFormula('dayofweek > 3')` proves it), so binding one
    // is the resolution this door already performs for `close`, over a manifest
    // section it had simply not been told to read.
    for (const spelling of ['dayofweek', 'year', 'bar_index', 'hour', 'month']) {
      it(`${spelling} RESOLVES to the clock column this engine holds`, () => {
        const out = translatePine(`//@version=5\nindicator("t")\nplot(${spelling})\n`)
        expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
        const first = out.outputs.find((o) => o.refusal === null)
        expect(first, 'no output translated').toBeTruthy()
        // ⚠️ `bar_index` is PINE's spelling of our `barindex`. The tree must carry
        // OUR key, or the engine looks up a column it does not have and the
        // column is NaN on every bar — a translation that reads as a quiet market.
        expect(first.ast).toEqual({
          type: 'series',
          name: spelling === 'bar_index' ? 'barindex' : spelling,
        })
      })
    }

    // ⛔⛔ AND THE NAMES WHOSE MEANING IS NOT OURS STILL REFUSE, NAMING THE
    // DIFFERENCE. This is the half that makes the binding above safe. Pine's
    // `time` is MILLISECONDS since 1970; ours is SECONDS. A script comparing
    // `time > 1600000000000` would have compared a second-count against a
    // millisecond literal and answered false on every bar, forever, under a name
    // we had just claimed to support — and a thousand-fold error does not look
    // wrong on a chart. Spelling alone is not agreement.
    // ⚠️ ONE NAME, because one name is all that can reach this arm. `timenow`,
    // `time_close` and friends are not in our clock AT ALL, so they get the
    // generic sentence — which is true — and a case for them here would have been
    // asserting a message the code cannot produce.
    for (const [spelling, phrase] of [['time', 'MILLISECONDS']]) {
      it(`${spelling} refuses, and the refusal names the DIFFERENCE`, () => {
        const r = refusalOf(`//@version=5\nindicator("t")\nplot(${spelling})\n`)
        expect(r.guard, 'a Pine name we know is not an undefined name').toBe('pine:builtin')
        expect(r.token).toBe(spelling)
        expect(r.message, 'the refusal must say what DIFFERS, not that work is pending')
          .toContain(phrase)
        expect(r.message, 'the old "not wired yet" sentence is no longer true')
          .not.toContain('TO UNBLOCK')
      })
    }

    it('a name the engine does NOT hold still gets the generic sentence', () => {
      // ⚠️ `volume_delta`, not `timenow`: the latter now carries a reason of its
      // own (a wall-clock read is not a property of any bar). This case exists to
      // prove the GENERIC arm still works, so it needs a name with no special
      // sentence — otherwise it would pass for the wrong reason.
      const r = refusalOf('//@version=5\nindicator("t")\nplot(volume_delta)\n')
      expect(r.guard).toBe('pine:builtin')
      expect(r.message).not.toContain('HOLDS that column')
    })

    it('a name nobody declares anywhere still blames nobody but the script', () => {
      const r = refusalOf('//@version=5\nindicator("t")\nplot(zzNotARealName)\n')
      expect(r.guard).toBe('pine:undefined')
    })
  })

  for (const [label, script, guard, line, column, token] of CASES) {
    it(`${label} → ${guard}`, () => {
      const r = refusalOf(script)
      expect(r.guard).toBe(guard)
      expect(r.line).toBe(line)
      expect(r.column).toBe(column)
      if (token !== null) expect(r.token).toBe(token)
      // The message is the door's own, and it carries the guard's sentence.
      expect(r.message).toContain(PINE_REFUSALS[guard].slice(0, 30))
    })
  }

  it('a refusal that names a line shows that line with a caret under the token', () => {
    const r = refusalOf('//@version=5\nindicator("t")\nplot(close % 2)\n')
    expect(r.excerpt).toBe('plot(close % 2)\n           ^')
  })

  it('...and the caret is under the token, on a long line, at a two-digit column', () => {
    // ⛔ A CARET AT COLUMN 1 WOULD SATISFY THE CASE ABOVE if the line were short
    // enough. This one is not.
    const r = refusalOf('//@version=5\nindicator("t")\nplot(ta.sma(close, 5) > ta.sma(request.security(syminfo.tickerid, "D", close), 5) ? 1 : 0)\n')
    const [line, caret] = r.excerpt.split('\n')
    expect(caret.length - 1).toBe(r.column - 1)
    expect(line.slice(r.column - 1, r.column - 1 + r.token.length)).toBe(r.token)
    expect(r.token).toBe('request.security')
  })

  it('a strategy is refused WHOLE, even though its plot would translate', () => {
    // ⛔ Its meaning lives in orders this engine never runs; offering one of its
    // plots as "your scan" reads a different document than the one pasted.
    const out = translatePine('//@version=5\nstrategy("S")\nplot(ta.sma(close, 5))\n')
    expect(out.ok).toBe(false)
    expect(out.selected).toBe(-1)
    expect(out.outputs[0].formula).toBe('sma(close, 5)')
  })

  it('every refusal carries a guard that is DECLARED, never an invented string', () => {
    const seen = new Set()
    for (const [, script] of CASES.map((c) => [c[0], c[1]])) {
      const out = translatePine(script)
      for (const r of out.refusals) {
        expect(Object.keys(PINE_REFUSALS), r.guard).toContain(r.guard)
        seen.add(r.guard)
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(20)
  })
})

// --------------------------------------------------------------------------- //
// the lexer's own edges
// --------------------------------------------------------------------------- //

describe('the lexer', () => {
  it('reads the version pragma and nothing else out of a comment', () => {
    expect(lexPine('//@version=6\nplot(close)').version).toBe(6)
    expect(lexPine('// @version = 5\nplot(close)').version).toBe(5)
    expect(lexPine('plot(close) // @version=4').version).toBe(4)
    expect(lexPine('plot(close)').version).toBe(null)
  })

  it('lexes compound assignment as ONE token, longest first', () => {
    const kinds = lexPine('x += 1').tokens.map((t) => t.value)
    expect(kinds).toEqual(['x', '+=', 1])
  })

  it('joins an indented continuation onto the line above it', () => {
    const script = '//@version=5\nindicator("t")\nx = ta.sma(close, 5) +\n    ta.ema(close, 5)\nplot(x)\n'
    const out = translatePine(script)
    expect(out.ok).toBe(true)
    expect(out.outputs[0].formula).toBe('sma(close, 5) + ema(close, 5)')
  })

  it('a newline inside brackets is never a statement break', () => {
    const script = '//@version=5\nindicator("t")\nplot(ta.sma(\nclose,\n5))\n'
    expect(translatePine(script).outputs[0].formula).toBe('sma(close, 5)')
  })

  it('CRLF reads the same as LF', () => {
    const lf = translatePine('//@version=5\nindicator("t")\nplot(ta.sma(close, 5))\n')
    const crlf = translatePine('//@version=5\r\nindicator("t")\r\nplot(ta.sma(close, 5))\r\n')
    expect(crlf.outputs[0].formula).toBe(lf.outputs[0].formula)
  })
})
