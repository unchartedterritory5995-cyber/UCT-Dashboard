// Wave 10 (Task 10.16): what the builder knows about a plan's own fields. Each mirror is asserted against the server
// rule it copies (be widget_engine/plan.py), and the copied sentences are bound to the server's file itself.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  catalogFields, compileStored, nameProblem, pyStrip, formulaMeasureOptions, formulaSplitFields, formulaFilterFields,
  withFormulaFields, withoutFormulaRefs, compiledOf, formulaProblems, boxPosOf, probeLine, measureLabel, storedOf,
  S_FORMULA_NAME, S_FORMULA_NAME_LONG, S_FORMULA_NAME_TAKEN, S_BAD_CHARACTER, S_GOAL_SOURCE, ROW_AGGS, BOOL_AGGS,
  AGG_WORDS, FORMULA_PREFIX,
} from './formulaFields'
import { indexCatalog } from './builderCatalog'
import { FORMULA_CATALOG } from './__fixtures__/formulaCatalog'
import { LIMITS } from '../../../lib/widgetFormula/widgetFormula'

const CAT = indexCatalog(FORMULA_CATALOG)
const planWith = (formulas, extra = {}) => ({ source: 'closed_trades', measures: [{ key: 'net_pnl' }], filters: [], split: null, formulas, ...extra })
const F = (id, name, expr, format = 'number') => ({ id, name, expr, format })

describe('catalogFields mirrors plan.formula_field_infos', () => {
  it('filterable fields of a known type, enum read as text, hour key and needs-times carried; no ref or property field', () => {
    const fields = catalogFields(CAT, { source: 'closed_trades' })
    expect(fields.get('setup')).toEqual({ key: 'setup', label: 'Setup', type: 'text', hourKey: null, needsTimes: false })
    expect(fields.get('day')).toMatchObject({ type: 'day', hourKey: 'hour_et' })
    expect(fields.get('hold_minutes')).toMatchObject({ type: 'number', needsTimes: true })
    expect(fields.get('mistake')).toMatchObject({ type: 'tag' })       // the dialect refuses it with its own sentence
    for (const [key] of fields) expect(key.startsWith(FORMULA_PREFIX)).toBe(false)
    const fake = indexCatalog({ sources: [{ key: 's', fields: [
      { key: 'a', type: 'number', filter: false }, { key: 'b', type: 'enum', refKind: 'routine' },
      { key: 'property', type: 'number' }, { key: 'c', type: 'weird' }, { key: 'my_field', type: 'number' },
    ] }] })
    expect([...catalogFields(fake, { source: 's' }).keys()]).toEqual(['my_field'])
    expect(catalogFields(fake, { source: 's' }).get('my_field').label).toBe('my field')     // plan._label
    expect(catalogFields(CAT, { source: 'nope' }).size).toBe(0)
  })

  it('a formula never names another: the catalog the sections read has formula fields, catalogFields never does', () => {
    const plan = planWith([F('f1', 'Green', '[net] > 0')])
    const view = withFormulaFields(CAT, plan, compiledOf(CAT, plan))
    expect(view.sources.get('closed_trades').fields.has('formula:f1')).toBe(true)
    expect(catalogFields(view, plan).has('formula:f1')).toBe(false)
    expect(CAT.sources.get('closed_trades').fields.has('formula:f1')).toBe(false)        // the catalog itself untouched
  })
})

