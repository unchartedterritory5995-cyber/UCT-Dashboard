// app/src/components/chart/ChartSettingsIndicators.jsx
//
// ─── CHART SETTINGS → INDICATORS: THE ONE HOME ──────────────────────────────
//
// Until this file the platform had TWO indicator surfaces and a user had to know
// which one to open:
//
//   · `IndicatorLibraryDialog` (toolbar "Indicators" button) — search the
//     catalogue, read a description, add, author a formula. It could NOT edit an
//     indicator once it was on, and it did not list the MA overlays or the volume
//     pane at all.
//   · `ChartSettingsModal`'s Indicators tab — every control for everything, all
//     open at once, one section per DEFINITION whether or not the chart draws it.
//     Seventeen definitions plus four MAs plus volume: a tab you scroll for a
//     minute to reach the EMA you can already see on the chart.
//
// This composes them. It is a COMPOSITION, deliberately, not a third
// implementation:
//
//   ⛔ THE CATALOGUE IS `indicatorCatalog`'s, and the SEARCH is
//   `IndicatorLibraryDialog`'s `matches()` — imported, not re-typed. Five ways in
//   (name, short name, id, category, tags) is a property of that one function; a
//   second search would be a second answer to "does EMA match 'ema'".
//
//   ⛔ THE ADD IS `IndicatorLibraryDialog`'s `toggledRow()` / `isRowOn()` and
//   `instanceControls.addInstance` — the same writes the dialog makes, so an
//   indicator added from here is byte-identical to one added from there, and
//   "+ Add another" keeps working for the definitions that allow two.
//
//   ⛔ THE ROWS ARE `indicatorRegistry.listAllIndicators`' rows and the WRITE is
//   `applyRowPatch` (handed in as `onRowPatch`). Nothing here knows what an EMA's
//   fields are; a definition that grows an input grows a control with no edit
//   here.
//
//   ⛔ AND THE FORMULA BUILDER IS LAUNCHED, NEVER MOUNTED. `BuilderSheet` has
//   exactly one mount site (`ChartToolbar`) and an AST rail in
//   `BuilderSheet.test.jsx` that fails if a second appears. `onCreateFormula` is
//   a request to the host to open THAT one.
//
// ─── WHAT IS ACTUALLY NEW HERE ──────────────────────────────────────────────
//
// 1. ACTIVE vs AVAILABLE. The tab shows what the chart is drawing; everything
//    else is behind the search box. That is the whole size fix.
// 2. An ACCORDION row. One expanded at a time, so N indicators cost N compact
//    rows plus one open form rather than N open forms.
// 3. A VISIBILITY toggle that is not a REMOVE. See `rowVisible` below — the two
//    verbs were the same control on this tab, which is why turning an indicator
//    off used to make its settings vanish.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  readEnabled, indTarget, styleInputKeys,
} from './indicatorRegistry'
// ⭐ THE BREAKPOINT HOOK THE APP ALREADY HAS. The narrow layout is a second
// VIEW of one state, not a second component, and it needs exactly one bit:
// is there room for two columns. A `matchMedia` of its own here would be a
// second breakpoint authority beside `useMediaQuery`.
import useMediaQuery from '../../hooks/useMediaQuery'
import {
  catalogRows, userCatalogRows, catalogGeneration, userRefusalRows, REFUSED_CATEGORY,
  BUILT_IN_ROWS,
} from './indicatorCatalog'
// ⭐⭐ THE ONE ADD DOOR'S CATALOGUE — technical, the member's own formulas,
// SECURITIES and BREADTH, through the facade that already owns all four. Wiring
// the symbol half here is what retires the member-facing "Data Series" workflow
// (owner §8): searching `QQQ` and clicking it creates the canonical
// `dataSeries` + `sym:QQQ:close` instance, and the abstraction never surfaces.
import {
  hiddenLibraryIds, libraryRowFor, symbolLibraryRow, createFromResult,
  SYMBOL_CATEGORY, BREADTH_CATEGORY, CAPABILITY,
  securityResults, breadthResults, resultsForTab, LIBRARY_TABS, FUNDAMENTALS_STATUS,
  glyphNameOf, glyphFamilyOf,
} from './discoveryCatalog'
import UIcon from '../ui/UIcon'
// ⛔ NOT A SECOND SEARCH. `useSymbolDiscovery` is the SAME hook `SourceField`'s
// picker uses — same two endpoints, same debounce, same abort discipline, same
// facade adapters — so "what does QQQ match" has one answer on both surfaces.
import useSymbolDiscovery from './useSymbolDiscovery'
// ⛔ THE SEARCH AND THE ADD, IMPORTED FROM THE DIALOG THAT ALREADY OWNS THEM.
// See the header — this is the reuse, and it is why this file has no `q.trim()`
// in it and no second `setIndicatorEnabled` call.
import { matches, isRowOn, toggledRow } from './IndicatorLibraryDialog'
import { legacyInstanceId } from './engine/instances'
import {
  addInstance, removeInstance, setIndicatorEnabled, setInstanceHidden, findInstance,
} from './engine/instanceControls'
import { CLEAN } from './engine/repaintVerdict'
import styles from './ChartSettingsModal.module.css'
import SourceField from './SourceField'
import { availableStyles, resolvePlotStyle, PLOT_STYLE_CHOICES } from './engine/presentation'
import { ohlcCapabilityOf } from './engine/ohlcCapability'
import { anyCachedBars } from './engine/secondaryBars'
import { symbolFamily } from '../../hooks/useBreadthSymbols'
import useBreadthSymbols from '../../hooks/useBreadthSymbols'
import { POPULAR_RESULTS, INDICES_PRESET } from './symbolSearchModel'
import {
  resolveDisplayTarget, displayTargetOptions, hasExplicitTarget, automaticTargetOf,
} from './engine/displayTarget'
import { sourceInputsOf, parseSource } from './engine/sourceRef'
import { setInstancePlotStyle, setInstanceDisplayTarget } from './engine/instanceControls'
// ⭐⭐ THE PANE MAP, AS A READ. `chartDataMap` asks `resolveDisplayTarget`,
// `paneOwnerOf`, `paneOwnKeys` and `paneOwnersNeeded` — the same four answers
// `StockChart` hands `computePaneLayout` — so this component never forms its own
// opinion about where anything draws. See that file's header for why grouping
// from a label or a summary string would be a lie nobody notices.
// ⭐ AND `paneRowMeta` IS THE SAME READ ONE LAYER DOWN — what ONE row inside one
// group is called, and what it reads. It lives beside `paneMap` because a row's
// NAME depends on the pane it is filed under (`EMA 20` inside QQQ, `EMA 20 · QQQ`
// on Price), which makes it a placement answer like every other in that file.
import { paneMap, paneRowMeta } from './chartDataMap'
// ⭐ THE ONE REORDER WRITER. Drag and Move up / Move down both end here, so the
// two paths cannot produce different stored states — asserted in
// `engine/__tests__/paneOrder.test.js`.
import { movePane, movePaneTo } from './engine/paneOrder'
import { moveSeriesWithinPane, canMoveSeries } from './engine/paneSeriesOrder'

/**
 * Is this row a chart FIXTURE — an MA overlay or the volume pane — rather than an
 * engine instance?
 *
 * ⚰️ THIS USED TO BE CALLED `isFixtureRow` AND IT MEANT "CANNOT BE REMOVED".
 * That was true of the storage, not of the product: `cs.overlays` is merged
 * POSITIONALLY, so a splice shifted every later slot and resurrected a default in
 * the vacated one, and `cs.volume` is a section with no removal at all. The owner
 * asked for the ✕ on these rows anyway, and `chartDefaults`'s TOMBSTONE
 * (`removed: true`, slot kept, nothing shifts) is what made it safe. The
 * predicate survives because these rows still differ from an engine row in the
 * two places it is used — where their VALUES live, and which verb removes them.
 */
/** The one inspector region, named once so the rows can point at it. */
/** The editor region belonging to one row — what its expander points at.
 *  ⚠️ ROW IDS CARRY COLONS (`inst:rsi:1`, `legacy:rsi`). They are legal in an
 *  `id` attribute and in `aria-controls`, and `getElementById` handles them
 *  fine; only CSS selectors would need escaping, and nothing here selects by id. */
/** The Display control's local "follow the rules" option.
 *
 *  ⛔⛔ IT IS NEVER STORED AND NEVER LEAVES `displayInControl`. `placement.target`
 *  holds DESTINATIONS — `price`, `volume`, `pane`, `@<hostId>` — and a sentinel in
 *  that field would be a fourth dialect for the resolver to learn. The double
 *  underscores are the same convention `SourceField`'s `__search__` uses, for
 *  exactly the same reason: a select needs a value for a row that is not a value. */
const AUTO_TARGET = '__automatic__'

const inspectorDomId = (rowId) => `chart-data-editor-${rowId}`

function isFixtureRow(row) {
  return row?.path?.kind === 'overlay' || row?.path?.kind === 'section'
}

/** The colours the COLLAPSED row shows — up to the first TWO the row declares.
 *
 *  ⭐ TWO, NOT ONE (owner, 2026-09-10). The point of a colour on a collapsed row
 *  is matching the row to what is drawn, and for Volume one swatch is a lie: the
 *  pane is drawn in an UP colour and a DOWN colour, and showing only the up one
 *  says the down bars are that colour too. MACD (macd + signal) and Bollinger
 *  Bands read the same way.
 *
 *  ⛔ CAPPED AT TWO, AND DERIVED — not a list of which indicators get two.
 *  Declaration order is the definition's own, so the first two colours are its
 *  primary pair; ichimoku declares five and a collapsed row is not the place for
 *  five. A definition that grows a third colour changes nothing here. */
function mainColorFields(row) {
  return (row?.fields || []).filter((f) => f && f.type === 'color' && !f.disabled).slice(0, 2)
}

/** A short badge for the collapsed row, when the row has one worth showing.
 *  MA overlays carry a type (`SMA`/`EMA`) that the label already spells, so they
 *  get none; a generated row's group is its definition's short name, which the
 *  label (the LONG name) does not repeat. */
/** ⚰️⚰️ RETIRED 2026-09-16 (owner §30). It printed the definition's SHORT NAME as
 *  a chip beside the row — `MA` next to `Moving Average`, `RSI` next to `Relative
 *  Strength Index` — and the owner's list of what a row must not be overstuffed
 *  with opens with exactly that: *"Do not overstuff rows with implementation
 *  metadata such as: MA / Line · Price"*.
 *
 *  ⛔ IT WAS ALSO THE LAST PLACE A MOVING AVERAGE READ AS TWO THINGS. The engine
 *  MA now names itself `EMA 9` (`engine/semanticName.js`), so the badge printed
 *  `EMA 9` with `MA` beside it — the generic noun the whole change exists to stop
 *  showing a member, restated as a label on the thing that had just stopped
 *  needing it.
 *
 *  ⛔ THE FUNCTION IS DELETED RATHER THAN LEFT RETURNING `null`. A helper that
 *  cannot answer anything is a control that cannot refuse; see `canRemove`'s
 *  gravestone further down for the same ruling. */

/**
 * Is this instance's source genuinely OHLC-bearing?
 *
 * ⭐ ONE CAPABILITY ANSWER, TWO READERS. It began as an IIFE inside the style
 * control; the COLLAPSED row's summary needs the same answer, and a second copy
 * is how "Candles" ends up offered in one place and denied in the other.
 *
 * ⚠️ `anyCachedBars` IS THE WINDOW-AGNOSTIC READ: this tab knows the INSTRUMENT
 * and never the chart's timeframe, so asking for a specific (tf, bars) window
 * would make the answer flicker with the chart.
 */
function ohlcCapableFor(def, inst) {
  if (!inst || !def) return false
  const declared = sourceInputsOf(def, inst)
  if (!declared.length) return false
  const parsed = parseSource(declared[0][1])
  if (!parsed || parsed.kind !== 'symbol') return false
  return ohlcCapabilityOf(def, parsed, anyCachedBars(parsed.symbol), symbolFamily).ok
}

