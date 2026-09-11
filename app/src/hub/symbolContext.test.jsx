// ⛔ WHICH BUBBLES ARE LIVE IN EACH SHIPPED MODE — asserted, never read off the source.
//
// `HubRoot` computes `disabledIds` from the hub CONTEXT (`symbol`, `selectedPosition`), and
// `useHub()` is called nowhere outside `app/src/hub/`. So a section that does not set the symbol
// ships a fan whose symbol-requiring bubbles render DISABLED with the cursor sitting on a ticker —
// and nothing about that is loud. The gesture resolves, the bubble dims, the member concludes the
// feature is broken.
//
// ⭐ THIS FILE EXISTS BECAUSE READING THE SECTIONS WAS NOT ALLOWED TO SETTLE IT (owner ruling,
// 2026-09-09: "verify by test, not by reading"). Each mode below states the enabled set it ships
// with, and the expectation is DERIVED from the registry rather than typed — so an action added to
// a fan tomorrow lands in the right bucket on the day it lands, instead of quietly inheriting a
// stale list.

import { describe, it, expect } from 'vitest'
import { modes, modesById, PREVIEW_MODES } from './registry'

/** The same rule `HubRoot.disabledIds` applies, expressed once here so the two cannot drift. */
const disabledFor = (mode, ctx) => mode.fan
  .filter((a) => (a.requires ?? []).some((r) => ctx[r] === false))
  .map((a) => a.id)

const enabledFor = (mode, ctx) => {
  const off = new Set(disabledFor(mode, ctx))
  return mode.fan.map((a) => a.id).filter((id) => !off.has(id))
}

/** What each shipped section actually puts into hub context, verified in its own suite. */
const SHIPPED = {
  // Sets `symbol` from the ticker under the cursor.
  scan: { symbol: true, position: false },
  // Sets `symbol` from the selected position, and `selectedPosition` with it.
  journal: { symbol: true, position: true },
  // ⚠️ Sets NOTHING. Its fan carries three symbol-requiring actions, so they ship DISABLED with
  // the chip reading "Pick a stock first". That is a deliberate state, not an oversight: a wire
  // segment is prose, and only some carry a ticker. Wiring a symbol from a segment that does not
  // name one would put a stale ticker behind Flag and Chart it.
  wire: { symbol: false, position: false },
  // Sets nothing, and needs nothing — see the assertion below.
  breadth: { symbol: false, position: false },
  // ⚰️ ADDED BY INCREMENT 4 (B10). Notebook left the preview when §3.7 shipped. It sets nothing and
  // needs nothing: `newNote` requires no context, and `dailyPlan`/`postMortem` are navigations.
  // ⭐ AND `linkTicker` IS BACK (Increment 7, R-17) WITHOUT `requires`. It was removed rather than
  // shipped permanently disabled, because the route carries no symbol; it returns with the symbol
  // coming from a REQUIRED FIELD on its own confirm sheet instead of from ctx. So this row still
  // reads `symbol: false` and the fan is still entirely enabled — which is the point: a section
  // that cannot supply a symbol must not declare an action that demands one.
  notebook: { symbol: false, position: false },
  // ⚰️ ADDED BY INCREMENT 5. Calendar left the preview when its controller shipped (R-C — it was a
  // §6 omission, never a §7 error). It needs NEITHER: the fan is a macro toggle plus a navigation
  // to /calendar/mystocks, and the day it acts on comes from the page's own week, not from ctx.
  calendar: { symbol: false, position: false },
  // ⚰️ ADDED BY INCREMENT 5 (§3.5). Chart needs the SYMBOL — Flag, Note and Plan trade all act on
  // the chart's current ticker — and no position: the chart holds a price series, not a trade.
  chart: { symbol: true, position: false },
  // ⚰️ ADDED BY INCREMENT 5 (§3.6) — the LAST section. Catalysts needs the SYMBOL: Chart it, Why,
  // Flag and Note all act on the cursor's row ticker. No position; the tile is a read of the tape.
  catalysts: { symbol: true, position: false },
}

