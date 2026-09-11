// app/src/hub/sections/journalSection.js — the JOURNAL section (Phase 3 §3.4).
//
// Spec: `docs/plans/joystick/60-phase3-plan.md` §3.4 + §4. Contract: `hub/contracts.js`
// ("PHASE 3 CONTRACTS": `HubSectionConfig` + `HubListAdapter` + `HubConfirmPayload`).
//
//   tap  -> next open position   double-tap -> previous
//   scrub (vertical) -> a candidate STOP in 0.01 steps, clamped so it never crosses entry
//   release -> the stop-confirm sheet, which is the only thing that writes
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE PUT BODY IS `{stopPrice: <number>}` AND NOTHING ELSE — see `stopPatchFor`.
// `PUT /api/j2/positions/{id}` is a PARTIAL update over `_UPDATABLE_FIELDS`, which accepts TEN
// keys INCLUDING `symbol` (`api/services/journal_two/positions.py:286-297`). A stray key here
// does not merely overwrite a stop: it can retag the position to a different ticker or rewrite
// the member's basis, and every assertion about the stop would still pass. That is why the body
// is built by one exported function and asserted byte-for-byte rather than "checked for a
// stopPrice key".
//
// ⛔ AND NEVER `stopPrice: 0`. Zero skips the backend's own side check entirely
// (`positions.py:347` guards on `sp > 0`) and the client then reads it as NO STOP AT ALL
// (`calculations.js` `realStop` returns null for `s <= 0`) — an undocumented stop-REMOVAL path
// that no validation names and no UI offers. Filed as R-08. `clampStopToSide` floors every
// candidate at one tick, so the gesture cannot reach it and neither can the sheet's steppers.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE CURSOR KEY IS `row.key`, AND THE TWO SURFACES DISAGREE.
// List rows carry `key: 'e-<uuid>'` and NO `id` field at all (`lib/holdingsRows.js`); table
// rows use the bare uuid (`PositionsTable.jsx`, `key={p.id}`). `normalisePositionKey` maps both
// to the bare position id — which is what the PUT needs anyway — and `surfaceOf` states which
// surface a row came from, from the SAME string, so the two facts can never disagree.
//
// ⛔ AN OPTION ROW CARRIES A STRATEGY ID, NOT A POSITION ID.
// `optionToRow` (`OpenPositionsTab.jsx`) sets `id: s.id` — a `j2_option_strategies` id — and
// `PUT /api/j2/positions/{strategyId}` 404s. The cursor may land on one (they are rows the
// member sees), but the section then publishes `selectedPosition: null` to the hub context, so
// HubRoot's own `requires:['position']` rule disables every write action, and the chip reads
// the row's own label instead of pretending a stop can be moved there.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⭐ WHY THE RENDERED ORDER IS READ FROM THE DOM
// `HubListAdapter.items` must be "the list AS RENDERED — post filter/sort/merge, in display
// order". On this tab there are TWO renderers and BOTH sort internally: `HoldingsList` holds
// its own `sort` state (persisted at `uct.j2.holdings.sort`) and `PositionsTable` holds its own
// `useState({key:'symbol'})`. Neither lifts it, and lifting them is outside this wave's file
// ownership. Re-deriving either sort here would be a second authority over the order the member
// is looking at — and it would drift silently, because a cursor stepping through a DIFFERENT
// order still moves.
//
// So the order comes from the one artifact that cannot disagree with the screen: the rendered
// nodes themselves, marked with `data-hub-pos` (the three carrier lines this wave adds). That
// is the same idiom `wireSection.js` already uses for the rundown's DOM segments, for the same
// reason.
//
// ⚠️ KNOWN AND RECORDED, NOT PAPERED OVER: in LIST view the option strategies render through
// `OptionsBoard`, which carries no `data-hub-pos` (it is not one of this wave's three carriers),
// so the list-view cursor walks equities only. Option rows enter the cursor in TABLE view,
// where they are merged into the same array. Filed as R-11.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { useHub } from '../HubContext'
import { modesById } from '../registry'
import { activeStop, realStop, rAtStop } from '../../lib/journal-2-0'
// D-31: the tick table lives beside the price formatter. The hub is a caller.
import { tickSizeFor, roundToTick, formatPrice } from '../../components/chart/drawingLabels'

