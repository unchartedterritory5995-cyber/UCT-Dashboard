// app/src/components/chart/builder/BuilderSheet.edit.test.jsx
//
// ─── A MEMBER CAN CHANGE A FORMULA THEY ALREADY SAVED ───────────────────────
//
// 🔴 THE GAP. `PUT /api/user-definitions/{def_id}` shipped with Task 10 and had
// NO PRODUCT CALLER, so `compute.rev` in every stored blob had stayed `1` since
// Phase D shipped: the store models an edit exactly right — append a version,
// bump `rev` iff the maths moved, force-migrate every bound alert through Phase
// C's mechanism — and nothing on any screen could reach it. A member could
// author a formula, chart it, find it and alert on it, and never change it.
//
// ⛔ WHAT THIS FILE HAS TO PROVE IS NOT "a PUT went out". Three claims, and the
// first two are about what the USER SEES:
//
//   1. the chart draws the NEW values — measured through `computeFor`, the door
//      `StockChart`'s binder computes an `ast` definition with, with the OLD
//      number asserted ABSENT (the measured failure was: told "switched to new
//      maths", then evaluated at the rev-1 value forever);
//   2. a REFUSED edit changes nothing — no request leaves, and the definition the
//      chart is already drawing still resolves and still computes its old
//      numbers. A broken edit must not brick a working indicator;
//   3. an edit does NOT add a second instance, with a CREATE in the same file as
//      the control — the instance already on the chart names this id, and a
//      second one draws the same formula twice.
//
// ⛔ THE HOOK IS NOT MOCKED. `lesson_injected_dependency_hides_the_fetch`:
// `useUserDefinitions` runs for real and `global.fetch` is the spy, so "it PUT to
// this URL" is a claim about the request that actually leaves.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { declaredInputs } from '../engine/ast/lint'
import {
  getDefinition, clearUserDefinitions, computeFor, installUserDefinitions,
} from '../engine/nativeRegistry'
import * as engineRegistry from '../engine/nativeRegistry'
import { normalizeInstances } from '../engine/instances'

const DEF_ID = 'u_beef0123cafe'

// A strictly rising series, so `sma(close, 20)` and `sma(close, 5)` cannot
// coincide — the non-vacuity floor for every number below.
const BARS = Array.from({ length: 40 }, (_, i) => ({
  t: 1_700_000_000 + i * 300, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000,
}))
const smaLast = (period) => {
  const closes = BARS.map(b => b.c).slice(-period)
  return closes.reduce((a, b) => a + b, 0) / period
}
const OLD_VALUE = smaLast(20)     // 129.5
const NEW_VALUE = smaLast(5)      // 137

/** The store row `GET /api/user-definitions` answers with, built through the
 *  product's OWN document builder so the fixture cannot drift from what the
 *  builder writes. */
function storedRow({ source = 'sma(close, 20)', name = 'My line', version = 1, rev = 1 } = {}) {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`fixture formula does not parse: ${parsed.error}`)
  const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  return {
    def_id: DEF_ID,
    version,
    rev,
    definition: buildDefinition({
      defId: DEF_ID,
      name,
      source,
      ast: parsed.ast,
      mode: evaluated.verdict.mode,
      readback: evaluated.readback,
      version,
      rev,
    }),
  }
}

const H = vi.hoisted(() => ({ requests: [], rows: [], writeResponse: null }))

function stubFetch() {
  H.requests = []
  H.rows = []
  H.writeResponse = null
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    }
    if (H.writeResponse) {
      const r = H.writeResponse
      H.writeResponse = null
      return r
    }
    return {
      ok: true, status: 200,
      json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, migrated: 0 }),
    }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount({ settings = null, onChange = null } = {}) {
  const writes = []
  const utils = render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet
          open
          onClose={() => {}}
          onSaved={() => {}}
          settings={settings}
          onChange={onChange || ((next) => writes.push(next))}
        />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  return { ...utils, writes }
}

const field = () => screen.getByLabelText('Formula')
const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })
const editBtn = (name = 'My line') => screen.getByRole('button', { name: `Edit ${name}` })

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}

async function nameIt(text) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}

