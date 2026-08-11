// app/src/components/chart/IndicatorLibraryDialog.userDefs.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// audit-not-wired, KNOWN ITEM — A MEMBER'S OWN FORMULA IS BROWSABLE.
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase D built every part of authoring an indicator but the last one. A member
// could type a formula (Task 11); it SAVED (Task 10); it INSTALLED into the
// registry and DREW (Task 16); `getDefinition` resolved it, so it was
// addressable by alerts, the binder and `paneLayout` alike. And the one screen
// called "the indicator library" read `catalogRows()` → `listDefinitions()`,
// which is shipped-only ON PURPOSE — so the formula appeared nowhere a member
// would look, and they had to already know it existed to use it.
//
// ⛔ WHY A COMPONENT TEST COULD NOT CATCH THIS, AND WHY THIS FILE IS DIFFERENT.
// `IndicatorLibraryDialog.test.jsx` is 20-odd green cases and every one of them
// asserts against `catalogRows()` — the very list that was missing the rows. It
// would have stayed green forever. This file installs a REAL user definition
// through the product's own door (`BuilderSheet.buildDefinition` →
// `installUserDefinitions`) and then asks what the picker renders, which is a
// question the other file's assertions are structurally unable to pose.
//
// ⛔ AND IT ASSERTS BOTH DIRECTIONS, INCLUDING THE ONE THAT MATTERS MORE. The
// three registry rails (`idsByLane` ≡ `SHIPPED_DEF_IDS`, `.length` ≡
// `REGISTRY_SIZES.total`, `REGISTRY_SIZES.ast` ≡ 0) exist because a manifest
// that counted session state would read green in every suite that installs
// nothing and mean nothing in the one that does. This file is the one that
// does — so it re-checks all three WHILE a user definition is installed and
// visible in the dialog. Widening the catalogue must not widen the manifest.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { catalogRows, userCatalogRows, USER_CATEGORY } from './indicatorCatalog'
import * as engineRegistry from './engine/nativeRegistry'
import { installUserDefinitions, clearUserDefinitions, listDefinitions } from './engine/nativeRegistry'
import { SHIPPED_DEF_IDS, REGISTRY_SIZES, idsByLane } from './engine/registrySizes'
import { isIndicatorEnabled } from './engine/instanceControls'
import { ENGINE_OWNED } from './engine/flipState'
import { buildDefinition } from './builder/BuilderSheet'
import { evaluateFormula } from './builder/FormulaField'

const USER_ID = 'u_a1b2c3d4e5f6'
const OTHER_ID = 'u_ffffffffffff'

/** A member's formula, built by the SAME function the builder saves with.
 *
 *  ⛔ NOT A HAND-WRITTEN FIXTURE. `buildDefinition` is what decides what a user
 *  definition looks like — its `meta.category` ('Custom'), its `tier`
 *  ('premium'), its machine-assigned `repaint` badge and its single plot. A
 *  fixture typed here would be a second answer to that question and would go on
 *  passing after the real one moved. */
function memberFormula(name, source = 'sma(close, 20)', defId = USER_ID) {
  const result = evaluateFormula(source)
  expect(result.ok, `fixture formula did not evaluate: ${result.error}`).toBe(true)
  return buildDefinition({
    defId,
    name,
    source: result.source,
    ast: result.ast,
    mode: result.verdict.mode,
    readback: result.readback,
  })
}

function install(...docs) {
  const res = installUserDefinitions(docs)
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
  expect(res.installed).toHaveLength(docs.length)
  return res.installed
}

const base = () => mergeChartSettings(null)

const open = (settings = base()) => {
  const onChange = vi.fn()
  const view = render(
    <IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                            onChange={onChange} registry={engineRegistry} />,
  )
  return { onChange, view }
}

const optionIds = () => screen.getAllByRole('option').map((o) => o.dataset.defId)
/** ⚠️ SORTED, because the DOM order is the dialog's CATEGORY GROUPING, not
 *  registry order — the rows are rendered one `<section>` per category. Sorted
 *  equality still catches a duplicate or a drop (equal multisets), which is what
 *  these cases are about; the ORDER claim that matters here is "the member's
 *  section is last", and it has its own case below against the headings. */
const optionIdsSorted = () => [...optionIds()].sort()
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
const type = (v) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: v } })