/** This section's mode id. Everything else about the mode is READ from the registry. */
export const JOURNAL_MODE_ID = 'journal'

/**
 * The cursor's list id, DERIVED from the registry (`journal.cursor.listId`) rather than typed,
 * so the section and the registry cannot disagree about which store this page walks.
 *
 * ⚰️ The plan's `journal:${accountId}:positionsRevision` key is struck for the same reason the
 * Screener's was: `listId` keys a module-level Map that is never pruned, so a per-account id
 * leaks a store entry per account — and the account switch it was meant to handle is already
 * handled, because switching accounts changes every position id and therefore the cursor's
 * IDENTITY (`useHubCursor.reconcile`), which resets it.
 */
export const LIST_ID = modesById[JOURNAL_MODE_ID]?.cursor?.listId ?? JOURNAL_MODE_ID

/**
 * The tick.
 *
 * ⭐ D-31 IS SHIPPED AND THIS LINE IS NOW A CALL, NOT AN OPINION. It used to read "a stated
 * simplification, not a discovered rule — a cent is the step at every price", with the fix named:
 * "a real tick table beside the price formatter, NEVER a scaling hack in a gesture handler". The
 * table now exists in `components/chart/drawingLabels.js`, beside `formatPrice` — the one place
 * that already knew how a price is rendered — and this section consumes it like any other caller.
 *
 * ⛔ NOTHING IN THE HUB DECIDES WHAT A PRICE STEP IS. `stopTickFor` forwards; it does not scale,
 * clamp or special-case. A second opinion here would be invisible, because a wrong step still
 * produces a plausible number.
 */
export const stopTickFor = (price) => tickSizeFor(price)

/**
 * The step for a caller that has no price in hand — DERIVED from the table (the row a $1+ equity
 * lands in), never a restated `0.01`. Retiring the cent from the table retires it from here.
 */
export const STOP_TICK = tickSizeFor(1)

/**
 * How many ticks one full pad travel is worth.
 *
 * `useJoystick` reports `delta = pixelsMoved / travelPx` PER MOVE, so a section has to say what
 * a whole travel means in its own units. 50 ticks = $0.50 across the pad: a nudge, at the scale
 * a stop is actually moved, and small enough that the confirm sheet's steppers stay the precise
 * path rather than the only usable one.
 */
export const SCRUB_TICKS_PER_TRAVEL = 50

/** The attribute the three carrier lines paint, and the selector that finds them. */
export const HUB_ROW_ATTR = 'data-hub-pos'
export const HUB_ROW_SELECTOR = `[${HUB_ROW_ATTR}]`

/** The list surface's row-key prefix (`lib/holdingsRows.js`: key = 'e-' + p.id). */
const LIST_KEY_PREFIX = 'e-'

const EMPTY = Object.freeze([])

/** 2dp everywhere (A2). Float addition of 0.01 otherwise shows 178.10000000000002. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const finite = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null))

/**
 * Both surfaces' row keys -> the bare position id.
 *
 * @param {string|number} raw 'e-<uuid>' (list) or '<uuid>' (table)
 * @returns {string} the bare id, or '' when there is nothing to normalise
 */
export function normalisePositionKey(raw) {
  const s = raw == null ? '' : String(raw)
  if (!s) return ''
  return s.startsWith(LIST_KEY_PREFIX) ? s.slice(LIST_KEY_PREFIX.length) : s
}

/**
 * Which surface a row key came from — derived from the SAME string the id is, so the two facts
 * cannot drift apart. The contract asks a section to state this; deriving it is how it stays true.
 * @returns {'list'|'table'}
 */
export function surfaceOf(raw) {
  return String(raw ?? '').startsWith(LIST_KEY_PREFIX) ? 'list' : 'table'
}

