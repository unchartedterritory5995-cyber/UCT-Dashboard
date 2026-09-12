// app/src/hub/sections/screenerSection.js — the SCREENER section controller (Phase 3 §3.3).
//
// Plan: `docs/plans/joystick/60-phase3-plan.md` §3.3 (every binding there was measured by the
// 3.3a scout on 2026-09-09). Contract: `hub/contracts.js`, "PHASE 3 CONTRACTS"
// (`HubSectionConfig` + `HubListAdapter`).
//
//   tap        -> next result           double-tap -> previous result
//   scrub (y)  -> fast-scroll the list  readout    -> the ticker under the cursor
//   chip       -> "<scan name> · <index>/<loaded count>"
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ `activeTab` DOES NOT EXIST ON THIS PAGE AND NEVER DID.
// ─────────────────────────────────────────────────────────────────────────────
// `Screener.jsx` holds ONE piece of state, `shellKey` — an ErrorBoundary remount counter. The
// page's own header says why: "THIS PAGE IS THE SCANNER NOW — there is no tab strip, because
// there is nothing to switch between". What the page uses now is `view` (`useScreenSpec.js`),
// and `view` selects a COLUMN SET, not a tab: only `'charts'` changes the renderer. Per the
// owner's 3.3a ruling **the hub never touches `view`** — Primary/Reverse step RESULTS.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ `displayRows`, NEVER `rows`. AND `identityKey` IS EXPLICITLY `r => r.ticker`.
// ─────────────────────────────────────────────────────────────────────────────
// `ScannerShell` lifted the live re-sort ABOVE the three renderers (`displayRows`), so the array
// on screen re-orders on every price tick. Registering `rows` would make the cursor and the list
// the member is looking at disagree the moment the live toggle is on.
//
// And `useHubCursor` REQUIRES `opts.key`: it deleted its positional default precisely because of
// this page. No screener row carries `sym` or `symbol`; the identity is `ticker`
// (`screener_rows` is `ticker TEXT PRIMARY KEY`, `snapshot_db.py:416-417`, forced first into
// every projection and already the React key in all three renderers). A positional identity
// changes only when the LENGTH changes, so a re-scan returning a completely different 100 rows
// would read as "the same list" and the cursor would hold an index onto a symbol the member
// never selected.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE CHIP DENOMINATOR IS THE LOADED LENGTH, NOT `total`.
// ─────────────────────────────────────────────────────────────────────────────
// `total` is the SERVER's match count while `PAGE_SIZE` is 100, so a `total` denominator reads
// "3/3,745" with 100 rows in hand — a cursor promising rows it cannot reach. `ScannerShell`
// already says this in its own review-button comment ("THE LOADED PAGE, NOT `total`"). Both
// halves of the plan's remedy are taken: the denominator is `displayRows.length` AND `next`
// calls `loadMore` at the tail, the way `VirtualResults` already appends near the end.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ WHAT THIS SECTION CANNOT DO TODAY, recorded rather than faked
// ─────────────────────────────────────────────────────────────────────────────
// ⚰️ `Alert`'s price field USED to be the first bullet here: "cannot reach the member ... the ±
//    steppers are unreachable and the alert lands at the price on screen". ✅ R-14 / D-35 CLOSED
//    (`inc7/p1-confirm-fields`): `HubRoot`'s confirm branch asks the section for a payload before
//    building its own, so `confirmPayload()` below is what opens the sheet and the member states
//    the price. Railed on the RENDERED sheet in `hub/confirmFieldsReachable.test.jsx` — a test
//    that the payload function was CALLED would pass with that branch deleted again.
//  * `Plan trade` is `kind:'confirm'` in the registry while plan §3.3 calls it `run`, so today a
//    gesture opens a generic "Plan AAA" confirm and THEN the plan sheet. The registry is
//    Director-owned; filed as R-16 rather than overridden here.
//
// ─────────────────────────────────────────────────────────────────────────────
// ✅ R-13 CLOSED (increment 4). `Scans` is WIRED, and the seam is the shell's.
// ─────────────────────────────────────────────────────────────────────────────
// `ScreensManager` still owns its picker in private `open` state and still exposes no prop —
// that file belongs to another workstream. What changed is that `ScannerShell` — which RENDERS
// it, and which this section is already mounted from — now offers `openScansPicker`, and hands
// it in as `onOpenScans`. The section holds no knowledge of the picker's markup; it calls a
// callback the page supplied, exactly as it does for Flag and Plan trade.
//
// ⛔ AND THE ACTION IS STILL ABSENT WHEN NO SEAM IS SUPPLIED. `buildScanFan` drops `scan.scans`
// unless `onOpenScans` is a function, so a caller that does not open the door ships no bubble
// rather than a dead one — the "present-and-inert" the registry header forbids. That is what
// keeps `buildScanFan({symbol})` (no page behind it) honest.
//
// ─────────────────────────────────────────────────────────────────────────────
// ✅ R-15 CLOSED (increment 4). THE CURSOR IS PAINTED, AND IT IS REVEALED.
// ─────────────────────────────────────────────────────────────────────────────
// ⚰️ THIS SAID "the three renderers never spread `itemProps`". Measured 2026-09-10 and it was
// false of two of them: `VirtualResults` and `ResultCards` have taken `itemProps` and spread it
// onto the row since `eeb011c66` — a stale diagnosis in the one artifact a reader consults
// before deleting "unused" wiring. What was genuinely missing was the other half and the rail:
//
//   1. `ChartsGallery` (the `'charts'` view — the third renderer) takes no `itemProps` and is
//      not this workstream's file. `ScannerShell` paints it through `paintCursor`, the
//      imperative path `useHubCursor` documents "for markup you do not own".
//   2. NOTHING REVEALED THE PAINTED ROW ON A TAP. Both renderers are virtualized, so a row
//      outside the ~20-row window is not merely unpainted — it is not in the DOM at all. `next`
//      moved the index while the scroll position stayed put, so past the bottom of the viewport
//      the member saw no marked row anywhere. `onTap`/`onDoubleTap` now call `scrollTo` for the
//      same reason `onScrubCommit` always has, and for the reason this file already gives for
//      the adapter: "a cursor that advances off-screen has silently stopped being a cursor".
//
// Rail: `screenerCursorPaint.test.jsx` — the real page, all three renderers, asserting the
// ATTRIBUTE on the rendered row rather than the index in the store.
//
// ⭐ R-09 LANDED WHILE THIS WAS BEING WRITTEN. `HubRoot.runAction` now dispatches `action.run(ctx)`
// and opens `HubConfirmSheet` for `kind:'confirm'`, so Flag, Alert and Plan trade are LIVE the
// day the Director takes `scan` out of `PREVIEW_MODES`.

