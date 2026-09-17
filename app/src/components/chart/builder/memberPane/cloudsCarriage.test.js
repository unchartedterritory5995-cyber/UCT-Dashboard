// app/src/components/chart/builder/memberPane/cloudsCarriage.test.js
//
// ─── ⭐⭐ (j) j.1 — ALL 23 OUTPUTS REACH THE PANE DOCUMENT ────────────────────
//
// Uncharted Clouds TRANSLATES to 23 outputs and the pane document carried **2**.
// The scoping read named two INDEPENDENT drops and measured that lifting either
// alone yields zero clouds:
//
//   G1  `memberPaneDefinition.js` — the drawable filter carried `!o.hidden`, so
//       the 21 `display.none` anchors never entered the document at all.
//   G4  `binder.js` — a hidden plot is `continue`d in pass ONE, so it never
//       reaches the fill wiring in pass TWO, which attaches a fill to the plot's
//       OWN series — and an orphaned plot has none.
//
// ⭐⭐ RULING R24: **carrying a hidden output is NOT a D2 revisit.** D2 governs
// WHICH lane's saved definition a pane reads, not what a definition may contain.
// A `display.none` plot is an ANCHOR a fill references: the definition carries it
// with `hidden: true`, the renderer draws nothing for it, and a fill may point at
// it.
//
// ⛔ AND RULING 1.2 IS NOT TOUCHED. Its two tests are ANDed — untitled AND filled
// — and it governs what the door OFFERS and SELECTS as a column. A carried anchor
// is never selectable, which the last control here pins.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from './memberPaneDefinition.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const CLOUDS = 'tests/fixtures/member/uncharted-clouds.pine'
const src = () => fs.readFileSync(path.join(REPO, CLOUDS), 'utf8')

const built = () => memberPaneDefinition({ source: src(), id: 'u_member-pane_clouds', name: 'Clouds' })

describe('(j) j.1 — the Clouds pane document carries every output', () => {
  it('⛔⛔ NON-VACUITY CONTROL — the fixture exists, translates, and DECLARES 20 fills', () => {
    // Without this, "20 fills are carried" passes over a translation that
    // produced none, and every count below would be asserting over empty sets.
    expect(fs.existsSync(path.join(REPO, CLOUDS)), 'the Clouds fixture is gone').toBe(true)
    const r = built()
    expect(r.ok, `the pane refused Clouds outright: ${r.reason}`).toBe(true)
    expect(r.translation, 'no translation came back').toBeTruthy()
    const outs = r.translation.outputs || []
    expect(outs.length, 'Clouds no longer translates to 23 outputs').toBe(23)
    const fills = (r.translation.presentation || {}).fills || []
    expect(fills.length, 'the translation declares no fills, so nothing is under test')
      .toBe(20)
  })

  it('⭐⭐ 23 CARRIED — 21 hidden, 2 visible — PLUS R34\'s ONE condition row', () => {
    // ⭐ 24, AND THE 24th IS R34 WORKING. Once R35c/R35d made Clouds' fill colours
    // fold, all 20 fills carry a `colorCondition` over ONE `isBullish`, and the
    // pane door mints a single hidden condition row for them — DEDUPED BY
    // FORMULA, which is the entire content of R34. Twenty fills, one row.
    // ⚰️ This asserted 23 and was right until the fold landed; the premise moved
    // by RULING, so the number is re-baselined rather than the rail deleted.
    const r = built()
    const plots = (r.definition || {}).plots || []
    expect(plots.length, 'the pane document did not carry 23 outputs + 1 condition row').toBe(24)
    expect(plots.filter((p) => p.hidden === true).length,
      'the 21 hidden anchors plus the hidden condition row').toBe(22)
    expect(plots.filter((p) => p.hidden !== true).length, 'the two visible plots moved')
      .toBe(2)
    // ⛔ THE CONDITION ROW IS IDENTIFIED BY WHAT MAKES IT ONE — a key some fill's
    // `colorMode` NAMES — not by its spelling. R34's whole ruling is that twenty
    // fills over one `isBullish` mint exactly ONE row, so the set of named keys
    // must have size 1 even though twenty fills reference it.
    const named = new Set()
    for (const p of plots) {
      const m = /^column:(.+)$/.exec((p.fill && p.fill.colorMode) || p.colorMode || '')
      if (m) named.add(m[1])
    }
    expect(named.size, 'R34 minted more than one condition row for one condition').toBe(1)
    expect(plots.some((p) => p.key === [...named][0] && p.hidden === true),
      'the condition row is not hidden — it would draw').toBe(true)
  })

  it('⭐⭐ every fill names TWO anchors, and both resolve to carried plots', () => {
    const r = built()
    const plots = (r.definition || {}).plots || []
    const keys = new Set(plots.map((p) => p.key))
    const withFill = plots.filter((p) => p.fill && typeof p.fill.with === 'string')
    expect(withFill.length, 'no plot in the document declares a fill').toBe(20)
    for (const p of withFill) {
      expect(keys.has(p.fill.with), `fill on ${p.key} points at ${p.fill.with}, which is not a carried plot`)
        .toBe(true)
      expect(p.fill.with, 'a fill points at its own plot').not.toBe(p.key)
    }
  })

  // ── CONTROLS: what j.1 must not move.

  it('⛔⛔ CONTROL — the two VISIBLE plots are unchanged, by label', () => {
    // The 2 that survived the old filter must come through identically; a change
    // here would mean j.1 moved what already worked.
    const r = built()
    const vis = ((r.definition || {}).plots || []).filter((p) => p.hidden !== true)
    expect(vis.map((p) => p.label).sort()).toEqual(['Fast MA', 'Slow MA'])
  })

  it('⛔⛔ CONTROL — ruling 1.2 stands: a hidden anchor is never SELECTED', () => {
    // Carriage is not offer. The pane's selected row must still be one the author
    // actually plots, or this change re-opens what ruling 1.2 closed.
    const r = built()
    const plots = ((r.definition || {}).plots || [])
    const sel = r.translation.selected
    const selRow = (r.translation.outputs || [])[sel]
    expect(selRow, 'nothing was selected at all').toBeTruthy()
    expect(!!selRow.hidden, 'a display.none anchor was SELECTED — ruling 1.2').toBe(false)
    // and the document's first row, which drives `source`/`ast`, is visible too
    expect(plots[0] && plots[0].hidden !== true, 'the document leads with a hidden row').toBe(true)
  })

  it('⛔⛔ CONTROL — the BUILDER\'s own cap is untouched at 12', () => {
    // ⚰️ The two constants were never wired: `memberPaneDefinition` declares its
    // own `CARRY_MAX` and does not export it, while `BuilderSheet.jsx` declares a
    // SECOND one inline — and a comment claimed they were "the same ceiling the
    // builder's own import uses". Raising the pane's cap must leave the builder's
    // literal exactly where it is, and this reads the builder's source to say so.
    const bs = fs.readFileSync(path.join(REPO,
      'app/src/components/chart/builder/BuilderSheet.jsx'), 'utf8')
    const m = bs.match(/const\s+CARRY_MAX\s*=\s*(\d+)/)
    expect(m, "the builder's CARRY_MAX declaration moved").toBeTruthy()
    expect(Number(m[1]), "j.1 changed the BUILDER's cap, which is a different surface").toBe(12)
  })
})