// ⚠️ TEARDOWN UNDOES WHAT SETUP CREATED. The installed index is module-scoped,
// so a case that leaves one behind changes the answer every LATER case gets —
// and it would do so in the direction that makes the manifest rails below pass
// for the wrong reason. vitest gives each FILE its own module registry, so this
// is the whole blast radius.
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('🔴 the library lists the member\'s own formulas', () => {
  it('⭐ an installed user definition IS an option in the picker', () => {
    const [def] = install(memberFormula('20-bar average'))
    open()
    // The claim, at the level a member experiences it: the row exists, in the
    // list they browse, addressable by the name they typed.
    expect(optionIds()).toContain(USER_ID)
    const row = screen.getByRole('option', { name: /20-bar average/ })
    expect(row).toBeTruthy()
    // …and the blurb IS `meta.description`, which `buildDefinition` fills from
    // the read-back derived from their own tree — the same sentence they
    // confirmed before saving, never a model's prose and never retyped here.
    expect(def.meta.description).toBeTruthy()
    expect(within(row).getByText(def.meta.description)).toBeTruthy()
  })

  it('⛔ CONTROL — the OTHER direction: a shipped definition is still there, and the counts add up', () => {
    // A widening that dropped the shipped rows would satisfy the case above and
    // be a far worse regression than the one being fixed.
    install(memberFormula('20-bar average'))
    open()
    const ids = optionIds()
    for (const shipped of [...SHIPPED_DEF_IDS.native, ...SHIPPED_DEF_IDS.server]) {
      expect(ids, `${shipped} fell out of the library`).toContain(shipped)
    }
    expect(ids).toContain('volumeProfile')
    // Exactly the shipped catalogue plus exactly the installed formulas — no
    // duplicate, no drop.
    expect(optionIdsSorted()).toEqual([...catalogRows().map((r) => r.id), USER_ID].sort())
    expect(ids).toHaveLength(catalogRows().length + 1)
  })

  it('⛔ CONTROL — with nothing installed the list is byte-for-byte what it always was', () => {
    // The negative control on the whole feature: a member who has authored
    // nothing sees no new section, no new row, no empty heading.
    open()
    expect(optionIdsSorted()).toEqual(catalogRows().map((r) => r.id).sort())
    expect(headings()).not.toContain(USER_CATEGORY)
    expect(userCatalogRows(engineRegistry)).toEqual([])
  })

  it('⭐ two formulas both appear, each under the one shared heading', () => {
    install(memberFormula('20-bar average'), memberFormula('range', 'high - low', OTHER_ID))
    open()
    expect(optionIds().filter((id) => id.startsWith('u_'))).toEqual([USER_ID, OTHER_ID])
    expect(headings().filter((h) => h === USER_CATEGORY)).toHaveLength(1)
  })
})

describe('⭐ it is visually a DIFFERENT KIND OF THING, not a sixteenth indicator', () => {
  it('sits under its own derived heading, FIRST', () => {
    install(memberFormula('20-bar average'))
    open()
    const hs = headings()
    expect(hs).toContain(USER_CATEGORY)
    // ⚰️ THIS ASSERTED **LAST**, AND THE REASON GIVEN WAS: "so the shipped rows a
    // user is pre-trained on keep their positions." That reason was reversed
    // 2026-08-11 after driving the real dialog: a member's own formulas sat below
    // Momentum, Volatility, Volume AND Trend — a full dialog-height of scrolling —
    // and I could not find a formula I had just saved without searching for it by
    // name.
    //
    // ⭐ THE MUSCLE-MEMORY ARGUMENT ONLY BINDS ON A MEMBER WHO HAS AUTHORED
    // SOMETHING, and for everyone else this section does not render at all — the
    // CONTROL above proves that. So it protected the positions of users who were
    // never affected, at the cost of hiding the work of the ones who were. The
    // shipped rows keep their order relative to EACH OTHER; only the member's own
    // section moves, and it moves to where their own work belongs.
    expect(hs[0]).toBe(USER_CATEGORY)
    // ⛔ AND THE HEADING IS NOT THE DOCUMENT'S `meta.category`. `buildDefinition`
    // writes 'Custom'; a row installed from an older or hand-edited document
    // could name any shipped category and would sit unmarked between two shipped
    // indicators. Provenance decides the section, not a field the author owns.
    expect(hs).not.toContain('Custom')
  })

  it('carries the provenance on the ROW — an attribute and a named pill, not colour alone', () => {
    install(memberFormula('20-bar average'))
    open()
    const mine = screen.getByRole('option', { name: /20-bar average/ })
    expect(mine.getAttribute('data-user-defined')).toBe('true')
    expect(within(mine).getByText('Your formula')).toBeTruthy()
    // ⛔ CONTROL: a shipped row is marked as NOT a member's, and shows no pill.
    // Without this the attribute could be hardcoded 'true' on every row.
    const rsi = screen.getByRole('option', { name: /Relative Strength Index/ })
    expect(rsi.getAttribute('data-user-defined')).toBe('false')
    expect(within(rsi).queryByText('Your formula')).toBeNull()
  })

  it('is findable by the name the member typed, through the same search box', () => {
    install(memberFormula('20-bar average'))
    open()
    type('20-bar')
    expect(optionIds()).toEqual([USER_ID])
    // ⛔ CONTROL: the search still finds shipped rows, and still excludes the
    // member's formula when it does not match.
    type('bollinger')
    expect(optionIds()).toEqual(['bb'])
  })
})

