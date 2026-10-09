// INDICATORS M1 — acceptance tests, written BEFORE the work (docs/agent/M1-INDICATORS-PLAN.md).
// Every case is a `todo` until the Indicator team's agentSeams.js + opener are on master and they
// confirm the interfaces are ready (owner gate, 2026-10-09). Nothing here imports unpublished code.
import { describe, it } from 'vitest'

describe('M1 indicator.list (query) — built only from instancesOf', () => {
  it.todo('0 indicators → "No indicators on <SYM>." (no model text)')
  it.todo('1 indicator → one row: name, built-in/custom, shown/hidden, price/pane')
  it.todo('12 indicators → 12 rows in stored order, exactly instancesOf(cs, registry)')
  it.todo('the live Create Indicator preview (u_studio-preview) is never listed')
  it.todo('instances are addressed by instanceId through short refs, never by name')
})

describe('M1 indicator.openCreate — the Indicators opener, never /converse', () => {
  it.todo('absent from the manifest for a non-admin, an admin without uct.feature.createIndicator, and a member outside the cohort')
  it.todo('with a request: opener called with seedFrom(request); receipt says "press Send"; no /converse request')
  it.todo('existing draft on that chart: receipt says the draft is open instead; never claims the seed was placed')
  it.todo('defId from an indicator.list row → Modify; unknown/foreign defId → refusal, nothing opened')
  it.todo('refused when the chart snapshot says canCreateIndicator is false (read-only chart)')
  it.todo('exclusive: never combined with another change in one plan')
  it.todo('undo is none; the receipt says how to cancel (close the panel)')
})

describe('M1 routing — the indicators group', () => {
  it.todo('"add an RSI with a 4-colour histogram" routes indicators')
  it.todo('"make the chart dark" does not route indicators')
  it.todo('"colour the candles by trend" routes indicators AND charts')
  it.todo('"arrows when the 9 EMA crosses the 20" routes indicators (condition rule)')
  it.todo('the indicators group packs under the routed budget beside every other group')
})

describe('M1 safety', () => {
  it.todo('no chart_settings / board write in any M1 action (fingerprint before = after)')
  it.todo('Main Trading open: indicator.list still answers (a read); openCreate writes no settings, so the protected-layout guard must not block it — confirm the plan reports changed:false')
})
