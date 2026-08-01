// app/src/components/chart/signatureToggles.js — the UCT Signature toggle rows.
//
// A constants-only module so ChartToolbar can stay a components-only file
// (react-refresh/only-export-components: a component file that also exports a
// constant breaks Fast Refresh, and the rule's own remedy is exactly this — put
// the shared constant in its own file).
//
// The key column is a CONTRACT, and it runs three ways:
//
//   WRITE  these rows            → ChartToolbar renders them and each one calls
//                                  update(`signature.<key>`, bool)
//   STORE  CHART_DEFAULTS.signature (chartDefaults.js)
//   READ   SIGNATURE_TOGGLE      (hooks/useSignatureIndicators.js) — the keys
//                                  the fetch actually indexes the blob by
//
// The failure mode on a mismatch is SILENT, which is why it is tested rather
// than trusted: mergeChartSettings SPREADS `signature` (it is not a per-key
// allow-list), so a mistyped key here persists perfectly happily — the checkbox
// ticks, the save round-trips, and the indicator simply never draws, because
// the hook looked up a different key. Nothing throws, nothing logs.
// `chartDefaults.test.js` pins all three sets together; extend them as a unit.

// The tooltips are the OWNER-APPROVED refinements (2026-08-01), and the house
// rule they satisfy is: a "non-repainting" claim must state its MECHANISM.
// "Non-repainting." as a bare word is an assertion a user has to take on faith
// and a future reader has no way to check against the code. Each string now
// names the thing that makes it true — confirmed prints for DPL, closed bars
// for flow — so the claim is falsifiable. GEX deliberately makes NO
// non-repainting claim: it is a live chain read and it says so.
/** @type {ReadonlyArray<[key: string, label: string, tooltip: string]>} */
export const SIGNATURE_ROWS = [
  ['darkPoolLevels', 'Dark Pool Levels', 'Top 5 dark-pool notional levels from the last 20 sessions. Non-repainting: computed from confirmed prints only.'],
  ['gexWalls', 'GEX Walls', 'Call/Put walls + zero gamma from the live options chain (expiries within 7 days, strikes within 15% of spot). Live level set, cached 10 min.'],
  ['flowSignals', 'Flow Signals', 'Daily breakouts confirmed by same-session options flow. Non-repainting: evaluated on closed bars only.'],
]

// Free users see the rows DISABLED rather than hidden — the panel's decision of
// record: merchandise the feature, don't pretend it doesn't exist. This replaces
// the per-row tooltip for an unpaid user, so it is the ONLY copy they read.
export const SIGNATURE_LOCKED_TITLE = 'Premium — UCT Signature indicators'