describe('the name screen (plan._compile_formulas order)', () => {
  it('pyStrip is Python str.strip, not String.trim', () => {
    expect(pyStrip('\u00A0 a \u3000\n')).toBe('a')
    expect(pyStrip('\u001Ca\u0085')).toBe('a')               // Python strips these; String.trim does not
    expect(pyStrip('\uFEFFa')).toBe('\uFEFFa')               // ...and String.trim strips this; Python does not
    expect(pyStrip(null)).toBe('')
  })

  it('blank, then a hidden character, then too long, then taken (a field label or an earlier name)', () => {
    const check = (name, others = []) => nameProblem(CAT, planWith([...others, F('f9', name, '1')]), 'f9')
    expect(check('  ')).toBe(S_FORMULA_NAME)
    expect(check('\u00A0')).toBe(S_FORMULA_NAME)
    // Where Python's strip and String.trim part ways, the server's answer: a BOM is kept (and refused), U+001C goes.
    expect(check('\uFEFF')).toBe(S_BAD_CHARACTER)
    expect(check('a\u001C')).toBe(null)
    expect(check('a\u200Bb')).toBe(S_BAD_CHARACTER)
    expect(check('x'.repeat(61))).toBe(S_FORMULA_NAME_LONG)
    expect(check('x'.repeat(60))).toBe(null)
    expect(check('🔥'.repeat(60))).toBe(null)                  // 60 code points, 120 UTF-16 units
    expect(check('NET P&L')).toBe(S_FORMULA_NAME_TAKEN)        // a label, ASCII-folded
    expect(check('net')).toBe(null)                            // a key is not a name the member sees
    expect(check('Mine', [F('f1', 'mine', '1')])).toBe(S_FORMULA_NAME_TAKEN)
    // The EARLIER of two equal names is fine (the server adds names in order).
    expect(nameProblem(CAT, planWith([F('f1', 'Mine', '1'), F('f2', 'mine', '2')]), 'f1')).toBe(null)
  })
})

describe('compileStored: the canonical-length check (be 10.4 fix round 1, I-2)', () => {
  const fields = catalogFields(CAT, { source: 'closed_trades' })
  it('typed under the limit, stored over it: too_long at MAX_LENGTH, as the server answers', () => {
    // The server rail's boundary: [Risk $] x 133, padded so the STORED form is exactly 2,000 / 2,001.
    const at = (pad) => Array(133).fill('[Risk $]').join(`${' '.repeat(pad)}+`)
    const ok = compileStored(at(0), fields)
    expect(ok.ok).toBe(true)
    let pad = 0
    while (compileStored(at(pad + 1), fields).ok) pad += 1
    const edge = compileStored(at(pad), fields)
    const over = compileStored(at(pad + 1), fields)
    expect(Array.from(edge.compiled.canonical).length).toBeLessThanOrEqual(LIMITS.MAX_LENGTH)
    expect(at(pad + 1).length).toBeLessThan(LIMITS.MAX_LENGTH)
    expect(over).toEqual({ ok: false, code: 'too_long', sentence: 'A formula can be at most 2,000 characters.', pos: LIMITS.MAX_LENGTH })
    expect(storedOf(at(pad + 1), fields)).toBe(at(pad + 1))                 // refused: stored as typed
  })
})

describe('what a formula can be added as', () => {
  const plan = planWith([
    F('f1', 'Half', '[net] / 2'), F('f2', 'Green', '[net] > 0'), F('f3', 'Day name', 'Weekday([day])'),
    F('f4', 'Wins', 'CountIf([net] > 0)'), F('f5', 'Broken', '[nope]'),
  ])
  const compiled = compiledOf(CAT, plan)

  it('row number: total, average, lowest, highest; row yes/no: how many, what share; aggregate: itself; text: none', () => {
    const opts = formulaMeasureOptions(plan, compiled)
    expect(opts.filter((o) => o.formula === 'f1').map((o) => o.agg)).toEqual([...ROW_AGGS])
    expect(opts.filter((o) => o.formula === 'f2').map((o) => o.agg)).toEqual([...BOOL_AGGS])
    expect(opts.filter((o) => o.formula === 'f3')).toEqual([])
    expect(opts.filter((o) => o.formula === 'f4')).toEqual([{ formula: 'f4', offer: 'Add as a measure', label: 'Wins' }])
    expect(opts.filter((o) => o.formula === 'f5')).toEqual([])                     // refused: nothing to offer
    expect(opts.find((o) => o.formula === 'f1' && o.agg === 'avg').label).toBe('Half (average)')
    expect(measureLabel(CAT, plan, { formula: 'f2', agg: 'count' })).toBe('Green (how many)')
    expect(measureLabel(CAT, plan, { key: 'net_pnl' })).toBe('Net P&L')
    expect([...AGG_WORDS.keys()]).toEqual([...ROW_AGGS, ...BOOL_AGGS])
  })

  it('splits by row text and yes/no only; filters by every row formula, by its type', () => {
    expect(formulaSplitFields(plan, compiled).map((f) => f.key)).toEqual(['formula:f2', 'formula:f3'])
    const filters = new Map(formulaFilterFields(plan, compiled).map((f) => [f.key, f]))
    expect([...filters.keys()]).toEqual(['formula:f1', 'formula:f2', 'formula:f3'])
    expect(filters.get('formula:f1').ops).toEqual(['eq', 'gt', 'gte', 'lt', 'lte', 'between'])
    expect(filters.get('formula:f2').ops).toEqual(['is'])
    expect(filters.get('formula:f2').values).toEqual([{ value: true, label: 'Yes' }, { value: false, label: 'No' }])
    expect(filters.get('formula:f3').ops).toEqual(['in', 'not_in'])
    expect(filters.get('formula:f1').split).toBe(false)
  })

  it('formulaProblems names the refused ones, by the dialect or by the name', () => {
    const p = formulaProblems(CAT, plan, compiled)
    expect([...p.keys()]).toEqual(['f5'])
    expect(p.get('f5')).toBe("[nope] isn't a field here.")
    expect(formulaProblems(CAT, planWith([F('f1', '', '1')])).get('f1')).toBe(S_FORMULA_NAME)
  })
})

