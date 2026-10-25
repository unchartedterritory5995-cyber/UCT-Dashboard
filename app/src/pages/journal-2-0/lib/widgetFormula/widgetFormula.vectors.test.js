// @vitest-environment node
/**
 * Task 10.3: the widget formula client twin, held to the SHARED vector file.
 *
 * `tests/fixtures/widgetFormulaVectors.json` (Task 10.2) is the one authority on how the dialect
 * answers; the server (`api/services/journal_two/widget_formula.py`) is held to the same file by
 * `tests/test_widget_formula_vectors.py`. So the two twins agree with each other because each
 * agrees with the file, entry by entry, never because one was recorded from the other.
 *
 * Every section is exercised, and a non-vacuity check counts each one: if the JSON path ever
 * resolves to nothing, or a section is renamed, the counts fail rather than a loop over an empty
 * array passing.
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  LIMITS, FUNCTIONS, FUNCTION_DOCS, ERRORS, ARITY_WORDS,
  compileFormula, displayFormula, displayName, evalRow, evalGroup, emptyFieldOf, skipNotice, suggest,
} from './widgetFormula.js'
import { DOC, FIELDS, decode, build, fieldsOf, rowsOf, same } from './test-vectors.js'

const cpLen = (s) => Array.from(s).length
const label = (v, i) => `${i}: ${String(v.name || v.expr || '').slice(0, 40)}`
const cases = (section) => section.map((v, i) => [label(v, i), v])

const RAN = {
  compile: 0, eval_row: 0, eval_group: 0, errors: 0, limits: 0, hostile: 0,
  skip_notice: 0, empty_field: 0, display_cases: 0,
}

describe('the file carries the same constants and copy as this module', () => {
  it('constants, functions, docs, arity words and error templates', () => {
    expect(DOC.version).toBe(1)
    expect(LIMITS).toEqual(DOC.constants)
    expect([...FUNCTIONS]).toEqual(DOC.functions)
    expect(FUNCTION_DOCS.map((d) => ({ ...d }))).toEqual(DOC.function_docs)
    expect({ ...ARITY_WORDS }).toEqual(DOC.arity_words)
    expect({ ...ERRORS }).toEqual(DOC.error_templates)
  })

  it('NON-VACUITY: every section is present and as large as the server side requires', () => {
    const want = {
      compile: 40, eval_row: 50, eval_group: 25, errors: Object.keys(ERRORS).length, limits: 6,
      hostile: 40, skip_notice: 4, empty_field: 3, display_cases: 3,
    }
    for (const [section, min] of Object.entries(want)) {
      expect(Array.isArray(DOC[section]), section).toBe(true)
      expect(DOC[section].length, section).toBeGreaterThanOrEqual(min)
    }
    expect(FIELDS.size).toBe(DOC.fields.length)
    expect(FIELDS.size).toBeGreaterThan(5)
  })

  it('CONTROL: the comparator refuses -0, a bool for a number, and a near miss', () => {
    expect(same(0, 0)).toBe(true)
    expect(same(-0, 0)).toBe(false)
    expect(same(false, 0)).toBe(false)
    expect(same(1e-12, 0)).toBe(false)
    expect(same(2.5 + 1e-12, 2.5)).toBe(true)
    expect(same(2.6, 2.5)).toBe(false)
    expect(same(null, 0)).toBe(false)
  })
})

describe('compile_vectors', () => {
  it.each(cases(DOC.compile))('%s', (_n, v) => {
    const r = compileFormula(v.expr, FIELDS)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    const c = r.compiled
    expect({
      canonical: c.canonical, display: displayFormula(c.canonical, FIELDS), kind: c.kind, type: c.type,
      fields: [...c.fields], needs_times: c.needsTimes, bucket_labels: c.bucketLabels ? [...c.bucketLabels] : null,
    }).toEqual({
      canonical: v.canonical, display: v.display, kind: v.kind, type: v.type, fields: v.fields,
      needs_times: v.needs_times, bucket_labels: v.bucket_labels,
    })
    // A canonical formula is itself a formula that compiles to the same canonical text.
    expect(compileFormula(c.canonical, FIELDS).compiled.canonical).toBe(c.canonical)
    RAN.compile += 1
  })
})

describe('eval_row_vectors', () => {
  it.each(cases(DOC.eval_row))('%s', (_n, v) => {
    const r = compileFormula(v.expr, FIELDS)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.compiled.kind).toBe('row')
    const got = evalRow(r.compiled, decode(v.row))
    expect(same(got, v.expect), `got ${String(got)} (${Object.is(got, -0) ? '-0' : typeof got}), want ${JSON.stringify(v.expect)}`).toBe(true)
    RAN.eval_row += 1
  })
})

describe('eval_group_vectors', () => {
  it.each(cases(DOC.eval_group))('%s', (_n, v) => {
    const r = compileFormula(v.expr, FIELDS)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.compiled.kind).toBe('aggregate')
    const got = evalGroup(r.compiled, rowsOf(v.rows))
    expect(same(got, v.expect), `got ${String(got)}, want ${JSON.stringify(v.expect)}`).toBe(true)
    RAN.eval_group += 1
  })
})

describe('error_vectors_code_sentence_pos', () => {
  it.each(cases(DOC.errors))('%s', (_n, v) => {
    const r = compileFormula(build(v), FIELDS)
    expect({ ok: r.ok, code: r.code, sentence: r.sentence, pos: r.pos })
      .toEqual({ ok: false, code: v.code, sentence: v.sentence, pos: v.pos })
    RAN.errors += 1
  })

  it('every error code has a vector', () => {
    expect(new Set(DOC.errors.map((v) => v.code))).toEqual(new Set(Object.keys(ERRORS)))
  })
})

describe('limit_vectors', () => {
  it.each(cases(DOC.limits))('%s', (_n, v) => {
    const r = compileFormula(build(v), FIELDS)
    if (v.ok) {
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect(same(evalRow(r.compiled, {}), v.value)).toBe(true)
    } else {
      expect({ ok: r.ok, code: r.code, pos: r.pos }).toEqual({ ok: false, code: v.code, pos: v.pos })
    }
    RAN.limits += 1
  })

  it('the limit cases sit on both sides of each edge (counted in code points)', () => {
    const by = new Map(DOC.limits.map((v) => [v.name, v]))
    expect(cpLen(build(by.get('length 2000 passes')))).toBe(LIMITS.MAX_LENGTH)
    expect(cpLen(build(by.get('length 2001 fails')))).toBe(LIMITS.MAX_LENGTH + 1)
    expect(build(by.get('depth 32 passes')).split('(').length - 1).toBe(LIMITS.MAX_DEPTH)
    expect(build(by.get('depth 33 fails')).split('(').length - 1).toBe(LIMITS.MAX_DEPTH + 1)
    expect(cpLen(build(by.get('501 tokens fail')))).toBe(LIMITS.MAX_TOKENS + 1)
  })
})

function timed(expr) {
  let best = Infinity
  let out
  for (let k = 0; k < 3; k += 1) {
    const t0 = performance.now()
    out = compileFormula(expr, FIELDS)
    best = Math.min(best, performance.now() - t0)
  }
  return [out, best]
}

describe('hostile_vectors_never_throw', () => {
  it.each(cases(DOC.hostile))('%s', (_n, v) => {
    const expr = build(v)
    const [r, ms] = timed(expr)
    expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(50)
    if (v.ok) {
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect(r.compiled.canonical).toBe(v.canonical)
    } else {
      expect({ ok: r.ok, code: r.code, pos: r.pos }).toEqual({ ok: false, code: v.code, pos: v.pos })
      expect(r.sentence).toBe(String(r.sentence))
      for (const slot of ['{x}', '{label}', '{Fn}', '{n}', '{what}']) expect(r.sentence.includes(slot)).toBe(false)
    }
    RAN.hostile += 1
  })

  it('NON-VACUITY: the hostile list carries what the brief names', () => {
    const exprs = DOC.hostile.map(build)
    const joined = exprs.filter((e) => e.length < 5000).join('\n')
    for (const needle of ['"', '--', ';', '$.', '%', '_', '\\', '\u0000', '‮', '［',
      '__proto__', 'constructor', 'toString', '\uD800']) {
      expect(joined.includes(needle), JSON.stringify(needle)).toBe(true)
    }
    expect(exprs.some((e) => e === '('.repeat(10000))).toBe(true)
    expect(exprs.some((e) => cpLen(e) >= 1000000)).toBe(true)
  })

  it('non-string input is a refusal, never a throw', () => {
    for (const bad of [null, undefined, 5, ['1'], { expr: '1' }, true]) {
      expect(compileFormula(bad, FIELDS)).toEqual({ ok: false, code: 'empty', sentence: ERRORS.empty, pos: 0 })
    }
  })

  it('a row is read for its OWN keys only: __proto__, constructor and inherited keys are data', () => {
    const c = compileFormula('[setup] = "x"', FIELDS).compiled
    const own = JSON.parse('{"__proto__": {"setup": "x"}}')
    expect(evalRow(c, own)).toBe(null)
    expect(evalRow(c, Object.create({ setup: 'x' }))).toBe(null)
    expect(evalRow(c, { constructor: 'x' })).toBe(null)
    expect(evalRow(c, { setup: '__proto__' })).toBe(false)
    let ran = false
    const getter = Object.defineProperty({}, 'setup', { get() { ran = true; return 'x' }, enumerable: true })
    expect(evalRow(c, getter)).toBe(null)
    expect(ran).toBe(false)
    expect(evalRow(c, { setup: 'X' })).toBe(true) // CONTROL: an own value is read (and folded)
  })

  it('[__proto__], [constructor] and friends are unknown fields; constructor() is not a function', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      expect(compileFormula(`[${name}]`, FIELDS)).toEqual({
        ok: false, code: 'unknown_field', sentence: `[${name}] isn't a field here.`, pos: 0,
      })
    }
    for (const name of ['constructor', 'toString', 'valueOf', 'eval', 'Function']) {
      expect(compileFormula(`${name}(1)`, FIELDS).code).toBe('unknown_function')
    }
  })

  it('the depth counter answers before the stack: deep nesting is a refusal at once', () => {
    for (const expr of ['('.repeat(1999), 'Abs('.repeat(499), 'If(TRUE, '.repeat(200)]) {
      const r = compileFormula(expr, FIELDS)
      expect(['too_deep', 'too_long']).toContain(r.code)
    }
    expect(compileFormula(`${'Abs('.repeat(32)}1${')'.repeat(32)}`, FIELDS).ok).toBe(true)
  })
})

describe('skip_notice, empty_field and display_cases vectors', () => {
  it.each(DOC.skip_notice.map((v, i) => [`${i}: ${JSON.stringify(v.slice(0, 2))}`, v]))('skip_notice %s', (_n, v) => {
    const [n, lab, one, many, want] = v
    expect(skipNotice(n, lab, one, many)).toBe(want)
    RAN.skip_notice += 1
  })

  it.each(cases(DOC.empty_field))('empty_field %s', (_n, v) => {
    const r = compileFormula(v.expr, FIELDS)
    expect(r.ok).toBe(true)
    expect(emptyFieldOf(r.compiled, decode(v.row))).toBe(v.expect)
    RAN.empty_field += 1
  })

  it.each(cases(DOC.display_cases))('display_cases %s', (_n, v) => {
    const fields = fieldsOf(v.fields)
    const shownText = displayFormula(v.canonical, fields)
    expect(shownText).toBe(v.display)
    const c = compileFormula(v.canonical, fields)
    if (c.ok) expect(compileFormula(shownText, fields).compiled.canonical).toBe(c.compiled.canonical)
    RAN.display_cases += 1
  })

  it('every field of the shared table, shown by its display name, resolves back to itself', () => {
    const usable = new Map([...FIELDS].filter(([, f]) => f.type !== 'tag'))
    for (const [key, fi] of usable) {
      expect(displayName(fi, FIELDS)).toBe(fi.label)
      const c = compileFormula(`[${key}] = [${key}]`, usable).compiled
      expect(compileFormula(displayFormula(c.canonical, FIELDS), usable).compiled.canonical).toBe(c.canonical)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The twin's own hostile fuzz: a deterministic seeded 20,000-formula soup (the server's runs
// 2,000). Nothing throws; every refusal is a known code with an in-range position; every formula
// that compiles evaluates to null, a bool, a text or a finite +0-safe number, and its canonical
// text compiles back to itself.

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = [
  '[net]', '[risk $]', '[r]', '[setup]', '[had_stop]', '[day]', '[mistake]', '[hold minutes]',
  '[nope]', '[', ']', '[__proto__]', '0', '1', '2.5', '-', '+', '*', '/', '=', '<>', '<', '<=', '>',
  '>=', '(', ')', ',', '"Gap"', '""', '"', 'TRUE', 'false', ' ', '\n', '\t', ...FUNCTIONS, 'sumif',
  'ROUND', 'foo', '1e5', '.', '$', '%', "'", '‮', '［', '\u{1F600}', '\u0000', '‍',
  '️', '⃣', '\uD800', ' ', '[constructor]', 'Bucket([r], 0, 1)', 'Hour([day])',
]
const LEAVES = ['[net]', '[risk $]', '[r]', '[hold minutes]', '1', '2.5', '0', '-1']
const BOOLS = ['[had_stop]', 'TRUE', 'false']

function grammar(rnd, depth) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  if (depth <= 0 || rnd() < 0.3) return pick(LEAVES)
  const p = rnd()
  if (p < 0.3) return `${grammar(rnd, depth - 1)} ${pick(['+', '-', '*', '/'])} ${grammar(rnd, depth - 1)}`
  if (p < 0.45) return `(${grammar(rnd, depth - 1)})`
  if (p < 0.6) {
    const cond = `${grammar(rnd, depth - 1)} ${pick(['=', '<>', '<', '<=', '>', '>='])} 0`
    return `If(${pick([cond, pick(BOOLS)])}, ${grammar(rnd, depth - 1)}, ${grammar(rnd, depth - 1)})`
  }
  if (p < 0.75) return `${pick(['Min', 'Max'])}(${grammar(rnd, depth - 1)}, ${grammar(rnd, depth - 1)})`
  if (p < 0.85) return `${pick(['Abs', 'Round', '-'])}(${grammar(rnd, depth - 1)})`
  return `SumIf(${grammar(rnd, 0)}, ${grammar(rnd, 0)} > 0)`
}

function soup(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const kind = rnd()
  if (kind < 0.4) {
    const n = 1 + Math.floor(rnd() * 40)
    let s = ''
    for (let k = 0; k < n; k += 1) s += pick(ALPHABET)
    return s
  }
  const expr = grammar(rnd, 1 + Math.floor(rnd() * 6))
  if (kind < 0.7) return expr
  const cps = Array.from(expr)
  const at = Math.floor(rnd() * (cps.length + 1))
  if (rnd() < 0.5) return [...cps.slice(0, at), pick(ALPHABET), ...cps.slice(at)].join('')
  return [...cps.slice(0, at), ...cps.slice(at + 1)].join('')
}

describe('hostile_fuzz_20k_never_throws', () => {
  it('20,000 seeded formulas: only refusals or compiled formulas, nothing escapes', () => {
    const rnd = mulberry32(103)
    const row = decode(DOC.rowsets.book[0])
    const outcome = { ok: 0, err: 0 }
    const codes = new Set()
    const known = new Set(Object.keys(ERRORS))
    for (let k = 0; k < 20000; k += 1) {
      const expr = soup(rnd)
      let r
      expect(() => { r = compileFormula(expr, FIELDS) }, expr).not.toThrow()
      if (!r.ok) {
        outcome.err += 1
        codes.add(r.code)
        expect(known.has(r.code), r.code).toBe(true)
        expect(r.pos >= 0 && r.pos <= cpLen(expr), `${JSON.stringify(expr)} pos ${r.pos}`).toBe(true)
        expect(typeof r.sentence === 'string' && r.sentence.length > 0).toBe(true)
        continue
      }
      outcome.ok += 1
      const c = r.compiled
      const out = c.kind === 'row' ? evalRow(c, row) : evalGroup(c, [row, row])
      const fine = out === null || typeof out === 'boolean' || typeof out === 'string'
        || (typeof out === 'number' && Number.isFinite(out) && !Object.is(out, -0))
      expect(fine, `${JSON.stringify(expr)} -> ${String(out)}`).toBe(true)
      expect(compileFormula(c.canonical, FIELDS).compiled.canonical).toBe(c.canonical)
    }
    // Non-vacuity: the soup is not all one answer.
    expect(outcome.ok).toBeGreaterThan(4000)
    expect(outcome.err).toBeGreaterThan(8000)
    expect(codes.size).toBeGreaterThanOrEqual(10)
  }, 60000)
})

// ---------------------------------------------------------------------------------------------

describe('suggest_ranks_prefix_then_contains_and_caps_at_12', () => {
  const many = new Map()
  const add = (key, lab, type = 'number') => many.set(key, { key, label: lab, type, hourKey: null, needsTimes: false })
  add('net', 'Net P&L')
  add('gross_net', 'Gross net')
  add('net_r', 'Net R')
  add('planned', 'Planned net')
  add('tags', 'Net tags', 'tag')
  for (let k = 1; k <= 20; k += 1) add(`f${k}`, `Field ${k}`)

  it('inside a bracket: fields by label, prefix matches first, then contains, never a tag field', () => {
    const got = suggest('[net', 4, many)
    expect(got.map((s) => s.label)).toEqual(['Net P&L', 'Net R', 'Gross net', 'Planned net'])
    expect(got.every((s) => s.kind === 'field' && s.from === 0 && s.to === 4)).toBe(true)
    expect(got.map((s) => s.insert)).toEqual(['[Net P&L]', '[Net R]', '[Gross net]', '[Planned net]'])
    // what is inserted compiles back to the field it names
    for (const s of got) expect(compileFormula(s.insert, many).compiled.fields).toHaveLength(1)
  })

  it('on a bare word: functions by name (prefix, then contains), and fields', () => {
    const got = suggest('1 + if', 6, FIELDS)
    expect(got.map((s) => s.insert)).toEqual(['If(', 'CountIf(', 'SumIf(', 'AvgIf('])
    expect(got.every((s) => s.kind === 'function' && s.from === 4)).toBe(true)
    const mixed = suggest('ne', 2, many)
    expect(mixed.slice(0, 2).map((s) => s.label)).toEqual(['Net P&L', 'Net R'])
    expect(mixed.slice(2).map((s) => s.label)).toEqual(['Gross net', 'Planned net'])
  })

  it('caps at 12, prefix matches first', () => {
    const got = suggest('[', 1, many)
    expect(got).toHaveLength(12)
    expect(suggest('[field', 6, many)).toHaveLength(12)
    expect(suggest('[field', 6, many).every((s) => s.label.startsWith('Field'))).toBe(true)
    expect(suggest('[1', 2, many).map((s) => s.label)).toEqual(
      ['Field 1', 'Field 10', 'Field 11', 'Field 12', 'Field 13', 'Field 14', 'Field 15', 'Field 16',
        'Field 17', 'Field 18', 'Field 19'],
    )
  })

  it('the caret decides what is being typed; nothing to suggest is an empty list', () => {
    expect(suggest('[Net P&L] + Su', 14, FIELDS).map((s) => s.insert)).toEqual(['SumIf('])
    expect(suggest('[Net P&L] + Su', 9, FIELDS)).toEqual([])
    expect(suggest('1 + ', 4, FIELDS)).toEqual([])
    expect(suggest(null, 0, FIELDS)).toEqual([])
    // prefix matches in the table's own order (Risk $ is declared before R), then contains
    expect(suggest('[r', 2, FIELDS).map((s) => s.label)).toEqual(['Risk $', 'R', 'Entry day'])
  })
})

afterAll(() => {
  // NON-VACUITY across the whole run: every section was really exercised, entry by entry.
  for (const [section, n] of Object.entries(RAN)) {
    if (n !== DOC[section].length) throw new Error(`${section}: ran ${n} of ${DOC[section].length}`)
  }
})
