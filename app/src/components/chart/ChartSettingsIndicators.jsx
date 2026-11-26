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
import { withoutGuardIds } from './engine/ast/guardIdText'
import { orderCategories } from './technicalCategories'
import OptionsSourcePicker from './OptionsSourcePicker'
import { Fragment, cloneElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  readEnabled, indTarget, signTarget, styleInputKeys, hiddenPlotOnlyInputKeys,
  fieldsForInstance, sectionize, initialCollapsed, evalActiveWhen,
  visiblePresets, isPlotHidden, textInputCommit, textInputDraft,
} from './indicatorRegistry'
import { plotTitlesOf } from './engine/pinePresentation.js'
// ⭐ UCT RS Phase 3, unit 3-02b — what the LIVE server row declares, read the way
// the settings dialog and the phone sheet read it (3-02), so a `requiresServer`
// control, option or preset stays hidden here too until the server can answer it.
import {
  serverDeclares, subscribeServerDefinitions,
  // ⭐ RS split U1 — the definition-level gate for the Browse catalogue.
  isCatalogRowOffered, serverDefinitionsVersion,
} from './engine/serverCompute'
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
  securityResults, breadthResults, withLibraryMetadata, marketIndicatorResults, resultsForTab, liveDiscoveryRows, FUNDAMENTALS_STATUS,
  glyphNameOf, glyphFamilyOf, fundamentalResults, economicResults, libraryTabsFor, featureResults,
} from './discoveryCatalog'
import useFundamentalsCatalog from './engine/useFundamentalsCatalog'
import useEconomicCatalog from './engine/useEconomicCatalog'
import UIcon from '../ui/UIcon'
import Switch from '../ui/Switch'
// ⛔ NOT A SECOND SEARCH. `useSymbolDiscovery` is the SAME hook `SourceField`'s
// picker uses — same two endpoints, same debounce, same abort discipline, same
// facade adapters — so "what does QQQ match" has one answer on both surfaces.
import useSymbolDiscovery from './useSymbolDiscovery'
// ⛔ THE SEARCH AND THE ADD, IMPORTED FROM THE DIALOG THAT ALREADY OWNS THEM.
// See the header — this is the reuse, and it is why this file has no `q.trim()`
// in it and no second `setIndicatorEnabled` call.
import { matches, isRowOn, toggledRow, rowVisibility } from './IndicatorLibraryDialog'
// Words a description carries that name no indicator (the word-by-word search fallback skips them).
const SEARCH_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'is', 'it', 'to', 'when', 'while',
  'with', 'above', 'below', 'over', 'under', 'than', 'crosses', 'cross', 'day', 'days', 'bar', 'bars', 'price', 'close',
  'my', 'me', 'show', 'mark', 'line', 'up', 'down', 'goes', 'is', 'are', 'at', 'for', 'from', 'by'])
import { isTouredFirstAdd } from './legend/indicatorTour'
import IndicatorHistoryButtons from './IndicatorHistoryButtons'
import UnavailableIndicators from './UnavailableIndicators'
import { legacyInstanceId } from './engine/instances'
import {
  addInstance, removeInstance, setIndicatorEnabled, setInstanceHidden, findInstance,
  setInstanceAppearance, setInstanceCalculationTimeframe, setInstanceVisibility,
  duplicateInstance,
} from './engine/instanceControls'
import {
  CALC_TIMEFRAMES, calcTimeframeOf, calcTimeframeLabel, frameRelation, gatedReason,
  VISIBILITY_PRESETS, visibilityChoices, visibilityOf, visibilitySummary, isVisibleOnTimeframe,
} from './engine/instanceTimeframe'
import { calcTimeframeCapability, CAPABILITY_WORDS } from './engine/calcTimeframeCapability'
import { LINE_WIDTH_CHOICES, LINE_STYLE_CHOICES } from './engine/presentation'
import { tfLabel } from './timeframes'
import { CLEAN } from './engine/repaintVerdict'
// ⭐ UCT SIGNATURE (owner 11-15, the approved Chart Settings Lab). The tab's look lives in its OWN
// module; `modalStyles` is the window's, used here only for the shared "Soon" tag.
import modalStyles from './ChartSettingsModal.module.css'
import ui from './ChartSettingsIndicators.module.css'
import { kindOf as definitionKindOf, copyVerdict } from './builder/definitionActions'
import { indicatorTemplatesEnabled } from './builder/indicatorTemplates'

/** `styles.<name>` → `"<name> <hashed look>"`. The plain word is the stable hook tests, the UCT
 *  Agent's guide and `[class*="insRowName"]`-style queries find; the hashed class is the look,
 *  from `ChartSettingsIndicators.module.css` only — so the window's older `ins*` rules can never
 *  leak onto this tab. A name with no rule in the module is just the hook. */
const styles = new Proxy({}, {
  get: (_, k) => (typeof k === 'string' ? (ui[k] ? `${k} ${ui[k]}` : k) : undefined),
})

/** The small line icons this tab draws (16-unit grid, 1.4 stroke, `currentColor`). */
const PATHS = {
  plus: 'M8 3v10M3 8h10',
  gear: 'M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1',
  eye: 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  eyeoff: 'M2 2l12 12M6.4 6.5a2 2 0 0 0 2.9 2.9M4.2 4.3C2.6 5.5 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.4-1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.3',
  x: 'M4 4l8 8M12 4l-8 8',
  chev: 'M5 6.5 8 9.5l3-3',
  chevr: 'M6.5 4.5 10 8l-3.5 3.5',
  back: 'M10 4 6 8l4 4',
  dup: 'M7 5.5h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 12V7A1.5 1.5 0 0 1 7 5.5zM3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H11',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  send: 'M3 8h9M8.5 4.5 12 8l-3.5 3.5',
  search: 'M7 2.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4zM10.2 10.2 13.5 13.5',
  spark: 'M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z',
}