describe('removing a field takes what reads it', () => {
  it('its measures, its filters, a split by it (a second split by it alone leaves the first)', () => {
    const plan = planWith([F('f1', 'G', '[net] > 0')], {
      measures: [{ key: 'net_pnl' }, { formula: 'f1', agg: 'count' }],
      filters: [{ field: 'formula:f1', op: 'is', values: [true] }, { field: 'setup', op: 'in', values: ['Flag'] }],
      split: { by: 'setup', then: 'formula:f1' },
    })
    expect(withoutFormulaRefs(plan, 'f1')).toEqual({
      measures: [{ key: 'net_pnl' }], filters: [{ field: 'setup', op: 'in', values: ['Flag'] }],
      split: { by: 'setup', then: null },
    })
    expect(withoutFormulaRefs({ ...plan, split: { by: 'formula:f1', then: 'setup' } }, 'f1').split).toBe(null)
  })
})

describe('positions in the box are UTF-16 (10.3 M1)', () => {
  const fields = catalogFields(CAT, { source: 'closed_trades' })
  it('a code point position over the text as typed', () => {
    expect(boxPosOf('"🔥" + x', 6, '"🔥" + x', fields)).toBe(7)      // the emoji is two units
    expect(boxPosOf('ab', 9, 'ab', fields)).toBe(2)                  // past the end: the end
    expect(boxPosOf('ab', null, 'ab', fields)).toBe(null)
  })
  it('a server position into the canonical form, read in the label syntax the box shows', () => {
    expect(boxPosOf('[net] / [shares]', 8, '[Net P&L] / [Shares]', fields)).toBe(12)
    expect(boxPosOf('"🔥" = [setup] + [nope]', 17, '"🔥" = [Setup] + [nope]', fields)).toBe(18)
  })
})

describe('the first-row line', () => {
  it('the noun is the source unit, from the one noun table: a tracker counts entries (fix 1, m-4)', () => {
    expect(probeLine({ first: 3 }, { kind: 'row', format: 'number', unit: 'entries' })).toBe('First entry: 3')
    expect(probeLine({ first: 3 }, { kind: 'aggregate', format: 'number', unit: 'entries' })).toBe('All entries: 3')
    expect(probeLine({ first: 3 }, { kind: 'row', format: 'number', unit: 'positions' })).toBe('First position: 3')
    expect(probeLine({ first: 3 }, { kind: 'row', format: 'number', unit: 'strategies' })).toBe('First strategy: 3')
    expect(probeLine({ first: 3 }, { kind: 'row', format: 'number', unit: 'notes' })).toBe('First note: 3')
    // Every unit the real catalog serves has its own word (never the trades fallback for another unit).
    const units = new Set([...CAT.sources.values()].map((s) => s.unit))
    for (const unit of [...units, 'entries', 'strategies']) {
      const line = probeLine({ first: 1 }, { kind: 'row', format: 'number', unit })
      if (unit !== 'trades') expect(line, unit).not.toBe('First trade: 1')
    }
  })

  it('reads the probe by the field format, for one row or every row', () => {
    expect(probeLine({ first: 0.42 }, { kind: 'row', format: 'number', unit: 'trades' })).toBe('First trade: 0.42')
    expect(probeLine({ first: -12.5 }, { kind: 'row', format: 'money', unit: 'trades' })).toBe('First trade: -$12.50')
    expect(probeLine({ first: 0.25 }, { kind: 'row', format: 'percent', unit: 'days' })).toBe('First day: 25%')
    expect(probeLine({ first: 1.5 }, { kind: 'row', format: 'r', unit: 'trades' })).toBe('First trade: 1.5R')
    expect(probeLine({ first: true }, { kind: 'row', format: 'number', unit: 'trades' })).toBe('First trade: Yes')
    // No value, no line (fix 1, m-5): the server's skip notice is what the member reads.
    expect(probeLine({ first: null }, { kind: 'row', format: 'number', unit: 'trades' })).toBe('')
    expect(probeLine({ first: 31 }, { kind: 'aggregate', format: 'number', unit: 'trades' })).toBe('All trades: 31')
    expect(probeLine(null, {})).toBe('')
  })
})

