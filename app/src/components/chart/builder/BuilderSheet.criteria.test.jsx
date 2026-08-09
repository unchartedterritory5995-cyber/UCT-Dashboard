// ⛔ EVERY CASE HERE DRIVES THE PICKER **THROUGH THE SHEET**. Rendering
// `CriteriaPicker` on its own is what `CriteriaPicker.test.jsx` already does;
// those cases would stay green for the entire time the picker was unreachable,
// which is precisely how eight features shipped this week built, tested, green
// and mounted nowhere. These fail if the mount is removed while both components
// remain perfectly correct — the only thing that distinguishes a wiring test
// from a component test.
//
// ⛔ AND EVERY EXPECTATION IS TAKEN FROM THE SHIPPED DOOR, NEVER FROM A COPY OF
// IT. The read-back is `evaluateFormula(...).readback`; the save gate is
// `canSaveFormula`; the hash is `astHash(parseFormula(...).ast)`. A test that
// retyped any of the three would be a second authority over a value the source
// already owns — this repo's most-repeated defect.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { NUMBER_OPTION } from './CriteriaPicker'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'

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

/** Flush microtasks under fake timers — `waitFor` schedules real intervals and
 *  hangs, so the promise chain is drained explicitly instead. */
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const noop = () => {}

function mount({ onSaved = noop } = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} onSaved={onSaved} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await settle()
}

const openPicker = () => fireEvent.click(screen.getByRole('tab', { name: /conditions/i }))

/** Drive the picker's FIRST row through the sheet. A numeric right-hand side
 *  goes through the "a number" option, exactly as a member's click would. */
async function pickRow({ left, cmp, right }) {
  if (screen.queryAllByTestId('picker-row').length === 0) {
    fireEvent.click(screen.getByRole('button', { name: /^add condition$/i }))
  }
  fireEvent.change(screen.getByLabelText('Condition 0 left side'), { target: { value: left } })
  fireEvent.change(screen.getByLabelText('Condition 0 comparison'), { target: { value: cmp } })
  if (/^[0-9]/.test(String(right))) {
    fireEvent.change(screen.getByLabelText('Condition 0 right side'), { target: { value: NUMBER_OPTION } })
    fireEvent.change(screen.getByLabelText('Condition 0 right side value'), { target: { value: String(right) } })
  } else {
    fireEvent.change(screen.getByLabelText('Condition 0 right side'), { target: { value: right } })
  }
  await flush()
}

async function nameIt(text = 'Picked line') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}

const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })

/** The document the sheet actually PUT on the wire. ⛔ Read off `global.fetch`,
 *  not off an injected save function — `lesson_injected_dependency_hides_the_
 *  fetch`: 996 green tests once shipped a feature that ran in 0 of 24 charts
 *  because every test handed in a fake. */
function savedDocument() {
  const write = H.requests.filter((r) => r.method !== 'GET').at(-1)
  expect(write, 'nothing was written — the save never left the sheet').toBeTruthy()
  return JSON.parse(write.body).definition ?? JSON.parse(write.body)
}

/** Any picker-shaped node anywhere in a value, by SHAPE rather than by key
 *  name. ⛔ A test that looked for a key called `picker` would pass against a
 *  document that stored the same object under `meta.rows`. */
function pickerShapesIn(value, trail = '$') {
  const found = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...pickerShapesIn(v, `${trail}[${i}]`)))
    return found
  }
  if (value && typeof value === 'object') {
    if (value.kind === 'row' || value.kind === 'group' || Array.isArray(value.children)) {
      found.push(trail)
    }
    for (const [k, v] of Object.entries(value)) found.push(...pickerShapesIn(v, `${trail}.${k}`))
  }
  return found
}

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.fetch
})