async function clickEdit(name = 'My line') {
  await act(async () => { fireEvent.click(editBtn(name)) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}

async function clickSave() {
  await act(async () => { fireEvent.click(saveBtn()) })
  await flush()
}

const writesTo = (method) => H.requests.filter(r => r.method === method)

/** The number the CHART draws for this definition on these bars.
 *
 *  ⛔ `computeFor`, NOT `interpret`. `computeFor` is the door `StockChart`'s
 *  binder goes through: it dispatches on `compute.kind`, resolves the declared
 *  inputs and returns the columnar contract. Calling `interpret` directly would
 *  measure the interpreter agreeing with itself and would skip the very dispatch
 *  that an `ast` definition needs. */
function drawnValue(defId) {
  const def = getDefinition(defId)
  if (!def) return null
  const columns = computeFor(def, BARS, {})
  const column = columns.value
  return column ? column[column.length - 1] : null
}

/** The state a chart is in when the author opens the builder: their stored
 *  definitions already installed.
 *
 *  ⛔ THIS IS THE PRODUCT'S OWN INSTALLER, NOT A FIXTURE. `StockChart` calls
 *  `useInstalledUserDefinitions`, which calls exactly this function on the rows
 *  `GET /api/user-definitions` returns. The builder does NOT install the list —
 *  it installs only what it just saved — so without this the registry is empty
 *  and "the old version keeps drawing" would be a claim about nothing. */
function installStored(row) {
  const { installed, errors } = installUserDefinitions([row.definition])
  if (errors.length || installed.length !== 1) {
    throw new Error(`fixture definition did not install: ${errors.join('; ')}`)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
  clearUserDefinitions()
})

afterEach(() => {
  cleanup()
  clearUserDefinitions()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.fetch
})

// ═══ 1. THE FLOOR ═══════════════════════════════════════════════════════════

describe('the two formulas disagree on these bars', () => {
  it('is not vacuous — 20 bars and 5 bars give different numbers', () => {
    expect(OLD_VALUE).toBeCloseTo(129.5, 6)
    expect(NEW_VALUE).toBeCloseTo(137, 6)
    expect(NEW_VALUE).not.toBeCloseTo(OLD_VALUE, 3)
  })
})

// ═══ 2. OPENING A SAVED FORMULA ═════════════════════════════════════════════

describe('🔴 a saved formula can be OPENED', () => {
  it('puts its SOURCE and its NAME back in the form, and says it is an edit', async () => {
    H.rows = [storedRow()]
    mount()
    await flush()

    await clickEdit()
    expect(field().value, 'the stored source did not come back into the box')
      .toBe('sma(close, 20)')
    expect(screen.getByLabelText('Name').value).toBe('My line')
    // ⛔ `compute.source`, NOT A SENTENCE RE-DERIVED FROM THE TREE. The author
    // edits the text they wrote; a printed-from-AST string would put words they
    // never typed into the field they are about to change.
    expect(screen.getByText('Edit formula')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.getByTestId('readback').textContent).toBe('the 20-bar average of close')
  })

  it('🔴 and it lands on the FORMULA tab, not on the starter gallery', async () => {
    // ⭐ THE OTHER HALF OF THE DEFAULT-TAB CALL, AND THE RAIL THAT REDS WHEN THE
    // WIRE IS CUT. A NEW sheet opens on the Library, because a member with an
    // empty box is helped by the firm's worked scans. A member editing their OWN
    // definition is not: the gallery would sit above their work, and one click
    // on a card REPLACES the source they came here to change. So `openForEdit`
    // moves the sheet, and this fails if that line is removed while the sheet,
    // the library and the picker all stay perfectly correct.
    H.rows = [storedRow()]
    mount()
    await flush()
    expect(screen.getByRole('tab', { name: /library/i })).toHaveAttribute('aria-selected', 'true')

    await clickEdit()
    expect(screen.getByRole('tab', { name: /formula/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /library/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByTestId('starter-library')).toBeNull()
    expect(field().value).toBe('sma(close, 20)')
  })

  it('a row stored WITHOUT its source says so instead of opening an empty box', async () => {
    const row = storedRow()
    delete row.definition.compute.source
    H.rows = [row]
    mount()
    await flush()

    await clickEdit()
    expect(screen.getByTestId('store-error').textContent).toContain('cannot be edited here')
    expect(field().value, 'an empty box opened over a live definition').toBe('')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('"New formula" leaves edit mode and empties the form', async () => {
    H.rows = [storedRow()]
    mount()
    await flush()
    await clickEdit()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New formula' })) })
    await flush()
    expect(field().value).toBe('')
    expect(screen.getByLabelText('Name').value).toBe('')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})

// ═══ 3. THE HEADLINE — the chart draws the NEW values ═══════════════════════

describe('🔴 an EDIT reaches the store AND the chart', () => {
  it('PUTs to the definition\'s own id and the chart draws the NEW values', async () => {
    const row = storedRow()
    H.rows = [row]
    installStored(row)
    mount()
    await flush()
    await clickEdit()

    // The definition as it stands BEFORE the edit — this is what the chart is
    // drawing right now, and the number it draws is the floor for "the old value
    // is absent" below.
    expect(drawnValue(DEF_ID)).toBeCloseTo(OLD_VALUE, 6)

    await typeFormula('sma(close, 5)')
    await clickSave()

    const puts = writesTo('PUT')
    expect(puts, 'no PUT left the builder — the edit never reached the store')
      .toHaveLength(1)
    expect(writesTo('POST'), 'an edit POSTed a NEW definition instead of editing one')
      .toHaveLength(0)
    expect(puts[0].url).toBe(`/api/user-definitions/${DEF_ID}`)

    const sent = JSON.parse(puts[0].body).definition
    expect(sent.id, 'the PUT carries a draft id, not the store\'s').toBe(DEF_ID)
    expect(sent.compute.source).toBe('sma(close, 5)')
    expect(sent.compute.ast).toEqual(parseFormula('sma(close, 5)').ast)

    // 🔴 THE MEASUREMENT. Both halves: the new number is drawn AND the old one
    // is gone. A fix that installed the new definition beside the old one would
    // pass the first half alone.
    expect(drawnValue(DEF_ID), 'the chart is still drawing the pre-edit formula')
      .toBeCloseTo(NEW_VALUE, 6)
    expect(drawnValue(DEF_ID)).not.toBeCloseTo(OLD_VALUE, 3)
    expect(getDefinition(DEF_ID).compute.ast)
      .toEqual(parseFormula('sma(close, 5)').ast)
  })

  it('reconciles the STORE\'s version and rev into what it installs', async () => {
    // ⚠️ `installKey` is `id@version#compute.fn`. A document whose version never
    // moves is byte-identical to the installed one for a RENAME — same id, same
    // tree, same hash — so the install is skipped and the registry keeps showing
    // the old name. The store owns both numbers; the blob's copies follow them.
    H.rows = [storedRow()]
    mount()
    await flush()
    await clickEdit()
    H.writeResponse = {
      ok: true, status: 200,
      json: async () => ({ def_id: DEF_ID, version: 7, rev: 4, rev_bumped: true, migrated: 1 }),
    }
    await typeFormula('sma(close, 5)')
    await clickSave()

    expect(getDefinition(DEF_ID).version).toBe(7)
    expect(getDefinition(DEF_ID).compute.rev).toBe(4)
  })

  it('a RENAME reaches the registry, which a static version would have hidden', async () => {
    // ⛔ THE PRE-EDIT DOCUMENT IS INSTALLED FIRST, WHICH IS WHAT MAKES THIS A
    // TEST. `installKey` is `id@version#compute.fn`: a rename moves NONE of the
    // other two, so with a static version the install is skipped and the registry
    // keeps the old name. Without a prior install there is nothing to skip and
    // the case passes however the version behaves.
    const row = storedRow()
    H.rows = [row]
    installStored(row)
    expect(getDefinition(DEF_ID).meta.name).toBe('My line')
    mount()
    await flush()
    await clickEdit()
    await typeFormula('sma(close, 20)')          // same tree, same hash
    H.writeResponse = {
      ok: true, status: 200,
      json: async () => ({ def_id: DEF_ID, version: 2, rev: 1, rev_bumped: false, migrated: 0 }),
    }
    await nameIt('Renamed line')
    await clickSave()

    // …in this session, through what the builder installs…
    expect(getDefinition(DEF_ID).meta.name).toBe('Renamed line')
    expect(getDefinition(DEF_ID).version).toBe(2)
    // …and on the NEXT PAGE LOAD, through what the STORE now holds.
    // `useInstalledUserDefinitions` installs the stored blob verbatim, so a blob
    // whose own `version` never moved is `id@1#samehash` forever and a rename
    // would never reinstall after a reload.
    const stored = JSON.parse(writesTo('PUT')[0].body).definition
    expect(stored.version, 'the stored document\'s version did not move, so a '
      + 'reload would re-install the pre-rename name').toBe(2)
    expect(stored.meta.name).toBe('Renamed line')
  })

  it('says how many alerts the maths change moved, and only when it moved some', async () => {
    H.rows = [storedRow()]
    mount()
    await flush()
    await clickEdit()
    H.writeResponse = {
      ok: true, status: 200,
      json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, migrated: 2 }),
    }
    await typeFormula('sma(close, 5)')
    await clickSave()

    // ⭐ THE COUNT IS THE STORE'S, NOT A GUESS. `migrate_bindings_to_rev` returns
    // what it actually migrated; spec §3.1's contract is that a member is never
    // silently switched, and this is the sentence that keeps it.
    expect(screen.getByTestId('migrated-note').textContent).toContain('2 alerts')
    expect(screen.getByTestId('saved-note').textContent).toContain('rev 2')
  })

  it('a RENAME claims NO migration', async () => {
    H.rows = [storedRow()]
    mount()
    await flush()
    await clickEdit()
    H.writeResponse = {
      ok: true, status: 200,
      json: async () => ({ def_id: DEF_ID, version: 2, rev: 1, rev_bumped: false, migrated: 0 }),
    }
    await nameIt('Renamed line')
    await clickSave()

    expect(screen.getByTestId('saved-note')).toBeTruthy()
    expect(screen.queryByTestId('migrated-note'),
      'a rename claimed alerts had been moved onto new maths').toBeNull()
  })
})

// ═══ 4. A BROKEN EDIT MUST NOT BRICK A WORKING INDICATOR ════════════════════

describe('🔴 an edit that FAILS A GATE is refused and the old version keeps working', () => {
  it('sends NOTHING and leaves the drawn definition untouched', async () => {
    const row = storedRow()
    H.rows = [row]
    installStored(row)
    mount()
    await flush()
    await clickEdit()
    expect(drawnValue(DEF_ID)).toBeCloseTo(OLD_VALUE, 6)

    const before = H.requests.length
    // Over the lookback cap — `checkBudget`'s own refusal, which is one of the
    // gates the save path already runs, not a new one invented for this test.
    await typeFormula('sma(close, 600)')
    expect(screen.getByTestId('formula-error').getAttribute('data-guard'))
      .toBe('budget:lookback')
    expect(saveBtn().disabled, 'the Save button offered to store a refused tree').toBe(true)
    await clickSave()

    expect(H.requests.length, 'a refused edit reached the network').toBe(before)
    expect(drawnValue(DEF_ID), 'the working version stopped drawing its own numbers')
      .toBeCloseTo(OLD_VALUE, 6)
    expect(getDefinition(DEF_ID).compute.ast)
      .toEqual(parseFormula('sma(close, 20)').ast)
  })

  it('a STORE refusal leaves the drawn definition untouched too', async () => {
    // The client-side gates pass and the SERVER says no — the other half, and the
    // one a client-side-only test would miss entirely.
    const row = storedRow()
    H.rows = [row]
    installStored(row)
    mount()
    await flush()
    await clickEdit()
    H.writeResponse = {
      ok: false, status: 400,
      json: async () => ({ detail: 'definition exceeds 65536 bytes (70000)' }),
    }
    await typeFormula('sma(close, 5)')
    await clickSave()

    expect(screen.getByTestId('store-error').textContent).toContain('definition exceeds')
    expect(drawnValue(DEF_ID), 'a refused save re-installed the new maths anyway')
      .toBeCloseTo(OLD_VALUE, 6)
  })
})

// ═══ 5. AN EDIT ADDS NO SECOND INSTANCE ═════════════════════════════════════

describe('🔴 an edit does not draw the same formula twice', () => {
  it('writes NO instance on an edit, and the CREATE control writes exactly one', async () => {
    // THE CONTROL FIRST, in the same file, so "no write" is distinguishable from
    // "this surface never writes instances".
    const created = mount({ settings: { indicators: {}, indicatorInstances: [] } })
    await flush()
    await typeFormula('sma(close, 20)')
    await nameIt('Fresh line')
    await clickSave()
    expect(created.writes, 'the CREATE path stopped writing an instance — the '
      + 'assertion below would then be measuring nothing').toHaveLength(1)
    const kept = normalizeInstances(created.writes[0].indicatorInstances, engineRegistry)
    expect(kept.dropped.map(d => d.reason)).toEqual([])
    cleanup()
    clearUserDefinitions()

    stubFetch()
    H.rows = [storedRow()]
    const edited = mount({
      settings: {
        indicators: {},
        indicatorInstances: [{ id: 'i1', defId: DEF_ID, inputs: {}, visible: true }],
      },
    })
    await flush()
    await clickEdit()
    await typeFormula('sma(close, 5)')
    await clickSave()

    expect(edited.writes,
      'the edit added a SECOND instance — the chart would draw the same formula twice')
      .toHaveLength(0)
    // …and the instance that is already there still resolves, now to new maths.
    expect(drawnValue(DEF_ID)).toBeCloseTo(NEW_VALUE, 6)
  })
})

// ═══ 6. THE READ-BACK CAN NAME A DECLARED INPUT — BOTH DIRECTIONS ═══════════

describe('🔴 a formula may reference one of its own declared inputs', () => {
  it('the scope handed to the read-back IS the one the saved document declares', () => {
    // ⛔ ONE VOCABULARY. `declaredInputs` reads `inputs[].key` and takes no
    // `name` fallback; deriving the scope from the very array `buildDefinition`
    // writes is what makes "the sentence can say it" and "the document declares
    // it" the same fact rather than two lists somebody keeps in step.
    expect(BUILDER_INPUT_SCOPE).toEqual(declaredInputs({ inputs: BUILDER_INPUTS }))
    expect(Object.keys(BUILDER_INPUT_SCOPE).sort()).toEqual(['color', 'lineWidth'])
    const doc = buildDefinition({
      defId: DEF_ID, name: 'x', source: 'close', ast: parseFormula('close').ast,
      mode: 'non-repainting', readback: 'close',
    })
    expect(doc.inputs.map(i => i.key).sort()).toEqual(Object.keys(BUILDER_INPUT_SCOPE).sort())
  })

  it('names the input in the read-back and badges it NON-repainting', () => {
    const withScope = evaluateFormula('close * lineWidth', BUILDER_INPUT_SCOPE)
    expect(withScope.ok, `refused at ${withScope.guard}: ${withScope.error}`).toBe(true)
    expect(withScope.readback).toBe('close times the input lineWidth')
    expect(withScope.verdict.mode).toBe('non-repainting')
  })

  it('⛔ and an UNDECLARED name still refuses, at the door that owns names', () => {
    // The other direction, which is the one that makes the fix a fix rather than
    // a hole: only a name the DEFINITION declares resolves.
    const undeclared = evaluateFormula('close * nosuch', BUILDER_INPUT_SCOPE)
    expect(undeclared.ok).toBe(false)
    expect(undeclared.guard).toBe('sentence:name')
    expect(undeclared.verdict.mode).toBe('repaints')
  })

  it('the refusal is NOT vacuous — without a scope the DECLARED name refuses too', () => {
    // This is what the surface did until now, and it is why `close * lineWidth`
    // could not be authored anywhere but an API POST.
    const bare = evaluateFormula('close * lineWidth')
    expect(bare.ok).toBe(false)
    expect(bare.guard).toBe('sentence:name')
  })

  it('the builder can SAVE an input-referencing formula', async () => {
    mount()
    await flush()
    await typeFormula('close * lineWidth')
    expect(screen.queryByTestId('formula-error'),
      'the box still refuses a formula the whole engine now accepts').toBeNull()
    expect(screen.getByTestId('repaint-badge').getAttribute('data-mode'))
      .toBe('non-repainting')
    await nameIt('Weighted close')
    await clickSave()
    expect(writesTo('POST')).toHaveLength(1)
    expect(JSON.parse(writesTo('POST')[0].body).definition.compute.source)
      .toBe('close * lineWidth')
  })
})

// ─── OPENING A SAVED FORMULA IS A LANE TOO ──────────────────────────────────
//
// The staleness signal shipped covering the starter and Pine lanes. It missed
// this one, and the gap was found by ENUMERATING every `setSource` site rather
// than by testing the two lanes I happened to have in hand — the same
// enumerate-the-axes rule that this repo keeps relearning.
describe('🔴 opening a saved formula marks a stale description', () => {
  it('the note appears when a description was already typed', async () => {
    H.rows = [storedRow()]
    mount()
    await flush(); await flush()

    fireEvent.change(screen.getByRole('textbox', { name: /plain English/i }),
      { target: { value: 'stocks above the 200 day average' } })
    await flush()
    expect(screen.queryByTestId('concierge-stale')).toBeNull()

    await clickEdit()

    expect(screen.getByTestId('concierge-stale'),
      'the sheet opened a saved formula and never told the description it was stale')
      .toBeTruthy()
  })

  it('⛔ THE CONTROL — with no description there is nothing to mark', async () => {
    H.rows = [storedRow()]
    mount()
    await flush(); await flush()
    await clickEdit()
    expect(screen.queryByTestId('concierge-stale')).toBeNull()
  })
})
