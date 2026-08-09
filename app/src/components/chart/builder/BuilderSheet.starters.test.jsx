// 🔴 THE WIRE-CUT FILE.
//
// ⛔ EVERY CASE HERE DRIVES THE LIBRARY **THROUGH THE SHEET**. Rendering
// `StarterLibrary` on its own is what `StarterLibrary.test.jsx` already does,
// and those cases would stay green for the entire time the library was mounted
// nowhere — which is precisely how a dozen features shipped this branch built,
// tested, green and unreachable, one of them found in this very session. These
// fail if the mount is removed while both components remain perfectly correct,
// and that is the only thing that distinguishes a wiring test from a component
// test.
//
// ⭐ AND THE CLAIM THE WHOLE TASK RESTS ON LIVES HERE, because this is where
// `buildDefinition` lives: a starter, once a member has touched it, produces the
// SAME DOCUMENT as the same formula typed by hand — byte for byte but the draft
// id the server overwrites anyway. If that were false there would be two classes
// of definition and the phase's central claim would be a slogan.
//
// ⛔ EVERY EXPECTATION IS TAKEN FROM THE SHIPPED DOOR. The read-back is
// `evaluateFormula(...).readback`; the save gate is `canSaveFormula`; the hash is
// `astHash(parseFormula(...).ast)`; the source is the catalogue's own bytes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { STARTERS } from './StarterLibrary'
import { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
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

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

const tab = (name) => screen.getByRole('tab', { name })
const openLibrary = () => fireEvent.click(tab(/library/i))

function escapeRe(text) { return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') }

/** Pick a starter the way a member does: open the library tab, click its card.
 *
 *  ⚠️ `getByRole`, NEVER `findByRole`. `findBy*` schedules a real-timer
 *  `waitFor`, and this file runs under fake timers to drive the formula debounce
 *  — the query never resolves and the case times out at 5 s looking like a
 *  product failure. The library is mounted synchronously by the tab click, so
 *  there is nothing to wait for. */
function pickStarterSync(setup) {
  openLibrary()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRe(setup)) }))
}

async function pickStarter(setup) {
  pickStarterSync(setup)
  await settle()
}

async function nameIt(text = 'From the library') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await settle()
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

// ⛔ THE TWO NAMES ARE READ OFF THE CATALOGUE, NEVER TYPED. A test that spelled
// a setup name would keep passing against a library that had dropped it.
const ANY = Object.keys(STARTERS)[0]
// A starter every row of which is a comparison, so the Conditions picker can
// show it as rows. Chosen by SHAPE from the catalogue, not by name.
const ALL_ROWS = Object.values(STARTERS).find(
  (e) => e.ast.name === '&&' && countComparisons(e.ast) >= 2
    && countBareScalars(e.ast) === 0)

function countComparisons(node) {
  if (!node || node.type !== 'op') return 0
  if (['>', '>=', '<', '<=', '==', '!='].includes(node.name)) return 1
  return (node.args || []).reduce((n, a) => n + countComparisons(a), 0)
}

