// app/src/components/chart/IndicatorLibraryDialog.repaintBadge.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE LIBRARY ROW TOLD A MEMBER `ichimoku` IS `non-repainting`. IT IS NOT.
// ═══════════════════════════════════════════════════════════════════════════
//
// `5387d97e` built the per-plot machinery — `engine/repaintVerdict`, a
// `plots[].forward` window a plot may declare, a `plots[].repaint` badge no plot
// may ever declare, and `definitionRollUp()`, tested and with no caller on this
// surface. `fix-f-report.md` §6.1 then named what was left: *"the library dialog
// still hands `IndicatorLibraryDialog` the raw `meta.repaint` … until it lands,
// one surface says the honest thing and one does not."* The owner delegated the
// call and took it: **accept the machine linter's reading.** This file is the
// gate on the ~10 lines that connect the two.
//
// ⛔⛔ THE CONNECTION IS WHAT THIS FILE TESTS, AND THAT IS THE WHOLE REASON IT
// EXISTS. Both halves were already green: `perPlotRepaintBadge.test.jsx` proves
// `definitionRollUp` measures `ichimoku.chikou` and nothing else, and
// `IndicatorLibraryDialog.test.jsx` proved — for two years' worth of runs — that
// the row renders whatever badge the catalogue hands it. Two correct components
// and a wire nobody had run. Every case below cuts that wire in one direction
// and watches it go red; §"non-vacuity" in the report records the measurement.
//
// ⛔ THE SEPARATION IS THE POINT, NOT THE VERDICT. `ichimoku` draws five columns
// and exactly ONE — `chikou` — carries the verdict; Tenkan, Kijun, Span A and
// Span B genuinely do not repaint. A case that only checked `chikou` would stay
// green under a change that badges all five, which is the second of the three
// moves record §4.1 refused (it trades a false "safe" for a false "unsafe") and
// is precisely why the badge was not flipped wholesale earlier. So the negative
// half is asserted beside the positive one, DERIVED from the shipped
// definition's own plot list, so a plot added to `ichimoku` tomorrow is judged
// here rather than being invisible to this file.
//
// ⚠️ AND SILENCE IS "NO OPINION OR CLEAN", NEVER A GREEN TICK. Spec §11 forbids
// static analysis of hand-written computes, so the linter cannot read sixteen of
// the seventeen; a clean `ast` formula it CAN read also renders nothing, because
// *"a badge that every indicator wears carries no information"* is the owner's
// own reason for the per-plot ruling. This file asserts the ABSENCE of a badge
// and never asserts a clean one.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { catalogRows, userCatalogRows } from './indicatorCatalog'
import * as engineRegistry from './engine/nativeRegistry'
import {
  listDefinitions, validateUserDefinitions,
  installUserDefinitions, clearUserDefinitions,
} from './engine/nativeRegistry'
import { definitionRollUp, CLEAN } from './engine/repaintVerdict'
import { REPAINT_MODES } from './engine/defSchema'
import { parseFormula } from './engine/ast/parse'
import { buildDefinition } from './builder/BuilderSheet'
import { evaluateFormula } from './builder/FormulaField'

const base = () => mergeChartSettings(null)

const open = (registry = engineRegistry) => {
  render(<IndicatorLibraryDialog open onClose={() => {}} settings={base()}
                                 onChange={vi.fn()} registry={registry} />)
}

/** The row for one definition id, found the way a member finds it — by browsing
 *  the rendered list — rather than by a class name. */
const rowFor = (defId) =>
  screen.getAllByRole('option').find((li) => li.dataset.defId === defId)

/** The badge element on a row, or `null`. Located by the DATA CONTRACT
 *  (`data-repaint`) rather than by text, so a case can assert the ABSENCE of a
 *  badge without also asserting the absence of some particular wording. */
const badgeIn = (row) => row.querySelector('[data-repaint]')

const shipped = (id) => listDefinitions().find((d) => d.id === id)

