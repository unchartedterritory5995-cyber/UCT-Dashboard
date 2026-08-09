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
import { fromAst } from './criteria'

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

// ⛔ THE NAME IS READ OFF THE CATALOGUE, NEVER TYPED. A test that spelled a
// setup name would keep passing against a library that had dropped it.
const ANY = Object.keys(STARTERS)[0]

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
  it('🔴 A NEW FORMULA OPENS ON THE LIBRARY, with the firm\'s scans already on screen', async () => {
    // ⭐ THE PRODUCT CALL, AND THE RAIL THAT REDS WHEN IT IS UNDONE. (E-8 left
    // this as an owner call; the owner delegated it and the default moved.)
    // The argument is that `FormulaField` is rendered and autofocused in EVERY
    // mode — the tab only decides what sits ABOVE the box — so Formula as the
    // default renders nothing above a focused box and Library renders the
    // firm's own worked scans above the same focused box. Nobody loses the
    // ability to type; a member who does not know the syntax gains examples of
    // it and a one-click way to put one in the box and change it.
    mount()
    await settle()
    expect(tab(/library/i)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('starter-library')).toBeTruthy()
    // ⛔ AND THE CARDS ARE REALLY THERE. A Library tab that opened onto an empty
    // gallery would be a worse first screen than the box it replaced, so the
    // count is taken from the SHIPPED catalogue rather than typed.
    expect(Object.keys(STARTERS).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('starter-card')).toHaveLength(Object.keys(STARTERS).length)
    // ⛔ AND THE TYPED BOX IS STILL LIVE, which is what makes the default free:
    // the member can ignore the gallery entirely and type. ⚠️ The assertion is
    // that typing WORKS from this tab, not that the box holds focus — focus is
    // `Sheet`'s rAF and jsdom's, and a test of it would measure the harness.
    expect(field()).toHaveValue('')
    await typeFormula('close > open')
    expect(field()).toHaveValue('close > open')
    expect(screen.getByTestId('readback')).toHaveTextContent(
      evaluateFormula('close > open', BUILDER_INPUT_SCOPE).readback)
    expect(tab(/library/i)).toHaveAttribute('aria-selected', 'true')
  })

  it('and the picker is still NOT mounted until it is asked for', async () => {
    mount()
    await settle()
    expect(tab(/conditions/i)).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByTestId('criteria-picker')).toBeNull()
    fireEvent.click(tab(/conditions/i))
    expect(screen.getByTestId('criteria-picker')).toBeTruthy()
    expect(screen.queryByTestId('starter-library')).toBeNull()
  })

  it('picking a starter fills the SHARED source, and Conditions shows it as ROWS or REFUSES BY NAME', async () => {
    // ⭐ ASSERTED FOR EVERY STARTER, AND THE BRANCH IS THE PICKER'S OWN VERDICT.
    // This case used to select one starter with a hand-rolled "every leaf is a
    // comparison" walk — a SECOND AUTHORITY over a decision `criteria.fromAst`
    // already owns. It agreed with the catalogue on the day it was written and
    // went `undefined` the first time the shipped set moved, which would have
    // red-ed the case for a reason that has nothing to do with the sheet.
    //
    // ⛔ The case encodes NO expectation about which starters are pickable. It
    // asks `fromAst` per starter, so it follows the catalogue in both
    // directions. (Today: none. Every shipped starter carries a BARE BOOLEAN
    // SCALAR — `above_50sma` — and `criteria.js` still answers
    // `picker:not-a-condition` for a bare series in condition position, which
    // is false for a scalar the manifest declares `yields: 'bool'`. That is the
    // same correction the crossing row already made for boolean FUNCTIONS, one
    // node type over, and it is reported to the owner rather than patched here.)
    expect(Object.keys(STARTERS).length).toBeGreaterThan(0)
    for (const entry of Object.values(STARTERS)) {
      mount()
      await pickStarter(entry.setup)
      expect(field()).toHaveValue(STARTERS[entry.setup].source)
      fireEvent.click(tab(/conditions/i))
      await settle()
      const read = fromAst(entry.ast)
      if (read.ok) {
        expect(screen.getAllByTestId('picker-row').length).toBeGreaterThan(0)
      } else {
        expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
        // ⛔ THE REFUSAL'S OWN SENTENCE, read off `criteria.REFUSALS` through
        // `fromAst` — never retyped here. A member who cannot edit a starter in
        // the picker must be told why, in the words the manifest owns.
        expect(screen.getByTestId('picker-note')).toHaveTextContent(read.reason)
      }
      cleanup()
    }
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
  it('the three doors are TABS, exactly one is open, and each names itself', async () => {
    mount()
    await settle()
    const tabs = screen.getAllByRole('tab')
    // ⛔ THE NAMES, NOT THE COUNT. A typed count is a second authority over how
    // many doors the sheet has, and it goes red on a change that broke nothing.
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['Library', 'Conditions', 'Formula']))
    // ⛔ AND EXACTLY ONE IS SELECTED, whichever one that is. WHICH door opens is
    // a product decision with its own case above; that a tablist never shows two
    // selected tabs (or none) is the invariant that belongs here and survives
    // the decision moving.
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
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