import { useCallback, useContext, useEffect, useMemo, useRef, useState, createElement, Fragment } from 'react'
import useHubCursor from '../useHubCursor'
import useHubMode from '../useHubMode'
import { useHubSetters } from '../HubContext'
import { useHubEligible } from '../useHubActive'
import PlanTradeSheet from '../PlanTradeSheet'
import { modesById } from '../registry'
import { chartsLinkPath } from '../../lib/chartDeepLink'
import { AuthContext } from '../../context/AuthContext'
import { useFlagged } from '../../hooks/useFlagged'
import useWatchlistAlerts from '../../hooks/useWatchlistAlerts'
import { useJournalToast, JournalToast } from '../../pages/journal-2-0/lib/useJournalToast'

/** The registry mode this section controls. */
export const SCAN_MODE_ID = 'scan'

/**
 * The cursor's list id — DERIVED from the registry (`modes` -> `scan.cursor.listId`), never
 * typed here, so the section and the registry cannot disagree about which store this page walks.
 *
 * ⚰️ The old plan line keyed it `scan:${scanDefinitionId}:${resultsFingerprint}`. Struck twice:
 * `listId` keys a module-level Map that is never pruned, so a per-result fingerprint leaks an
 * entry per scan — and the fingerprint is what the cursor's own identity already derives from
 * the item keys. The listId is the constant `'scan'`.
 */
export const LIST_ID = modesById[SCAN_MODE_ID]?.cursor?.listId ?? SCAN_MODE_ID

/** Stable empty list, so a screen that has not answered yet never churns the cursor identity. */
const NO_ROWS = Object.freeze([])

/**
 * ⛔ THE IDENTITY KEY, EXPLICIT AND REQUIRED. See the header.
 * @param {{ticker?: string}} row
 * @returns {string}
 */
export function identityKey(row) {
  return row?.ticker
}

/** The ticker a row is keyed by — one reader, so "which field is the symbol" is said once. */
export const tickerOf = (row) => row?.ticker ?? null

/**
 * The active scan's NAME, from the screener's own scan filter.
 *
 * `ScannerShell`'s `onUseScan` writes `{op:'in', value: <def_hash>, label: <name>}` into
 * `filters.scan`, and `ScanFilterChip` renders that same `spec.label` when the server has no
 * meta entry for the hash — so the label is the page's own answer to "which scan is this", not
 * a second one invented here. Most screens carry NO scan filter at all (a scan is one optional
 * filter among many), which is why the caller falls back to "Screener".
 *
 * @param {Record<string, {label?: string}>|null|undefined} filters
 * @returns {string|null}
 */
export function activeScanName(filters) {
  const label = filters?.scan?.label
  return typeof label === 'string' && label.trim() ? label.trim() : null
}

/**
 * The chip's mode text: "<scan name> · <1-based index>/<loaded count>", e.g.
 * "Powerplay · 3/41", or "Screener · 3/41" when no scan filter is applied.
 *
 * ⛔ `count` is the LOADED length. See the header note on `total`.
 *
 * @param {{scanName?: string|null, index: number, count: number}} args
 * @returns {string}
 */
export function chipLabel({ scanName, index, count } = {}) {
  const name = (typeof scanName === 'string' && scanName.trim()) ? scanName.trim() : 'Screener'
  if (!count || count <= 0 || index < 0) return `${name} · no results`
  return `${name} · ${index + 1}/${count}`
}