/**
 * Clamp a candidate stop so it stays on the correct side of the entry, and above zero.
 *
 * ⛔ THE FLOOR IS ONE TICK, NOT ZERO — see the `stopPrice: 0` note in the header (R-08).
 * ⛔ AND THE SIDE BOUND IS ONE TICK INSIDE THE ENTRY, NOT THE ENTRY ITSELF: a stop exactly AT
 * the entry has zero risk, so R is 0 and the position can no longer say what it risks.
 * `stop === entry` is also a hard 422 on the plan endpoint, for the same reason.
 *
 * @param {{stop: *, entry: *, side: 'Long'|'Short', tick?: number}} args
 * @returns {number|null} null when there is no candidate to clamp
 */
export function clampStopToSide({ stop, entry, side, tick = stopTickFor(entry ?? stop) }) {
  const s = finite(stop)
  const e = finite(entry)
  // ⛔ ROUNDED TO THE TICK, NOT TO 2dp. `round2` was correct only while the tick was always a
  // cent: on a sub-dollar name it would snap a $0.0001-tick stop back to the cent the table just
  // said was too coarse, so the clamp would quietly undo the tick it was handed.
  if (s === null) return null
  if (e === null || (side !== 'Long' && side !== 'Short')) return roundToTick(Math.max(s, tick), tick)
  const bounded = side === 'Long' ? Math.min(s, e - tick) : Math.max(s, e + tick)
  return roundToTick(Math.max(bounded, tick), tick)
}

/**
 * One scrub step: a normalized pad delta -> the next candidate stop, in whole ticks.
 *
 * ⭐ THE SIGN IS INVERTED ON PURPOSE. Screen `y` grows DOWNWARD, so `useJoystick`'s vertical
 * `delta` is NEGATIVE when the member drags up. Dragging up must RAISE the stop; without the
 * inversion the gesture works perfectly and does the opposite of what the finger says, which is
 * the one bug in this feature a member would not report as a bug.
 *
 * @param {{current: *, entry: *, side: 'Long'|'Short', delta: *,
 *   tick?: number, ticksPerTravel?: number}} args
 * @returns {number|null}
 */
export function candidateStopFor({
  current, entry, side, delta,
  // ⭐ The scrub becomes proportionate for free: 50 ticks of travel is $0.50 on a $178 name and
  // $0.005 on a $0.30 one, because the TICK moved — not because anything here scales by price.
  tick = stopTickFor(entry ?? current), ticksPerTravel = SCRUB_TICKS_PER_TRAVEL,
}) {
  const cur = finite(current)
  const d = finite(delta)
  if (cur === null || d === null) return null
  const ticks = -d * ticksPerTravel
  return clampStopToSide({ stop: cur + ticks * tick, entry, side, tick })
}

/**
 * The side-flip refusal, in plain English, both directions (plan §4 A3) — or null when the stop
 * is fine.
 *
 * ⭐ A COURTESY THAT SAVES A ROUND TRIP, NOT THE ONLY GUARD. `positions.py:344-355` re-validates
 * the same rule on the MERGED patch, so a member cannot corrupt a row by getting past this. It
 * exists so the answer is a sentence about their trade instead of a 422.
 *
 * @param {{stop: *, entry: *, side: 'Long'|'Short'}} args
 * @returns {string|null}
 */
export function sideFlipRefusal({ stop, entry, side }) {
  const s = finite(stop)
  const e = finite(entry)
  if (s === null || e === null) return null
  // ⛔ FORMATTED AT THE INSTRUMENT'S TICK, NOT AT 2dp. A hard-coded `.toFixed(2)` here would print
  // a sub-dollar refusal as "a stop at 0.30 is above your entry of 0.30" — two identical numbers
  // in the sentence that exists to explain how they differ.
  const tick = stopTickFor(e)
  const price = (n) => formatPrice(n, { tick })
  if (side === 'Long' && s >= e) {
    return `A stop at ${price(s)} is above your entry of ${price(e)}. `
      + 'For a long position the stop goes below the entry — that is what makes it a stop.'
  }
  if (side === 'Short' && s <= e) {
    return `A stop at ${price(s)} is below your entry of ${price(e)}. `
      + 'For a short position the stop goes above the entry.'
  }
  return null
}

