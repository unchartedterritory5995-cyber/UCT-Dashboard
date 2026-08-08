// app/src/components/chart/IndicatorLibraryDialog.refusals.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 A MEMBER'S DEFINITION COULD VANISH WITH NO EXPLANATION.
// ═══════════════════════════════════════════════════════════════════════════
//
// Measured in `fix-a-report.md`: **the catalog silently omits a definition the
// gates refuse.** That is CORRECT per `userCatalogRows`' contract — it lists what
// `listUserDefinitions()` holds, and a refused document never gets installed —
// but the author got no sentence. They typed a formula, the STORE accepted it
// (`/api/user-definitions` runs its own gates and records its own verdict), and
// then it simply was not offered, with nothing on any screen saying why.
//
// Every gate on this path already produces a precise, disjoint sentence, and
// `installUserDefinitions` has returned them in `errors` since Phase D Task 16
// with **zero production consumers**: `StockChart` reads the hook and
// deliberately drops `errors` (a toast on a render path fires on every chart),
// and nothing else looked at it at all.
//
// ⛔ WHY THE EXISTING SUITES COULD NOT CATCH THIS, AND WHY THIS FILE IS DIFFERENT.
// `IndicatorLibraryDialog.test.jsx` asserts against `catalogRows()` and
// `.userDefs.test.jsx` installs formulas that PASS — so both are structurally
// unable to pose the question "what happens to one that does not". This file
// drives the real seam end to end: a stored document arrives over a stubbed
// `/api/user-definitions`, the real `useInstalledUserDefinitions` runs the real
// `installUserDefinitions`, the real gates refuse it, and the question asked is
// what a member SEES. Every component in that chain is correct on its own today;
// what did not exist was the wire between the last two.
//
// ⛔ AND IT ASSERTS BOTH DIRECTIONS. A block that rendered unconditionally, or a
// sentence typed here rather than taken from the door, would satisfy a
// one-direction test and be a worse product than the silence: it would tell a
// member with a perfectly good formula that something is wrong with it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

// ⚠️ A SIGNED-IN USER, AND A REAL `createContext`. `useUserDefinitions` reads
// `useContext(AuthContext)` and hands SWR a NULL KEY without a user — so a file
// that mocked this as signed-out, or used the `{Provider}` placeholder the other
// chart suites use (on which `useContext` answers `undefined`), would measure the
// paywall and stay green with this whole feature deleted. Same trap, and the same
// fix, as `engine/__tests__/userDefinitionDraws.test.jsx`.
vi.mock('../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 11 }, plan: 'premium', isPaid: true, loading: false }
  return { AuthContext: createContext(value), useAuth: () => value, useIsPaid: () => true }
})

const { default: IndicatorLibraryDialog } = await import('./IndicatorLibraryDialog')
const { mergeChartSettings } = await import('./chartDefaults')
const { USER_CATEGORY, REFUSED_CATEGORY, userRefusalRows, UNATTRIBUTED_DEF_ID } =
  await import('./indicatorCatalog')
const engineRegistry = await import('./engine/nativeRegistry')
const { installUserDefinitions, clearUserDefinitions } = engineRegistry
const { SHIPPED_DEF_IDS, REGISTRY_SIZES, idsByLane } = await import('./engine/registrySizes')
const { buildDefinition } = await import('./builder/BuilderSheet')
const { evaluateFormula } = await import('./builder/FormulaField')
const { mutate } = await import('swr')
const { USER_DEFINITIONS_KEY } = await import('../../hooks/useUserDefinitions')

const GOOD_ID = 'u_a1b2c3d4e5f6'
const BAD_ID = 'u_dead0000beef'

/** A member's formula, built by the SAME function the builder saves with — never
 *  a hand-written fixture, for the reason `.userDefs.test.jsx` gives. */
function memberFormula({ name, source = 'sma(close, 20)', defId = GOOD_ID, repaint } = {}) {
  const result = evaluateFormula(source)
  expect(result.ok, `fixture formula did not evaluate: ${result.error}`).toBe(true)
  const doc = buildDefinition({
    defId,
    name,
    source: result.source,
    ast: result.ast,
    mode: result.verdict.mode,
    readback: result.readback,
  })
  // ⭐ A STALE STORED BADGE — the realistic way a saved formula stops being
  // offered, and Task 10 named it in advance: *"a stored verdict goes STALE. A
  // closed-table entry removed, a budget cap lowered or a linter that learns
  // something new can invalidate a definition that was legal the day it was
  // written."* The store keeps the badge it recorded; the client re-lints on every
  // install and refuses the disagreement in BOTH directions. Nothing else about
  // the document is touched, so what this file measures is the REFUSAL and not a
  // malformed fixture.
  if (repaint !== undefined) doc.meta.repaint = repaint
  return doc
}

/** A store ROW, in the shape `user_definitions.list_for_user` returns. */
const rowFor = (doc) => ({
  def_id: doc.id, version: 1, rev: 1, ast_hash: doc.compute.fn,
  definition: doc, repaint: {}, created_at: 0,
})