// ⚠️ TEARDOWN UNDOES WHAT SETUP CREATED — the installed index is module-scoped,
// so a case that leaves a definition behind changes the answer every later case
// gets, in the direction that makes the control below pass for the wrong reason.
afterEach(() => { cleanup(); clearUserDefinitions() })


describe('🔴 the library row badges the LINTER\'S measurement, per plot', () => {
  it('⭐ THE HEADLINE — `ichimoku`\'s row carries the repainting verdict, and it names CHIKOU', () => {
    const ichimoku = shipped('ichimoku')

    // ⭐ THE PREMISE, ASSERTED RATHER THAN ASSUMED — and it is the whole reason
    // this surface was lying. The definition DECLARES the clean badge (it comes
    // from `nativeDef`'s one shared helper, before the `...meta` spread, so all
    // seventeen inherit it), while the linter MEASURES a 26-bar forward window
    // on `chikou`. If these two ever agree, this case is measuring nothing and
    // must be re-read rather than deleted.
    expect(ichimoku.meta.repaint,
      'ichimoku no longer DECLARES the clean badge — the disagreement this case ' +
      'exists to surface is gone, and the record\'s measurement block should be re-read',
    ).toBe(CLEAN)
    expect(definitionRollUp(ichimoku)).toBe('preview-repaints')

    open()
    const row = rowFor('ichimoku')
    expect(row, 'ichimoku is not in the library at all').toBeTruthy()
    const badge = badgeIn(row)
    expect(badge,
      '🔴 the ichimoku row carries NO measured repaint badge. `definitionRollUp` ' +
      'says `preview-repaints`; the row is the surface that has to say so.',
    ).toBeTruthy()

    expect(badge.getAttribute('data-repaint')).toBe('preview-repaints')
    expect(badge.getAttribute('data-repaint-plots')).toBe('chikou')
    // …and in words a member reads, not only in an attribute.
    expect(badge.textContent).toContain('Preview-repaints')
    expect(badge.textContent).toContain('Chikou')
    // The linter's own settling sentence rides along, untouched — it is the one
    // thing that turns "this repaints" into something actionable.
    expect(badge.getAttribute('title')).toContain('26')
  })

  it('⛔⛔ THE SEPARATION — the OTHER four ichimoku plots are NOT branded, and the list is DERIVED', () => {
    // A case that only checked `chikou` above would stay green on a change that
    // badges the whole definition — the refused move that slanders four honest
    // columns. This is that case's other half, and the plot labels come off the
    // shipped definition so a sixth plot is judged rather than ignored.
    const ichimoku = shipped('ichimoku')
    const others = ichimoku.plots.filter((p) => p.key !== 'chikou')
    expect(others.length, 'ichimoku no longer has sibling plots to separate from').toBeGreaterThan(0)

    open()
    const badge = badgeIn(rowFor('ichimoku'))
    const spoken = `${badge.textContent} ${badge.getAttribute('data-repaint-plots')} ${badge.getAttribute('title')}`

    for (const plot of others) {
      expect(spoken, `the row brands ${plot.key} — the cloud and the conversion/base ` +
        'lines do not repaint, and marking them trades a false "safe" for a false "unsafe"',
      ).not.toContain(plot.label)
      expect(badge.getAttribute('data-repaint-plots').split(' ')).not.toContain(plot.key)
    }
  })

  it('⛔ CONTROL — every definition the linter did NOT measure as dirty shows NO badge', () => {
    // The direction a happy-path suite always misses: without it, "the badge
    // renders" is satisfiable by a surface that badges everything — the uniform
    // column record §1 measured and record §4 refused in the owner's own words.
    const quiet = listDefinitions().filter((d) => {
      const verdict = definitionRollUp(d)
      return !verdict || verdict === CLEAN
    })
    // …and the partition is real: some are quiet and some are not, so neither
    // half of this file is vacuously satisfied by an empty set.
    expect(quiet.length).toBeGreaterThan(0)
    expect(quiet.length).toBeLessThan(listDefinitions().length)

    open()
    for (const def of quiet) {
      const row = rowFor(def.id)
      expect(row, `${def.id} is missing from the library`).toBeTruthy()
      expect(badgeIn(row),
        `${def.id} wears a repaint badge the linter never measured. ` +
        'Silence here means "no opinion or clean"; a badge is a measurement.',
      ).toBeNull()
    }
    // The carved-out section has no definition at all, so it has nothing to
    // measure and nothing to say.
    expect(badgeIn(rowFor('volumeProfile'))).toBeNull()
  })

  it('⚠️ …and NOTHING anywhere renders a CLEAN badge — "no opinion" is not "the linter agreed"', () => {
    open()
    // ⛔ THE VOCABULARY IS IMPORTED, NEVER RETYPED, so a fourth mode cannot slip
    // past this by being spelled differently from the literal a test remembered.
    expect(REPAINT_MODES).toContain(CLEAN)
    for (const row of screen.getAllByRole('option')) {
      expect(within(row).queryByText(new RegExp(CLEAN, 'i')),
        'a row prints the clean badge — sixteen of seventeen definitions are ' +
        'hand-written computes the linter may not read, and painting them green ' +
        'writes "the linter agreed" over silence',
      ).toBeNull()
    }
  })
})