function countBareScalars(node) {
  if (!node) return 0
  if (node.type === 'op' && node.name === '&&') {
    return (node.args || []).reduce((n, a) => n + countBareScalars(a), 0)
  }
  return node.type === 'series' ? 1 : 0
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

describe('🔴 the starter library is REACHABLE from the sheet', () => {
  it('the sheet offers a Library tab, and the library is not mounted until it is asked for', async () => {
    mount()
    await settle()
    expect(tab(/library/i)).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByTestId('starter-library')).toBeNull()
    openLibrary()
    expect(screen.getByTestId('starter-library')).toBeTruthy()
  })

  it('picking a starter fills the SHARED source, and the picker can show it', async () => {
    expect(ALL_ROWS, 'no all-comparison starter to drive the picker with').toBeTruthy()
    mount()
    await pickStarter(ALL_ROWS.setup)
    expect(field()).toHaveValue(STARTERS[ALL_ROWS.setup].source)
    fireEvent.click(tab(/conditions/i))
    expect(screen.getAllByTestId('picker-row').length).toBeGreaterThan(1)
  })

  it('and it lands on the FORMULA tab with the tree\'s own read-back showing', async () => {
    // ⭐ *"here is a working scan, now change it"* — the gesture's whole point is
    // that the member ends up in the box they will edit, looking at what it does.
    mount()
    await pickStarter(ANY)
    expect(tab(/formula/i)).toHaveAttribute('aria-selected', 'true')
    const expected = evaluateFormula(STARTERS[ANY].source, BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
    expect(screen.getByTestId('repaint-badge')).toHaveAttribute('data-mode', expected.verdict.mode)
    expect(canSaveFormula(expected, false)).toBe(true)
  })
})

describe('🔴 a starter is an ORDINARY definition', () => {
  it('and SAVING it goes through the SAME door a typed formula goes through', async () => {
    mount()
    await pickStarter(ANY)
    await nameIt()
    fireEvent.click(saveBtn())
    await flush()

    const doc = savedDocument()
    expect(doc.compute.source).toBe(STARTERS[ANY].source)
    expect(doc.compute.fn).toBe(astHash(parseFormula(doc.compute.source).ast))
    // ⛔ NOTHING ON THE DOCUMENT SAYS WHERE IT CAME FROM. A `starter: true`, an
    // `is_builtin`, a `curated` — each one is a second class of object, and each
    // is invisible to a test that only opens the library and clicks a card.
    expect(JSON.stringify(doc)).not.toMatch(/starter|builtin|built_in|curated|source_setup/i)
    // …and the request is the same one a typed formula issues.
    const write = H.requests.filter((r) => r.method !== 'GET').at(-1)
    expect(write.url).toMatch(/\/api\/user-definitions/)
    expect(write.url).not.toMatch(/starter|library/i)
  })

  it('⭐ A STARTER AND THE SAME FORMULA TYPED PRODUCE THE SAME DOCUMENT, byte for byte but the id', async () => {
    mount()
    await pickStarter(ANY)
    await nameIt('One and the same')
    fireEvent.click(saveBtn())
    await flush()
    const fromLibrary = savedDocument()
    cleanup()

    stubFetch()
    mount()
    await typeFormula(STARTERS[ANY].source)
    await nameIt('One and the same')
    fireEvent.click(saveBtn())
    await flush()
    const typed = savedDocument()

    expect(fromLibrary.id).not.toBe(typed.id)
    expect({ ...fromLibrary, id: 'x' }).toEqual({ ...typed, id: 'x' })
  })

  it('⭐ AND ONCE A MEMBER EDITS IT, IT IS INDISTINGUISHABLE FROM ONE THEY AUTHORED', async () => {
    // The edit story A2.3 depends on: a starter is a starting point, not a
    // template with strings attached. Change one term and what is saved is a
    // member-authored definition with a member-authored hash.
    const edited = `${STARTERS[ANY].source} && close > open`
    expect(parseFormula(edited).ok).toBe(true)

    mount()
    await pickStarter(ANY)
    await typeFormula(edited)
    await nameIt('My version')
    fireEvent.click(saveBtn())
    await flush()
    const mine = savedDocument()
    cleanup()

    stubFetch()
    mount()
    await typeFormula(edited)
    await nameIt('My version')
    fireEvent.click(saveBtn())
    await flush()
    const authored = savedDocument()

    expect({ ...mine, id: 'x' }).toEqual({ ...authored, id: 'x' })
    // …and the maths has forked from the starter's.
    expect(mine.compute.fn).toBe(astHash(parseFormula(edited).ast))
    expect(mine.compute.fn).not.toBe(astHash(parseFormula(STARTERS[ANY].source).ast))
  })
})

describe('the sheet still behaves as it did', () => {
  it('the three doors are TABS, Formula is still the default, and each names itself', async () => {
    mount()
    await settle()
    const tabs = screen.getAllByRole('tab')
    // ⛔ THE NAMES, NOT THE COUNT. A typed count is a second authority over how
    // many doors the sheet has, and it goes red on a change that broke nothing.
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['Library', 'Conditions', 'Formula']))
    expect(tab(/formula/i)).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('starter-library')).toBeNull()
    expect(screen.queryByTestId('criteria-picker')).toBeNull()
  })

  it('the focus ring still wraps with the library open', async () => {
    // ⚠️ `trapTab` enumerates focusables from the LIVE panel, so every card joins
    // the ring automatically — which is exactly why the wrap-around has to be
    // re-run rather than assumed.
    mount()
    openLibrary()
    await settle()
    const panel = document.querySelector('[role="dialog"]')
    const items = [...panel.querySelectorAll(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
      + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    expect(items.length).toBeGreaterThan(3)
    items[items.length - 1].focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    items[0].focus()
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
  })

  it('a typed formula is untouched by merely LOOKING at the library', async () => {
    mount()
    await typeFormula('rs_rank > 80')
    openLibrary()
    expect(field()).toHaveValue('rs_rank > 80')
    fireEvent.click(tab(/formula/i))
    expect(field()).toHaveValue('rs_rank > 80')
  })
})