/**
 * ⛔⛔ THE ENTIRE PUT BODY. One key. See the header for why this is a function with a test
 * rather than an object literal at a call site.
 * @param {number} price
 * @returns {{stopPrice: number}}
 */
export function stopPatchFor(price) {
  // The value WRITTEN is snapped to the same tick the gesture and the sheet stepped by — a 2dp
  // round here would send the cent back to the server after the table said a finer step was legal.
  return { stopPrice: roundToTick(price, stopTickFor(price)) }
}

/**
 * R, formatted. `null` renders as an em dash — never 0, never blank: "we cannot compute your R"
 * and "your R is zero" are different facts, and only one of them is about the trade.
 * @param {number|null} r
 * @param {{signed?: boolean}} [opts]
 */
export function formatR(r, opts = {}) {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—'
  const body = `${r.toFixed(1)}R`
  return opts.signed && r >= 0 ? `+${body}` : body
}

/** `stop 178.10 → 1.6R`, or `stop 178.10 · R —` when R is not computable. */
export function formatScrubReadout({ stop, r }) {
  const price = finite(stop)
  // The chip is the ONLY feedback between press and release, so it must show the step the drag is
  // actually taking: at a cent it would sit still through three sub-penny ticks and read as dead.
  const shown = price === null ? '—' : formatPrice(price, { tick: stopTickFor(price) })
  if (r === null || r === undefined || !Number.isFinite(r)) return `stop ${shown} · R —`
  return `stop ${shown} → ${formatR(r)}`
}

/** `AAPL · +0.4R · stop 178.10` — what the chip says at REST. */
export function restChipText({ symbol, r, stop }) {
  const price = finite(stop)
  return [
    String(symbol ?? '').trim() || '—',
    formatR(r, { signed: true }),
    `stop ${price === null ? '—' : formatPrice(price, { tick: stopTickFor(price) })}`,
  ].join(' · ')
}

/**
 * The registry action ids that need a real position, DERIVED from the registry rather than
 * listed. A hand-typed list beside a fan is the enumeration defect this repo keeps paying for.
 * @returns {string[]}
 */
export function positionRequiredActionIds() {
  return (modesById[JOURNAL_MODE_ID]?.fan ?? [])
    .filter((a) => (a.requires ?? []).includes('position'))
    .map((a) => a.id)
}

/**
 * The rendered rows, in DOCUMENT order — the order the member is looking at.
 * @param {Document|Element} [root]
 * @returns {Array<{key: string, id: string, surface: 'list'|'table', node: Element}>}
 */
export function readRenderedRows(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  const out = []
  for (const node of root.querySelectorAll(HUB_ROW_SELECTOR)) {
    const key = node.getAttribute(HUB_ROW_ATTR) || ''
    const id = normalisePositionKey(key)
    if (!id) continue
    out.push({ key, id, surface: surfaceOf(key), node })
  }
  return out
}

/**
 * Join the rendered rows to the models the tab already holds.
 *
 * A row whose id matches neither a position nor a strategy is DROPPED rather than carried as an
 * empty shell: the cursor would happily land on it and every action would then be disabled for
 * a reason nobody could name.
 *
 * @param {Array<{key: string, id: string, surface: string}>} rows
 * @param {Array<object>} positions
 * @param {Array<object>} strategies
 * @returns {Array<object>} the cursor's items
 */
export function buildCursorItems(rows, positions, strategies) {
  const byPosition = new Map((positions || []).map((p) => [String(p?.id), p]))
  const byStrategy = new Map((strategies || []).map((s) => [String(s?.id), s]))
  const items = []
  for (const row of rows || []) {
    const position = byPosition.get(row.id)
    if (position) {
      items.push({
        id: row.id,
        surface: row.surface,
        kind: 'position',
        position,
        strategy: null,
        symbol: position.symbol,
        label: position.symbol,
      })
      continue
    }
    const strategy = byStrategy.get(row.id)
    if (strategy) {
      items.push({
        id: row.id,
        surface: row.surface,
        kind: 'strategy',
        position: null,
        strategy,
        symbol: strategy.underlying ?? null,
        // The chip reads the row's OWN label on an option row — see the header.
        label: strategy.label ?? strategy.underlying ?? 'Option strategy',
      })
    }
  }
  return items
}