export default function ChartSettingsIndicators({
  rows,
  settings,
  onChange,
  registry,
  onRowPatch,
  colorSwatch,
  volumeRef,
  // The member's stored formulas and the install gate's refusals — SUBSCRIBED BY
  // THE HOST, not here. `ChartSettingsModal` builds `rows`, so it is the
  // component that has to re-render when the formulas arrive; a second
  // subscription here would learn the same thing one render too late to matter.
  userDefRows = [],
  userDefErrors = [],
  // ⭐ A row to open on arrival — the legend gear's deep link (`ind:<rowId>`).
  // Absent on every other way in, which is why the accordion still opens closed.
  // ⚰️ THE RENDERER'S VOLUME INPUTS, HANDED DOWN RATHER THAN RE-DERIVED.
  // `volumeOwnsPane` needs `volumeSeparatePane` / `blankVolume` / `shown`, and
  // those are PROPS the host passes to `StockChart` — this surface could never
  // see them, so it answered the settings-only question and disagreed with the
  // chart. Absent ⇒ the settings-only answer, which is what a host that does not
  // override volume presentation actually means.
  volumeOpts = null,
  openRowId = null,
  // Absent ⇒ absent door. The charts workspace supplies it (it can reach the one
  // mounted `BuilderSheet`); the multi-chart grid does not, and simply shows no
  // New Formula action rather than a button that opens nothing.
  onCreateFormula = null,
}) {
  // 'active' — what the chart draws, plus the ways in.
  // 'browse'  — the catalogue, entered by focusing/typing in search or picking a
  //             category, left by Back, Escape or clearing the box.
  const [mode, setMode] = useState('active')
  const [query, setQuery] = useState('')
  // ⚰️⚰️ IT WAS A FREE-TEXT `category`, filtered against whatever string each
  // result happened to carry — `Momentum`, `Volatility`, `Symbols`, `Your
  // formulas`. That is the CATALOGUE's own vocabulary, which is right for
  // grouping headings and wrong for a strip a member chooses from: it had a tab
  // per definition category and no notion of Indexes, ETFs or Popular at all.
  // ⭐ `LIBRARY_TABS` IS A PRESENTATION TAXONOMY OVER CANONICAL FACTS — see
  // `discoveryCatalog.tabOf`, which reads `kind` and the server's own security
  // type and derives nothing. `Popular` is the landing tab because it is the
  // curated answer to "what do most people add".
  const [tab, setTab] = useState('technical')
  // ⛔⛔ SEARCH IS UNIVERSAL UNTIL THE MEMBER SAYS OTHERWISE, and this boolean is
  // the whole of that rule. `Popular` is a LANDING state, not a filter the member
  // chose — so leaving it applied over a query would mean typing `QQQ` returned
  // nothing, because a ticker is not a popular indicator. That is exactly the
  // direct-search contract the brief protects: *"do not make ticker search
  // harder."*
  //
  // ⭐ SO: no query → the tab browses. A query → everything matches, and the strip
  // shows nothing selected, which is the honest picture of "searching all of it".
  // Click a tab WHILE searching and it narrows, and stays narrowed until the box
  // is cleared. One flag, three behaviours, no hidden mode.
  const [tabPinned, setTabPinned] = useState(false)
  // ⛔ SEEDED FROM `openRowId`, AND `useState`'s INITIALISER IS THE WHOLE POINT.
  // The modal is unmounted when closed (`if (!open) return null`), so this
  // component is fresh on every open and the initial value IS the deep link. An
  // effect would open the row a frame LATER — a visible jump on a surface the
  // member reached by clicking a gear that promised to land there.
  const [selected, setSelected] = useState(openRowId)
  // Drag state: the key being dragged, and the pane it would land above.
  // ⚠️ A REF **AND** STATE. The ref is what the drag handlers read (they fire
  // between renders); the state is only what paints the indicator.
  const dragKeyRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropBefore, setDropBefore] = useState(null)   // rowId — ONE at a time (§11)
  // ⭐ THE TEMPORARY GOLD LANDING MARK. `search → add → SEE IT LAND` is the whole
  // promise of a right-side Add surface, and the thing that lands is a row in a
  // list the member is already looking at. A toast would announce it somewhere
  // else; this tints the actual row for a beat and then stops.
  const [landed, setLanded] = useState(null)
  // ⚠️ NARROW IS A **VIEW**, NOT A MODE. `mode` is what the member is doing
  // (editing / adding / arranging) and is identical at every width; this is only
  // which of the two regions has the screen when there is room for one.
  const [narrowView, setNarrowView] = useState('list')
  const narrow = useMediaQuery('(max-width: 620px)')

  /** The scroll region the rows live in — see `scrollDeepLinkIntoView`. */
  const listRef = useRef(null)

  // ─── AND THE DEEP-LINKED ROW IS SCROLLED INTO VIEW ─────────────────────────
  //
  // ⚰️ OPENING A ROW IS NOT THE SAME AS SHOWING IT, and Volume is where that
  // stopped being a technicality. Its expanded body is nine fields tall; arriving
  // from the gear left the row open at the bottom of a 521px viewport over 690px
  // of content, so "Volume MA width" — the last field — sat below the fold and
  // the panel read as broken. Owner: *"the bottom of the volume settings menu is
  // cut off, make sure it shows like this."*
  //
  // ⭐ `block: 'nearest'` IS THE WHOLE BEHAVIOUR. It scrolls the MINIMUM needed to
  // fit the element and does nothing at all when the row already fits — so a
  // short row (EMA 9, already near the top) does not jump, and a tall one at the
  // bottom is pulled up by exactly its overhang. `'start'` would yank every row to
  // the top of the panel, including ones that were already fully visible.
  //
  // ⛔ IT RUNS ONCE, ON ARRIVAL, AND NOT ON EVERY EXPAND. `openRowId` is the
  // legend gear's address and is null on every other way in; re-running it when
  // the member opens a row BY HAND would fight their own scroll position. The
  // effect is keyed on `openRowId`, not on `expanded`.
  //
  // ⚰️ IT COUNTED FRAMES, AND THE COUNT WAS A GUESS THAT STOPPED BEING TRUE.
  // The first version waited two rAFs — one was measurably not enough (a
  // `scrollIntoView` issued before layout reads the COLLAPSED height and scrolls
  // ~40px instead of ~260px), and two worked when it was written. Then
  // `ChartSettingsModal`'s formula feed moved into a child, which adds a render
  // after mount, and the row's expanded body was no longer laid out by frame two:
  // the panel opened with `scrollTop: 0` and Volume's last field back below the
  // fold. Measured again after the move, on the same chart that had passed.
  //
  // ⭐ SO IT OBSERVES INSTEAD OF COUNTING. Every time the list's box changes while
  // a deep link is pending, ask for the row again — no frame arithmetic, and
  // immune to however many renders the modal happens to do on the way in.
  //
  // ⛔ `scrollIntoView({block: 'nearest'})` IS IDEMPOTENT, which is what makes
  // re-asking safe: once the row fits it scrolls by zero. So this needs no
  // "have I done it yet" flag and no height heuristic to decide whether the body
  // has rendered.
  //
  // ⚠️ AND IT IS TIME-BOUNDED. The observer disconnects after `SETTLE_MS` so it
  // can never fight a scroll the member makes themselves a moment later — the
  // window only has to outlast the modal's own opening renders.
  useEffect(() => {
    if (!openRowId) return undefined
    const SETTLE_MS = 1500
    const pull = () => {
      try {
        const el = listRef.current?.querySelector(`[data-row-id="${CSS.escape(openRowId)}"]`)
        el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      } catch { /* jsdom has neither scrollIntoView nor CSS.escape; nothing depends on it */ }
    }
    pull()
    // jsdom (and any host without layout) simply gets the one call above.
    if (typeof ResizeObserver !== 'function' || !listRef.current) return undefined
    const ro = new ResizeObserver(pull)
    ro.observe(listRef.current)
    const stop = setTimeout(() => ro.disconnect(), SETTLE_MS)
    return () => { ro.disconnect(); clearTimeout(stop) }
  }, [openRowId])
  const searchRef = useRef(null)
  /** The row ids present at the moment an ADD was issued — see the effect below. */
  const pendingAddRef = useRef(null)

  // ─── REMOTE RESULTS ARRIVE LATE, AND NOTHING THE MEMBER IS AIMING AT MAY MOVE ──
  //
  // ⚰️⚰️ MEASURED IN THE BROWSER, ON THE ACCEPTED BUILD. Symbol discovery is a
  // network round trip and the catalogue is local, so the list renders TWICE:
  // local matches at ~150ms, then the remote Symbols group ~2.5s later. An exact
  // ticker hoists that group to the TOP (owner §9 — correct, and untouched), so
  // everything already on screen is pushed down by the whole height of it:
  //
  //     query   local rows   symbol rows   every local row moved
  //     MA          11           20              +933px
  //     RSI          1           15             +1098px
  //     EMA          2           19             +1415px
  //     QQQ          1            2              +129px
  //
  // A member who types `EMA`, sees `Moving Average`, and starts moving the pointer
  // at it finds nineteen tickers there instead. That is a WRONG-CLICK hazard on a
  // surface whose every row is one click from changing the chart, and this class
  // of defect has bitten this codebase through async symbol discovery before.
  //
  // ⛔⛔ AND IT IS NOT FIXED BY RESERVING SPACE. The obvious answer — render the
  // Symbols heading with a loading line so the region exists from the first frame
  // — buys back ONE ROW of a twenty-row insertion: ~40px of 1415. Reserving the
  // group's real height would mean up to twenty rows of empty space on every
  // keystroke, for results that may never come. Both were measured and rejected.
  //
  // ⭐⭐ SO THE LIST IS ANCHORED INSTEAD OF RESERVED. Whatever the member can
  // already see stays exactly where it is, and the late arrivals are inserted
  // ABOVE it — the scroll position absorbs the growth. This is the standard
  // scroll-anchoring contract, applied by hand because the browser's own
  // `overflow-anchor` explicitly declines to adjust a scroll offset of 0, which is
  // precisely the case here: a fresh search always starts at the top.
  //
  // ⛔ IT CHANGES NO RANKING AND NO RESULT. `results`, `groups`, the exact-ticker
  // hoist, `useSymbolDiscovery` and `createFromResult` are all untouched; this
  // moves a scrollTop by the number of pixels the DOM grew above the anchor, and
  // nothing else.
  const addBodyRef = useRef(null)
  /** The row the member is looking at, and where it sat, as of the last paint. */
  const anchorRef = useRef(null)
  /** The query the anchor belongs to — see `sameQuery` in the effect. */
  const anchorQueryRef = useRef(null)
  /** Scroll headroom added so the anchor could be held — see `needed` below. */
  const headroomRef = useRef(0)

  /**
   * The topmost result row that is fully in view, with its viewport position.
   *
   * ⭐ THE FIRST ROW AT OR BELOW THE SCROLLER'S TOP EDGE, because that is the one
   * a member reading the list is anchored on — and the one the pointer is most
   * likely travelling toward. Anchoring on the container's first CHILD instead
   * would pin content that has already scrolled out of sight and move everything
   * visible by the difference.
   */
  const captureAnchor = useCallback(() => {
    const box = addBodyRef.current
    if (!box) return null
    let top
    try { top = box.getBoundingClientRect().top } catch { return null }
    for (const el of box.querySelectorAll('[data-result-key]')) {
      let t
      try { t = el.getBoundingClientRect().top } catch { return null }
      // ⚠️ A 1px SLACK. Sub-pixel layout puts the first row a fraction above the
      // edge often enough that an exact `>=` picks the SECOND row instead.
      if (t >= top - 1) return { key: el.getAttribute('data-result-key'), top: t }
    }
    return null
  }, [])

  /**
   * Hold the anchor still across a render that inserted rows above it.
   *
   * ⚠️ IT RUNS ON EVERY COMMIT, deliberately: the thing it has to catch is a
   * render nothing here initiated (the discovery hook resolving), so there is no
   * dependency that names it. The work is one `querySelectorAll` over a list of at
   * most a few dozen rows, and it exits immediately when nothing moved.
   *
   * ⛔⛔ AND IT REFUSES TO ACT ACROSS A QUERY CHANGE. A NEW search legitimately
   * rebuilds the list and belongs at the top; compensating there would leave a
   * member who just typed something scrolled into the middle of results for it.
   * The anchor is stamped with the query it was taken under, and a mismatch resets
   * rather than corrects.
   *
   * ⚠️ `useLayoutEffect`, NOT `useEffect`. The correction has to land in the same
   * frame as the insertion; a passive effect paints the jump first and then undoes
   * it, which is the flicker this exists to prevent.
   */
  useLayoutEffect(() => {
    const box = addBodyRef.current
    const prev = anchorRef.current
    const sameQuery = anchorQueryRef.current === query
    if (box && prev && sameQuery) {
      for (const el of box.querySelectorAll('[data-result-key]')) {
        if (el.getAttribute('data-result-key') !== prev.key) continue
        let delta = 0
        try { delta = el.getBoundingClientRect().top - prev.top } catch { delta = 0 }
        // ⚠️ A WHOLE PIXEL. Sub-pixel churn from a font or a scrollbar is not a
        // reflow and must not nudge the scroll position on every keystroke.
        if (Math.abs(delta) >= 1) {
          // ⚰️⚰️ THE ANCHOR ALONE WAS NOT ENOUGH, AND THE MEASUREMENT SAID SO.
          // `MA` (11 local rows) held to 16px, but `RSI` — ONE local row under
          // fifteen arriving tickers — still moved 229px, with `scrollTop` sitting
          // exactly on `scrollHeight - clientHeight`. A scroll cannot hold a row
          // that has nothing beneath it: there was no extent left to spend, so the
          // compensation was silently clamped. Sparse local results are precisely
          // the case where one actionable row is easiest to mis-click.
          //
          // ⭐ SO THE LIST GROWS EXACTLY THE HEADROOM IT IS SHORT OF, once, and
          // never a pixel more. Not a fixed spacer: a 400px tail measured on `RSI`
          // fixed it and left every SHORT result list (`SPY`, `QQQ`, three rows)
          // able to scroll into blank space, which reads as a broken list. This is
          // zero for every query that does not need it.
          //
          // ⚠️ AND IT IS RESET WHEN THE QUERY CHANGES, below — headroom borrowed
          // for one search must not outlive it.
          // ⚰️⚰️ AND ONLY WHEN THE ROW WAS PUSHED **OUT OF SIGHT**. Two gates were
          // tried and measured before this one:
          //
          //   · correct ALWAYS — `QQQ` (three rows, no scrollbar, everything on
          //     screen) borrowed 74px of headroom to hold a Breadth row still,
          //     which pushed the EXACT TICKER the member had just typed out of
          //     view and hung a blank tail off a three-row list. Owner §9 says an
          //     exact ticker outranks everything; on a list that fits, letting it
          //     land on top IS the right outcome.
          //   · correct only when the list ALREADY SCROLLED — `RSI` regressed
          //     straight back to 1030px, because one local row plus a one-line
          //     notice does not overflow, and that is exactly the sparse case where
          //     a single actionable row is easiest to mis-click.
          //
          // ⭐ SO THE QUESTION IS THE ONE THAT ACTUALLY DESCRIBES THE HAZARD: after
          // the insertion, can the member still SEE the row they were looking at?
          // A row that shifts while staying on screen is a list settling — they can
          // see what happened and where it went. A row shoved past the bottom edge
          // is gone, and whatever is under the pointer now is something else.
          const edge = box.getBoundingClientRect().bottom
          const pushedOutOfSight = el.getBoundingClientRect().top >= edge - 8
          if (pushedOutOfSight) {
            const want = box.scrollTop + delta
            const max = box.scrollHeight - box.clientHeight
            if (want > max) {
              headroomRef.current += (want - max)
              box.style.paddingBottom = `${headroomRef.current}px`
            }
            box.scrollTop = want
          }
        }
        break
      }
    }
    if (!sameQuery && box) {
      // A new search is a new list: it belongs at the top, with no borrowed tail.
      headroomRef.current = 0
      box.style.paddingBottom = ''
    }
    anchorRef.current = captureAnchor()
    anchorQueryRef.current = query
  })

  // ─── A NEW SERIES LANDS, AND THE INSPECTOR IS ALREADY SHOWING IT ───────────
  //
  // ⭐⭐ BY DIFFING ROW IDS, WHICH IS WHY IT WORKS FOR EVERY ADD PATH AT ONCE.
  // The four doors mint identity four different ways — `createFromResult` for a
  // symbol or a breadth measure, `addInstance` for a definition, `toggledRow` for
  // a built-in overlay, and `setIndicatorEnabled` when it REVIVES a tombstone —
  // and a per-path "which id did I just make" would be four answers to keep in
  // step with writers this file does not own. The rows arrive from the host on the
  // next render; whichever id is new is the thing that just landed.
  //
  // ⛔ ARMED ONLY BY A WRITE THAT ACTUALLY CHANGED SOMETHING. Every writer here
  // refuses by IDENTITY, so a refused click never arms this and never steals the
  // member's current selection.
  //
  // ⚠️ AND IT DISARMS ON THE FIRST ROWS CHANGE WHETHER OR NOT IT FOUND ONE. A
  // revive that re-uses an existing row id is a legitimate outcome; leaving the
  // ref armed would make the NEXT unrelated settings change look like an add.
  useEffect(() => {
    const before = pendingAddRef.current
    if (!before) return
    pendingAddRef.current = null
    const fresh = (rows || []).map((r) => r.id).filter((id) => !before.has(id))
    if (!fresh.length) return
    const id = fresh[fresh.length - 1]
    setSelected(id)
    setLanded(id)
    setNarrowView('inspector')
  }, [rows])

  useEffect(() => {
    if (!landed) return undefined
    const t = setTimeout(() => setLanded(null), 1400)
    return () => clearTimeout(t)
  }, [landed])

  /** Arm the landing effect, then let the caller make its own write. */
  const armAdd = useCallback(() => {
    pendingAddRef.current = new Set((rows || []).map((r) => r.id))
  }, [rows])

  /** The definition lookup, once — every helper below takes it. */
  const defOf = useCallback(
    (id) => registry?.getDefinition?.(id) || null,
    [registry],
  )

  /**
   * The RAW stored source ref of a row, through the canonical reader.
   *
   * ⛔ `sourceInputsOf` IS THE GATE, not a key name: it reads the definition's own
   * `type: 'source'` declaration, so an input merely NAMED `source` is not one and
   * a formula whose `period` holds a ref-shaped string is still a period.
   */
  const rawSourceOf = useCallback((row, def) => {
    if (!row || !row.engineOwned || !row.instanceId || !def) return null
    const inst = findInstance(settings, row.instanceId)
    if (!inst) return null
    const declared = sourceInputsOf(def, inst)
    return declared.length ? declared[0][1] : null
  }, [settings])

  // ─── THE MEMBER'S OWN FORMULAS ────────────────────────────────────────────
  //
  // ⛔ `generation` IS NOT DECORATION IN THE MEMO BELOW. `registry` is a module
  // NAMESPACE — the same object for the lifetime of the tab — so a memo keyed on
  // it alone computes once and never again, while user definitions install from
  // SWR after first paint. The host's `useInstalledUserDefinitions` performs that
  // install during ITS render, which is above this one, so by the time this line
  // runs the number is the post-install one.
  const generation = catalogGeneration(registry)

  // ⭐ `BUILT_IN_ROWS` IS UNIONED **HERE**, NOT INSIDE `catalogRows()`. That
  // function is the shipped DEFINITION manifest and two railed consumers assert
  // against it id-for-id (the right-click submenu, the share link's payload
  // keys); a moving average has no definition and belongs in neither. The union
  // is a consumer's job — the same rule this file already follows for the
  // member's own formulas, one line down.
  //
  // ⛔ FIRST, DELIBERATELY. A member who searches "volume" is far more likely to
  // want the volume pane than Anchored VWAP, and a member who searches "moving
  // average" got NOTHING at all before these two rows existed.
  // ⚠️ `generation` IS A DEPENDENCY THE LINTER CANNOT SEE THE USE OF, and it is
  // load-bearing. `catalogRows(registry)` and `userCatalogRows(registry)` READ a
  // mutable registry; `registry` is the same object identity before and after a
  // member's formula is installed into it, so nothing in the expression changes
  // when the install lands. `generation` is the install counter
  // (`useInstalledUserDefinitions`) and is the only value that moves — drop it and
  // a member's own formulas never appear in Browse until something else forces a
  // recompute. `IndicatorLibraryDialog`'s catalogue memo carries the identical
  // pair for the identical reason.
  // ⚠️ THIS IS THE **BROWSE** CATALOGUE, NOT THE ACTIVE LIST. `activeRows` below
  // comes from `listAllIndicators`, so hiding a row here removes only the offer to
  // CREATE one — every overlay a member already has keeps its own row, its
  // settings and its ✕. That distinction is what makes hiding the legacy `ma`
  // row non-destructive; see `discoveryCatalog.LIBRARY_HIDDEN_IDS`.
  // ⚰️⚰️ AND THE HIDDEN SET APPLIES TO THE **DEFINITIONS** TOO, WHICH IT DID NOT.
  // `hiddenLibraryIds` was filtering `BUILT_IN_ROWS` alone, so `dataSeries` — the
  // one definition `discoveryCatalog.LIBRARY_HIDDEN_IDS` exists to keep out of
  // browse — was offered on this tab as a row reading **"Data Series · Plots a
  // numeric source directly"**. That is precisely the workflow the owner's §8
  // rules out: *"a member should not have to add something called Data Series and
  // then figure out how to transform it into QQQ"*. The library DIALOG has always
  // filtered both lists (`IndicatorLibraryDialog`'s own catalogue memo); this tab
  // was the surface where the substrate leaked.
  //
  // ⭐ AND THE REVIVE ROW IS RENAMED, NOT HIDDEN — `libraryRowFor`. On a chart
  // with a tombstoned overlay the legacy `ma` row is revealed so the member can
  // get their EMA 9 back; renaming it *Restore EMA 9* is what stops that being a
  // SECOND row reading "Moving Average" (§34).
  const catalog = useMemo(
    () => {
      const hidden = hiddenLibraryIds(settings)
      return [
        ...BUILT_IN_ROWS.filter((r) => !hidden.includes(r.id)).map((r) => libraryRowFor(r, settings)),
        ...catalogRows(registry).filter((r) => !hidden.includes(r.id)),
        ...userCatalogRows(registry),
      ]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` IS the registry's version; see above
    [registry, generation, settings],
  )

  // ─── ACTIVE: WHAT THE CHART IS DRAWING ────────────────────────────────────
  //
  // ⛔ IN `listAllIndicators` ORDER, UNTOUCHED (§15). That is MA overlays, then
  // the volume pane, then one row per LIVE INSTANCE in stored order, then the
  // carved-out sections — the same order the panes and the legend read. This
  // filters; it never sorts.
  const activeRows = useMemo(
    () => (rows || []).filter((r) => isFixtureRow(r) || readEnabled(r)),
    [rows],
  )

  // ─── AND THE SAME ROWS, GROUPED BY THE PANE THEY DRAW IN ──────────────────
  //
  // ⭐ ONE CALL, NO LOCAL RULES. Everything the left column knows about pane
  // structure arrives here; there is no grouping logic in this file to drift
  // from the renderer's.
  const paneGroups = useMemo(
    () => paneMap(activeRows, settings, (id) => registry?.getDefinition?.(id) || null, volumeOpts),
    [activeRows, settings, registry, volumeOpts],
  )

  /** Is this row's line DRAWN right now?
   *
   *  ⭐ THIS IS THE SPLIT THAT MAKES "TURN IT OFF" STOP MEANING "DELETE IT".
   *  On a generated row the tab's toggle wrote `enabled`, which routes at
   *  `setIndicatorEnabled` and TOMBSTONES every instance — correct for a
   *  definition-level switch, and wrong for a list whose whole promise is that a
   *  disabled indicator stays put and keeps its settings. An instance already has
   *  the right verb: `hidden`, which `binder.js` and `pool.js` skip before
   *  computing and which `isIndicatorEnabled` deliberately still counts as ON —
   *  the same eye the legend chip's own hide button writes. */
  const rowVisible = useCallback((row) => {
    if (row.engineOwned && row.instanceId) {
      return findInstance(settings, row.instanceId)?.hidden !== true
    }
    return readEnabled(row)
  }, [settings])

  const setRowVisible = useCallback((row, on) => {
    if (row.engineOwned && row.instanceId) {
      const next = setInstanceHidden(settings, row.instanceId, !on, registry)
      if (next !== settings) onChange?.({ ...next, preset: 'custom' })
      return
    }
    onRowPatch?.(row, { [row.enabledKey || 'enabled']: on })
  }, [settings, onChange, onRowPatch, registry])

  // ⚰️ `canRemove(row)` STOOD HERE and answered `false` for the MA overlays and
  // the volume pane, because the positional merge could not express their removal
  // without rewriting the member's other moving averages. `chartDefaults`'s
  // tombstone can, so EVERY row is removable and the predicate is gone rather
  // than left returning a constant `true` — a gate that cannot refuse is not a
  // gate. What still differs per row kind is the VERB, and `removeRow` routes on
  // that directly.

  /**
   * Clear the selection only when the row that just left IS the selected one.
   *
   * ⚠️ IT USED TO CLEAR UNCONDITIONALLY, and that was correct for an accordion:
   * the ✕ and the open form were on the same row, so removing it had to close it.
   * The inspector is a PERSISTENT column — removing EMA 20 while reading RSI's
   * settings would blank the panel the member is working in, for a row they did
   * not touch. Measured in the harness: deleting the QQQ host emptied the
   * inspector that was showing RSI.
   *
   * ⛔ THE SELECTION IS ALSO RESOLVED AGAINST THE LIVE ROWS EVERY RENDER, so a
   * selected row that is removed empties the panel anyway. This is belt and
   * braces for the one case that has a WRITE to make it explicit — not a second
   * mechanism: both agree because both compare the same row id.
   */
  const deselectIfRemoved = useCallback((row) => {
    setSelected((cur) => (cur === row.id ? null : cur))
  }, [])

  const removeRow = useCallback((row) => {
    let next = settings
    // ⛔ A FIXTURE IS TOMBSTONED, NEVER SPLICED. `cs.overlays` is merged
    // POSITIONALLY — removing slot 0 by splicing slides EMA 20's stored values
    // into EMA 9's slot on the very next read and resurrects a default SMA 200 in
    // the vacated fourth. The slot stays where it is and carries `removed: true`,
    // which also means the member's colour and period are still there when they
    // add one back from the catalogue. See `chartDefaults`'s tombstone header.
    //
    // ⛔ AND IT IS `removed`, NOT `enabled`. The row's TOGGLE writes `enabled`
    // (hide, stay listed); this writes `removed` (leave the chart). Two facts,
    // two keys — collapsing them is what made the old tab's disable switch a
    // delete button.
    if (isFixtureRow(row)) {
      onRowPatch?.(row, { removed: true })
      deselectIfRemoved(row)
      return
    }
    if (row.engineOwned) {
      // A named instance leaves its siblings drawing (`removeInstance` keeps the
      // mirror true when one survives); a row with NO instance is the "turn it
      // on" control for a definition, so off is the whole removal.
      next = row.instanceId
        ? removeInstance(settings, row.instanceId, registry)
        : setIndicatorEnabled(settings, row.defId, false, registry)
      if (next !== settings) onChange?.({ ...next, preset: 'custom' })
    } else {
      // Carved out (`volumeProfile`): it has no definition to instantiate, so its
      // settings slice IS its existence — the same write its toggle makes.
      onRowPatch?.(row, { enabled: false })
    }
    deselectIfRemoved(row)
  }, [settings, onChange, onRowPatch, registry, deselectIfRemoved])

  // ─── DISCOVERY ────────────────────────────────────────────────────────────
  //
  // ⭐⭐ SYMBOLS AND BREADTH ARE FIRST-CLASS RESULTS IN THE SAME BOX (owner §9).
  // A member who wants QQQ under their chart types `QQQ` and clicks `QQQ`; the
  // facade turns that row into the canonical `dataSeries` + `sym:QQQ:close`
  // instance every other door already creates. There is no second symbol engine
  // and no second search — see the import block.
  //
  // ⚠️ IT RUNS ONLY WHILE BROWSING. `enabled` is the hook's own gate: a closed
  // catalogue makes no request and holds no state, which is the same discipline
  // `UserFormulaFeed` follows one file up.
  // ⚰️⚰️ THERE WERE THREE RIGHT-HAND STATES AND THERE ARE TWO. `mode === 'active'`
  // with nothing selected used to render an orientation screen — a mark, a
  // sentence and a `Browse indicators` button — and the owner tested it: *"we
  // tested it. It is unnecessary. It creates an extra conceptual state and wastes
  // a click."* Opening Indicators to look for something now IS looking for
  // something.
  //
  // ⭐ SO DISCOVERY IS THE DEFAULT, NOT A DESTINATION. `browse` is still the
  // explicit mode a member enters from `＋ Add Indicator`; what changed is that
  // ACTIVE-with-no-selection resolves to the same surface, so there is ONE
  // discovery component reached two ways rather than an empty state in front of
  // it. The right side now answers exactly two questions: what can I add, and how
  // is this one configured.
  const discovering = mode === 'browse' || (mode === 'active' && !selected)
  const { results: symbolResults, loading: symbolsLoading } = useSymbolDiscovery(query, discovering)
  // ⚠️ THE SAME WINDOW `useSymbolDiscovery` NORMALISES AGAINST, so a browsed row
  // and a searched row report the same capability for the same instrument. The
  // hook defaults to these two; naming them here keeps the browse path honest
  // rather than letting it answer `UNKNOWN` for everything.
  const TF = 'D'
  const BARS = 400
  // ⛔ THE ROWS ARE ALREADY FETCHED. `useBreadthSymbols` requests
  // `/api/breadth-symbols` ONCE per module and hands back the cache — this adds
  // no request, exactly as `useSymbolDiscovery`'s own header records.
  const breadthAll = useBreadthSymbols()

  // ⭐ THE ROW A MEMBER CLICKS AND THE RESULT IT WAS BUILT FROM, KEPT TOGETHER.
  //
  // ⛔⛔ AND THE **RESULT** IS WHAT CREATION READS, NEVER THE ROW. A library row's
  // `shortName` is its CHIP — `ETF`, `Breadth` — while a result's `shortName` is
  // the series' display NAME. `createFromResult` stamps `display.name` from it, so
  // handing it the row would have labelled a QQQ series "ETF" on the chart, in the
  // legend and in the source picker. Same trap `symbolLibraryRow`'s own header
  // documents from the other side: the two shapes carry different fields on
  // purpose, and only one of them is a name.
  const symbolRows = useMemo(() => {
    const rows = []
    const byKey = new Map()
    for (const res of symbolResults) {
      const row = symbolLibraryRow(res)
      if (!row) continue
      rows.push(row)
      byKey.set(row.key, res)
    }
    return { rows, byKey }
  }, [symbolResults])

  // ─── BROWSE, FOR THE TABS THAT HAVE SOMETHING TO SHOW WITHOUT A QUERY ─────
  //
  // ⛔⛔ NO NEW CATALOGUE AND NO NEW REQUEST. Symbols and ETFs browse the SAME
  // `POPULAR_RESULTS` the desktop dropdown and the phone sheet already share —
  // exported *"so the two surfaces can never drift on what popular means"*, and
  // now three. Indexes browses `INDICES_PRESET`, whose own comment states it IS
  // the full universe (`api/index_bars.py INDEX_MAP`), so that tab is complete
  // rather than a sample. Breadth browses the rows `useBreadthSymbols` has
  // already fetched once per module. All three go through `securityResults` /
  // `breadthResults`, so a browsed row and a searched row are the same shape with
  // the same capability and the same create door.
  const browsed = useMemo(() => {
    const secs = securityResults(POPULAR_RESULTS, { tf: TF, bars: BARS })
    const idx = securityResults(INDICES_PRESET, { tf: TF, bars: BARS })
    const brd = breadthAll && typeof breadthAll.all === 'function'
      ? breadthResults(breadthAll.all(), { tf: TF, bars: BARS }) : []
    return [...secs, ...idx, ...brd]
  }, [breadthAll])

  const results = useMemo(() => {
    const byQuery = catalog.filter((r) => matches(r, query))
    // ⛔ THE REMOTE ROWS ARE NOT RE-FILTERED BY `matches`. They are already the
    // answer to this query — `useSymbolDiscovery` asked the server and the breadth
    // library with it — and a second substring test over a name the server ranked
    // would drop `Invesco QQQ Trust` for the query `Invesco` on a bad day.
    //
    // ⭐ WITH NO QUERY THE BROWSE ROWS STAND IN FOR THE REMOTE ONES. `Symbols`,
    // `Indexes` and `ETFs` are search-driven tabs — there is no endpoint that
    // lists every ticker — so an empty box shows the canonical popular/index
    // sets rather than an empty tab that reads as broken. A query replaces them
    // with the real answer.
    const live = query ? symbolRows.rows : browsed
    // ⛔ DEDUPED, THE QUERY'S ANSWER WINNING. A browsed `QQQ` and a searched
    // `QQQ` are the same instrument with the same key.
    //
    // ⚰️⚰️ AND THE IDENTITY IS `key || catalog:id`, WHICH IS NOT PEDANTRY. The
    // CATALOGUE half of this list is assembled above from `BUILT_IN_ROWS`,
    // `catalogRows` and `userCatalogRows` DIRECTLY — not through `libraryRows` —
    // so those rows carry an `id` and no `key` at all. Deduping on `r.key` alone
    // therefore saw `undefined` for every catalogue row, kept the first and
    // dropped the rest: measured, a chart with a tombstoned overlay searched
    // `moving average` and got `Restore EMA 9` and nothing else, because the
    // revive row sorted first and `Moving Average` collided with it on
    // `undefined`. Prefixing the catalogue side keeps it from ever colliding with
    // a discovery key either (`ma` the definition vs `MA` the ticker).
    const seen = new Set()
    const out = []
    for (const r of [...byQuery, ...live]) {
      if (!r) continue
      const k = r.key || `catalog:${r.id}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
    return out
  }, [catalog, query, symbolRows, browsed])

  /** The tab actually FILTERING right now — `null` means "everything". */
  const activeTab = (query && !tabPinned) ? null : tab

  /** What the selected tab shows — the filter, applied last. */
  const tabResults = useMemo(() => resultsForTab(results, activeTab), [results, activeTab])

  const refusals = useMemo(
    () => userRefusalRows((userDefRows || []).map((r) => r && r.definition), userDefErrors)
      .filter((r) => matches(r, query)),
    [userDefRows, userDefErrors, query],
  )

  // Headings DERIVED in first-appearance order, the member's own hoisted to the
  // front — the same partition `IndicatorLibraryDialog` makes, and for the same
  // reason (a formula you wrote should not be below four shipped categories).
  //
  // ⚠️ THESE ARE THE CATALOGUE'S OWN GROUP NAMES (`Momentum`, `Trend`,
  // `Symbols`…), NOT the tabs. A tab is what the member chose to look at; a
  // heading is how that tab's contents sort themselves inside it.
  const groups = useMemo(() => {
    const order = [...new Set(tabResults.map((r) => r.category))]
    const mine = new Set(tabResults.filter((r) => r.userDefined).map((r) => r.category))
    const ranked = [...order.filter((c) => mine.has(c)), ...order.filter((c) => !mine.has(c))]
    // ⭐ AN EXACT TICKER OUTRANKS EVERYTHING (owner §9). A member who types `QQQ`
    // means the instrument, and burying Symbols under four shipped categories is
    // the same defect `useSymbolDiscovery` already fixed WITHIN its own list.
    const first = symbolRows.rows[0]
    const exact = first && String(first.id).toUpperCase() === String(query).trim().toUpperCase()
      ? first.category : null
    return exact ? [exact, ...ranked.filter((c) => c !== exact)] : ranked
  }, [tabResults, symbolRows, query])

  // ⛔ ONE DISCOVERY SURFACE, TWO DOORS. `＋ Add Indicator` sets the EXPLICIT
  // mode even when discovery is already on screen — which is what makes the focus
  // effect below fire and put the caret in the box. It never creates a second Add
  // state; `browse` and `active`-with-no-selection render the same component.
  const enterBrowse = useCallback(() => {
    setMode('browse')
    // ⚠️ FOCUS EVEN IF THE MODE DID NOT CHANGE. Pressing the button while already
    // discovering is a statement of intent to search, and the effect below only
    // fires on a mode TRANSITION.
    try { searchRef.current?.focus() } catch { /* noop */ }
  }, [])
  const leaveBrowse = useCallback(() => {
    // ⛔ THE SELECTION IS NOT DESTROYED (owner §20). `mode` goes back to `active`
    // and `selected` is untouched, so a member who was editing `EMA 20`, went
    // looking for something and changed their mind lands back on `EMA 20`.
    // ⚠️ AND WITH NO SELECTION THIS IS UNREACHABLE — the arrow that calls it is
    // not rendered, because `active` with nothing selected IS discovery.
    setMode('active'); setQuery(''); setTab('technical'); setTabPinned(false)
    try { searchRef.current?.blur() } catch { /* noop */ }
  }, [])

  // ⭐ THE BOX TAKES FOCUS WHEN THE ADD SURFACE OPENS. `＋ Add` is a statement of
  // intent to search, and a member who then has to click the field has been made
  // to ask twice. It is keyed on the MODE rather than done inside `enterBrowse`
  // so that `pickCategory` — the other way in — gets it too, and so a re-render
  // while already browsing never steals the caret back from where they put it.
  // ⛔⛔ ON `browse`, NOT ON `discovering`. Discovery is the DEFAULT now, so
  // keying this on the surface would take the caret the instant the Indicators tab
  // is opened — stealing focus from the modal's own landing element, and from a
  // member who arrived by keyboard and is still on the tab strip. The audit rule
  // holds: focus follows an EXPRESSED intent (`＋ Add Indicator`), never a render.
  useEffect(() => {
    if (mode !== 'browse') return
    try { searchRef.current?.focus() } catch { /* noop */ }
  }, [mode])

  // ─── ARRANGE IS A MODE, AND LEAVING IT IS A MEMBER'S DECISION ──────────────
  //
  // ⛔ ENTERING IT CLEARS NO SELECTION AND WRITES NOTHING. A member who arranges
  // panes and presses Done is looking at the row they were editing before, with
  // its Inspector unchanged — the mode is a lens over the same state, not a
  // separate place with its own.
  const enterArrange = useCallback(() => {
    setMode('arrange'); setQuery(''); setTab('technical'); setTabPinned(false); setNarrowView('list')
  }, [])
  const leaveArrange = useCallback(() => {
    setMode('active')
    dragKeyRef.current = null; setDragging(null); setDropBefore(null)
  }, [])

  // ⚰️ `pickCategory` STOOD HERE. It was the door the retired bottom-of-list
  // `Browse` chips opened — pick a category, enter browse mode, focus the box.
  // The category strip under Search is that door now, and it is already IN browse
  // mode when it is visible, so there is no second entry to keep.


  const addRow = useCallback((row) => {
    // ⚰️⚰️ ONE CREATED OBJECT, ONE CANONICAL IDENTITY — AND THIS DOOR MINTED A
    // DIFFERENT ONE. `addAnother` below already routes a DEFINITION at
    // `addInstance` and only a BUILT-IN at `toggledRow`; the FIRST add took
    // `toggledRow` unconditionally, so the same definition arrived as
    // `legacy:<defId>` from this door and `inst:<defId>:N` from every other.
    //
    // ⛔ MEASURED IN THE HARNESS, same chart, same definition:
    //
    //   inst:dataSeries:1   resolved=pane  inOwn=true   → its own pane ✅
    //   legacy:dataSeries   resolved=pane               → ABSENT from the
    //                                                     normalised instances,
    //                                                     so no pane at all ❌
    //
    // `legacy:<defId>` is COMPATIBILITY identity — it stands for shipped settings
    // being adapted into the engine. A member clicking ＋ Add is authoring a NEW
    // instance, and the UI door must not decide which architecture it enters.
    //
    // ⚠️ A REVIVABLE LEGACY INSTANCE STILL WINS, and that is not a special case —
    // it is the compatibility half of the same rule. `setIndicatorEnabled` revives
    // a tombstoned `legacy:<id>` WITH the member's edited period and colour; minting
    // a fresh instance instead would silently hand back a default-configured
    // indicator and leave their old one tombstoned beside it.
    // ⭐⭐ A DISCOVERY RESULT CREATES THROUGH THE FACADE, NOT THROUGH THIS FILE.
    // A symbol row carries a `create` descriptor and `createFromResult` is the one
    // composition of `addInstance` + `setInstanceInput` that honours it — the same
    // door `discoveryCatalog.test.js` rails as "creation is kind-blind", so a
    // breadth measure and a security differ only in the string after `sym:`.
    //
    // ⛔ THE RESULT, NOT THE ROW — see `symbolRows` above for the measured reason.
    // ⭐ SEARCH → ADD → SEE IT LAND → EDIT IT. The Add surface closes on a
    // successful add and the new row's Inspector takes the right column, because
    // the add is finished and what a member does next is configure the thing they
    // just made. The LEFT structure never went anywhere, so they watched it land.
    const commit = (next) => {
      if (next === settings) return false
      onChange?.({ ...next, preset: 'custom' })
      leaveBrowse()
      return true
    }
    armAdd()
    const res = symbolRows.byKey.get(row.key)
    if (res) {
      if (!commit(createFromResult(settings, res, registry))) pendingAddRef.current = null
      return
    }
    const revivable = !row.builtIn && !!findInstance(settings, legacyInstanceId(row.id))
    const next = (row.builtIn || revivable)
      ? toggledRow(row, settings, registry)
      : addInstance(settings, row.id, registry)
    // Identity, not deep equality: a REFUSED write returns `settings` itself, and
    // persisting a no-op would mark the preset custom for a click that did nothing
    // — and must leave the member's current selection alone, hence the disarm.
    if (!commit(next)) pendingAddRef.current = null
  }, [settings, onChange, registry, symbolRows, armAdd, leaveBrowse])

  const addAnother = useCallback((row, e) => {
    e.stopPropagation()
    // ⛔ A BUILT-IN ROW HAS NO DEFINITION TO INSTANTIATE, so `addInstance` would
    // return the settings BY IDENTITY and this ＋ would be a live control that
    // writes nowhere. `toggledRow`'s overlay branch is what means "another moving
    // average" — revive a tombstone, else append a slot — and it is the same
    // writer the library dialog's own ＋ uses.
    armAdd()
    const next = row.builtIn
      ? toggledRow(row, settings, registry)
      : addInstance(settings, row.id, registry)
    if (next !== settings) { onChange?.({ ...next, preset: 'custom' }); leaveBrowse() }
    else pendingAddRef.current = null
  }, [settings, onChange, registry, armAdd, leaveBrowse])

  // ─── ONE ROW, COLLAPSED (§9 option B: toggle · name · colour · chevron) ────

  /**
   * One PANE, as a heading and a rail down its rows.
   *
   * ⭐ THE HEADING IS THE PANE'S NAME AND NOTHING ELSE. No `@host`, no instance
   * id, no display-target string — `chartDataMap` already translated all of that
   * into the name the legend and the destination menu use.
   *
   * ⛔ AND AN ORPHAN GROUP SAYS WHY IT EXISTS. "Needs attention" is the one
   * group whose members are not drawing; leaving it looking like an ordinary pane
   * would be the silent re-home the engine refuses to do.
   */
  // ─── WHOLE-PANE REORDERING ───────────────────────────────────
  //
  // ⛔⛔ A PANE MOVES; A SERIES DOES NOT. "Display in" changes which pane a
  // SERIES draws in and rewrites its placement; this changes where a whole pane
  // sits and rewrites nothing about any series in it. Guests travel with their
  // host because they resolve to it — there is no second write to keep in step,
  // which is exactly why the two features can share a panel without confusing
  // each other.
  //
  // ⚠️ ONLY REAL PANES. `hidden` and `orphans` are lists of things that are not
  // drawing; offering to reorder them would be offering a rectangle that does
  // not exist.
  const arrangeable = paneGroups.filter((g) => ['price', 'volume', 'pane'].includes(g.kind))
  const arrangeableIds = new Set(arrangeable.map((g) => g.id))
  const paneKeysNow = paneGroups.filter((g) => g.kind === 'pane').map((g) => g.id)
  const paneOpts = { volumePane: arrangeable.some((g) => g.kind === 'volume') }
  const canMove = (id, delta) => {
    const at = arrangeable.findIndex((g) => g.id === id)
    return at >= 0 && at + delta >= 0 && at + delta < arrangeable.length
  }
  const nudge = (id, delta) => {
    const next = movePane(settings, paneKeysNow, id, delta, paneOpts)
    if (next !== settings) onChange?.(next)
  }
  const dropOn = (id, beforeId) => {
    const next = movePaneTo(settings, paneKeysNow, id, beforeId, paneOpts)
    if (next !== settings) onChange?.(next)
  }

  // ─── SERIES REORDERING, **INSIDE** ONE PANE ────────────────────────
  //
  // ⛔⛔ THREE ORDERS, THREE CONTROLS, AND THEY MAY NEVER BE CONFLATED.
  //   · these arrows          reorder SERIES inside the pane they are already in
  //   · Arrange               reorders whole PANES
  //   · the Inspector's Display   moves a series to ANOTHER pane
  // A row arrow cannot reach the second or the third: it steps inside one pane's
  // own membership list, so there is no index at either end that names anything
  // outside it, and the only key it writes is `paneSeriesOrder`.
  //
  // ⚠️ ONLY REAL PANES, the same gate `arrangeable` uses. `hidden` and `orphans`
  // are rows that are not drawing anywhere; ordering them would be ordering a
  // rectangle that does not exist.
  const orderable = (group) => !!group && ['price', 'volume', 'pane'].includes(group.kind)
  const memberIds = (group) => (group && group.rows ? group.rows : []).map((r) => r.id)
  const canNudgeRow = (group, rowId, delta) =>
    orderable(group) && canMoveSeries(settings, group.id, memberIds(group), rowId, delta)
  const nudgeRow = (group, rowId, delta) => {
    if (!orderable(group)) return
    const next = moveSeriesWithinPane(settings, group.id, memberIds(group), rowId, delta)
    // ⛔ NO WRITE AT A BOUNDARY. `moveSeriesWithinPane` hands back the SAME object
    // when the step would leave the pane, so a member holding ↑ on the top row
    // never produces a settings write — which is what keeps "opening Indicators
    // writes nothing" true for the arrows too.
    if (next !== settings) onChange?.(next)
  }

  // ─── THE LEFT COLUMN — "WHAT IS ON MY CHART" ───────────────────────────────
  //
  // ⛔⛔ IT IS NOT A TABLE, AND THAT IS THE WHOLE PRESENTATION DECISION.
  // Hybrid 2 spent 680px on three standing columns — INDICATOR | SOURCE |
  // DISPLAY — and the owner's verdict was that it read as *administering a table
  // of chart objects*. Every fact those columns printed is still available; it is
  // printed ONCE, in the Inspector, for the ONE row the member asked about. The
  // structure list answers exactly one question and then stops.
  //
  // ⭐ THE PANE HEADING IS A DIVIDER, NOT A CARD. Uppercase, faint, a hairline
  // above it and nothing else — the pane's job here is to say which rectangle the
  // rows beneath it draw in, and a band, a border or a tonal fill all say it
  // louder than it needs saying.

  /** The flat, visual order of selectable rows — what ↑/↓ walk. */
  const flatRows = useMemo(
    () => paneGroups.flatMap((g) => g.rows),
    [paneGroups],
  )

  /**
   * THE SELECTED ROW, RESOLVED AGAINST THE LIVE LIST EVERY RENDER.
   *
   * ⛔⛔ `selected` IS AN ID, AND THE ROW IS LOOKED UP — never held. A row object
   * kept in state would be a stale copy of settings the moment anything wrote, so
   * the Inspector would render yesterday's period over today's chart. It would
   * also survive its own deletion, which is precisely how an editor ends up
   * writing to an instance that no longer exists.
   *
   * ⛔ AND A ROW THAT LEFT THE CHART EMPTIES THE PANEL rather than freezing it,
   * because the lookup simply stops finding it.
   */
  const selectedRow = useMemo(
    () => flatRows.find((r) => r.id === selected) || null,
    [flatRows, selected],
  )

  /** The group a row is filed under, for the Inspector's contextual name. */
  const groupOfRow = useCallback(
    (rowId) => paneGroups.find((g) => g.rows.some((r) => r.id === rowId)) || null,
    [paneGroups],
  )

  /**
   * The colour this row's line is actually drawn in — the same value the swatch
   * beside it edits and the renderer reads.
   *
   * ⭐ IT IS THE MICRO-RAIL'S ONLY COLOUR SOURCE, which is what lets the rail here
   * and the rail in Legend V2 agree without either knowing about the other: both
   * end at the instance's own stored colour. A second resolution step — a palette,
   * a per-pane hue, a "first plot" guess — is how the settings list starts naming
   * a different line than the legend does.
   *
   * ⚠️ NULL IS A REAL ANSWER. A row with no colour of its own keeps the rail's
   * WIDTH and paints nothing, exactly as `LegendRow`'s does, so every label in the
   * column starts at one x.
   */
  const rowColor = useCallback((row) => {
    const f = mainColorFields(row)[0]
    const v = f ? row?.values?.[f.key] : null
    return (typeof v === 'string' && v) ? v : null
  }, [])

  /**
   * Select a row — the list's ONE interaction.
   *
   * ⛔ BY ROW ID, NEVER BY LABEL OR INDEX. Two EMA 20s in two panes print the same
   * words; an index changes the moment a pane is reordered. The row id is the
   * instance address every write already takes.
   */
  const selectRow = useCallback((rowId) => {
    setSelected(rowId)
    if (narrow) setNarrowView('inspector')
  }, [narrow])

  /**
   * ↑ / ↓ / Home / End across the whole structure, panes included.
   *
   * ⛔ ACCESSIBILITY IS NOT THE PRICE OF MINIMALISM. The rows lost their per-row
   * gear, ✕ and chevron; they did not lose keyboard reach. The list is a
   * `listbox` of `option`s with a roving tabindex, so one Tab stop reaches it and
   * the arrows walk it — and because the Inspector is driven by `selected`, moving
   * the selection IS opening the editor.
   */
  const onStructureKeys = useCallback((e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const ids = flatRows.map((r) => r.id)
    if (!ids.length) return
    let next = null
    if (step) {
      const at = ids.indexOf(selected)
      next = at < 0
        ? ids[step > 0 ? 0 : ids.length - 1]
        : ids[Math.min(ids.length - 1, Math.max(0, at + step))]
    } else if (e.key === 'Home') next = ids[0]
    else if (e.key === 'End') next = ids[ids.length - 1]
    if (next == null) return
    e.preventDefault()
    setSelected(next)
    try {
      listRef.current?.querySelector(`[data-row-id="${CSS.escape(next)}"]`)?.focus()
    } catch { /* jsdom has no CSS.escape; the selection still moved */ }
  }, [flatRows, selected])

  const renderStructureRow = (row, group) => {
    const meta = paneRowMeta(row, group, settings, defOf)
    const on = rowVisible(row)
    const isSel = selected === row.id
    const tint = rowColor(row)
    return (
      <div
        key={row.id}
        role="option"
        aria-selected={isSel}
        tabIndex={isSel ? 0 : -1}
        data-row-id={row.id}
        data-def-id={row.defId || (row.path?.kind === 'indicator' ? row.id : undefined)}
        data-structure-row="true"
        data-landed={landed === row.id ? 'true' : undefined}
        className={`${styles.insRow} ${isSel ? styles.insRowSel : ''} ${on ? '' : styles.insRowOff} ${landed === row.id ? styles.insRowLanded : ''}`}
        onClick={() => selectRow(row.id)}
      >
        {/* ⭐⭐ THE MICRO-RAIL, TO LEGEND V2'S EXACT SPEC — 2×10px, 1px radius,
            `flex: none`, nudged half a pixel onto the text's x-height. Not a
            swatch (retired: reads as a bullet), not a chevron (retired), not a
            line sample. `aria-hidden` and no handler of its own: the ROW is the
            target, so pointing at the rail already points at the row. */}
        <i
          className={styles.insRail}
          style={tint ? { background: tint } : undefined}
          aria-hidden="true"
        />
        {/* ⚠️⚠️ THE FULL NAME IS ON THE ROW, because the column truncates now. At
            35% `Relative Strength Index (period 14)` ellipsizes — which is
            explicitly acceptable — but the member must still be able to find out
            what it says without selecting it. `title` is this panel's existing
            convention for exactly that, and the canonical name is untouched:
            nothing is abbreviated, persisted or renamed. */}
        <span className={styles.insRowName} title={meta.name}>{meta.name}</span>
        {/* ⭐ THE VISIBILITY STATE, AS ONE DIMMED WORD. A switch on every row is
            the toolbar the brief rules out; the row is dimmed AND says why, so a
            member scanning the column sees which lines are off without hovering
            anything, and a screen reader is told rather than shown. */}
        {!on && <span className={styles.insRowOffTag}>Off</span>}
        {orderable(group) && (
          /* ⭐⭐ WHERE THIS SERIES SITS **IN THIS PANE** — and nothing else. Two
             quiet arrows at the row's far right, after the name's flexible space,
             so a long label truncates into them rather than pushing them onto a
             second line.

             ⛔ THEY ARE NOT BOXES AND THEY ARE NOT A DISCLOSURE. The retired
             chevron taught this panel that a control on a row reads as "open me"
             the moment it wears a border; these carry a glyph, a hit area and no
             chrome until the pointer or the keyboard reaches them. A chevron
             here would also re-open the argument the row itself settled: the ROW
             is what selects, and it still is — see the `stopPropagation` below.

             ⛔ A BOUNDARY ARROW IS DISABLED, NOT REMOVED. Taking it out would
             shorten the row by 18px on the first and last member of every pane
             and make the whole column ripple as rows move, which is the one
             thing a reorder control must not do to the list it is reordering. */
          <span className={styles.insRowOrder} data-row-order="true">
            {[[-1, 'up', '↑', 'first'], [1, 'down', '↓', 'last']].map(([delta, word, glyph, edge]) => {
              const live = canNudgeRow(group, row.id, delta)
              const why = `${meta.name} is already ${edge} in ${group.name}`
              return (
                <button
                  key={word}
                  type="button"
                  className={styles.insRowArrow}
                  data-move={word}
                  /* ⛔⛔ `aria-disabled`, NOT THE NATIVE `disabled`, AND THE
                     DIFFERENCE IS THE REASON. A natively disabled button fires no
                     pointer events, so its `title` never appears — the member
                     gets a dimmed glyph and no sentence. It also drops out of the
                     tab order, so a keyboard member arrowing down the column
                     loses the control mid-list and finds it again two rows later.
                     ⚠️ AND IT KEEPS THIS OUT OF A RAIL IT WOULD FALSIFY.
                     `ChartSettingsModal.indicators.test.jsx` sweeps every
                     NATIVELY disabled control and demands a capability reason on
                     each; that rail is about a control the CHART cannot honour
                     (`NOT_WIRED`), and a top row's ↑ is not that — it is a
                     position, it changes as the member reorders, and answering it
                     with the same machinery would blur what the rail measures.
                     The reason is still carried, in the two places that reach
                     both kinds of member. */
                  aria-disabled={live ? undefined : 'true'}
                  aria-label={live ? `Move ${meta.name} ${word}` : why}
                  title={live ? `Move ${meta.name} ${word}` : why}
                  /* ⛔ THE ROW IS STILL THE SELECTOR, SO THE ARROW MUST NOT BE.
                     Without this a press would reorder the series AND select it,
                     and the Inspector would swing to a row the member was only
                     repositioning. `onMouseDown` is stopped too: the row's own
                     handler is a click, but a focus shift on mousedown is what
                     scrolls a long list under the pointer mid-press. */
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); if (live) nudgeRow(group, row.id, delta) }}
                >{glyph}</button>
              )
            })}
          </span>
        )}
      </div>
    )
  }

  const renderStructureGroup = (group, ref) => (
    <div
      key={group.id}
      ref={ref || undefined}
      role="group"
      aria-label={group.name}
      className={`${styles.insGroup} ${(group.kind === 'orphans' || group.kind === 'hidden') ? styles.insGroupRepair : ''}`}
      data-pane-group={group.id}
      data-pane-kind={group.kind}
    >
      <div className={styles.insGroupHead}>{group.name}</div>
      {/* ⛔⛔ THE TWO GROUPS THAT ARE NOT PANES OWE A SENTENCE, and they are the one
          exception to a structure list that otherwise says nothing but names.
          Every other heading names a rectangle on the chart; these two name a
          REASON a row is not drawing, and a member looking at `Needs attention`
          with no explanation has been told there is a problem and not what it is.
          ⚰️ AND THEY ARE TWO DIFFERENT SENTENCES, which is a defect the harness
          caught once already: a hidden row is SWITCHED OFF and the fix is its own
          toggle; an orphan's pane is GONE and the fix is a new destination. Saying
          "no longer on the chart" over a row the member deliberately switched off
          told them something was broken one second after they broke nothing. */}
      {group.kind === 'orphans' && (
        <p className={styles.insGroupWhy}>
          The pane these were drawn in is no longer on the chart. They have kept
          their settings — give each one a new place to draw.
        </p>
      )}
      {group.kind === 'hidden' && (
        <p className={styles.insGroupWhy}>
          Switched off, so they have no pane right now. Turn one back on and its
          pane comes back with it.
        </p>
      )}
      {group.rows.map((r) => renderStructureRow(r, group))}
    </div>
  )

  // ─── ARRANGE — AN EXPLICIT MODE, NOT A PERMANENT TOOLBAR ───────────────────
  //
  // ⚰️⚰️ THE ARROWS USED TO REST VISIBLE ON EVERY PANE HEADING, and that was the
  // right answer for a panel whose headings were already chrome-bearing bands. In
  // a calm structure list, twelve buttons over six panes is exactly the "managing
  // machinery" this redesign exists to remove — so the affordance moves behind a
  // member's explicit request rather than being hidden again (the discoverability
  // defect of 2026-09-16, which is why they were made rest-visible in the first
  // place). `Arrange` is a labelled word in the heading: nothing has to be found
  // by accident, and nothing is on screen until it is asked for.
  //
  // ⛔ SAME WRITERS, UNCHANGED. Drag and Move up / Move down both end at
  // `movePane` / `movePaneTo`, so the two paths cannot produce different stored
  // states, and `paneOrder` is the only thing either of them writes.
  const renderArrangeGroup = (group, at) => {
    const movable = arrangeableIds.has(group.id)
    return (
      <div
        key={group.id}
        className={`${styles.insArrGroup} ${dropBefore === group.id ? styles.insDropBefore : ''} ${dragging === group.id ? styles.insDragging : ''}`}
        data-pane-group={group.id}
        data-pane-kind={group.kind}
        data-arrange-index={at}
        /* ⭐ THE WHOLE BAND IS THE HANDLE. Dragging a pane is a statement about the
           pane, and `draggable` is set only on one that can actually move, so a
           repair list never starts a drag. */
        draggable={movable || undefined}
        onDragStart={movable ? (e) => {
          dragKeyRef.current = group.id
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id) } catch { /* jsdom */ }
          setDragging(group.id)
        } : undefined}
        onDragEnd={() => { dragKeyRef.current = null; setDragging(null); setDropBefore(null) }}
        onDragOver={movable ? (e) => {
          if (!dragKeyRef.current || dragKeyRef.current === group.id) return
          e.preventDefault()
          try { e.dataTransfer.dropEffect = 'move' } catch { /* jsdom */ }
          setDropBefore(group.id)
        } : undefined}
        onDrop={movable ? (e) => {
          e.preventDefault()
          const from = dragKeyRef.current
          dragKeyRef.current = null; setDragging(null); setDropBefore(null)
          if (from && from !== group.id) dropOn(from, group.id)
        } : undefined}
      >
        <div className={styles.insArrHead}>
          {movable && <span className={styles.insGrip} aria-hidden="true">⠿</span>}
          <span className={styles.insArrName}>{group.name}</span>
          {movable && (
            <span className={styles.insArrMove}>
              {[[-1, 'up', 'top'], [1, 'down', 'bottom']].map(([d, word, edge]) => {
                const off = !canMove(group.id, d)
                // ⚰️ A DISABLED CONTROL OWES A REASON, TO A SCREEN READER TOO —
                // the same four attributes plus an `sr-only` span every other
                // inert control on this tab carries, rather than a second
                // convention.
                const why = off ? `Already at the ${edge} of the chart` : null
                const whyId = off ? `ins-move-why-${group.id}-${word}` : undefined
                return (
                  <span key={word}>
                    <button
                      type="button" className={styles.insArrBtn}
                      aria-label={`Move ${group.name} pane ${word}`}
                      title={why || `Move pane ${word}`}
                      disabled={off}
                      {...(off ? { 'aria-disabled': 'true', 'aria-describedby': whyId } : {})}
                      onClick={() => nudge(group.id, d)}
                    >{d < 0 ? '↑' : '↓'}</button>
                    {off && <span id={whyId} className="sr-only">{why}</span>}
                  </span>
                )
              })}
            </span>
          )}
        </div>
        {/* ⛔⛔ THE GUESTS ARE SHOWN AND ARE NOT DRAGGABLE. A pane moves; a series
            does not. Listing what travels with the host is what makes the move
            predictable — and making those names inert is what stops a member
            trying to drag `EMA 20` out of `QQQ` and discovering that pane
            arrangement has quietly become placement. Placement is the Inspector's
            DISPLAY control, one screen away, and it writes a different key. */}
        <div className={styles.insArrRows}>
          {group.rows.map((r) => {
            const meta = paneRowMeta(r, group, settings, defOf)
            return <span key={r.id} className={styles.insArrRow}>{meta.name}</span>
          })}
        </div>
      </div>
    )
  }

  // ─── THE RIGHT COLUMN — "EDIT THE THING I SELECTED" ────────────────────────
  //
  // ⭐⭐ THE CONTROLS ARE THE SAME CONTROLS AND THE WRITERS ARE THE SAME WRITERS.
  // Every field below comes out of `row.fields` — the definition's own declared
  // inputs through `fieldFromInput` — and every write goes through `onRowPatch`,
  // `setInstanceDisplayTarget` or `setInstancePlotStyle`. What changed is WHERE
  // the form appears and HOW it is grouped; a rail pinning "this select writes
  // `setInstanceDisplayTarget`" pins the same select it always did.
  //
  // ⛔ NOTHING IS MANUFACTURED. A definition that declares no source gets no
  // SOURCE row; one with a single place to draw gets no DISPLAY row
  // (`displayTargetOptions` answering empty is that test); one with no
  // restyleable plot gets no plot-style row. The Inspector renders the schema; it
  // does not have an opinion about what an indicator ought to have.

  /**
   * CORE or APPEARANCE — DERIVED, never a list of key names in this file.
   *
   * ⭐⭐ `styleInputKeys` READS `plots[].$refs`, which is by construction the set of
   * inputs that reach the RENDERER as style. So an engine definition sorts itself,
   * and one that renames or adds a styled input sorts itself too, with no edit
   * here. The two fixture field arrays have no `$refs` and say so with an explicit
   * `appearance: true` at their own declaration site — see `MA_FIELDS`.
   *
   * ⚠️ A COLOUR IS ALWAYS APPEARANCE, as the backstop for a definition whose
   * colour input is not `$ref`-ed into any plot. There is no case where a colour
   * control belongs above Period.
   */
  const partitionFields = useCallback((row, def) => {
    const styleKeys = def ? styleInputKeys(def) : null
    const isLook = (f) => f.appearance === true
      || f.type === 'color'
      || !!(styleKeys && styleKeys.has(f.key))
    const shown = (row.fields || []).filter((f) => !(f.showIf && !f.showIf(row.values)))

    // ⚰️⚰️ AN INERT FIELD IS NEVER A CORE FIELD, and that is what finally made
    // the two moving averages read as one product. CORE answers *what does this
    // compute* — the things a member can actually change. A legacy overlay
    // declares `offset` and `plotStyle` with `disabled: NOT_WIRED`: they are
    // placeholders for capabilities the renderer does not have, and one of them
    // (`offset`) sat in the middle of CORE, so EMA 9's primary block read
    // `Type / Period / Offset` while the engine MA's read `Source / Period /
    // Type / Display`. Two different editors, for one concept.
    //
    // ⛔ NOT DELETED — DEMOTED. They still render, still disabled, still carrying
    // their reason to a screen reader, at the END of Appearance where an
    // unavailable option belongs. Removing them would be a functional change made
    // for a visual reason, and the owner asked for an audit rather than a cull.
    const inert = shown.filter((f) => !!f.disabled)
    const live = shown.filter((f) => !f.disabled)
    const core = live.filter((f) => !isLook(f))
    const look = [...live.filter(isLook), ...inert]

    // ⭐⭐ AND THE ONE MEMBER CONCEPT GETS ONE ORDER. Declaration order is the
    // definition author's, which is right for everything else and wrong here: the
    // two MA implementations declare their inputs in different orders, so the same
    // four controls came out as `Type, Period` on one and `Source, Period, Type` on
    // the other. The order below is the member's reading order — what it reads,
    // how long, which kind, where it draws — and it is applied only to rows that
    // DECLARE themselves that concept.
    if (row.memberConcept === 'movingAverage') {
      const rank = { source: 0, period: 1, type: 2, maType: 2 }
      core.sort((a, b) => (rank[a.key] ?? 9) - (rank[b.key] ?? 9))
    }
    return { core, look }
  }, [])

  /**
   * The two CORE facts a LEGACY moving average has but cannot be asked.
   *
   * ⚰⚰ THE SPLIT THIS CLOSES. `cs.overlays` has no `source` and no placement:
   * the renderer averages the CLOSE and draws on the PRICE pane, full stop. So the
   * legacy editor simply had no Source and no Display row, while the engine MA had
   * both — and a member comparing EMA 9 with the average beside it saw two
   * unrelated forms. The facts are true of a legacy overlay; only the telling was
   * missing.
   *
   * ⛔⛔ READ-ONLY, AND NOT A DISABLED SELECT. A greyed dropdown says "there are
   * other choices you may not have"; there are none. These are VALUES — the same
   * shape the Color swatch is — and they say what this average reads and where it
   * draws, which is exactly what the engine MA's two controls report.
   *
   * ⛔ AND NOTHING HERE IS INVENTED. The source comes from `paneRowMeta`, which
   * already declares `Close` for an overlay row and has since the read model was
   * written; the destination comes from the pane group `chartDataMap` actually
   * filed the row under. No new authority, no stored value, no migration — making
   * either of them editable would need renderer and persistence work, which is the
   * line this pass does not cross.
   */
  const readOnlyCore = useCallback((row, group, sourceWords) => {
    if (row.memberConcept !== 'movingAverage') return []
    const out = []
    const hasSource = (row.fields || []).some((f) => f.type === 'source')
    if (!hasSource && sourceWords) {
      out.push({ key: '__source__', label: 'Source', value: sourceWords,
        why: 'A moving average added before sources existed always averages the close.' })
    }
    // ⚠️ A REAL PANE, NOT A REPAIR LIST. `chartDataMap` files a switched-off row
    // under "Not shown" and a stranded one under "Needs attention"; neither is a
    // DESTINATION, and printing one as this average's Display would be the panel
    // stating a place the chart does not draw. A legacy overlay always draws on
    // price, so the honest answer is withheld rather than guessed when the row is
    // not currently in a pane.
    const inRealPane = group && ['price', 'volume', 'pane'].includes(group.kind)
    if (!row.engineOwned && inRealPane && group.name) {
      out.push({ key: '__where__', label: 'Display', value: group.name,
        why: 'A moving average added before display destinations existed always draws on the price pane.' })
    }
    return out
  }, [])

  /**
   * The Inspector header's SECOND line — what KIND of thing this is.
   *
   * ⛔⛔ AND IT IS NOT `def.meta.name` FOR EVERY ROW, because for exactly one
   * definition that string is the substrate. `dataSeries` is named **Data
   * Series**, and printing that under `QQQ` re-exposes the abstraction the whole
   * consolidation exists to retire (owner §8: a member must never have to know
   * what a Data Series is). `meta.labelFrom === 'source'` is that definition's own
   * declaration that its identity comes from what it was pointed at, so the kind
   * comes from the SOURCE instead — via `symbolFamily`, the same provider-family
   * authority the binder and the capability gate already ask.
   *
   * ⚠️ `unknown` MEANS THE BREADTH REGISTRY HAS NOT LANDED, and the honest answer
   * to that is SILENCE. A subtitle is a nicety; a WRONG subtitle reading "Market
   * data" over a breadth measure is worse than none, and the line reappears on the
   * next render once the registry resolves.
   */
  const kindLabel = useCallback((row, def, rawSource) => {
    if (row?.path?.kind === 'overlay') return 'Moving Average'
    if (row?.path?.kind === 'section' && row.path.key === 'volume') return 'Volume'
    if (!def || !def.meta) return null
    if (def.meta.labelFrom === 'source') {
      const parsed = rawSource ? parseSource(rawSource) : null
      if (!parsed || parsed.kind !== 'symbol' || !parsed.symbol) return null
      const fam = symbolFamily(parsed.symbol)
      if (fam === 'breadth') return BREADTH_CATEGORY
      if (fam === 'security') return 'Market data'
      return null
    }
    return def.meta.name || null
  }, [])

  /**
   * Duplicate — the SAME verb the legend's own popover offers, and the same write.
   *
   * ⛔ `addInstance(defId)` IS WHAT "DUPLICATE" HAS ALWAYS MEANT HERE
   * (`StockChart.handleChipDuplicate`): a second instance of this indicator with
   * the definition's defaults, not a byte copy of this one's inputs. Two doors,
   * one behaviour — inventing a deep-copy variant on this surface would make the
   * legend's Duplicate and the Inspector's Duplicate two different features
   * wearing one word.
   *
   * ⛔ NULL WHEN IT CANNOT ACT, so the button is ABSENT rather than inert. The
   * volume pane is one pane; there is no second one to make.
   */
  const duplicateWriter = useCallback((row) => {
    if (row?.engineOwned && row.instanceId && row.defId) {
      return () => addInstance(settings, row.defId, registry)
    }
    if (row?.path?.kind === 'overlay') {
      const lib = BUILT_IN_ROWS.find((r) => r.id === 'ma')
      return lib ? () => toggledRow(lib, settings, registry) : null
    }
    return null
  }, [settings, registry])

  /** A CORE fact that is true and not editable — see `readOnlyCore`. */
  const renderReadOnly = (f) => (
    <div key={f.key} className={styles.insField} data-field={f.key} data-readonly="true"
      data-measure="wide" title={f.why}>
      <span className={styles.insFieldLabel}>{f.label}</span>
      <span className={styles.insFieldCtl}>
        {/* ⛔ NOT A CONTROL, AND IT MUST NOT LOOK LIKE ONE. No border, no chevron,
            no focus ring — a member who clicks it should find nothing happens and
            not feel the panel is broken. `aria-readonly` says the same thing to a
            screen reader, and the `title` carries the one-line reason. */}
        <span className={styles.insFieldValue} aria-readonly="true">{f.value}</span>
      </span>
    </div>
  )

  /**
   * HOW MUCH ROOM DOES THIS CONTROL'S VALUE ACTUALLY NEED?
   *
   * ⚰️⚰️ EVERY CONTROL USED TO TAKE THE WHOLE CELL. `.insFieldCtl > select` and
   * `> input` were `width: 100%`, which was the right first answer — one rule, one
   * right edge, nothing hand-tuned — and it made `Period` a 275px box holding the
   * characters `200`, and `SMA`/`EMA` a 275px dropdown over two three-letter
   * words. Owner, 2026-09-17: *"controls such as Period, Type, Line Style, Line
   * Width, Offset are unnecessarily stretched across most of the editor width."*
   *
   * ⛔ THE ANSWER IS CONTENT, NOT A KEY NAME. Sizing by `f.key` would be a table
   * of special cases that goes stale the moment a definition declares a new input;
   * this reads what the control actually holds, so a definition nobody has written
   * yet is sized correctly on its first render.
   *
   *   `compact`  a number, or an enum whose labels are TOKENS rather than words —
   *              `1px`, `2px`, `SMA`, `Off`. Four characters is the line: past it
   *              a label is a word (`Dashed`, `Solid`) and a 100px box starts
   *              clipping the chevron off the end of it.
   *   `medium`   an enum with real words in it (`Dashed`, `Histogram`)
   *   `wide`     a SEMANTIC IDENTITY — a source or a destination. These are the
   *              controls the owner explicitly protected: `QQQ · Close`,
   *              `Automatic · Price`, `RSI (14)`, another pane's name. Solving
   *              oversized controls by truncating these would trade one defect for
   *              a worse one.
   *   `bare`     a swatch or a switch — it has its own size and never took the
   *              cell in the first place.
   */
  const measureOf = useCallback((f) => {
    if (!f) return 'wide'
    if (f.type === 'color' || f.type === 'toggle') return 'bare'
    if (f.type === 'source') return 'wide'
    if (f.type === 'number') return 'compact'
    if (f.type === 'select') {
      const longest = (f.options || []).reduce((n, o) => Math.max(n, String(o?.[1] ?? '').length), 0)
      return longest <= 4 ? 'compact' : 'medium'
    }
    return 'wide'
  }, [])

  /**
   * TWO CHOICES ARE A SEGMENT, NOT A DROPDOWN.
   *
   * ⛔ DECLARED BY THE DATA, not by `f.key === 'maType'`. A two-option enum whose
   * labels are short IS a segmented control — that is what a segmented control is
   * for — and stating the rule this way means `MA_TYPES` (`SMA` / `EMA`) picks it
   * up without being named, while `barStyle` (`Columns` / `Histogram`) correctly
   * does not.
   */
  const isSegment = (f) => f && f.type === 'select'
    && Array.isArray(f.options) && f.options.length === 2
    && f.options.every((o) => String(o?.[1] ?? '').length <= 5)

  // ⚰️⚰️ `packFields` / `renderPacked` STOOD HERE AND ARE RETIRED. They paired
  // adjacent non-`wide` controls onto one line — `Period [20]   Type [SMA|EMA]` —
  // which closed the dead space the compact widths opened up and produced the
  // arrangement that pass was asked for.
  //
  // ⛔ THE OWNER TRIED IT AND PREFERRED THE SINGLE FILE (2026-09-17): *"Keep the
  // selected indicator editor in a SINGLE-FILE VERTICAL PROPERTY LIST. Do NOT
  // return to the recent paired layout."* A property list is read DOWN — one
  // label column, one control column, one row per setting — and pairing made the
  // eye travel in an S. The compact widths are what the pass was really for and
  // they stay; what goes is the second column.
  //
  // ⭐ SO EVERY ROW IS FULL-WIDTH AND EVERY CONTROL IS NOT. That is the whole
  // design: labels share one column, controls start at one x, and each control is
  // as wide as its value needs — see `measureOf` and the `data-measure` rules.
  // Whitespace AFTER a correctly sized control is fine; whitespace INSIDE a giant
  // input holding `20` is what this is not.

  const renderField = (row, f) => {
    const val = row.values?.[f.key]
    const dis = !!f.disabled
    // The reason has to reach a screen reader, not just a pointer — the rule this
    // tab already followed, kept verbatim.
    const whyId = dis ? `ind-why-${row.id}-${f.key}` : undefined
    const inert = dis
      ? { disabled: true, 'aria-disabled': 'true', title: f.disabled, 'aria-describedby': whyId }
      : {}
    const seg = isSegment(f)
    return (
      <div
        key={f.key}
        className={styles.insField}
        data-field={f.key}
        data-measure={seg ? 'segment' : measureOf(f)}
        title={f.disabled || undefined}
      >
        <span className={`${styles.insFieldLabel} ${dis ? styles.indLabelOff : ''}`}>{f.label}</span>
        {dis && <span id={whyId} className="sr-only">{f.disabled}</span>}
        <span className={styles.insFieldCtl}>
          {f.type === 'color' && colorSwatch(indTarget(row.id, f.key), f.label, val)}
          {f.type === 'toggle' && (
            <button
              type="button" role="switch" aria-checked={val !== false} aria-label={f.label}
              {...inert}
              className={`${styles.toggle} ${val !== false ? styles.toggleOn : ''} ${dis ? styles.toggleOff : ''}`}
              onClick={() => onRowPatch?.(row, { [f.key]: val === false })}
            ><span className={styles.toggleKnob} /></button>
          )}
          {f.type === 'number' && (
            <input
              type="number" className={styles.indNum} {...inert}
              min={f.min} max={f.max} step={f.step} value={val ?? ''}
              onChange={(e) => onRowPatch?.(row, { [f.key]: Number(e.target.value) })}
            />
          )}
          {/* ⭐⭐ THE SOURCE CONTROL — the instrument this row plots. A `source`
              input is the only one whose choices depend on the chart rather than
              on the definition, so the widget builds its own list from live
              settings. Imported, never re-implemented: the Inspector and the
              source picker have to agree about what `QQQ` matches. */}
          {f.type === 'source' && (
            <SourceField
              row={row} field={f} value={val} settings={settings}
              registry={registry} inert={inert} styles={styles}
              onPick={(next) => onRowPatch?.(row, { [f.key]: next })}
            />
          )}
          {/* ⭐⭐ A TWO-CHOICE ENUM IS A SEGMENT. ⛔ NOT A DROPDOWN: a native select
              over `SMA` / `EMA` costs two clicks, opens an operating-system menu
              in the middle of a dark premium panel, and spends 275px saying
              nothing until it is opened. The segment says both answers at rest
              and switches in one click.
              ⛔ AND IT WRITES THE IDENTICAL VALUE. Same `onRowPatch`, same option
              tuple, same canonical field — this is a control swap and nothing
              else; `MA_TYPES` and the two persistence paths under it are
              untouched. */}
          {f.type === 'select' && seg && (
            <span
              className={styles.insSeg}
              role="radiogroup"
              aria-label={f.label}
              {...(dis ? { 'aria-disabled': 'true', 'aria-describedby': whyId } : {})}
              /* ⭐ ARROW KEYS MOVE THE CHOICE, which is what a radio group is
                 defined to do and what a member reaches for after tabbing to it.
                 Home/End are the same two answers here, so they are not bound. */
              onKeyDown={(e) => {
                if (dis) return
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'
                  && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                const at = f.options.findIndex(([v]) => String(v) === String(val))
                const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
                const to = f.options[(Math.max(at, 0) + step + f.options.length) % f.options.length]
                if (to) onRowPatch?.(row, { [f.key]: to[0] })
              }}
            >
              {f.options.map(([v, l]) => {
                const picked = String(v) === String(val)
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    /* ⛔ ROVING TABINDEX. A radio group is ONE tab stop — landing
                       on every option in turn is how a two-choice control becomes
                       two controls for a keyboard member. */
                    tabIndex={picked ? 0 : -1}
                    disabled={dis}
                    {...(dis ? { 'aria-disabled': 'true', title: f.disabled } : {})}
                    className={`${styles.insSegBtn} ${picked ? styles.insSegBtnOn : ''}`}
                    onClick={() => onRowPatch?.(row, { [f.key]: v })}
                  >{l}</button>
                )
              })}
            </span>
          )}
          {f.type === 'select' && !seg && (
            <select
              className={styles.indSelect} {...inert} value={val ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                const opt = f.options.find(([v]) => String(v) === raw)
                onRowPatch?.(row, { [f.key]: opt ? opt[0] : raw })
              }}
            >
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </span>
      </div>
    )
  }

  const renderInspector = (row) => {
    const group = groupOfRow(row.id)
    const def = row.defId ? (registry?.getDefinition?.(row.defId) || null) : null
    const meta = paneRowMeta(row, group, settings, defOf)
    const kind = kindLabel(row, def, rawSourceOf(row, def))
    const on = rowVisible(row)
    const { core, look } = partitionFields(row, def)
    const readOnly = readOnlyCore(row, group, meta.source)
    const display = displayInControl(row)
    const plotStyle = styleControl(row)
    const duplicate = duplicateWriter(row)
    const tint = rowColor(row)

    return (
      <div className={styles.insPanel} id={inspectorDomId(row.id)} data-inspector-for={row.id}>
        {/* ─── HEADER: what this is, and whether it is drawing ──────────── */}
        <div className={styles.insHead}>
          {narrow && (
            <button
              type="button"
              className={styles.insBack}
              onClick={() => setNarrowView('list')}
              aria-label="Back to the chart structure"
            >←</button>
          )}
          <i className={styles.insHeadRail} style={tint ? { background: tint } : undefined} aria-hidden="true" />
          <span className={styles.insHeadText}>
            <span className={styles.insHeadName}>{meta.name}</span>
            {/* ⛔ ONLY WHEN IT ADDS SOMETHING. `RSI 14` over `Relative Strength
                Index` explains the abbreviation; `Volume` over `Volume` is
                furniture, so the line is simply absent when the two agree. */}
            {kind && kind.toLowerCase() !== meta.name.trim().toLowerCase() && (
              <span className={styles.insHeadKind}>{kind}</span>
            )}
          </span>
          <button
            type="button" role="switch" aria-checked={on}
            aria-label={`Toggle ${meta.name}`}
            className={`${styles.insOnOff} ${on ? styles.insOnOffOn : ''}`}
            onClick={() => setRowVisible(row, !on)}
          >
            <span className={styles.insOnDot} aria-hidden="true" />
            {on ? 'On' : 'Off'}
          </button>
        </div>

        {/* ─── CORE ─────────────────────────────────────────────────────── */}
        {(core.length > 0 || display || readOnly.length > 0) && (
          <section className={styles.insSection} data-section="core">
            <div className={styles.insSectionLabel}>Core</div>
            {readOnly.filter((f) => f.key === '__source__').map(renderReadOnly)}
            {core.map((f) => renderField(row, f))}
            {display}
            {readOnly.filter((f) => f.key !== '__source__').map(renderReadOnly)}
          </section>
        )}

        {/* ─── APPEARANCE ───────────────────────────────────────────────── */}
        {(look.length > 0 || (plotStyle && plotStyle.length > 0)) && (
          <section className={styles.insSection} data-section="appearance">
            <div className={styles.insSectionLabel}>Appearance</div>
            {look.map((f) => renderField(row, f))}
            {plotStyle}
          </section>
        )}

        {/* ─── ACTIONS ──────────────────────────────────────────────────────
            ⭐ THE ROWS LOST THEIR ✕ AND THE INSPECTOR GAINED IT. One verb, one
            control, one level in — a dense structure list is exactly where a
            mis-click deletes a configured indicator, and the Inspector is a place
            a member arrived at deliberately. `removeRow` itself is unchanged: a
            fixture is TOMBSTONED (slot kept, nothing shifts, settings preserved)
            and an instance goes through `removeInstance`. */}
        <div className={styles.insActions}>
          {duplicate && (
            <button
              type="button"
              className={styles.insAction}
              onClick={() => {
                const next = duplicate()
                // Identity, not deep equality — a REFUSED write returns `settings`
                // itself, and persisting a no-op would mark the preset custom for
                // a click that did nothing.
                if (next !== settings) onChange?.({ ...next, preset: 'custom' })
              }}
            >Duplicate</button>
          )}
          <button
            type="button"
            className={`${styles.insAction} ${styles.insActionDanger}`}
            aria-label={`Remove ${meta.name}`}
            onClick={() => removeRow(row)}
          >Remove</button>
        </div>
      </div>
    )
  }

  // ⚰️⚰️ `renderInspectorEmpty` STOOD HERE AND IS DELETED. It has been three
  // things in three passes: a lede and a count, then a full inventory of the
  // chart's series, then a mark with two doors. Each replaced a real defect in the
  // one before it, and the third was tested and judged unnecessary — owner,
  // 2026-09-17: *"it creates an extra conceptual state and wastes a click."*
  //
  // ⭐ THE ANSWER WAS THAT THE STATE SHOULD NOT EXIST. A member opening Indicators
  // with nothing selected is looking for something; the surface for that already
  // exists and is three lines below. `discovering` renders it directly, and the
  // right side now has exactly two states — DISCOVER and EDIT.

  /**
   * ARRANGE's right-hand side — deliberately almost nothing.
   *
   * ⭐ THE SIMPLEST TREATMENT THAT LOOKS INTENTIONAL. The left column is doing the
   * work in this mode, so the right states the rule and gets out of the way.
   * Keeping the Inspector live here would offer edits to a row the member is not
   * currently looking at, and mounting a second arrangement UI would be two ways
   * to do one thing.
   */
  const renderArrangeAside = () => (
    <div className={styles.insEmpty} data-testid="arrange-aside">
      <div className={styles.insEmptyLede}>Drag a pane to restack the chart.</div>
      <div className={styles.insEmptyNote}>
        Everything drawn inside a pane travels with it. To move a single series to
        a different pane, leave Arrange and use its Display setting.
      </div>
    </div>
  )

  /**
   * The DISPLAY-IN control — WHERE this instance draws.
   *
   * ⭐⭐ THE SAME STATE THE COLLAPSED SUMMARY REPORTS, seen from the other side.
   * `placementSummary` reads `resolveDisplayTarget` + `displayTargetOptions`;
   * this writes through `setInstanceDisplayTarget` and offers exactly what that
   * same `displayTargetOptions` returns. Two views of one value — there is no
   * summary-specific state and no editor-specific target vocabulary, so the two
   * cannot disagree about where a series is.
   *
   * ⛔ EVERY VALIDATION IS THE HELPER'S, NOT THIS FILE'S. It already refuses the
   * instance ITSELF (a series that named its own pane would be its own guest and
   * would vanish), skips tombstones, and offers only pane OWNERS — which is what
   * makes a placement cycle unconstructible through this menu. Re-checking any of
   * that here would be a second rule to keep in step.
   *
   * ⛔⛔ AND AN ORPHANED TARGET IS SHOWN, DISABLED — NEVER SILENTLY HEALED. When
   * the pane a series was sent to is deleted, the member's placement is PRESERVED
   * (a render must not mutate saved state), so the helper lists it first flagged
   * `missing` and this renders it as the selected, un-pickable current state. A
   * control that quietly displayed "Own pane" would tell the member their line is
   * fine while it draws nothing, and picking the value already shown would be a
   * no-op — which is exactly how the original defect hid.
   */
  const displayInControl = useCallback((row) => {
    if (!row || !row.instanceId || !row.engineOwned) return null
    const inst = findInstance(settings, row.instanceId)
    if (!inst) return null
    const defOf = (id) => registry?.getDefinition?.(id) || null
    // ⛔ THE SAME EMPTY-MEANS-NOTHING-TO-SAY TEST THE SUMMARY USES. A definition
    // with one place to draw gets no control, derived rather than hard-coded, so
    // the legacy overlays and the volume pane gain nothing from this phase.
    const options = displayTargetOptions(inst, settings, defOf)
    if (!options.length) return null

    const where = resolveDisplayTarget(inst, settings)

    // ─── AUTOMATIC IS A FIRST-CLASS CHOICE, AND IT IS NOT A STORED VALUE ──────
    //
    // ⭐⭐ THE PROVENANCE WAS ALWAYS THERE AND THE MEMBER COULD NOT SEE IT.
    // `targetExplicit` records whether a destination was CHOSEN or DERIVED, and
    // the old control rendered both states identically: an `MA(QQQ)` FOLLOWING
    // QQQ's pane and one explicitly PINNED to QQQ's pane read as the same
    // selection, so nothing on screen said which of them would travel when QQQ's
    // own placement changed.
    //
    // ⛔⛔ AND `Automatic` IS NOT A NEW TARGET VALUE. Nothing new is stored, no
    // sentinel reaches `placement.target`, and `displayTargetOptions` is unchanged
    // — encoding automatic as a fake destination is exactly what
    // `setInstanceDisplayTarget`'s own header refuses. The option's VALUE here is
    // a local sentinel that never leaves this function; picking it WRITES the
    // destination the resolver would have chosen anyway, which is the EXISTING
    // return-to-default gesture and is what makes the writer delete `target` AND
    // `targetExplicit` together.
    //
    // ⛔ THE LABEL COMES FROM `automaticTargetOf`, THE FUNCTION THE WRITER USES.
    // Deriving "where would this go" a second time here is how a menu starts
    // promising one pane while the write lands in another.
    //
    // ⚠️ WHEN THE MEMBER HAS **NOT** CHOSEN, the automatic destination IS where it
    // currently draws, and `where` is the truthful label even for a legacy blob
    // carrying a bare `target` with no marker. When they HAVE chosen, the question
    // the label answers is a different one — *where would it go if I let go?* —
    // and only `automaticTargetOf` can answer that.
    const explicit = hasExplicitTarget(inst)
    const autoTarget = explicit ? automaticTargetOf(settings, inst) : where
    const autoOpt = options.find((o) => o.value === autoTarget) || null
    const autoWord = autoOpt ? autoOpt.label
      : autoTarget === 'price' ? 'Price'
        : autoTarget === 'volume' ? 'Volume'
          : autoTarget === 'pane' ? 'Own pane' : null

    const current = explicit
      ? (options.some((o) => o.value === where) ? where : '')
      : AUTO_TARGET

    return (
      <div className={styles.insField} data-field="__display__" data-measure="wide" key="display-in">
        <span className={styles.insFieldLabel}>Display</span>
        <span className={styles.insFieldCtl}>
          <select
            className={styles.indSelect}
            value={current}
            aria-label={`${row.label} display in`}
            onChange={(e) => {
              const picked = e.target.value
              const target = picked === AUTO_TARGET ? autoTarget : picked
              if (!target) return
              const next = setInstanceDisplayTarget(settings, row.instanceId, target, registry)
              // ⛔ REFUSED BY IDENTITY. The writer returns the SAME object when it
              // will not act, so this is how a rejected write stays a no-op instead
              // of marking the settings dirty.
              if (next !== settings) onChange?.({ ...next, preset: 'custom' })
            }}
          >
            {/* ⛔ OFFERED ONLY WHEN THERE IS AN AUTOMATIC ANSWER TO OFFER. A
                definition whose derivation resolves nothing has no default to
                return to, and a row reading `Automatic · —` would be a choice
                that does nothing. */}
            {autoWord && (
              <option value={AUTO_TARGET}>{`Automatic · ${autoWord}`}</option>
            )}
            {options.map((o) => (
              <option
                key={o.value}
                value={o.value}
                disabled={o.missing === true}
              >
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    )
  }, [settings, registry, onChange])

  /**
   * The PLOT STYLE control — how this output draws, as opposed to what it reads.
   *
   * ⭐⭐ STYLE IS NOT AN INPUT, which is why it is not in `row.fields`. Inputs are
   * declared by the definition and identical on every chart; a style is a
   * per-INSTANCE presentation choice, written through `setInstancePlotStyle` —
   * the canonical writer — and stored beside the instance, never in its inputs.
   *
   * ⛔⛔ AND CANDLES ARE OFFERED ONLY WHEN THE SOURCE CAN MEAN THEM. Every other
   * style is a property of the OUTPUT — any column can be drawn as an area — and
   * this one is a property of what the output READS: four fields describing one
   * auction period. A dropdown that offered Candles over an RSI, a formula or a
   * breadth measure would be a dropdown that lies.
   *
   * ⭐ `anyCachedBars` IS THE WINDOW-AGNOSTIC READ: this tab knows the INSTRUMENT
   * and never the chart's timeframe, so asking for a specific (tf, bars) window
   * would make the offer flicker with the chart. `symbolFamily` is the same
   * provider-family authority the binder gates on, so the menu and the renderer
   * cannot disagree about what is capable.
   */
  const styleControl = useCallback((row) => {
    if (!row || !row.instanceId || !row.engineOwned) return null
    const def = registry?.getDefinition?.(row.defId)
    const inst = findInstance(settings, row.instanceId)
    if (!def || !inst) return null

    const ohlcCapable = ohlcCapableFor(def, inst)

    const target = resolveDisplayTarget(inst, settings)
    const styleCtx = { target, ohlcCapable }
    const plots = Array.isArray(def.plots) ? def.plots : []
    const restyleable = plots.filter((pl) => availableStyles(pl, styleCtx).length > 0)
    if (!restyleable.length) return null

    // ⭐ ONE OUTPUT ⇒ NO OUTPUT NAME. Printing "Value" above a single control,
    // inside a panel already titled `QQQ`, is furniture.
    const single = restyleable.length === 1

    return restyleable.map((plot) => {
      const style = resolvePlotStyle(inst, plot, styleCtx)
      const choices = availableStyles(plot, styleCtx)
      const label = single ? 'Plot style' : `${plot.label || plot.key} style`
      return (
        <div className={styles.insField} data-field={`__style__:${plot.key}`} data-measure="medium"
          key={`style-${plot.key}`}>
          <span className={styles.insFieldLabel}>{label}</span>
          <span className={styles.insFieldCtl}>
            <select
              className={styles.indSelect}
              value={style}
              aria-label={`${row.label} ${single ? 'plot style' : `${plot.key} plot style`}`}
              onChange={(e) => {
                const next = setInstancePlotStyle(
                  settings, row.instanceId, e.target.value, registry,
                  single ? undefined : plot.key,
                )
                if (next !== settings) onChange?.({ ...next, preset: 'custom' })
              }}
            >
              {PLOT_STYLE_CHOICES.filter((c) => choices.includes(c.value)).map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </span>
        </div>
      )
    })
  }, [settings, registry, onChange])

  // ─── ONE CATALOGUE RESULT ─────────────────────────────────────────────────
  const renderResult = (row) => {
    // ⛔⛔ A SYMBOL IS NEVER "ALREADY ON". `isRowOn` answers per DEFINITION, and a
    // symbol row's `id` is a ticker (`QQQ`), not a definition id — three QQQ series
    // on one chart is a legitimate thing a member may want (§32), and the row that
    // creates them must keep offering. A row carrying a `create` descriptor is
    // asked nothing; it simply adds.
    // ⭐ AND A RESTORE ROW IS AN ADD ROW TOO — see `discoveryCatalog.libraryRowFor`.
    const creates = symbolRows.byKey.has(row.key) || row.restores === true
    const on = creates ? false : isRowOn(row, settings)
    // ⛔ DISCOVERY IS NOT CHARTABILITY. The facade reports what the SERVER already
    // said — a delisted ticker, an index the bars route will not serve — and
    // `createFromResult` refuses those by identity. A row that looked live and did
    // nothing is worse than one that says why, so the reason is printed and the
    // click is not offered.
    const refused = row.capability === CAPABILITY.UNSUPPORTED
    const canAdd = !on && !refused
    return (
      <li
        key={row.key || row.id}
        role="option"
        aria-selected={on}
        aria-disabled={refused ? 'true' : undefined}
        data-def-id={row.id}
        /* ⭐ THE ANCHOR'S ADDRESS, and it is `row.key` rather than `row.id` because
           a ticker and a definition can collide on `id` while `key` is what React
           already trusts to keep these rows distinct. Matched by walking the list
           rather than with an attribute selector, so no value ever needs escaping. */
        data-result-key={row.key || row.id}
        data-result-kind={row.kind || undefined}
        data-user-defined={row.userDefined ? 'true' : 'false'}
        /* ⚠️ THE DESCRIPTION LIVES HERE NOW — see the note where its line used to
           be. `title` on the row rather than on the name, so the whole row is the
           hover target for it. */
        title={row.description || undefined}
        tabIndex={0}
        className={`${styles.resRow} ${on ? styles.resRowOn : ''} ${refused ? styles.resRefused : ''}`}
        onClick={() => { if (canAdd) addRow(row) }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && canAdd) { e.preventDefault(); addRow(row) }
        }}
      >
        {/* ⭐⭐ THE FAMILY MARK. ⛔ IT IS NOT A DECORATION AND IT IS NOT THE SERIES'
            COLOUR: the LEFT column's micro-rail says *this is the plotted line you
            already have, in its own colour*, and this says *this is the KIND of
            thing you are looking at*. Two visual languages, kept apart on purpose
            — blurring them would make a catalogue row look like a chart series.
            ⛔ `gold={false}` — `UIcon` paints gold by default and twenty gold marks
            down a list would spend the one accent this product reserves for "you
            are here" on furniture. `aria-hidden`: the row already says its name. */}
        <span className={styles.resGlyph} data-glyph={glyphFamilyOf(row)} aria-hidden="true">
          <UIcon name={glyphNameOf(row)} size={20} gold={false} strokeWidth={1.5} />
        </span>
        <span className={styles.resMain}>
          <span className={styles.resTitleRow}>
            <span className={styles.resName}>{row.name}</span>
            <span className={styles.resShort}>{row.shortName}</span>
            {row.userDefined && <span className={styles.resMine}>Your formula</span>}
            {row.sessionOnly && <span className={styles.resPill}>Intraday only</span>}
            {/* The LINTER's measurement, per plot — never the definition's own
                declared claim. Same read the library row makes. */}
            {row.measuredRepaint && row.measuredRepaint !== CLEAN && (
              <span
                className={styles.resRepaint}
                data-repaint={row.measuredRepaint}
                title={(row.repaintingPlots || []).map((n) => `${n.label} — ${n.sentence}`).join(' ')}
              >{String(row.measuredRepaint).charAt(0).toUpperCase() + String(row.measuredRepaint).slice(1)}</span>
            )}
            {/* Tier only when it is NOT free, and NEVER on the member's own
                formula — "Premium" beside "Your formula" reads as "you cannot use
                this" about a thing they wrote. Entitlement logic is untouched;
                this is the same badge the library renders. */}
            {row.tier && row.tier !== 'free' && !row.userDefined && (
              <span className={styles.resTier}>{row.tier}</span>
            )}
          </span>
          {/* ⚠️⚠️ EXCEPT FOR A SECURITY, WHERE THE "DESCRIPTION" IS THE INSTRUMENT'S
              NAME. `securityResults` builds a ticker row as `name: QQQ`,
              `shortName: ETF`, `description: Invesco QQQ Trust` — so dropping the
              description here would leave a row reading `QQQ  ETF` and nothing
              else, which is an identity a member cannot confirm. That is not an
              educational sentence, it is the second half of the name, so it goes
              INLINE rather than on a second line (owner §15: *"a security/company
              name can be secondary inline text if useful, but avoid a tall
              two-line result"*).
              ⛔ SECURITIES ONLY, AND BY `kind` RATHER THAN BY LOOKING AT THE TEXT.
              A breadth row's description restates its name and a technical one is
              prose; neither earns the space. */}
          {row.kind === 'security' && row.description
            /* ⚠️⚠️ AND ONLY WHEN IT SAYS SOMETHING THE NAME DOES NOT. The two
               security adapters disagree about which field holds what: a SEARCH
               row is `name: QQQ` / `description: Invesco QQQ Trust`, while a
               BROWSE row carries the company in BOTH. Measured in the harness —
               `Apple Inc. AAPL Apple Inc.` — so the guard is a comparison rather
               than a rule about which adapter produced the row. */
            && row.description.trim() !== String(row.name || '').trim() && (
            <span className={styles.resSub}>{row.description}</span>
          )}
          {/* ⚰️⚰️ THE DESCRIPTION WAS A SECOND LINE HERE AND IS NOW THE ROW'S
              TOOLTIP. It cost 34px of every row — with the padding, a result was
              80px tall and THREE of them fitted the viewport. Owner, 2026-09-17:
              *"the user already knows they are browsing indicators, and the
              descriptions are costing too much vertical space... I want roughly
              7–9 visible."*
              ⛔ MOVED, NOT DELETED. The sentence is on the row's `title` (see the
              `<li>` above), so it is one hover away and still reaches a screen
              reader through the accessible description — what it stops doing is
              setting the height of a catalogue nobody reads end to end. */}
          {/* The server's own words, where it gave any — `delisted 2022-10-27`,
              `index history not served by /api/bars-history`. Never a guess. */}
          {refused && row.capabilityReason && (
            <span className={styles.resRefusedWhy} data-testid="result-refusal-reason">{row.capabilityReason}</span>
          )}
        </span>
        {/* ⛔ "ACTIVE" IS PER-ROW, NOT PER-TYPE, AND IT IS NOT A DEAD END. Several
            definitions can hold more than one line (EMA-style duplicates are the
            point of `addInstance`), so an already-on row keeps offering a second
            — exactly as the library's "+ Add another" does. `volumeProfile` is
            carved out and has nothing to instantiate, so it gets the word alone. */}
        {refused ? (
          <span className={styles.resActive}><span className={styles.resActiveTag}>Unavailable</span></span>
        ) : on ? (
          <span className={styles.resActive}>
            <span className={styles.resActiveTag}>Active</span>
            {!row.carvedOut && !row.singleton && (
              <button
                type="button"
                className={styles.resAddMore}
                aria-label={`Add another ${row.name}`}
                title={`Add a second ${row.shortName} with the default settings`}
                onClick={(e) => addAnother(row, e)}
              >＋</button>
            )}
          </span>
        ) : (
          <span className={styles.resAdd} aria-hidden="true">＋ Add</span>
        )}
      </li>
    )
  }

  // ─── THE ADD SURFACE — the ONE door, on the right ──────────────────────────
  //
  // ⭐⭐ THE LEFT STRUCTURE NEVER DISAPPEARS WHILE A MEMBER IS SEARCHING, and that
  // is the one lesson Hybrid 2 earned that this design keeps. Hybrid 2 had to
  // draw a COMPRESSED PANE MAP beside its search results so a member could see
  // where a thing would land; here the real, full, ordinary structure list is
  // already sitting there, so there is nothing to compress and nothing to keep in
  // step with the real one.
  //
  // ⛔ ONE DOOR. There is no Add Indicator / Add Symbol / Add Breadth / Add Data
  // Series. `discoveryCatalog` unions technicals, the member's own formulas,
  // securities and breadth behind `matches()` + `useSymbolDiscovery`; a member
  // types `RSI`, `QQQ` or `% Above 50 EMA` and the difference underneath never
  // surfaces.
  const renderAddSurface = () => {
    const tabLabel = (LIBRARY_TABS.find((t) => t.key === activeTab) || { label: 'anything' }).label
    return (
    <div className={styles.insAdd} data-testid="add-surface">
      <div className={styles.insHead}>
        {/* ⚰️⚰️ IT WAS UNCONDITIONAL, AND IT USED TO MEAN SOMETHING: discovery was a
            place you went FROM the orientation screen, so there was always
            somewhere to come back to. That screen is gone and discovery is the
            default, so an arrow rendered with nothing selected would return the
            member to… discovery. Owner: *"no dead back arrow."*
            ⭐ IT APPEARS EXACTLY WHEN THERE IS A SELECTION TO RETURN TO — a member
            who was editing `EMA 20`, pressed `＋ Add Indicator` and changed their
            mind gets `EMA 20` back. No history stack: the selection IS the
            history, and it was never cleared. */}
        {/* ⚠️⚠️ AND ALWAYS AT NARROW, WHICH IS NOT A SECOND RULE — it is the same
            one. The arrow exists when leaving discovery LEADS SOMEWHERE, and on a
            phone it always does: the two regions are one at a time, so the left
            list is off screen while Add is up and this is the only way back to
            it. Measured: without this a member with nothing selected had no exit
            from Add on a narrow layout at all. */}
        {(selectedRow || narrow) && (
          <button
            type="button"
            className={styles.insBack}
            onClick={leaveBrowse}
            aria-label={selectedRow
              ? `Back to ${paneRowMeta(selectedRow, groupOfRow(selectedRow.id), settings, defOf).name}`
              : 'Back to the chart structure'}
          >←</button>
        )}
        <span className={styles.insHeadText}>
          <span className={styles.insHeadName}>Add Indicator</span>
        </span>
        {/* ⚰️ IT WORE `.insHeadAct` — the same faint grey as `Arrange`, which is a
            MODE SWITCH, and at the far end of a header a member reads for a
            title. Owner, 2026-09-17: *"the existing + New Formula action is too
            dark/subtle and easy to miss."*
            ⭐ A GHOST BUTTON, NOT A GOLD ONE. It is the SECONDARY task on this
            surface — search is the primary one — so it gets an outline and real
            ink and stops there. Filling it would put the loudest object on the
            panel next to the thing it must not outrank. */}
        {onCreateFormula && (
          <button
            type="button"
            className={styles.insNewFormula}
            data-testid="settings-new-formula"
            onClick={() => onCreateFormula()}
            title="Build your own indicator — conditions, plain English, Pine or ThinkScript"
          >
            <span className={styles.insNewFormulaPlus} aria-hidden="true">＋</span>
            New Formula
          </button>
        )}
      </div>
      <p className={styles.insAddLede}>
        Search and add indicators, symbols, breadth and your own formulas.
      </p>

      <div className={styles.insSearchRow}>
        <div className={styles.indSearchWrap}>
          <span className={styles.indSearchIcon} aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            className={styles.indSearch}
            /* ⛔ IT NAMES ONLY WHAT IS GENUINELY SEARCHABLE. `fundamentals` is
               deliberately absent — see `FUNDAMENTALS_STATUS`; promising a search
               that can return nothing is the "fake availability" the brief rules
               out. */
            placeholder="Search indicators, symbols, breadth or formulas…"
            aria-label="Search indicators"
            value={query}
            onChange={(e) => {
              // ⚰️⚰️ TYPING ALWAYS RETURNS TO A UNIVERSAL SEARCH, and the first
              // version of this rule did not. It un-pinned only on CLEARING, so a
              // member who clicked `Popular` and then typed `QQQ` got nothing —
              // measured in the harness — because a ticker is not a popular
              // indicator. §18 asks for both *"search within the selected
              // category"* and *"do not make ticker search harder"*, and when they
              // collide the second one wins: a query is a new question.
              // ⭐ NARROWING IS STILL THERE AND IS STILL THE MEMBER'S: click a tab
              // while the results are up and it filters, and it stays filtered
              // until they type again.
              setTabPinned(false)
              setQuery(e.target.value)
            }}
            onKeyDown={(e) => {
              // ⛔ STOPPED HERE ON PURPOSE. The modal's Escape handler is a WINDOW
              // listener that closes the whole settings modal; inside the Add
              // surface Escape has a nearer meaning — go back to the structure —
              // and closing the modal from under a member who was searching is the
              // wrong one.
              if (e.key === 'Escape') { e.stopPropagation(); leaveBrowse() }
            }}
          />
          {query && (
            <button
              type="button"
              className={styles.indClear}
              aria-label="Clear search"
              onClick={() => { setQuery(''); setTabPinned(false); searchRef.current?.focus() }}
            >✕</button>
          )}
        </div>
      </div>

      {/* ⚠️ `onScroll` RE-CAPTURES THE ANCHOR, and without it the whole mechanism
          is wrong the moment a member scrolls. Scrolling causes no React commit, so
          the anchor would still describe where the list was BEFORE they moved — and
          the next insertion would "correct" to a position they had already left,
          which is a jump rather than the absence of one. */}
      {/* ── THE CATEGORY STRIP, DIRECTLY UNDER SEARCH ────────────────────
          ⚰️ WHAT IT REPLACES WAS A `Browse` BLOCK OF CHIPS AT THE **BOTTOM** of the
          results, argued for at the time: *"with an empty box the list above IS
          every category, grouped — so chips at the top would be a filter offered
          before anything needed filtering."* That was true of a list that showed
          everything at once. The taxonomy is a NAVIGATION now, not a filter over
          a list already on screen, so it belongs where a member looks first.
          ⛔ A `tablist`, NOT A ROW OF BUTTONS. Each tab controls the same results
          region; `aria-selected` and roving tabindex are what make one tab stop
          with arrow keys, which is what a member reaches for after tabbing out of
          the search box. */}
      <div className={styles.insTabsWrap}>
        <div
          className={styles.insTabs}
          role="tablist"
          aria-label="Indicator categories"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const at = LIBRARY_TABS.findIndex((t) => t.key === activeTab)
            const step = e.key === 'ArrowRight' ? 1 : -1
            const next = LIBRARY_TABS[(Math.max(at, 0) + step + LIBRARY_TABS.length) % LIBRARY_TABS.length]
            if (next) { setTab(next.key); setTabPinned(true) }
          }}
        >
          {LIBRARY_TABS.map((t) => {
            const on = t.key === activeTab
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                /* ⚠️ WITH NOTHING SELECTED (a universal search) THE FIRST TAB IS
                   THE STOP, so the strip never drops out of the tab order. */
                tabIndex={on || (!activeTab && t.key === LIBRARY_TABS[0].key) ? 0 : -1}
                data-tab={t.key}
                /* ⚠️ THE CHOSEN TAB SCROLLS ITSELF INTO VIEW. The strip is wider
                   than the column, so an arrow-key walk would otherwise select
                   something off the end of it — a keyboard member choosing a
                   category they cannot see. `nearest` moves the minimum. */
                ref={on ? ((el) => { try { el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* jsdom */ } }) : undefined}
                className={`${styles.insTab} ${on ? styles.insTabOn : ''}`}
                onClick={() => { setTab(t.key); setTabPinned(true) }}
              >{t.label}</button>
            )
          })}
        </div>
      </div>

      <div className={styles.insAddBody} ref={addBodyRef} onScroll={() => { anchorRef.current = captureAnchor() }}>
        {/* ⛔⛔ FUNDAMENTALS TELLS THE TRUTH RATHER THAN SHOWING ROWS. The audit is
            written out at `FUNDAMENTALS_STATUS`: the chart's source grammar has no
            fundamental kind, and the one fundamental the product holds
            (`market_cap`) is a NIGHTLY SCALAR whose own engine refuses a bar
            offset because *"answering it with today's value would be a fabricated
            history."* A row here would be exactly that fabrication. */}
        {activeTab === 'fundamentals' && !FUNDAMENTALS_STATUS.available && (
          <div className={styles.insUnavailable} data-testid="fundamentals-unavailable">
            <div className={styles.insUnavailableLede}>{FUNDAMENTALS_STATUS.lede}</div>
            <p className={styles.insUnavailableWhy}>{FUNDAMENTALS_STATUS.why}</p>
          </div>
        )}
        {activeTab !== 'fundamentals' && tabResults.length === 0 && refusals.length === 0 && (
          <div className={styles.indEmpty}>
            {/* ⚠️ "SEARCHING" IS NOT "NOTHING MATCHES", and the difference is a
                network round trip. Telling a member their ticker does not exist
                while the request for it is still in flight is the one message that
                makes them stop typing. */}
            {query
              ? (symbolsLoading
                ? <>Nothing matches “{query}” yet — still searching symbols…</>
                : (activeTab
                  ? <>Nothing matches “{query}” in {tabLabel}.</>
                  : <>Nothing matches “{query}”.</>))
              /* ⛔ A SEARCH-DRIVEN TAB SAYS SO. `Symbols` and `ETFs` have no
                 endpoint that lists every instrument, so an empty box is not an
                 empty CATEGORY — telling a member there is nothing here would be
                 a different and wrong sentence. */
              : <>Search to find {tabLabel.toLowerCase()} to add.</>}
          </div>
        )}
        {/* ─── SYMBOLS ARE STILL COMING ──────────────────────────────────
            ⭐ THIS IS NOT THE STABILISER — the scroll anchor above is. What this does
            is tell the member that the list is not finished: the catalogue answers
            instantly and the network does not, so without it a query with no local
            match reads as "nothing found" for two and a half seconds.
            ⛔ ONE LINE, NOT A RESERVED BLOCK. It deliberately does not pretend to know
            how many tickers are coming; reserving twenty rows of emptiness for
            results that may never arrive was measured and rejected.
            ⚠️ AT THE TOP, because that is where the group lands for an exact ticker
            — which every query measured (`MA`, `RSI`, `QQQ`, `SPY`, `EMA`) turned out
            to be. When there is no exact hit the real group appends below instead,
            and the anchor absorbs the difference either way. */}
        {/* ⚠️⚠️ GATED ON THE **SYMBOLS GROUP**, NOT ON `symbolRows.rows.length`.
            `useSymbolDiscovery` answers from TWO sources and only one of them is a
            network call: local BREADTH matches resolve on the first keystroke, so
            `symbolRows.rows` is already non-empty for a query like `MA` (which
            substring-matches `% Above 50 EMA`) while the ticker search is still in
            flight. Measured: the notice never rendered for `MA`, `RSI` or `EMA` —
            every query that actually needed it — and only appeared for one with no
            breadth hit at all. This stands in for the SYMBOLS group specifically,
            so it is present exactly while that group is absent and being fetched. */}
        {symbolsLoading && query && !groups.includes(SYMBOL_CATEGORY) && (
          <section className={styles.insAddGroup} data-testid="symbols-pending">
            <div className={styles.insSectionLabel}>{SYMBOL_CATEGORY}</div>
            <div className={styles.insSearching}>Searching symbols…</div>
          </section>
        )}
        {groups.map((c) => (
          <section key={c} className={styles.insAddGroup}>
            {/* ⚠️ ONE GROUP, ONE HEADING — AND NOT WHEN IT WOULD REPEAT THE TAB.
                `Popular` and `Formulas` resolve to a single group whose name is
                the tab's own word; printing it again is furniture. */}
            {groups.length > 1 && <div className={styles.insSectionLabel}>{c}</div>}
            <ul className={styles.resList} role="listbox" aria-label={c}>
              {tabResults.filter((r) => r.category === c).map(renderResult)}
            </ul>
          </section>
        ))}
        {/* Saved, and not offered — with the gate's own reason, verbatim. Rendered
            only when something was actually refused, so a member whose formulas
            all install sees no heading about nothing. */}
        {refusals.length > 0 && (
          <section className={styles.insAddGroup} data-testid="user-definition-refusals">
            <div className={styles.insSectionLabel}>{REFUSED_CATEGORY}</div>
            <p className={styles.resRefusedLede}>
              These saved formulas are not being offered on this chart. The reason
              below comes from the check that refused each one.
            </p>
            <ul className={styles.resList}>
              {refusals.map((row) => (
                <li
                  key={row.id}
                  className={`${styles.resRow} ${styles.resRefused}`}
                  data-testid="user-definition-refusal"
                  data-def-id={row.id}
                >
                  <span className={styles.resMain}>
                    <span className={styles.resTitleRow}>
                      <span className={styles.resName}>{row.name}</span>
                      <span className={styles.resMine}>Your formula</span>
                    </span>
                    {row.messages.map((message, i) => (
                      <span key={i} className={styles.resRefusedWhy} data-testid="user-definition-refusal-reason">{message}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
    )
  }

  // ─── THE PANEL ─────────────────────────────────────────────────────────────
  //
  // ⭐⭐ LEFT = WHAT IS ON MY CHART. RIGHT = EDIT THE THING I SELECTED. Two regions
  // with two different jobs, which is what makes the width worth spending — and is
  // the difference from Hybrid 2, where the extra 120px bought a THIRD and FOURTH
  // column of the same kind of thing.
  //
  // ⛔⛔ AND THE GEOMETRY DOES NOT MOVE. There is no inline accordion: selecting
  // `RSI 14` after `EMA 20` swaps the right column's CONTENTS and changes nothing
  // about the left column's heights, so a member walking the list with ↑/↓ is not
  // reading a panel that reflows under them. The old expander pushed every row
  // below it down by the height of a form.
  //
  // ⚠️ AT NARROW THE TWO REGIONS BECOME TWO VIEWS OF ONE STATE, not a second
  // architecture: the same `selected`, the same Inspector, the same read model,
  // rendered one at a time with a Back arrow instead of side by side. Squeezing a
  // 264px column and a form into 360px is how a desktop panel arrives on a phone
  // looking broken.
  const showLeft = !narrow
    || mode === 'arrange'
    || (mode === 'active' && narrowView === 'list')
  const showRight = !narrow
    || mode === 'browse'
    || (mode === 'active' && narrowView === 'inspector')

  return (
    <div className={styles.indTab} data-mode={mode} data-narrow={narrow ? 'true' : undefined}>
      <div className={styles.insSplit}>
        {showLeft && (
          <div className={styles.insLeft} data-testid="chart-structure">
            <div className={styles.insLeftHead}>
              <span className={styles.insLeftTitle}>
                {mode === 'arrange' ? 'Arrange panes' : 'Indicators'}
              </span>
              {mode === 'arrange' ? (
                <button
                  type="button"
                  className={styles.insHeadAct}
                  data-testid="arrange-done"
                  onClick={leaveArrange}
                >Done</button>
              ) : (
                <>
                  {/* ⛔ OFFERED ONLY WHEN THERE IS SOMETHING TO ARRANGE. One pane
                      cannot be restacked, and a control that cannot act is not a
                      control. */}
                  {arrangeable.length > 1 && (
                    <button
                      type="button"
                      className={styles.insHeadAct}
                      data-testid="arrange-enter"
                      onClick={enterArrange}
                    >Arrange</button>
                  )}
                  {/* ⚰️⚰️ A TINY `＋ Add` STOOD HERE, beside `Arrange`, and it is
                      retired. Two words of chrome in a heading is where an action
                      goes when nobody has decided how important it is — it was
                      the same size as `Arrange`, which is a MODE, and it sat at
                      the top of a list it was supposed to extend. Owner,
                      2026-09-17: *"remove the tiny + Add from that location...
                      replace it with a clear button at the BOTTOM of the left
                      Indicators section."*
                      ⭐ THE LIST NOW READS AS ONE SENTENCE: these are my
                      indicators — and then, where the list ends, add another.
                      See `.insAddIndicator` at the foot of this column. */}
                </>
              )}
            </div>

            {mode === 'arrange' ? (
              <div className={styles.insStructure} data-testid="arrange-list">
                {arrangeable.map((g, i) => renderArrangeGroup(g, i))}
              </div>
            ) : activeRows.length === 0 ? (
              <div className={styles.indEmpty}>
                Nothing on this chart yet.{' '}
                <button type="button" className={styles.indEmptyLink} onClick={enterBrowse}>Add something</button>.
              </div>
            ) : (
              <div
                className={styles.insStructure}
                role="listbox"
                aria-label="Series on this chart"
                /* ⚰️ `aria-controls` WAS ON EVERY ROW'S EXPANDER, paired with
                   `aria-expanded`, because each row opened a region of its own.
                   There is ONE region now and the LIST drives it — which is what
                   `listbox` means — so the pointer belongs here, and
                   `aria-expanded` has nothing left to describe. A member told
                   that something changed still has a way to find WHAT changed. */
                aria-controls={selected ? inspectorDomId(selected) : undefined}
                ref={listRef}
                onKeyDown={onStructureKeys}
              >
                {/* ⚠️ `volumeRef` STAYS WITH THE VOLUME GROUP. It is the modal's
                    scroll anchor for the Volume deep link, and the volume group is
                    where Volume lives — putting it on the first heading instead
                    would scroll members to the top of the structure and call it a
                    deep link. */}
                {paneGroups.map((g) => renderStructureGroup(g, g.id === 'volume' ? volumeRef : null))}
              </div>
            )}

            {/* ⭐⭐ WHERE THE LIST ENDS. It is OUTSIDE the scrolling structure, so a
                member with fifteen indicators does not have to scroll to the
                bottom to find the way to add a sixteenth — the list scrolls
                under it and this stays put.
                ⛔ NOT IN ARRANGE. Arrange is about the panes that already exist;
                offering to add a new series in the middle of restacking is a
                second job on a surface that deliberately has one. */}
            {mode !== 'arrange' && (
              <button
                type="button"
                className={styles.insAddIndicator}
                data-testid="add-enter"
                onClick={enterBrowse}
              >
                <span className={styles.insAddIndicatorPlus} aria-hidden="true">＋</span>
                Add Indicator
              </button>
            )}
          </div>
        )}

        {showRight && (
          <div className={styles.insRight} data-testid="inspector">
            {mode === 'arrange'
              ? renderArrangeAside()
              : (discovering ? renderAddSurface() : renderInspector(selectedRow))}
          </div>
        )}
      </div>
    </div>
  )
}