/** Serve `/api/user-definitions` with these documents. */
function serveDefinitions(docs) {
  vi.stubGlobal('fetch', vi.fn((input) => {
    const url = String(typeof input === 'string' ? input : (input && input.url) || '')
    if (url.includes('/api/user-definitions')) {
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ definitions: docs.map(rowFor) }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

const base = () => mergeChartSettings(null)

function open(settings = base()) {
  return render(
    <IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                            onChange={() => {}} registry={engineRegistry} />,
  )
}

/** ⚠️ AN EXPLICIT `mutate`, NOT a `waitFor` on the mount fetch: the hook declares
 *  `dedupingInterval: 10000`, so a later case would otherwise be served an earlier
 *  case's response and every assertion here would be a statement about test order. */
async function settle() {
  await act(async () => { await mutate(USER_DEFINITIONS_KEY) })
}

const reasons = () =>
  screen.queryAllByTestId('user-definition-refusal-reason').map((n) => n.textContent)
const refusalIds = () =>
  screen.queryAllByTestId('user-definition-refusal').map((n) => n.dataset.defId)
const optionIds = () => screen.getAllByRole('option').map((o) => o.dataset.defId)
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
const type = (v) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: v } })

/** THE DOOR'S OWN SENTENCE, taken from the door — never typed into this file.
 *
 *  ⛔ A hand-copied expectation is a SECOND vocabulary for one decision, which is
 *  the precise cost this repo has already measured (`williams_r` vs
 *  `williamsR`). Asking `installUserDefinitions` is also what makes the assertion
 *  fail if the dialog ever starts paraphrasing: the strings have to be equal, not
 *  merely both plausible. Nothing is installed by this call — every error path in
 *  the door `continue`s — and the registry is cleared in teardown regardless. */
function doorSentencesFor(doc) {
  const { installed, errors } = installUserDefinitions([doc])
  expect(installed, 'the fixture was supposed to be REFUSED and it installed').toEqual([])
  expect(errors.length, 'the fixture produced no refusal at all').toBeGreaterThan(0)
  return errors
}

beforeEach(async () => {
  cleanup()
  clearUserDefinitions()
  serveDefinitions([])
  await mutate(USER_DEFINITIONS_KEY, undefined, { revalidate: false })
})

afterEach(() => {
  cleanup()
  clearUserDefinitions()
  vi.unstubAllGlobals()
})

describe('🔴 a formula the gates refuse SAYS SO, in the gate\'s own words', () => {
  it('⭐ the refusal sentence reaches the DOM, byte-for-byte as the door wrote it', async () => {
    const doc = memberFormula({ name: 'Stale badge', defId: BAD_ID, repaint: 'repaints' })
    const expected = doorSentencesFor(doc)
    clearUserDefinitions()

    serveDefinitions([doc])
    open()
    await settle()

    // The claim at the level a member experiences it: their formula is named, and
    // the reason is on screen.
    expect(refusalIds()).toEqual([BAD_ID])
    expect(screen.getByText('Stale badge')).toBeTruthy()
    // ⛔ EQUALITY, not `toContain`. A paraphrase, a truncation or a "something
    // went wrong" would all pass a substring check against a fragment.
    expect(reasons()).toEqual(expected)
    // …and the sentence genuinely names the gate that fired rather than being
    // generic prose that happens to round-trip.
    expect(expected.join(' ')).toContain('meta.repaint')
    expect(expected.join(' ')).toContain('MEASURES')
  })

  it('⛔ CONTROL — THE OTHER DIRECTION: an ACCEPTED formula shows NO error at all', async () => {
    // Without this case, a block that rendered unconditionally — or one wired to
    // `rows` instead of `errors` — passes the case above and tells every member
    // with a working formula that it is broken.
    const doc = memberFormula({ name: '20-bar average' })
    serveDefinitions([doc])
    open()
    await settle()

    expect(screen.queryByTestId('user-definition-refusals')).toBeNull()
    expect(refusalIds()).toEqual([])
    expect(reasons()).toEqual([])
    expect(headings()).not.toContain(REFUSED_CATEGORY)
    // …and the positive half of the same render: it IS offered, as a real option.
    expect(optionIds()).toContain(GOOD_ID)
    expect(headings()).toContain(USER_CATEGORY)
  })

  it('⛔ CONTROL — a member who has saved NOTHING sees no section and no warning', async () => {
    open()
    await settle()
    expect(screen.queryByTestId('user-definition-refusals')).toBeNull()
    expect(headings()).not.toContain(REFUSED_CATEGORY)
    expect(headings()).not.toContain(USER_CATEGORY)
  })

  it('⭐ the good one is OFFERED and the bad one is EXPLAINED, in the same render', async () => {
    // The realistic account: some formulas work, some do not. A fix that reported
    // the refusal by hiding the whole section, or by refusing the good one too,
    // is caught here and by nothing else in this file.
    const good = memberFormula({ name: '20-bar average' })
    const bad = memberFormula({
      name: 'Stale badge', defId: BAD_ID, source: 'high - low', repaint: 'repaints',
    })
    serveDefinitions([good, bad])
    open()
    await settle()

    expect(optionIds()).toContain(GOOD_ID)
    expect(optionIds()).not.toContain(BAD_ID)
    expect(refusalIds()).toEqual([BAD_ID])
    expect(headings()).toContain(USER_CATEGORY)
    expect(headings()).toContain(REFUSED_CATEGORY)
  })

  it('⛔ a refused row is NOT a control — it is not an option and it cannot be ticked', async () => {
    const doc = memberFormula({ name: 'Stale badge', defId: BAD_ID, repaint: 'repaints' })
    serveDefinitions([doc])
    const onChange = vi.fn()
    render(
      <IndicatorLibraryDialog open onClose={() => {}} settings={base()}
                              onChange={onChange} registry={engineRegistry} />,
    )
    await settle()

    // There is no installed definition behind it, so `setIndicatorEnabled` would
    // return the settings BY IDENTITY and a toggle here would be a live-looking
    // control that writes nowhere.
    const row = screen.getByTestId('user-definition-refusal')
    expect(row.getAttribute('role')).toBeNull()
    expect(optionIds()).not.toContain(BAD_ID)
    fireEvent.click(row)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('⭐ the search box filters refusals through the SAME predicate as every other row', async () => {
    const doc = memberFormula({ name: 'Stale badge', defId: BAD_ID, repaint: 'repaints' })
    serveDefinitions([doc])
    open()
    await settle()

    expect(refusalIds()).toEqual([BAD_ID])
    type('stale')
    expect(refusalIds()).toEqual([BAD_ID])
    type('bollinger')
    expect(refusalIds()).toEqual([])
    // ⛔ CONTROL: the empty-state line is about the SEARCH, and it must not
    // appear while a refusal is the only thing matching.
    type('stale')
    expect(screen.queryByText(/No indicator matches/)).toBeNull()
  })

  it('⛔⛔ the SHIPPED rails do not move while a refusal is on screen', async () => {
    // The constraint, not a side note: a refused formula must not be able to make
    // the shipped manifest true by appearing anywhere near it.
    const doc = memberFormula({ name: 'Stale badge', defId: BAD_ID, repaint: 'repaints' })
    serveDefinitions([doc])
    open()
    await settle()
    expect(refusalIds()).toEqual([BAD_ID])

    expect(idsByLane(engineRegistry.listDefinitions())).toEqual(SHIPPED_DEF_IDS)
    expect(engineRegistry.listDefinitions()).toHaveLength(REGISTRY_SIZES.total)
    expect(REGISTRY_SIZES.ast).toBe(0)
    // …and the refused document did NOT enter the runtime index either.
    expect(engineRegistry.listUserDefinitions()).toEqual([])
    expect(engineRegistry.getDefinition(BAD_ID)).toBeNull()
  })

  it('⭐ every shipped row is still there — the widening did not cost the catalogue', async () => {
    const doc = memberFormula({ name: 'Stale badge', defId: BAD_ID, repaint: 'repaints' })
    serveDefinitions([doc])
    open()
    await settle()
    const ids = optionIds()
    for (const shipped of [...SHIPPED_DEF_IDS.native, ...SHIPPED_DEF_IDS.server]) {
      expect(ids, `${shipped} fell out of the library`).toContain(shipped)
    }
    expect(ids).toContain('volumeProfile')
  })
})

describe('the pairing itself — `userRefusalRows`', () => {
  it('groups by the `<id>: ` prefix BOTH doors write, and keeps the message whole', () => {
    const rows = userRefusalRows(
      [{ id: 'u_1', meta: { name: 'Mine', shortName: 'Mine' } }],
      ['u_1: meta.repaint — declared "x" but the linter MEASURES "y"',
       'u_1: compute.budget: too big (guard "nodes").'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('u_1')
    expect(rows[0].name).toBe('Mine')
    // Both reasons, whole, in order, prefix included — the door's bytes.
    expect(rows[0].messages).toEqual([
      'u_1: meta.repaint — declared "x" but the linter MEASURES "y"',
      'u_1: compute.budget: too big (guard "nodes").',
    ])
  })

  it('⛔ a message it cannot attribute is STILL REPORTED, never dropped', () => {
    // Dropping it would rebuild the exact bug this task is about, one remove out:
    // a refusal that exists and that nobody is told about.
    const rows = userRefusalRows([], ['something went wrong with no id prefix'])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(UNATTRIBUTED_DEF_ID)
    expect(rows[0].messages).toEqual(['something went wrong with no id prefix'])
  })

  it('⛔ CONTROL — no errors means no rows, on every empty shape', () => {
    expect(userRefusalRows([], [])).toEqual([])
    expect(userRefusalRows(null, null)).toEqual([])
    expect(userRefusalRows([{ id: 'u_1' }], ['', '   '])).toEqual([])
  })

  it('names the row by its id when the document is missing, rather than saying nothing', () => {
    const rows = userRefusalRows([], ['u_9: refused'])
    expect(rows[0].name).toBe('u_9')
    expect(rows[0].refused).toBe(true)
    expect(rows[0].userDefined).toBe(true)
  })
})
