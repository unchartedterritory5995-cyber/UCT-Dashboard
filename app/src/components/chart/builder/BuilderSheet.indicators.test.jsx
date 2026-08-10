// ⭐⭐ THE ACCEPTANCE TEST FOR PHASE F, AND IT IS ONE EXPRESSION.
//
// The gap this phase closed was stated as a sentence: **a member cannot write
// `rsi(close, 14) > 70`.** The formula language declared eleven functions and
// not one of them was an indicator, while `indicator_compute.py` and
// `indicators.js` had computed thirty-one plot addresses between them for
// months. So the whole of Phase F is measured here, by that expression going
// all the way through the doors a member actually walks: it PARSES, it LINTS,
// it READS BACK IN ENGLISH, the SAVE GATE admits it, the sheet PUTS it, and the
// tree it puts is the tree the parser produced.
//
// ⛔ EVERY EXPECTATION COMES FROM THE SHIPPED DOOR, NEVER FROM A COPY OF IT.
// The read-back is `evaluateFormula(...).readback`, the save gate is
// `canSaveFormula`, the hash is `astHash(parseFormula(...).ast)` — the same
// three `BuilderSheet.criteria.test.jsx` uses, and for the same reason. A test
// that retyped `"1 when the 14-bar RSI of close is greater than 70 and 0
// otherwise"` would be a second authority over a string the manifest owns, and
// it would keep agreeing with itself after the manifest's phrase moved.
//
// ⛔ AND IT DRIVES THE SHEET, NOT THE FIELD. `FormulaField` on its own is a
// component test, and a component test is structurally blind to a severed wire
// — which is exactly the finding the 2026-08-08 audit made about eight features
// that were built, tested, green and connected to nothing. Cut the mount and
// these go red while every part stays perfectly correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash, TABLE } from '../engine/ast/parse'
import { interpret, maxLookback } from '../engine/ast/interpret'
import { astReach, REPAINT_MODES } from '../engine/ast/lint'

/** ⭐ THE ACCEPTANCE EXPRESSION, WRITTEN ONCE. Every case below reads it from
 *  here, so there is no chance of one case proving something about a formula a
 *  neighbouring case never tried. */
const ACCEPTANCE = 'rsi(close, 14) > 70'

const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} onSaved={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')
const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await settle()
}

/** The document the sheet actually PUT on the wire. ⛔ Read off `global.fetch`
 *  rather than an injected saver — `lesson_injected_dependency_hides_the_fetch`. */
function savedDocument() {
  const write = H.requests.filter((r) => r.method !== 'GET').at(-1)
  expect(write, 'nothing was written — the save never left the sheet').toBeTruthy()
  return JSON.parse(write.body).definition ?? JSON.parse(write.body)
}

/** Every `call` name anywhere in a persisted document, by SHAPE. A test that
 *  looked under a key called `formula` would pass against a document that
 *  stored the tree somewhere else entirely. */
function callNamesIn(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) callNamesIn(v, out); return out }
  if (value && typeof value === 'object') {
    if (value.type === 'call' && typeof value.name === 'string') out.add(value.name)
    for (const v of Object.values(value)) callNamesIn(v, out)
  }
  return out
}

const BARS = Array.from({ length: 120 }, (_, i) => {
  const c = 100 + Math.sin(i / 5) * 8 + i * 0.05
  return { t: 1700000000 + i * 300, o: c - 0.3, h: c + 0.6, l: c - 0.6, c, v: 1000 + i }
})

beforeEach(() => { vi.useFakeTimers(); stubFetch() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch })

