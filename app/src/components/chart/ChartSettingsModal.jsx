import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from './ColorPanel'
import { CHART_DEFAULTS } from './chartDefaults'
import ChartThemesModal from './ChartThemesModal'
import { applyThemeToOneChart } from './chartThemes'
import { legendModeOf, LEGEND_MODES } from './legendMode'
import { BAR_INFO_FIELDS, barInfoFieldsOf, withBarInfoField } from './barInfoFields'
import { WM_BOX_WIDTHS, DEFAULT_BOX_W } from './watermarkPrimitive'
import { crosshairModeOf, CROSSHAIR_MODES } from './crosshairMode'
// The option lists (and the meaning of every setting) live in the product-owned descriptor table.
import { COLOR_MODES, TITLE_MODES, TEXT_SIZES, SWING_SENS, EVENT_MARKERS, PDL_LINES, LINE_STYLES, PDL_WIDTHS, WM_SIZES, WM_WEIGHTS, WM_LINES } from './chartSettingsDescriptors'
import {
  listAllIndicators, applyRowPatch, splitIndTarget, isIndTarget, overlayRowId,
  isSignTarget, splitSignTarget,
} from './indicatorRegistry'
// ⭐ THE PRESENTATION WRITER FOR A SIGNED HISTOGRAM'S PAIR. Already shipped, and
// already deleting the key when the chosen colour IS the chart's — which is how
// a series stays theme-derived instead of freezing a hex.
import { setInstanceCandleColor, findInstance } from './engine/instanceControls'
// The consolidated Indicators tab — search · browse · author · the active list ·
// per-indicator settings, all in one place. It renders THIS file's rows through
// THIS file's writer and colour swatch; see its header for why it is a
// composition of the two shipped surfaces rather than a third one.
import ChartSettingsIndicators from './ChartSettingsIndicators'
import { useUserDefinitions, useInstalledUserDefinitions } from '../../hooks/useUserDefinitions'
// The engine's definitions, so the Indicators tab can GENERATE the rows for the
// indicators the engine owns instead of carrying a second hand-written copy of
// their fields. See `indicatorRegistry.js`'s header — this import is what
// "superseded, not absorbed" looks like at the consumer.
import * as engineRegistry from './engine/nativeRegistry'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import UIcon from '../ui/UIcon'
import { HEADER_FIELDS, SIGN_POS, SIGN_NEG } from './headerFields'
import { headerStatKeys, statLabelsOf, withStatLabel, headerStatTogglePatch, movedHeaderStats, headerStatMetaOf, statStylesFor, withHeaderStatStyle } from './headerStatCatalog'
import { STAT_SIZES, STAT_SIZE_LABELS, STAT_WEIGHTS, STAT_WEIGHT_LABELS, STAT_WEIGHT_VALUE, DEFAULT_BOX_COLOR, pickedBoxColor } from './headerStatStyle'
import { customStatsOf, customStatKey, addCustomStatPatch, customStatAddRefusal } from './headerCustomStats'
import { customStatLabel, customStatSigned, customStatOutputRefusal } from './engine/customStatCompute'
import { HeaderStatList, HeaderStatPicker } from './HeaderStatPicker'
import styles from './ChartSettingsModal.module.css'
import useFocusTrap from '../mobile/useFocusTrap'
import { inertBackground, MODAL_Z } from '../mobile/backgroundInert'
// TERM-052: the template cap is published in Settings from this same constant.
import { MAX_CHART_TEMPLATES } from './chartCeilings'
// ⭐ The ONE apply every saved-template door shares (this modal, the right-click
// flyout, UCT Agent) — see chartTemplateApply.js for the ruling behind it.
import { chartTemplateSettings, chartTemplatesAfterSave, chartTemplatesAfterDelete } from './chartTemplateApply'
import { keepIndicatorState } from './indicatorPreservation'
import { recordIndicatorChange } from './indicatorHistoryStore'
import TypeGlyph from './ChartTypeGlyph'
import ChoiceMenu from './ChoiceMenu'
import { APPEARANCE_SECTION_KEYS } from './chartAppearance'
import Switch from '../ui/Switch'
import { PANE_LOOK } from './pane/paneLook'
import { headerColors } from './pane/headerDefaultColors'
import {
  candlePartsOf, priceLineOf, gridLinesOf, gridPatchFor, rightMarginOf, priceDecimalsOf, timeFormatOf, scaleTimePatch,
  sessionBreaksOf, preMarketLevelsOf, nextEarningsMarkerOf, timeZoneOf, extendedHoursOf, priceAlertLinesOf,
  myTradeMarkersOf,
  PRICE_LINE_STYLES, GRID_LINES, TIME_FORMATS, TIME_ZONES, PRICE_DECIMALS, RIGHT_MARGIN_MIN, RIGHT_MARGIN_MAX,
} from './chartViewOptions'

// A user's saved chart-settings templates live in ONE global pref so they're
// available from every chart/tab/grid cell. Applying a template routes through
// the modal's onChange (→ the active surface's own settings), never the global
// pref, so it lands on exactly the tab/widget you opened settings from.
const CHART_TEMPLATES_KEY = 'chart_templates'

/**
 * Chart Settings — the new, centered, OLED-black settings modal for the Charts
 * workspace. Replaces the old inline gear panel. Opened by the settings button in
 * the chart header (above the clock). Built section-by-section; v1 ships the chart
 * TYPE selector. `settings` is the merged chart_settings object; `onChange(next)`
 * persists the whole object (via chart_settings preference).
 */

// #rrggbb + 0..1 alpha ⇄ 8-digit hex — for the watermark, whose color & opacity
// are stored as separate settings but edited through the one opacity-aware picker.
function splitHexA(v) {
  const m8 = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i.exec((v || '').trim())
  if (m8) return { rgb: `#${m8[1].toLowerCase()}`, a: parseInt(m8[2], 16) / 255 }
  const m6 = /^#?([0-9a-f]{6})$/i.exec((v || '').trim())
  return { rgb: m6 ? `#${m6[1].toLowerCase()}` : '#a8a290', a: 1 }
}
function joinHexA(rgb, a) {
  const base = /^#[0-9a-f]{6}$/i.test(rgb || '') ? rgb.toLowerCase() : '#a8a290'
  const av = Math.max(0, Math.min(1, a ?? 1))
  if (av >= 0.999) return base
  return base + Math.round(av * 255).toString(16).padStart(2, '0')
}

// Compact type glyphs (24×24, currentColor) so each option reads at a glance.

const CHART_TYPES = [
  { val: 'candles', label: 'Candles' },
  { val: 'hollow',  label: 'Hollow Candles' },
  { val: 'hlc',     label: 'HLC Bars' },
  { val: 'bars',    label: 'OHLC Bars' },
  { val: 'line',    label: 'Line' },
  { val: 'area',    label: 'Area' },
]


const TARGET_MAP = {
  bodyUp: 'upColor', bodyDown: 'downColor',
  borderUp: 'upBorder', borderDown: 'downBorder',
  wickUp: 'upWick', wickDown: 'downWick',
  one: 'oneColor',
}

// Header tab options.
// Shape of the on-chart OHLCV legend. Horizontal is the flat, box-less strip.
// ⚰⚰ `LEGEND_LAYOUTS` ('Vertical' / 'Horizontal') STOOD HERE AND IS RETIRED.
// There is ONE workspace legend now — a horizontal BAR INFO strip of the candle's
// own readings above a vertical STUDY STACK of the plots drawn in the pane — so
// the control had nothing left to choose between. What replaced it in this
// section is WHICH FIELDS the bar-info strip prints; see `barInfoFields.js`.
//
// ⛔ THE SELECTOR IS DELETED RATHER THAN DISABLED. A dead layout control that
// still renders is a control a member will click and be confused by, and leaving
// one is exactly what the brief refused.

// Location-aware right-click "… settings" → the settings tab to open on. Watermark
// and axis are deeper Canvas sections (scrolled to); the rest are tab-tops.
/** A `scrollTo` naming ONE indicator row: `ind:<rowId>` (`ind:ma:2`,
 *  `ind:volume`, `ind:legacy:rsi`).
 *
 *  ⭐ THE LEGEND'S GEAR SENDS THESE. It rides the same `scrollTo` channel as
 *  `watermark` / `axis` / `volume` rather than a second prop, so a surface has
 *  exactly one way to ask this modal to open somewhere — and the row id is the
 *  one the Indicators tab already publishes as `data-row-id`, so nothing has to
 *  translate between the two.
 *  ⚠️ THE ROW ID ITSELF CONTAINS COLONS (`legacy:rsi`), which is why this slices
 *  the prefix instead of splitting on ':'. */
// ⛔ NOT EXPORTED. This is a component file, and `react-refresh/only-export-components`
// refuses a second export — correctly: a shared helper here would break fast
// refresh for the whole modal. The modal is the only reader; the WRITERS just
// build the string, which is why the prefix is spelled in the JSDoc above.
/** `userDefs`' empty value. A STABLE identity, and that is load-bearing: SWR
 *  answers `[]` as a fresh array on every render until data lands, so a feed that
 *  compared by identity alone would set state forever. See `sameFeed`. */
const NO_USER_DEFS = Object.freeze({ rows: Object.freeze([]), errors: Object.freeze([]) })

/** Two lists are "the same answer" when they are the same object OR both empty. */
const sameList = (a, b) => a === b
  || (Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0)

/**
 * The member's own formulas, subscribed and handed up. Renders NOTHING.
 *
 * ⭐ IT EXISTS TO BE UNMOUNTABLE. React has no conditional hooks, so "subscribe
 * only while the modal is open" cannot be expressed in the modal's own body — it
 * has to be a child that the open branch renders and the closed branch does not.
 * See the block at `userDefs` for what running these while closed actually cost.
 *
 * ⛔ THE ORDER OF THE TWO CALLS IS LOAD-BEARING, and is copied from
 * `IndicatorLibraryDialog`. `useInstalledUserDefinitions` performs the install
 * DURING RENDER, so a registry read taken before it is the value from before.
 * Two hooks, ONE request — both hand SWR the same key, so the second is deduped
 * into the first, and the install is idempotent by `installKey`.
 *
 * ⚠️ THE PARENT LEARNS ONE FRAME LATER THAN IT USED TO, and that is the whole
 * price. A child renders after its parent, so on the paint where SWR's data lands
 * the parent's `indRows` is still the pre-install list; `onLoaded` then sets state
 * and the next paint reads the installed registry. The alternative — keeping the
 * hooks in the parent — is what cost a subscription on every closed modal.
 */
function UserFormulaFeed({ onLoaded }) {
  const { rows } = useUserDefinitions()
  const { errors } = useInstalledUserDefinitions()
  useEffect(() => { onLoaded(rows, errors) }, [rows, errors, onLoaded])
  return null
}

const IND_TARGET_PREFIX = 'ind:'

/** ⭐⭐ THE CHART-DATA ADDRESS (Track B, 2026-09-14).
 *
 *  The on-chart popover's **Edit in Indicators…** sends `data:<instanceId>` down
 *  the SAME `scrollTo` channel everything else uses, because this file's rule is
 *  that a surface has exactly one way to ask the modal for something. It resolves
 *  to the Indicators tab expanded on that instance's row — the full per-instance
 *  editor.
 *
 *  ⚰️ THIS USED TO SAY "Track A's Chart Data tab does not exist on master yet, so
 *  TODAY this resolves to the Indicators tab". It landed, and it landed as the
 *  SAME tab: the pane map, the per-pane groups and the inline editor are all on
 *  the tab this prefix already pointed at, and 2026-09-16 renamed its member-
 *  facing label from "Chart Data" to **Indicators** (owner §5). So the prefix has
 *  nothing left to be claimed by — both spellings address one surface, which is
 *  why `data:` and `ind:` are two prefixes into one branch rather than two tabs.
 *
 *  ⚠️ A ROW ID CAN ITSELF CONTAIN COLONS (`legacy:rsi`, `inst:qqq`), which is why
 *  both prefixes are SLICED rather than split. */
const DATA_TARGET_PREFIX = 'data:'

/** The LEGEND's spelling for a moving-average row. Its own vocabulary — see
 *  `indicatorRegistry.overlayRowId` for why the two differ and why the seam is
 *  here rather than at either end. */
const LEGEND_MA_PREFIX = 'ma:'

function indTargetRow(scrollTo) {
  if (typeof scrollTo !== 'string') return null
  const prefix = scrollTo.startsWith(IND_TARGET_PREFIX) ? IND_TARGET_PREFIX
    : (scrollTo.startsWith(DATA_TARGET_PREFIX) ? DATA_TARGET_PREFIX : null)
  if (!prefix) return null
  const rowId = scrollTo.slice(prefix.length)
  // ⭐ THE ONE TRANSLATION: `ma:0` (what the legend calls it) → `overlay-0` (what
  // this tab calls it). Everything else — `volume`, `legacy:rsi`, an instance id —
  // is spelled the same on both surfaces and passes straight through.
  //
  // ⚠️ `Number.isInteger` RATHER THAN A TRUTHY PARSE. `ma:0` is a real row and
  // `Number('0')` is falsy; a `||` guard here would have dropped EMA 9 — the first
  // moving average on every chart — and nothing else.
  if (rowId.startsWith(LEGEND_MA_PREFIX)) {
    const n = Number(rowId.slice(LEGEND_MA_PREFIX.length))
    return Number.isInteger(n) && n >= 0 ? overlayRowId(n) : null
  }
  return rowId
}