/** The item's stop, entry and side — the three numbers every readout and every write needs. */
export function stopContextOf(item) {
  const p = item && item.kind === 'position' ? item.position : null
  if (!p) return null
  const side = p.side === 'Short' ? 'Short' : 'Long'
  return {
    id: String(p.id),
    symbol: p.symbol,
    side,
    entry: finite(p.entryPrice),
    shares: finite(p.shares),
    // `realStop` is the predicate every surface should ask: it refuses a broker placeholder, a
    // non-finite value, and a zero/negative "stop" that is not protection at all.
    stop: finite(realStop(p)) ?? finite(activeStop(p)),
    // The RISK BASIS for R: the stored stop, not the breakeven override. `rAtStop` answers
    // "what does this position lock in at the candidate stop", and -1R is by definition the
    // stored stop being hit.
    originalStop: finite(p.stopPrice),
    position: p,
  }
}

/** R at a candidate stop, through the one authority (D-34). Null renders as an em dash. */
export function rForCandidate(ctxOfStop, candidate) {
  if (!ctxOfStop) return null
  return rAtStop(
    ctxOfStop.entry, ctxOfStop.originalStop, candidate, ctxOfStop.side, ctxOfStop.shares,
  )
}

/**
 * The default j2 client — the ONLY transport this section owns.
 *
 * ⚠️ `OpenPositionsTab`'s own `jsonFetch` is module-private, so the transport is repeated here.
 * The SEMANTICS are not: the body comes from `stopPatchFor`, which is the single authority over
 * what this PUT may contain, and it is that — not the fetch — that the contract test asserts.
 */