describe('🔴 `rsi(close, 14) > 70` — the one expression Phase F is measured by', () => {
  it('the table DECLARES rsi, so the expression is not a name the grammar refuses', () => {
    // ⛔ THE PREMISE, ASSERTED RATHER THAN ASSUMED. Every case below would pass
    // vacuously against a manifest that had quietly lost the entry — the sheet
    // would simply refuse the formula and no `expect` here would notice unless
    // one of them says so out loud.
    expect(Object.prototype.hasOwnProperty.call(TABLE.functions, 'rsi'),
      'the closed table no longer declares `rsi` — every case in this file is about nothing')
      .toBe(true)
    // …and it is a TERM, not a condition: `rsi(close, 14)` is a number and the
    // `> 70` is what makes the expression a scan.
    expect(TABLE.functions.rsi.yields).toBe('num')
  })

  it('it PARSES, and the tree is a call the table declares', () => {
    const parsed = parseFormula(ACCEPTANCE)
    expect(parsed.ok, parsed.error || '').toBe(true)
    expect(callNamesIn(parsed.ast)).toEqual(new Set(['rsi']))
  })

  it('it LINTS as non-repainting, with a lookback the manifest can add up', () => {
    const { ast } = parseFormula(ACCEPTANCE)
    const reach = astReach(ast)
    // ⭐ THE CLAIM `_no_offset` EXISTS TO PROTECT. `rsi` declares `lookback:
    // "arg1"`, so the window is decidable without evaluating anything and the
    // forward reach is a real 0 rather than an `unknown` the badge fails closed
    // on. An indicator that could not be bounded this way would badge
    // `repaints` and no member would arm it.
    expect(reach.forward).toBe(0)
    expect(reach.back).toBe(14)
    expect(maxLookback(ast)).toBe(14)
    expect(REPAINT_MODES).toContain('non-repainting')
  })

  it('it EVALUATES to a 0/1 column off real bars, through `interpret` itself', () => {
    const { ast } = parseFormula(ACCEPTANCE)
    const col = interpret(ast, BARS, {})
    expect(col).toHaveLength(BARS.length)
    // ⛔ A COMPARISON IS 0/1 AND NOTHING ELSE — `closedTable.json::_booleans`.
    // An indicator arriving as a raw number on this path would put a price in a
    // column the alert grammar reads as a signal.
    const values = new Set(Array.from(col))
    expect([...values].every((v) => v === 0 || v === 1),
      `the scan column held ${[...values].slice(0, 5).join(', ')}`).toBe(true)
    // …and the RSI underneath it really warms up rather than fabricating zeros.
    const raw = interpret(parseFormula('rsi(close, 14)').ast, BARS, {})
    expect(Number.isNaN(raw[13]), 'bar 13 is inside the warm-up and must be NaN').toBe(true)
    expect(Number.isFinite(raw[14]), 'bar 14 is the first computable RSI').toBe(true)
    expect(raw[14]).toBeGreaterThan(0)
    expect(raw[14]).toBeLessThan(100)
  })

  it('it READS BACK IN ENGLISH, in the manifest`s own words', async () => {
    mount()
    await typeFormula(ACCEPTANCE)
    const expected = evaluateFormula(ACCEPTANCE, BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
    // ⛔ THE PHRASE IS THE MANIFEST'S, NOT THIS FILE'S. What is asserted is that
    // the sentence CONTAINS the manifest's own template with its slots filled —
    // derived from `TABLE.functions.rsi.sentence`, so re-wording the manifest
    // moves this expectation with it instead of leaving it stale and green.
    const phrase = TABLE.functions.rsi.sentence.replace('{0}', 'close').replace('{1}', '14')
    expect(expected.readback).toContain(phrase)
  })

  it('the SAVE GATE admits it and the sheet PUTS the parser`s own tree', async () => {
    mount()
    await typeFormula(ACCEPTANCE)
    const expected = evaluateFormula(ACCEPTANCE, BUILDER_INPUT_SCOPE)
    // ⛔ THROUGH `canSaveFormula` ITSELF — a private copy of the rule here would
    // be a second gate, and the two would disagree the day the linter moves.
    expect(canSaveFormula(expected, false), expected.error || '').toBe(true)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'RSI overbought' } })
    await flush()
    expect(saveBtn()).not.toBeDisabled()
    fireEvent.click(saveBtn())
    await flush()

    const doc = savedDocument()
    expect(callNamesIn(doc).has('rsi'),
      'the saved definition carries no `rsi` call — the indicator did not survive the save')
      .toBe(true)
    // ⭐ AND THE STORED TREE IS THE PARSER'S, BY HASH. A document that carried a
    // re-derived or re-spelled tree would look right and be a second authority
    // over the one value every lane keys off.
    const wanted = astHash(parseFormula(ACCEPTANCE).ast)
    const hashes = []
    const collect = (v) => {
      if (Array.isArray(v)) { v.forEach(collect); return }
      if (v && typeof v === 'object') {
        if (v.type === 'op' || v.type === 'call' || v.type === 'series' || v.type === 'num') {
          try { hashes.push(astHash(v)) } catch { /* not a canonical subtree */ }
        }
        Object.values(v).forEach(collect)
      }
    }
    collect(doc)
    expect(hashes, 'no subtree of the saved document hashes to the parsed formula')
      .toContain(wanted)
  })

  it('⛔ AND THE GATE CAN STILL SAY NO — the positive control', async () => {
    // Without this, every case above is satisfied by a sheet that admits
    // anything. `rsy` is one keystroke from the acceptance expression and is not
    // a name the table declares.
    mount()
    await typeFormula('rsy(close, 14) > 70')
    const refused = evaluateFormula('rsy(close, 14) > 70', BUILDER_INPUT_SCOPE)
    expect(refused.ok).toBe(false)
    expect(canSaveFormula(refused, false)).toBe(false)
  })
})