describe('🔴 the picker is REACHABLE, and what it produces goes through the shipped doors', () => {
  it('picking a condition fills the FORMULA BOX and produces the tree read-back', async () => {
    mount()
    openPicker()
    await pickRow({ left: 'close', cmp: '>', right: 'open' })
    // The text box — the SHIPPED one — must now hold the picked source.
    expect(field()).toHaveValue('(close > open)')
    // …and the read-back is `sentenceFor`'s, not the picker's.
    await settle()
    expect(screen.getByTestId('readback')).toHaveTextContent(
      evaluateFormula('(close > open)', BUILDER_INPUT_SCOPE).readback)
  })

  it('and the SHIPPED badge, budget and save gate all run on it', async () => {
    // ⛔ THROUGH `canSaveFormula` ITSELF. A private copy of the rule here would
    // be a second gate, and the two would disagree the day the linter moves.
    mount()
    openPicker()
    await pickRow({ left: 'close', cmp: '>', right: 'open' })
    await settle()
    const expected = evaluateFormula('(close > open)', BUILDER_INPUT_SCOPE)
    expect(canSaveFormula(expected, false)).toBe(true)
    expect(screen.getByTestId('repaint-badge')).toHaveAttribute('data-mode', expected.verdict.mode)
    await nameIt()
    expect(saveBtn()).not.toBeDisabled()
  })

  it('a SCALAR is offered in the picker and survives the round trip through the sheet', async () => {
    // ⭐ E-1's whole point, seen from the surface: `rs_rank > 80` is a condition
    // a member can BUILD, not just type — and against TC2000 that is the
    // difference between a criteria builder and a demo.
    mount()
    openPicker()
    await pickRow({ left: 'rs_rank', cmp: '>', right: '80' })
    expect(field()).toHaveValue('(rs_rank > 80)')
    await settle()
    const expected = evaluateFormula('(rs_rank > 80)', BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
    expect(screen.queryByTestId('formula-error')).toBeNull()
  })

  it('⭐ THE PHASE\'S ACCEPTANCE FORMULA is BUILT through the picker, not typed', async () => {
    // `rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)` — two scalars, one
    // function call, three rows. Assembled with clicks, then read back and gated
    // by the same two functions a typed formula meets.
    mount()
    openPicker()
    await pickRow({ left: 'rs_rank', cmp: '>', right: '80' })

    fireEvent.click(screen.getByRole('button', { name: /^add condition$/i }))
    fireEvent.change(screen.getByLabelText('Condition 1 left side'), { target: { value: 'adr_pct' } })
    fireEvent.change(screen.getByLabelText('Condition 1 right side'), { target: { value: NUMBER_OPTION } })
    fireEvent.change(screen.getByLabelText('Condition 1 right side value'), { target: { value: '4' } })

    fireEvent.click(screen.getByRole('button', { name: /^add condition$/i }))
    fireEvent.change(screen.getByLabelText('Condition 2 left side'), { target: { value: 'close' } })
    fireEvent.change(screen.getByLabelText('Condition 2 right side'), { target: { value: 'sma' } })
    fireEvent.change(screen.getByLabelText('Condition 2 right side sma argument 1'), { target: { value: 'close' } })
    fireEvent.change(screen.getByLabelText('Condition 2 right side sma argument 2'), { target: { value: '50' } })
    await settle()

    const built = field().value
    // ⛔ THE TREE, NOT THE STRING. The picker spells fully parenthesised source;
    // the claim is that it is the SAME OBJECT as the typed formula, and only the
    // hash can say that.
    const typed = parseFormula('rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)')
    expect(typed.ok).toBe(true)
    expect(parseFormula(built).ok, built).toBe(true)
    expect(astHash(parseFormula(built).ast)).toBe(astHash(typed.ast))

    const expected = evaluateFormula(built, BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(expected.verdict.mode).toBe('non-repainting')
    expect(canSaveFormula(expected, false)).toBe(true)
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
  })

  it('a formula the picker cannot show is REPORTED, and the picker stays empty', async () => {
    mount()
    await typeFormula('sma(close, 20)')
    openPicker()
    expect(screen.getByTestId('picker-note')).toHaveTextContent(/yes-or-no/i)
    expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
    // ⛔ AND THE FORMULA IS UNTOUCHED. A picker that cleared the box on a mode
    // switch would destroy the user's work to preserve its own consistency.
    expect(field()).toHaveValue('sma(close, 20)')
  })

  it('a TYPED condition appears in the picker as rows — the trip in the other direction', async () => {
    mount()
    await typeFormula('rs_rank > 80 && adr_pct > 4')
    openPicker()
    expect(screen.getAllByTestId('picker-row')).toHaveLength(2)
    expect(screen.queryByTestId('picker-note')).toBeNull()
    // and merely LOOKING at it did not rewrite the box.
    expect(field()).toHaveValue('rs_rank > 80 && adr_pct > 4')
  })
})

describe('🔴 the SAVED object is the same object either door produces', () => {
  it('the SAVED document carries no picker shape', async () => {
    mount()
    openPicker()
    await pickRow({ left: 'close', cmp: '>', right: 'open' })
    await settle()
    await nameIt()
    fireEvent.click(saveBtn())
    await flush()

    const doc = savedDocument()
    expect(pickerShapesIn(doc), 'a picker shape reached the persisted document').toEqual([])
    expect(JSON.stringify(doc)).not.toMatch(/"kind"\s*:\s*"(row|group)"/)
    expect(doc.compute.source).toBe('(close > open)')
    expect(astHash(parseFormula(doc.compute.source).ast)).toBe(doc.compute.fn)
  })

  it('and the shape probe is NOT vacuous — a planted picker shape is found BY PATH', () => {
    const planted = { compute: { source: 'x' }, meta: { picker: { kind: 'group', children: [] } } }
    expect(pickerShapesIn(planted)).toEqual(['$.meta.picker'])
  })

  it('⭐ TYPED AND PICKED PRODUCE THE SAME DOCUMENT, byte for byte but the id', async () => {
    // ⛔ ONE ENGINE, THREE DOORS. If the two doors produced documents that
    // differed anywhere — a different `source` spelling reaching `compute.fn`,
    // a different `meta` — then the chart, the alerts and the screener would be
    // consuming two kinds of object and the phase's central claim would be
    // false.
    mount()
    await typeFormula('(close > open)')
    await nameIt('Same line')
    fireEvent.click(saveBtn())
    await flush()
    const typedDoc = savedDocument()
    cleanup()

    stubFetch()
    mount()
    openPicker()
    await pickRow({ left: 'close', cmp: '>', right: 'open' })
    await settle()
    await nameIt('Same line')
    fireEvent.click(saveBtn())
    await flush()
    const pickedDoc = savedDocument()

    // The draft id is random per sheet and the server overwrites it anyway.
    expect(typedDoc.id).not.toBe(pickedDoc.id)
    expect({ ...pickedDoc, id: 'x' }).toEqual({ ...typedDoc, id: 'x' })
  })
})

describe('the sheet still behaves as it did', () => {
  it('the mode row is a TABLIST carrying BOTH doors, and Formula is the default', async () => {
    mount()
    await settle()
    // ⚠️ THIS COUNTED THE TABS AND E-8 ADDED A THIRD DOOR (the starter library),
    // turning a green suite red on a change that broke nothing this file is
    // about. A typed count is a second authority over how many doors the sheet
    // has; the claim that belongs here is that BOTH of E-4's doors are present
    // and that Formula is the one that is open. `BuilderSheet.starters.test.jsx`
    // owns the third.
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(expect.arrayContaining(['Conditions', 'Formula']))
    expect(screen.getByRole('tab', { name: /formula/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /conditions/i })).toHaveAttribute('aria-selected', 'false')
    // ⛔ THE PICKER IS NOT MOUNTED UNTIL IT IS ASKED FOR. A hidden picker still
    // deriving from every keystroke is work nobody asked for on a surface whose
    // 250 ms debounce exists because nobody had measured the frame budget.
    expect(screen.queryByTestId('criteria-picker')).toBeNull()
  })

  it('the typed box is STILL the write path while the picker is open', async () => {
    mount()
    openPicker()
    await typeFormula('high > low')
    expect(field()).toHaveValue('high > low')
    await settle()
    expect(screen.getByTestId('readback')).toHaveTextContent(
      evaluateFormula('high > low', BUILDER_INPUT_SCOPE).readback)
    expect(screen.getAllByTestId('picker-row')).toHaveLength(1)
  })

  it('the focus ring still wraps with the new controls in it', async () => {
    // ⚠️ `trapTab` enumerates focusables from the LIVE panel, so the two new
    // tabs join the ring automatically — which is exactly why the wrap-around
    // has to be re-run rather than assumed.
    mount()
    await settle()
    const panel = document.querySelector('[role="dialog"]')
    expect(panel).toBeTruthy()
    const items = [...panel.querySelectorAll(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
      + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    expect(items.length).toBeGreaterThan(2)
    items[items.length - 1].focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    items[0].focus()
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
  })
})