/**
 * ⭐ THE PLAN-TRADE HAND-OFF: SYMBOL, PLUS THE LAST PRICE ONLY IF THE STREAM HAS ONE.
 *
 * Owner ruling, 2026-09-09 (§3.3, option 1). The Screener cannot supply entry/stop/size and must
 * not pretend to: entry and stop exist on this page only as DISTANCES
 * (`pattern_entry_dist_pct` / `pattern_stop_dist_pct`), they live in exactly ONE view
 * (`patterns`) while the default view is `overview`, they are deliberately blank on stale rows,
 * and `size` does not exist on the Screener at all. So this returns the symbol and — when the
 * live stream has a price for it — that price as the sheet's default entry. NOTHING ELSE.
 *
 * ⛔ `lastPrice` comes from the STREAM, never from `row.price`. `row.price` is the 03:00
 * snapshot; handing it over as "the last price" would be a fabricated level wearing a live
 * label, which is the exact thing blank-means-blank was written to stop.
 *
 * @param {{symbol: string|null|undefined, lastPrice?: number|null}} args
 * @returns {{symbol: string, lastPrice?: number}|null}
 */
export function planTradeProps({ symbol, lastPrice } = {}) {
  const sym = typeof symbol === 'string' ? symbol.trim() : ''
  if (!sym) return null
  if (typeof lastPrice === 'number' && Number.isFinite(lastPrice) && lastPrice > 0) {
    return { symbol: sym, lastPrice }
  }
  return { symbol: sym }
}

/**
 * The Alert action's `HubConfirmPayload` (`contracts.js`), ready for `HubConfirmSheet`.
 *
 * ⭐ The price field defaults to WHAT THE MEMBER IS LOOKING AT. All three renderers overlay the
 * live price when there is one and fall back to `row.price` otherwise, so `reference` is passed
 * in already resolved that way — a default taken from a different number than the one on screen
 * would make the sheet argue with the table.
 *
 * ⭐ THE DIRECTION IS DERIVED, NEVER ASKED. An alert above the current price is an "above"
 * alert and one below it is a "below" alert; making the member state both the level and the
 * direction lets them state a contradiction (`above 5` on a $99 stock fires instantly).
 *
 * @param {{symbol: string, reference: number, createAlert: Function}} args
 * @returns {import('../contracts').HubConfirmPayload|null} null when no price is known — the
 *   sheet is not opened rather than opened around a fabricated level.
 */
export function alertConfirmPayload({ symbol, reference, createAlert } = {}) {
  const sym = typeof symbol === 'string' ? symbol.trim() : ''
  if (!sym) return null
  if (typeof reference !== 'number' || !Number.isFinite(reference) || reference <= 0) return null
  const at = Number(reference.toFixed(2))
  return {
    title: `Alert on ${sym}`,
    body: `Alert when ${sym} crosses this price. ${sym} is ${at.toFixed(2)} now.`,
    primaryLabel: 'Create alert',
    fields: [{ name: 'price', type: 'number', value: at, min: 0.01, step: 0.01 }],
    onConfirm: (values) => {
      const price = Number(values?.price)
      if (!Number.isFinite(price) || price <= 0) return
      createAlert?.(sym, price, price >= at ? 'above' : 'below')
    },
  }
}

/**
 * The section's fan, DERIVED from the registry entry and never re-typed.
 *
 * ⛔ ONE AUTHORITY OVER "WHAT ACTIONS DOES SCAN HAVE". `registry.js` owns the ids, labels,
 * icons, rings, colours, kinds and `requires` — this only attaches handlers and the two dynamic
 * `to` targets. A second hand-typed list here is the enumeration defect this repo keeps paying
 * for; an action added to the registry tomorrow arrives here on the day it lands, unhandled,
 * which is why the unhandled case DROPS rather than passing through inert.
 *
 * ⛔ AN UNWIRED ACTION IS ABSENT, NEVER PRESENT-AND-INERT (registry.js header). `scan.scans` is
 * shipped only when the page handed in a seam that opens the picker; without one it is dropped,
 * not shipped as a dead bubble. See the R-13 note in the module header.
 *
 * @param {Object} args
 * @param {string|null} args.symbol      The ticker under the cursor.
 * @param {number|null} args.streamPrice The stream's price for it, or null.
 * @param {number|null} args.shownPrice  The price the table is showing for it (stream, else row).
 * @param {() => void} args.onFlag
 * @param {(props: object) => void} args.onPlanTrade
 * @param {Function} args.createAlert
 * @param {(() => void)|null} [args.onOpenScans] The page's seam onto its saved-screen picker.
 * @returns {import('../registry').HubAction[]}
 */