describe('⛔⛔ the SHIPPED rails do not move — this is the constraint, not a side note', () => {
  it('every rail that proves what SHIPS still holds while a user formula is on screen', () => {
    install(memberFormula('20-bar average'))
    open()
    // Proof the widening is live at the moment these are checked — otherwise
    // this whole case is a re-run of `nativeRegistry.test.js` against an empty
    // index, which is the vacuous shape `registrySizes.js` is written against.
    expect(optionIds()).toContain(USER_ID)

    // RAIL 1 — the ordered, lane-partitioned manifest.
    expect(idsByLane(listDefinitions())).toEqual(SHIPPED_DEF_IDS)
    // RAIL 2 — the one place a registry count lives.
    expect(listDefinitions()).toHaveLength(REGISTRY_SIZES.total)
    // RAIL 3 — "Task 8 built the ast lane and registered nothing on it".
    expect(REGISTRY_SIZES.ast).toBe(0)
    expect(SHIPPED_DEF_IDS.ast).toEqual([])

    // …and the catalogue's own rail: `catalogRows()` is still shipped-only, so
    // the share link, the voice bus, the right-click submenu and the on-count
    // keep reading exactly what they always read. NONE of them can resolve
    // another member's `u_…` id, so widening THEM would have been the bug.
    expect(catalogRows().map((r) => r.id))
      .toEqual([...listDefinitions().map((d) => d.id), 'volumeProfile'])
    expect(catalogRows().some((r) => r.userDefined)).toBe(false)
  })
})

describe('⭐ the row is a live control, through the ONE writer', () => {
  it('ticking a member\'s formula adds the instance the binder resolves', () => {
    const [def] = install(memberFormula('20-bar average'))
    const settings = base()
    const { onChange } = open(settings)
    fireEvent.click(screen.getByRole('option', { name: /20-bar average/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    // ⛔ AN INSTANCE, not just a legacy toggle — the instance list is what the
    // binder draws from, and `normalizeInstances` would DROP one naming a
    // definition the registry cannot resolve. It resolves because Task 16
    // installed it, which is the same fact this dialog now reads.
    expect(next.indicatorInstances.some((i) => i && i.defId === def.id)).toBe(true)
    expect(isIndicatorEnabled(next, def.id, ENGINE_OWNED)).toBe(true)
  })
})

describe('🔴 THE WIRE ITSELF — the rows arrive AFTER first paint', () => {
  it('⭐ a formula installed while the dialog is open shows up on the next render', () => {
    // ⛔ THIS IS THE CASE A `useMemo(..., [registry])` FAILS, AND IT IS THE
    // REALISTIC ORDER. `registry` is a module NAMESPACE — the same object for
    // the lifetime of the tab — so a memo keyed on it alone computes once and
    // never again. The user rows are installed by `useInstalledUserDefinitions`
    // during `StockChart`'s render once SWR answers, i.e. after first paint. A
    // member who opened the library before their formulas loaded would see the
    // shipped list forever: the same not-wired defect, one memo over.
    const { view } = open()
    expect(optionIds()).not.toContain(USER_ID)

    install(memberFormula('20-bar average'))
    view.rerender(
      <IndicatorLibraryDialog open onClose={() => {}} settings={base()}
                              onChange={() => {}} registry={engineRegistry} />,
    )
    expect(optionIds(),
      'the catalogue memo never recomputed — a member whose formulas load after ' +
      'the dialog opens would never see them').toContain(USER_ID)
  })

  it('⭐ …and a formula that is cleared disappears again', () => {
    install(memberFormula('20-bar average'))
    const { view } = open()
    expect(optionIds()).toContain(USER_ID)

    // A sign-out, or an authoritative 401/402/403 — `useInstalledUserDefinitions`
    // clears on exactly those. A stale row here would offer a member a formula
    // the registry can no longer resolve.
    clearUserDefinitions()
    view.rerender(
      <IndicatorLibraryDialog open onClose={() => {}} settings={base()}
                              onChange={() => {}} registry={engineRegistry} />,
    )
    expect(optionIds()).not.toContain(USER_ID)
    expect(optionIdsSorted()).toEqual(catalogRows().map((r) => r.id).sort())
  })
})