describe('⛔ the badge is the LINTER\'S, and an author cannot set it by hand', () => {
  it('a DECLARED badge does not reach the row — in the direction that over-states DANGER', () => {
    // A definition the linter cannot read (hand-written compute, no declared
    // forward window) that DECLARES the worst badge in the vocabulary. If the
    // row still read `meta.repaint`, this would paint a warning nothing measured.
    const claimed = {
      ...shipped('rsi'),
      id: 'probeClaimsRepaints',
      meta: { ...shipped('rsi').meta, name: 'Claims Repaints', shortName: 'CR', repaint: 'repaints' },
    }
    expect(definitionRollUp(claimed), 'the probe is measurable after all — pick an unreadable compute').toBeNull()

    open({ listDefinitions: () => [claimed] })
    const row = rowFor('probeClaimsRepaints')
    expect(row).toBeTruthy()
    expect(badgeIn(row),
      'the row badged a DECLARED value. A badge an author types is the audited ' +
      'metadata the decision record exists to replace, one level down.',
    ).toBeNull()
  })

  it('…and in the direction that under-states it: `ichimoku` DECLARES clean and the row says otherwise', () => {
    // The same claim, the other way round, on a SHIPPED definition — which is
    // the live case. The declared badge says the line can be trusted; the
    // measurement says a point moves for 26 more bars. The row follows the
    // measurement.
    expect(shipped('ichimoku').meta.repaint).toBe(CLEAN)
    open()
    expect(badgeIn(rowFor('ichimoku')).getAttribute('data-repaint')).toBe('preview-repaints')
  })

  it('⛔ a hand-set PER-PLOT badge is refused at the door — value-agnostic, so BOTH directions', () => {
    // `defSchema` refuses `plots[].repaint` BY NAME rather than by value, so the
    // refusal cannot be one-directional: there is no value that gets through.
    // This is what makes the ledger's "no plot carries a badge" clause empty by
    // CONSTRUCTION instead of by nobody having written one.
    const clean = memberFormula('Hand-set plot badge')
    for (const mode of REPAINT_MODES) {
      const tampered = {
        ...clean,
        plots: clean.plots.map((p) => ({ ...p, repaint: mode })),
      }
      const { defs, errors } = validateUserDefinitions([tampered])
      expect(defs, `plots[].repaint: ${mode} was accepted`).toEqual([])
      expect(errors.join('\n')).toContain('a plot may not declare a repaint badge')
    }
  })

  it('⛔ a hand-set DEFINITION badge that disagrees with the tree is refused too', () => {
    const clean = memberFormula('Hand-set def badge')
    expect(clean.meta.repaint).toBe(CLEAN)          // what the linter measured
    expect(validateUserDefinitions([clean]).errors).toEqual([])   // the control

    for (const lie of REPAINT_MODES.filter((m) => m !== CLEAN)) {
      const tampered = { ...clean, meta: { ...clean.meta, repaint: lie } }
      const { defs, errors } = validateUserDefinitions([tampered])
      expect(defs, `meta.repaint: ${lie} was accepted over a clean tree`).toEqual([])
      expect(errors.join('\n')).toContain('refused in BOTH directions')
    }

    // ⚠️ THE OPPOSITE LIE — a `non-repainting` badge over a tree that really
    // repaints — IS UNREACHABLE ON THIS LANE TODAY, AND THAT IS MEASURED RATHER
    // THAN ASSUMED. `closedTable.json` is closed, so a tree the linter brands
    // `repaints` is one it cannot resolve at all, and `registerDefinitions`
    // refuses it by TABLE before `validateAstLane` ever runs its badge gate.
    // Recorded here so a later reader does not read the gap as an untested
    // direction: the gate is `meta.repaint !== verdict.mode`, which is symmetric
    // by construction, and the asymmetry is in what the table admits. Built
    // through `buildDefinition` so the hash, the source and the tree agree and
    // the refusal below really is the TABLE's rather than a broken fixture's.
    const source = 'notAFunction(close)'
    const parsed = parseFormula(source)
    expect(parsed.ok, 'the probe no longer parses — pick another unresolvable call').toBe(true)
    const unresolvable = buildDefinition({
      defId: 'u_ffffffffffff', name: 'Unresolvable', source, ast: parsed.ast,
      mode: CLEAN, readback: evaluateFormula('sma(close, 20)').readback,
    })
    expect(definitionRollUp(unresolvable),
      'the tree the badge would be lying about is no longer measured as repainting',
    ).toBe('repaints')
    expect(unresolvable.meta.repaint).toBe(CLEAN)     // the over-claiming lie
    const { defs, errors } = validateUserDefinitions([unresolvable])
    expect(defs).toEqual([])
    expect(errors.join('\n')).toContain('resolve:function')
  })
})