export function buildScanFan({
  symbol, streamPrice, shownPrice, onFlag, onPlanTrade, createAlert, onOpenScans,
} = {}) {
  const registryFan = modesById[SCAN_MODE_ID]?.fan ?? []
  const out = []
  for (const action of registryFan) {
    switch (action.id) {
      case 'scan.chartIt':
        // ⭐ THE SYMBOL RIDES THE URL, because nothing on /charts reads the hub context.
        // `chartsLinkPath` is the ONE module that knows how to point the charts page at
        // something (`lib/chartDeepLink.js`); `ChartsWorkspace` reads it and applies it through
        // `setGroupSym('A', …)`, then strips the params. A hand-typed `?sym=` here would be the
        // second half of a pair that agrees only on the day it is written.
        // `resolveNavTarget` in HubRoot falls through to a literal path when `to` is not a mode
        // id, so a full path carrying a query string is a legal `to`.
        out.push({ ...action, to: symbol ? chartsLinkPath({ symbol }) : action.to })
        break
      case 'scan.why':
        // `/ai-search?q=…` — the page's own documented deep link ("the FIRST question auto-runs
        // on mount"). Without a symbol it stays the bare route.
        out.push({
          ...action,
          to: symbol
            ? `/ai-search?q=${encodeURIComponent(`Why is ${symbol} moving today?`)}`
            : action.to,
        })
        break
      case 'scan.flag':
        out.push({ ...action, run: () => onFlag?.() })
        break
      case 'scan.alert':
        out.push({
          ...action,
          /**
           * ⭐ TWO HANDLERS, AND `confirmPayload` IS NOW THE ONE THAT FIRES (R-14, landed).
           *
           * `HubRoot`'s confirm branch asks the section for a payload first, so Alert opens the
           * sheet with the ± steppers and numeric input `HubConfirmSheet` already implements and
           * `contracts.js` calls "the EQUAL path, not a fallback" — the member states the price
           * instead of accepting whatever the table happened to show. ⚰️ This block read "it
           * never asks the section for a payload ... until it lands, `run` is what actually
           * fires"; that was true up to `inc7/p1-confirm-fields` and is the shape of stale
           * comment this file's own header warns about.
           *
           * ⛔ `run` STAYS, and it is not dead: `confirmPayload` returns null when no price is
           * known, and `HubRoot` then falls back to the generic yes/no sheet whose primary calls
           * `run(ctx, values)`. That path re-derives the payload, finds none, and creates
           * NOTHING — an alert is never placed at a fabricated level. Deleting `run` would make
           * that case a dead bubble instead of a safe one.
           */
          confirmPayload: () => alertConfirmPayload({ symbol, reference: shownPrice, createAlert }),
          run: () => {
            const payload = alertConfirmPayload({ symbol, reference: shownPrice, createAlert })
            // No price known -> nothing is created. Never an alert at a fabricated level.
            if (payload) payload.onConfirm({ price: payload.fields[0].value })
          },
        })
        break
      case 'scan.planTrade':
        out.push({
          ...action,
          // Symbol + the STREAM price, and nothing else. See `planTradeProps`.
          run: () => {
            const props = planTradeProps({ symbol, lastPrice: streamPrice })
            if (props) onPlanTrade?.(props)
          },
        })
        break
      case 'scan.scans':
        // ⭐ THE SAVED-SCREEN PICKER, THROUGH THE PAGE'S OWN DOOR. `run` calls the seam and
        // nothing else: this module never learns what the picker is made of, which is what
        // lets `ScreensManager` stay another workstream's file. Absent when there is no seam —
        // see the header; that is the case `buildScanFan({symbol})` exercises.
        if (typeof onOpenScans === 'function') out.push({ ...action, run: () => onOpenScans() })
        break
      default:
        // Voice and Home are HubRoot's own; anything the registry grows later arrives here
        // unhandled and is dropped rather than shipped inert.
        if (action.kind === 'home' || action.id.endsWith('.voice')) out.push(action)
        break
    }
  }
  return out
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** What the bridge below publishes when no provider is mounted: every door closed, none broken. */
const NO_ACTIONS = Object.freeze({ toggle: null, isFlagged: null, createAlert: null })

/**
 * ⛔ WHY A BRIDGE COMPONENT AND NOT TWO HOOK CALLS IN THE SECTION HOOK.
 *
 * `useFlagged` and `useWatchlistAlerts` both call `useAuth()`, which THROWS outside an
 * `AuthProvider` — and a hook cannot be called conditionally. `ScannerShell` renders under a
 * provider in the app, but it is also rendered bare by three of its own suites and embedded as a
 * `/charts` widget, so taking a hard dependency on auth inside the shell turns "the hub is not
 * available here" into a crashed page.
 *
 * ⭐ THE IDIOM IS ALREADY IN THIS FOLDER: `HubVoiceBridge` solves the identical problem for
 * `useRealtimeSession` / `VoiceProvider` — read the context with `useContext` (null-safe), and
 * only mount the component that uses the hook when a provider is actually there. The ref is
 * cleared on unmount rather than left dangling, so a stale toggler can never fire against a
 * page that has gone.
 */
function ActionsBridge({ apiRef }) {
  const { toggle, isFlagged } = useFlagged()
  // ⚠️ COSTS ONE POLL while mounted: `useWatchlistAlerts` carries `refreshInterval: 30000`, so
  // this adds a 30s GET of `/api/watchlist-alerts` to a signed-in screener. Paid deliberately —
  // `createAlert` is the app's ONE alert-creation path (it optimistically seeds the Alerts
  // widget's cache and then revalidates every `/api/watchlist-alerts*` key), and a bare POST
  // from this module would be a second authority that skips both.
  const { createAlert } = useWatchlistAlerts()
  useEffect(() => {
    apiRef.current = { toggle, isFlagged, createAlert }
    return () => { apiRef.current = NO_ACTIONS }
  }, [toggle, isFlagged, createAlert, apiRef])
  return null
}

/** Where the section's toast sits: just above the hub's own resting corner. */
const TOAST_STYLE = Object.freeze({
  position: 'fixed',
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px)',
  right: '16px',
  zIndex: 'var(--z-hub-open)',
})