const Icon = ({ name, size = 15, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth={name === 'more' ? 2.4 : 1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
)
const SOON = 'Coming soon'

/** ⭐ PHASE 4 — the "Your indicators" tab (`discoveryCatalog.tabOf` files a member's
 *  own formula under `formulas`, which `resultsForTab` already answers). */
const YOUR_INDICATORS_TAB = Object.freeze({ key: 'formulas', label: 'Your indicators' })
/** ⭐ MEMBERS (2026-11-16) — what other members published, shown here instead of only on a
 *  page of its own (`IndicatorMembersTab`). Not a catalogue category: its rows are not in
 *  `results`, so a universal search does not list them; the tab filters by the same box. */
export const MEMBERS_TAB = Object.freeze({ key: 'members', label: 'Members' })
/** ⭐ UCT (2026-11-16) — the house set (`IndicatorHouseTab`): indicators UCT built and checked
 *  bar by bar. Like Members, not a catalogue category; it sits just before Members. */
export const HOUSE_TAB = Object.freeze({ key: 'uct', label: 'UCT' })
import SourceField from './SourceField'
// FT-070 / COV-11 — save / apply indicator templates (renders nothing unless
// VITE_INDICATOR_TEMPLATES_ENABLED=1; see IndicatorTemplatesBar.jsx).
import IndicatorTemplatesBar from './IndicatorTemplatesBar'
import { availableStyles, resolvePlotStyle, PLOT_STYLE_CHOICES, resolveSignColors } from './engine/presentation'
// ⭐ THE COMPOSED CLASSIFIER — breadth AND market indicators, ONE authority.
// ⚰️ This used to import `symbolFamily` (breadth only). Every call site here asks
// about a symbol that may now come from either catalogue, so asking the breadth-only
// function would classify a Cboe volatility index as a plain security and offer it
// candles for the wrong reason. `canonicalFamily` composes both and is fail-closed
// until both registries have landed.
import useMarketIndicators, { presentationFamily } from '../../hooks/useMarketIndicators'
import useBreadthSymbols from '../../hooks/useBreadthSymbols'
import { POPULAR_RESULTS, INDICES_PRESET } from './symbolSearchModel'
import {
  resolveDisplayTarget, displayTargetOptions, hasExplicitTarget, automaticTargetOf,
} from './engine/displayTarget'
import { sourceInputsOf, parseSource } from './engine/sourceRef'
import { ohlcCapableFor, sourceCapabilityFor } from './engine/styleCapability'
import { setInstancePlotStyle, setInstanceDisplayTarget, setInstanceDotSize, dotPlotsOf, DOT_SIZE_OPTIONS,
  instanceDotSizeReading, DOT_SIZE_MIXED } from './engine/instanceControls'
// ⭐ UCT RS PHASE 2a VISUAL (A6) — the Inspector's Preset row reads and writes
// through the ENGINE's preset helpers, the ones the settings dialog and the phone
// sheet use, so the three surfaces cannot name different presets for one instance.
import { applyPresetInputs, presetsOf, detectPreset, CUSTOM_PRESET } from './engine/instanceControls'
import IndicatorMembersTab from './IndicatorMembersTab'
import IndicatorHouseTab from './IndicatorHouseTab'
// ⭐⭐ THE PANE MAP, AS A READ. `chartDataMap` asks `resolveDisplayTarget`,
// `paneOwnerOf`, `paneOwnKeys` and `paneOwnersNeeded` — the same four answers
// `StockChart` hands `computePaneLayout` — so this component never forms its own
// opinion about where anything draws. See that file's header for why grouping
// from a label or a summary string would be a lie nobody notices.
// ⭐ AND `paneRowMeta` IS THE SAME READ ONE LAYER DOWN — what ONE row inside one
// group is called, and what it reads. It lives beside `paneMap` because a row's
// NAME depends on the pane it is filed under (`EMA 20` inside QQQ, `EMA 20 · QQQ`
// on Price), which makes it a placement answer like every other in that file.
import { paneMap, paneRowMeta, activeIndicatorRows } from './chartDataMap'
// ⭐ THE ONE REORDER WRITER. Drag and Move up / Move down both end here, so the
// two paths cannot produce different stored states — asserted in
// `engine/__tests__/paneOrder.test.js`.
import { movePane, movePaneTo } from './engine/paneOrder'
import { moveSeriesWithinPane, moveSeriesTo, canMoveSeries } from './engine/paneSeriesOrder'
import { safeCssColour } from './engine/objectColour'
import { tagRestatesName } from './shortTag'
import YourIndicatorActions from './YourIndicatorActions'

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

// ⭐ `ohlcCapableFor` / `sourceCapabilityFor` moved to `engine/styleCapability.js` (2026-10-27),
// shared with the Agent's `setPlotStyle` (I-2) so the two offer one set of styles.

/** `overlay-<i>` → the instance id slot `i` was adopted as, when it was. */
function aliasRowId(rowId, settings) {
  if (typeof rowId !== 'string') return rowId
  const m = /^overlay-(\d+)$/.exec(rowId)
  if (!m) return rowId
  const slot = Array.isArray(settings?.overlays) ? settings.overlays[Number(m[1])] : null
  return slot && typeof slot.adopted === 'string' ? slot.adopted : rowId
}

// A host feature's row id in the structure list. Namespaced so it can never
// collide with an indicator row id (`ovl:0`, `inst:rsi:1`, `overlay-2`, …).
const featureRowId = (id) => `feature:${id}`

// A result key as an id fragment. Injective (every non-word character becomes its
// code point), so two keys can never share an id — `technical:macd` and a ticker
// `TECHNICAL_MACD` stay apart.
const resultIdSafe = (key) => String(key).replace(/[^A-Za-z0-9]/g, (ch) => `_${ch.codePointAt(0)}_`)

export default function ChartSettingsIndicators({
  rows,
  settings,
  onChange,
  registry,
  // ⭐ A1.2 — the chart's indicator Undo stack (`indicatorHistoryStore`); absent ⇒ no buttons.
  historyKey = null,
  historyUserId = null,
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
  // `volumePaneRequired` needs `volumeSeparatePane` / `blankVolume` / `shown`, and
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
  // ⭐ UCT SIGNATURE R2 (owner Option 1, 2026-11-16) — `onCreateFormula(opts?)` is now the
  // window's ONE "✦ Create indicator" button, opening the New formula window on its start view.
  // `opts.description` (the search text, from "Build … with the UCT Agent") is PRE-FILLED into
  // that view's Describe it box and never sent. `onCreateIndicator` is still accepted (hosts pass
  // it) but this window no longer offers the separate Create Indicator door.
  // eslint-disable-next-line no-unused-vars
  onCreateIndicator = null,
  // (door) => void: open the New formula window on 'pine' | 'image' | 'formula' (the name master
  // uses for the same doors). Absent ⇒ the "Or …" links under the UCT Agent row are not shown.
  onOpenBuilderDoor = null,
  // ⭐ THE TIMEFRAME THE CHART IS ON, when the host knows it. Only ever used to SAY
  // something (a calculation timeframe that cannot draw on this chart, a Custom
  // visibility seeded from where the member is) — never to decide what is stored.
  // Absent on the grid, which simply shows no such note.
  chartTf = null,
  // ⭐ HOST FEATURES — the chart-attached research surfaces the HOST renders (a
  // /charts ChartWidget: the Earnings Strip, Company Info). `{ items, add,
  // remove, setOpen }` from `pages/charts/widgets/chartFeatures.js`.
  // ⛔⛔ NOT CHART SETTINGS. Every write goes to the host's own callbacks — never
  // `onChange` — and these rows never enter `paneMap`, pane order or the legend.
  // Absent ⇒ no Research tab and no feature rows, which is every other host.
  chartFeatures = null,
  // Opened from the chart's own "Add to Chart" control: land IN the add surface
  // with the caret in search, rather than on the structure list.
  openAdd = false,
  // ⭐ UCT RS Phase 4 (4-11) — `onFirstAdd(defId)`: an add here made the FIRST live
  // instance of a definition that declares `meta.tour` (`isTouredFirstAdd`, the
  // library's own rule: never a re-enable, never a second instance). The HOST
  // decides whether and when the tour shows (seen, claimed, nothing open over the
  // chart). Absent ⇒ nothing reported.
  onFirstAdd = null,
  // ⭐ PHASE 4 — UNIFIED EDITING: `{canModify(), modify(defId), editFormula(defId),
  // customCopy(def, inputs)}` from the host (it reaches the chart's toolbar). Absent ⇒
  // the inspector offers only instance-level actions, exactly as before.
  definitionDoors = null,
}) {
  // ⭐ The prefix for each catalogue result's state id (`aria-describedby`).
  const resultIdBase = useId()
  const soonDescId = `${resultIdBase}-soon`
  // 'active' — what the chart draws, plus the ways in.
  // 'browse'  — the catalogue, entered by focusing/typing in search or picking a
  //             category, left by Back, Escape or clearing the box.
  const [mode, setMode] = useState(() => (openAdd ? 'browse' : 'active'))
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
  // ⭐ how many UCT house indicators match a search across every tab (the UCT set is its own file)
  const [houseMatchCount, setHouseMatchCount] = useState(0)
  // ⛔ SEEDED FROM `openRowId`, AND `useState`'s INITIALISER IS THE WHOLE POINT.
  // The modal is unmounted when closed (`if (!open) return null`), so this
  // component is fresh on every open and the initial value IS the deep link. An
  // effect would open the row a frame LATER — a visible jump on a surface the
  // member reached by clicking a gear that promised to land there.
  // ⭐ A LEGACY ADDRESS FOR AN ADOPTED AVERAGE LANDS ON ITS INSTANCE. The legend and
  // older deep links spell a default average `overlay-<i>` (via `ma:<i>`); after
  // adoption (`maAdoption.js`) that row is the instance `ovl:<i>`, and the slot
  // itself says which — so the gear still opens the average it was clicked on.
  const [selected, setSelected] = useState(() => aliasRowId(openRowId, settings))
  // Drag state: the key being dragged, and the pane it would land above.
  // ⚠️ A REF **AND** STATE. The ref is what the drag handlers read (they fire
  // between renders); the state is only what paints the indicator.
  const dragKeyRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropBefore, setDropBefore] = useState(null)   // rowId — ONE at a time (§11)
  /* ⛔⛔ THE SERIES DRAG KEEPS ITS OWN THREE, AND IT IS NOT TIDINESS. `dragging` /
     `dropBefore` above belong to ARRANGE, which reorders PANES and writes
     `paneOrder`; these reorder SERIES inside one pane and write
     `paneSeriesOrder`. The two modes cannot be on screen at once today — which is
     exactly the argument for not sharing the variables, because the day one of
     them changes, a shared `dropBefore` is a pane key being read as a row id by a
     writer that will happily accept it. Two orders, two states.
     ⚠️ `seriesArmed` IS THE PRECISION RULE (§5). `draggable` goes on the ROW so
     the drag ghost is the row rather than eight pixels of dots — but only after
     the GRIP has been pressed, so a member reaching for `SMA 200` to edit it
     cannot start a reorder by moving the mouse two pixels mid-click. */
  const seriesDragRef = useRef(null)                  // { rowId, paneKey }
  const [seriesArmed, setSeriesArmed] = useState(null)
  const [seriesDrag, setSeriesDrag] = useState(null)  // rowId being carried
  const [seriesDrop, setSeriesDrop] = useState(null)  // { paneKey, beforeId|null }
  // ⭐ THE TEMPORARY GOLD LANDING MARK. `search → add → SEE IT LAND` is the whole
  // promise of a right-side Add surface, and the thing that lands is a row in a
  // list the member is already looking at. A toast would announce it somewhere
  // else; this tints the actual row for a beat and then stops.
  const [landed, setLanded] = useState(null)
  // ⭐ UCT SIGNATURE — panel-local view state only (nothing here is stored): the panes a member
  // folded, the editor's ⋯ menu, and the row the list's ONE tab stop sits on. In a single column
  // ↑/↓ move that focus; Enter (or a click) opens the row's editor.
  const [foldedPanes, setFoldedPanes] = useState({})
  const [moreOpen, setMoreOpen] = useState(false)
  const [focusRow, setFocusRow] = useState(null)
  /** The row whose editor was just left — its name button takes focus back in the list. */
  const returnFocusRef = useRef(null)
  /** The editor's ⋯ menu and its button — a press anywhere else closes the menu. */
  const moreRef = useRef(null)
  useEffect(() => {
    if (!moreOpen) return undefined
    const doc = moreRef.current?.ownerDocument || document
    const onDown = (e) => { if (!moreRef.current || !moreRef.current.contains(e.target)) setMoreOpen(false) }
    doc.addEventListener('mousedown', onDown, true)
    return () => doc.removeEventListener('mousedown', onDown, true)
  }, [moreOpen])
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
        const el = listRef.current?.querySelector(`[data-row-id="${CSS.escape(aliasRowId(openRowId, settings))}"]`)
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
  /** The row id whose arrival should take keyboard focus — see the effect after the landing one. */
  const focusLandedRef = useRef(null)
  /** The tab's own root, so the focus hand-off can tell "lost to the add" from "put elsewhere". */
  const tabRootRef = useRef(null)
  // ⭐ UCT SIGNATURE — a slot in the Chart Settings window's OWN header row (just before its ✕), so
  // "+ Add indicator" sits beside the section title, as in the lab. Made and removed by this tab;
  // nothing else in the window's header is touched. No window header (a bare mount) ⇒ no slot,
  // and the button renders in a row of its own instead.
  const [headSlot, setHeadSlot] = useState(null)
  useLayoutEffect(() => {
    const root = tabRootRef.current
    const win = root && root.closest ? root.closest('[data-guide="chartSettings"]') : null
    const close = win ? win.querySelector('[data-modal-close]') : null
    if (!close || !close.parentNode) return undefined
    const slot = close.ownerDocument.createElement('span')
    slot.className = ui.headSlot || ''
    // inline too, so a style reload can never leave the slot unstyled in a live window
    slot.style.cssText = 'flex:1 1 auto;display:flex;justify-content:flex-end;align-items:center;padding-right:6px;min-width:0'
    slot.setAttribute('data-indicators-head', '')
    close.parentNode.insertBefore(slot, close)
    setHeadSlot(slot)
    return () => { slot.remove(); setHeadSlot(null) }
  }, [])

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
  // ⭐ THE CATEGORY STRIP SAYS WHETHER IT OVERFLOWS. The five categories fill the
  // desktop column almost to its edge, so the right-hand "more this way" fade is
  // drawn only when a narrower panel really makes the strip scroll. A DOM
  // attribute, not state: it restyles one element and must not re-render the panel.
  const tabsObserver = useRef(null)
  const tabsCheck = useRef(null)
  const tabsRef = useCallback((el) => {
    if (tabsObserver.current) { tabsObserver.current.disconnect(); tabsObserver.current = null }
    tabsCheck.current = null
    if (!el) return
    const check = () => { el.dataset.overflowing = el.scrollWidth > el.clientWidth + 1 ? 'true' : 'false' }
    tabsCheck.current = check
    check()
    if (typeof ResizeObserver === 'function') {
      tabsObserver.current = new ResizeObserver(check)
      tabsObserver.current.observe(el)
    }
  }, [])
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
    focusLandedRef.current = id
  }, [rows])

  // ─── …AND KEYBOARD FOCUS LANDS WITH IT (2026-11-08) ──────────────────────
  //
  // ⚰️ MEASURED: Enter on a result added it, the Add surface closed (the add is
  // finished — see `addRow`), the button that had focus left the DOM with it, and
  // focus fell to <body>. A keyboard member then had to Tab from the top of the
  // page to reach the series they had just made.
  //
  // ⭐ SO FOCUS GOES TO THE NEW ROW ITSELF — its name button in the structure
  // list, which is selected and therefore already showing its Inspector on the
  // right; ↑/↓ walk on from there and Tab reaches the Inspector. At the narrow
  // layout the list is not on screen (the Inspector is the view), so it goes to
  // the Inspector's first control instead (its Back arrow).
  //
  // ⛔ ONLY WHEN FOCUS WAS LOST TO THE ADD, never stolen from somewhere the member
  // put it: it moves when focus is on <body>, on a node no longer in the
  // document, or inside (or around) this tab. Keyed on the render AFTER the
  // landing effect's own state writes, so the row and the Inspector exist.
  useEffect(() => {
    const id = focusLandedRef.current
    if (!id) return
    focusLandedRef.current = null
    if (typeof document === 'undefined') return
    const active = document.activeElement
    const root = tabRootRef.current
    const lost = !active || active === document.body || !active.isConnected
      || (!!root && (root.contains(active) || active.contains(root)))
    if (!lost) return
    // ⭐ UCT SIGNATURE (one column): the new row's EDITOR is the view after an add, so focus goes
    // to its first control (← All indicators); the list is mounted but hidden behind it.
    const panel = document.getElementById(inspectorDomId(id))
    const target = panel && panel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    try { target?.focus() } catch { /* a node that cannot take focus simply does not */ }
  }, [selected, narrowView, landed])

  // ⭐ BACK TO THE LIST LANDS ON THE ROW YOU LEFT — its name button, so ↑/↓ carry on from there.
  useEffect(() => {
    const id = returnFocusRef.current
    if (!id || selected) return
    returnFocusRef.current = null
    const btn = listRef.current
      ? Array.from(listRef.current.querySelectorAll('[data-row-primary]')).find((el) => el.getAttribute('data-row-primary') === id)
      : null
    try { btn?.focus() } catch { /* noop */ }
  }, [selected])

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
  // ⭐ RS split U1 — a `meta.requiresServer` definition is subtracted until the
  // live server lists it (`isCatalogRowOffered`), the same way and at the same
  // place as `hidden`; `serverVersion` moves when the answer lands.
  const serverVersion = useSyncExternalStore(subscribeServerDefinitions, serverDefinitionsVersion, () => 0)
  const catalog = useMemo(
    () => {
      const hidden = hiddenLibraryIds(settings)
      return [
        ...BUILT_IN_ROWS.filter((r) => !hidden.includes(r.id)).map((r) => libraryRowFor(r, settings)),
        ...catalogRows(registry).filter((r) => !hidden.includes(r.id) && isCatalogRowOffered(r, registry)),
        ...userCatalogRows(registry),
      ]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` IS the registry's version; `serverVersion` the gate's
    [registry, generation, settings, serverVersion],
  )

  // ─── ACTIVE: WHAT THE CHART IS DRAWING ────────────────────────────────────
  //
  // ⛔ IN `listAllIndicators` ORDER, UNTOUCHED (§15). That is MA overlays, then
  // the volume pane, then one row per LIVE INSTANCE in stored order, then the
  // carved-out sections — the same order the panes and the legend read. This
  // filters; it never sorts.
  const activeRows = useMemo(
    // ⭐ A1 (D3): an engine row is LISTED while it EXISTS (`row.exists`), hidden or not —
    // `enabled` now means "shown", and a hidden indicator must stay findable here.
    // ⭐ The rule lives in `chartDataMap.activeIndicatorRows`, shared with the Agent's pane read.
    () => activeIndicatorRows(rows),
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
  // ⭐⭐ UCT SIGNATURE (owner 11-15): THE SECTION SHOWS WHAT IS ON THE CHART, and adding opens its
  // OWN Indicators window over Chart Settings. So discovery is a place again — `browse` and only
  // `browse` — and the catalogue's requests run only while that window is open.
  const discovering = mode === 'browse'
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
  // ⭐ THE SECOND CATALOGUE, fetched once per session exactly like the first.
  const marketAll = useMarketIndicators()
  // ⭐ THE THIRD CATALOGUE: historical point-in-time fundamentals, fetched once per
  // session and only while discovery is on screen.
  const fundCat = useFundamentalsCatalog(discovering)
  const fundAvailable = fundCat.status === 'available'
  // ⭐ THE FOURTH CATALOGUE: economic series (`econ:<SYMBOL>`). ⛔ DARK BY
  // CONSTRUCTION — `available` only when `/api/econ/catalog` answered 200 for this
  // member; otherwise no tab, no rows, and `libraryTabs` is `LIBRARY_TABS` itself.
  const econCat = useEconomicCatalog(discovering)
  const econAvailable = econCat.available
  // ⭐ THE HOST'S FEATURES, as discovery rows. Absent host ⇒ `[]` ⇒ the same tab
  // arrays as before, by identity (`libraryTabsFor`).
  const featureItems = chartFeatures && Array.isArray(chartFeatures.items) ? chartFeatures.items : null
  const featureRows = useMemo(() => featureResults(featureItems), [featureItems])
  // What is ADDED, in descriptor order — the left list's last groups.
  const addedFeatures = useMemo(
    () => (featureItems || []).filter((f) => f && f.enabled),
    [featureItems],
  )
  // ⭐ PHASE 4 — "YOUR INDICATORS": the member's own saved definitions get their own
  // tab, FIRST, whenever they have any — find a saved indicator, see whether it is on
  // this chart, add it, open it, edit it or copy it, without going through a creation
  // flow. (The old `Formulas` browse tab was retired when "New Formula" was the only
  // thing to do with a formula; now there is something to find.)
  const ownFormulaCount = useMemo(() => userCatalogRows(registry).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` is the install counter (see above)
    [registry, generation])
  const libraryTabs = useMemo(() => {
    const base = libraryTabsFor({ economic: econAvailable, research: featureRows.length > 0 })
    // Members sits after the catalogue's own tabs, so the tab a member lands on is unchanged.
    return ownFormulaCount > 0 ? [YOUR_INDICATORS_TAB, ...base, HOUSE_TAB, MEMBERS_TAB] : [...base, HOUSE_TAB, MEMBERS_TAB]
  }, [econAvailable, featureRows.length, ownFormulaCount])
  // ⚠️ A TAB ARRIVING LATE (`Economic`, once its catalogue answers) widens the strip's
  // CONTENT without resizing the strip, so the ResizeObserver never re-measures.
  useLayoutEffect(() => { if (tabsCheck.current) tabsCheck.current() }, [libraryTabs])

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
    // ⭐ THE LIBRARY BLOCK RIDES THE SAME FETCH: its rows carry each series' description and
    // its universes carry first/last — the row's hover and the "data through" line.
    const brdLib = breadthAll && typeof breadthAll.library === 'function' ? breadthAll.library() : null
    const brdUniverses = brdLib && Array.isArray(brdLib.universes) ? brdLib.universes : []
    const brd = breadthAll && typeof breadthAll.all === 'function'
      ? breadthResults(withLibraryMetadata(breadthAll.all(), brdLib), { tf: TF, bars: BARS, universes: brdUniverses }) : []
    // ⭐ THE MARKET INDICATORS BROWSE TOO, and through the SAME shapers — so a
    // browsed row and a searched row are the same object with the same capability
    // and the same create door, which is the invariant the browse-add no-op broke.
    const mkt = marketIndicatorResults(marketAll.rows, { tf: TF, bars: BARS, universes: brdUniverses })
    // ⭐ FUNDAMENTALS BROWSE THROUGH THE SAME DOOR — their rows are results with a
    // `create` descriptor, so click-to-add, search and grouping need nothing new.
    const fnd = fundAvailable ? fundamentalResults(fundCat.list) : []
    // ⭐ ECONOMIC SERIES, same door (browse AND search: `liveDiscoveryRows` matches
    // browsed rows against the query, and `resultByKey` below finds them on click).
    const eco = econAvailable ? economicResults(econCat.list) : []
    // ⭐ RESEARCH browses and searches through the same door — `liveDiscoveryRows`
    // matches browsed rows against the query with the catalogue's own `matches`,
    // so `earnings` / `company` find them by name and tags with no special case.
    return [...secs, ...idx, ...brd, ...mkt, ...fnd, ...eco, ...featureRows]
  }, [breadthAll, marketAll.rows, fundAvailable, fundCat.list, econAvailable, econCat.list, featureRows])

  // ⚰️⚰️ THE RESULT BEHIND EVERY DISCOVERY ROW ON SCREEN — AND **BROWSE** USED TO
  // BE MISSING FROM IT, WHICH KILLED THREE OF THE FIVE TABS.
  //
  // `addRow` is kind-blind on purpose: it looks the clicked row's key up here,
  // and a hit goes to `createFromResult` (the ONE composition that honours a
  // `create` descriptor) while a miss falls through to `addInstance(row.id)`.
  // That fall-through is correct for a CATALOGUE row, whose id names a real
  // engine definition. It is a silent no-op for a ticker: there is no definition
  // called `SPX`, so `addInstance` refuses BY IDENTITY, `commit` sees
  // `next === settings`, and the click writes nothing.
  //
  // ⛔ AND THE MAP WAS BUILT FROM THE **QUERY'S** RESULTS ALONE. With no query
  // there are none — `results` swaps in `browsed` for exactly that case — so a
  // member who clicked the `Indexes` tab and pressed `S&P 500 Index` was clicking
  // a row whose result this lookup had never been told about. Measured on master:
  // Technical added; Symbols, Indexes and Breadth were dead through BOTH doors
  // (the `＋ Add` is an `aria-hidden` span, so it bubbles to the same handler).
  //
  // ⭐ SO THE MAP COVERS WHAT IS ON SCREEN, WHICHEVER HALF THAT IS. No new
  // dispatcher, no second add path: the fix is that the UI can now find the
  // result for a row it is already rendering. The query's answer overwrites the
  // browsed one on a key collision — the same precedence `results` applies a few
  // lines below, so the row a member sees and the result it creates from are the
  // same object.
  const resultByKey = useMemo(() => {
    const m = new Map()
    for (const res of browsed) if (res && res.key) m.set(res.key, res)
    for (const res of symbolResults) if (res && res.key) m.set(res.key, res)
    return m
  }, [browsed, symbolResults])

  const results = useMemo(() => {
    let byQuery = catalog.filter((r) => matches(r, query))
    // Owner 11-16: a sentence ("rsi below 30 above the 200 day") matches nothing as a whole phrase — fall back to
    // its meaningful words so the closest indicators (RSI) still show above the "Build it with the UCT Agent" row.
    if (!byQuery.length && /\s/.test(String(query || '').trim())) {
      const words = String(query).toLowerCase().split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !SEARCH_STOP_WORDS.has(w))
      if (words.length) byQuery = catalog.filter((r) => words.some((w) => matches(r, w)))
    }
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
    // ⚰️⚰️ THE PRODUCTION DEFECT THIS LINE CAUSED, AND THE ONE IT NOW PREVENTS.
    //
    // It read `query ? symbolRows.rows : browsed` — so the instant a member TYPED,
    // every browsed row was DISCARDED and the list became whatever
    // `/api/ticker-search` happened to return. `browsed` is the only path carrying
    // `marketIndicatorResults(marketAll.rows)`, so searching "AAII" made the Market
    // Indicators catalogue irrelevant and the AAII Sentiment Survey's existence
    // depended entirely on one remote reply — whose market-indicator injection is
    // wrapped in `except Exception: pass` server-side.
    //
    // ⭐ THE ASYMMETRY IS WHAT MADE IT LOOK LIKE A DATA BUG. The AAII Bull-Bear
    // Spread kept appearing because it ALSO comes from `useBreadthSymbols`, which
    // needs no network at all. One AAII row present and the other absent reads as
    // "the Survey is missing"; it was really "the Survey has only one door and that
    // door is remote".
    //
    // ⛔ SO THE QUERY UNIONS BOTH SOURCES, exactly as `resultByKey` below already
    // does for the CLICK path. That fix — browse + query in one map — was made for
    // this same class of bug (a browsed row the lookup had never been told about);
    // the LIST kept the old either/or and inherited it. Same rule, both places.
    //
    // ⚠️ THE REMOTE ANSWER STILL LEADS. It is ranked by a server that knows more
    // than a substring test, and the dedupe below keeps the first of any key — so a
    // row present in both sources reads exactly as it did before.
    const live = liveDiscoveryRows(query, symbolRows.rows, browsed, matches)
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
    // ⭐ 2026-10-01 — THE TECHNICAL HEADINGS IN THEIR FIXED ORDER
    // (`technicalCategories.js`), never in whatever order the catalogue happened
    // to list its rows; any other heading keeps its first-appearance place after.
    const order = orderCategories([...new Set(tabResults.map((r) => r.category))])
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


  // ⭐ A HOST FEATURE IS ADDED BY ITS HOST, and an ACTIVE one is not a dead row:
  // clicking it selects its management row, which is where Remove (and, for
  // Company Info, Show / Collapse) lives. Either way the member lands on it.
  const openFeature = useCallback((row) => {
    if (!row.enabled) chartFeatures?.add?.(row.featureId)
    setMode('active'); setQuery(''); setTab('technical'); setTabPinned(false)
    setSelected(featureRowId(row.featureId))
    setLanded(featureRowId(row.featureId))
    if (narrow) setNarrowView('inspector')
  }, [chartFeatures, narrow])

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
      if (typeof onFirstAdd === 'function' && isTouredFirstAdd(row, settings, next, registry)) {
        try { onFirstAdd(row.id) } catch { /* a tour never blocks an add */ }
      }
      return true
    }
    // ⛔ BEFORE `armAdd` AND BEFORE `resultByKey`: a feature row IS in the map
    // (it browses with the others) but has no `create` descriptor, and its add
    // writes the host's dock, not chart settings.
    if (row.kind === 'feature') { openFeature(row); return }
    armAdd()
    const res = resultByKey.get(row.key)
    if (res) {
      if (!commit(createFromResult(settings, res, registry))) pendingAddRef.current = null
      return
    }
    const revivable = !row.builtIn && !!findInstance(settings, legacyInstanceId(row.id))
    // ⛔ A CARVED-OUT ROW (Volume Profile) HAS NO DEFINITION TO INSTANTIATE.
    // `addInstance` refuses such an id by returning `settings` unchanged, so this
    // door used to swallow the click whole (reproduced 2026-10-01,
    // `__tests__/volumeProfileAdd.test.jsx`). Its own writer is `toggledRow`,
    // which flips the settings slice that IS its existence — the canvas overlay
    // keeps its architecture and simply gets turned on.
    const next = (row.builtIn || revivable || row.carvedOut)
      ? toggledRow(row, settings, registry)
      : addInstance(settings, row.id, registry)
    // Identity, not deep equality: a REFUSED write returns `settings` itself, and
    // persisting a no-op would mark the preset custom for a click that did nothing
    // — and must leave the member's current selection alone, hence the disarm.
    if (!commit(next)) pendingAddRef.current = null
  }, [settings, onChange, registry, resultByKey, armAdd, leaveBrowse, openFeature, onFirstAdd])

  /** ⭐ MEMBERS — put a just-installed copy on this chart: the same write a result row's
   *  first add makes for a definition (`addInstance`), and the same landing (browse closes).
   *  A refused write returns `settings` itself and persists nothing. */
  const putInstalledOnChart = useCallback((defId) => {
    if (!defId || !registry?.getDefinition?.(defId)) return false
    const next = addInstance(settings, defId, registry)
    if (next === settings) return false
    onChange?.({ ...next, preset: 'custom' })
    leaveBrowse()
    return true
  }, [settings, onChange, registry, leaveBrowse])

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
  /**
   * Where a drop would land, from the pointer's position over one row.
   *
   * ⛔ THE MIDPOINT, NOT THE EDGE. A row is 26px tall; asking "is the pointer in
   * the top 6px" makes the last position in a pane almost unreachable, so the top
   * half means BEFORE this row and the bottom half means after it — and "after
   * the last row" is expressed as `beforeId: null`, which is the same absence
   * `moveSeriesTo` already understands as "put it last".
   */
  const dropSlotFor = (group, overRowId, e) => {
    const ids = memberIds(group)
    const at = ids.indexOf(overRowId)
    if (at < 0) return null
    const box = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > box.top + box.height / 2
    return after ? (ids[at + 1] || null) : overRowId
  }

  const endSeriesDrag = () => {
    seriesDragRef.current = null
    setSeriesArmed(null); setSeriesDrag(null); setSeriesDrop(null)
  }

  const dropSeries = (group, beforeId) => {
    const held = seriesDragRef.current
    endSeriesDrag()
    // ⛔⛔ THE PANE BOUNDARY, CHECKED AT THE DOOR AS WELL AS IN THE WRITER (§9).
    // `moveSeriesTo` is already structurally safe — it steps inside ONE pane's
    // membership — but refusing here is what stops a drag that WANDERED over
    // Volume from quietly landing the row at the bottom of its own pane instead.
    // A drag that leaves its pane does nothing at all, which is the honest
    // outcome: moving a series to another pane is `Display`, and it writes a
    // different key.
    if (!held || !orderable(group) || held.paneKey !== group.id) return
    const next = moveSeriesTo(settings, group.id, memberIds(group), held.rowId, beforeId)
    if (next !== settings) onChange?.(next)
  }

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
  // ⭐ UCT RS Phase 3, unit 3-02b — THE SERVER GATE, for the one row the Inspector
  // edits. Only a `server` definition can carry a gate (`defSchema`), so only one
  // asks: selecting RSI never spends the page's one definitions GET. The snapshot
  // is memoised and frozen per definition (`serverDeclares`), so it is
  // reference-stable between landings, and the subscription re-renders the panel
  // the moment the answer lands.
  const gateDef = selectedRow && selectedRow.defId && typeof registry?.getDefinition === 'function'
    ? registry.getDefinition(selectedRow.defId) : null
  const gateId = gateDef && gateDef.compute && gateDef.compute.kind === 'server' ? gateDef.id : null
  const serverDeclared = useSyncExternalStore(
    subscribeServerDefinitions,
    () => (gateId ? serverDeclares(gateId) : null),
    () => null,
  )
  /** What the live row declares for `def` — null (nothing) for any other definition. */
  const declaredFor = (def) => (def && gateId && def.id === gateId ? serverDeclared : null)
  // A selected HOST FEATURE. Only an added one can be selected — a feature
  // removed while it was open simply stops being found, exactly like a row.
  const selectedFeature = useMemo(
    () => addedFeatures.find((f) => featureRowId(f.id) === selected) || null,
    [addedFeatures, selected],
  )

  /**
   * THE LIST'S ONE TAB STOP — the selected row, else the FIRST row.
   *
   * ⛔⛔ A ROVING TABINDEX MUST ALWAYS LEAVE EXACTLY ONE `0`. Keyed on
   * `selected` alone, a list with nothing selected (the modal opening on the
   * Add view, or the selected row leaving the chart) made every row `-1`, and
   * Tab walked straight past "Series on this chart" — the only way in was a
   * pointer. Same order as `onStructureKeys` walks, so the first Tab lands
   * where ↓ would start.
   */
  /** Every selectable row id in visual order -- what Tab enters and the arrows walk. */
  const structureIds = useMemo(
    () => [...flatRows.map((r) => r.id), ...addedFeatures.map((f) => featureRowId(f.id))],
    [flatRows, addedFeatures],
  )
  const structureTabStop = structureIds.includes(focusRow) ? focusRow
    : structureIds.includes(selected) ? selected : (structureIds[0] ?? null)

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
    // ⭐⭐ A SIGNED HISTOGRAM'S IDENTITY IS ITS **UP** COLOUR. A rail can only be
    // one colour and the series is two, so it wears the one the pane reads as
    // "this series" — the same choice the volume row makes for the same reason
    // (`StockChart`'s volume readout takes `cs.volume.upColor`).
    // ⛔ NEVER A THIRD COLOUR. The rail, the legend mark and the positive bars are
    // one identity; giving the label its own tint would make the member hunt for
    // which of three colours meant the series.
    if (row && row.instanceId) {
      const def = registry && typeof registry.getDefinition === 'function'
        ? registry.getDefinition(row.defId) : null
      const inst = findInstance(settings, row.instanceId)
      for (const plot of ((def && def.plots) || [])) {
        const sign = resolveSignColors(inst, plot, (settings && settings.candles) || null)
        if (sign && sign.up) return sign.up
      }
    }
    const f = mainColorFields(row)[0]
    const v = f ? row?.values?.[f.key] : null
    return (typeof v === 'string' && v) ? v : null
  }, [settings, registry])

  /**
   * Select a row — the list's ONE interaction.
   *
   * ⛔ BY ROW ID, NEVER BY LABEL OR INDEX. Two EMA 20s in two panes print the same
   * words; an index changes the moment a pane is reordered. The row id is the
   * instance address every write already takes.
   */
  const selectRow = useCallback((rowId) => {
    setSelected(rowId)
    setFocusRow(rowId)
    setMoreOpen(false)
    // Choosing something already on the chart means MANAGING it: leave discovery so its
    // editor takes the section.
    setMode((m) => (m === 'browse' ? 'active' : m))
    if (narrow) setNarrowView('inspector')
  }, [narrow])

  /** "← All indicators": close the editor; focus returns to that row's name in the list. */
  const backToList = useCallback(() => {
    returnFocusRef.current = selected
    setMoreOpen(false)
    setSelected(null)
    setNarrowView('list')
  }, [selected])

  /**
   * ↑ / ↓ / Home / End across the whole structure, panes included.
   *
   * ⛔ ACCESSIBILITY IS NOT THE PRICE OF MINIMALISM. The rows lost their per-row
   * gear, ✕ and chevron; they did not lose keyboard reach. Each row's name is a
   * button with a roving tabindex, so one Tab stop reaches the list and the
   * arrows walk it — and because the Inspector is driven by `selected`, moving
   * the selection IS opening the editor.
   */
  const onStructureKeys = useCallback((e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const ids = structureIds
    if (!ids.length) return
    // ⭐ UCT SIGNATURE (one column): the arrows move the list's FOCUS, not the selection — opening
    // an editor replaces the list, so walking it must not. Enter / a click on the name opens one.
    // ⛔ Only from a row's name button (or the list itself): the row's own icon buttons and the
    // grip keep their keys.
    const from = e.target && e.target.closest ? e.target.closest('[data-row-primary]') : null
    if (!from && e.target !== e.currentTarget) return
    let next = null
    if (step) {
      const at = ids.indexOf(from ? from.getAttribute('data-row-primary') : structureTabStop)
      next = at < 0
        ? ids[step > 0 ? 0 : ids.length - 1]
        : ids[Math.min(ids.length - 1, Math.max(0, at + step))]
    } else if (e.key === 'Home') next = ids[0]
    else if (e.key === 'End') next = ids[ids.length - 1]
    if (next == null) return
    e.preventDefault()
    setFocusRow(next)
    const btn = listRef.current
      ? Array.from(listRef.current.querySelectorAll('[data-row-primary]')).find((el) => el.getAttribute('data-row-primary') === next)
      : null
    try { btn?.focus() } catch { /* a node that cannot take focus simply does not */ }
  }, [structureIds, structureTabStop])

  // ─── HOST FEATURES IN THE STRUCTURE LIST ──────────────────────────────────
  //
  // ⛔⛔ NOT PANES. These groups come from the host's descriptors, never from
  // `paneMap`: they are not draggable, not in Arrange, carry no grip, no
  // micro-rail colour and no legend identity. The heading names WHERE the
  // surface renders (`Below chart`, `Side panel`) — the same rule as a pane
  // heading — and only a destination holding an ADDED feature is listed.
  const renderFeatureGroup = (f) => {
    const rid = featureRowId(f.id)
    const isSel = selected === rid
    const collapsed = f.collapsible && !f.open
    return (
      <div
        key={rid}
        role="group"
        aria-label={f.group}
        className={styles.insGroup}
        data-feature-group={f.destination}
      >
        <div className={styles.paneHead}>
          <span className={`${styles.iconBtn} ${styles.chev}`} aria-hidden="true" />
          <span className={styles.paneName}><span className={styles.insGroupHead}>{f.group}</span></span>
        </div>
        <div
          data-row-id={rid}
          data-feature-row={f.id}
          data-structure-row="true"
          data-landed={landed === rid ? 'true' : undefined}
          className={[
            styles.insRow,
            isSel ? styles.insRowSel : '',
            landed === rid ? styles.insRowLanded : '',
          ].filter(Boolean).join(' ')}
          onClick={() => selectRow(rid)}
        >
          {/* The grip slot and rail keep the name on the same column as every
              series row; both stay EMPTY — a feature is not reorderable and has
              no plot colour to show. The name is the row's roving tab stop, as
              on a series row (see `renderStructureRow`). */}
          <button
            type="button"
            className={styles.insRowPrimary}
            data-row-primary={rid}
            tabIndex={structureTabStop === rid ? 0 : -1}
            aria-current={isSel ? 'true' : undefined}
          >
            <span className={styles.insRowName} title={f.name}>{f.name}</span>
            {collapsed && <span className={styles.tfTag}>Collapsed</span>}
          </button>
          <span className={styles.insRowGripSlot} />
          <span className={styles.rowBar}><i className={styles.insRail} style={{ background: 'transparent' }} aria-hidden="true" /></span>
          <span className={styles.rowActs} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.iconBtn} aria-label={`Edit ${f.name}`} title="Settings"
              tabIndex={structureTabStop === rid ? 0 : -1}
              onClick={() => selectRow(rid)}><Icon name="gear" size={14} /></button>
          </span>
        </div>
      </div>
    )
  }

  const renderStructureRow = (row, group) => {
    const meta = paneRowMeta(row, group, settings, defOf)
    const on = rowVisible(row)
    const isSel = selected === row.id
    const tint = safeCssColour(rowColor(row))   // ⛔ only a CSS-safe colour reaches the rail (objectColour.js)
    const pick = rowColorPick(row, meta.name)
    const offHere = offOnChartTf(row)
    const rowStop = structureTabStop === row.id
    // ⛔ A PANE OF ONE HAS NOTHING TO REORDER (§11), so its grip is not a control
    // — and it is not removed either, because a row that loses its grip when a
    // sibling is deleted would shift its name 14px left under the pointer.
    const movable = orderable(group) && group.rows.length > 1
    // ⭐ THE GRIP IS SHOWN FOR EVERY ROW IN A REAL PANE, movable or not (owner
    // ruling). `orderable` is the same predicate that decides whether a pane can
    // hold an order at all, so `hidden` and `orphans` — lists of things that are
    // not drawing anywhere — still get no handle, which is right: there is no
    // rectangle for them to be ordered within.
    const isSeriesRow = orderable(group)
    const isHeld = seriesDrag === row.id
    const markBefore = seriesDrop && seriesDrop.paneKey === group.id && seriesDrop.beforeId === row.id
    const markLast = seriesDrop && seriesDrop.paneKey === group.id && seriesDrop.beforeId === null
      && group.rows[group.rows.length - 1] && group.rows[group.rows.length - 1].id === row.id
    return (
      /* ⛔⛔ THE ROW IS NOT A CONTROL; ITS NAME IS. This `<div>` was a
         `role="option"` holding the reorder grip — a `<button>`, tabbable on the
         selected row of a pane with more than one series — which is a control
         nested inside a control (axe `nested-interactive`). Moving the grip
         beside the option does not help: a listbox may own only options, and axe
         reports the button as a child it does not allow. So the list is not a
         listbox: the roving tab stop is the `<button data-row-primary>` below
         (the same ↑/↓/Home/End on the list, the same one Tab stop), and the grip
         is its sibling. Click, drag and the grip's own keys are unchanged. */
      <div
        key={row.id}
        data-row-id={row.id}
        data-def-id={row.defId || (row.path?.kind === 'indicator' ? row.id : undefined)}
        data-structure-row="true"
        data-landed={landed === row.id ? 'true' : undefined}
        data-movable={movable ? 'true' : 'false'}
        className={[
          styles.insRow,
          isSel ? styles.insRowSel : '',
          on ? '' : styles.insRowOff,
          landed === row.id ? styles.insRowLanded : '',
          isHeld ? styles.insRowHeld : '',
          markBefore ? styles.insRowDropBefore : '',
          markLast ? styles.insRowDropAfter : '',
        ].filter(Boolean).join(' ')}
        onClick={() => selectRow(row.id)}
        /* ⛔⛔ `draggable` IS ARMED, NOT STANDING. The whole row is the drag body
           — so the ghost the member carries is the thing they grabbed — but the
           attribute only appears after the GRIP took a mousedown. §5 asks whether
           whole-row dragging is safe here and the answer measured out as no: the
           row's primary job is SELECT, a click is a mousedown plus a two-pixel
           wobble, and a list where choosing an indicator sometimes reorders it is
           worse than one where reordering needs a handle. Favour precision. */
        draggable={movable && seriesArmed === row.id ? true : undefined}
        onDragStart={movable ? (e) => {
          if (seriesArmed !== row.id) { e.preventDefault(); return }
          seriesDragRef.current = { rowId: row.id, paneKey: group.id }
          try {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', row.id)
          } catch { /* jsdom has no dataTransfer */ }
          setSeriesDrag(row.id)
        } : undefined}
        onDragOver={movable ? (e) => {
          const held = seriesDragRef.current
          // ⛔ A FOREIGN PANE IS NOT A TARGET AND SAYS SO. Without
          // `preventDefault` the browser refuses the drop and shows the no-drop
          // cursor, which is the feedback §9 wants: the member finds out mid-drag
          // that a series does not move house this way.
          if (!held || held.paneKey !== group.id || held.rowId === row.id) return
          e.preventDefault()
          try { e.dataTransfer.dropEffect = 'move' } catch { /* jsdom */ }
          const beforeId = dropSlotFor(group, row.id, e)
          setSeriesDrop((p) => (p && p.paneKey === group.id && p.beforeId === beforeId)
            ? p : { paneKey: group.id, beforeId })
        } : undefined}
        onDrop={movable ? (e) => {
          e.preventDefault(); e.stopPropagation()
          dropSeries(group, dropSlotFor(group, row.id, e))
        } : undefined}
        onDragEnd={endSeriesDrag}
      >
        {/* ⭐ THE ROVING TAB STOP. No handler of its own: a click bubbles to the
            row's `onClick`, and ↑/↓/Home/End reach the list's `onKeyDown`.
            `aria-current` is what `aria-selected` said on the option. It comes
            FIRST in the DOM so Tab still lands here before the grip, exactly as
            it did when the grip was inside; `.insRowGripSlot` is drawn first by
            `order`. */}
        <button
          type="button"
          className={styles.insRowPrimary}
          data-row-primary={row.id}
          tabIndex={structureTabStop === row.id ? 0 : -1}
          aria-current={isSel ? 'true' : undefined}
        >
          {/* ⚠️⚠️ THE FULL NAME IS ON THE ROW, because the column truncates now. At
              35% `Relative Strength Index (period 14)` ellipsizes — which is
              explicitly acceptable — but the member must still be able to find out
              what it says without selecting it. `title` is this panel's existing
              convention for exactly that, and the canonical name is untouched:
              nothing is abbreviated, persisted or renamed. */}
          <span className={styles.insRowName} title={meta.name}>{meta.name}</span>
          {/* ⭐ UCT SIGNATURE — "Hidden on 5m": the row's own Show on policy leaves it off on the
              timeframe the chart is on right now (a grey tag, never gold). */}
          {offHere && (
            <span className={styles.tfTag} title={`Turned off for ${tfLabel(chartTf)} under Show on in its settings`}>
              {`Hidden on ${tfLabel(chartTf)}`}
            </span>
          )}
          {/* ⭐ THE VISIBILITY STATE: the name is struck through and the eye stays showing; the
              word is for a screen reader. */}
          {!on && <span className={styles.insRowOffTag}>Off</span>}
        </button>
        {/* ⭐⭐ THE VERTICAL COLOUR BAR (3×16, the chart legend's mark). The rail is the series'
            own colour; the window's colour swatch sits invisibly over it, so a click opens the
            same colour panel the editor's Color row opens. A row with no colour of its own keeps
            the bar's width and paints nothing. */}
        <span className={`${styles.rowBar} ${pick ? styles.hasPick : ''}`} onClick={(e) => e.stopPropagation()}>
          <i className={styles.insRail} style={tint ? { background: tint } : undefined} aria-hidden="true" />
          {pick && cloneElement(colorSwatch(pick.target, pick.label, pick.value), { tabIndex: rowStop ? 0 : -1 })}
        </span>
        {/* ⚰️⚰️ FOURTEEN ARROWS STOOD AT THE FAR RIGHT OF THIS LIST — a ↑ and a
            ↓ on every row, two of them permanently dimmed at each pane's edges.
            They were correct and they were LOUD: owner, 2026-09-17: *"with many
            indicators, this creates a repetitive column of arrows and makes the
            list feel crowded... the member should think 'I can grab this
            indicator and move it', not 'I have to find the correct tiny arrow'."*
            ⭐ ONE GRIP, ON THE LEFT, AND VISIBLE AT REST. ⚰️ It used to fade in
            on row hover, which hid the whole reorder capability behind a gesture a
            member had no reason to make and left every idle row with a blank 13px
            gutter where the slot is reserved. It is quiet rather than absent now —
            the ladder lives in `.insRowGrip` — and nothing about its geometry, its
            column or the row's spacing changed.
            ⛔ IT IS NOT THE MICRO-RAIL AND MUST NEVER BE MISTAKEN FOR IT (§4). The
            rail two pixels to its right is the series' PLOT COLOUR — an identity
            — and this is an affordance; so the grip is neutral grey, never tinted,
            and it is dots where the rail is a solid bar.
            ⛔ AND THE SLOT IS ALWAYS THERE. A pane that drops from two members to
            one would otherwise pull every remaining name 14px left.

            ⚰️ AND SO IS THE GRIP NOW — owner ruling, superseding §11's "a pane of
            one offers no grip". Drawing it only where a reorder is possible made
            the LIST's geometry a function of pane arity: four Price rows wore a
            mark and `Volume` and `US` wore a blank gutter, so the column read as
            broken rather than as informative. ⭐ THE GRIP IS THE ROW'S OWN MARK —
            *this is a plotted series* — and its INTERACTIVITY is the thing that
            varies, which is the honest split: `movable` still gates every write,
            `draggable`, the keyboard path and the tooltip.

            ⛔ A LONE SERIES WRITES NOTHING. `moveSeriesWithinPane` would return
            the same object anyway, but an inert control must not pretend: no
            `draggable`, no arrow handling, and `aria-disabled` so a screen reader
            is told the same thing the pointer is. */}
        <span className={styles.insRowGripSlot}>
          {isSeriesRow && (
            <button
              type="button"
              className={styles.insRowGrip}
              data-row-grip={row.id}
              data-grip-inert={movable ? undefined : 'true'}
              tabIndex={movable && structureTabStop === row.id ? 0 : -1}
              aria-disabled={movable ? undefined : 'true'}
              aria-label={movable
                ? `Reorder ${meta.name} within ${group.name}`
                : `${meta.name} — nothing to reorder in ${group.name}`}
              aria-keyshortcuts={movable ? 'ArrowUp ArrowDown' : undefined}
              title={movable ? 'Drag to reorder' : undefined}
              /* ⛔ THE GRIP DOES NOT SELECT, AND IT DOES NOT LET THE ROW SELECT
                 EITHER. `stopPropagation` on the click is what keeps grabbing a
                 row distinct from opening it — a member repositioning `SMA 200`
                 must not watch the Inspector swing to it. */
              onMouseDown={(e) => { e.stopPropagation(); if (movable) setSeriesArmed(row.id) }}
              onMouseUp={() => setSeriesArmed(null)}
              onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
              /* ⭐⭐ THE KEYBOARD PATH, AND IT IS NOT A CONSOLATION PRIZE. Removing
                 the arrows removed the only way a member without a pointer could
                 reorder anything, and §13 is explicit that this may not happen.
                 The grip IS the control: focus it and the up/down arrows move the
                 series, which is the established sortable pattern and, more to
                 the point, ends at `nudgeRow` — the SAME writer the old arrows
                 used and the same one the drop uses. Three doors, one
                 `paneSeriesOrder`.
                 ⛔ AT A BOUNDARY IT SIMPLY DOES NOTHING. `moveSeriesWithinPane`
                 returns the same object, so there is no write and no wrap — the
                 old disabled-arrow ghosts are not replaced by a silent surprise.
                 ⚠️ AND FOCUS FOLLOWS THE ROW. Without this a member pressing ↓
                 three times moves the series once and then loses the handle,
                 because React re-renders the list in the new order. */
              onKeyDown={(e) => {
                if (!movable) return
                const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                if (!delta) return
                e.preventDefault(); e.stopPropagation()
                if (!canNudgeRow(group, row.id, delta)) return
                nudgeRow(group, row.id, delta)
                requestAnimationFrame(() => {
                  try {
                    listRef.current
                      ?.querySelector(`[data-row-grip="${CSS.escape(row.id)}"]`)?.focus()
                  } catch { /* jsdom has no CSS.escape */ }
                })
              }}
            >
              <span aria-hidden="true">⠿</span>
            </button>
          )}
        </span>
        {/* ⭐ UCT SIGNATURE — the row's three verbs, revealed on hover / focus: settings (opens
            the editor), show / hide (the same `hidden` write as the editor's eye — a hidden row
            keeps its eye showing), and remove (the same `removeRow`). */}
        <span className={styles.rowActs} onClick={(e) => e.stopPropagation()}>
          {/* ⛔ ONE TAB STOP PER LIST: the row's own controls join the tab order only on the row
              the list's roving stop sits on (Tab walks name → grip → colour → these). */}
          <button type="button" className={styles.iconBtn} aria-label={`Edit ${meta.name}`} title="Settings"
            tabIndex={rowStop ? 0 : -1}
            onClick={() => selectRow(row.id)}><Icon name="gear" size={14} /></button>
          <button type="button" className={styles.iconBtn} data-row-vis={row.id}
            aria-label={`${on ? 'Hide' : 'Show'} ${meta.name}`} title={on ? 'Hide' : 'Show'}
            tabIndex={rowStop ? 0 : -1}
            onClick={() => setRowVisible(row, !on)}><Icon name={on ? 'eye' : 'eyeoff'} size={14} /></button>
          <button type="button" className={styles.iconBtn} aria-label={`Remove ${meta.name}`} title="Remove"
            tabIndex={rowStop ? 0 : -1}
            onClick={() => removeRow(row)}><Icon name="x" size={13} /></button>
        </span>
        {/* ⚰️⚰️ A `↑` AND A `↓` STOOD HERE ON EVERY ORDERABLE ROW — a span at
            the far right, boundary members carrying a dimmed, `aria-disabled`
            ghost so the column would not ripple as rows moved. Every word of that
            reasoning was right about the control and wrong about the LIST: seven
            indicators meant fourteen buttons and four permanent ghosts down one
            edge, and the owner read the result as *"a repetitive column of
            arrows."*
            ⭐ DRAG REPLACES THEM, AND IT REMOVES THE BOUNDARY PROBLEM RATHER THAN
            SOLVING IT (§12). There is no first-row ↑ to disable when the member
            simply drops the row where they want it.
            ⛔ WHAT DID NOT GO IS THE STEP ITSELF. `nudgeRow` is still here, on the
            grip's arrow keys — see its note — so `canMoveSeries` still answers the
            boundary question and §13's accessible Move Up / Move Down still
            exists. What left the screen is fourteen permanent icons. */}
      </div>
    )
  }

  /** The colour target the row's bar opens — the row's first colour (a signed histogram's UP
   *  colour, the same one `rowColor` paints), through the window's own swatch. Null ⇒ no picker. */
  const rowColorPick = (row, name) => {
    if (typeof colorSwatch !== 'function' || !row) return null
    if (row.instanceId && signHidesColor(row)) {
      return { target: signTarget(row.instanceId, 'upColor'), label: `${name} up color`, value: undefined }
    }
    const f = mainColorFields(row)[0]
    if (!f) return null
    return { target: indTarget(row.id, f.key), label: `${name} · ${f.label || 'Color'}`, value: row.values?.[f.key] }
  }

  /** Is this row switched off (its own Show on policy) on the timeframe the chart is on? */
  const offOnChartTf = (row) => {
    if (!chartTf || !row || !row.instanceId || !row.engineOwned) return false
    const inst = findInstance(settings, row.instanceId)
    return !!inst && !isVisibleOnTimeframe(inst, chartTf)
  }

  // ⭐ UCT SIGNATURE — ONE CARD PER PANE: a header (fold chevron · "<Name> pane" · count), then
  // its rows. ⛔ No pane-level hide / remove / "+ add here": the pane model has no such writers,
  // so the header offers only what it can do (fold is view state, never stored).
  const renderStructureGroup = (group, ref) => {
    const real = orderable(group)
    const folded = !!foldedPanes[group.id]
    const title = real ? `${group.name} pane` : group.name
    return (
    <div
      key={group.id}
      ref={ref || undefined}
      role="group"
      aria-label={group.name}
      className={`${styles.insGroup} ${(group.kind === 'orphans' || group.kind === 'hidden') ? styles.insGroupRepair : ''}`}
      data-pane-group={group.id}
      data-pane-kind={group.kind}
    >
      <div className={styles.paneHead}>
        <button
          type="button" className={`${styles.iconBtn} ${styles.chev}`}
          aria-expanded={!folded}
          aria-label={`${folded ? 'Expand' : 'Collapse'} ${title}`} title={folded ? 'Expand' : 'Collapse'}
          onClick={() => setFoldedPanes((m) => ({ ...m, [group.id]: !folded }))}
        ><Icon name={folded ? 'chevr' : 'chev'} size={16} /></button>
        {/* the bare pane name stays its own node (`insGroupHead`), the word "pane" beside it */}
        <span className={styles.paneName}><span className={styles.insGroupHead}>{group.name}</span>{real ? ' pane' : ''}</span>
        <span className={styles.paneCount}>{group.rows.length}</span>
      </div>
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
      {!folded && group.rows.map((r) => renderStructureRow(r, group))}
    </div>
    )
  }

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
                      data-guide="indicators.movePane"
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
  /** Does this row draw as a sign-coloured histogram? The ONE predicate behind
   *  both the Up/Down pair and the hiding of the single colour it replaces. */
  const signHidesColor = useCallback((row) => {
    if (!row || !row.instanceId) return false
    const def = registry && typeof registry.getDefinition === 'function'
      ? registry.getDefinition(row.defId) : null
    const inst = findInstance(settings, row.instanceId)
    if (!def || !inst) return false
    return ((def.plots) || []).some((plot) => {
      const style = resolvePlotStyle(inst, plot, {})
      const isHist = style === 'histogram' || (!style && plot.style === 'histogram')
      return isHist && !!resolveSignColors(inst, plot, (settings && settings.candles) || null)
    })
  }, [settings, registry])

  const partitionFields = useCallback((row, def, model = null) => {
    const styleKeys = def ? styleInputKeys(def) : null
    // ⭐⭐ ONE FORM MODEL (2026-11-17). Where the per-instance model answers (`fieldsForInstance`: the
    // legend dialog's, the phone sheet's, and the one `pinePresentation.test.js` holds to TradingView's
    // Inputs tab), ITS split is this split: a field it puts on Inputs is CORE here, one it puts on
    // Style is APPEARANCE. ⚰️ This modal sorted every colour to Appearance on its own rule, so RS
    // Rating's seven script colours (the five "Color" rows, Positive / Negative Area) left their
    // groups for one flat list, where TradingView shows them inline in Inputs. The house rule below
    // stays only for a field the model does not hold (a fixture row, a legacy overlay's placeholder).
    const modelInputs = model ? new Set((model.inputs || []).map((f) => f.key)) : null
    const modelStyle = model ? new Set((model.style || []).map((f) => f.key)) : null
    const isLook = (f) => {
      if (modelStyle && modelStyle.has(f.key)) return true
      if (modelInputs && modelInputs.has(f.key)) return false
      return f.appearance === true
        || f.type === 'color'
        || !!(styleKeys && styleKeys.has(f.key))
    }
    // ⭐⭐ A SIGN-COLOURED HISTOGRAM HAS NO SINGLE COLOUR, so its declared `color`
    // control is a box nothing reads: `presentedPlot` stamps `colorMode: 'sign'`
    // and the renderer paints per point from the Up/Down pair. Offering it beside
    // them would be offering a member a choice with no effect — and would leave
    // three colours on one row where the product means two.
    //
    // ⛔ THE GATE IS THE CAPABILITY, NOT THE FIELD'S NAME. `signColorControl`
    // renders exactly when `resolveSignColors` answers, and this hides exactly
    // then — one predicate, so the pair and the singleton can never both appear.
    const signedNow = signHidesColor(row)
    // ⭐ BATCH 2 — a style input only an undrawn (`hidden: true`) plot reads is a box
    // with no effect (a colour rule's index column): not offered (`hiddenPlotOnlyInputKeys`).
    const inertStyle = def ? hiddenPlotOnlyInputKeys(def) : null
    const shown = (row.fields || []).filter((f) => !(f.showIf && !f.showIf(row.values)))
      .filter((f) => !(signedNow && f.type === 'color'))
      .filter((f) => !(inertStyle && inertStyle.has(f.key)))

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
  }, [signHidesColor])

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
      out.push({ key: '__where__', label: 'Pane', value: group.name,
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
      // ⛔ PRESENTATION, NOT CAPABILITY. This is the subtitle under the row's name;
      // `canCandle` above is the gate, and it keeps the fail-closed `canonicalFamily`.
      // Reading the gate's classifier here blanked the KIND line for ordinary
      // securities until the market-indicator registry landed — a label paying the
      // price of a security decision.
      const fam = presentationFamily(parsed.symbol)
      if (fam === 'breadth') return BREADTH_CATEGORY
      if (fam === 'security') return 'Market data'
      return null
    }
    return def.meta.name || null
  }, [])

  /**
   * Duplicate — the SAME verb the legend's own popover offers, and the same write.
   *
   * ⭐⭐ A COPY OF THIS INSTANCE, UNDER A NEW IDENTITY (2026-09-28). It used to be
   * `addInstance(defId)` — the definition's defaults — which made Duplicate on a
   * `Weekly SMA 10 · Step · Daily only` produce a daily SMA 5 in the default
   * colour. `duplicateInstance` copies inputs, source, calculation timeframe,
   * display target, presentation and visibility, and `StockChart`'s legend
   * popover calls the same writer: two doors, still one behaviour.
   *
   * ⛔ NULL WHEN IT CANNOT ACT, so the button is ABSENT rather than inert. The
   * volume pane is one pane; there is no second one to make.
   */
  const duplicateWriter = useCallback((row) => {
    if (row?.engineOwned && row.instanceId && row.defId) {
      return () => duplicateInstance(settings, row.instanceId, registry)
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
      data-measure="wide" title={withoutGuardIds(f.why)}>
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
    // ⭐ 3-02b — a stored gated option (`{disabled: true}`) is a select's job: a
    // segment has no honest way to show a pressed answer that cannot be pressed.
    && !f.options.some((o) => o?.[2] && o[2].disabled)

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

  /** The tooltip a regular input row's label shows on hover (S1): the generated
   *  field's own, else the definition's declared one, else nothing. */
  const tooltipOf = (row, f) => {
    if (typeof f.tooltip === 'string' && f.tooltip) return f.tooltip
    const declared = (registry?.getDefinition?.(row.defId)?.inputs || []).find((i) => i && i.key === f.key)
    return declared && typeof declared.tooltip === 'string' && declared.tooltip ? declared.tooltip : undefined
  }

  const renderField = (row, f) => {
    const val = row.values?.[f.key]
    const dis = !!f.disabled
    // ⭐ UCT RS PHASE 2a VISUAL (A6) — `activeWhen` DIMS, NEVER REMOVES, exactly as
    // the phone sheet does: the row keeps its place and its words, the label takes
    // the off tier and the control is `disabled` + `aria-disabled`. It wakes on the
    // same click that satisfies the condition, because `row.values` is the resolved
    // state that click writes. A field with no `activeWhen` is untouched.
    // ⭐ e98 E2 — with the row's definition, so a Pine input's `active =` test reads an option as the script does
    const off = !dis && !!f.activeWhen && !evalActiveWhen(f.activeWhen, row.values, registry?.getDefinition?.(row.defId))
    // The reason has to reach a screen reader, not just a pointer — the rule this
    // tab already followed, kept verbatim.
    const whyId = dis ? `ind-why-${row.id}-${f.key}` : undefined
    // ⭐ a11y gate §12.2 (2026-11-08) — the visible label NAMES its control. The
    // select and the number box had no accessible name, so a screen reader read
    // "combo box, S&P 500 (SPY)" with no "Benchmark" (and "Reading", "Line width"…).
    // `aria-labelledby` points at the label span, so the name and the words on
    // screen are one value. The other controls already carry `aria-label`.
    const labelId = `ins-lbl-${resultIdSafe(row.id)}-${resultIdSafe(f.key)}`
    const inert = dis
      ? { disabled: true, 'aria-disabled': 'true', title: f.disabled, 'aria-describedby': whyId }
      : off ? { disabled: true, 'aria-disabled': 'true' } : {}
    const seg = isSegment(f)
    return (
      <div
        key={f.key}
        className={styles.insField}
        data-field={f.key}
        data-measure={seg ? 'segment' : measureOf(f)}
        data-active={f.activeWhen ? String(!off) : undefined}
        title={f.disabled || undefined}
      >
        {/* ⭐ visual review S1 — the declared tooltip rides the label as `title`, so a
            label the column truncates can still be read on hover. ⚠️ `row.fields` come
            from `fieldsFromDefinition`, which carries no `tooltip` (only
            `fieldsForInstance` adds it), so the definition's own declaration is the
            fallback; absent both, no `title` at all. */}
        <span id={labelId} className={`${styles.insFieldLabel} ${dis || off ? styles.indLabelOff : ''}`} title={tooltipOf(row, f)}>{f.label}</span>
        {dis && <span id={whyId} className="sr-only">{f.disabled}</span>}
        <span className={styles.insFieldCtl}>
          {f.type === 'color' && !off && colorSwatch(indTarget(row.id, f.key), f.label, val)}
          {/* An inactive colour: the modal's swatch has no disabled state, so the
              cell around it is inert (no pointer, the off tier) and says so. */}
          {f.type === 'color' && off && (
            <span className={styles.insCtlOff} aria-disabled="true">
              {colorSwatch(indTarget(row.id, f.key), f.label, val)}
            </span>
          )}
          {f.type === 'toggle' && (
            <button
              type="button" role="switch" aria-checked={f.numeric ? Number(val) === 1 : val !== false} aria-label={f.label}
              {...inert}
              className={`${styles.toggle} ${(f.numeric ? Number(val) === 1 : val !== false) ? styles.toggleOn : ''} ${dis || off ? styles.toggleOff : ''}`}
              onClick={() => onRowPatch?.(row, { [f.key]: f.numeric ? (Number(val) === 1 ? 0 : 1) : val === false })}
            ><span className={styles.toggleKnob} /></button>
          )}
          {f.type === 'number' && (
            <input
              type="number" className={styles.indNum} {...inert} aria-labelledby={labelId}
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
              {...(dis ? { 'aria-disabled': 'true', 'aria-describedby': whyId } : off ? { 'aria-disabled': 'true' } : {})}
              /* ⭐ ARROW KEYS MOVE THE CHOICE, which is what a radio group is
                 defined to do and what a member reaches for after tabbing to it.
                 Home/End are the same two answers here, so they are not bound. */
              onKeyDown={(e) => {
                if (dis || off) return
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
                    disabled={dis || off}
                    {...(dis ? { 'aria-disabled': 'true', title: f.disabled } : off ? { 'aria-disabled': 'true' } : {})}
                    className={`${styles.insSegBtn} ${picked ? styles.insSegBtnOn : ''}`}
                    onClick={() => onRowPatch?.(row, { [f.key]: v })}
                  >{l}</button>
                )
              })}
            </span>
          )}
          {f.type === 'select' && !seg && (
            <select
              className={styles.indSelect} {...inert} value={val ?? ''} aria-labelledby={labelId}
              onChange={(e) => {
                const raw = e.target.value
                const opt = f.options.find(([v]) => String(v) === raw)
                onRowPatch?.(row, { [f.key]: opt ? opt[0] : raw })
              }}
            >
              {/* ⭐ 3-02b — a third element `{disabled: true}` is a STORED gated value
                  the live server does not declare (`fieldsForInstance`): shown, so the
                  select tells the truth about what the chart computes, and not
                  choosable. */}
              {f.options.map(([v, l, extra]) => (
                <option key={v} value={v} disabled={!!(extra && extra.disabled)}>{l}</option>
              ))}
            </select>
          )}
          {/* ⭐ UCT RS Phase 3, unit 3-02b — the generic text box (a `string`
              input), with the settings dialog's rules: commits on Enter or blur,
              never writes a value the input refuses, and says why under itself. */}
          {f.type === 'text' && (
            <InspectorTextBox
              key={`${row.id}::${f.key}`}
              field={f} value={val} inert={inert} styles={styles}
              idBase={`ins-text-${resultIdSafe(row.id)}-${resultIdSafe(f.key)}`}
              onCommit={(next) => onRowPatch?.(row, { [f.key]: next })}
            />
          )}
          {/* ⭐ 2026-11-12 — a server-owned list (`optionsSource`, the RS "Pick a
              theme" benchmark): the shared searchable chooser, one write per pick. */}
          {f.type === 'pick' && (
            <span className={styles.insTextCell} data-text-cell="true">
              <OptionsSourcePicker
                key={`${row.id}::${f.key}`}
                field={f} value={val ?? ''} disabled={!!inert.disabled}
                inputClassName={styles.insText}
                idBase={`ins-pick-${resultIdSafe(row.id)}-${resultIdSafe(f.key)}`}
                aria={{ 'aria-labelledby': labelId,
                  ...(inert['aria-describedby'] ? { 'aria-describedby': inert['aria-describedby'] } : null),
                  ...(inert['aria-disabled'] ? { 'aria-disabled': inert['aria-disabled'] } : null) }}
                onPick={(next) => onRowPatch?.(row, { [f.key]: next })}
              />
            </span>
          )}
        </span>
      </div>
    )
  }

  // ─── ONE HOST FEATURE, IN THE INSPECTOR ────────────────────────────────────
  //
  // Name, where it renders, what it is — and the only verbs it has. ⛔ No Core,
  // no Appearance, no Display in, no Duplicate: it is not a plot. The Earnings
  // Strip has no visibility switch because hidden and removed would be the same
  // thing; Company Info's switch is EXPANDED vs COLLAPSED, the same state its
  // own chevron and edge rail drive.
  const renderFeatureInspector = (f) => {
    const rid = featureRowId(f.id)
    return (
      <div className={styles.insPanel} id={inspectorDomId(rid)} data-inspector-for={rid} data-feature-inspector={f.id}>
        <div className={styles.edTop}>
          <button type="button" className={styles.insBack} onClick={backToList} aria-label="Back to all indicators">
            <Icon name="back" size={14} />All indicators
          </button>
        </div>
        <div className={styles.insHead}>
          <span className={styles.insHeadText}>
            <span className={styles.insHeadName}>{f.name}</span>
            <span className={styles.insHeadSub}><span className={styles.insHeadKind}>{f.place}</span></span>
          </span>
          <span className={styles.tacts}>
            <button
              type="button" className={styles.iconBtn}
              aria-label={`Remove ${f.name}`} title="Remove"
              onClick={() => {
                chartFeatures?.remove?.(f.id)
                setSelected((cur) => (cur === rid ? null : cur))
              }}
            ><Icon name="trash" size={15} /></button>
          </span>
        </div>
        <div className={styles.edBody}>
          <section className={styles.insSection} data-section="about">
            <div className={styles.card}><p className={styles.insNote}>{f.description}</p></div>
          </section>
          {/* The shared Switch (TERM-067), worn as a soft square: EXPANDED vs COLLAPSED, the same
              state the feature's own chevron and edge rail drive. */}
          {f.collapsible && (
            <section className={styles.insSection} data-section="chart">
              <div className={styles.insSectionLabel}>On the chart</div>
              <div className={styles.card}>
                <div className={styles.optRow} onClick={(e) => { if (!e.target.closest('button')) chartFeatures?.setOpen?.(f.id, !f.open) }}>
                  <Switch
                    checked={!!f.open}
                    aria-label={`${f.open ? 'Collapse' : 'Show'} ${f.name}`}
                    title={`${f.open ? 'Collapse' : 'Show'} ${f.name}`}
                    className={styles.soft}
                    checkedClassName={styles.softOn}
                    knobClassName={styles.softKnob}
                    onClick={() => chartFeatures?.setOpen?.(f.id, !f.open)}
                  />
                  <span className={styles.optText}><span>Expanded</span></span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    )
  }

  // ─── UCT RS PHASE 2a VISUAL (A6) — THE INSPECTOR REACHES THE DIALOG'S PARITY ─
  //
  // ⭐ PRESETS, GROUPS AND `activeWhen`, read from the definition exactly as the
  // settings dialog and the phone sheet read them: `presetsOf` / `detectPreset` /
  // `applyPresetInputs` from the engine, `sectionize` / `initialCollapsed` /
  // `fieldsForInstance` from the registry. A definition that declares none of
  // them renders exactly what it did — no Preset row, no head, no dimming.
  //
  // Group disclosure is panel-local UI state keyed `<rowId>::<group>`; an absent
  // key reads the definition's `meta.groupsCollapsed` hint, so a group starts as
  // the definition asks and keeps the member's toggle for the life of the panel.
  const [insGroupOpen, setInsGroupOpen] = useState({})
  // The preset each instance last matched or was set to, so "Reset to preset" has
  // a target after a tweak reads Custom — the dialog's `pickedPresetId`, per row.
  const pickedPresetRef = useRef({})

  /** The Preset row, first in CORE, for a definition that declares `meta.presets`. */
  const presetControl = (row, def) => {
    if (!row || !row.instanceId || !row.engineOwned || !def) return null
    // ⭐ 3-02b — through `visiblePresets`, as the dialog and the phone sheet list
    // them: a `requiresServer` preset, or one that sets a hidden gated input or
    // option, is not offered until the live row declares it.
    const shownPresets = new Set(visiblePresets(def, declaredFor(def)))
    const presets = presetsOf(def).filter((p) => shownPresets.has(p))
    if (!presets.length) return null
    const inst = findInstance(settings, row.instanceId)
    if (!inst) return null
    const current = detectPreset(presets, row.values || {}, { instance: inst, def, cs: settings })
    const memo = pickedPresetRef.current
    if (current) memo[row.instanceId] = current.id
    const target = current || presets.find((p) => p.id === memo[row.instanceId]) || null
    const apply = (p) => {
      if (!p) return
      memo[row.instanceId] = p.id
      // (the `rs_preset` count was retired with the presets, RS split U9)
      commitWrite(applyPresetInputs(settings, row.instanceId, def, p, registry))
    }
    const originId = `ins-preset-origin-${resultIdSafe(row.id)}`
    return (
      <Fragment key="preset">
        <div className={styles.insField} data-field="__preset__" data-measure="wide"
          data-preset={current ? current.id : CUSTOM_PRESET}>
          <span className={styles.insFieldLabel}>Preset</span>
          <span className={`${styles.insFieldCtl} ${styles.insPresetCtl}`}>
            <select
              className={styles.indSelect}
              value={current ? current.id : CUSTOM_PRESET}
              aria-label={`${row.label} preset`}
              aria-describedby={current && current.origin ? originId : undefined}
              onChange={(e) => {
                // ⛔ Custom is a STATE, not a preset: choosing it writes nothing.
                const id = e.target.value
                if (id === CUSTOM_PRESET) return
                apply(presets.find((p) => p.id === id))
              }}
            >
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              {!current && <option value={CUSTOM_PRESET}>Custom</option>}
            </select>
            <button
              type="button"
              className={styles.insPresetReset}
              disabled={!target}
              onClick={() => apply(target)}
            >Reset to preset</button>
          </span>
        </div>
        {current && current.origin && (
          <div className={styles.insPresetOrigin} id={originId} data-testid="preset-origin">{current.origin}</div>
        )}
      </Fragment>
    )
  }

  /** CORE's input rows, in the definition's declared GROUPS when it declares any. */
  const renderCoreFields = (row, def, core) => {
    if (!def || !core.some((f) => f.group)) return core.map((f) => renderField(row, f))
    const hint = initialCollapsed(def)
    return sectionize(def, core).map((sec, si) => {
      const body = sec.fields.map((f) => renderField(row, f))
      if (!sec.group) return <Fragment key={`ungrouped-${si}`}>{body}</Fragment>
      const k = `${row.id}::${sec.group}`
      const open = Object.prototype.hasOwnProperty.call(insGroupOpen, k) ? insGroupOpen[k] : !hint.has(sec.group)
      const bodyId = `ins-group-${resultIdSafe(row.id)}-${si}`
      return (
        <div key={`group-${sec.group}`} className={styles.insGroup} data-group={sec.group}>
          <button
            type="button"
            className={styles.insGroupHead}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setInsGroupOpen((m) => ({ ...m, [k]: !open }))}
          >
            <span className={styles.insGroupHeadText}>{sec.label}</span>
            <span className={styles.insGroupHeadIcon} aria-hidden="true">
              <UIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} gold={false} />
            </span>
          </button>
          {open && <div id={bodyId} className={styles.insGroupBody}>{body}</div>}
        </div>
      )
    })
  }

  const renderInspector = (row) => {
    const group = groupOfRow(row.id)
    const def = row.defId ? (registry?.getDefinition?.(row.defId) || null) : null
    const meta = paneRowMeta(row, group, settings, defOf)
    const kind = kindLabel(row, def, rawSourceOf(row, def))
    const on = rowVisible(row)
    // ⭐ A6 — the generated row fields carry no `group` / `activeWhen`; the
    // registry's per-instance model does (`fieldsForInstance`, the dialog's call).
    // Merged by key, so a definition that declares neither gets its fields back
    // unchanged.
    const instForMeta = def && row.instanceId ? findInstance(settings, row.instanceId) : null
    const instModel = def && instForMeta
      ? fieldsForInstance(def, instForMeta, { declared: declaredFor(def) }) : null
    const declaredMeta = instModel ? new Map(instModel.all.map((f) => [f.key, f])) : null
    // ⭐ UCT RS Phase 3, unit 3-02b — THE FIELD LIST IS THE GATED MODEL'S. `row.fields`
    // is `fieldsFromDefinition(def)` with nothing declared, so it can never show a
    // gated input the server DOES declare, and it drops a stored gated option
    // instead of showing it "(not available)". The per-instance model answers
    // both (legacy inputs are absent from either). Each field keeps its row twin's
    // own shape (a `disabled` reason rides there) and takes the model's options;
    // a definition with no gate yields the same keys, in the same order, with the
    // same options — the Inspector it always rendered.
    const gatedRow = instModel && row.engineOwned
      ? (() => {
        const twin = new Map((row.fields || []).map((f) => [f.key, f]))
        return {
          ...row,
          fields: instModel.all.map((m) => {
            const r = twin.get(m.key)
            if (!r) return m
            return m.options ? { ...r, options: m.options } : r
          }),
        }
      })()
      : row
    const parts = partitionFields(gatedRow, def, instModel)
    // ⭐ the model's `inline` and Pine `tooltip` ride too (they were dropped: a Pine document declares
    // its tooltips in the script, which only the model reads)
    const withMeta = (f) => {
      const m = declaredMeta && declaredMeta.get(f.key)
      if (!m || (!m.group && !m.activeWhen && !m.inline && !m.tooltip)) return f
      return {
        ...f,
        group: m.group,
        activeWhen: m.activeWhen,
        ...(m.inline && !f.inline ? { inline: m.inline } : {}),
        ...(m.tooltip && !f.tooltip ? { tooltip: m.tooltip } : {}),
      }
    }
    const core = parts.core.map(withMeta)
    const look = parts.look.map(withMeta)
    const preset = presetControl(row, def)
    const readOnly = readOnlyCore(row, group, meta.source)
    const display = displayInControl(row)
    const timeframe = timeframeControl(row)
    const appearance = appearanceControls(row)
    const visibility = visibilityControl(row)
    const plotStyle = styleControl(row)
    const signColors = signColorControl(row)
    const duplicate = duplicateWriter(row)
    const tint = safeCssColour(rowColor(row))   // ⛔ only a CSS-safe colour reaches the rail (objectColour.js)

    // ⭐ UCT SIGNATURE (owner 11-15) — the editor REPLACES the list: "← All indicators", a title
    // row (big colour bar · name · "kind · pane") with icon actions, the UCT Intelligence bar,
    // then cards: Inputs · Style · On the chart · Calculation · Show on. Every control below is
    // the same control with the same writer as before; only where it sits changed.
    const pick = rowColorPick(row, meta.name)
    const paneWord = group ? (orderable(group) ? `${group.name} pane` : group.name) : null
    const showKind = !!kind && kind.toLowerCase() !== meta.name.trim().toLowerCase()
    const doorKind = definitionDoors && def ? definitionKindOf(def) : 'other'
    const instForDoors = row.instanceId ? (settings.indicatorInstances || []).find((i) => i && i.instanceId === row.instanceId) : null
    const copy = doorKind !== 'other' ? copyVerdict(def, (instForDoors && instForDoors.inputs) || {}) : null
    const canModify = doorKind === 'user' && definitionDoors.canModify()
    const hasMore = doorKind !== 'other'
    const where = readOnly.filter((f) => f.key === '__where__')
    const soonSquare = (label, checked) => (
      <button type="button" className={`${styles.soft} ${checked ? styles.softOn : ''}`} disabled aria-disabled="true"
        aria-label={`${label} (coming soon)`} title={SOON} aria-describedby={soonDescId} data-soon-control="">
        <span className={styles.softKnob} />
      </button>
    )
    const soonField = (label, ctl, { lead = false } = {}) => (
      <div key={label} className={`${styles.insField} ${styles.soonRow} ${lead ? styles.leadField : ''}`} data-soon="" title={SOON}>
        {lead && ctl}
        <span className={styles.insFieldLabel}>{label}<span className={modalStyles.soonTag}>Soon</span></span>
        {!lead && <span className={styles.insFieldCtl}>{ctl}</span>}
      </div>
    )

    return (
      <div className={styles.insPanel} id={inspectorDomId(row.id)} data-inspector-for={row.id}>
        <div className={styles.edTop}>
          <button type="button" className={styles.insBack} onClick={backToList} aria-label="Back to all indicators">
            <Icon name="back" size={14} />All indicators
          </button>
        </div>
        {/* ─── TITLE: what this is, where it draws, and its verbs ─────────── */}
        <div className={styles.insHead} ref={moreRef}>
          <span className={`${styles.rowBar} ${styles.bigBar} ${pick ? styles.hasPick : ''}`}>
            <i className={styles.insRail} style={tint ? { background: tint } : undefined} aria-hidden="true" />
            {pick && colorSwatch(pick.target, pick.label, pick.value)}
          </span>
          <span className={styles.insHeadText}>
            <span className={styles.insHeadName}>{meta.name}</span>
            <span className={styles.insHeadSub}>
              {/* ⛔ THE KIND ONLY WHEN IT ADDS SOMETHING: `RSI 14` over `Relative Strength Index`
                  explains the abbreviation; `Volume` over `Volume` is furniture. */}
              {showKind && <span className={styles.insHeadKind}>{kind}</span>}
              {showKind && paneWord && ' · '}
              {paneWord}
              {!on && ' · hidden'}
            </span>
          </span>
          <span className={styles.tacts}>
            {/* ⭐ THE SAME SWITCH, NOW AN EYE: `setRowVisible(row, !on)`, named by the action. */}
            <button
              type="button" role="switch" aria-checked={on}
              aria-label={`${on ? 'Hide' : 'Show'} ${meta.name}`}
              title={`${on ? 'Hide' : 'Show'} ${meta.name}`}
              className={styles.iconBtn}
              onClick={() => setRowVisible(row, !on)}
            ><Icon name={on ? 'eye' : 'eyeoff'} size={15} /></button>
            {duplicate && (
              <button
                type="button" className={styles.iconBtn}
                aria-label={`Duplicate ${meta.name}`} title="Duplicate on chart"
                onClick={() => {
                  const next = duplicate()
                  // Identity, not deep equality — a REFUSED write returns `settings` itself.
                  if (next !== settings) onChange?.({ ...next, preset: 'custom' })
                }}
              ><Icon name="dup" size={15} /></button>
            )}
            <button
              type="button" className={styles.iconBtn}
              aria-label={`Remove ${meta.name}`} title="Remove"
              data-guide="indicators.remove"
              onClick={() => removeRow(row)}
            ><Icon name="trash" size={15} /></button>
            {hasMore && (
              <button
                type="button" className={styles.iconBtn} aria-label="More actions" title="More"
                aria-haspopup="menu" aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              ><Icon name="more" size={15} /></button>
            )}
          </span>
          {/* ⭐ PHASE 4 — THE INDICATOR ITSELF, separate from this instance's settings: a member's
              own formula can be modified (the UCT Agent, where authorized) or opened in the
              formula builder; a formula or a parity-approved built-in can be copied into a NEW
              indicator of their own (a built-in that cannot be reproduced exactly says why). */}
          {hasMore && moreOpen && (
            <div className={styles.menu} role="menu" style={{ right: 14, top: 44 }}
              data-testid="inspector-definition-actions" data-definition-kind={doorKind}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMoreOpen(false) } }}>
              {canModify && (
                <button type="button" role="menuitem" className={styles.menuItem} data-testid="inspector-modify"
                  onClick={() => { setMoreOpen(false); definitionDoors.modify(def.id) }}>
                  <span>Change it with the UCT Agent</span><Icon name="spark" size={13} className={styles.spark} />
                </button>
              )}
              {doorKind === 'user' && (
                <button type="button" role="menuitem" className={styles.menuItem} data-testid="inspector-edit-formula"
                  onClick={() => { setMoreOpen(false); definitionDoors.editFormula(def.id) }}>
                  <span>Open in formula builder</span>
                </button>
              )}
              <button type="button" role="menuitem" className={styles.menuItem} data-testid="inspector-custom-copy"
                disabled={!copy.ok}
                title={copy.ok ? 'A new, independent indicator of your own — this one stays as it is' : copy.reason}
                onClick={() => { if (copy.ok) { setMoreOpen(false); definitionDoors.customCopy(def, (instForDoors && instForDoors.inputs) || {}) } }}>
                <span>Make my own copy</span>
              </button>
              {!copy.ok && <div className={styles.menuNote} data-testid="inspector-not-customizable">{copy.reason}</div>}
            </div>
          )}
        </div>

        {/* ─── UCT INTELLIGENCE: change it in plain words (Soon — no door takes free text yet) ── */}
        <label className={`${styles.aiBar} ${styles.soon}`} title={SOON}>
          <Icon name="spark" size={14} className={styles.spark} />
          <input type="text" disabled aria-disabled="true" title={SOON} aria-describedby={soonDescId}
            placeholder="Change it in plain words, e.g. “dashed, 150 days”"
            aria-label={`Change ${meta.name} in plain words (coming soon)`} />
          <span className={`${modalStyles.soonTag} ${styles.aiSoon}`}>Soon</span>
          <button type="button" className={styles.iconBtn} disabled aria-disabled="true" aria-label="Apply (coming soon)" title={SOON} aria-describedby={soonDescId}>
            <Icon name="send" size={14} />
          </button>
        </label>

        {/* ⭐ WHOLE-ROW TOGGLING (owner 11-15, as on every Chart Settings row): a click anywhere on
            a row that holds an on/off soft square flips it; the row's other controls keep theirs. */}
        <div className={styles.edBody} onClick={(e) => {
          const fld = e.target.closest?.('[data-field]')
          if (!fld || e.target.closest('button, input, select, a, label, [role="switch"]')) return
          fld.querySelector('[role="switch"]:not([disabled]):not([aria-disabled="true"])')?.click()
        }}>
          {/* ─── INPUTS — what it computes ─────────────────────────────────── */}
          {(preset || core.length > 0 || readOnly.some((f) => f.key === '__source__')) && (
            <section className={styles.insSection} data-section="core">
              <div className={styles.insSectionLabel}>Inputs</div>
              <div className={styles.card}>
                {/* ⭐ A6 — the Preset row is FIRST: the first decision a member makes. */}
                {preset}
                {readOnly.filter((f) => f.key === '__source__').map(renderReadOnly)}
                {renderCoreFields(row, def, core)}
              </div>
            </section>
          )}

          {/* ─── STYLE — how it is drawn ───────────────────────────────────── */}
          {(look.length > 0 || (plotStyle && plotStyle.length > 0) || appearance
            || (signColors && signColors.length > 0)) && (
            <section className={styles.insSection} data-section="appearance">
              <div className={styles.insSectionLabel}>Style</div>
              <div className={styles.card}>
                {/* ⭐ A signed histogram's Up / Down pair sits where its single colour would. */}
                {signColors}
                {look.map((f) => renderField(row, f))}
                {/* stroke before geometry: Line style / width above Plot style */}
                {appearance}
                {plotStyle}
              </div>
            </section>
          )}

          {/* ─── ON THE CHART — where it draws, and how it is labelled ─────── */}
          <section className={styles.insSection} data-section="chart">
            <div className={styles.insSectionLabel}>On the chart</div>
            <div className={styles.card}>
              {display || where.map(renderReadOnly)}
              {soonField('Legend name', (
                <input type="text" className={styles.insText} disabled aria-disabled="true" value={meta.name} readOnly
                  aria-label="Legend name (coming soon)" title={SOON} aria-describedby={soonDescId} />
              ))}
              {soonField('Show in the legend', soonSquare('Show in the legend', true), { lead: true })}
              {soonField('Value on the price scale', soonSquare('Value on the price scale', false), { lead: true })}
            </div>
          </section>

          {/* ─── CALCULATION — which bars compute it ───────────────────────── */}
          {timeframe && (
            <section className={styles.insSection} data-section="calculation">
              <div className={styles.insSectionLabel}>Calculation</div>
              <div className={styles.card}>{timeframe}</div>
            </section>
          )}

          {/* ─── SHOW ON — which chart timeframes draw it ──────────────────── */}
          <section className={styles.insSection} data-section="showOn">
            <div className={styles.insSectionLabel}>Show on</div>
            <div className={styles.card}>
              {visibility || soonField('Timeframes', <span className={styles.insFieldValue}>All timeframes</span>)}
            </div>
          </section>
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

  // ⚰️ `renderArrangeAside` (Arrange's right-hand note) is now the hint at the top of the
  // one-column Arrange list (`data-testid="arrange-aside"`).

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
        <span className={styles.insFieldLabel}>Pane</span>
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
    // ⭐ ONE CONTRACT, TWO READERS. `availableStyles` below now offers exactly what
    // the binder will honour, and `resolvePlotStyle` shows exactly what it will draw
    // — including the source's own default for a row that has never been restyled.
    const srcCap = sourceCapabilityFor(def, inst)
    const styleCtx = {
      target,
      ohlcCapable,
      sourceDefaultStyle: srcCap ? srcCap.defaultStyle : null,
      allowedStyles: srcCap ? srcCap.allowedStyles : null,
    }
    const plots = Array.isArray(def.plots) ? def.plots : []
    // ⭐ BATCH 2 — a `hidden: true` plot is never drawn, so it has no style to pick.
    // ⭐ UCT RS 3-14 — and a `requiresServer` plot (a Phase 3 reading's line) has no
    // style row until the live row declares the definition's gated inputs.
    const declared = declaredFor(def)
    const restyleable = plots.filter((pl) => pl && pl.hidden !== true && !isPlotHidden(def, pl, declared)
      && availableStyles(pl, styleCtx).length > 0)
    // ⭐ 2a-12 — the outputs that draw as DOTS get one Dot size control beside Plot
    // style, through `setInstanceDotSize` (the dialog's Style tab and the `setDotSize`
    // agent op share it). A definition with neither has nothing here.
    const dots = dotPlotsOf(def)
    if (!restyleable.length && !dots.length) return null

    // ⭐ ONE OUTPUT ⇒ NO OUTPUT NAME. Printing "Value" above a single control,
    // inside a panel already titled `QQQ`, is furniture.
    const single = restyleable.length === 1
    // ⭐⭐ A PLOT IS NAMED AS THE FORM NAMES ITS COLOUR AND WIDTH (`plotTitlesOf`): its title, else the
    // group of the script colour it draws in, else TradingView's `Plot`. ⚰️ It printed the column key,
    // so RS Rating's untitled MA plots read "out2 style". Two plots sharing a name are told apart by
    // their position in the accessible name only, where a screen reader needs it.
    const titles = plotTitlesOf(def)
    const nameOf = (plot) => titles.get(plot.key) || plot.label || 'Plot'
    const seenName = new Map()
    const spoken = new Map(restyleable.map((plot) => {
      const n = nameOf(plot)
      const k = (seenName.get(n) || 0) + 1
      seenName.set(n, k)
      return [plot.key, k > 1 ? `${n} ${k}` : n]
    }))

    const rows = restyleable.map((plot) => {
      const style = resolvePlotStyle(inst, plot, styleCtx)
      const choices = availableStyles(plot, styleCtx)
      const label = single ? 'Plot style' : `${nameOf(plot)} style`
      return (
        <div className={styles.insField} data-field={`__style__:${plot.key}`} data-measure="medium"
          key={`style-${plot.key}`}>
          <span className={styles.insFieldLabel}>{label}</span>
          <span className={styles.insFieldCtl}>
            <select
              className={styles.indSelect}
              value={style}
              aria-label={`${row.label} ${single ? 'plot style' : `${spoken.get(plot.key)} plot style`}`}
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
    if (dots.length) {
      // ⭐ U8 #11 (2026-11-07): "Mixed" while a per-dot size disagrees with the
      // instance level; the writer deletes per-dot sizes on any word chosen.
      const dotReading = instanceDotSizeReading(inst, def)
      rows.push(
        <div className={styles.insField} data-field="__dotSize__" data-measure="medium" key="dot-size">
          <span className={styles.insFieldLabel}>Dot size</span>
          <span className={styles.insFieldCtl}>
            <select
              className={styles.indSelect}
              value={dotReading}
              aria-label={`${row.label} dot size`}
              onChange={(e) => {
                const next = setInstanceDotSize(settings, row.instanceId, e.target.value, registry)
                if (next !== settings) onChange?.({ ...next, preset: 'custom' })
              }}
            >
              {dotReading === DOT_SIZE_MIXED && <option value={DOT_SIZE_MIXED} disabled>Mixed</option>}
              {DOT_SIZE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </span>
        </div>,
      )
    }
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `declaredFor` reads `gateId` and `serverDeclared`, listed
  }, [settings, registry, onChange, gateId, serverDeclared])

  /** Write one settings blob through the ONE persist path this tab uses. A refused
   *  write comes back as `settings` itself and is not persisted. */
  const commitWrite = useCallback((next) => {
    if (next && next !== settings) onChange?.({ ...next, preset: 'custom' })
  }, [settings, onChange])

  /**
   * TIMEFRAME — which bars CALCULATE this indicator (Core).
   *
   * ⭐⭐ "Chart" IS THE DEFAULT AND IT IS THE ABSENT KEY. Every indicator on every
   * saved chart reads Chart and computes exactly as it always did; picking `1D`
   * makes it compute from canonical daily bars and project onto whatever the chart
   * shows (`mtfProjection.js`).
   *
   * ⛔ OFFERED ONLY WHERE THE CAPABILITY GATE SAYS YES — `calcTimeframeCapability`
   * is the one answer, shared with the writer and the binder, so the control can
   * never offer what the chart would refuse. A refusal renders NOTHING rather than
   * a disabled control: a member cannot use a Timeframe row on a VWAP, so it is
   * not there.
   *
   * ⭐ A DEPENDENT READS "From source". `MA(RSI)` computes in RSI's frame, so its
   * own control states that frame read-only instead of offering a choice the
   * engine would not honour.
   */
  const timeframeControl = useCallback((row) => {
    if (!row || !row.instanceId || !row.engineOwned) return null
    const def = registry?.getDefinition?.(row.defId)
    const inst = findInstance(settings, row.instanceId)
    if (!def || !inst) return null
    const cap = calcTimeframeCapability(def, inst)
    if (!cap.ok) return null
    if (cap.inherits) {
      // Walk to the ROOT source: `MA(MA(RSI))` computes in RSI's frame too.
      let up = findInstance(settings, cap.inherits)
      for (let hop = 0; up && hop < 8; hop++) {
        const upCap = calcTimeframeCapability(registry?.getDefinition?.(up.defId), up)
        if (!upCap.ok || !upCap.inherits) break
        up = findInstance(settings, upCap.inherits)
      }
      const upTf = up ? calcTimeframeOf(up) : null
      return (
        <div className={styles.insField} data-field="__timeframe__" data-measure="medium"
          data-readonly="true" key="timeframe"
          title="Calculated on the same timeframe as its source.">
          <span className={styles.insFieldLabel}>Timeframe</span>
          <span className={styles.insFieldCtl}>
            <span className={styles.insFieldValue} aria-readonly="true">
              {`From source · ${calcTimeframeLabel(upTf)}`}
            </span>
          </span>
        </div>
      )
    }
    const current = calcTimeframeOf(inst)
    const relation = chartTf ? frameRelation(current, chartTf) : 'chart'
    const note = (relation === 'lower' || relation === 'straddle')
      ? gatedReason(relation, current, chartTf) : null
    return (
      // ⛔ A FRAGMENT, NOT A WRAPPER: every field is a DIRECT child of its section
      // (the one-property-per-row rule the layout is built on); the note is a
      // sibling row beneath it.
      <Fragment key="timeframe">
        <div className={styles.insField} data-field="__timeframe__" data-measure="medium">
          <span className={styles.insFieldLabel}>Timeframe</span>
          <span className={styles.insFieldCtl}>
            <select
              className={styles.indSelect}
              value={current || ''}
              aria-label={`${row.label} calculation timeframe`}
              onChange={(e) => commitWrite(setInstanceCalculationTimeframe(
                settings, row.instanceId, e.target.value || null, registry))}
            >
              <option value="">Chart</option>
              {CALC_TIMEFRAMES.map((code) => (
                <option key={code} value={code}>{tfLabel(code)}</option>
              ))}
            </select>
          </span>
        </div>
        {note && <div className={styles.insNote} data-note="timeframe">{note}</div>}
      </Fragment>
    )
  }, [settings, registry, chartTf, commitWrite])

  /**
   * APPEARANCE a definition DECLARES (`meta.appearance`) — Overlap candles, Line
   * style, Line width, Offset. The Moving Average is the first to declare them; a
   * definition that declares nothing gets nothing, so no other indicator's panel
   * changes.
   *
   * ⭐ THE VALUES AND WRITES ARE `presentation`'s, via `setInstanceAppearance` — the
   * same keys an adopted `cs.overlays` average carries (`maAdoption.js`), so a
   * default EMA 9 and a newly added SMA 150 show and store identical controls.
   *
   * ⛔ OVERLAP ONLY WHERE THERE ARE CANDLES TO OVERLAP. An average living in RSI's
   * pane has nothing to draw in front of, and a toggle that changes nothing is a
   * control that lies.
   *
   * ⛔ OFFSET IS SHOWN, DISABLED — EXACTLY AS IT HAS ALWAYS BEEN. The overlay editor
   * listed it as "Coming soon"; this project does not change offset semantics.
   */
  const appearanceControls = useCallback((row) => {
    if (!row || !row.instanceId || !row.engineOwned) return null
    const def = registry?.getDefinition?.(row.defId)
    const inst = findInstance(settings, row.instanceId)
    const declared = def && def.meta && Array.isArray(def.meta.appearance) ? def.meta.appearance : null
    if (!declared || !inst) return null
    const pres = inst.presentation || {}
    const onPrice = resolveDisplayTarget(inst, settings) === 'price'
    const out = []
    const write = (key, value) => commitWrite(setInstanceAppearance(settings, row.instanceId, key, value, registry))
    if (declared.includes('overlap') && onPrice) {
      const on = pres.overlap === true
      out.push(
        <div key="overlap" className={styles.insField} data-field="overlap" data-measure="compact">
          <span className={styles.insFieldLabel}>Draw above candles</span>
          <span className={styles.insFieldCtl}>
            <Switch
              checked={on} aria-label="Draw above candles"
              className={styles.soft} checkedClassName={styles.softOn} knobClassName={styles.softKnob}
              onClick={() => write('overlap', !on)}
            />
          </span>
        </div>,
      )
    }
    if (declared.includes('lineStyle')) {
      const v = LINE_STYLE_CHOICES.includes(pres.lineStyle) ? pres.lineStyle : 'solid'
      out.push(
        <div key="lineStyle" className={styles.insField} data-field="lineStyle" data-measure="medium">
          <span className={styles.insFieldLabel}>Line style</span>
          <span className={styles.insFieldCtl}>
            <select className={styles.indSelect} value={v} aria-label={`${row.label} line style`}
              onChange={(e) => write('lineStyle', e.target.value)}>
              {LINE_STYLE_CHOICES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </span>
        </div>,
      )
    }
    if (declared.includes('lineWidth')) {
      const w = LINE_WIDTH_CHOICES.includes(Number(pres.lineWidth)) ? Number(pres.lineWidth) : 1
      out.push(
        <div key="lineWidth" className={styles.insField} data-field="lineWidth" data-measure="compact">
          <span className={styles.insFieldLabel}>Line width</span>
          <span className={styles.insFieldCtl}>
            <select className={styles.indSelect} value={w} aria-label={`${row.label} line width`}
              onChange={(e) => write('lineWidth', Number(e.target.value))}>
              {LINE_WIDTH_CHOICES.map((n) => <option key={n} value={n}>{`${n}px`}</option>)}
            </select>
          </span>
        </div>,
      )
    }
    if (declared.includes('offset')) {
      const why = 'Coming soon'
      const whyId = `ind-why-${row.id}-offset`
      out.push(
        <div key="offset" className={styles.insField} data-field="offset" data-measure="compact" title={why}>
          <span className={`${styles.insFieldLabel} ${styles.indLabelOff}`}>Offset</span>
          <span id={whyId} className="sr-only">{why}</span>
          <span className={styles.insFieldCtl}>
            <input type="number" className={styles.indNum} value={Number(pres.offset) || 0}
              disabled aria-disabled="true" aria-describedby={whyId} title={why} readOnly />
          </span>
        </div>,
      )
    }
    return out.length ? out : null
  }, [settings, registry, commitWrite])

  /** Which Custom visibility editor is open (row id), if any. */
  const [visEditing, setVisEditing] = useState(null)

  /**
   * VISIBILITY — on which CHART timeframes this indicator draws. A CORE row, directly
   * under Timeframe (what it is calculated on) and Display, so it is above the fold.
   *
   * ⭐⭐ PRESENTATION ONLY. Hidden-here is not deleted, not disabled and not
   * rewritten: the instance keeps its source, calculation timeframe, display and
   * identity, and comes back the moment the chart is on an allowed timeframe
   * (`eligibility.eligibleInstances` is the one gate).
   *
   * ⭐ GENERIC ON PURPOSE. It is offered on every engine indicator because hiding
   * by timeframe needs nothing from the definition — and its default (All) is the
   * absent key, so offering it changes no chart.
   *
   * ⛔ COMPACT. A select of four semantic presets; the per-timeframe grid appears
   * only while a member is editing a Custom policy, and closes with Done.
   */
  const visibilityControl = useCallback((row) => {
    if (!row || !row.instanceId || !row.engineOwned) return null
    const inst = findInstance(settings, row.instanceId)
    if (!inst) return null
    const vis = visibilityOf(inst)
    const preset = vis ? vis.preset : 'all'
    const editing = visEditing === row.id
    const write = (v) => commitWrite(setInstanceVisibility(settings, row.instanceId, v, registry))
    const customSummary = vis && vis.preset === 'custom' ? visibilitySummary(vis) : null
    const picked = new Set(vis && vis.preset === 'custom' ? vis.tfs : [])
    const toggleCode = (code) => {
      const next = new Set(picked)
      if (next.has(code)) {
        // ⛔ A Custom policy with NOTHING in it would hide the indicator everywhere
        // — that is Remove wearing a visibility control. The last one stays.
        if (next.size === 1) return
        next.delete(code)
      } else next.add(code)
      write({ preset: 'custom', tfs: [...next] })
    }
    return (
      <Fragment key="visibility">
        <div className={styles.insField} data-field="__visibility__" data-measure="wide">
          <span className={styles.insFieldLabel}>Timeframes</span>
          <span className={styles.insFieldCtl}>
            <select
              className={styles.indSelect}
              value={preset === 'custom' ? 'custom:current' : preset}
              aria-label={`${row.label} visibility`}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'custom:current') return
                if (v === 'custom') {
                  // Seeded from the chart the member is looking at, so the first
                  // Custom policy always includes somewhere they can see the result.
                  const seed = vis && vis.preset === 'custom' ? vis.tfs : (chartTf ? [String(chartTf)] : ['D'])
                  write({ preset: 'custom', tfs: seed })
                  setVisEditing(row.id)
                  return
                }
                setVisEditing(null)
                write(v === 'all' ? null : { preset: v })
              }}
            >
              {VISIBILITY_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              {customSummary && <option value="custom:current">{customSummary}</option>}
              <option value="custom">{customSummary ? 'Edit custom…' : 'Custom…'}</option>
            </select>
          </span>
        </div>
        {preset === 'custom' && editing && (
          <div className={styles.insTfEditor} data-testid="visibility-editor">
            {visibilityChoices().map((g) => (
              <div key={g.group} className={styles.insTfGroup} role="group" aria-label={g.group}>
                {g.codes.map((code) => {
                  const on = picked.has(code)
                  return (
                    <button
                      key={code} type="button" aria-pressed={on}
                      className={`${styles.insTfChip} ${on ? styles.insTfChipOn : ''}`}
                      onClick={() => toggleCode(code)}
                    >{tfLabel(code)}</button>
                  )
                })}
              </div>
            ))}
            <button type="button" className={styles.insTfDone} onClick={() => setVisEditing(null)}>Done</button>
          </div>
        )}
      </Fragment>
    )
  }, [settings, registry, chartTf, visEditing, commitWrite])

  /**
   * UP / DOWN COLOUR — offered only for an output that actually HAS two signs.
   *
   * ⭐⭐ CAPABILITY, NEVER A TICKER. `resolveSignColors` answers non-null exactly
   * when this instance's output is a sign-coloured histogram — which the
   * catalogue decided from `breadth_metrics`' `DOMAIN_SIGNED` + `PRES_HISTOGRAM`,
   * not from a symbol string. An ordinary line, an unsigned histogram and a
   * candle output all get `null` here and keep their single colour control, so
   * `US:NETHL` is not special-cased; it merely happens to be signed.
   *
   * ⛔ ONE PICKER, ONE COMMIT. The swatches are the modal's own `colorSwatch`;
   * the target prefix routes the write to `setInstanceCandleColor` instead of the
   * inputs lane, because a sign colour is presentation. See `signTarget`.
   *
   * ⚠️ AND THE DEFAULT IS THE CHART'S. Storing nothing means "follow the theme" —
   * `resolveSignColors` falls through to `cs.candles`, so switching UCT Chart
   * Theme repaints these bars with no migration and no stale hex.
   */
  const signColorControl = useCallback((row) => {
    if (!row || !row.instanceId || typeof colorSwatch !== 'function') return null
    const def = registry && typeof registry.getDefinition === 'function'
      ? registry.getDefinition(row.defId) : null
    const inst = findInstance(settings, row.instanceId)
    if (!def || !inst) return null
    const plots = Array.isArray(def.plots) ? def.plots : []
    const out = []
    const single = plots.length === 1
    for (const plot of plots) {
      const style = resolvePlotStyle(inst, plot, {})
      const isHist = style === 'histogram' || (!style && plot.style === 'histogram')
      if (!isHist) continue
      const sign = resolveSignColors(inst, plot, (settings && settings.candles) || null)
      if (!sign) continue
      const suffix = single ? '' : ` · ${plot.label || plot.key}`
      out.push(
        <div className={styles.insField} data-field={`__sign__:${plot.key}`} data-measure="bare"
          key={`sign-${plot.key}`}>
          <span className={styles.insFieldLabel}>{`Up color${suffix}`}</span>
          <span className={styles.insFieldCtl}>
            {colorSwatch(signTarget(row.instanceId, 'upColor'), `${row.label} up color`, sign.up)}
          </span>
        </div>,
        <div className={styles.insField} data-field={`__signdn__:${plot.key}`} data-measure="bare"
          key={`signdn-${plot.key}`}>
          <span className={styles.insFieldLabel}>{`Down color${suffix}`}</span>
          <span className={styles.insFieldCtl}>
            {colorSwatch(signTarget(row.instanceId, 'downColor'), `${row.label} down color`, sign.down)}
          </span>
        </div>,
      )
    }
    return out.length ? out : null
  }, [settings, registry, colorSwatch])

  // ─── ONE CATALOGUE RESULT ─────────────────────────────────────────────────
  const renderResult = (row) => {
    // ⛔⛔ A SYMBOL IS NEVER "ALREADY ON". `isRowOn` answers per DEFINITION, and a
    // symbol row's `id` is a ticker (`QQQ`), not a definition id — three QQQ series
    // on one chart is a legitimate thing a member may want (§32), and the row that
    // creates them must keep offering. A row carrying a `create` descriptor is
    // asked nothing; it simply adds.
    // ⭐ AND A RESTORE ROW IS AN ADD ROW TOO — see `discoveryCatalog.libraryRowFor`.
    // ⭐ A HOST FEATURE ANSWERS FROM THE HOST: `enabled` is its dock state, and
    // it is never a creating row even though it browses through `resultByKey`.
    const isFeature = row.kind === 'feature'
    const creates = !isFeature && (resultByKey.has(row.key) || row.restores === true)
    const on = isFeature ? !!row.enabled : (creates ? false : isRowOn(row, settings))
    // ⭐ A1 (D8): an indicator that EXISTS but is entirely hidden says so — it is on the
    // chart (its rows are in the list above, each with its eye), not drawing.
    const hiddenDef = on && !isFeature && !creates && rowVisibility(row, settings).state === 'hidden'
    // ⛔ DISCOVERY IS NOT CHARTABILITY. The facade reports what the SERVER already
    // said — a delisted ticker, an index the bars route will not serve — and
    // `createFromResult` refuses those by identity. A row that looked live and did
    // nothing is worse than one that says why, so the reason is printed and the
    // click is not offered.
    const refused = row.capability === CAPABILITY.UNSUPPORTED
    const canAdd = !on && !refused
    const canAct = canAdd || (isFeature && on)
    const isEcon = row.kind === 'economic'
    // The state word ("Active" / "Unavailable") sits beside the add control, not
    // inside the title button, so the button names it by reference.
    const stateId = (refused || on) ? `${resultIdBase}-state-${resultIdSafe(row.key || row.id)}` : undefined
    return (
      /* ⛔⛔ THE ROW IS NOT A CONTROL; ITS TITLE LINE IS. This `<li>` was a
         `role="option"` with `tabIndex={0}` — and an ACTIVE row carries "Add
         another", a user formula carries Modify / Edit formula / Custom copy, so
         axe measured a focusable control nested inside an interactive one
         (`nested-interactive`, on `movingAverage` — the one row on the chart).
         An option cannot hold buttons, so the list is a plain list now: the
         keyboard door is the real `<button>` around the title line below, and
         its click BUBBLES to this `onClick` — one writer, so pointer and
         keyboard add exactly the same way. The secondary buttons are siblings
         of that button, never inside it. */
      <li
        key={row.key || row.id}
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
        /* ⭐ A MEMBER'S OWN ROW PUTS ITS DOORS ON A SECOND LINE (`resRowOwn`): five of them on the
           name's line left the name no room (seen on production, 2026-11-17). */
        className={`${styles.resRow} ${on ? styles.resRowOn : ''} ${refused ? styles.resRefused : ''} ${row.userDefined && definitionDoors ? styles.resRowOwn : ''}`}
        onClick={() => { if (canAct) addRow(row) }}
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
          <UIcon name={glyphNameOf(row)} size={16} gold={false} strokeWidth={1.5} />
        </span>
        {/* ⭐ AN ECONOMIC ROW IS TWO LEVELS (owner, 2026-09-30): the NAME owns line one
            and `SYMBOL · agency · frequency · units` sits under it in the muted ink.
            On one line the name, chip and metadata split ~330px three ways and every
            name truncated to a word. Economic only — every other kind keeps its line. */}
        <span className={`${styles.resMain} ${isEcon ? styles.resMainStacked : ''}`}>
          {/* ⭐ THE ROW'S KEYBOARD DOOR — see the note on the `<li>`. No handler of
              its own: Enter and Space click a native button, and that click
              bubbles to the row. `aria-disabled`, not `disabled`, so a row that
              is already on stays reachable and still says so. */}
          <button
            type="button"
            className={`${styles.resTitleRow} ${styles.resPrimary}`}
            data-result-primary="true"
            aria-disabled={canAct ? undefined : 'true'}
            aria-describedby={stateId}
            title={row.description || undefined}
          >
            <span className={styles.resName}>{row.name}</span>
            {/* ⭐ `chip` names a breadth row's POPULATION (UCT · US · NASDAQ · NYSE) so four
                identically named metrics are told apart; every other kind keeps `shortName`. */}
            {/* ⛔ A TAG THE NAME ALREADY SAYS IS NOT READ TWICE. Inside the button its
                text joins the accessible name, so VoiceOver read "Parabolic SAR
                SAR", "TRIX TRIX". It is `aria-hidden` ONLY when its words are
                literally a run of the name's words (`shortTag.js`); any other tag
                (RSI, a ticker, a population, a type) is visible text and stays in
                the name -- WCAG 2.5.3 Label in Name. */}
            {!isEcon && (
              <span className={styles.resShort} aria-hidden={tagRestatesName(row.name, row.chip || row.shortName) ? 'true' : undefined}>
                {row.chip || row.shortName}
              </span>
            )}
            {row.userDefined && <span className={styles.resMine}>Your indicator</span>}
            {/* ⭐ PHASE 4 — IS IT USED HERE? The member's own indicator says so. */}
            {/* (`ACTIVE` already marks one that is on; this says the other half.) */}
            {row.userDefined && !on && (
              <span className={styles.resPill} data-testid="your-indicator-status">Not on this chart</span>
            )}
            {hiddenDef && <span className={styles.resPill} data-testid="result-hidden">Hidden</span>}
            {row.sessionOnly && <span className={styles.resPill}>Intraday only</span>}
            {/* The LINTER's measurement, per plot — never the definition's own
                declared claim. Same read the library row makes. */}
            {row.measuredRepaint && row.measuredRepaint !== CLEAN && (
              <span
                className={styles.resRepaint}
                data-repaint={row.measuredRepaint}
                title={(row.repaintingPlots || []).map((n) => `${n.label} — ${withoutGuardIds(n.sentence)}`).join(' ')}
              >{String(row.measuredRepaint).charAt(0).toUpperCase() + String(row.measuredRepaint).slice(1)}</span>
            )}
            {/* Tier only when it is NOT free, and NEVER on the member's own
                formula — "Premium" beside "Your formula" reads as "you cannot use
                this" about a thing they wrote. Entitlement logic is untouched;
                this is the same badge the library renders. */}
            {row.tier && row.tier !== 'free' && !row.userDefined && (
              <span className={styles.resTier}>{row.tier}</span>
            )}
          </button>
          {/* ⭐ PHASE 4 — the DEFINITION's own doors on the member's saved indicator:
              the same calls as the legend menu and the inspector. Buttons stop the
              click from also adding the row. */}
          {row.userDefined && definitionDoors && (() => {
            const d = registry?.getDefinition?.(row.id) || null
            if (!d || definitionKindOf(d) !== 'user') return null
            // ⭐ R1 (2026-11-17) — the doors are `YourIndicatorActions` (its own tested file), which adds
            // "Run over a list": the Screener's existing run flow, opened on this indicator.
            return <YourIndicatorActions def={d} doors={definitionDoors}
              className={styles.resActions} actionClassName={styles.resAction} />
          })()}
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
          {/* An economic row's second line: `SYMBOL · agency · frequency · units`.
              ⚠️ Truncates last; the row's `title` carries the full name + metadata. */}
          {isEcon && (row.shortName || row.sub) && (
            <span className={styles.resMeta} data-testid="econ-row-meta">
              {row.shortName && <span className={styles.resMetaSym}>{row.shortName}</span>}
              {row.shortName && row.sub && <span aria-hidden="true"> · </span>}
              {row.sub && <span data-testid="econ-row-sub">{row.sub}</span>}
            </span>
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
          <span className={styles.resActive}><span className={styles.resActiveTag} id={stateId}>Unavailable</span></span>
        ) : on ? (
          /* ⭐ UCT SIGNATURE §2b-7 — already in use: a small gold dot and "On chart" in grey. */
          <span className={styles.resActive}>
            <span className={`${styles.resActiveTag} ${styles.resOnDot}`} id={stateId}>On chart</span>
            {!row.carvedOut && !row.singleton && (
              <button
                type="button"
                className={styles.resAddMore}
                aria-label={`Add another ${row.name}`}
                data-guide="indicators.addAnother"
                title={`Add a second ${row.shortName} with the default settings`}
                onClick={(e) => addAnother(row, e)}
              ><Icon name="plus" size={14} /></button>
            )}
          </span>
        ) : (
          <span className={styles.resAdd} aria-hidden="true">+ Add</span>
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
    const tabLabel = (libraryTabs.find((t) => t.key === activeTab) || { label: 'anything' }).label
    return (
    <div className={styles.insAdd} data-testid="add-surface" data-guide="indicators.addSurface">
      {/* ⭐ UCT SIGNATURE R2 (owner Option 1, 2026-11-16) — the window's header: its title and ONE
          way to make an indicator, "✦ Create indicator" (soft-bright; gold only on the ✦). It opens
          the New formula window on its start view (Describe it, or start from a script / a picture /
          conditions / a setup). ⚰️ It replaces "Describe one (Soon)" and "+ New formula": two
          buttons for one job. Search stays the first and only input. */}
      <div className={styles.bHead}>
        <h3 className={styles.bTitle}>Indicators</h3>
        {onCreateFormula && (
          <button
            type="button"
            className={styles.addPrim}
            data-testid="settings-create-indicator"
            data-guide="indicators.create"
            onClick={() => onCreateFormula()}
          >
            <span className={styles.spark} aria-hidden="true">✦</span>Create indicator
          </button>
        )}
      </div>
      {/* ⚰️⚰️ A LINE OF EXPLANATORY COPY STOOD HERE — *"Search and add
          indicators, symbols, breadth and your own formulas."* It was written when
          this surface was new and the search box said less; the placeholder says
          the same thing now, one line lower, at the moment a member is actually
          looking at the field. Owner, 2026-09-17: *"the interface is
          self-explanatory."*
          ⛔ DELETED, NOT HIDDEN. The 12px of margin under it goes with it (see the
          `.insAddLede` grave), because leaving the gap behind would be the "merely
          hide the sentence" the brief rules out — the space belongs to the results
          now. */}

      <div className={styles.insSearchRow}>
        <div className={styles.indSearchWrap}>
          <span className={styles.indSearchIcon} aria-hidden="true"><Icon name="search" size={14} /></span>
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            className={styles.indSearch}
            /* ⛔ IT NAMES ONLY WHAT IS GENUINELY SEARCHABLE. `fundamentals` is
               deliberately absent — see `FUNDAMENTALS_STATUS`; promising a search
               that can return nothing is the "fake availability" the brief rules
               out. */
            placeholder="Search indicators or symbols…"
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
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leaveBrowse() }
            }}
          />
          {query && (
            <button
              type="button"
              className={styles.indClear}
              aria-label="Clear search"
              onClick={() => { setQuery(''); setTabPinned(false); searchRef.current?.focus() }}
            ><Icon name="x" size={12} /></button>
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
          ref={tabsRef}
          className={styles.insTabs}
          role="tablist"
          aria-label="Indicator categories"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const at = libraryTabs.findIndex((t) => t.key === activeTab)
            const step = e.key === 'ArrowRight' ? 1 : -1
            const next = libraryTabs[(Math.max(at, 0) + step + libraryTabs.length) % libraryTabs.length]
            if (next) { setTab(next.key); setTabPinned(true) }
          }}
        >
          {libraryTabs.map((t) => {
            const on = t.key === activeTab
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                /* ⚠️ WITH NOTHING SELECTED (a universal search) THE FIRST TAB IS
                   THE STOP, so the strip never drops out of the tab order. */
                tabIndex={on || (!activeTab && t.key === libraryTabs[0].key) ? 0 : -1}
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
        {/* ⛔⛔ FUNDAMENTALS SHOW ROWS ONLY FROM THE POINT-IN-TIME CATALOGUE. While
            it is unavailable (feature dark, not entitled, offline) the tab states
            that plainly and offers nothing -- it never falls back to Screener
            snapshots, which have no history behind them (`FUNDAMENTALS_STATUS`). */}
        {activeTab === 'fundamentals' && !fundAvailable && (
          <div className={styles.insUnavailable} data-testid="fundamentals-unavailable">
            <div className={styles.insUnavailableLede}>
              {fundCat.status === 'loading' ? 'Loading fundamentals…' : FUNDAMENTALS_STATUS.lede}
            </div>
            {fundCat.status !== 'loading' && (
              <p className={styles.insUnavailableWhy}>{FUNDAMENTALS_STATUS.why}</p>
            )}
          </div>
        )}
        {activeTab === HOUSE_TAB.key && (
          <IndicatorHouseTab
            styles={styles}
            query={query}
            listOwn={() => (generation >= 0 && registry?.listUserDefinitions?.()) || []}
            isOnOffer={(defId) => generation >= 0 && !!registry?.getDefinition?.(defId)}
            onPutOnChart={putInstalledOnChart}
          />
        )}
        {activeTab === MEMBERS_TAB.key && (
          <IndicatorMembersTab
            styles={styles}
            query={query}
            isOnOffer={(defId) => generation >= 0 && !!registry?.getDefinition?.(defId)}
            onPutOnChart={putInstalledOnChart}
          />
        )}
        {activeTab !== MEMBERS_TAB.key && activeTab !== HOUSE_TAB.key && (activeTab !== 'fundamentals' || fundAvailable) && tabResults.length === 0 && refusals.length === 0
          && !(activeTab === null && query.trim() && houseMatchCount > 0) && (
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
        {/* ⭐ A SEARCH ACROSS EVERY TAB REACHES THE UCT SET TOO (2026-11-18): "Fred" found nothing while
            Fred RS sat in the UCT tab. Its matches lead the results, under their own heading. */}
        {activeTab === null && query.trim() && (
          <IndicatorHouseTab
            styles={styles}
            query={query}
            searchOnly
            onMatches={setHouseMatchCount}
            listOwn={() => (generation >= 0 && registry?.listUserDefinitions?.()) || []}
            isOnOffer={(defId) => generation >= 0 && !!registry?.getDefinition?.(defId)}
            onPutOnChart={putInstalledOnChart}
          />
        )}
        {groups.map((c) => (
          <section key={c} className={styles.insAddGroup}>
            {/* ⚠️ ONE GROUP, ONE HEADING — AND NOT WHEN IT WOULD REPEAT THE TAB.
                `Popular` and `Formulas` resolve to a single group whose name is
                the tab's own word; printing it again is furniture. */}
            {groups.length > 1 && <div className={styles.insSectionLabel}>{c}</div>}
            <ul className={styles.resList} aria-label={c}>
              {tabResults.filter((r) => r.category === c).map(renderResult)}
            </ul>
          </section>
        ))}
        {/* ⭐ UCT SIGNATURE R2 — "NOT QUITE IT?" (owner Option 1). While the search has text, always —
            matches or not — the UCT Agent is offered for exactly what was typed. It opens the New
            formula window's start view with the words PRE-FILLED in Describe it; nothing is sent
            until the member presses Send there. With no matches it sits right under that sentence. */}
        {query.trim() && onCreateFormula && (
          <section className={styles.insAddGroup} data-testid="agent-build" aria-label="Not quite it?">
            <div className={styles.insSectionLabel}>Not quite it?</div>
            <button
              type="button"
              className={styles.agentRow}
              data-testid="agent-build-row"
              onClick={() => onCreateFormula({ description: query.trim() })}
            >
              <span className={styles.spark} aria-hidden="true">✦</span>
              <span className={styles.agentMain}>
                <span className={styles.agentName}>Build “{query.trim()}” with the UCT Agent</span>
                <span className={styles.agentSub}>It writes the formula and shows you a plain-English read-back and a preview before anything is added</span>
              </span>
              <span className={styles.agentArrow} aria-hidden="true">→</span>
            </button>
            {onOpenBuilderDoor && (
              <div className={styles.agentAlt} data-testid="agent-build-doors">
                <span>Or</span>
                <button type="button" className={styles.agentAltLink} data-testid="door-pine" onClick={() => onOpenBuilderDoor('pine')}>Paste a TradingView script</button>
                <button type="button" className={styles.agentAltLink} data-testid="door-image" onClick={() => onOpenBuilderDoor('image')}>Start from a picture</button>
                <button type="button" className={styles.agentAltLink} data-testid="settings-new-formula" onClick={() => onOpenBuilderDoor('formula')}>Write a formula</button>
              </div>
            )}
          </section>
        )}
        {/* Saved, and not offered — with the gate's own reason, verbatim. Rendered
            only when something was actually refused, so a member whose formulas
            all install sees no heading about nothing. */}
        {activeTab !== MEMBERS_TAB.key && activeTab !== HOUSE_TAB.key && refusals.length > 0 && (
          <section className={styles.insAddGroup} data-testid="user-definition-refusals">
            <div className={styles.insSectionLabel}>{REFUSED_CATEGORY}</div>
            <p className={styles.resRefusedLede}>
              These saved indicators are not being offered on this chart. The reason
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
                      <span className={styles.resMine}>Your indicator</span>
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

  // ─── THE PANEL — ONE COLUMN (UCT Signature, the owner-approved Chart Settings Lab, 11-15) ─
  //
  // ⚰️⚰️ IT WAS TWO COLUMNS — the structure list on the left, the Inspector or the Add surface on
  // the right. The lab replaced that: the section is ONE column at the window's own width (the
  // window is a fixed 700 × 620 and nothing here may widen it), showing EITHER the list of what is
  // on the chart (one card per pane) OR one indicator's editor (← All indicators). Adding opens its
  // own Indicators window, floating over Chart Settings.
  //
  // ⭐ THE LIST STAYS MOUNTED WHILE AN EDITOR IS OPEN — `hidden`, not unmounted — so coming back
  // keeps its scroll position, its folded panes and its keyboard place.
  const editing = mode !== 'arrange' && !!(selectedRow || selectedFeature)
  const isArrange = mode === 'arrange'
  const nothing = activeRows.length === 0 && addedFeatures.length === 0
  const templatesOn = indicatorTemplatesEnabled()
  const maLabelsOn = !!(settings && settings.showMaLabels)
  const setMaLabels = (v) => onChange?.({ ...settings, showMaLabels: v, preset: 'custom' })

  // ⭐ THE ONE PRIMARY BUTTON SITS IN THE WINDOW'S OWN HEADER ROW, beside the "Indicators" title
  // (the lab). Hosts without that header (tests, a bare mount) get it in a row of its own.
  const headAction = isArrange ? (
    <button type="button" className={styles.addPrim} data-testid="arrange-done" onClick={leaveArrange}>Done</button>
  ) : (
    <button type="button" className={styles.addPrim} data-testid="add-enter" data-guide="indicators.add" onClick={enterBrowse}>
      <Icon name="plus" size={13} />Add indicator
    </button>
  )

  return (
    <div className={styles.indTab} ref={tabRootRef} data-mode={mode} data-view={editing ? 'editor' : 'list'}
      data-narrow={narrow ? 'true' : undefined}>
      {/* the one description every "Soon" control points at */}
      <span id={soonDescId} hidden>{SOON}</span>
      {headSlot ? createPortal(headAction, headSlot) : <div className={styles.headSlot}>{headAction}</div>}

      <div className={styles.listView} data-testid="chart-structure" hidden={editing || undefined}>
        {isArrange ? (
          <div className={styles.insStructure} data-testid="arrange-list">
            <p className={styles.arrangeHint} data-testid="arrange-aside">
              Drag a pane to restack the chart. Everything drawn inside a pane travels with it; to move
              one series to another pane, open it and change its Pane.
            </p>
            {arrangeable.map((g, i) => renderArrangeGroup(g, i))}
          </div>
        ) : nothing ? (
          <div className={styles.emptyAll}>
            <span>No indicators on this chart</span>
            <button type="button" className={styles.indEmptyLink} onClick={enterBrowse}>Add something</button>
          </div>
        ) : (
          <div
            className={styles.insStructure}
            role="group"
            aria-label="Series on this chart"
            aria-controls={editing && selected ? inspectorDomId(selected) : undefined}
            ref={listRef}
            onKeyDown={onStructureKeys}
          >
            {/* ⚠️ `volumeRef` STAYS WITH THE VOLUME GROUP — the modal's scroll anchor for the
                Volume deep link. */}
            {paneGroups.map((g) => renderStructureGroup(g, g.id === 'volume' ? volumeRef : null))}
            {addedFeatures.map(renderFeatureGroup)}
            {/* ⭐ "Labels on the price scale" — the chart's existing `showMaLabels` (also on Canvas). */}
            <div className={styles.optCard}>
              <div className={styles.optRow} onClick={(e) => { if (!e.target.closest('button')) setMaLabels(!maLabelsOn) }}>
                <Switch
                  checked={maLabelsOn} aria-label="Labels on the price scale"
                  className={styles.soft} checkedClassName={styles.softOn} knobClassName={styles.softKnob}
                  onClick={() => setMaLabels(!maLabelsOn)}
                />
                <span className={styles.optText}>
                  <span>Labels on the price scale</span>
                  <span className={styles.hint}>each moving average’s current value on the right axis</span>
                </span>
              </div>
            </div>
            {/* ⭐ A1.4 — the stored indicators this chart cannot show, with Repair / Remove / Keep. */}
            <UnavailableIndicators variant="group" cs={settings} registry={registry} write={onChange}
              surfaceKey={historyKey || 'global'} userId={historyUserId}
              onOpenBuilder={definitionDoors && typeof definitionDoors.editFormula === 'function' ? (id) => definitionDoors.editFormula(id) : null} />
          </div>
        )}
        {/* FT-070 — save / apply indicator templates, when that flag is on. */}
        {!isArrange && templatesOn && (
          <div className={styles.templatesSlot}>
            <IndicatorTemplatesBar settings={settings} onChange={onChange} registry={registry} />
          </div>
        )}
        <div className={styles.tfoot}>
          {/* ⭐ A1.2 — Undo / Redo for this chart's indicator changes (the toast's stack). */}
          <IndicatorHistoryButtons surfaceKey={historyKey} userId={historyUserId} cs={settings} write={onChange} />
          <span className={styles.sp} />
          {/* ⛔ OFFERED ONLY WHEN THERE IS SOMETHING TO ARRANGE. */}
          {!isArrange && arrangeable.length > 1 && (
            <button type="button" className={styles.footBtn} data-testid="arrange-enter" data-guide="indicators.arrange"
              onClick={enterArrange}>Arrange panes</button>
          )}
          {/* Indicator sets (save as a set · use on new charts · apply a set) — Soon, unless the
              templates flag is on, where the bar above already does it. */}
          {!isArrange && !templatesOn && (
            <button type="button" className={`${styles.footBtn} ${styles.soonRow}`} disabled aria-disabled="true"
              aria-label="Indicator sets (coming soon)" title={SOON} aria-describedby={soonDescId} aria-haspopup="menu">
              Indicator sets<Icon name="chev" size={12} /><span className={modalStyles.soonTag}>Soon</span>
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className={styles.editorView} data-testid="inspector">
          {selectedFeature ? renderFeatureInspector(selectedFeature) : renderInspector(selectedRow)}
        </div>
      )}

      {/* ⭐ THE INDICATORS WINDOW — its own floating window over Chart Settings, centred, with its
          own ✕; Escape or a click on the dim outside closes it (and only it). It is rendered INSIDE
          the settings window's DOM, so the UCT Agent's guide (`within: 'chartSettings'`) and the
          window's outside-click rule both keep seeing it as part of Chart Settings. */}
      {discovering && (
        <div
          className={styles.pickBackdrop}
          onMouseDown={(e) => { if (e.target === e.currentTarget) leaveBrowse() }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return
            e.preventDefault(); e.stopPropagation(); leaveBrowse()
          }}
        >
          <div className={styles.pickWin} role="dialog" aria-modal="true" aria-label="Indicators">
            {renderAddSurface()}
            <button type="button" className={styles.winClose} aria-label="Close Indicators" title="Close" onClick={leaveBrowse}>
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ⭐ UCT RS PHASE 3, UNIT 3-02b — THE INSPECTOR'S TEXT BOX (a `string` input).
 *
 * The settings dialog's rules (`IndicatorSettingsDialog`, 3-02), reimplemented
 * here because the dialog's version is woven into its own draft/flush state:
 *   · the box shows what the member types (`textInputDraft`: upper-cased when the
 *     input says so, never trimmed under the cursor) and writes NOTHING while
 *     they type;
 *   · Enter or blur commits, and only a value the input accepts
 *     (`textInputCommit` — the engine's own `validateInputValue`); an unchanged
 *     value writes nothing;
 *   · a miss keeps the text, sets `aria-invalid`, and shows the input's own
 *     `hint` (else "Not a valid value") under the box through
 *     `aria-describedby`; it clears the moment the text reads right.
 * A write from elsewhere (a preset, Undo, another surface) replaces the box: the
 * stored value is the truth once it moves.
 *
 * ⚠️ WIDTH: the cell is `min(210px, 100%)` and `min-width: 0`, so a narrow
 * Inspector shrinks the box rather than pushing the row past the panel (the 2a
 * visual round's column truncation); the label column is untouched.
 */
function InspectorTextBox({ field, value, inert, styles, idBase, onCommit }) {
  const stored = value == null ? '' : String(value)
  const [draft, setDraft] = useState(null)    // null = showing the stored value
  const [miss, setMiss] = useState(null)
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    // the stored value moved under the box — the documented "adjust state on a
    // prop change" pattern, not an effect, so no frame shows the stale draft
    setSeen(stored)
    setDraft(null)
    setMiss(null)
  }
  const commit = () => {
    if (draft === null) return
    const c = textInputCommit(field, draft)
    if (!c.ok) { setMiss(c.hint); return }
    setDraft(null)
    setMiss(null)
    if (c.value === stored) return
    onCommit(c.value)
  }
  const missId = miss ? `${idBase}-miss` : null
  const { 'aria-describedby': whyId, ...rest } = inert || {}
  const describedBy = [whyId, missId].filter(Boolean).join(' ') || undefined
  return (
    <span className={styles.insTextCell} data-text-cell="true">
      <input
        type="text" id={idBase} className={styles.insText}
        aria-label={field.label}
        {...rest}
        aria-describedby={describedBy}
        aria-invalid={miss ? 'true' : undefined}
        placeholder={field.placeholder}
        maxLength={Number.isInteger(field.maxLength) ? field.maxLength : undefined}
        autoCapitalize={field.case === 'upper' ? 'characters' : undefined}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        value={draft === null ? stored : draft}
        onChange={(e) => {
          const text = textInputDraft(field, e.target.value)
          setDraft(text)
          if (miss && textInputCommit(field, text).ok) setMiss(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      {miss && <span className={styles.insTextMiss} id={missId} role="status">{miss}</span>}
    </span>
  )
}