// The five sections: id · the label the rail and the heading show · the rail icon.
// ⚠️ The label is also what UCT Agent reads off the open tab (guide/explain.js) and the first step of every
// descriptor `ui` path ("Chart Settings → Header & legend → …"), so a rename here is a rename there too.
const SETTINGS_TABS = [
  ['price', 'Price style', 'chart'],
  ['canvas', 'Canvas', 'board'],
  ['indicators', 'Indicators', 'wave'],
  ['header', 'Header & legend', 'rows'],
  ['markers', 'Markers', 'pin'],
]
const TAB_LABEL = Object.fromEntries(SETTINGS_TABS.map(([id, label]) => [id, label]))
// "Reset this section" (owner 11-15): the settings keys each section's own controls write. A reset puts
// ONLY these back to CHART_DEFAULTS. Indicators has no entry (its rows are the Indicators project's,
// with their own undo) so it shows no reset button yet.
// (11-16) ONE table with "Apply to all charts": chartAppearance.js owns it, so the keys a section resets and the keys
// the look-copy carries can never disagree.
const SECTION_RESET_KEYS = APPEARANCE_SECTION_KEYS

const SETTINGS_TARGET_TAB = {
  candles: 'price',
  canvas: 'canvas',
  watermark: 'canvas',
  axis: 'canvas',
  ma: 'indicators',
  volume: 'indicators',
  // The chart header's "Add to Chart" control: Indicators, already in the add
  // surface (ChartSettingsIndicators `openAdd`).
  add: 'indicators',
  // A chart-header stat's menu (owner 11-17): "Header settings…" opens Header & legend; "Add a stat…" opens its stat
  // picker; "Add an indicator value…" opens the picker's custom-stat page.
  header: 'header',
  'header:add': 'header',
  'header:custom': 'header',
}
// When the on-chart OHLCV legend shows. ⚠️ The VALUES are not written here —
// `LEGEND_MODES` is the enumeration, and this only supplies each one's label and
// its one-line explanation. A hand-typed value list beside the module that owns
// it is how a fourth mode ends up unreachable from the settings UI.
const LEGEND_MODE_LABELS = {
  always: { label: 'Always', hint: 'On, following the crosshair as you hover' },
  hold: { label: 'Hold', hint: 'Chart stays clean; press and hold to peek, release to hide' },
  off: { label: 'Off', hint: 'Never shown' },
}
// When the hover crosshair (lines + tracking axis labels) shows. Same three-way
// control as the legend; labels/hints only — `CROSSHAIR_MODES` owns the values.
const CROSSHAIR_MODE_LABELS = {
  always: { label: 'Always', hint: 'On, following the cursor as you hover' },
  hold: { label: 'Hold', hint: 'Chart stays clean; press and hold to show it, release to hide' },
  off: { label: 'Off', hint: 'Never shown' },
}