/** Sits directly under the toast chip, on the same anchor. ⚠️ 44px min target — `--tap-min` is
 *  the app's floor for a touch control and this one appears on a phone by construction. */
const UNDO_STYLE = Object.freeze({
  ...TOAST_STYLE,
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px + 34px)',
  minHeight: 'var(--tap-min, 44px)',
  minWidth: 'var(--tap-min, 44px)',
  zIndex: 'var(--z-hub-open)',
})

/**
 * ⭐ THE SECTION'S WHOLE MOUNTED FOOTPRINT, ARMED ONLY WHERE THE HUB CAN ACTUALLY RENDER.
 *
 * `useHubEligible` is the hub's ONE answer to "could the control exist here at all" (server kill
 * switch, capability floor, `(max-width: 1023px) and (pointer: coarse)`). Where it says no there
 * is no pad, no fan, and nothing that can fire Flag or Alert — so mounting the hooks that back
 * them would buy a desktop screener member a 30-second `/api/watchlist-alerts` poll for an
 * action they cannot reach, and would add a second `role="status"` live region to a page whose
 * only announcements come from elsewhere. Gating the whole mount is also what keeps this change
 * invisible to the shell's own suites, which render `ScannerShell` bare: jsdom fails the
 * capability floor by construction.
 *
 * ⛔ THE TOAST IS PERMANENT WITHIN THAT BRANCH, never mounted-with-text. `useJournalToast`'s own
 * header records why: a `role="status"` that appears already speaking is SILENT to a screen
 * reader, which is how "Capture failed — try again" once reached nobody.
 *
 * @param {{apiRef: object, msg: string|null}} props
 */
export function ScreenerHubMount({ apiRef, msg, onToast, planTrade, onClosePlanTrade, undo }) {
  const auth = useContext(AuthContext)
  const eligible = useHubEligible()
  if (!eligible) return null
  return createElement(
    Fragment,
    null,
    // No provider -> no bridge, and Flag/Alert no-op rather than throwing. Same shape as
    // `HubVoiceBridge` on a route with no `VoiceProvider`.
    auth ? createElement(ActionsBridge, { key: 'bridge', apiRef }) : null,
    createElement(JournalToast, { key: 'toast', msg, style: TOAST_STYLE }),
    // ⛔ A REAL BUTTON, BESIDE THE SHARED CHIP — never a change to `JournalToast` itself, which
    // five Journal doors render and none of them wants an action slot. It appears only while
    // there IS a message, so the two cannot get out of step, and it is a `<button>` so the
    // keyboard and every screen reader can reach it (an undo only a thumb can press is not a
    // recovery path for the member most likely to need one).
    msg && undo
      ? createElement(
        'button',
        {
          key: 'undo',
          type: 'button',
          onClick: undo,
          style: UNDO_STYLE,
        },
        'Undo',
      )
      : null,
    /**
     * ⛔ THE SCREENER DOOR ONTO THE JOURNAL'S SHEET — SYMBOL AND A LAST PRICE, NOTHING ELSE.
     *
     * `entry`, `stop`, `size`, `side` and `settings` are all DELIBERATELY absent (owner ruling,
     * 2026-09-09): the Screener holds entry/stop only as distances, in one non-default column
     * view, blank on stale rows, and it has no account context at all. Passing any of them
     * would put a fabricated level in a box a member acts on. `sourceMode` / `onToast` /
     * `onClose` are the sheet's own plumbing, not trade data.
     */
    planTrade
      ? createElement(PlanTradeSheet, {
        key: 'plan',
        ...planTrade,
        sourceMode: SCAN_MODE_ID,
        onToast,
        onClose: onClosePlanTrade,
      })
      : null,
  )
}

/**
 * Builds the `HubSectionConfig` for one render.
 *
 * ⛔ THE REGISTRY ENTRY IS SPREAD IN, AND THAT IS LOAD-BEARING — NOT TIDINESS. A page
 * registration REPLACES the route-derived default outright (`HubContext`:
 * `pageModeConfig ?? modesById[mode]`), and `HubRoot` calls `fanFor(activeModeConfig)` whose
 * last line is `mode.fan.filter(...)` unguarded. Registering a bare `HubSectionConfig` — exactly
 * the shape `contracts.js` documents — blanks the chip and throws
 * `Cannot read properties of undefined (reading 'filter')` the moment `/screener` mounts.
 * `validateSectionConfig` cannot catch it: a bare section config is a VALID section config.
 *
 * ⚠️ `label` IS OVERRIDDEN, and it is the only lever a section has on the chip. `HubChip`
 * renders `activeModeConfig.label` as its bold mode text, so the plan's
 * "<scan name> · <index>/<count>" has to arrive that way. `HubKnob`'s announcement and
 * `HubActionsButton`'s heading read the same field, so they say "Screener · 3/41" too.
 *
 * @returns {import('../contracts').HubSectionConfig}
 */
