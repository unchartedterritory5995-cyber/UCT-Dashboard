// ⛔ THE EDITOR WRITES NO SENTENCE OF ITS OWN. A diagnostic's message is the
// refusing door's, byte for byte, and its range is DERIVED — from the door's own
// offset (`at character N`, `index`), its own token, its own line/column, or —
// for a `let` source, where a parser offset indexes text nobody typed — from the
// pre-pass's own `lineOffset`. An acorn walk over the module proves there is no
// sentence to leak.
//
// ⚰️ TWO THINGS IN THE BRIEF'S DRAFT OF THIS FILE WERE MEASURED WRONG AND ARE
// FIXED HERE, each beside the measurement that corrects it:
//   1. the planted translator refusal carried `column: 5` while asserting the
//      mark starts at `nosuch`, which is column 4. Pine numbers columns from 1
//      (`pine.js`: `const col = i - lineStart + 1`), so the two assertions could
//      not both hold. The column is now DERIVED from the line it describes, and
//      a REAL `translatePine` refusal pins the convention against the translator.
//   2. `close > foo(close, 3)` was described as refusing at read time. It PARSES;
//      `resolve:function` is thrown by `checkBudget` and surfaces through
//      `evaluateFormula`. The case below is unchanged — the guard it asserts is
//      the measured one either way — but nothing here re-derives a door's stage.

import { describe, it, expect } from 'vitest'
import { parse as parseJs } from 'acorn'
import { Text } from '@codemirror/state'
// ⭐ THE ARTIFACT, READ THROUGH VITE'S RESOLVER — the ruling `deps.test.js`
// already records: `fs` + `__dirname` is a `no-undef` to this repo's
// browser-only eslint globals, and `import.meta.url` is not a `file:` URL under
// this transform. `IndicatorSettingsDialog.test.jsx` reads `StockChart.jsx?raw`
// for exactly this reason.
import DIAGNOSTICS_SRC from './diagnostics.js?raw'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUT_SCOPE } from '../builderInputs'
import { translatePine } from '../../engine/ast/pine'
import { toDiagnostics } from './diagnostics'

const doc = (s) => Text.of(s.split('\n'))

describe('the range is the door\'s own', () => {
  it('a translator refusal at a line and a column lands at that buffer offset, message byte-identical', () => {
    const src = 'sma(close, 20)\n + nosuch'
    const refusal = {
      guard: 'pine:name',
      message: 'planted sentence from a translator',
      line: 2,
      column: 4,
      token: 'nosuch',
    }
    // The fixture's column is the MEASURED 1-based column of the token it names,
    // not a number typed beside an assertion that disagrees with it.
    expect(refusal.column).toBe(src.split('\n')[1].indexOf('nosuch') + 1)
    const [d] = toDiagnostics(doc(src), refusal)
    expect(d.from).toBe(src.indexOf('nosuch'))
    expect(d.to).toBe(src.indexOf('nosuch') + 'nosuch'.length)
    expect(d.message).toBe(refusal.message)
    expect(d.source).toBe('pine:name')
    expect(d.severity).toBe('error')
  })

  it('…and the 1-based convention is the REAL translator\'s, not this file\'s belief about it', () => {
    const src = '//@version=5\nindicator("x")\nplot(ta.nosuchfn(close, 3))'
    const { refusal } = translatePine(src)
    expect(refusal.guard).toBe('pine:function')
    const [d] = toDiagnostics(doc(src), refusal)
    expect(d.from).toBe(src.indexOf('ta.nosuchfn'))
    expect(d.to).toBe(src.indexOf('ta.nosuchfn') + 'ta.nosuchfn'.length)
    expect(d.message).toBe(refusal.message)
    expect(d.source).toBe('pine:function')
  })

  it('jsep\'s offset is read off ITS message — "at character N" — never re-parsed', () => {
    const src = 'sma(close, 20'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('parser')
    const [d] = toDiagnostics(doc(src), r)
    expect(r.error).toMatch(/ at character 13$/)
    expect(d.message).toBe(r.error)
    // the door stopped at end of input: a one-character mark ending there
    expect([d.from, d.to]).toEqual([12, 13])
  })

  it('a TC2000 refusal carries index + token through evaluateFormula and marks exactly the token', () => {
    const src = 'C > AVGC50 AND XYZZY'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('pcf:name')
    expect(r.index).toBe(15)
    expect(r.token).toBe('XYZZY')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([15, 20])
    expect(d.message).toBe(r.error)
  })

  it('a table refusal that quotes its token marks the token where it sits', () => {
    const src = 'close > foo(close, 3)'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('resolve:function')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([8, 11])
    expect(d.source).toBe('resolve:function')
  })

  it('…and it is the WHOLE identifier, so a longer name that merely starts the same is not it', () => {
    const src = 'nosuchfnx > nosuchfn(close, 3)'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('resolve:function')
    expect(r.error).toMatch(/"nosuchfn"/)
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([12, 20])
    // a plain substring search would have marked `nosuchfn` inside `nosuchfnx`
    expect(d.from).not.toBe(src.indexOf('nosuchfn'))
  })

  it('a refusal with no locatable token marks the whole buffer rather than guessing', () => {
    const src = 'close[-1]'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('canonicalise:offset-forward')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([0, src.length])
  })

  it('an evaluation that passed, or a blank one, produces no diagnostic', () => {
    expect(toDiagnostics(doc('sma(close, 20)'), evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE))).toEqual([])
    expect(toDiagnostics(doc(''), evaluateFormula('', BUILDER_INPUT_SCOPE))).toEqual([])
    expect(toDiagnostics(doc('x'), null)).toEqual([])
    // ⛔ `ok` IS THE VERDICT, not the presence of a sentence. A result that
    // passed carries no mark even when a sentence is still hanging off it —
    // otherwise a stale message from an earlier keystroke reds a good formula.
    expect(toDiagnostics(doc('sma(close, 20)'), {
      ok: true, guard: 'parser', error: 'a sentence from an earlier keystroke',
    })).toEqual([])
  })
})

