/**
 * Test support for the widget formula twin (Task 10.3): the shared vector file, read with a file
 * read (never imported into a bundle), and the helpers both rails use. Test infrastructure by
 * path (`test-*`), so it ships nowhere.
 */
import { readFileSync } from 'node:fs'
import { compileFormula, displayFormula, evalRow, evalGroup } from './widgetFormula.js'

export const DOC = JSON.parse(readFileSync(new URL('../../../../../../tests/fixtures/widgetFormulaVectors.json', import.meta.url), 'utf8'))

const SPECIAL = new Map([['nan', Number.NaN], ['inf', Number.POSITIVE_INFINITY], ['-inf', Number.NEGATIVE_INFINITY]])

/** Rows may carry {"$float": "nan" | "inf" | "-inf"}: strict JSON has no such literals. */
export function decode(v) {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '$float') return SPECIAL.get(v.$float)
    const out = {}
    for (const k of keys) Object.defineProperty(out, k, { value: decode(v[k]), enumerable: true, writable: true, configurable: true })
    return out
  }
  return v
}

export function build(entry) {
  if (entry.build) return entry.build.map(([text, times]) => text.repeat(times)).join('')
  return entry.expr
}

export function fieldsOf(list) {
  return new Map(list.map((f) => [f.key, {
    key: f.key, label: f.label, type: f.type, hourKey: f.hour_key, needsTimes: f.needs_times,
  }]))
}

export const FIELDS = fieldsOf(DOC.fields)

export function rowsOf(spec) {
  return decode(typeof spec === 'string' ? DOC.rowsets[spec] : spec)
}

/** The shared comparator: null is null; a bool never equals a number; an expected 0 must be +0
 *  (Object.is); other numbers within abs or relative 1e-9. */
export function same(got, expect) {
  if (expect === null) return got === null
  if (typeof expect === 'boolean' || typeof got === 'boolean') return typeof got === 'boolean' && got === expect
  if (typeof expect === 'number') {
    if (typeof got !== 'number' || !Number.isFinite(got)) return false
    if (expect === 0) return Object.is(got, 0)
    return Math.abs(got - expect) <= Math.max(1e-9 * Math.max(Math.abs(got), Math.abs(expect)), 1e-9)
  }
  return got === expect
}

/** Exported for the no-eval rail, which runs every vector again with eval and Function trapped. */
export function runEveryVector() {
  let n = 0
  for (const v of DOC.compile) { compileFormula(v.expr, FIELDS); n += 1 }
  for (const v of DOC.eval_row) { const r = compileFormula(v.expr, FIELDS); if (r.ok) evalRow(r.compiled, decode(v.row)); n += 1 }
  for (const v of DOC.eval_group) { const r = compileFormula(v.expr, FIELDS); if (r.ok) evalGroup(r.compiled, rowsOf(v.rows)); n += 1 }
  for (const v of [...DOC.errors, ...DOC.limits, ...DOC.hostile]) { compileFormula(build(v), FIELDS); n += 1 }
  for (const v of DOC.display_cases) { displayFormula(v.canonical, fieldsOf(v.fields)); n += 1 }
  return n
}