export function createScreenerSection({
  rows, scanName, index, count, symbol, streamPrice, shownPrice,
  next, prev, scrubTo, scrollTo, hasMore, loadMore,
  onFlag, onPlanTrade, createAlert, onOpenScans, scrubRef,
}) {
  /**
   * The scrub's position, accumulated in a ref and seeded lazily from the row already selected.
   *
   * ⛔ `delta` IS A STEP, NOT A POSITION. `useJoystick` emits
   * `{delta: (thisMove - lastMove) / travelPx}` per pointer move, so handing it straight to
   * `useHubCursor.scrubTo` (which reads 0..1 as an ABSOLUTE position) would pin the cursor to
   * the first or last row on every drag. The steps accumulate here; `pos` is kept as a float
   * because re-deriving it from the quantized index each step would swallow any delta smaller
   * than one row.
   *
   * ⛔ THE HELD VALUE IS NOT RE-VALIDATED AGAINST `index`, AND THAT IS THE POINT. It used to be
   * (`held.at === index`), which looked safer and was wrong: `index` comes from the render that
   * built THIS config, and a drag calls `onScrub` many times against whichever config is
   * registered at that moment. Every step whose re-render had not landed yet failed the equality
   * check, re-seeded from the stale index, and the accumulation silently collapsed to a
   * single-step scrub. The accumulator's lifetime is the DRAG, and `onScrubCommit` — which
   * `useJoystick` fires on pointerup AND on pointercancel — is what ends it.
   */
  const seed = () => {
    const held = scrubRef.current
    // A re-fetch mid-drag can leave the held index off the end of a shorter list; that is a
    // different list, so start again from where the cursor actually is.
    if (held && held.at < count) return held
    return { at: index, pos: count > 1 ? Math.max(index, 0) / (count - 1) : 0 }
  }

  return {
    ...modesById[SCAN_MODE_ID],
    label: chipLabel({ scanName, index, count }),
    fan: buildScanFan({
      symbol, streamPrice, shownPrice, onFlag, onPlanTrade, createAlert, onOpenScans,
    }),

    /**
     * ⛔ A STEP THAT IS NOT REVEALED IS A STEP NOBODY CAN SEE (R-15).
     *
     * Both results renderers are virtualized, so a row outside the ~20-row window is not merely
     * unpainted — it is not in the DOM at all. `next()` used to move the index while the scroll
     * position stayed put, so from the ~20th tap onward the member's ONLY feedback was the chip:
     * no marked row existed anywhere on screen. `scrollTo` is the same reveal `onScrubCommit`
     * has always performed, for the reason `scrollTo`'s own docstring gives.
     *
     * ⛔ THE TARGET IS COMPUTED, NOT RE-READ. `index` is this render's value and `next()` writes
     * the store synchronously, so re-reading `index` here would reveal the row the cursor just
     * LEFT. The clamp mirrors `useHubCursor.next`'s exactly (`Math.min(i + 1, count - 1)`) — a
     * different rule here would scroll somewhere the cursor is not.
     */
    onTap: () => {
      next()
      if (count > 0) scrollTo(Math.min(index + 1, count - 1))
      // The tail-append half of the plan's remedy, mirroring `VirtualResults`'s own
      // near-the-end `onLoadMore()`. Without it the cursor clamps on row 100 of 3,745 and the
      // member has no way to walk past a page boundary they cannot see.
      if (hasMore && index >= count - 2) loadMore?.()
    },
    onDoubleTap: () => {
      prev()
      if (count > 0) scrollTo(Math.max(index - 1, 0))
    },

    // ⛔ CONTEXT FIRST. `HubRoot.jsx` calls `onScrub(ctx, scrub)`; `contracts.js` and
    // `contractArity.test.js` now agree, and that rail DERIVES the shape from the call site
    // rather than restating it. There is no normaliser here on purpose — a defensive read
    // against a disagreement that has been resolved teaches the next reader the seam is still
    // ambiguous (R-05, closed).
    onScrub: (ctx, scrub) => {
      if (!scrub || typeof scrub.delta !== 'number' || !Number.isFinite(scrub.delta)) return
      // Vertical only (plan §3.3, "Result index, vertical"). The engine reports the DOMINANT
      // axis of each individual move, so a mostly-vertical drag still emits the occasional 'x';
      // counting those would make the list drift under an unsteady thumb.
      if (scrub.axis !== 'y') return
      if (count <= 0) return
      const from = seed()
      // Downward drag -> later rows: the scrollbar's direction, not the content's.
      const pos = clamp01(from.pos + scrub.delta)
      const at = Math.round(pos * (count - 1))
      scrubRef.current = { at, pos }
      scrubTo(pos)
    },

    // The scrub moves the cursor live (this is a fast-scroll, not a preview), so commit's job is
    // to land the member ON the row: reveal it, and clear the accumulator so the next drag
    // re-seeds from wherever they stopped.
    onScrubCommit: () => {
      const held = scrubRef.current
      scrubRef.current = null
      const target = held ? held.at : index
      if (target >= 0) scrollTo(target)
    },

    // What the chip narrates during a drag: the ticker under the cursor. `validateSectionConfig`
    // refuses an `onScrub` without a `readout` because "a scrub the chip cannot narrate is
    // invisible" — and an empty string would recreate that inside a config that passed.
    readout: () => tickerOf(rows[index]) || (count > 0 ? `${index + 1}/${count}` : 'No results'),

    listAdapter: {
      // The RENDERED array, in display order — `displayRows`, never `rows`. See the header.
      items: rows,
      identityKey,
      scrollTo,
    },
  }
}