// ─── the `let` pre-pass: a parser offset indexes text nobody typed ───────────
//
// ⛔ CONTROLLER AMENDMENT 2026-08-26. `prepareSource` INLINES bindings, so the
// offset in `Expected ) at character 36` counts characters of the rewritten
// string. `letPrepass.js` returns `lineOffset` for exactly this
// (`authorLine = inlinedLine + lineOffset`) and states that column-within-line is
// NOT recoverable — so the mark goes on the mapped LINE, and the sentence is left
// alone.
describe('a `let` source is marked in the member\'s own coordinates', () => {
  it('the expression\'s syntax error marks the AUTHOR\'s line, never the inlined offset', () => {
    const src = 'let fast = ema(close, 12)\nlet slow = ema(close, 26)\nfast - slow('
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('parser')
    expect(r.error).toBe('Expected ) at character 36')
    const [d] = toDiagnostics(doc(src), r)
    // author line 3 — the line the member typed the stray `(` on
    expect([d.from, d.to]).toEqual([src.indexOf('fast - slow('), src.length])
    // …and the raw offset is NOT where the mark went. Character 36 sits inside
    // the SECOND `let` line, where there is nothing wrong at all.
    expect(d.from).not.toBe(36)
    expect(36).toBeLessThan(src.indexOf('fast - slow('))
    // ⛔ the message is the engine's, unedited
    expect(d.message).toBe(r.error)
  })

  it('a blank line INSIDE the expression does not slide the mark — the contract W1b kept them for', () => {
    const src = 'let d = high - low\n\nd >\n\nnosuch('
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('parser')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([src.indexOf('nosuch('), src.length])
  })

  it('a mapping that lands on a BLANK line falls back to the expression region, not a zero-width mark', () => {
    // `Expected expression after + at character 6` maps to inlined line 2, which
    // is the trailing blank the pre-pass kept — and a zero-width range renders as
    // nothing at all, so there would be no mark to act on.
    const src = 'let x = 2\nx +\n'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('parser')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([src.indexOf('x +'), src.length])
    expect(d.to).toBeGreaterThan(d.from)
  })

  it('a `let:*` refusal marks the token the PRE-PASS named, not the first place that word appears', () => {
    const src = 'let a = 1\nlet a = 2\na'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('let:shadow')
    const [d] = toDiagnostics(doc(src), r)
    // the SECOND binding is the offending one — line 2, column 5
    expect([d.from, d.to]).toEqual([14, 15])
    // the first `a` (line 1) is what a search of the sentence's own token finds,
    // and it is the wrong one
    expect(d.from).not.toBe(src.indexOf('a', 3))
    expect(d.message).toBe(r.error)
  })

  it('a quoted token in a `let` source is still marked where the MEMBER typed it', () => {
    const src = 'let fast = ema(close, 12)\n\nfast > nosuchfn(close, 3)'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(r.guard).toBe('resolve:function')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([src.indexOf('nosuchfn'), src.indexOf('nosuchfn') + 'nosuchfn'.length])
  })

  it('⛔ and the mapping is the NATIVE reader\'s alone — a TC2000 index is never remapped', () => {
    // `parsePcf` never sees the pre-pass, so its offset already indexes the
    // member's text. Remapping it would move a correct mark onto a whole line.
    const src = 'let x = 5\nC > AVGC50 AND XYZZY'
    const r = evaluateFormula(src, BUILDER_INPUT_SCOPE, 'pcf')
    expect(r.dialect).toBe('pcf')
    expect(r.guard).toBe('pcf:name')
    expect(r.token).toBe('let')
    const [d] = toDiagnostics(doc(src), r)
    expect([d.from, d.to]).toEqual([0, 3])
  })
})