export default function ChartSettingsModal({
  open, onClose, settings, onChange, savedColors = [], onSaveColor, onDeleteColor, themeVars = null,
  // The window's title. A host whose modal edits SHARED settings (the multi-chart
  // grid) names that here so the scope of the edit is visible before it is made.
  title = 'Chart Settings',
  // ⭐ A1.2 — the chart's indicator Undo stack, for the Indicators tab's Undo / Redo.
  historyKey = null, historyUserId = null,
  // Optional: apply a UCT theme to EVERY chart in the layout at once. Supplied by
  // the Charts workspace (via ChartPane); when absent, the themes gallery offers
  // only "this chart".
  // ⚰️ FORWARDED, NOT RE-DERIVED. The volume-presentation inputs the RENDERER
  // holds as props (`volumeSeparatePane` / `blankVolume` / `shown`); Chart Data
  // needs the same ones or it answers a different question than the chart does.
  // See `chartDataMap`'s note at `separateVolume`.
  volumeOpts = null,
  onApplyThemeAll = null,
  // Optional: apply the theme to EVERY widget in the layout (chart or not).
  onApplyThemeAllWidgets = null,
  // Optional (Charts workspace): the adjustable-watermark shortcuts. "Move
  // watermark" enters the same drag+confirm mode as the right-click item;
  // "Reset to center" clears this chart's saved position. Absent elsewhere.
  // The timeframe the chart this modal belongs to is ON — handed to Indicators so
  // it can SAY when a calculation timeframe cannot draw here. Absent on the grid.
  chartTf = null,
  // Host features (Earnings Strip, Company Info) for the Indicators tab — see
  // ChartSettingsIndicators' `chartFeatures`. Absent everywhere but /charts.
  chartFeatures = null,
  onAdjustWatermark = null,
  onResetWatermark = null,
  watermarkCustomized = false,
  // Optional section to reveal on open, e.g. 'watermark' (right-click "Adjust
  // watermark") → open on the Canvas tab and scroll the Watermark section in.
  scrollTo = null,
  // Reason string when the SURFACE that opened this modal fixes the volume pane
  // itself (charts workspace / multi-chart grid — see VOLUME_PANE_SURFACE_FIXED).
  // Renders the separate-pane toggle inert rather than letting it look live.
  volumePaneFixed = null,
  // ⭐ THE FORMULA BUILDER'S DOOR — A LAUNCHER, NOT A MOUNT.
  //
  // `BuilderSheet` has exactly ONE mount site (`ChartToolbar`) and an AST rail
  // in `BuilderSheet.test.jsx` that fails the build if a second appears —
  // deliberately, because two mounts is two drafts over one member's work. So
  // the Indicators tab asks the HOST to open the one that exists; the host is
  // whoever can reach the chart's toolbar API (`ChartPane` does, through
  // `toolbarApiRef`).
  //
  // ⚠️ ABSENT PROP ⇒ ABSENT DOOR, the same rule `IndicatorLibraryDialog` follows.
  // A surface with no way to reach a builder shows no New Formula button rather
  // than one that does nothing.
  onCreateFormula = null,
  // ⭐ P2 Track B — Create Indicator's door; passed through to the Indicators tab.
  onCreateIndicator = null,
  // (door) => void: the builder's doors ('pine' | 'image' | 'formula'); passed to the Indicators tab.
  onOpenBuilderDoor = null,
  // ⭐ PHASE 4 — the definition's own doors (modify / edit formula / custom copy).
  definitionDoors = null,
  // ⭐ UCT RS Phase 4 (4-11) — the Indicators tab's FIRST add of a definition with a
  // `meta.tour` (ChartSettingsIndicators `onFirstAdd`). The host holds it until
  // this modal closes, then hands it to the chart's tour (ChartPane). Absent ⇒ none.
  onIndicatorFirstAdd = null,
  // Optional `{ current: Element }` -- the control that opened this modal (the
  // gear). Focus returns there on close; without it, to whatever held focus at open.
  returnFocusRef = null,
  // ⭐ "Apply to all charts" (owner 11-16, was Soon) — the Charts workspace's door, `{ count(), apply() }`:
  // `count()` = how many OTHER charts the open layout holds, `apply()` copies this chart's look onto them
  // (chartAppearance.js decides what "look" means) and returns how many changed. ABSENT PROP ⇒ ABSENT DOOR:
  // a chart outside a workspace layout shows no such control.
  applyToAllCharts = null,
}) {
  const panelRef = useRef(null)
  const dialogRef = useRef(null)      // the `role="dialog"` layer (the backdrop) -- focus target + trap container
  const watermarkRef = useRef(null)   // Watermark section (Canvas) — scrolled in for scrollTo='watermark'
  const axisRef = useRef(null)        // Axis Labels section (Canvas) — for scrollTo='axis'
  const volumeRef = useRef(null)      // Volume group (Indicators) — for scrollTo='volume'
  const dragRef = useRef(null)
  const [activeTab, setActiveTab] = useState('price') // 'price' | 'canvas'
  const [activeTarget, setActiveTarget] = useState(null) // { target, label }
  const [panelPos, setPanelPos] = useState(null)
  const [pos, setPos] = useState(null) // dragged modal position {left, top}; null = centered
  const [confirmReset, setConfirmReset] = useState(false)
  const resetTimerRef = useRef(null)
  const [confirmSectionReset, setConfirmSectionReset] = useState(null)  // the tab id awaiting its second click
  const sectionResetTimerRef = useRef(null)
  const [themesOpen, setThemesOpen] = useState(false)
  const soonDescId = useId()   // the one hidden "Coming soon" description every Soon control points at

  // Apply a UCT theme's visual layer. 'one' → this surface (via onChange, exactly
  // like a template); 'all' → every chart in the layout; 'allwidgets' → every
  // widget in the layout (chart or not). The last two are workspace-supplied.
  const applyTheme = (theme, scope) => {
    if (scope === 'allwidgets' && onApplyThemeAllWidgets) onApplyThemeAllWidgets(theme)
    else if (scope === 'all' && onApplyThemeAll) onApplyThemeAll(theme)
    // 'one' = this chart only. An app-mirrored theme uses the app surface as canvas.
    else onChange?.(applyThemeToOneChart(settings, theme))
  }

  // ─── THE MEMBER'S OWN FORMULAS, SUBSCRIBED FROM A CHILD ───────────────────
  //
  // ⛔⛔ THE SUBSCRIPTION IS STILL THE MODAL'S, BUT IT NO LONGER RUNS WHILE THE
  // MODAL IS CLOSED. `indRows` is computed by THIS component, from a registry the
  // tab does not touch — so a member's formulas arriving from SWR after first
  // paint have to re-render THIS one or the row list stays the one built while the
  // registry was still empty. That reason is unchanged; what changed is WHERE the
  // hooks live.
  //
  // ⚰️ THEY WERE CALLED DIRECTLY IN THIS BODY, above `if (!open) return null` —
  // and a closed modal still runs its body. Every chart mounts this component,
  // open or not, so every chart in a nine-cell grid was subscribing to the
  // member's formulas for a panel nobody had opened. Before the consolidation
  // these hooks lived in `IndicatorLibraryDialog`, which only MOUNTED when the
  // library was open; moving them here quietly widened them to every chart.
  //
  // ⛔ AND IT BROKE TWO PAGES IN ANOTHER WORKSTREAM. `useUserDefinitions` reads
  // `useContext(AuthContext)` directly (deliberately — `useAuth` throws outside a
  // provider and a chart renders in surfaces that mount none). Two journal pages
  // mount a real `ChartPane`, and their `vi.mock` of that module omits the context
  // OBJECT; vitest THROWS on a missing named export rather than returning
  // undefined, so the whole page rendered blank and 39 assertions failed three
  // components from the cause. Completing those mocks would have been an edit to
  // files the Notebook workstream owns — `hub/rule12Paths.test.js` refuses it, and
  // it is right to: the defect is HERE, in a chart component that had no business
  // subscribing while closed.
  //
  // ⭐ SO `UserFormulaFeed` MOUNTS INSIDE THE OPEN BRANCH and lifts what it finds.
  // A closed modal now runs no formula hooks at all, touches no auth context, and
  // costs no SWR subscription — which is what it did before this tab existed.
  const [userDefs, setUserDefs] = useState(NO_USER_DEFS)
  const { rows: userDefRows, errors: userDefErrors } = userDefs
  // ⚠️ THE GUARD IS NOT AN OPTIMISATION, IT IS WHAT STOPS AN INFINITE LOOP. SWR
  // hands back a FRESH `[]` on every render until data arrives, so a plain
  // `setUserDefs({rows, errors})` would change identity every time, re-render,
  // re-fire the child's effect, and never settle. `sameList` treats two empty
  // lists as one answer; once data lands, SWR's own object identity is stable.
  const onUserDefsLoaded = useCallback((rows, errors) => {
    setUserDefs((prev) => (sameList(prev.rows, rows) && sameList(prev.errors, errors)
      ? prev
      : { rows, errors }))
  }, [])

  // ── Settings templates (save the whole look, reuse on any tab) ──────────────
  const { prefs, setPref } = usePreferences()
  const templates = useMemo(() => {
    const arr = parsePref(prefs?.[CHART_TEMPLATES_KEY], [])
    return Array.isArray(arr) ? arr : []
  }, [prefs])
  const [tplMenuOpen, setTplMenuOpen] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)   // inline "name your template" row is showing
  const [tplName, setTplName] = useState('')
  const tplInputRef = useRef(null)
  useEffect(() => { if (savingTpl && tplInputRef.current) { tplInputRef.current.focus(); tplInputRef.current.select() } }, [savingTpl])
  // Info row stat picker (Header & legend, owner 11-16): an inline sub-page INSIDE the window (HeaderStatPicker.jsx),
  // never a portal. Any other section, or closing the window, puts the section back on its main page.
  const [statPickerOpen, setStatPickerOpen] = useState(false)
  useEffect(() => { setStatPickerOpen(false) }, [activeTab, open])
  // opened from a header stat's "Add a stat…" / "Add an indicator value…" (after the reset above, same commit)
  const statPickerStart = open && (scrollTo === 'header:custom' ? 'custom' : scrollTo === 'header:add' ? 'list' : null)
  useEffect(() => { if (statPickerStart && activeTab === 'header') setStatPickerOpen(true) }, [statPickerStart, activeTab])

  const persistTemplates = (arr) => setPref(CHART_TEMPLATES_KEY, JSON.stringify(arr.slice(0, MAX_CHART_TEMPLATES)))
  const commitSaveTemplate = () => {
    // Snapshot the CURRENT settings as the template body. A same-named template (case-insensitive)
    // is overwritten so re-saving updates in place — the ONE shared save (chartTemplateApply.js),
    // which UCT Agent's template save also uses.
    const saved = chartTemplatesAfterSave(templates, tplName, settings)
    if (!saved) { setSavingTpl(false); setTplName(''); return }
    persistTemplates(saved.templates)
    setSavingTpl(false); setTplName(''); setTplMenuOpen(false)
  }
  const applyTemplate = (t) => {
    const next = chartTemplateSettings(t)
    if (!next) return
    // ⭐ A1.3 — a template still REPLACES (integrator ruling 2026-10-11; Agent parity), and
    // is now undoable: "Applied template “Swing” · Undo".
    if (historyKey) {
      try { recordIndicatorChange(historyKey, settings, next, { userId: historyUserId, label: `Applied template “${t?.name || 'Untitled'}”`, kind: 'template' }) } catch { /* never blocks */ }
    }
    onChange?.(next)
    setTplMenuOpen(false)
  }
  const deleteTemplate = (id) => persistTemplates(chartTemplatesAfterDelete(templates, id))

  // "Apply to all charts": null → the button; 'confirm' → the inline confirm; { done: n } → "Applied to n charts".
  const [applyAll, setApplyAll] = useState(null)
  const applyAllTimerRef = useRef(null)
  const applyAllBtnRef = useRef(null)
  const applyAllConfirmRef = useRef(null)
  const applyAllPrevRef = useRef(null)
  useEffect(() => () => { if (applyAllTimerRef.current) clearTimeout(applyAllTimerRef.current) }, [])
  // Keyboard: the confirm takes focus when it opens; Cancel / Apply hands it back to the button it replaced.
  useEffect(() => {
    const prev = applyAllPrevRef.current
    applyAllPrevRef.current = applyAll
    if (applyAll === 'confirm') applyAllConfirmRef.current?.focus()
    else if (prev === 'confirm') applyAllBtnRef.current?.focus()
  }, [applyAll])
  useEffect(() => { if (!open) { setPos(null); setConfirmReset(false); setConfirmSectionReset(null); setTplMenuOpen(false); setSavingTpl(false); setTplName(''); setThemesOpen(false); setApplyAll(null) } }, [open]) // re-center + reset transient UI on each open

  // Restore all chart settings to defaults. Two-click confirm (button shows
  // "Confirm?" for a moment) so an accidental tap can't wipe custom colors.
  const handleReset = () => {
    if (confirmReset) {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      setConfirmReset(false)
      // ⭐ A1.3 (D5): the LOOK resets; indicators, moving averages, pane order and sizes,
      // volume overlays and header info values are kept — and the reset is undoable.
      const next = keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), settings)
      if (historyKey) {
        try { recordIndicatorChange(historyKey, settings, next, { userId: historyUserId, label: 'Chart appearance reset', kind: 'reset' }) } catch { /* never blocks */ }
      }
      onChange?.(next)
    } else {
      setConfirmReset(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => setConfirmReset(false), 2600)
    }
  }

  // "Reset this section": the open tab's own keys go back to CHART_DEFAULTS; everything else on the chart
  // (other sections, indicators, the timeframe favourites kept in `header`) is untouched. Two clicks, like
  // Restore defaults, and undoable through the same history.
  const handleSectionReset = (tab) => {
    const keys = SECTION_RESET_KEYS[tab]
    if (!keys) return
    if (confirmSectionReset !== tab) {
      setConfirmSectionReset(tab)
      if (sectionResetTimerRef.current) clearTimeout(sectionResetTimerRef.current)
      sectionResetTimerRef.current = setTimeout(() => setConfirmSectionReset(null), 2600)
      return
    }
    if (sectionResetTimerRef.current) clearTimeout(sectionResetTimerRef.current)
    setConfirmSectionReset(null)
    const D = JSON.parse(JSON.stringify(CHART_DEFAULTS))
    const next = { ...settings, preset: 'custom' }
    for (const k of keys) { if (k in D) next[k] = D[k]; else delete next[k] }
    if (tab === 'header') {
      // the timeframe favourites live in `header` but belong to the timeframe menu
      const h = settings?.header || {}
      next.header = { ...D.header, ...(h.timeframes ? { timeframes: h.timeframes } : {}), ...(h.customTimeframes ? { customTimeframes: h.customTimeframes } : {}) }
    }
    if (tab === 'canvas' && settings?.crosshair?.magnet != null) {
      // the magnet is the price scale's right-click setting, not this tab's
      next.crosshair = { ...next.crosshair, magnet: settings.crosshair.magnet }
    }
    // the indicator-owned keys (incl. header.infoValues) stay exactly as they are — the same rule as Restore defaults
    const out = keepIndicatorState(next, settings)
    if (historyKey) {
      try { recordIndicatorChange(historyKey, settings, out, { userId: historyUserId, label: `${TAB_LABEL[tab]} reset`, kind: 'reset' }) } catch { /* never blocks */ }
    }
    onChange?.(out)
  }

  // Drag the modal by its header (like a floating tool window). Stays open while
  // dragging; clicking the ✕ or outside still closes it.
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest?.('[data-modal-close]')) return
    const panel = panelRef.current
    const r = panel?.getBoundingClientRect(); if (!r) return
    e.preventDefault()
    // Pin the panel to fixed positioning up front so we can move it by DIRECT DOM
    // (no re-render) during the drag. Matches the `pos` style applied on commit.
    panel.style.position = 'fixed'; panel.style.margin = '0'; panel.style.animation = 'none'
    panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height }
    let raf = 0, last = null, committed = null
    const flush = () => {
      raf = 0; const d = dragRef.current; if (!d || !last) return
      const nx = Math.max(8, Math.min(window.innerWidth - d.w - 8, d.ox + (last.clientX - d.sx)))
      const ny = Math.max(8, Math.min(window.innerHeight - d.h - 8, d.oy + (last.clientY - d.sy)))
      committed = { left: nx, top: ny }
      // Move by direct style — do NOT setState per frame. Re-rendering this large
      // modal every frame, stacked on the dark-pool overlay's rAF loop and a live
      // Scanner, was enough cumulative main-thread load to hang/crash the tab.
      panel.style.left = `${nx}px`; panel.style.top = `${ny}px`
      last = null
    }
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (committed) setPos(committed)   // commit the final position to React state ONCE
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!open) return
    // An Escape a field inside the modal already handled (a template name input's
    // "cancel naming", which calls preventDefault) is not a request to close Chart
    // Settings — see ChartSettingsModal.escape.test.jsx.
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (activeTarget) setActiveTarget(null); else onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, activeTarget])

  useEffect(() => { if (!open) setActiveTarget(null) }, [open])

  // ⛔⛔ A MODAL THAT DOES NOT TAKE FOCUS IS NOT A MODAL. This portal said
  // `aria-modal="true"` and did none of what that promises: opening it left focus
  // on <main> behind it, Tab walked out into the page it covers, the page stayed
  // in the accessibility tree, and Escape dropped focus on <body> (WebKit +
  // axe, iPhone/iPad, 2026-10-27). The four parts below use the repo's own
  // primitives, the ones `Sheet` runs -- never a second copy of them.
  //
  // 1. The opener, captured at RENDER, before this commit moves focus anywhere.
  //    The host's own record of the opener wins: WebKit does not focus a button
  //    on click, so there `activeElement` is still whatever sat behind the gear.
  const openerAtOpen = useMemo(
    () => (open && typeof document !== 'undefined'
      ? (returnFocusRef?.current?.isConnected ? returnFocusRef.current : document.activeElement)
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  )
  // 2. The page behind is `inert` (backgroundInert.js). ⛔ DECLARED BEFORE the
  //    focus effect: cleanups run in declaration order, and an inert opener
  //    cannot take focus back. Layers this modal opens later (colour panel,
  //    field picker, theme gallery) mount after the snapshot and stay live.
  useEffect(() => {
    if (!open) return undefined
    const el = dialogRef.current
    if (!el) return undefined
    const z = parseInt(typeof getComputedStyle === 'function' ? getComputedStyle(el).zIndex : '', 10)
    return inertBackground(el, Number.isFinite(z) ? z : MODAL_Z)
  }, [open])
  // 3. Focus goes IN on open (unless a child already took it) and BACK to the
  //    opener on close -- Escape, ✕, a backdrop click, all one path.
  useEffect(() => {
    if (!open) return undefined
    const el = dialogRef.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      const back = openerAtOpen
      if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') {
        back.focus({ preventScroll: true })
      }
    }
  }, [open, openerAtOpen])
  // 4. Tab wraps inside (useFocusTrap -- the ONE trap). It stands down while a
  //    layer this modal opened is up: those are portaled OUTSIDE the dialog, and
  //    a trap that pulled focus back would make them unreachable by keyboard.
  const trapWhileNoPopout = useCallback(() => (
    typeof document === 'undefined'
    || !document.querySelector('[data-color-panel],[data-uct-theme-gallery],[data-chart-settings-popout]')
  ), [])
  useFocusTrap(!!open, dialogRef, trapWhileNoPopout)

  // Location-aware right-click targets → which settings tab to open on. 'candles',
  // 'canvas', 'ma' are tab-tops (no scroll — fresh DOM opens at scrollTop 0);
  // 'watermark'/'axis' are deeper Canvas sections that get scrolled in below. Both
  // effects are LAYOUT effects so the tab + scroll land BEFORE paint (no flash).
  const didScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (!open) { didScrollRef.current = false; return }
    setActiveTab(indTargetRow(scrollTo) ? 'indicators' : (SETTINGS_TARGET_TAB[scrollTo] || 'price'))
  }, [open, scrollTo])
  useLayoutEffect(() => {
    if (!open || didScrollRef.current) return
    const tab = SETTINGS_TARGET_TAB[scrollTo]
    if (!tab || activeTab !== tab) return
    const ref = scrollTo === 'watermark' ? watermarkRef : scrollTo === 'axis' ? axisRef : scrollTo === 'volume' ? volumeRef : null
    if (ref) { try { ref.current?.scrollIntoView({ block: 'start', behavior: 'auto' }) } catch { /* noop */ } }
    didScrollRef.current = true
  }, [open, scrollTo, activeTab])
  useEffect(() => { setActiveTarget(null); setConfirmSectionReset(null) }, [activeTab])

  // Position the pop-out color panel to the RIGHT of the modal (flip left if tight).
  useLayoutEffect(() => {
    if (!open || !activeTarget || !panelRef.current) { setPanelPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    // Align the color panel's BOTTOM edge with the settings modal's bottom edge.
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setPanelPos({ left, bottom })
  }, [activeTarget, open, pos])

  // Close the color panel on an outside click (not a swatch, not inside the panel).
  useEffect(() => {
    if (!activeTarget) return
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]') || e.target.closest?.('[data-color-panel]')) return
      // the panel's line dropdowns (ChoiceMenu) portal their list to <body>
      if (e.target.closest?.('[data-choice-menu]')) return
      setActiveTarget(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [activeTarget])

  if (!open) return null

  const curType = settings?.chartType || 'candles'
  const setType = (val) => {
    if (val === curType) return
    onChange?.({ ...settings, chartType: val, preset: 'custom' })
  }

  const curColorMode = settings?.candleColorMode || 'netchange'
  const setColorMode = (val) => {
    if (val === curColorMode) return
    onChange?.({ ...settings, candleColorMode: val, preset: 'custom' })
  }
  const showColorMode = true

  // Candle colors. Candles/Hollow expose Body / Borders / Wick separately; bars &
  // line/area just use the body (up/down) color. 'onecolor' mode = a single color.
  const candles = settings?.candles || {}
  const grid = settings?.grid || {}
  const crosshair = settings?.crosshair || {}
  // Three-way crosshair state (always / hold / off) — DERIVED through the resolver,
  // never read off a field, so a blob predating `mode` (which carries only the
  // legacy `crosshair.enabled` boolean) resolves consistently. Mirrors legendMode.
  const crosshairMode = crosshairModeOf(settings)
  const watermark = settings?.watermark || {}
  const isCandleType = curType === 'candles' || curType === 'hollow'
  const bgMode = settings?.bgMode || 'solid'

  // A color "target" → the nested settings path it writes. Covers candles + canvas.
  const COLOR_PATHS = {
    bodyUp: ['candles', 'upColor'], bodyDown: ['candles', 'downColor'],
    borderUp: ['candles', 'upBorder'], borderDown: ['candles', 'downBorder'],
    wickUp: ['candles', 'upWick'], wickDown: ['candles', 'downWick'],
    one: ['candles', 'oneColor'],
    bg: ['background'], bgTop: ['bgGradient', 'top'], bgBottom: ['bgGradient', 'bottom'],
    grid: ['grid', 'color'], crosshair: ['crosshair', 'color'], text: ['textColor'],
    // Per-item header/legend colors (Header tab → Show). Day change is a pair.
    hdrDayUp: ['header', 'colors', 'dayChangeUp'],
    hdrDayDown: ['header', 'colors', 'dayChangeDown'],
    hdrTitle: ['header', 'colors', 'title'],
    hdrMarketCap: ['header', 'colors', 'marketCap'],
    hdrNextEarnings: ['header', 'colors', 'nextEarnings'],
    hdrUctRating: ['header', 'colors', 'uctRating'],
    hdrLegend: ['header', 'colors', 'legend'],
    // Swing-label colors (Markers tab).
    swingColor: ['swingLabels', 'color'],
    swingUp: ['swingLabels', 'upColor'],
    swingDown: ['swingLabels', 'downColor'],
    swingBg: ['swingLabels', 'bg'],
    // Earnings beat/miss badge colors (also color the popover surprise rows).
    earnBeat: ['markers', 'earningsBeat'],
    earnMiss: ['markers', 'earningsMiss'],
    // Previous-day H/L/C line colors (Markers tab).
    pdlHighColor: ['prevDayLevels', 'high', 'color'],
    pdlLowColor: ['prevDayLevels', 'low', 'color'],
    pdlCloseColor: ['prevDayLevels', 'close', 'color'],
    // Dark-pool overlay bar + label colors (Indicators tab). 8-digit hex so the
    // color menu's opacity slider is stored inline; StockChart splits it.
    dpBarColor: ['darkPool', 'barColor'],
    dpLabelColor: ['darkPool', 'labelColor'],
  }
  const setColorTarget = (target, hex) => {
    // ⭐⭐ THE SIGNED-HISTOGRAM PAIR, THROUGH ITS OWN WRITER. `setInstanceCandleColor`
    // stores the colour ONLY when it differs from the chart's own — pick the
    // chart's green and the key is deleted, so the series goes back to following
    // every UCT Chart Theme. Provenance is ABSENCE, which is the convention this
    // codebase already had; nothing new is invented here.
    if (isSignTarget(target)) {
      const { rowId, which } = splitSignTarget(target)
      const next = setInstanceCandleColor(
        settings, rowId, which, hex, engineRegistry, undefined,
        (candles && candles[which]) || null,
      )
      if (next !== settings) onChange?.({ ...next, preset: 'custom' })
      return
    }
    if (isIndTarget(target)) {
      const { rowId, field } = splitIndTarget(target)
      const row = indRowById(rowId)
      if (row) setRow(row, { [field]: hex })
      return
    }
    // Watermark keeps color + opacity as SEPARATE settings (the chart reads them
    // apart), so map the picker's 8-digit color → {color, opacity}.
    if (target === 'watermark') {
      const { rgb, a } = splitHexA(hex)
      onChange?.({ ...settings, watermark: { ...watermark, color: rgb, opacity: a }, preset: 'custom' })
      return
    }
    // Per-field Info Row colors: `hdrf:<colorKey>` → header.colors[colorKey].
    // Per-stat looks (owner 11-17): `hdrs:<statKey>:label|box` → header.statStyle[statKey].labelColor|boxColor —
    // the same keys the header stat's own menu writes (headerStatStyle.js).
    if (target.startsWith('hdrs:')) {
      const at = target.lastIndexOf(':')
      const key = target.slice(5, at)
      const field = target.slice(at + 1) === 'box' ? 'boxColor' : 'labelColor'
      const h = settings?.header || {}
      const prevBox = h.statStyle && h.statStyle[key] ? h.statStyle[key].boxColor : null
      const val = field === 'boxColor' ? pickedBoxColor(prevBox, hex) : hex
      onChange?.({ ...settings, header: { ...h, statStyle: withHeaderStatStyle(h, key, { [field]: val }) }, preset: 'custom' })
      return
    }
    if (target.startsWith('hdrf:')) {
      const key = target.slice(5)
      const h = settings?.header || {}
      onChange?.({ ...settings, header: { ...h, colors: { ...(h.colors || {}), [key]: hex } }, preset: 'custom' })
      return
    }
    const path = COLOR_PATHS[target]; if (!path) return
    const next = { ...settings }
    let o = next
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] || {}) }; o = o[path[i]] }
    o[path[path.length - 1]] = hex
    next.preset = 'custom'
    onChange?.(next)
  }
  // Hand-written rows (MA overlays + the volume pane, which the engine cannot own)
  // followed by the rows GENERATED from the engine definitions. Neither this file
  // nor the registry names an engine indicator's fields.
  //
  // ⚠️ `volumePaneFixed` STILL HAS TO REACH THE VOLUME ROW. It used to be passed
  // to `listIndicators` here; `listAllIndicators` forwards the same options object
  // to it, so master's inert-toggle reason (`f3d9daba`) survives B4's switch to
  // generated rows.
  //
  // 🔴 …AND THE ROWS NOW INCLUDE THE MEMBER'S OWN FORMULAS. `listEngineIndicators`
  // reads `registry.listDefinitions()`, which is SHIPPED-ONLY by design (three
  // rails read it to prove what ships, and a member's formula must never be able
  // to make the shipped manifest true by joining it — see `nativeRegistry`'s
  // split). The consequence on this surface was that a formula a member wrote,
  // saved, installed and DREW on their chart had no settings row anywhere: they
  // could turn it on from the library and then never change its colour.
  //
  // ⛔ SO THE WIDENING IS A SHIM AT THE CALL SITE, NOT A CHANGE TO THE SPLIT.
  // `listAllDefinitions()` is the registry's own union of both lanes; handing it
  // in as `listDefinitions` widens THIS list and nothing else. Every write still
  // goes through `applyRowPatch(…, engineRegistry)`, whose `getDefinition`
  // already resolves both lanes.
  //
  // ⚠️ NOT MEMOISED, AND THAT IS NOT AN OVERSIGHT: this code runs BELOW
  // `if (!open) return null`, so a hook here would be a conditional hook — and
  // there is nothing to save, because `listAllIndicators` already walks the
  // registry on every render of an open modal. What makes the list ARRIVE is the
  // `useInstalledUserDefinitions` subscription up top, not a memo key down here.
  const allLanes = { ...engineRegistry, listDefinitions: engineRegistry.listAllDefinitions }
  // `volumePaneByDefault` (/charts): the Volume row's Separate pane toggle shows the
  // member's Display in choice, defaulting ON — see `listIndicators`.
  const indRows = listAllIndicators(settings, allLanes, { volumePaneFixed, volumePaneByDefault: volumeOpts?.volumePaneByDefault === true })
  const indRowById = (id) => indRows.find((r) => r.id === id)
  /** One writer for every row: `patchFor` for the hand-written ones, and
   *  `instanceControls` for the engine-owned ones — the same writer the toolbar
   *  checkbox, both right-click doors and the four keyboard shortcuts share. A
   *  refused write returns the settings unchanged by identity, so nothing persists. */
  const setRow = (row, patch) => {
    const next = applyRowPatch(row, patch, settings, engineRegistry)
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }

  const targetValue = (t) => {
    // The swatch's own preview: what this half is EFFECTIVELY wearing right now —
    // the member's stored choice, else the chart's candle colour, which is what
    // `resolveSignColors` will hand the renderer for an instance storing nothing.
    if (isSignTarget(t)) {
      const { rowId, which } = splitSignTarget(t)
      const inst = findInstance(settings, rowId)
      const pres = (inst && inst.presentation) || null
      return (pres && pres[which])
        || (candles && candles[which])
        || (which === 'upColor' ? SIGN_POS : SIGN_NEG)
    }
    // Registry-driven indicator fields carry their path in the target string, so the
    // switch below never needs a case per indicator.
    if (isIndTarget(t)) {
      const { rowId, field } = splitIndTarget(t)
      return indRowById(rowId)?.values?.[field] || '#c9a84c'
    }
    if (t.startsWith('hdrs:')) {
      const at = t.lastIndexOf(':')
      const look = statStylesFor(settings?.header || {})[t.slice(5, at)] || {}
      return t.slice(at + 1) === 'box' ? (look.boxColor || DEFAULT_BOX_COLOR) : (look.labelColor || '#cfcac0')
    }
    if (t.startsWith('hdrf:')) {
      const key = t.slice(5)
      const ov = settings?.header?.colors?.[key]
      if (ov) return ov
      // Signed field halves (`<colorKey>:pos` / `:neg`) default to green / red.
      if (key.endsWith(':pos')) return SIGN_POS
      if (key.endsWith(':neg')) return SIGN_NEG
      const hf = HEADER_FIELDS.find((x) => x.colorKey === key)
      return (hf && hf.dflt) || '#9b9684'   // neutral placeholder for auto/sign-tinted fields
    }
    switch (t) {
      case 'bodyUp': return candles.upColor || '#1ae51a'
      case 'bodyDown': return candles.downColor || '#c41f2d'
      case 'borderUp': return candles.upBorder || candles.upColor || '#1ae51a'
      case 'borderDown': return candles.downBorder || candles.downColor || '#c41f2d'
      case 'wickUp': return candles.upWick || candles.upColor || '#1ae51a'
      case 'wickDown': return candles.downWick || candles.downColor || '#c41f2d'
      case 'one': return candles.oneColor || candles.upColor || '#1ae51a'
      case 'bg': return settings.background || '#0e0f0d'
      case 'bgTop': return settings.bgGradient?.top || '#16233b'
      case 'bgBottom': return settings.bgGradient?.bottom || '#0e0f0d'
      case 'grid': return grid.color || 'rgba(46,49,39,0.25)'
      case 'crosshair': return crosshair.color || '#706b5e'
      case 'text': return settings.textColor || '#706b5e'
      case 'watermark': return joinHexA(watermark.color || '#a8a290', (watermark.opacity == null || watermark.opacity === 0.07) ? 0.82 : watermark.opacity)
      // Header/legend colors: the stored value, else the item's built-in default so
      // the swatch reads as the current on-screen color before the user changes it.
      // Title / day change: the header's own authority (white; the chart's candle up / down colours — owner 11-16).
      case 'hdrDayUp': return headerColors(settings).dayChangeUp
      case 'hdrDayDown': return headerColors(settings).dayChangeDown
      case 'hdrTitle': return headerColors(settings).title
      case 'hdrMarketCap': return hdrColors.marketCap || '#c9a84c'
      case 'hdrNextEarnings': return hdrColors.nextEarnings || '#6ba3be'
      case 'hdrUctRating': return hdrColors.uctRating || '#1ae51a'  // price-candle up-green
      case 'hdrLegend': return hdrColors.legend || '#a8a290'
      case 'swingColor': return swing.color || '#d4d0c4'
      case 'swingUp': return swing.upColor || '#4ade80'
      case 'swingDown': return swing.downColor || '#f87171'
      // Unset background halo matches the canvas, so show that as the swatch default.
      case 'swingBg': return swing.bg || settings.background || '#0e0f0d'
      case 'earnBeat': return evtMarkers.earningsBeat || '#1ae51a'
      case 'earnMiss': return evtMarkers.earningsMiss || '#c41f2d'
      case 'pdlHighColor': return settings.prevDayLevels?.high?.color || '#3cb868'
      case 'pdlLowColor': return settings.prevDayLevels?.low?.color || '#e74c3c'
      case 'pdlCloseColor': return settings.prevDayLevels?.close?.color || '#9aa0a6'
      case 'dpBarColor': return settings.darkPool?.barColor || '#c9a84ccc'
      case 'dpLabelColor': return settings.darkPool?.labelColor || '#c9a84c'
      default: return '#1ae51a'
    }
  }
  const setSetting = (patch) => onChange?.({ ...settings, ...patch, preset: 'custom' })
  const setBgMode = (m) => { if (m !== bgMode) setSetting({ bgMode: m }) }
  // ── The seven rows that were "Soon" (owner 11-15), now real. One reader each (chartViewOptions.js): an
  // absent key reads as today's look, so the dialog shows exactly what the chart draws. ──
  const parts = candlePartsOf(settings)
  const setPart = (key, on) => setSetting({ candles: { ...candles, [key]: on } })
  const priceLine = priceLineOf(settings, !PANE_LOOK.hidePriceLine)
  const gridLines = gridLinesOf(settings)
  const rightMargin = rightMarginOf(settings)
  const priceDecimals = priceDecimalsOf(settings)
  const timeFormat = timeFormatOf(settings)
  const timeZone = timeZoneOf(settings)
  const extendedHours = extendedHoursOf(settings)
  const setScaleTime = (field, value) => setSetting(scaleTimePatch(settings, field, value))
  // A live on/off: the shared Switch primitive (never a new hand-rolled `role="switch"` copy).
  const liveSwitch = (label, on, onToggle) => (
    <Switch aria-label={label} checked={on} className={styles.toggle} checkedClassName={styles.toggleOn}
      knobClassName={styles.toggleKnob} onClick={onToggle} />
  )
  const setWmVisible = (v) => setSetting({ watermark: { ...watermark, visible: v } })
  const setWmLine = (key, v) => setSetting({ watermark: { ...watermark, lines: { ...(watermark.lines || {}), [key]: v } } })
  const setWmAlign = (v) => setSetting({ watermark: { ...watermark, align: v } })
  const setWmSize = (v) => setSetting({ watermark: { ...watermark, sizeScale: v } })
  const setWmBoxW = (v) => setSetting({ watermark: { ...watermark, boxW: v } })
  const setWmWeight = (v) => setSetting({ watermark: { ...watermark, weight: v } })
  const wmLines = watermark.lines || {}
  const wmSize = watermark.sizeScale ?? 1.0
  const wmWeight = watermark.weight ?? 700
  const wmBoxW = watermark.boxW ?? DEFAULT_BOX_W
  // Watermark size scale options (× the base per-role font). Shown as percent.
  // Header tab.
  const header = settings?.header || {}
  const setHeader = (patch) => setSetting({ header: { ...header, ...patch } })
  // Through the resolver, never off `header.legendMode` — a user whose blob
  // predates the mode carries only the legacy `showLegend`, and reading the field
  // directly would show them "Always" while their chart draws nothing.
  const legendMode = legendModeOf(settings)
  // ⭐ THE BAR-INFO FIELD SET, THROUGH THE RESOLVER — same discipline as the
  // mode above. A member who has never touched this carries no `header.barInfo`
  // at all, and reading the field directly would show them seven unchecked boxes
  // for a strip that is printing all seven.
  const barInfo = barInfoFieldsOf(settings)
  // ⛔ ONE WRITER, AND IT ALWAYS STORES THE COMPLETE EXPLICIT SET (never a
  // patch, never an "unset" that means the default). `withBarInfoField` returns
  // the canonical order, so the strip cannot be re-ordered by a click here.
  const toggleBarField = (id) => setHeader({ barInfo: withBarInfoField(settings, id, !barInfo.includes(id)) })
  // Info Row — the picked fields (migrates a legacy show* blob); the picker menu state
  // lives up top with the other hooks (this code runs after the `!open` early return).
  // (owner 11-16) any library stat (headerStatCatalog.js), in the member's order, each with an optional short rename.
  const infoFields = headerStatKeys(header)
  const statLabels = statLabelsOf(header)
  const toggleInfoField = (key) => setHeader(headerStatTogglePatch(header, key))
  // Custom stats (owner 11-16, headerCustomStats.js): each one's live name / sign from its definition (the stored
  // name when the definition is not installed), so the list, the picker and the swatches name it like the chart does.
  const customMeta = {}
  for (const c of customStatsOf(header)) {
    const def = engineRegistry.getDefinition(c.defId)
    if (!def) continue
    let names = null
    try { names = customStatLabel(def, c) } catch { names = null }
    const why = customStatOutputRefusal(def, c.plotKey, engineRegistry)
    customMeta[customStatKey(c.id)] = {
      label: (names && names.label) || c.name, signed: customStatSigned(def),
      desc: why ? `Custom stat · ${why}` : `Custom stat · ${(names && names.title) || c.name || 'an indicator'}, its value on the newest bar`,
    }
  }
  const infoStatMeta = (key) => headerStatMetaOf(header, key, customMeta)
  const statLooks = statStylesFor(header)
  const addCustomInfoField = (entry) => {
    const patch = addCustomStatPatch(header, entry, infoFields)
    if (patch.customStats) setHeader(patch)
  }
  const customInfoRefusal = (entry) => customStatAddRefusal(header, entry)
  const moveInfoField = (from, to) => setHeader({ fields: movedHeaderStats(header, from, to) })
  const renameInfoField = (key, label) => {
    const next = withStatLabel(header, key, label)
    if (JSON.stringify(next) === JSON.stringify(statLabels)) return   // a blur with no change writes nothing
    setHeader({ statLabels: next })
  }
  // "Reset to UCT default" in the picker: the stats go back to today's row (no `fields`, no renames).
  const resetInfoFields = () => {
    const { fields: _f, statLabels: _l, customStats: _c, statStyle: _s, ...rest } = header
    if (!('fields' in header) && !('statLabels' in header) && !('customStats' in header) && !('statStyle' in header)) return
    // a custom stat's color goes with it (its id can be reused by the next custom stat)
    if (rest.colors && Object.keys(rest.colors).some((k) => k.startsWith('cx:'))) {
      rest.colors = Object.fromEntries(Object.entries(rest.colors).filter(([k]) => !k.startsWith('cx:')))
    }
    setSetting({ header: rest })
  }
  const hdrColors = header.colors || {}
  // Markers tab.
  const swing = settings?.swingLabels || {}
  const setSwing = (patch) => setSetting({ swingLabels: { ...swing, ...patch } })
  const evtMarkers = settings?.markers || {}
  const setMarker = (key, v) => setSetting({ markers: { ...evtMarkers, [key]: v } })
  // Previous-day H/L/C reference lines (Markers tab).
  const pdl = settings?.prevDayLevels || {}
  const setPrevDay = (key, patch) => setSetting({ prevDayLevels: { ...pdl, [key]: { ...(pdl[key] || {}), ...patch } } })
  const PDL_COLOR_TARGET = { high: 'pdlHighColor', low: 'pdlLowColor', close: 'pdlCloseColor' }
  // 'desk' = Desk-mention markers (spec 2026-08-11 §C). Opt-in like News: it carries
  // no default in CHART_DEFAULTS.markers, so an unset blob reads undefined → OFF.
  const curTextSize = settings.textSize ?? 11
  const colorSwatch = (target, label, bg) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.cSwatch} ${activeTarget?.target === target ? styles.cSwatchActive : ''}`}
      style={{ background: bg || targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  // A "Show X" row: color swatch(es) (only while on) + an on/off switch. Shared by the
  // Title's Day-change row and the Chart-legend row.
  const renderShowRow = (key, label, swatches = []) => {
    const on = header[key] !== false
    return (
      <div className={styles.field} key={key}>
        <span className={styles.fieldLabel}>{label}</span>
        <div className={styles.hdrRowCtl}>
          {on && swatches.map(([target, pickerLabel]) => (
            <span key={target}>{colorSwatch(target, pickerLabel)}</span>
          ))}
          <button aria-label={label}
            type="button" role="switch" aria-checked={on}
            className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
            onClick={() => setHeader({ [key]: header[key] === false })}
          ><span className={styles.toggleKnob} /></button>
        </div>
      </div>
    )
  }

  // ── "Apply to all charts" (owner 11-16, was Soon) ─────────────────────────────────────────────
  // One click asks, inline (never window.confirm): "Apply these settings to N other charts in this layout?" → Apply /
  // Cancel. Apply hands the copy to the workspace (one layout write, saved like any manual change) and says
  // "Applied to N charts" for a moment. With no other chart in the layout the button is disabled and says why.
  const otherCharts = applyToAllCharts && typeof applyToAllCharts.count === 'function' ? applyToAllCharts.count() : null
  const chartsWord = (n) => `${n} ${n === 1 ? 'chart' : 'charts'}`
  const confirmApplyAll = () => {
    if (applyAllTimerRef.current) clearTimeout(applyAllTimerRef.current)
    let n = 0
    try { n = Number(applyToAllCharts?.apply?.()) || 0 } catch { n = 0 }
    setApplyAll({ done: n })
    applyAllTimerRef.current = setTimeout(() => setApplyAll(null), 2600)
  }
  const applyAllHintId = `${soonDescId}-applyall`

  // ── "Soon" rows (owner 11-15, the approved Chart Settings Lab) ──────────────────────────────
  // Settings the owner approved that the chart cannot do yet, shown VISIBLE BUT DISABLED with a
  // small "Soon" tag so the window matches the lab. ⛔ They write NOTHING: no handler, no settings
  // key, no `data-guide` (so UCT Agent's control registry never sees them), no entry in
  // SECTION_RESET_KEYS. ⛔ No `role="switch"` either: the soft square is a plain disabled button,
  // so the whole-row click (which clicks a row's live switch) has nothing to flip, and the
  // hand-rolled-switch ratchet (formControls.census) does not grow. Swatches are inert spans, never
  // `data-color-swatch` buttons, so they cannot open the colour panel.
  const SOON = 'Coming soon'
  const soonTag = <span className={styles.soonTag}>Soon</span>
  const soonAttrs = (label) => ({
    disabled: true, 'aria-disabled': 'true', 'aria-label': `${label} (coming soon)`,
    title: SOON, 'aria-describedby': soonDescId,
  })
  const soonToggle = (label, on) => (
    <button type="button" {...soonAttrs(label)} data-soon-control=""
      className={`${styles.toggle} ${on ? styles.toggleOn : ''} ${styles.soonCtl}`}
    ><span className={styles.toggleKnob} /></button>
  )
  const soonSwatch = (bg, label) => (
    <span key={label} className={`${styles.cSwatch} ${styles.soonSwatch}`} style={{ background: bg }} title={`${label} · ${SOON}`} aria-hidden="true" />
  )
  const soonLabel = (label, hint) => (
    <span className={styles.fieldLabel}>{label}{soonTag}{hint && <span className={styles.fieldHint}>{hint}</span>}</span>
  )
  // A whole Soon row. `toggle` = [label, on] for an on/off soft square; `right` = other controls.
  const soonRow = (label, { hint, toggle, right } = {}) => (
    <div className={`${styles.field} ${styles.soonRow}`} data-soon="" title={SOON} key={label}>
      {soonLabel(label, hint)}
      {toggle && !right ? soonToggle(toggle[0], toggle[1]) : (
        <div className={styles.hdrRowCtl}>{right}{toggle && soonToggle(toggle[0], toggle[1])}</div>
      )}
    </div>
  )

  return (
    <>
      {/* ⭐ THE FORMULA SUBSCRIPTION, MOUNTED BY THE OPEN BRANCH AND ONLY BY IT.
          Below `if (!open) return null`, so a closed modal renders it not at all
          and runs none of its hooks — see the `userDefs` block for the two things
          that cost when these were called in this component's own body.
          ⚠️ OUTSIDE THE PORTAL AND OUTSIDE THE TAB SWITCH, deliberately: `indRows`
          is read by the colour panel and the row writers too, not only by the
          Indicators tab, so the feed must not be gated on which tab is active. */}
      <UserFormulaFeed onLoaded={onUserDefsLoaded} />
      {createPortal(
        <div ref={dialogRef} tabIndex={-1} className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Chart settings">
      <div
        /* ⚰️⚰️⚰️ THREE TIMES, AND THE THIRD IS THE LAST. Chart Data widened
           this modal to 880 for a two-column pane map and was reverted; the
           Inspector took 720 for the same shape and kept it, scoped to its own
           tab with a transition to soften the step. The owner then USED it and
           ruled the step out: *"Chart Settings is ONE window. Its desktop shell
           should have ONE stable width."*
           ⭐ SO THE WIDTH IS THE PANEL'S, UNCONDITIONALLY. No modifier, no
           per-tab class, nothing here to keep in step with the tab strip.
           ⚰️ AND THE CONTENT CAP THAT USED TO SIT BESIDE IT IS GONE TOO. The four
           older tabs were held at their original 560px column inside the wider
           shell, which left them ending 160px short of their own window; they
           use the shell's width now. `.body` carries no cap and no per-tab
           class — one shell, one content width, every tab. */
        className={styles.panel}
        data-guide="chartSettings"
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...(themeVars || {}), ...(pos ? { position: 'fixed', left: pos.left, top: pos.top, margin: 0, animation: 'none' } : {}) }}
      >
        {/* ⭐ S2 · sidebar sections (owner 11-15): the five tabs are a left rail with grey icons,
            the open one brighter with a thin light bar; templates, themes and Restore defaults sit
            at the rail's foot. Every tab, template action and handler is the same as before. */}
        <div className={styles.shell}>
        <span id={soonDescId} hidden>{SOON}</span>
        <aside className={styles.side}>
          <div className={styles.header} onPointerDown={startDrag} style={{ cursor: 'move' }}>
            <span className={styles.title}>{title}</span>
          </div>
          <div className={styles.tabs} role="tablist" aria-orientation="vertical">
          {SETTINGS_TABS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              data-guide={`chartSettings.tab.${id}`}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(id)}
            ><UIcon name={icon} size={14} gold={false} aria-hidden="true" /><span>{label}</span></button>
          ))}
        </div>

          <div className={styles.sideFoot} onPointerDown={e => e.stopPropagation()}>
          {/* Apply to all charts (owner 11-16, was Soon): this chart's look → every other chart in this layout.
              Absent off the Charts workspace (no door). Confirm and result are inline, in the rail's foot. */}
          {otherCharts != null && (
            <div className={styles.applyAll} data-apply-all="">
              {applyAll === 'confirm' ? (
                <div className={styles.applyAllConfirm} role="group" aria-label="Apply to all charts">
                  <span className={styles.applyAllText}>{`Apply these settings to ${otherCharts} other ${otherCharts === 1 ? 'chart' : 'charts'} in this layout?`}</span>
                  <div className={styles.applyAllBtns}>
                    <button type="button" ref={applyAllConfirmRef} className={styles.applyAllYes} onClick={confirmApplyAll}>Apply</button>
                    <button type="button" className={styles.applyAllNo} onClick={() => setApplyAll(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  ref={applyAllBtnRef}
                  data-guide="chartSettings.applyAll"
                  className={styles.tplBtn}
                  disabled={otherCharts < 1}
                  aria-describedby={otherCharts < 1 ? applyAllHintId : undefined}
                  title={otherCharts < 1 ? 'There are no other charts in this layout' : 'Copy this chart’s look to every other chart in this layout. Symbols, timeframes, indicators and drawings stay as they are.'}
                  onClick={() => { if (applyAllTimerRef.current) clearTimeout(applyAllTimerRef.current); setApplyAll('confirm') }}
                ><UIcon name="copy" size={14} gold={false} aria-hidden="true" /><span>Apply to all charts</span></button>
              )}
              {otherCharts < 1 && applyAll !== 'confirm' && (
                <span id={applyAllHintId} className={styles.applyAllHint}>No other charts in this layout</span>
              )}
              {applyAll && typeof applyAll === 'object' && (
                <span className={styles.applyAllDone} role="status">{`Applied to ${chartsWord(applyAll.done)}`}</span>
              )}
            </div>
          )}
          <div className={styles.tplMenuWrap}>
            <button
              data-guide="chartSettings.templates"
              type="button"
              className={styles.tplBtn}
              onClick={() => setTplMenuOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={tplMenuOpen}
              title="Open a saved chart-settings template"
            ><UIcon name="library" size={14} gold={false} aria-hidden="true" /><span>Chart templates{templates.length ? ` (${templates.length})` : ''}</span></button>
            {tplMenuOpen && (
              <div className={styles.tplMenu} role="listbox">
                {templates.length === 0 && (
                  <div className={styles.tplEmpty}>No chart templates yet. Set up a chart, then “Save as chart template”.</div>
                )}
                {templates.map(t => (
                  <div key={t.id} className={styles.tplRow}>
                    <button
                      type="button"
                      className={styles.tplApply}
                      onClick={() => applyTemplate(t)}
                      title={`Apply “${t.name}” to this chart`}
                    >{t.name}</button>
                    <button
                      type="button"
                      className={styles.tplDelete}
                      onClick={() => deleteTemplate(t.id)}
                      aria-label={`Delete template ${t.name}`}
                      title="Delete template"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {savingTpl ? (
            <div className={styles.tplSaveRow}>
              <input aria-label="Template name"
                ref={tplInputRef}
                className={styles.tplInput}
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitSaveTemplate() }
                  else if (e.key === 'Escape') { e.preventDefault(); setSavingTpl(false); setTplName('') }
                }}
                placeholder="Template name"
                maxLength={40}
              />
              <button type="button" className={styles.tplSaveBtn} onClick={commitSaveTemplate}>Save</button>
              <button type="button" className={styles.tplCancelBtn} onClick={() => { setSavingTpl(false); setTplName('') }}>Cancel</button>
            </div>
          ) : (
            <button
              data-guide="chartSettings.saveTemplate"
              type="button"
              className={styles.tplBtn}
              onClick={() => { setSavingTpl(true); setTplMenuOpen(false) }}
              title="Save the current chart settings as a reusable template"
            ><UIcon name="plus" size={14} gold={false} aria-hidden="true" /><span>Save as chart template</span></button>
          )}
          {/* Pushed to the far right of the template row; same visual style as the
              template buttons (not a special accent) per owner request. */}
          <button
            type="button"
            className={`${styles.tplBtn} ${styles.themesBarBtn}`}
            onClick={() => setThemesOpen(true)}
            data-guide="chartSettings.themes"
            title="Color themes: one-click color looks for this chart"
          ><UIcon name="sun" size={14} gold={false} aria-hidden="true" /><span>Color themes</span></button>
            <button
              type="button"
              data-guide="chartSettings.reset"
              className={`${styles.resetBtn}${confirmReset ? ' ' + styles.resetBtnConfirm : ''}`}
              onClick={handleReset}
              title="Resets chart appearance. Your indicators stay."
              style={{ cursor: 'pointer' }}
            ><UIcon name="refresh" size={14} gold={false} aria-hidden="true" /><span>{confirmReset ? 'Confirm?' : 'Restore defaults'}</span></button>
          </div>
        </aside>
        <div className={styles.main}>
          <div className={styles.mainHead} onPointerDown={startDrag}>
            <h3 className={styles.mainTitle}>{TAB_LABEL[activeTab]}</h3>
            {/* Reset this section (owner 11-15): a quiet icon right after the title. Indicators: not yet. */}
            {SECTION_RESET_KEYS[activeTab] && (
              <button
                type="button"
                data-guide="chartSettings.sectionReset"
                onPointerDown={e => e.stopPropagation()}
                className={`${styles.sectionReset} ${confirmSectionReset === activeTab ? styles.sectionResetConfirm : ''}`}
                onClick={() => handleSectionReset(activeTab)}
                aria-label={confirmSectionReset === activeTab ? `Confirm: reset ${TAB_LABEL[activeTab]} to UCT default` : `Reset ${TAB_LABEL[activeTab]} to UCT default`}
                title={confirmSectionReset === activeTab ? 'Click again to reset' : `Reset ${TAB_LABEL[activeTab]} to UCT default`}
              ><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4v3.5h3.5" /><path d="M3.6 9.5A5 5 0 1 0 4.4 5L3 7.5" /></svg>{confirmSectionReset === activeTab && <span>Reset?</span>}</button>
            )}
            <button onPointerDown={e => e.stopPropagation()} type="button" data-modal-close className={styles.close} onClick={onClose} aria-label="Close" style={{ cursor: 'pointer' }}>✕</button>
          </div>
        {/* ⭐ THE SHELL IS ONE WIDTH; THE CONTENT IS NOT OBLIGED TO FILL IT.
            Indicators IS the shell's width — the Inspector's two columns were
            designed to it. Price Style, Canvas, Header and Markers were laid out
            against a 560px body and still look deliberate at that measure, so
            they keep it and sit against the leading edge. Stretching four card
            groups across 720px would be a redesign of four tabs nobody asked
            for; a future project can unify them properly. */}
        {/* ⚠️⚠️ `.bodyFlush` IS A RESERVATION BEING GIVEN BACK, not a padding
            change. `.body` reserves a scrollbar gutter permanently — see its rule
            — because the four card tabs genuinely scroll here and a bar appearing
            mid-click would shift every control 10px left. INDICATORS DOES NOT
            SCROLL HERE: it is a `height: 100%` flex column that scrolls inside its
            own two halves, so the reserved 10.4px was measured as dead strip down
            the right of the discovery list with nothing able to occupy it.
            ⛔ THE 18px OF MODAL PADDING STAYS. That is the frame every tab, the
            title and the tab strip share, and this pass is about the gutter that
            has no frame to be. */}
        {/* Whole-row toggling (owner 11-15): a click anywhere on a row that carries an on/off
            switch flips it — the switch itself, a swatch, a menu or any other control keep
            their own clicks. */}
        <div className={`${styles.body} ${activeTab === 'indicators' ? styles.bodyFlush : ''}`}
          onClick={(e) => {
            if (activeTab === 'indicators') return
            const row = e.target.closest?.(`.${styles.field}`)
            if (!row || row.hasAttribute('data-soon') || e.target.closest('button, input, select, a, [role="switch"], [role="option"]')) return
            row.querySelector('[role="switch"]:not([disabled]):not([aria-disabled="true"])')?.click()
          }}>
          {activeTab === 'canvas' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Background</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Style</span>
                <ChoiceMenu ariaLabel="Background" value={bgMode} onChange={setBgMode}
                  options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} />
              </div>
              {bgMode === 'solid' ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color</span>
                  {colorSwatch('bg', 'Background')}
                </div>
              ) : (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Top</span>
                  {colorSwatch('bgTop', 'Gradient Top')}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Bottom</span>
                  {colorSwatch('bgBottom', 'Gradient Bottom')}
                </div>
              </>)}
              {/* Shade pre / post-market (owner 11-16, was Soon): the EXISTING per-chart `extendedHoursShading` — the
                  toolbar's "Extended hours" / EXT-RTH toggle and this row are one switch, so they always agree. ON shows
                  the pre/post-market bars with their shading on intraday charts; OFF = regular session only. Per chart
                  (never copied by "Apply to all charts", never reset by "Reset this section"). */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Shade pre / post-market <span className={styles.fieldHint}>extended-hours bars + shading, intraday · same as the toolbar's Extended hours</span></span>
                {liveSwitch('Shade pre / post-market', extendedHours, () => setSetting({ extendedHoursShading: !extendedHours }))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Grid</div>
            <div className={styles.card}>
              {/* One control for the grid (owner 11-15): Off / Horizontal / Vertical / Both. `grid.visible` stays
                  the on/off master (Off writes visible:false, so older blobs and UCT Agent's grid.visible read the
                  same); `grid.lines` says which lines when it is on. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Lines</span>
                <ChoiceMenu ariaLabel="Grid lines" value={gridLines}
                  options={GRID_LINES.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={(v) => setSetting({ grid: gridPatchFor(grid, v) })} />
              </div>
              {gridLines !== 'off' && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Line color</span>
                  {colorSwatch('grid', 'Grid')}
                </div>
              )}
              {/* Session breaks (owner 11-15, was Soon): `sessionBreaks`, absent = off. Drawn by sessionMarks.js on
                  intraday charts only, in the grid's own colour. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Session breaks <span className={styles.fieldHint}>a line at each new trading day, intraday</span></span>
                {liveSwitch('Session breaks', sessionBreaksOf(settings), () => setSetting({ sessionBreaks: !sessionBreaksOf(settings) }))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Crosshair &amp; scale</div>
            <div className={styles.card}>
              {/* Three-way control (Always / Hold / Off), mirroring Chart legend.
                  Writes ONLY `crosshair.mode`; the legacy `crosshair.enabled`
                  boolean survives as a read-only fallback (see crosshairMode.js),
                  so nothing here toggles it. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Crosshair</span>
                <ChoiceMenu ariaLabel="Crosshair" value={crosshairMode}
                  options={CROSSHAIR_MODES.map((val) => ({ value: val, label: CROSSHAIR_MODE_LABELS[val].label, hint: CROSSHAIR_MODE_LABELS[val].hint }))}
                  onChange={(val) => setSetting({ crosshair: { ...crosshair, mode: val } })} />
              </div>
              {crosshairMode !== 'off' && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Line color</span>
                  {colorSwatch('crosshair', 'Crosshair')}
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Scale text</span>
                <div className={styles.fieldControls}>
                  <ChoiceMenu ariaLabel="Scale text size" value={curTextSize}
                    options={TEXT_SIZES.map((px) => ({ value: px, label: `${px}px` }))}
                    onChange={(v) => setSetting({ textSize: Number(v) })} />
                  {colorSwatch('text', 'Scale Text')}
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Margins</div>
            <div className={styles.card}>
              {/* Right margin: Auto = the chart's own padding (6 bars on /charts); dragging sets bars. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Right margin <span className={styles.fieldHint}>space between the last candle and the price scale</span></span>
                <div className={styles.hdrRowCtl}>
                  <input type="range" min={RIGHT_MARGIN_MIN} max={RIGHT_MARGIN_MAX} step={1}
                    value={rightMargin ?? PANE_LOOK.rightPadBars} aria-label="Right margin"
                    aria-valuetext={rightMargin == null ? 'Auto' : `${rightMargin} bars`}
                    className={styles.marginRange}
                    onChange={(e) => setScaleTime('rightMargin', Number(e.target.value))} />
                  <span className={styles.marginValue}>{rightMargin == null ? 'Auto' : `${rightMargin} bar${rightMargin === 1 ? '' : 's'}`}</span>
                  {rightMargin != null && (
                    <button type="button" className={styles.marginAuto} title="Back to the chart's own margin"
                      onClick={() => setScaleTime('rightMargin', null)}>Auto</button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Scale &amp; time</div>
            <div className={styles.card}>
              {/* Time zone (owner 11-16, was Soon): `scaleTime.timeZone`, absent = Exchange (New York). Display only —
                  the intraday time-axis labels and the crosshair time; bars and every session rule stay New York. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Time zone <span className={styles.fieldHint}>intraday axis + crosshair times</span></span>
                <ChoiceMenu ariaLabel="Time zone" value={timeZone}
                  options={TIME_ZONES.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={(v) => setScaleTime('timeZone', v)} />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Time format</span>
                <ChoiceMenu ariaLabel="Time format" value={timeFormat}
                  options={TIME_FORMATS.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={(v) => setScaleTime('timeFormat', v)} />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Price decimals</span>
                <ChoiceMenu ariaLabel="Price decimals" value={priceDecimals ?? 'auto'}
                  options={PRICE_DECIMALS.map(([v, l]) => ({ value: v, label: l }))}
                  onChange={(v) => setScaleTime('priceDecimals', v === 'auto' ? null : Number(v))} />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel} ref={axisRef}>Price scale</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Price labels</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showPriceLabels !== false}
                  aria-label="Show price labels on the axis"
                  className={`${styles.toggle} ${settings.showPriceLabels !== false ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ showPriceLabels: settings.showPriceLabels === false })}
                ><span className={styles.toggleKnob} /></button>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Moving average labels</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!settings.showMaLabels}
                  aria-label="Show moving average labels on the axis"
                  className={`${styles.toggle} ${settings.showMaLabels ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ showMaLabels: !settings.showMaLabels })}
                ><span className={styles.toggleKnob} /></button>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel} ref={watermarkRef}>Watermark</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show watermark</span>
                <button aria-label="Show watermark"
                  type="button"
                  role="switch"
                  aria-checked={watermark.visible !== false}
                  className={`${styles.toggle} ${watermark.visible !== false ? styles.toggleOn : ''}`}
                  onClick={() => setWmVisible(watermark.visible === false)}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {watermark.visible !== false && (<>
                <div className={`${styles.field} ${styles.fieldCol}`}>
                  <span className={styles.fieldLabel}>Lines <span className={styles.fieldHint}>top to bottom</span></span>
                  {/* A 2-column checklist of soft squares (owner 11-15), right in the card.
                      `logo` (default OFF) prefixes the ticker line with the company
                      logo; `interval` (default ON) appends ", <timeframe>" to it,
                      e.g. "ARM, 1D". The `true` 3rd element marks a default-OFF field. */}
                  <div className={`${styles.softGrid} ${styles.softGrid2}`} role="group" aria-label="Watermark lines">
                    {WM_LINES.map(([key, label, defOff]) => {
                      const on = defOff ? !!wmLines[key] : wmLines[key] !== false
                      return (
                        <button
                          key={key}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          className={styles.softItem}
                          onClick={() => setWmLine(key, defOff ? !wmLines[key] : wmLines[key] === false)}
                        ><span className={`${styles.softBox} ${on ? styles.softBoxOn : ''}`} aria-hidden="true" />{label}</button>
                      )
                    })}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Alignment</span>
                  <ChoiceMenu ariaLabel="Watermark alignment" value={watermark.align || 'center'} onChange={setWmAlign}
                    options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Size</span>
                  <ChoiceMenu ariaLabel="Watermark size" value={wmSize} onChange={(v) => setWmSize(Number(v))}
                    options={WM_SIZES.map((sz) => ({ value: sz, label: `${Math.round(sz * 100)}%` }))} />
                </div>
                {/* Width of the watermark's fixed layout box. The block occupies the
                    same rectangle on every symbol; a long company name wraps into
                    this width instead of stretching the mark sideways. */}
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Width</span>
                  <ChoiceMenu ariaLabel="Watermark width" value={wmBoxW} onChange={(v) => setWmBoxW(Number(v))}
                    options={WM_BOX_WIDTHS.map(([w, label]) => ({ value: w, label }))} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Weight</span>
                  <ChoiceMenu ariaLabel="Watermark font weight" value={wmWeight} onChange={(v) => setWmWeight(Number(v))}
                    options={WM_WEIGHTS.map(([w, label]) => ({ value: w, label }))} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color &amp; opacity</span>
                  {colorSwatch('watermark', 'Watermark', watermark.color || '#a8a290')}
                </div>
                {/* Per-chart position (charts workspace only) — a shortcut to the
                    same drag+confirm the right-click "Adjust watermark" opens. */}
                {onAdjustWatermark && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Position</span>
                    <div className={styles.seg}>
                      <button type="button" className={styles.segBtn} onClick={() => onAdjustWatermark()}>Move watermark</button>
                      {watermarkCustomized && (
                        <button type="button" className={styles.segBtn} onClick={() => onResetWatermark?.()}>Reset to center</button>
                      )}
                    </div>
                  </div>
                )}
              </>)}
            </div>
          </section>
          </>)}
          {activeTab === 'indicators' && (
          /* ⭐ THE CONSOLIDATION. This tab used to render EVERY row from
             `listAllIndicators` with every field open — four MA overlays, the
             volume pane and one section per DEFINITION whether or not the chart
             drew it — which on a stock blob is twenty-two sections and a tab you
             scroll for a minute to reach the EMA you can see on the chart. And
             it could not ADD anything: discovery lived in a separate toolbar
             modal that in turn could not EDIT anything.

             `ChartSettingsIndicators` composes the two. The rows, the writer and
             the colour swatch are still THIS file's — the tab is handed
             `indRows`, `setRow` and `colorSwatch` rather than reaching for the
             settings blob itself, so there is exactly one control door onto an
             indicator on this surface, the same one there has always been. */
          <ChartSettingsIndicators
            volumeOpts={volumeOpts}
            rows={indRows}
            settings={settings}
            onChange={onChange}
            historyKey={historyKey}
            historyUserId={historyUserId}
            registry={engineRegistry}
            onRowPatch={setRow}
            colorSwatch={colorSwatch}
            volumeRef={volumeRef}
            onCreateFormula={onCreateFormula}
            onCreateIndicator={onCreateIndicator}
            onOpenBuilderDoor={onOpenBuilderDoor}
            /* Subscribed up here, for the reason written beside the hooks: this
               component builds `indRows`, so it is the one that has to re-render
               when a member's formulas install. Handing the two results down is
               what keeps the tab from opening a SECOND subscription over the same
               key to learn the same thing. */
            userDefRows={userDefRows}
            userDefErrors={userDefErrors}
            /* ⭐ THE ROW THE LEGEND'S GEAR NAMED — opened straight into its
               settings, so "edit this indicator" is one click from the chart
               rather than a click plus a hunt down a list. */
            openRowId={indTargetRow(scrollTo)}
            chartTf={chartTf}
            chartFeatures={chartFeatures}
            definitionDoors={definitionDoors}
            openAdd={scrollTo === 'add'}
            onFirstAdd={onIndicatorFirstAdd}
          />
          )}

          {activeTab === 'header' && statPickerOpen && (
            <HeaderStatPicker styles={styles} keys={infoFields} onToggle={toggleInfoField} onReset={resetInfoFields} onDone={() => setStatPickerOpen(false)}
              metaOf={infoStatMeta} onAddCustom={addCustomInfoField} customAddRefusal={customInfoRefusal}
              startBuilding={statPickerStart === 'custom'} />
          )}
          {activeTab === 'header' && !statPickerOpen && (<>
          {/* TITLE — the ticker/company label + its color + the day-change readout that
              sits right beside it (all "the title line", so they're grouped together). */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Title</div>
            <div className={styles.card}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Shows</span>
              <ChoiceMenu ariaLabel="Title shows" value={header.titleMode || 'company'} onChange={(v) => setHeader({ titleMode: v })}
                options={TITLE_MODES.map(({ val, label }) => ({ value: val, label }))} />
            </div>
            {/* Title color — same swatch/ColorPanel mechanism as the other header
                items, so it supports opacity. Unset keeps the built-in gold. */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Title color</span>
              <div className={styles.hdrRowCtl}>{colorSwatch('hdrTitle', 'Title color')}</div>
            </div>
            {/* Day change ($ / %) — reads beside the title, so it lives in this section. */}
            {renderShowRow('showChange', 'Day change ($ / %)',
              [['hdrDayUp', 'Up-day color'], ['hdrDayDown', 'Down-day color']])}
            </div>
          </section>

          {/* CHART LEGEND — its own section (the on-chart OHLCV readout + its shape). */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Legend</div>
            <div className={styles.card}>
              {/* ⚰️ A SHOW/HIDE TOGGLE STOOD HERE (`renderShowRow('showLegend', …)`)
                  and is replaced by a three-way control rather than joined by one.
                  Two controls over one fact — a boolean AND a mode — is the defect
                  the resolver exists to prevent; `header.showLegend` survives ONLY
                  as a read-only fallback for blobs written before the mode, and
                  nothing writes it any more. The toolbar's eye button cycles the
                  same key. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Chart legend</span>
                <div className={styles.hdrRowCtl}>
                  {legendMode !== 'off' && colorSwatch('hdrLegend', 'Chart legend color')}
                  <ChoiceMenu ariaLabel="Chart legend" value={legendMode} onChange={(val) => setHeader({ legendMode: val })}
                    options={LEGEND_MODES.map((val) => ({ value: val, label: LEGEND_MODE_LABELS[val].label, hint: LEGEND_MODE_LABELS[val].hint }))} />
                </div>
              </div>
              {/* ⭐⭐ BAR INFO — WHICH READINGS OF THE CANDLE THE STRIP PRINTS.
                  ⚰ A 'Legend layout' Vertical/Horizontal segmented control stood
                  here. Legend V2 has one layout, so the useful question moved from
                  SHAPE to CONTENT: the horizontal strip is date + O/H/L/C + the two
                  change figures, and a member who reads close-only wants the other
                  five gone.

                  ⛔ VOLUME IS NOT OFFERED, AND NOT BY OVERSIGHT. It is a PLOT —
                  colour, pane, visibility, popover — so it lives in the study stack
                  with the moving averages and is managed from its own row there.

                  ⛔ PILLS, NOT SEVEN TOGGLE ROWS. Seven `.field` rows would be 336px
                  of modal for seven booleans; this is one wrapping line that reads
                  as the strip it configures. The whole strip still turns off through
                  the three-way control above — that is the visibility question and
                  it already has an answer, so this one does not get a second. */}
              {legendMode !== 'off' && (
                <div className={`${styles.field} ${styles.fieldCol}`}>
                  <span className={styles.fieldLabel}>Bar info</span>
                  {/* a 4-column grid of soft squares (owner 11-15) — same writer as the pills it replaced */}
                  <div className={`${styles.softGrid} ${styles.softGrid4}`} role="group" aria-label="Bar info fields">
                    {BAR_INFO_FIELDS.map(({ id, label }) => (
                      <button
                        key={id} type="button"
                        role="checkbox"
                        aria-checked={barInfo.includes(id)}
                        className={styles.softItem}
                        onClick={() => toggleBarField(id)}
                      ><span className={`${styles.softBox} ${barInfo.includes(id) ? styles.softBoxOn : ''}`} aria-hidden="true" />{label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* INFO ROW (owner 11-16) — the chosen stats in header order: drag (or ↑ / ↓) to reorder, click a name to
              rename it (≤16 characters, empty = the stat's own name), a colour swatch per stat (two for a signed one).
              "Choose stats" opens the picker as a sub-page of this section (HeaderStatPicker.jsx). */}
          <section className={styles.section}>
            <div className={styles.infoRowHead}>
              <span className={styles.sectionLabel} style={{ padding: 0 }}>Stats beside the ticker <span className={styles.sectionHint}>{infoFields.length} shown</span></span>
              <button
                type="button"
                className={styles.addFieldBtn}
                onClick={() => setStatPickerOpen(true)}
              ><UIcon name="plus" size={12} gold={false} aria-hidden="true" />Choose stats</button>
            </div>
            <HeaderStatList
              styles={styles}
              keys={infoFields}
              labels={statLabels}
              onRename={renameInfoField}
              onMove={moveInfoField}
              onRemove={toggleInfoField}
              metaOf={infoStatMeta}
              styledKeys={new Set(Object.keys(statLooks))}
              renderStyle={(f) => {
                const look = statLooks[f.key] || {}
                const size = look.size || 'm'
                const setLook = (patch) => setHeader({ statStyle: withHeaderStatStyle(header, f.key, patch) })
                return (<>
                  <span className={styles.statStyleItem}>Label color {colorSwatch(`hdrs:${f.key}:label`, `${f.label} label color`)}
                    {look.labelColor && <button type="button" className={styles.statStyleReset} onClick={() => setLook({ labelColor: null })} aria-label={`${f.label} label color: back to default`}>Default</button>}
                  </span>
                  <span className={styles.statStyleItem}>Box {liveSwitch(`${f.label} shaded box`, !!look.box, () => setLook({ box: !look.box }))}
                    {look.box && colorSwatch(`hdrs:${f.key}:box`, `${f.label} box color`)}
                  </span>
                  <span className={styles.statStyleItem}>Size
                    <span className={styles.statSizes} role="group" aria-label={`${f.label} text size`}>
                      {STAT_SIZES.map((z) => (
                        <button key={z} type="button" aria-pressed={size === z} aria-label={`${f.label} size ${STAT_SIZE_LABELS[z]}`}
                          className={`${styles.statSize} ${size === z ? styles.statSizeOn : ''}`}
                          onClick={() => { if (z !== size) setLook({ size: z }) }}>{STAT_SIZE_LABELS[z]}</button>
                      ))}
                    </span>
                  </span>
                  <span className={styles.statStyleItem}>Thickness
                    <span className={styles.statSizes} role="group" aria-label={`${f.label} text thickness`}>
                      {(() => {
                        // the same thinner / thicker stepper as the header menu (owner 11-17)
                        const wt = look.weight || 'regular'
                        const i = STAT_WEIGHTS.indexOf(wt)
                        return (<>
                          <button type="button" className={styles.statSize} aria-label={`${f.label} thinner`} disabled={i <= 0}
                            onClick={() => setLook({ weight: STAT_WEIGHTS[i - 1] })}>−</button>
                          <span className={styles.statWeightName} style={{ fontWeight: STAT_WEIGHT_VALUE[wt] }}>{STAT_WEIGHT_LABELS[wt]}</span>
                          <button type="button" className={styles.statSize} aria-label={`${f.label} thicker`} disabled={i >= STAT_WEIGHTS.length - 1}
                            onClick={() => setLook({ weight: STAT_WEIGHTS[i + 1] })}>+</button>
                        </>)
                      })()}
                    </span>
                  </span>
                </>)
              }}
              renderColors={(f) => (f.signed ? (<>
                {colorSwatch(`hdrf:${f.colorKey}:pos`, `${f.label} — positive`)}
                {colorSwatch(`hdrf:${f.colorKey}:neg`, `${f.label} — negative`)}
              </>) : colorSwatch(`hdrf:${f.colorKey}`, `${f.label} color`))}
            />
          </section>
          {/* Timeframes/Favorites are managed on the chart's own timeframe menu (the
              ⌄ button) — star to favorite there; no separate settings section. */}
          </>)}
          {activeTab === 'markers' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Events</div>
            <div className={styles.card}>
              {EVENT_MARKERS.map(([key, label]) => (
                <div className={styles.field} key={key}>
                  <span className={styles.fieldLabel}>{label}</span>
                  <div className={styles.hdrRowCtl}>
                    {/* Earnings badge is beat/miss-colored — expose both when it's on. */}
                    {key === 'earnings' && evtMarkers.earnings && (<>
                      {colorSwatch('earnBeat', 'Beat color')}
                      {colorSwatch('earnMiss', 'Miss color')}
                    </>)}
                    <button
                      type="button" role="switch" aria-checked={!!evtMarkers[key]} aria-label={label}
                      className={`${styles.toggle} ${evtMarkers[key] ? styles.toggleOn : ''}`}
                      onClick={() => setMarker(key, !evtMarkers[key])}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
              ))}
              {/* Next earnings date (owner 11-16, was Soon): `nextEarningsMarker`, absent = off. A muted grey "E" chip at the
                  bottom of the price pane on the bar where the next report falls — ahead of the last bar (logical index from
                  the trading calendar), every timeframe (nextEarningsMark.js). No date known → nothing. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Next earnings date <span className={styles.fieldHint}>a marker ahead of the last bar, so you see it coming</span></span>
                {liveSwitch('Next earnings date', nextEarningsMarkerOf(settings), () => setSetting({ nextEarningsMarker: !nextEarningsMarkerOf(settings) }))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Swing labels</div>
            <div className={styles.card}>
              {/* Sensitivity sits IN the on/off row, on the right, while the labels are on (owner 11-15). */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Swing highs &amp; lows</span>
                <div className={styles.hdrRowCtl}>
                  {swing.enabled && (
                    <ChoiceMenu ariaLabel="Swing sensitivity" value={swing.sensitivity || 'medium'} onChange={(v) => setSwing({ sensitivity: v })}
                      options={SWING_SENS.map(([val, label]) => ({ value: val, label }))} />
                  )}
                  <button
                    type="button" role="switch" aria-checked={!!swing.enabled} aria-label="Swing highs & lows"
                    className={`${styles.toggle} ${swing.enabled ? styles.toggleOn : ''}`}
                    onClick={() => setSwing({ enabled: !swing.enabled })}
                  ><span className={styles.toggleKnob} /></button>
                </div>
              </div>
              {swing.enabled && (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Label color</span>
                  {colorSwatch('swingColor', 'Swing label color')}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Label background</span>
                  <div className={styles.hdrRowCtl}>
                    {swing.bgEnabled !== false && colorSwatch('swingBg', 'Swing label background')}
                    <button
                      type="button" role="switch" aria-checked={swing.bgEnabled !== false} aria-label="Label background"
                      className={`${styles.toggle} ${swing.bgEnabled !== false ? styles.toggleOn : ''}`}
                      onClick={() => setSwing({ bgEnabled: swing.bgEnabled === false })}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Tint by type</span>
                  <div className={styles.hdrRowCtl}>
                    {swing.tintByType && colorSwatch('swingUp', 'Swing-high color')}
                    {swing.tintByType && colorSwatch('swingDown', 'Swing-low color')}
                    <button
                      type="button" role="switch" aria-checked={!!swing.tintByType} aria-label="Tint by type"
                      className={`${styles.toggle} ${swing.tintByType ? styles.toggleOn : ''}`}
                      onClick={() => setSwing({ tintByType: !swing.tintByType })}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
              </>)}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Previous-day levels <span className={styles.sectionHint}>intraday charts only</span></div>
            <div className={styles.card}>
              {PDL_LINES.map(([key, label]) => {
                const c = pdl[key] || {}
                return (
                  <div className={styles.field} key={key}>
                    <span className={styles.fieldLabel}>{label}</span>
                    <div className={styles.hdrRowCtl}>
                      {c.enabled && (<>
                        <ChoiceMenu ariaLabel={`${label} line style`} value={c.style || 'dashed'} onChange={(v) => setPrevDay(key, { style: v })}
                          options={LINE_STYLES.map(([v, l]) => ({ value: v, label: l }))} />
                        <ChoiceMenu ariaLabel={`${label} line width`} value={c.width || 1} onChange={(v) => setPrevDay(key, { width: Number(v) })}
                          options={PDL_WIDTHS.map((w) => ({ value: w, label: `${w}px` }))} />
                        {colorSwatch(PDL_COLOR_TARGET[key], `${label} color`)}
                      </>)}
                      <button
                        type="button" role="switch" aria-checked={!!c.enabled} aria-label={label}
                        className={`${styles.toggle} ${c.enabled ? styles.toggleOn : ''}`}
                        onClick={() => setPrevDay(key, { enabled: !c.enabled })}
                      ><span className={styles.toggleKnob} /></button>
                    </div>
                  </div>
                )
              })}
              {/* Pre-market high & low (owner 11-15, was Soon): `preMarketLevels`, absent = off. Two dashed lines at the
                  latest session's 04:00–09:30 ET high and low, labelled "PM high" / "PM low" on the price scale, drawn
                  only while extended-hours bars are loaded (sessionMarks.js). */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Pre-market high &amp; low <span className={styles.fieldHint}>today's pre-market range, on intraday charts with extended hours</span></span>
                {liveSwitch('Pre-market high & low', preMarketLevelsOf(settings), () => setSetting({ preMarketLevels: !preMarketLevelsOf(settings) }))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Your activity</div>
            <div className={styles.card}>
              {/* My trades (owner 11-16, was Soon — the last Markers Soon row): `myTradeMarkers`, absent = off. A small
                  up-arrow under each bar holding one of the member's Journal buys on this symbol and a down-arrow over
                  each holding a sell, in the chart's own candle colours at reduced strength; hovering one reads
                  "Bought 100 @ 12.34 · <date time>" (myTradeMarkers.js). Read-only; nothing is fetched while it is off. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>My trades <span className={styles.fieldHint}>your buys and sells from the Journal</span></span>
                {liveSwitch('My trades', myTradeMarkersOf(settings), () => setSetting({ myTradeMarkers: !myTradeMarkersOf(settings) }))}
              </div>
              {/* Price alerts (owner 11-16, was Soon): `priceAlertLines`, absent = off. A muted dashed line labelled "Alert"
                  on the price scale at each of the member's ACTIVE price alerts on this symbol, from the existing alerts
                  list (priceAlertLines.js). Read-only: an alert that goes off or is deleted takes its line with it. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Price alerts <span className={styles.fieldHint}>a line at each of your alert prices</span></span>
                {liveSwitch('Price alerts', priceAlertLinesOf(settings), () => setSetting({ priceAlertLines: !priceAlertLinesOf(settings) }))}
              </div>
            </div>
          </section>

          {/* Dark Pool — brings the Dark Pool page's print-level bars onto this
              chart. Off by default; paid-gated at fetch (empty for free users).
              Bar + label colors carry opacity via the color menu; they sit in the
              on/off row, on the right, while it is on (owner 11-15). */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Dark pool</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Dark pool prints</span>
                <div className={styles.hdrRowCtl}>
                  {settings.darkPool?.enabled && (<>
                    {colorSwatch('dpBarColor', 'Dark pool bar color')}
                    {colorSwatch('dpLabelColor', 'Dark pool label color')}
                  </>)}
                  <button
                    type="button" role="switch" aria-checked={!!settings.darkPool?.enabled} aria-label="Dark pool prints"
                    className={`${styles.toggle} ${settings.darkPool?.enabled ? styles.toggleOn : ''}`}
                    onClick={() => setSetting({ darkPool: { ...(settings.darkPool || {}), enabled: !settings.darkPool?.enabled } })}
                  ><span className={styles.toggleKnob} /></button>
                </div>
              </div>
            </div>
          </section>
          </>)}
          {activeTab === 'price' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Chart type</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Type</span>
                <ChoiceMenu ariaLabel="Chart type" value={curType} onChange={setType}
                  options={CHART_TYPES.map(({ val, label }) => ({ value: val, label, icon: <TypeGlyph kind={val} size={16} /> }))} />
              </div>
            </div>
          </section>

          {/* Colors (owner 11-15): "Color based on", then one row per part — Body / Borders / Wick
              each with its up + down swatches on the right (or the single colour in One Color mode).
              Thin bars — OHLC/HLC bars only. Lightweight Charts exposes exactly one boolean
              (thinBars); CandlestickSeries has no width option, so the row is hidden for
              candles/hollow rather than shown as a control that does nothing. */}
          {showColorMode && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Colors</div>
              <div className={styles.card}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color based on</span>
                  <ChoiceMenu ariaLabel="Color based on" value={curColorMode} onChange={setColorMode}
                    options={COLOR_MODES.map(({ val, label }) => ({ value: val, label }))} />
                </div>
                {curColorMode === 'onecolor' ? (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Color</span>
                    <div className={styles.hdrRowCtl}>{colorSwatch('one', 'Color')}</div>
                  </div>
                ) : isCandleType ? (<>
                  {/* Each part: its up + down swatches, then an on/off (absent = on, every part draws). */}
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Body</span>
                    <div className={styles.hdrRowCtl}>{colorSwatch('bodyUp', 'Body Up')}{colorSwatch('bodyDown', 'Body Down')}{liveSwitch('Show body', parts.body, () => setPart('showBody', !parts.body))}</div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Borders</span>
                    <div className={styles.hdrRowCtl}>{colorSwatch('borderUp', 'Border Up')}{colorSwatch('borderDown', 'Border Down')}{liveSwitch('Show borders', parts.borders, () => setPart('showBorders', !parts.borders))}</div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Wick</span>
                    <div className={styles.hdrRowCtl}>{colorSwatch('wickUp', 'Wick Up')}{colorSwatch('wickDown', 'Wick Down')}{liveSwitch('Show wick', parts.wick, () => setPart('showWick', !parts.wick))}</div>
                  </div>
                </>) : (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>{(curType === 'bars' || curType === 'hlc') ? 'Bars' : 'Color'}</span>
                    <div className={styles.hdrRowCtl}>{colorSwatch('bodyUp', 'Up')}{colorSwatch('bodyDown', 'Down')}</div>
                  </div>
                )}
                {(curType === 'bars' || curType === 'hlc') && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Thin bars</span>
                    <button
                      type="button" role="switch" aria-checked={candles.thinBars !== false} aria-label="Thin bars"
                      className={`${styles.toggle} ${candles.thinBars !== false ? styles.toggleOn : ''}`}
                      onClick={() => setSetting({ candles: { ...candles, thinBars: candles.thinBars === false } })}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Price line</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Last price line <span className={styles.fieldHint}>across the chart at the latest price</span></span>
                <div className={styles.hdrRowCtl}>
                  {priceLine.visible && (
                    <ChoiceMenu ariaLabel="Last price line style" value={priceLine.style}
                      options={PRICE_LINE_STYLES.map(([v, l]) => ({ value: v, label: l }))}
                      onChange={(v) => setSetting({ candles: { ...candles, priceLineStyle: v } })} />
                  )}
                  {liveSwitch('Last price line', priceLine.visible, () => setSetting({ candles: { ...candles, priceLine: !priceLine.visible } }))}
                </div>
              </div>
              {/* The price series' last-value label IS `showPriceLabels` (also Canvas → Price scale → Price labels). */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Price label on the scale <span className={styles.fieldHint}>the latest price on the right-hand scale</span></span>
                {liveSwitch('Price label on the scale', settings.showPriceLabels !== false, () => setSetting({ showPriceLabels: settings.showPriceLabels === false }))}
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Countdown to bar close <span className={styles.fieldHint}>under the price label</span></span>
                <button
                  type="button" role="switch" aria-checked={!!settings.countdown} aria-label="Countdown to bar close"
                  className={`${styles.toggle} ${settings.countdown ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ countdown: !settings.countdown })}
                ><span className={styles.toggleKnob} /></button>
              </div>
            </div>
          </section>
          </>)}
        </div>
        </div>
        </div>
      </div>
        </div>,
        document.body,
      )}
      {activeTarget && panelPos && createPortal(
        <div
          data-color-panel
          data-guide="chartSettings.colorPanel"
          style={{ position: 'fixed', left: panelPos.left, bottom: panelPos.bottom, zIndex: 9100 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            line={activeTarget.target === 'crosshair' ? {
              width: crosshair.width ?? 1,
              style: crosshair.style ?? 3,
              onWidth: (w) => setSetting({ crosshair: { ...crosshair, width: w } }),
              onStyle: (s) => setSetting({ crosshair: { ...crosshair, style: s } }),
            } : null}
          />
        </div>,
        document.body,
      )}
      <ChartThemesModal
        open={themesOpen}
        onClose={() => setThemesOpen(false)}
        onApply={applyTheme}
        canApplyAll={!!onApplyThemeAll}
        canApplyAllWidgets={!!onApplyThemeAllWidgets}
        currentSettings={settings}
        themeVars={themeVars}
      />
    </>
  )
}
