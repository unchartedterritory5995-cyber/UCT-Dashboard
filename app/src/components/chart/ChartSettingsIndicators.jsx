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
  readEnabled, indTarget,
} from './indicatorRegistry'
import {
  catalogRows, userCatalogRows, catalogGeneration, userRefusalRows, REFUSED_CATEGORY,
  BUILT_IN_ROWS,
} from './indicatorCatalog'
// ⛔ THE SEARCH AND THE ADD, IMPORTED FROM THE DIALOG THAT ALREADY OWNS THEM.
// See the header — this is the reuse, and it is why this file has no `q.trim()`
// in it and no second `setIndicatorEnabled` call.
import { matches, isRowOn, toggledRow } from './IndicatorLibraryDialog'
import {
  addInstance, removeInstance, setIndicatorEnabled, setInstanceHidden, findInstance,
} from './engine/instanceControls'
import { CLEAN } from './engine/repaintVerdict'
import UIcon from '../ui/UIcon'
import styles from './ChartSettingsModal.module.css'
import SourceField from './SourceField'
import { availableStyles, resolvePlotStyle, PLOT_STYLE_CHOICES } from './engine/presentation'
import { ohlcCapabilityOf } from './engine/ohlcCapability'
import { anyCachedBars } from './engine/secondaryBars'
import { symbolFamily } from '../../hooks/useBreadthSymbols'
import { resolveDisplayTarget, displayTargetOptions } from './engine/displayTarget'
import { sourceInputsOf, parseSource } from './engine/sourceRef'
import { setInstancePlotStyle, setInstanceDisplayTarget } from './engine/instanceControls'
// ⭐⭐ THE PANE MAP, AS A READ. `chartDataMap` asks `resolveDisplayTarget`,
// `paneOwnerOf`, `paneOwnKeys` and `paneOwnersNeeded` — the same four answers
// `StockChart` hands `computePaneLayout` — so this component never forms its own
// opinion about where anything draws. See that file's header for why grouping
// from a label or a summary string would be a lie nobody notices.
import { paneMap } from './chartDataMap'

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
function typeBadge(row) {
  if (isFixtureRow(row)) return null
  const short = row.group
  if (!short) return null
  const label = String(row.label || '')
  return label.toLowerCase().includes(String(short).toLowerCase()) ? null : short
}

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
  const [selected, setSelected] = useState(openRowId)   // rowId — ONE at a time (§11)

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
  const catalog = useMemo(
    () => [...BUILT_IN_ROWS, ...catalogRows(registry), ...userCatalogRows(registry)],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` IS the registry's version; see above
    [registry, generation],
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
    () => paneMap(activeRows, settings, (id) => registry?.getDefinition?.(id) || null),
    [activeRows, settings, registry],
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
  const results = useMemo(() => {
    const byQuery = catalog.filter((r) => matches(r, query))
    return category ? byQuery.filter((r) => r.category === category) : byQuery
  }, [catalog, query, category])

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
    return [...order.filter((c) => mine.has(c)), ...order.filter((c) => !mine.has(c))]
  }, [results])

  const categories = useMemo(() => [...new Set(catalog.map((r) => r.category))], [catalog])

  const enterBrowse = useCallback(() => setMode('browse'), [])
  const leaveBrowse = useCallback(() => {
    setMode('active'); setQuery(''); setCategory(null)
    try { searchRef.current?.blur() } catch { /* noop */ }
  }, [])

  // Focus the box when a CATEGORY chip put us in browse mode, so typing narrows
  // without a second click. Not on every entry: focusing the box is itself one of
  // the ways in, and re-focusing it there fights the caret.
  const pickCategory = useCallback((c) => {
    setCategory(c); setMode('browse')
    try { searchRef.current?.focus() } catch { /* noop */ }
  }, [])

  const addRow = useCallback((row) => {
    const next = toggledRow(row, settings, registry)
    // Identity, not deep equality: a REFUSED write returns `settings` itself, and
    // persisting a no-op would mark the preset custom for a click that did nothing.
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }, [settings, onChange, registry])

  const addAnother = useCallback((row, e) => {
    e.stopPropagation()
    // ⛔ A BUILT-IN ROW HAS NO DEFINITION TO INSTANTIATE, so `addInstance` would
    // return the settings BY IDENTITY and this ＋ would be a live control that
    // writes nowhere. `toggledRow`'s overlay branch is what means "another moving
    // average" — revive a tombstone, else append a slot — and it is the same
    // writer the library dialog's own ＋ uses.
    const next = row.builtIn
      ? toggledRow(row, settings, registry)
      : addInstance(settings, row.id, registry)
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }, [settings, onChange, registry])

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
  const renderGroup = (group) => (
    <section
      key={group.id}
      className={`${styles.cdGroup} ${group.kind === 'orphans' ? styles.cdGroupOrphan : ''} ${group.kind === 'hidden' ? styles.cdGroupHidden : ''}`}
      data-pane-group={group.id}
      data-pane-kind={group.kind}
    >
      <div className={styles.cdGroupHead}>
        <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>{group.name}</span>
        <span className={styles.indCount}>{group.rows.length}</span>
      </div>
      {group.kind === 'orphans' && (
        <p className={styles.cdOrphanWhy}>
          The pane these were drawn in is no longer on the chart. They have kept
          their settings — give each one a new place to draw.
        </p>
      )}
      {/* ⚰️ A DIFFERENT SENTENCE, BECAUSE IT IS A DIFFERENT SITUATION. These are
          switched off, not broken, and the fix is the toggle on the row rather
          than a new destination. Saying "no longer on the chart" here was the
          defect the harness caught. */}
      {group.kind === 'hidden' && (
        <p className={styles.cdOrphanWhy}>
          Switched off, so they have no pane right now. Turn one back on and its
          pane comes back with it.
        </p>
      )}
      <div className={styles.cdGroupRows}>{group.rows.map(renderActiveRow)}</div>
    </section>
  )

  const renderActiveRow = (row) => {
    const on = rowVisible(row)
    // ⭐ SELECTED, NOT EXPANDED. The form it controls is the inspector on the
    // right rather than a region nested inside this row — which is why the
    // button carries `aria-controls`: `aria-expanded` without it would tell a
    // screen reader something opened and leave it with no way to find what.
    const isOpen = selected === row.id
    const colorFields = mainColorFields(row)
    const badge = typeBadge(row)
    const summary = placementSummary(row)
    return (
      <div
        key={row.id}
        className={`${styles.actBlock} ${isOpen ? styles.actBlockOpen : ''} ${on ? '' : styles.actBlockOff}`}
        data-row-id={row.id}
        /* ⛔ THE DEFINITION, ALONGSIDE THE ROW. `data-row-id` is the INSTANCE id
           (`legacy:rsi`, `inst:rsi:2`) because that is what addresses a write;
           this is what addresses the INDICATOR, which is what a reader — a test,
           a walkthrough, a future deep-link — actually knows the name of.
           Absent on the MA overlays and the volume pane, which have no
           definition, and that absence is itself the distinction. */
        data-def-id={row.defId || (row.path?.kind === 'indicator' ? row.id : undefined)}
      >
        {/* ⛔⛔ THE MODIFIER IS THE WHOLE FIX FOR THE KNOWN DEFECT. The overnight
            version made `.actName` stop growing GLOBALLY — and that class is
            shared with `ChartSettingsConditions` and `ChartSettingsInfoFields`,
            neither of which has a metadata sibling to take the freed space, so
            their trailing controls would pack left. Scoped here instead: the
            modifier is applied only to a row that HAS a summary, so a component
            that never renders one can never match the rule. */}
        <div className={`${styles.actHead} ${summary ? styles.actHeadMeta : ''}`}>
          <button
            type="button" role="switch" aria-checked={on} aria-label={`Toggle ${row.label}`}
            className={`${styles.toggle} ${styles.actToggle} ${on ? styles.toggleOn : ''}`}
            onClick={() => setRowVisible(row, !on)}
          ><span className={styles.toggleKnob} /></button>
          {/* The NAME is the expander, and so is the chevron — one target, two
              places to hit it. `aria-expanded` is on this button because it is
              the one that controls the region. */}
          <button
            type="button"
            className={styles.actName}
            aria-expanded={isOpen}
            aria-controls={inspectorDomId(row.id)}
            onClick={() => setSelected(isOpen ? null : row.id)}
          >
            <span className={styles.actLabel}>{row.label}</span>
            {badge && <span className={styles.actBadge}>{badge}</span>}
          </button>
          {/* ⭐ INLINE, NOT A SECOND LINE. Seven rows already fill this panel; a
              subtitle on each pushes BROWSE off the bottom and turns a dense list
              into a settings page.
              ⛔⛔ AND OUTSIDE THE BUTTON, WHICH IS NOT A LAYOUT DETAIL. Inside it,
              this text joins the expander's ACCESSIBLE NAME — a screen reader
              then announces "QQQ Line · Own pane" as the CONTROL's name, and the
              row stops being addressable as `QQQ`. Rails across this suite match
              that button against an anchored `/^QQQ$/` and went red the moment it
              was nested inside; they were right, and this is the fix rather than
              the rails being loosened. */}
          {summary && <span className={styles.actMeta}>{summary}</span>}
          {/* ⭐ THE SWATCH IS THE COLOUR PICKER, NOT A DOT. It is the modal's own
              `colorSwatch` — same target encoding (`ind:<rowId>:<field>`), same
              pop-out panel, same writer — so the most-changed setting on the tab
              is one click from collapsed. There is no event complexity to buy it:
              the swatch is a sibling of the expander, not a child, so nothing has
              to be stopped from propagating. */}
          {colorFields.length > 0 && (
            <span className={styles.actSwatch}>
              {colorFields.map((f) => (
                <span key={f.key}>
                  {colorSwatch(indTarget(row.id, f.key), `${row.label} — ${f.label}`)}
                </span>
              ))}
            </span>
          )}
          {/* ⚰️ A `˅` CHEVRON STOOD HERE (owner, 2026-09-10: "make it a little
              settings icon"). A chevron says "there is more below"; what is below
              is a SETTINGS FORM, and a gear says that in one glyph — which
              matters most on the row where the member is hunting for Period or
              Line width rather than idly expanding things.

              ⛔ `gold={false}` IS NOT COSMETIC. `UIcon` paints itself brand-gold
              by DEFAULT, gradient and drop-shadow included; here that would make
              a gear on every row the loudest thing in a list of eleven and put it
              in the same ink as the enabled toggles, which is the one place gold
              carries meaning on this tab. Unset, it inherits `currentColor` from
              the button — the same faint→bright hover the ✕ beside it uses.

              ⚠️ 15px, NOT 13. The glyph is a hub plus eight radiating spokes, and
              below ~14 the spokes collapse into the hub and it reads as a
              SUNBURST — measured in the browser at 13. 15 is what `ChartPane`'s
              own settings gear uses, so the two are the same icon at the same
              size on the same screen. */}
          <button
            type="button"
            className={`${styles.actChevron} ${isOpen ? styles.actChevronOpen : ''}`}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${row.label} settings`}
            aria-controls={inspectorDomId(row.id)}
            onClick={() => setSelected(isOpen ? null : row.id)}
          ><UIcon name="gear" size={15} gold={false} /></button>
          {/* ⭐ REMOVE, ON THE ROW (owner, after seeing the first build). The brief
              asked for Remove to live one level in, behind the expander, because
              "accidental removal should not be one click away in a dense list" —
              the owner looked at eleven real rows and asked for the ✕ anyway.
              Both doors ship: this is the fast one, the labelled "Remove
              indicator" inside the open row is the unambiguous one, and they are
              the SAME `removeRow` — never two writers.

              ⚰️ IT WAS ABSENT ON THE MA OVERLAYS AND THE VOLUME PANE for one
              build, because the positional merge could not express their removal
              without rewriting the member's other moving averages. The tombstone
              can, so the ✕ is on every row and the reserved-hole spacer is gone.

              ⚠️ `UIcon name="x"` AND NOT THE `✕` CHARACTER, AT THE GEAR'S EXACT
              SIZE. A text glyph is inset inside its own line box by however much
              the font leaves around it — measured at ~6.5px each side against the
              gear's 4.5px — so the ✕ read as further from the gear than the gear
              was from the colour swatch. Two icons from one set at one size sit
              in identical boxes, which is what makes the three trailing controls
              evenly spaced without hand-tuned margins. */}
          <button
            type="button"
            className={styles.actRowRemove}
            aria-label={`Remove ${row.label}`}
            title={`Remove ${row.label} from this chart`}
            onClick={() => removeRow(row)}
          ><UIcon name="x" size={15} gold={false} /></button>
        </div>
        {/* ⭐ THE EDITOR, ATTACHED TO ITS ROW. Same `renderInspector` body the
            right column used to hold — not a second copy, not a forked control
            path — rendered inside the row block so it cannot drift away from the
            name it belongs to. `isOpen` is the same one-at-a-time selection the
            pane map already had; only the render site moved. */}
        {isOpen && renderInspector(row)}
      </div>
    )
  }


  /**
   * THE INSPECTOR — everything about the ONE selected row.
   *
   * ⭐⭐ THIS IS THE ACCORDION BODY, MOVED, AND NOT A SECOND EDITOR. Every
   * control below is the control that used to sit inside the expanded row: the
   * same `row.fields` loop, the same `colorSwatch`, the same `displayInControl`
   * and `styleControl`, the same `onRowPatch`. Concept D changed WHERE the form
   * appears, never what writes it — so a rail that pinned "this select writes
   * `setInstanceDisplayTarget`" is pinning the same select it always was.
   *
   * ⛔ AND THE SELECTION IS A ROW ID, NOT AN INDEX OR A DEFINITION. The left
   * column can hold two rows of one definition in two different panes; anything
   * coarser than the row id would edit whichever one came first.
   */
  const renderInspector = (row) => (
    <div className={styles.cdInspector} id={inspectorDomId(row.id)} data-inspector-for={row.id}>
      {/* ⛔ NO NAME HEADING. In the right column this repeated the row's name
          because the row was somewhere else on screen; inline, the name is the
          line directly above and repeating it is furniture. */}
          {row.fields.map((f) => {
            if (f.showIf && !f.showIf(row.values)) return null
            const val = row.values?.[f.key]
            const dis = !!f.disabled
            // The reason has to reach a screen reader, not just a pointer — the
            // rule this tab already followed, kept verbatim.
            const whyId = dis ? `ind-why-${row.id}-${f.key}` : undefined
            const inert = dis
              ? { disabled: true, 'aria-disabled': 'true', title: f.disabled, 'aria-describedby': whyId }
              : {}
            return (
              <div key={f.key} className={styles.indRow} title={f.disabled || undefined}>
                <span className={`${styles.indLabel} ${dis ? styles.indLabelOff : ''}`}>{f.label}</span>
                {dis && <span id={whyId} className="sr-only">{f.disabled}</span>}
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
                {/* ⭐⭐ THE SOURCE CONTROL — the instrument this row plots.
                    A `source` input is the only one whose choices depend on
                    the chart rather than on the definition, so the widget
                    builds its own list from live settings. See
                    `SourceField.jsx`. */}
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
              </div>
            )
          })}
          {displayInControl(row)}
          {styleControl(row)}
          {/* ⭐ REMOVE LIVES HERE, ONE LEVEL IN (§14). A trash icon on a dense
              collapsed list is one mis-click from deleting a configured
              indicator; behind the expander it takes an intent. */}
          {/* ⚰️ TWO THINGS STOOD HERE AND BOTH ARE RETIRED, IN ORDER.
              (1) A "Built into every chart — turn it off above to hide it."
              note, for the MA overlays and the volume pane, because the storage
              could not remove them — the tombstone can, so it stopped being
              true. (2) A labelled "Remove indicator" button, which the brief
              asked for so that removal would not be one click away in a dense
              list. The owner then asked for the ✕ on the row, and once that
              shipped this was a SECOND door onto the same verb, two clicks
              deeper, at the bottom of a form nobody scrolls to in order to
              delete something. One verb, one control: the ✕ in the header. */}
    </div>
  )


  /**
   * The collapsed row's one-line answer to *"what is this, how is it drawn, where
   * does it draw, and what does it read?"*.
   *
   * ⛔⛔ THE LIST USED TO SAY ONLY THE NAME, and for an indicator that was enough
   * — everyone knows where RSI draws. Universal Data broke it: `QQQ` and `SPY`
   * sit in the same flat list as `EMA 9` and `Volume` with nothing to say they
   * are INSTRUMENTS, in panes of their own, drawn as lines. Four questions a
   * member had to open the row to answer.
   *
   * ⭐⭐ IT READS THE SAME SEAMS THE EXPANDED CONTROLS DO — `resolveDisplayTarget`,
   * `displayTargetOptions`, `resolvePlotStyle`, `sourceInputsOf` — so it cannot
   * drift from the controls directly beneath it. A second opinion here would be a
   * lie the moment either seam moved, and it is the kind of lie nobody notices
   * because the collapsed row is the one nobody opens.
   *
   * ⛔ NOTHING FOR THE FIXTURES, deliberately. "Line · Main chart" on all four
   * moving averages and the volume pane is furniture: identical on every one of
   * them, and already obvious. `displayTargetOptions` returning EMPTY is exactly
   * the test — a definition with one place to draw has nothing to orient anybody
   * about — so the silence is DERIVED rather than a list of ids to keep in step.
   *
   * ⛔ AND NO `Source:` WHEN THE NAME ALREADY IS THE SOURCE. `QQQ · Line ·
   * Source: QQQ` says it twice, and `meta.labelFrom === 'source'` is precisely
   * that case (Phase 4).
   */
  const placementSummary = useCallback((row) => {
    if (!row || !row.engineOwned || !row.instanceId) return null
    const def = registry?.getDefinition?.(row.defId)
    const inst = findInstance(settings, row.instanceId)
    if (!def || !inst) return null

    const defOf = (id) => registry?.getDefinition?.(id) || null
    const options = displayTargetOptions(inst, settings, defOf)
    // A plain price overlay has one place to draw and one shape to draw in. The
    // expanded row offers it nothing; so does this.
    if (!options.length) return null

    const where = resolveDisplayTarget(inst, settings)
    const parts = []

    // HOW — the primary plot's RESOLVED style, named exactly as the select names
    // it, so the two cannot word the same state differently.
    const styleCtx = { target: where, ohlcCapable: ohlcCapableFor(def, inst) }
    const primary = (def.plots || []).find((pl) => availableStyles(pl, styleCtx).length > 0)
    if (primary) {
      const style = resolvePlotStyle(inst, primary, styleCtx)
      const choice = PLOT_STYLE_CHOICES.find((c) => c.value === style)
      if (choice) parts.push(choice.label)
    }

    // WHERE — the chosen destination's own label. ⛔ A STORED HOST THAT HAS SINCE
    // BEEN DELETED IS CARRIED AS `missing`, and saying so is the whole point: the
    // row must read "Pane unavailable", never silently claim somewhere it is not
    // and never quietly fall back to Own pane.
    const missing = options.find((o) => o.missing) || null
    const chosen = options.find((o) => o.value === where) || missing
    if (chosen && chosen.label) parts.push(chosen.label)

    // WHAT IT READS — only when the name does not already say it.
    if (!(def.meta && def.meta.labelFrom === 'source')) {
      const declared = sourceInputsOf(def, inst)
      const parsed = declared.length ? parseSource(declared[0][1]) : null
      if (parsed && parsed.kind === 'symbol' && parsed.symbol
          && !String(row.label || '').toUpperCase().includes(String(parsed.symbol).toUpperCase())) {
        // ⛔ THE SYMBOL ALONE. `Source: QQQ · close · numeric` is the engine
        // talking to itself; the field is noise in a legend-shaped line.
        parts.push(`Source: ${parsed.symbol}`)
      }
    }
    return parts.length ? parts.join(' · ') : null
  }, [settings, registry])

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
    const current = options.some((o) => o.value === where) ? where : ''

    return (
      <div className={styles.indRow} key="display-in">
        <span className={styles.indLabel}>Display in</span>
        <select
          className={styles.indSelect}
          value={current}
          aria-label={`${row.label} display in`}
          onChange={(e) => {
            const next = setInstanceDisplayTarget(settings, row.instanceId, e.target.value, registry)
            // ⛔ REFUSED BY IDENTITY. The writer returns the SAME object when it
            // will not act, so this is how a rejected write stays a no-op instead
            // of marking the settings dirty.
            if (next !== settings) onChange?.({ ...next, preset: 'custom' })
          }}
        >
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
        <div className={styles.indRow} key={`style-${plot.key}`}>
          <span className={styles.indLabel}>{label}</span>
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
        </div>
      )
    })
  }, [settings, registry, onChange])

  // ─── ONE CATALOGUE RESULT ─────────────────────────────────────────────────
  const renderResult = (row) => {
    const on = isRowOn(row, settings)
    return (
      <li
        key={row.id}
        role="option"
        aria-selected={on}
        data-def-id={row.id}
        data-user-defined={row.userDefined ? 'true' : 'false'}
        tabIndex={0}
        className={`${styles.resRow} ${on ? styles.resRowOn : ''}`}
        onClick={() => { if (!on) addRow(row) }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !on) { e.preventDefault(); addRow(row) }
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
        </span>
        {/* ⛔ "ACTIVE" IS PER-ROW, NOT PER-TYPE, AND IT IS NOT A DEAD END. Several
            definitions can hold more than one line (EMA-style duplicates are the
            point of `addInstance`), so an already-on row keeps offering a second
            — exactly as the library's "+ Add another" does. `volumeProfile` is
            carved out and has nothing to instantiate, so it gets the word alone. */}
        {on ? (
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

  return (
    <div className={styles.indTab}>
      {/* ─── THE WAYS IN — search + author, on one compact row ─────────────── */}
      <div className={styles.indTop}>
        {mode === 'browse' && (
          <button
            type="button"
            className={styles.indBack}
            onClick={leaveBrowse}
            aria-label="Back to active indicators"
          >←</button>
        )}
        <div className={styles.indSearchWrap}>
          <span className={styles.indSearchIcon} aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            className={styles.indSearch}
            placeholder="Search indicators"
            aria-label="Search indicators"
            value={query}
            onFocus={enterBrowse}
            onChange={(e) => { setQuery(e.target.value); setMode('browse') }}
            onKeyDown={(e) => {
              // ⛔ STOPPED HERE ON PURPOSE. The modal's Escape handler is a WINDOW
              // listener that closes the whole settings modal; while the tab is in
              // discovery mode Escape has a nearer meaning — go back to the active
              // list — and closing the modal from under a member who was searching
              // is the wrong one.
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
        {onCreateFormula && (
          <button
            type="button"
            className={styles.indNewFormula}
            data-testid="settings-new-formula"
            onClick={() => onCreateFormula()}
            title="Build your own indicator — conditions, plain English, Pine or ThinkScript"
          >＋ New Formula</button>
        )}
      </div>

      {/* ─── THE CHART, AND THE ONE THING SELECTED IN IT ────────────────────
          ⚰️ THIS WAS TWO COLUMNS: the pane map on the left, a permanent
          inspector on the right, and a modal that grew to 880px to hold them.
          The owner reads this panel at the compact width every other tab uses,
          and a modal that resizes on the way into one tab is the cost that
          bought the second column. So the editor comes back INLINE — same
          controls, same writers, rendered under the row that owns them — and
          the panel is one vertical flow again. */}
      <div className={styles.cdOne} ref={listRef}>
      {mode === 'active' ? (<>
        {/* ─── THE PANE MAP ──────────────────────────────────────────────── */}
        {/* ⚠️ `volumeRef` STAYS WITH THE VOLUME GROUP. It is the modal's scroll
            anchor for the Volume deep link, and the volume group is where Volume
            now lives — putting the ref on the first heading instead would scroll
            members to the top of the map and call it a deep link. */}
        {activeRows.length === 0 ? (
          <div className={styles.indEmpty}>
            Nothing on this chart yet. <button type="button" className={styles.indEmptyLink} onClick={() => searchRef.current?.focus()}>Search above</button> to add something.
          </div>
        ) : paneGroups.map((g) => (
          g.id === 'volume'
            ? <div key={g.id} ref={volumeRef}>{renderGroup(g)}</div>
            : renderGroup(g)
        ))}

        {/* ─── BROWSE BY CATEGORY (§19) ──────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Browse</div>
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
      </>) : (<>
        {/* ─── DISCOVERY ─────────────────────────────────────────────────── */}
        {category && (
          <div className={styles.indCatActive}>
            <span className={styles.indCatActiveName}>{category}</span>
            <button type="button" className={styles.indCatDrop} onClick={() => setCategory(null)}>All categories</button>
          </div>
        )}
        {results.length === 0 && refusals.length === 0 && (
          <div className={styles.indEmpty}>
            {query ? <>No indicator matches “{query}”.</> : <>Nothing in this category.</>}
          </div>
        )}
        {groups.map((c) => (
          <section key={c} className={styles.section}>
            <div className={styles.sectionLabel}>{c}</div>
            <ul className={styles.resList} role="listbox" aria-label={c}>
              {results.filter((r) => r.category === c).map(renderResult)}
            </ul>
          </section>
        ))}
        {/* Saved, and not offered — with the gate's own reason, verbatim. Rendered
            only when something was actually refused, so a member whose formulas
            all install sees no heading about nothing. */}
        {refusals.length > 0 && (
          <section className={styles.section} data-testid="user-definition-refusals">
            <div className={styles.sectionLabel}>{REFUSED_CATEGORY}</div>
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
      </>)}
      </div>
    </div>
  )
}