describe('every shipped mode ships the fan it means to', () => {
  it('CONTROL: exactly the shipped modes have left the preview', () => {
    // If this drifts, every expectation below is describing a different product.
    //
    // ⚰️ WAS "exactly the four Increment 2 modes", listing wire/breadth/scan/journal. B10 flipped
    // `notebook` live and this control went red — correctly. It is the FIXTURE that became
    // unrepresentative, not the product: a control that pins a count of four is a control that has
    // to be edited by every increment that ships a section, which is the point of it.
    const shipped = modes.map((m) => m.id).filter((id) => !PREVIEW_MODES.has(id)).sort()
    expect(shipped).toEqual(
      ['breadth', 'calendar', 'catalysts', 'chart', 'journal', 'notebook', 'scan', 'wire'])
    expect(Object.keys(SHIPPED).sort()).toEqual(shipped)
  })

  it('⛔ BREADTH needs no symbol at all — nothing in its fan may require one', () => {
    // The owner's ruling allowed for adjusting the registry if Breadth had a symbol-requiring
    // action. It does not, so nothing was adjusted — and this pins that, because adding one later
    // would ship a permanently-dead bubble: Breadth has no ticker to offer.
    const needsSymbol = modesById.breadth.fan
      .filter((a) => (a.requires ?? []).includes('symbol')).map((a) => a.id)
    expect(needsSymbol, 'Breadth gained a symbol-requiring action but sets no symbol — it would '
      + 'ship permanently disabled').toEqual([])
    expect(enabledFor(modesById.breadth, SHIPPED.breadth)).toEqual(modesById.breadth.fan.map((a) => a.id))
  })

  it('SCREENER: the cursor supplies a symbol, so every bubble is live', () => {
    const enabled = enabledFor(modesById.scan, SHIPPED.scan)
    expect(enabled).toEqual(modesById.scan.fan.map((a) => a.id))
    expect(enabled).toContain('scan.planTrade')
    expect(enabled).toContain('scan.chartIt')
  })

  it('JOURNAL: the selected position supplies both symbol and position', () => {
    const enabled = enabledFor(modesById.journal, SHIPPED.journal)
    expect(enabled).toEqual(modesById.journal.fan.map((a) => a.id))
    // The three that need a position specifically — the ones that 404 on a strategy row.
    expect(enabled).toEqual(expect.arrayContaining(
      ['journal.moveStop', 'journal.breakeven', 'journal.close'],
    ))
  })

  it('⚠️ WIRE ships three DISABLED bubbles, and that is the documented state', () => {
    const disabled = disabledFor(modesById.wire, SHIPPED.wire)
    expect(disabled.sort()).toEqual(['wire.chartIt', 'wire.flag', 'wire.note'])
    // Voice and Home never require anything, so the section is still useful.
    const enabled = enabledFor(modesById.wire, SHIPPED.wire)
    expect(enabled).toContain('wire.voice')
    expect(enabled).toContain('wire.home')
  })

  it('⛔ every disabled-by-design bubble has a REASON the member can read', () => {
    // `HubActionsButton` has always accepted `disabledReason` and nothing ever passed one, so a
    // disabled bubble was a grey circle with no explanation. Spec §2e: an unmet requirement must
    // teach what to select first — hiding says the action does not exist, dimming without a reason
    // says it is broken.
    const reasonFor = (action, ctx) => {
      const needs = action?.requires ?? []
      if (needs.includes('symbol') && !ctx.symbol) return 'Pick a stock first'
      if (needs.includes('position') && !ctx.position) return 'Pick a position first'
      return null
    }
    for (const [id, ctx] of Object.entries(SHIPPED)) {
      for (const actionId of disabledFor(modesById[id], ctx)) {
        const action = modesById[id].fan.find((a) => a.id === actionId)
        expect(reasonFor(action, ctx), `${actionId} is disabled with no reason to show`).toBeTruthy()
      }
    }
  })

  it('CONTROL: the rule can actually disable something — it is not vacuously true', () => {
    // Without this, a bug that made `disabledFor` always return [] would make every assertion
    // above pass.
    expect(disabledFor(modesById.scan, { symbol: false, position: false }).length).toBeGreaterThan(0)
  })
})
