// app/src/components/chart/engine/ast/interpret.inputCompat.test.js
//
// ─── A TABLE NAME DECLARED AFTER DOCUMENTS EXISTED MAY NOT BREAK ONE ─────────
//
// `interpret` refuses an input whose key equals a table name ("the input …
// shadows a table name"). Pine coverage Phase 1 declared `acos`, `alma`,
// `percentileNearestRank` and `rci`, so a member's document saved with an input
// keyed one of those would have stopped computing, on the chart and in alerts.
// `closedTable.json::_functions_added_after_saved_documents` lists the names
// declared after documents could be saved; for those the member's input wins and
// the function of that name is unreachable inside the document.
//
// The fixture is SHARED with `tests/test_ast_input_compat.py`, so both lanes are
// held to one set of documents, and the frozen roster
// (`tests/fixtures/ast/table_functions_before_saved_documents.json`) makes every
// FUTURE table addition land red here until it is listed in the compat set.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { interpret, SHADOWABLE_BY_INPUT } from './interpret'
import { TABLE } from './parse'

const FIX = path.resolve(process.cwd(), '../tests/fixtures/ast')
const COMPAT = JSON.parse(fs.readFileSync(path.join(FIX, 'input_compat_saved_documents.json'), 'utf8'))
const BEFORE = JSON.parse(fs.readFileSync(path.join(FIX, 'table_functions_before_saved_documents.json'), 'utf8'))

/** The tree with every read of `from` renamed to `to` — the same document under
 *  a key no table holds, which is what it was before the table declared `from`. */
const renamed = (node, from, to) => {
  if (!node || typeof node !== 'object') return node
  const out = { ...node }
  if (out.type === 'series' && out.name === from) out.name = to
  if (Array.isArray(out.args)) out.args = out.args.map((a) => renamed(a, from, to))
  return out
}
const same = (a, b) => a.length === b.length
  && Array.from(a).every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

describe('a saved document whose input took a later table name still computes', () => {
  it.each(COMPAT.saved.map((d) => [d.input, d]))('input %s: the same column as under a key no table holds', (_n, doc) => {
    expect(SHADOWABLE_BY_INPUT.has(doc.input)).toBe(true)
    const ours = interpret(doc.ast, COMPAT.bars, { [doc.input]: doc.value })
    const control = interpret(renamed(doc.ast, doc.input, COMPAT.control_key), COMPAT.bars,
      { [COMPAT.control_key]: doc.value })
    expect(same(ours, control), `${Array.from(ours)} vs ${Array.from(control)}`).toBe(true)
    expect(Array.from(ours).some(Number.isFinite), 'the document computes something').toBe(true)
  })

  it('every name the compat set lists has a saved document here', () => {
    expect(COMPAT.saved.map((d) => d.input).sort()).toEqual([...SHADOWABLE_BY_INPUT].sort())
  })
})

describe('…and nothing else was loosened', () => {
  it.each(COMPAT.old_names)('an input named %s (an older table name) still raises', (name) => {
    expect(SHADOWABLE_BY_INPUT.has(name)).toBe(false)
    expect(() => interpret({ type: 'series', name: 'close' }, COMPAT.bars, { [name]: 1 }))
      .toThrow(/shadows a table name/)
  })

  it('inside such a document the function of that name is unreachable, refused by name', () => {
    const d = COMPAT.call_refused
    let err = null
    try { interpret(d.ast, COMPAT.bars, { [d.input]: d.value }) } catch (e) { err = e }
    expect(err && err.guard).toBe('resolve:function')
    expect(String(err.message)).toContain(`"${d.input}"`)
    // the same call computes in a document with no such input
    expect(Array.from(interpret(d.ast, COMPAT.bars)).some(Number.isFinite)).toBe(true)
  })
})

describe('⛔ every table function is either frozen-before or in the compat set', () => {
  it('a new table entry lands RED here until it is listed in _functions_added_after_saved_documents', () => {
    const frozen = new Set(BEFORE.names)
    const unaccounted = Object.keys(TABLE.functions).filter((n) => !frozen.has(n) && !SHADOWABLE_BY_INPUT.has(n))
    expect(unaccounted, 'add each to closedTable.json::_functions_added_after_saved_documents.names').toEqual([])
    expect([...SHADOWABLE_BY_INPUT].filter((n) => frozen.has(n)), 'a frozen-before name is not shadowable').toEqual([])
    expect([...SHADOWABLE_BY_INPUT].filter((n) => !(n in TABLE.functions)), 'the compat set names a non-function').toEqual([])
    expect(BEFORE.names.length).toBe(79)
  })
})