describe('⛔ 1:1, across every refusal this surface produces', () => {
  const CORPUS = Object.freeze([
    'sma(close, 20',
    'C > AVGC50 AND XYZZY',
    'close > foo(close, 3)',
    'close[-1]',
    'sma(close)',
    'close * nosuch',
    'close > nosuchfn(close, 3)',
    'accum(close, sma(self, 3), 5)',
    'close.high',
    'let fast = ema(close, 12)\nlet slow = ema(close, 26)\nfast - slow(',
    'let close = 5\nclose > 1',
    'let a = 1\nlet a = 2\na',
    'let x = close\nlet y = z * 2\nlet z = 3\nx + y',
    'let d = high - low\n\nd >\n\nnosuch(',
    'sma(close, 20)',
    '',
  ])

  it('the message is the door\'s byte for byte, the guard rides as `source`, the range is inside the buffer', () => {
    let refused = 0
    for (const src of CORPUS) {
      const label = JSON.stringify(src)
      const r = evaluateFormula(src, BUILDER_INPUT_SCOPE)
      const ds = toDiagnostics(doc(src), r)
      if (r.ok || !r.error) {
        expect(ds, `${label} did not refuse`).toEqual([])
        continue
      }
      refused += 1
      expect(ds, label).toHaveLength(1)
      const [d] = ds
      expect(d.message, label).toBe(r.error)
      expect(d.source, label).toBe(r.guard)
      expect(d.severity, label).toBe('error')
      expect(d.from, label).toBeGreaterThanOrEqual(0)
      expect(d.to, label).toBeLessThanOrEqual(src.length)
      expect(d.to, label).toBeGreaterThanOrEqual(d.from)
    }
    // ⛔ the sweep is not vacuous — most of the corpus really does refuse
    expect(refused).toBeGreaterThanOrEqual(12)
  })

  it('`error` outranks `message` when a refusal carries both, and a guardless refusal carries no `source`', () => {
    const [d] = toDiagnostics(doc('close'), { error: 'the door said this', message: 'and something else said this' })
    expect(d.message).toBe('the door said this')
    expect('source' in d).toBe(false)
  })
})

describe('⛔ the module contains no sentence', () => {
  function stringsEndingInAPeriod(source) {
    const ast = parseJs(source, { ecmaVersion: 'latest', sourceType: 'module' })
    const found = []
    ;(function walk(node) {
      if (!node || typeof node.type !== 'string') return
      if (node.type === 'Literal' && typeof node.value === 'string' && /\.\s*$/.test(node.value)) found.push(node.value)
      if (node.type === 'TemplateElement' && /\.\s*$/.test(node.value.cooked || '')) found.push(node.value.cooked)
      for (const key of Object.keys(node)) {
        const v = node[key]
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v.type === 'string') walk(v)
      }
    })(ast)
    return found
  }

  it('no string literal in diagnostics.js ends with a period', () => {
    expect(stringsEndingInAPeriod(DIAGNOSTICS_SRC)).toEqual([])
  })

  it('…and the walker can see one (the control)', () => {
    expect(stringsEndingInAPeriod('const m = "this formula repaints."; const t = `and so does this.`')).toHaveLength(2)
  })
})