// ── the copied sentences and tables, bound to the server ─────────────────────────────────────────────────────────
// `formulaFields.js` copies plan.py's sentences verbatim. Ruling W10-R53 (Task 10.9, armed at the be->impl merge): the
// copies are bound through the shared vectors file's `plan_sentences` section, which be's
// `test_plan_sentences_in_the_vectors_are_plan_py_constants` rails against plan.py. The two aggregate tables have no
// vectors section, so they are still read from the plan.py in this tree (the merged one: PLAN_VERSION 3).
const PLAN_PY = join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine', 'plan.py')
// The shared vectors file, read from the repo (cwd is app/), never imported into a bundle.
const DOC = JSON.parse(readFileSync(join(process.cwd(), '..', 'tests', 'fixtures', 'widgetFormulaVectors.json'), 'utf8'))
const SENTENCES = [
  ['S_FORMULA_NAME', S_FORMULA_NAME], ['S_FORMULA_NAME_LONG', S_FORMULA_NAME_LONG],
  ['S_FORMULA_NAME_TAKEN', S_FORMULA_NAME_TAKEN], ['S_BAD_CHARACTER', S_BAD_CHARACTER], ['S_GOAL_SOURCE', S_GOAL_SOURCE],
]
/** `NAME = "..."` or `NAME = '...'` in Python source, unescaped. */
function pyConstant(src, name) {
  const m = new RegExp(`^${name} = (["'])((?:\\\\.|(?!\\1).)*)\\1\\s*$`, 'm').exec(src)
  return m ? m[2].replace(/\\(["'\\])/g, '$1') : undefined
}

describe("the copied sentences are the server's", () => {
  it("every copy equals the vectors' plan_sentences (W10-R53)", () => {
    const shared = DOC.plan_sentences
    expect(shared && typeof shared === 'object').toBe(true)
    for (const [name, value] of SENTENCES) {
      expect(Object.hasOwn(shared, name), name).toBe(true)     // a copy the section does not carry is not bound
      expect(value, name).toBe(shared[name])
    }
  })

  it('the aggregate tables equal plan.py (the merged, wave 10 one)', () => {
    const src = readFileSync(PLAN_PY, 'utf8')
    expect(Number(/^PLAN_VERSION = (\d+)\s*$/m.exec(src)?.[1])).toBeGreaterThanOrEqual(3)
    expect(src).toMatch(/^ROW_AGGS = \("sum", "avg", "min", "max"\)/m)
    expect(src).toMatch(/^BOOL_AGGS = \("count", "share"\)/m)
    expect(ROW_AGGS).toEqual(['sum', 'avg', 'min', 'max'])
    expect(BOOL_AGGS).toEqual(['count', 'share'])
  })

  it('CONTROL: the reader finds a constant in either quote style, and a changed sentence is seen', () => {
    expect(pyConstant('S_X = "It can\'t be."\n', 'S_X')).toBe("It can't be.")
    expect(pyConstant("S_Y = 'A goal target works on closed trades or trading days.'\n", 'S_Y')).toBe(S_GOAL_SOURCE)
    expect(pyConstant('S_Z = "Something else."\n', 'S_Z')).not.toBe(S_GOAL_SOURCE)
    expect(pyConstant('S_Q = "x"\n', 'S_MISSING')).toBe(undefined)
  })
})