/**
 * Mount point. Called from `ScannerShell.jsx` — the component that owns `displayRows`.
 *
 * @param {Object} args
 * @param {any[]} args.displayRows  The array AS RENDERED (`ScannerShell`'s `displayRows`).
 * @param {Record<string, object>} [args.filters]  `useScreenSpec`'s raw filter map.
 * @param {Record<string, {price?: number}>} [args.prices]  The live-stream overlay.
 * @param {boolean} [args.hasMore]
 * @param {() => void} [args.loadMore]
 * @param {() => void} [args.onOpenScans]  The page's seam onto its saved-screen picker. Omit it
 *   and the `Scans` action is ABSENT rather than inert — see the R-13 note in the header.
 * @returns {{resultsRef: {current: any}, hubToast: import('react').ReactElement,
 *   planTradeRef: {current: object|null}, cursor: import('../contracts').HubCursorApi}}
 *   `resultsRef` goes on whichever results renderer is mounted (both expose `scrollToIndex`
 *   through `useImperativeHandle`); `hubToast` is the section's feedback host.
 */
export default function useScreenerHubSection({
  displayRows, filters, prices, hasMore = false, loadMore, onOpenScans,
} = {}) {
  const rows = displayRows && displayRows.length ? displayRows : NO_ROWS
  const cursor = useHubCursor(LIST_ID, rows, { key: identityKey })
  const { index, count, next, prev, scrubTo } = cursor

  // ⛔ SETTER ONLY — see `HubSettersContext`. `useHub()` here re-rendered this section's host
  // on its own registration.
  const { setSymbol } = useHubSetters()
  // Flag + Alert arrive through the bridge below, never through a hook call here. See
  // `ScreenerActionsBridge`: both hooks require an `AuthProvider` that this shell does not.
  const actionsRef = useRef(NO_ACTIONS)
  const [toastMsg, setToastMsg] = useJournalToast()
  // ⚠️ THE UNDO'S LIFETIME IS THE TOAST'S LIFETIME, deliberately: `useJournalToast` clears the
  // message after 2200ms, and an Undo button that outlived the sentence explaining it would be a
  // control with no context. The consequence is worth stating rather than hiding — 2.2s is a
  // SHORT window for an undo, and widening it means giving the shared journal hook a per-message
  // duration, which is a change to five other doors and not this programme's to make.
  const [undo, setUndo] = useState(null)
  useEffect(() => { if (!toastMsg) setUndo(null) }, [toastMsg])

  const symbol = tickerOf(rows[index])
  const streamPrice = symbol ? (prices?.[symbol]?.price ?? null) : null
  // What the table is showing: the live overlay when there is one, else the row's own snapshot
  // price — the same resolution all three renderers do.
  const rowPrice = typeof rows[index]?.price === 'number' ? rows[index].price : null
  const shownPrice = symbol ? (streamPrice ?? rowPrice) : null

  /**
   * ⛔ THE HUB'S SHARED SYMBOL HAS TO BE WRITTEN, OR EVERY ACTION RENDERS DISABLED.
   *
   * `HubRoot` computes `disabledIds` from `requires` against `useHub().symbol`, and four of
   * scan's five outer actions declare `requires: ['symbol']`. Measured 2026-09-09: **nothing
   * outside `app/src/hub/` calls `useHub()` at all**, so that value is null on every route and
   * every symbol-requiring bubble would be dimmed with the cursor sitting on a ticker.
   *
   * ⭐ NOT CLEARED ON UNMOUNT, deliberately. "Chart it" navigates away, which unmounts this
   * shell; clearing here would race the navigation and blank the symbol the member just chose.
   * The shared symbol is Part C4 state that outlives one section by design.
   */
  useEffect(() => {
    if (symbol) setSymbol(symbol)
  }, [symbol, setSymbol])

  /**
   * `HubListAdapter.scrollTo` — REQUIRED by the contract, because a cursor that advances
   * off-screen has silently stopped being a cursor.
   *
   * ⚠️ IT IS A NO-OP IN THE `'charts'` VIEW, and that is measured, not assumed. `ChartsGallery`
   * is unvirtualized, paginates internally at 24 with `page` in private state, and is not a
   * `forwardRef` at all — so there is no ref to attach and no seam to reach page 2. The adapter
   * still reports the SAME list (`ChartsGallery` receives `displayRows` verbatim) and
   * `identityKey` stays `ticker`; only the reveal is unavailable there.
   */
  const resultsRef = useRef(null)
  const scrollTo = useCallback((target) => {
    const api = resultsRef.current
    if (api && typeof api.scrollToIndex === 'function' && target >= 0) {
      api.scrollToIndex(target, { align: 'auto' })
    }
  }, [])

  const onFlag = useCallback(() => {
    const { toggle, isFlagged } = actionsRef.current
    if (!symbol || !toggle) return
    // Read the CURRENT state before toggling: `isFlagged` reads localStorage fresh, so the
    // sentence the member sees describes the state they are about to be in, not the one they
    // just left.
    const willBeFlagged = !isFlagged?.(symbol)
    toggle(symbol)
    setToastMsg(`${willBeFlagged ? 'Flagged' : 'Unflagged'} ${symbol}`)
    // ⛔⛔ THE RULING THIS IMPLEMENTS (owner, 2026-09-12): FLAG DOES NOT GET A CONFIRM SHEET.
    // §C2 asks for a sheet on a COMMIT, and Flag is not one: it is a reversible toggle of a
    // local list, the most-used action on the fan, and a sheet in front of it would put friction
    // on every single use to protect against a mistake that costs one tap to reverse. What §C2
    // is actually asking for — "the member can get out of this" — is delivered by the UNDO
    // below. ⭐ The recovery path ships in the SAME commit as the thing it recovers from, which
    // is the rule this feature already broke once with "Hide joystick" and a Settings screen
    // that did not exist yet.
    //
    // ⚠️ THE UNDO CALLS `toggle`, THE SAME FUNCTION THE ACTION CALLED — never an "unflag"
    // written beside it. A second path would be a second authority over what flagging means,
    // and it would drift the first time `useFlagged` changed.
    setUndo(() => () => {
      const { toggle: t } = actionsRef.current
      if (!t) return
      t(symbol)
      setToastMsg(`${willBeFlagged ? 'Unflagged' : 'Flagged'} ${symbol}`)
      setUndo(null)
    })
  }, [symbol, setToastMsg])

  /** Stable indirection so the fan does not change identity when the bridge mounts. */
  const createAlert = useCallback(
    (...args) => actionsRef.current.createAlert?.(...args),
    [],
  )

  /**
   * ⚠️ THE PLAN-TRADE SHEET IS NOT MOUNTED HERE, AND NOT IMPORTED EITHER.
   *
   * `app/src/hub/PlanTradeSheet.jsx` is the 3.4 Journal integrator's file and does not exist on
   * this branch yet (measured 2026-09-09). Vite resolves a static AND a dynamic import at build
   * time, so importing a path that is not there does not "fail gracefully" — it fails the whole
   * bundle and every test that touches this module. So the hand-off is a PROPS OBJECT
   * (`planTradeProps`, unit-tested for exactly `{symbol}` / `{symbol, lastPrice}`) recorded on
   * `planTradeRef`; mounting the sheet belongs to whoever owns it. Filed as R-09.
   */
  const [planTrade, setPlanTrade] = useState(null)
  const onPlanTrade = useCallback((props) => { setPlanTrade(props) }, [])
  const closePlanTrade = useCallback(() => { setPlanTrade(null) }, [])

  const scrubRef = useRef(null)
  const scanName = activeScanName(filters)

  const config = useMemo(() => createScreenerSection({
    rows,
    scanName,
    index,
    count,
    symbol,
    streamPrice,
    shownPrice,
    next,
    prev,
    scrubTo,
    scrollTo,
    hasMore,
    loadMore,
    onFlag,
    onPlanTrade,
    createAlert,
    onOpenScans,
    scrubRef,
  }), [
    rows, scanName, index, count, symbol, streamPrice, shownPrice,
    next, prev, scrubTo, scrollTo, hasMore, loadMore, onFlag, onPlanTrade, createAlert,
    onOpenScans,
  ])

  useHubMode(config)

  /**
   * ⛔ THE FEEDBACK HOST OUTLIVES THE CONTROL THAT FIRES IT (CLAUDE.md, 2026-09-09). The hub's
   * own `HubToastHost` lives inside `HubRoot` and is not reachable from a section, so the
   * screener owns one — rendered by `ScannerShell`, which every screener hub action leaves
   * mounted. `JournalToast` is the app's ONE toast chip (`msg`, never `message` — the prop name
   * that shipped a blank toast once already), a permanent `role="status"` whose text toggles.
   * See `ScreenerHubMount` for why the whole mount is gated on the hub's own mount floor.
   */
  const hubMount = createElement(ScreenerHubMount, {
    apiRef: actionsRef,
    msg: toastMsg,
    onToast: setToastMsg,
    undo,
    planTrade,
    onClosePlanTrade: closePlanTrade,
  })

  return { resultsRef, hubMount, cursor }
}