describe('⭐ a member\'s own formula is judged by the same linter', () => {
  it('a CLEAN formula is listed and wears NO badge', () => {
    const doc = memberFormula('20-bar average')
    const res = installUserDefinitions([doc])
    expect(res.errors).toEqual([])
    expect(res.installed).toHaveLength(1)

    // …and it is the LINTER's clean answer, not an absence of one: this is the
    // one lane where the measurement really is `non-repainting` rather than
    // `null`, and both render the same way on purpose.
    expect(definitionRollUp(res.installed[0])).toBe(CLEAN)
    expect(userCatalogRows().map((r) => r.measuredRepaint)).toEqual([CLEAN])

    open()
    const row = rowFor(doc.id)
    expect(row, 'the member\'s own formula is missing from the library').toBeTruthy()
    expect(badgeIn(row)).toBeNull()
  })

  it('⛔ and the catalogue serves BOTH the claim and the measurement, without merging them', () => {
    // The claim keeps its meaning and its other consumers; what moved is which
    // of the two the ROW renders. A change that deleted `repaint` from the row
    // shape would take the field's other readers with it silently.
    const rows = catalogRows()
    const ichimoku = rows.find((r) => r.id === 'ichimoku')
    expect(ichimoku.repaint).toBe(CLEAN)                     // the CLAIM
    expect(ichimoku.measuredRepaint).toBe('preview-repaints')   // the MEASUREMENT
    expect(ichimoku.repaintingPlots.map((n) => n.plotKey)).toEqual(['chikou'])
    // Every row answers both fields, on both branches — including the carved-out
    // one, which has no definition to measure.
    expect(rows.filter((r) => !('measuredRepaint' in r) || !Array.isArray(r.repaintingPlots))).toEqual([])
  })
})


/** A member's formula, built by the SAME function the builder saves with.
 *
 *  ⛔ NOT A HAND-WRITTEN FIXTURE — `userDefs.test.jsx` states the reason:
 *  `buildDefinition` is what decides what a user definition looks like,
 *  including the machine-assigned badge this file is about, and a fixture typed
 *  here would be a second answer that goes on passing after the real one moves. */
function memberFormula(name, source = 'sma(close, 20)', defId = 'u_a1b2c3d4e5f6') {
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
