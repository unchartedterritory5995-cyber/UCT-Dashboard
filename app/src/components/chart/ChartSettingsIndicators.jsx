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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from './discoveryCatalog'
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
  const [category, setCategory] = useState(null)
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
  const { results: symbolResults, loading: symbolsLoading } = useSymbolDiscovery(query, mode === 'browse')

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

  const results = useMemo(() => {
    const byQuery = catalog.filter((r) => matches(r, query))
    const local = category ? byQuery.filter((r) => r.category === category) : byQuery
    // ⛔ THE REMOTE ROWS ARE NOT RE-FILTERED BY `matches`. They are already the
    // answer to this query — `useSymbolDiscovery` asked the server and the breadth
    // library with it — and a second substring test over a name the server ranked
    // would drop `Invesco QQQ Trust` for the query `Invesco` on a bad day. The
    // CATEGORY chip still applies, because that is this surface's own filter.
    const sym = category
      ? symbolRows.rows.filter((r) => r.category === category)
      : symbolRows.rows
    return [...local, ...sym]
  }, [catalog, query, category, symbolRows])

  const refusals = useMemo(
    () => userRefusalRows((userDefRows || []).map((r) => r && r.definition), userDefErrors)
      .filter((r) => matches(r, query)),
    [userDefRows, userDefErrors, query],
  )

  // Groups DERIVED in first-appearance order, the member's own hoisted to the
  // front — the same partition `IndicatorLibraryDialog` makes, and for the same
  // reason (a formula you wrote should not be below four shipped categories).
  const groups = useMemo(() => {
    const order = [...new Set(results.map((r) => r.category))]
    const mine = new Set(results.filter((r) => r.userDefined).map((r) => r.category))
    const ranked = [...order.filter((c) => mine.has(c)), ...order.filter((c) => !mine.has(c))]
    // ⭐ AN EXACT TICKER OUTRANKS EVERYTHING (owner §9). A member who types `QQQ`
    // means the instrument, and burying Symbols under four shipped categories is
    // the same defect `useSymbolDiscovery` already fixed WITHIN its own list. The
    // hook has put the exact hit first, so this only has to hoist its heading.
    //
    // ⛔ AND ONLY ON AN EXACT MATCH. Hoisting Symbols for every query would put a
    // list of tickers above "Moving Average" for the query `moving average`.
    const first = symbolRows.rows[0]
    const exact = first && String(first.id).toUpperCase() === String(query).trim().toUpperCase()
      ? first.category : null
    return exact ? [exact, ...ranked.filter((c) => c !== exact)] : ranked
  }, [results, symbolRows, query])

  const categories = useMemo(() => [...new Set(catalog.map((r) => r.category))], [catalog])

  const enterBrowse = useCallback(() => setMode('browse'), [])
  const leaveBrowse = useCallback(() => {
    setMode('active'); setQuery(''); setCategory(null)
    try { searchRef.current?.blur() } catch { /* noop */ }
  }, [])

  // ⭐ THE BOX TAKES FOCUS WHEN THE ADD SURFACE OPENS. `＋ Add` is a statement of
  // intent to search, and a member who then has to click the field has been made
  // to ask twice. It is keyed on the MODE rather than done inside `enterBrowse`
  // so that `pickCategory` — the other way in — gets it too, and so a re-render
  // while already browsing never steals the caret back from where they put it.
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
    setMode('arrange'); setQuery(''); setCategory(null); setNarrowView('list')
  }, [])
  const leaveArrange = useCallback(() => {
    setMode('active')
    dragKeyRef.current = null; setDragging(null); setDropBefore(null)
  }, [])

  // Focus the box when a CATEGORY chip put us in browse mode, so typing narrows
  // without a second click. Not on every entry: focusing the box is itself one of
  // the ways in, and re-focusing it there fights the caret.
  const pickCategory = useCallback((c) => {
    setCategory(c); setMode('browse')
    try { searchRef.current?.focus() } catch { /* noop */ }
  }, [])

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
        <span className={styles.insRowName}>{meta.name}</span>
        {/* ⭐ THE VISIBILITY STATE, AS ONE DIMMED WORD. A switch on every row is
            the toolbar the brief rules out; the row is dimmed AND says why, so a
            member scanning the column sees which lines are off without hovering
            anything, and a screen reader is told rather than shown. */}
        {!on && <span className={styles.insRowOffTag}>Off</span>}
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
    return { core: shown.filter((f) => !isLook(f)), look: shown.filter(isLook) }
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

  const renderField = (row, f) => {
    const val = row.values?.[f.key]
    const dis = !!f.disabled
    // The reason has to reach a screen reader, not just a pointer — the rule this
    // tab already followed, kept verbatim.
    const whyId = dis ? `ind-why-${row.id}-${f.key}` : undefined
    const inert = dis
      ? { disabled: true, 'aria-disabled': 'true', title: f.disabled, 'aria-describedby': whyId }
      : {}
    return (
      <div key={f.key} className={styles.insField} data-field={f.key} title={f.disabled || undefined}>
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
          {f.type === 'select' && (
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
        {(core.length > 0 || display) && (
          <section className={styles.insSection} data-section="core">
            <div className={styles.insSectionLabel}>Core</div>
            {core.map((f) => renderField(row, f))}
            {display}
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

  /**
   * NOTHING SELECTED — quiet, and still a door.
   *
   * ⛔ NOT A BLANK RECTANGLE AND NOT A MARKETING PANEL. One sentence saying what
   * the column is for, one count so the member can see the list is real, and the
   * same Add door the heading carries.
   */
  const renderInspectorEmpty = () => (
    <div className={styles.insEmpty} data-testid="inspector-empty">
      <div className={styles.insEmptyLede}>Select an indicator to edit it.</div>
      <div className={styles.insEmptyNote}>
        {flatRows.length} {flatRows.length === 1 ? 'series' : 'series'} on this chart
      </div>
      <button type="button" className={styles.insAddBtn} onClick={enterBrowse}>＋ Add to Chart</button>
    </div>
  )

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
      <div className={styles.insField} data-field="__display__" key="display-in">
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
        <div className={styles.insField} data-field={`__style__:${plot.key}`} key={`style-${plot.key}`}>
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
        data-result-kind={row.kind || undefined}
        data-user-defined={row.userDefined ? 'true' : 'false'}
        tabIndex={0}
        className={`${styles.resRow} ${on ? styles.resRowOn : ''} ${refused ? styles.resRefused : ''}`}
        onClick={() => { if (canAdd) addRow(row) }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && canAdd) { e.preventDefault(); addRow(row) }
        }}
      >
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
          {row.description && <span className={styles.resBlurb}>{row.description}</span>}
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
  const renderAddSurface = () => (
    <div className={styles.insAdd} data-testid="add-surface">
      <div className={styles.insHead}>
        <button
          type="button"
          className={styles.insBack}
          onClick={leaveBrowse}
          aria-label="Back to active indicators"
        >←</button>
        <span className={styles.insHeadText}>
          <span className={styles.insHeadName}>Add to Chart</span>
        </span>
        {onCreateFormula && (
          <button
            type="button"
            className={styles.insHeadAct}
            data-testid="settings-new-formula"
            onClick={() => onCreateFormula()}
            title="Build your own indicator — conditions, plain English, Pine or ThinkScript"
          >＋ New Formula</button>
        )}
      </div>

      <div className={styles.insSearchRow}>
        <div className={styles.indSearchWrap}>
          <span className={styles.indSearchIcon} aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            className={styles.indSearch}
            placeholder="Search indicators, symbols, breadth…"
            aria-label="Search indicators"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // ⛔ STOPPED HERE ON PURPOSE. The modal's Escape handler is a WINDOW
              // listener that closes the whole settings modal; inside the Add
              // surface Escape has a nearer meaning — go back to the structure —
              // and closing the modal from under a member who was searching is the
              // wrong one.
              if (e.key === 'Escape') { e.stopPropagation(); leaveBrowse() }
            }}
          />
          {(query || category) && (
            <button
              type="button"
              className={styles.indClear}
              aria-label="Clear search"
              onClick={() => { setQuery(''); setCategory(null); searchRef.current?.focus() }}
            >✕</button>
          )}
        </div>
      </div>

      <div className={styles.insAddBody}>
        {category && (
          <div className={styles.indCatActive}>
            <span className={styles.indCatActiveName}>{category}</span>
            <button type="button" className={styles.indCatDrop} onClick={() => setCategory(null)}>All categories</button>
          </div>
        )}
        {results.length === 0 && refusals.length === 0 && (
          <div className={styles.indEmpty}>
            {/* ⚠️ "SEARCHING" IS NOT "NOTHING MATCHES", and the difference is a
                network round trip. Telling a member their ticker does not exist
                while the request for it is still in flight is the one message that
                makes them stop typing. */}
            {query
              ? (symbolsLoading
                ? <>Nothing matches “{query}” yet — still searching symbols…</>
                : <>Nothing matches “{query}”.</>)
              : <>Nothing in this category.</>}
          </div>
        )}
        {groups.map((c) => (
          <section key={c} className={styles.insAddGroup}>
            <div className={styles.insSectionLabel}>{c}</div>
            <ul className={styles.resList} role="listbox" aria-label={c}>
              {results.filter((r) => r.category === c).map(renderResult)}
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
        {/* ⭐ THE CATEGORY FILTER, AT THE BOTTOM AND NOT THE TOP. With an empty box
            the list above IS every category, grouped — so chips at the top would
            be a filter offered before anything needed filtering. They sit under
            the results, where a member who has scrolled and not found it reaches
            for them. */}
        {!query && (
          <section className={styles.insAddGroup}>
            <div className={styles.insSectionLabel}>Browse</div>
            <div className={styles.indCats}>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={styles.indCat}
                  onClick={() => pickCategory(c)}
                >{c}</button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )

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
                  <button
                    type="button"
                    className={styles.insHeadAdd}
                    data-testid="add-enter"
                    onClick={enterBrowse}
                  >＋ Add</button>
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
          </div>
        )}

        {showRight && (
          <div className={styles.insRight} data-testid="inspector">
            {mode === 'browse'
              ? renderAddSurface()
              : mode === 'arrange'
                ? renderArrangeAside()
                : (selectedRow ? renderInspector(selectedRow) : renderInspectorEmpty())}
          </div>
        )}
      </div>
    </div>
  )
}