export const defaultJ2Client = {
  async setStop(positionId, price, fetchImpl) {
    const doFetch = fetchImpl || globalThis.fetch
    const res = await doFetch(`/api/j2/positions/${encodeURIComponent(positionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(stopPatchFor(price)),
    })
    if (!res.ok) {
      let message = `${res.status}`
      try {
        const data = await res.json()
        if (data && data.detail) message = String(data.detail)
      } catch { /* non-JSON body — the status is all there is */ }
      throw new Error(message)
    }
    return res.json()
  },
}

/**
 * Mount point. ONE call from `OpenPositionsTab.jsx`.
 *
 * ⛔ THE REGISTRY MODE IS SPREAD IN, AND THAT IS LOAD-BEARING — NOT TIDINESS. A page
 * registration REPLACES the route-derived default (`HubContext`:
 * `pageModeConfig ?? modesById[mode]`) and `fanFor()` ends in `mode.fan.filter(...)` unguarded,
 * so registering a BARE `HubSectionConfig` — exactly the shape `contracts.js` documents —
 * blanks the chip and throws on `/journal/trades`. `validateSectionConfig` cannot catch it: a
 * bare section config is a valid section config, and the failure lives on the other side of the
 * seam.
 *
 * ⚠️ `journal` STAYS IN `PREVIEW_MODES` this wave, so `fanFor()` still returns `[Voice, Home]`
 * and none of the fan handlers below are reachable yet. They are attached now so the Director's
 * flip is a one-line registry change rather than another section wave.
 *
 * @param {Object} args
 * @param {Array<object>} args.positions       equity positions from `useJ2Positions`
 * @param {Array<object>} args.optionStrategies open option strategies
 * @param {string} [args.view]                 'list' | 'table' — recorded, never re-derived
 * @param {object} [args.settings]             j2 settings (accountSize, defaultStop, defaultSizePct)
 * @param {Record<string, {price?: number}>} [args.prices]
 * @param {boolean} [args.isStreaming]
 * @param {(msg: string, tone?: string) => void} [args.onToast]
 * @param {() => void} [args.onWritten]        refresh after a successful write
 * @param {(position: object) => void} [args.onRequestClose] the tab's existing close modal
 * @param {object} [args.j2Client]
 * @param {Document} [args.doc]                injectable for tests
 */
export default function useJournalHubSection({
  positions = EMPTY,
  optionStrategies = EMPTY,
  view = 'list',
  settings = null,
  prices = null,
  isStreaming = false,
  onToast,
  onWritten,
  onRequestClose,
  j2Client = defaultJ2Client,
  doc,
} = {}) {
  const { setSymbol, setSelectedPosition } = useHub()

  // ⛔⛔ THE CALLERS' CALLBACKS ARE HELD IN A REF, AND THAT IS A CORRECTNESS FIX, NOT TIDINESS.
  //
  // `useHubMode` re-registers whenever the config's IDENTITY changes, and registration is a
  // `setState` on `HubProvider` — which re-renders this page. `OpenPositionsTab` hands over
  // `onRequestClose={(p) => setCloseTarget(p)}` (a fresh arrow every render) and `onWritten`
  // is `useJ2Positions`'s `refresh: () => mutate()` (likewise). Letting either reach the
  // `useMemo` that builds the config makes the config new on every render, so registration
  // re-fires, which re-renders, which rebuilds the config: an infinite loop that presents as
  // a HUNG PAGE, not as an error. Measured on the first run of this section's own suite.
  //
  // The ref is written during render on purpose: these are event handlers, never read while
  // rendering, so there is nothing to tear.
  const cbRef = useRef({})
  cbRef.current = { onToast, onWritten, onRequestClose, j2Client }

  const [renderedRows, setRenderedRows] = useState(EMPTY)
  const [stopSheet, setStopSheet] = useState(null)
  const [planSheet, setPlanSheet] = useState(null)

  const root = doc || (typeof document === 'undefined' ? null : document)

  // ── the rendered order, read from the DOM the member is looking at ────────
  // A layout effect on EVERY render covers mount, data changes and the live re-sorts that ride
  // a price tick. The observer covers the one case a tab render never sees: a member changing
  // `HoldingsList`'s sort select or a `PositionsTable` header, both of which re-render only
  // their own component.
  const rowsSigRef = useRef('')
  const syncRows = useCallback(() => {
    const rows = readRenderedRows(root)
    const sig = rows.map((r) => r.key).join('|')
    if (sig === rowsSigRef.current) return
    rowsSigRef.current = sig
    setRenderedRows(rows.map(({ key, id, surface }) => ({ key, id, surface })))
  }, [root])

  useLayoutEffect(() => { syncRows() })

  useEffect(() => {
    if (!root || typeof MutationObserver === 'undefined') return undefined
    const target = root.body || root
    if (!target || typeof target.nodeType !== 'number') return undefined
    const observer = new MutationObserver(syncRows)
    observer.observe(target, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [root, syncRows])

  // ⛔ CONTENT-KEYED IDENTITY, for the same reason `useHubCursor` keys a list by the ordered join
  // of its keys rather than by the array reference. `useJ2Positions` returns `data?.positions ?? []`,
  // so a revalidation in flight hands back a BRAND NEW empty array every render; a fresh `items`
  // array makes a fresh `listAdapter`, a fresh config, a re-registration, a re-render — the same
  // hang the callback ref above describes, arriving by a different door.
  const itemsRef = useRef(EMPTY)
  const itemsSigRef = useRef(null)
  const items = useMemo(() => {
    const next = buildCursorItems(renderedRows, positions, optionStrategies)
    const sig = next.map((i) => [
      i.id, i.kind, i.surface, i.symbol, i.label,
      i.position?.side, i.position?.entryPrice, i.position?.stopPrice,
      i.position?.breakevenStop, i.position?.raiseToBreakeven, i.position?.shares,
    ].join(':')).join('|')
    if (sig === itemsSigRef.current) return itemsRef.current
    itemsSigRef.current = sig
    itemsRef.current = next
    return next
  }, [renderedRows, positions, optionStrategies])

  const identityKey = useCallback((it) => it.id, [])
  const { item, index, count, next, prev, scrubTo, paintCursor } =
    useHubCursor(LIST_ID, items, { key: identityKey })

  /** Bring row `target` into view. Required by the contract — a cursor off-screen is not one. */
  const scrollTo = useCallback((target) => {
    const node = readRenderedRows(root)[target]?.node
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [root])

  // Paint the selection on whichever surface rendered it. `data-hub-cursor` is styled globally
  // in `styles/tokens.css` — reused, never re-declared.
  useLayoutEffect(() => {
    paintCursor(readRenderedRows(root).map((r) => r.node))
  }, [root, index, renderedRows, paintCursor])

  // ── publish the cursor into the hub context ──────────────────────────────
  // This is what makes HubRoot's `requires` rule real: `selectedPosition` is null on an option
  // row (its id is a STRATEGY id — see the header), so every `requires:['position']` bubble
  // renders disabled there rather than firing a PUT that 404s.
  const stopCtx = useMemo(() => stopContextOf(item), [item])
  useEffect(() => {
    setSymbol?.(item?.symbol ?? null)
    setSelectedPosition?.(stopCtx ? stopCtx.position : null)
  }, [item, stopCtx, setSymbol, setSelectedPosition])

  // ── the scrub ────────────────────────────────────────────────────────────
  // A ref, not state: a drag emits a call per pointer move and re-rendering this tab on each
  // one would re-render every position row. `readout()` is called by the chip during HubRoot's
  // own render, which happens on every scrub step, so the ref is always fresh where it is read.
  const scrubRef = useRef(null)

  // ⛔ CONTEXT FIRST. `HubRoot.jsx` calls `onScrub(ctx, scrub)` and `onScrubCommit(ctx)`;
  // `contractArity.test.js` derives that from the runtime call site. Do not "fix" this.
  const onScrub = useCallback((_ctx, scrub) => {
    // Vertical only (plan §3.4). The engine reports the DOMINANT axis of each individual move,
    // so a mostly-vertical drag still emits the occasional 'x'; counting those as stop movement
    // would make the number drift under an unsteady thumb.
    if (!scrub || scrub.axis !== 'y' || !Number.isFinite(scrub.delta)) return
    if (!stopCtx || stopCtx.stop === null) return
    const held = scrubRef.current
    const from = held && held.id === stopCtx.id ? held.stop : stopCtx.stop
    const nextStop = candidateStopFor({
      current: from, entry: stopCtx.entry, side: stopCtx.side, delta: scrub.delta,
    })
    if (nextStop === null) return
    scrubRef.current = { id: stopCtx.id, stop: nextStop }
  }, [stopCtx])

  const onScrubCommit = useCallback(() => {
    const held = scrubRef.current
    scrubRef.current = null
    if (!held || !stopCtx || held.id !== stopCtx.id) return
    // A hold-and-release that never moved writes nothing and opens nothing.
    // ⛔ COMPARED AT THE TICK. At a fixed 2dp a member who moved a $0.30 stop by three ticks got
    // "nothing happened" — the gesture worked, the sheet never opened, and there was no error.
    const moveTick = stopTickFor(stopCtx.entry ?? stopCtx.stop)
    if (roundToTick(held.stop, moveTick) === roundToTick(stopCtx.stop, moveTick)) return
    setStopSheet({ ctx: stopCtx, stop: held.stop, title: 'Set stop' })
  }, [stopCtx])

  const readout = useCallback(() => {
    // On an option row there is no stop to narrate, so the chip reads the row's own label.
    if (!stopCtx) return item?.label ?? 'No position'
    const held = scrubRef.current
    const candidate = held && held.id === stopCtx.id ? held.stop : stopCtx.stop
    return formatScrubReadout({ stop: candidate, r: rForCandidate(stopCtx, candidate) })
  }, [stopCtx, item])

  // ── the fan's handlers, layered onto the registry's own action data ───────
  const openStopSheet = useCallback((at, title) => {
    if (!stopCtx) return
    const seeded = clampStopToSide({ stop: at, entry: stopCtx.entry, side: stopCtx.side })
    setStopSheet({ ctx: stopCtx, stop: seeded ?? stopCtx.stop, title })
  }, [stopCtx])

  const openPlanSheet = useCallback(() => {
    setPlanSheet({
      symbol: item?.symbol ?? null,
      side: stopCtx?.side ?? 'Long',
      entry: stopCtx?.entry ?? null,
      stop: stopCtx?.stop ?? null,
      size: stopCtx?.shares ?? null,
      sourceMode: JOURNAL_MODE_ID,
    })
  }, [item, stopCtx])

  const fan = useMemo(() => {
    const base = modesById[JOURNAL_MODE_ID]?.fan ?? EMPTY
    const handlers = {
      // The NON-GESTURE path to the same sheet: opens directly with the current stop prefilled.
      'journal.moveStop': () => openStopSheet(stopCtx?.stop, 'Set stop'),
      // Breakeven is the same PUT with a different seed — never a second write path.
      'journal.breakeven': () => openStopSheet(stopCtx?.entry, 'Set stop'),
      'journal.close': () => { if (stopCtx) cbRef.current.onRequestClose?.(stopCtx.position) },
      // ⚠️ SEE R-10. The registry's inner ring has no `journal.planTrade`, and the registry is
      // Director-owned. `journal.addTrade` is the only unclaimed `run` on this fan, so it is
      // wired to the Plan-trade sheet — which is the door A5 requires the Journal to have.
      'journal.addTrade': () => openPlanSheet(),
    }
    return base.map((a) => (handlers[a.id] ? { ...a, run: handlers[a.id] } : a))
  }, [stopCtx, openStopSheet, openPlanSheet])

  const listAdapter = useMemo(
    () => ({ items, identityKey, scrollTo }),
    [items, identityKey, scrollTo],
  )

  const config = useMemo(() => ({
    ...modesById[JOURNAL_MODE_ID],
    fan,
    // What the chip says at REST. ⚠️ While `journal` sits in `PREVIEW_MODES`, HubRoot overrides
    // this with 'Preview — more coming'; it becomes visible the day the Director flips the set.
    tapHint: stopCtx
      ? restChipText({
        symbol: stopCtx.symbol,
        r: rForCandidate(stopCtx, stopCtx.stop),
        stop: stopCtx.stop,
      })
      : (item?.label ?? modesById[JOURNAL_MODE_ID]?.tapHint),
    onTap: () => next(),
    onDoubleTap: () => prev(),
    onScrub,
    onScrubCommit,
    readout,
    listAdapter,
  }), [fan, stopCtx, item, next, prev, onScrub, onScrubCommit, readout, listAdapter])

  useHubMode(config)

  // ── the write, and the only place it happens ─────────────────────────────
  const confirmStop = useCallback(async (price) => {
    const target = stopSheet?.ctx
    setStopSheet(null)
    if (!target) return
    const { j2Client: client, onToast: toast, onWritten: written } = cbRef.current
    try {
      await client.setStop(target.id, price)
      const tick = stopTickFor(target.entry ?? price)
      toast?.(`Stop on ${target.symbol} set to ${formatPrice(roundToTick(price, tick), { tick })}`, 'success')
      written?.()
    } catch (e) {
      // The server's own message, verbatim — its 422s name the field a member can fix.
      toast?.(`Couldn't set the stop: ${String(e?.message || e)}`, 'error')
    }
  }, [stopSheet])

  return {
    items,
    index,
    count,
    view,
    scrubTo,
    stopSheet: stopSheet
      ? {
        symbol: stopSheet.ctx.symbol,
        side: stopSheet.ctx.side,
        entry: stopSheet.ctx.entry,
        shares: stopSheet.ctx.shares,
        currentStop: stopSheet.ctx.stop,
        originalStop: stopSheet.ctx.originalStop,
        stop: stopSheet.stop,
        title: stopSheet.title,
        onConfirm: confirmStop,
        onClose: () => setStopSheet(null),
      }
      : null,
    planSheet: planSheet
      ? {
        ...planSheet,
        settings,
        lastPrice: planSheet.symbol ? (prices?.[planSheet.symbol]?.price ?? null) : null,
        isStreaming,
        onToast,
        onClose: () => setPlanSheet(null),
      }
      : null,
  }
}
