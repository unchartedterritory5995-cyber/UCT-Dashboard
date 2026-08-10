// The Pine door: what it translates, what it refuses, and where it points.
//
// ⭐ THE REFUSAL CASES ARE THE SUBJECT OF THIS FILE, NOT ITS EDGE CASES. A
// translator that half-reads a script produces a scan that is confidently about
// something else, so every case below asserts the GUARD **and** the LINE and
// COLUMN — "it threw" is satisfiable by a translator that throws at the wrong
// place for the wrong reason.

import { describe, it, expect } from 'vitest'
import {
  translatePine, printFormula, treeYieldsBool, lexPine,
  REFUSALS as PINE_REFUSALS,
} from './pine.js'
import { parseFormula, astHash, TABLE, REFUSALS as PARSE_REFUSALS } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS } from './interpret.js'
import { REFUSALS as BUDGET_REFUSALS } from './budget.js'
import { REFUSALS as SENTENCE_REFUSALS, sentenceFor, yieldsOf } from './sentence.js'

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
    ['var state',
      '//@version=5\nindicator("t")\nvar float total = 0.0\nplot(total)\n',
      'pine:state', 3, 1, 'var'],
    // ⚠️ FOUR CASES USED TO SIT HERE AND THEY MOVED TO `pine.variables.test.js`,
    // WHERE THEY ARE NOW ASSERTED TO TRANSLATE: a `:=` inside a block, a compound
    // assignment, `v = if …`, and `f(x) => x * 2`. What is refused about a
    // reassignment was never the token — it is whether the value crosses a bar —
    // so the cases below are the ones that actually do.
    ['a reassignment that reads the previous bar, which is state with no var in sight',
      '//@version=5\nindicator("t")\nx = 0.0\nx := x[1] + volume\nplot(x)\n',
      'pine:state', 4, 7, '['],
    ['a var accumulator, which is the same thing spelled the usual way',
      '//@version=5\nindicator("t")\nvar count = 0\ncount := count + 1\nplot(count)\n',
      'pine:state', 3, 1, 'var'],
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
    ['na',
      '//@version=5\nindicator("t")\nplot(close > open ? close : na)\n',
      'pine:na', 3, 29, 'na'],
    ['nz, which is na wearing a hat',
      '//@version=5\nindicator("t")\nplot(nz(ta.sma(close, 5), 0))\n',
      'pine:na', 3, 6, 'nz'],
    ['a text value',
      '//@version=5\nindicator("t")\nplot(close > 0 ? "up" : "down")\n',
      'pine:text-value', 3, 18, 'up'],
    ['a colour value',
      '//@version=5\nindicator("t")\nplot(#FF0000)\n',
      'pine:colour-value', 3, 6, '#FF0000'],
    ['a bar-index built-in',
      '//@version=5\nindicator("t")\nplot(bar_index)\n',
      'pine:builtin', 3, 6, 'bar_index'],
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
