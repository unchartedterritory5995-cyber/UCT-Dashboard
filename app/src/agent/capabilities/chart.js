// ── CHART capabilities: the first feature registered with UCT Agent ─────────
//
// Everything the Agent knows about charts is in THIS file, through the public
// registration seam (agent/capabilities.js) — the same seam any future feature
// uses. Nothing in the orchestrator, planner, runtime or server names a chart
// action.
//
//   target kind 'chart'   state = { cs, tf, symbol }; commit = ChartWidget's own
//                         agent adapter (settings + tf in ONE onOptsChange, the
//                         ticker through the colour group, as a search pick does)
//   context 'charts'      the compact per-chart description the model sees
//   8 capabilities        non-indicator chart operations only
//
// ⛔ NO INDICATOR CAPABILITIES. Indicators (instances, panes, display targets,
// authoring) belong to Indicator Intelligence; nothing here writes
// `indicatorInstances`, `paneOrder`, `paneSizes` or display targets.
//
// ⛔ EVERY WRITE IS A KEY THE MANUAL UI ALREADY WRITES, in the shape the manual
// control writes it (ChartPane session toggles, ChartSettingsModal canvas and
// candle pickers, the legend's Volume remove, chartThemes.applyThemeToOneChart).
// No new settings key, so the chartDefaults allow-list is untouched.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { resolveDateWord, dayWord, isoDayMs } from '../dateWords'
import { CHART_THEMES, CHART_THEME_BY_ID, applyThemeToOneChart } from '../../components/chart/chartThemes'
import { primaryChartTypeFor } from '../../components/chart/engine/sourceCapability'
import { canonicalFamily, canonicalProduct, canonicalSourceCapability, marketIndicatorRecord } from '../../hooks/useMarketIndicators'
import { breadthRecord } from '../../hooks/useBreadthSymbols'
import { isEconomicId } from '../../components/chart/engine/econMark'
import { getExtSessionCached } from '../../utils/extSession'
import { unknownSymbols } from '../agentClient'
import { watermarkSpot } from '../derivedOpts'
import { mergeChartSettings, CHART_TYPE_OPTIONS } from '../../components/chart/chartDefaults'
import { NATIVE_TFS, tfLabel as productTfLabel } from '../../components/chart/timeframes'
import { TF_ORDER } from '../../components/chart/keyboardShortcuts'
import { paneVolumePct } from '../../components/chart/pane/paneLook'
import { HEADER_FIELDS, headerFieldKeys } from '../../components/chart/headerFields'
import { BAR_INFO_FIELDS, barInfoFieldsOf, withBarInfoField } from '../../components/chart/barInfoFields'
import { ELIGIBLE_SETTINGS, settingDescriptor, coerceSettingValue, settingUnavailable, withSetting, settingValue, canvasLock, settingHiddenNote } from '../../components/chart/chartSettingsDescriptors'
import { CHART_DEFAULTS } from '../../components/chart/chartDefaults'
import { chartTemplateSettings } from '../../components/chart/chartTemplateApply'
import { keepIndicatorState } from '../../components/chart/indicatorPreservation'
import { makeTfCode, isValidTf, tfLabel as tfShort } from '../../components/chart/timeframes'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import { MAX_COMPARISONS } from '../../components/chart/chartCeilings'
import { isPronounToken, isReservedWord, groundSymbols, groundingOf, resolvedTicker, candidatesText, suggestionText } from '../nl/tickers'
import { plainSymbolWord } from '../nl/lexicon'
import { matchName } from '../nl/match'
import { whenVisible } from '../frames'
// C1-178: as app.js NAV_DELAY_MS — the receipt is on screen before Ask AI leaves Charts
const ASK_AI_DELAY_MS = 900
import { readFavoriteTools, writeFavoriteTools } from '../../components/chart/drawToolFavorites'
import { normalizeDock } from '../../pages/charts/widgets/chartDock'
import { replayDone, replaySig, replayContext, bareExitFast, exitGuard, isCutoffExit } from './chartReplay'

// The chart types and the timeframes UCT charts natively are the PRODUCT's lists
// (chartDefaults.CHART_TYPE_OPTIONS, timeframes.NATIVE_TFS) — imported, never copied, so a new
// type or timeframe reaches the Agent's enums the day it ships (agentContracts.test.js rails it).
// Only the Agent's receipt wording lives here; a type or timeframe without a word falls back to
// the product's own label.
export const CHART_TYPE_IDS = CHART_TYPE_OPTIONS.map(([id]) => id)
export const CHART_TIMEFRAMES = [...NATIVE_TFS]
const TYPE_WORDING = { hollow: 'Hollow Candles', hlc: 'HLC Bars' }
const TYPE_LABEL = Object.fromEntries(CHART_TYPE_OPTIONS.map(([id, label]) => [id, TYPE_WORDING[id] || label]))
const TF_WORDING = { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', D: 'Daily', W: 'Weekly', M: 'Monthly' }
const TF_LABEL = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, TF_WORDING[tf] || productTfLabel(tf)]))
const INTRADAY = new Set(CHART_TIMEFRAMES.filter(tf => !['D', 'W', 'M'].includes(tf)))
export const tfLabel = (tf) => TF_LABEL[tf] || String(tf)
export const chartTypeLabel = (t) => TYPE_LABEL[t] || String(t)
const isIntraday = (tf) => INTRADAY.has(String(tf))

// ── colors ── hex from the model; a few plain names members say; nothing guessed.
const NAMED = {
  white: '#ffffff', black: '#000000', cream: '#f3efe4', ivory: '#fffff0', beige: '#f5f5dc',
  navy: '#0b1f3a', 'dark blue': '#0d1b2a', blue: '#2962ff', green: '#2faf68', red: '#df4646',
  gray: '#808080', grey: '#808080', 'dark gray': '#1e1e1e', 'dark grey': '#1e1e1e',
  'light gray': '#e5e5e5', 'light grey': '#e5e5e5', charcoal: '#17181a', teal: '#26a69a',
  orange: '#f59e0b', yellow: '#facc15', purple: '#7c3aed', pink: '#ec4899',
}
// BROWSER-QA-1 #4: a receipt says a colour by its NAME where the Agent has one ("to orange", not "to #f59e0b");
// any other value (a custom hex, a token, rgba) is said exactly as written.
const NAME_OF = Object.entries(NAMED).reduce((m, [name, hex]) => (m[hex] ? m : { ...m, [hex]: name }), {})
export function colorName(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : null
  return (s && NAME_OF[s]) || v
}
export function normalizeColor(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${h}`
}

// ── symbol capability: parity with StockChart's own clamp, so a receipt never
// claims a chart type the canvas will silently override ──
function capabilityFor(sym) {
  // No symbol yet = a chart created earlier in this request: unknown, not
  // economic (the real chart is re-validated against its real symbol at commit).
  if (!sym) return { econ: false, cap: null }
  if (isEconomicId(sym)) return { econ: true, cap: null }
  const fam = canonicalFamily(sym)
  const cap = canonicalProduct(sym)
    ? canonicalSourceCapability(sym, false)
    : fam === 'unknown' ? null : canonicalSourceCapability(sym, fam === 'security' || fam === 'volatility')
  return { econ: false, cap }
}
// ⛔ F7 (Phase 2 audit 2026-10-25): a breadth / market-indicator series draws with the SURFACE's own
// `breadthChartType` and never reads `chartType` (pane/ChartPane.jsx `isBreadthLike`, the header's
// Line/Candles button) — so the Agent writes and reports the key the canvas actually reads. Same
// predicate as ChartPane: a breadth record, or a market-indicator series that is not volatility / a product.
export function isBreadthLikeSymbol(sym) {
  if (!sym) return false
  try {
    if (breadthRecord(sym)) return true
    const mi = marketIndicatorRecord(sym)
    return !!mi && mi.source_type !== 'volatility' && mi.kind !== 'product'
  } catch { return false }
}
const typeKeyOf = (sym) => (isBreadthLikeSymbol(sym) ? 'breadthChartType' : 'chartType')
const chartTypeOf = (cs, sym) => (cs?.[typeKeyOf(sym)] || 'candles')
function hasIntradayBars(sym) {
  if (!sym) return true
  if (isEconomicId(sym)) return false
  const fam = canonicalFamily(sym)
  return fam === 'unknown' || fam === 'security' || fam === 'volatility'
}

const set = (cs, patch) => ({ ...cs, ...patch, preset: 'custom' })
const SCALE_LABEL = { linear: 'Linear', log: 'Logarithmic', percent: 'Percent' }
// Same precedence as StockChart's effectiveScale: percent before log.
const scaleOf = (cs) => (cs?.percentScale ? 'percent' : (cs?.logScale ? 'log' : 'linear'))
export const volState = (cs) => (cs?.volume?.removed === true ? 'removed' : (cs?.volume?.visible === false ? 'hidden' : 'visible'))
export const sessionOf = (cs, tf) => (isIntraday(tf)
  ? (cs?.extendedHoursShading === false ? 'regular' : 'extended')
  : (cs?.sessionView === 'extended' ? 'extended' : 'regular'))
// ChartPane's `extEnabled`: the D/W/M Extended button is live only in the pre/post window.
export const extWindowOpen = () => { const s = getExtSessionCached()?.session; return s === 'pre' || s === 'post' }
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** chart.compare's resulting list: clear, then removals, then additions (the panel's own entry shape). */
function comparisonsAfter(st, { add, remove, clear }) {
  let list = clear ? [] : (Array.isArray(st.cs?.comparisonSymbols) ? [...st.cs.comparisonSymbols] : [])
  const drop = new Set((remove || []).map(x => String(x).trim().toUpperCase()))
  list = list.filter(x => !drop.has(String(x.sym).toUpperCase()))
  for (const raw of add || []) {
    const sym = String(raw || '').trim().toUpperCase()
    if (!sym || list.some(x => x.sym === sym)) continue
    list = [...list, { sym, enabled: true, color: pickComparisonColor(list.length, list.map(x => x.color)), scaleMode: 'new' }]
  }
  return list
}

// ── chart.setSetting helpers (generated from the product's descriptor table) ──
// ⛔ THE STATE THE CHART ACTUALLY DRAWS FROM. Two rows do not live in the settings blob (the descriptor's `store`):
// they are read and written where the manual control reads and writes them, and landed() reads THAT state back.
const VOL_PANE_PREF = 'charts_vol_pane_pct'                  // the member's own: every chart surface (ChartPane.handleVolPaneResize)
function readSetting(st, d) {
  if (d.store === 'volumePanePref') return st.volPanePct
  if (d.store === 'watermarkPos') return st.watermarkPos?.[d.id.split('.')[1]] ?? settingValue(st.cs, d)
  return settingValue(st.cs, d)
}
function writeSetting(st, d, v) {
  if (d.store === 'volumePanePref') return { ...st, volPanePref: String(v), volPanePct: v }
  if (d.store === 'watermarkPos') {
    const at = (axis) => st.watermarkPos?.[axis] ?? st.cs?.watermark?.[axis] ?? 0.5
    // `anchor: null`: the old pixel anchor would out-vote the new fraction; the chart derives a new one on its next draw and
    // stores it (useWatermarkAnchorMigration), which only a drawn pane can, so x/y is what every check compares (derivedOpts.js)
    return { ...st, watermarkPos: { x: at('x'), y: at('y'), [d.id.split('.')[1]]: v, anchor: null } }
  }
  return { ...st, cs: withSetting(st.cs, d, v) }
}
// ── Execution family L (pl-exec): a chart's LIST settings — which fields a strip prints — one member at a time ──
// Chart Settings → Header → Info row (`header.fields`, ChartSettingsModal toggleInfoField: a pick is appended, an unpick
// removed) and the Bar info strip (`header.barInfo`, toggleBarField → withBarInfoField: the complete set in canonical
// order). Each row is DATA: its members (the product's own catalog), how the chart reads it, and the product's own writer.
// value = "+member" or "-member", by key or by the label Chart Settings shows. Read back through the same resolver.
const LIST_SETTINGS = [
  { id: 'header.fields', label: 'Info row', members: HEADER_FIELDS.map(f => ({ value: f.key, label: f.label })),
    read: (cs) => headerFieldKeys(cs?.header),
    write: (cs, key, on) => { const cur = headerFieldKeys(cs?.header); return { ...cs, header: { ...(cs?.header || {}), fields: on ? [...cur, key] : cur.filter(k => k !== key) }, preset: 'custom' } } },
  { id: 'header.barInfo', label: 'Bar info', members: BAR_INFO_FIELDS.map(f => ({ value: f.id, label: f.label })),
    read: (cs) => barInfoFieldsOf(cs),
    write: (cs, id, on) => ({ ...cs, header: { ...(cs?.header || {}), barInfo: withBarInfoField(cs, id, on) }, preset: 'custom' }) },
]
const listSetting = (id) => LIST_SETTINGS.find(l => l.id === id) || null
const lnorm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9%$]+/g, ' ').trim()
/** "+mcap" / "-Market Cap" → { member, on } or { why }. A member is its key or its label; a word inside ONE label is enough. */
function listMember(l, raw) {
  const m = /^\s*([+-])\s*(.+)$/.exec(String(raw ?? ''))
  if (!m) return { why: `${l.label} takes "+field" to add a field or "-field" to remove one (${l.members.map(x => x.value).join(', ')}).` }
  const w = lnorm(m[2])
  const exact = l.members.filter(x => lnorm(x.value) === w || lnorm(x.label) === w)
  const near = exact.length ? exact : l.members.filter(x => lnorm(x.label).includes(w))
  if (near.length !== 1) return { why: `${near.length ? `“${m[2]}” fits ${near.map(x => x.label).join(' and ')}` : `“${m[2]}” isn't a ${l.label} field`} — the fields are ${l.members.map(x => x.label).join(', ')}.` }
  return { member: near[0], on: m[1] === '+' }
}
const listWord = (l, keys) => (keys.length ? keys.map(k => l.members.find(x => x.value === k)?.label || k).join(', ') : 'none')
const settingWord = (d, v) => (d.type === 'bool' ? (v ? 'on' : 'off')
  : d.labels ? (Object.entries(d.labels).find(([, x]) => x === v)?.[0] ?? String(v)) : String(v))
const SETTING_HINTS = (() => {
  // Settings that share one option list are written once ("prevDayLevels.high|low|close.style: …").
  const groups = new Map()
  for (const d of ELIGIBLE_SETTINGS.filter(x => x.type === 'enum')) {
    const key = d.labels ? Object.keys(d.labels).join('|') : d.options.join('|')
    groups.set(key, [...(groups.get(key) || []), d.id])
  }
  // ids that differ in ONE segment are written once ("prevDayLevels.high|low|close.width"); the rest listed (W1-B: mixed prefixes)
  const short = (ids) => {
    const out = []
    const left = new Set(ids)
    while (left.size) {
      const id = [...left][0]
      const parts = id.split('.')
      let best = null
      for (let i = 0; i < parts.length; i += 1) {
        const members = [...left].filter(x => { const q = x.split('.'); return q.length === parts.length && q.every((p, j) => j === i || p === parts[j]) })
        if (members.length > 1 && (!best || members.length > best.members.length)) best = { i, members }
      }
      if (best) { out.push(parts.map((p, j) => (j === best.i ? best.members.map(m => m.split('.')[best.i]).join('|') : p)).join('.')); best.members.forEach(m => left.delete(m)) } else { out.push(id); left.delete(id) }
    }
    return out.join(', ')
  }
  const enums = [...groups.entries()].map(([opts, ids]) => `${short(ids)}: ${opts}`)
  // W1-B: number settings, grouped by range ("watermark.opacity|x|y: 0–1")
  const ranges = new Map()
  for (const d of ELIGIBLE_SETTINGS.filter(x => x.type === 'number')) {
    const key = `${d.min}–${d.max}${d.integer ? ' (whole)' : ''}`
    ranges.set(key, [...(ranges.get(key) || []), d.id])
  }
  const nums = [...ranges.entries()].map(([r, ids]) => `${short(ids)}: ${r}`)
  // (kept under the manifest's 1000-char hints cap — agentContracts.test.js; the exact arg SHAPE is the capability's `shape`)
  return 'value = true/false for on/off settings (crosshair.mode, header.legendMode and bgMode too); a hex color (#2962ff) for colors; a number in range. '
    + `Allowed — ${enums.join('; ')}; ${nums.join('; ')}. `
    + 'header.fields|barInfo: +/-field ("+Market Cap"). '
    + 'Anything else: no op — say where it lives in Chart Settings.'
})()
// "turn off the grid", "hide the watermark", "crosshair off", "show swing labels"
const SETTING_WORDS = new Map(ELIGIBLE_SETTINGS.flatMap(d => (d.words || []).map(w => [w, d])))
function fastSetting(text) {
  const t = String(text || '').trim().replace(/[.!]$/, '').replace(/ on (?:this|the|my) chart$/, '')
  const pats = [
    [/^(?:turn|switch) (on|off) (?:the )?(.+)$/, 1, 2], [/^(?:turn|switch) (?:the )?(.+?) (on|off)$/, 2, 1],
    [/^(show|hide|enable|disable) (?:the )?(.+)$/, 1, 2], [/^(?:the )?(.+?) (on|off)$/, 2, 1],
  ]
  for (const [re, vi, wi] of pats) {
    const m = re.exec(t)
    if (!m) continue
    const d = SETTING_WORDS.get(m[wi])
    if (!d) continue
    const on = ['on', 'show', 'enable'].includes(m[vi])
    return { setting: d.id, value: d.type === 'bool' ? on : d.boolMap[String(on)] }
  }
  return null
}

// ── the date view (chart.goToDate) ──
const DAY_MS = 86400000
// Did the chart's own view control land? Read from getDateMeta, which asks the time scale.
export function viewDone(meta, { op, arg, want }) {
  if (!meta) return false
  if (op === 'applyRange') return meta.activeRange === arg
  if (op === 'resetView') return meta.atDefaultView === true
  if (op === 'restoreView') return sameFrame(meta.frame, arg)
  // the ◀ / ▶ step: the window moved by exactly the bars asked (right-relative, within a bar), never just "it moved"
  if (op === 'stepBar') return !!meta.frame && !!want && Math.abs(meta.frame.fromRight - want.fromRight) < 0.6 && Math.abs(meta.frame.toRight - want.toRight) < 0.6
  // the + / - zoom: the window narrowed (in) or widened (out) by at least half a bar, and its width is the one asked within a bar
  if (op === 'zoom') return !!meta.frame && !!want && zoomedTo(meta.frame, want)
  // Auto-scale: the price scale itself says it fits the bars (unreadable is never "done")
  if (op === 'autoScale') return meta.priceAuto === true
  // the Position Calculator (drawing extras): open or closed, and its entry / stop / target, as the panel shows them
  if (op === 'positionCalc') return samePositionCalc(meta.positionCalc, arg)
  // chartReplay.playback: the Replay / Time Machine bar's own state (on, playing, speed, scrubber index) as asked
  if (op === 'replay') return replayDone(meta.replay, want)
  return meta.indicatorsHidden === arg
}
// The window (right-relative, within a bar: the tolerance of the range read-back) and the view lock, as a range button found them.
// What a view change's Undo is pinned to: the range shown, the window a step left (to a tenth of a bar), or hide-all.
const viewFp = (snap, op, vd) => {
  if (op === 'applyRange') return snap.view?.activeRange ?? null
  // a replay Undo is stale once the member moved the replay themselves (its bar's buttons, the scrubber, the speed)
  if (op === 'replay') return replaySig(snap.view?.replay, vd?.arg?.op)
  // a Position Calculator's Undo is stale once the member typed in its panel or closed it themselves
  if (op === 'positionCalc') return positionCalcSig(snap.view?.positionCalc)
  if (op === 'stepBar' || op === 'zoom') { const f = snap.view?.frame; return f ? `${f.fromRight.toFixed(1)}|${f.toRight.toFixed(1)}` : null }
  return !!snap.view?.indicatorsHidden
}
/** The Position Calculator's read-back: open, and its three prices (as numbers; '' = empty). */
export const positionCalcSig = (p) => (p ? JSON.stringify([!!p.open, ...['entry', 'stop', 'target'].map(k => (p[k] === '' || p[k] == null ? null : Number(p[k])))]) : null)
const samePositionCalc = (a, b) => !!a && !!b && positionCalcSig(a) === positionCalcSig(b)
// the window's width in bars (logical to − from), and whether a zoom landed: the right direction, by the width asked
const frameWidth = (f) => f.fromRight - f.toRight
const zoomedTo = (f, want) => {
  const w = frameWidth(f)
  return (want.out ? w > want.from + 0.5 : w < want.from - 0.5) && Math.abs(w - want.width) < 1
}
const sameFrame = (a, b) =>!!a && !!b && Math.abs(a.fromRight - b.fromRight) < 0.6 && Math.abs(a.toRight - b.toRight) < 0.6 && !!a.locked === !!b.locked
// Did the view arrive? The Time Navigator puts the LAST BAR ON OR BEFORE the date at the right
// edge (clamped to the first bar before inception, and to the last bar for a future date).
export function viewAt(meta, target) {
  if (!meta || !Number.isFinite(meta.rightMs) || meta.loading) return false
  if (Number.isFinite(meta.lastMs) && target >= meta.lastMs) return meta.rightMs === meta.lastMs
  if (Number.isFinite(meta.firstMs) && target <= meta.firstMs && meta.fullyLoaded) return meta.rightMs === meta.firstMs
  return meta.rightMs <= target + DAY_MS && target - meta.rightMs <= 45 * DAY_MS
}
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
export function dateMs(s) {
  const m = ISO_DAY.exec(String(s || '').trim())
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const d = new Date(ms)
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ms : null
}
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// ── saved chart templates (the member's own, pref chart_templates) ──
let TEMPLATES = []
export const templatesNow = () => TEMPLATES
function readTemplates(host) {
  const raw = host?.prefs?.read?.()?.chart_templates
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; TEMPLATES = Array.isArray(a) ? a.filter(t => t && t.name && t.settings) : [] } catch { TEMPLATES = [] }
  return TEMPLATES
}
const findTemplate = (name) => {
  const n = String(name || '').trim().toLowerCase()
  const hits = TEMPLATES.filter(t => String(t.name).trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0] : null
}

// What the chart draws from that is the MEMBER's, not the chart's (raw pref kept, so Undo restores an unset pref as unset).
function withMemberState(host, snap) {
  if (!snap) return null
  const prefs = host?.prefs?.read?.() || null
  const raw = prefs?.[VOL_PANE_PREF]
  return { ...snap, volPanePref: raw == null || raw === '' ? null : String(raw), volPanePct: paneVolumePct(prefs), prefsWritable: typeof host?.prefs?.write === 'function',
    // C1-165: the member's favourite drawing tools (the toolbar's ★, per browser — drawToolFavorites), as volPanePref is a member pref
    favoriteTools: readFavoriteTools() }
}

// ── target kind ─────────────────────────────────────────────────────────────
// `host.charts` is the workspace binding (agent/host.js) over every mounted
// ChartWidget's agent adapter.
// the top-level settings keys a change wrote (`preset` is bookkeeping every manual write stamps)
// AUDIT D1: against the EFFECTIVE settings before (mergeChartSettings of the stored blob): a chart still inheriting the seed
// (a null or partial blob) gets its defaults filled in by the first write, and those filled-in keys were not changed by it
function settingsKeysOf(item) {
  const was = mergeChartSettings(item?.before?.stored ?? null) || {}, now = item?.patch?.settings || {}
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(k => k !== 'preset' && !sameJson(was[k], now[k]))
}
const settingsOutside = (blob, keys) => Object.fromEntries(Object.entries(blob || {}).filter(([k]) => k !== 'preset' && !keys.includes(k)))
/** What a change's staleness is read from: only the fields it touched. */
function scopedFp(snap, item) {
  const p = item.patch
  return [
    // the ticker always: a chart showing another ticker now (its link group moved) is not the chart the change was made on
    'tf' in p ? snap.tf : '·', snap.symbol,
    'settings' in p ? settingsKeysOf(item).map(k => [k, snap.stored?.[k] ?? null]) : '·',
  ]
}
export const chartKind = {
  name: 'chart',
  source: 'charts',             // fix-nothing-on-workspace: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "Charts aren't available on this page — open Charts to change a chart.",
  empty: "There are no charts on this board yet.",
  list: (host) => (host?.charts?.list() || []).map(s => withMemberState(host, s)),
  read: (host, ref) => withMemberState(host, host?.charts?.read(ref) || null),
  // `replay`: the workspace's Replay Mode cutoff (W1-B B-06) — undefined when the host has none (then chart.replay refuses)
  stateOf: (snap) => ({ cs: snap.cs, tf: snap.tf, symbol: snap.symbol, drawSym: snap.drawSym || snap.symbol, goto: null, replay: snap.replay,
    watermarkPos: snap.watermarkPos ?? null, volPanePref: snap.volPanePref ?? null, volPanePct: snap.volPanePct, prefsWritable: !!snap.prefsWritable,
    canvasTheme: snap.canvasTheme ?? null, view: snap.view ?? null, viewDo: null, favoriteTools: snap.favoriteTools || [],
    // C1-127: the chart's own Chart Settings door — may it open here (absent = no door: false), and is it open now
    canOpenSettings: snap.canOpenSettings === true, settingsOpen: !!snap.settingsOpen, openSettings: null,
    // C1-178: the right-click "Ask AI about {sym}" door (absent = none)
    canAskAi: snap.canAskAi === true, askAi: null,
    // chartFeatures.*: the widget's Company Info panel / Earnings Strip as ChartWidget's normalizeDock reads them (null = this
    // chart has no dock here: a Multi Chart cell, a pop-out); `dockTabs` = the chart tabs that share it (it is per WIDGET)
    canDock: snap.canDock === true, dock: snap.canDock === true ? normalizeDock(snap.dock) : null, dockTabs: snap.dockTabs || 1 }),
  patch(before, after) {
    const p = {}
    if (after.cs !== before.cs) p.settings = after.cs
    if (after.tf !== before.tf) p.tf = after.tf
    if (after.symbol !== before.symbol) p.symbol = after.symbol
    if (after.goto != null) p.goto = after.goto
    if (after.replay !== before.replay) p.replay = after.replay ?? null
    if (after.watermarkPos !== before.watermarkPos) p.watermarkPos = after.watermarkPos
    if (after.volPanePref !== before.volPanePref) p.volPanePref = after.volPanePref
    if (after.favoriteTools !== before.favoriteTools) p.favoriteTools = after.favoriteTools
    if (after.viewDo != null) p.viewDo = after.viewDo
    if (after.openSettings === true) p.openSettings = true
    if (after.askAi === true) p.askAi = true
    // chartFeatures.*: a dock the product's transforms changed (they hand back the SAME object when nothing changes)
    if (after.dock !== before.dock) p.dock = after.dock
    return Object.keys(p).length ? p : null
  },
  // Settings / timeframe / ticker in ONE write through the widget; a date jump (a VIEW) through
  // the Time Navigator's own goToDate, then wait for the view to arrive (a jump past the loaded
  // history loads it first) — the receipt only claims what the chart then shows.
  async commit(host, ref, patch) {
    const { goto, replay, volPanePref, viewDo, openSettings, askAi, favoriteTools, ...rest } = patch
    let ok = true
    if (Object.keys(rest).length) ok = host.charts.commit(ref, rest)
    // The drag's own pref (setPref → true only once the server accepted it); '' clears it, as Reset does (ChartsWorkspace)
    if ('volPanePref' in patch && ok) {
      if (!await host.prefs.write(VOL_PANE_PREF, volPanePref ?? '')) throw new Error('the server did not confirm the change, so it is not saved')
      const t0 = Date.now()
      while (Date.now() - t0 < 2000 && (chartKind.read(host, ref)?.volPanePref ?? null) !== (volPanePref ?? null)) await new Promise(r => setTimeout(r, 50))
    }
    // C1-165: the toolbar's ★ writer (drawToolFavorites.writeFavoriteTools — it tells every mounted toolbar); true once storage holds it
    if ('favoriteTools' in patch && ok && !writeFavoriteTools(favoriteTools)) throw new Error('this browser did not keep the change (its storage is blocked), so nothing is saved')
    // Replay Mode: ChartsWorkspace's own startReplay / exitReplayMode (a VIEW on every linked chart; nothing is saved)
    if ('replay' in patch && ok) ok = !!host.charts.setReplay?.(replay)
    // The chart's own view control; a long range may load history first (its "Loading chart history…", capped at 6s)
    if (viewDo && ok) {
      if (!host.charts.viewDo?.(ref, viewDo.op, viewDo.arg)) return false
      const t0 = Date.now()
      while (Date.now() - t0 < 10000 && !viewDone(host.charts.read(ref)?.view, viewDo)) await new Promise(r => setTimeout(r, 100))
    }
    if (goto != null && ok) {
      if (!host.charts.goTo?.(ref, goto)) return false
      const t0 = Date.now()
      while (Date.now() - t0 < 10000) {
        if (viewAt(host.charts.read(ref)?.view, goto)) break
        await new Promise(r => setTimeout(r, 150))
      }
    }
    // C1-127: the chart's OWN Chart Settings dialog (the gear's openSettings), opened last — after anything else asked of
    // this chart — then read back from the pane: the receipt says "opened" only once it is open. It writes nothing.
    if (openSettings && ok) {
      if (!host.charts.openSettings?.(ref)) return false
      const t0 = Date.now()
      while (Date.now() - t0 < 2000 && !host.charts.read(ref)?.settingsOpen) await new Promise(r => setTimeout(r, 50))
    }
    // C1-178: the chart's own right-click "Ask AI about {sym}" (ChartWidget openAskAi → /research/:sym?section=ai). It leaves
    // Charts, so — as app.open — it runs AFTER the receipt is on screen (and from a hidden tab only once the member is back).
    // The door must be there now; what it opens is the chart's symbol at that moment, exactly as the menu item would.
    if (askAi && ok) {
      if (typeof host.charts.askAi !== 'function' || !host.charts.read(ref)?.canAskAi) return false
      setTimeout(() => whenVisible(() => host.charts.askAi(ref)), ASK_AI_DELAY_MS)
    }
    return ok
  },
  landed(snap, patch) {
    if (!snap) return false
    if ('settings' in patch && !sameJson(snap.stored, patch.settings)) return false
    if ('tf' in patch && snap.tf !== patch.tf) return false
    if ('symbol' in patch && snap.symbol !== patch.symbol) return false
    if ('goto' in patch && !viewAt(snap.view, patch.goto)) return false
    if ('replay' in patch && (snap.replay ?? null) !== patch.replay) return false
    if ('watermarkPos' in patch && !sameJson(watermarkSpot(snap.watermarkPos), watermarkSpot(patch.watermarkPos))) return false
    if ('volPanePref' in patch && (snap.volPanePref ?? null) !== (patch.volPanePref ?? null)) return false
    if ('favoriteTools' in patch && !sameJson(snap.favoriteTools, patch.favoriteTools)) return false
    if ('viewDo' in patch && !viewDone(snap.view, patch.viewDo)) return false
    if ('openSettings' in patch && !snap.settingsOpen) return false
    // chartFeatures.*: the widget's opts.dock read back exactly as written (an Undo's null = the key gone)
    if ('dock' in patch && !sameJson(snap.dock ?? null, patch.dock ?? null)) return false
    // C1-178: leaving the page happens after the receipt (app.open's rule): there is nothing on the chart to read back
    return true
  },
  undoPatch(item) {
    // C1-127: opening Chart Settings changed nothing, so on its own there is nothing to undo (chartSetup.openSettings,
    // undo 'none'); asked together with a real change, that change keeps its own Undo — the dialog is not part of it
    if ('openSettings' in item.patch && Object.keys(item.patch).length === 1) return null
    // C1-178: Ask AI opens a page; nothing on the chart changed, and leaving the page has no Undo (as app.open)
    if ('askAi' in item.patch && Object.keys(item.patch).length === 1) return null
    const p = {}
    if ('settings' in item.patch) p.settings = item.before.stored ?? null
    if ('tf' in item.patch) p.tf = item.before.tf
    if ('symbol' in item.patch) p.symbol = item.before.symbol
    // Undo a date jump = jump back to where the right edge was. When that edge was never read there
    // is no Undo for the change — and the receipt says why (chart.goToDate's undoNote, F6).
    if ('goto' in item.patch) { if (item.before.view?.rightMs == null) return null; p.goto = item.before.view.rightMs }
    // Undo a replay = the cutoff as it was (off → clear it: every bar is back)
    if ('replay' in item.patch) p.replay = item.before.replay ?? null
    if ('watermarkPos' in item.patch) p.watermarkPos = item.before.watermarkPos ?? null
    if ('volPanePref' in item.patch) p.volPanePref = item.before.volPanePref ?? null
    if ('favoriteTools' in item.patch) p.favoriteTools = item.before.favoriteTools || []
    // chartFeatures.*: the RAW opts.dock snapshot before (a removed panel's own width, the strip's height, its tab) — never a
    // transform's inverse: addFeature lands at the default width, so only the snapshot is exact
    if ('dock' in item.patch) p.dock = item.before.dock ?? null
    // A range goes back to the window and the view lock it replaced (never read = no Undo, and `undoNote` says so).
    // A reset has no way back: it also drops a dragged price scale, which nothing reads back (undo: 'none').
    if ('viewDo' in item.patch) {
      const { op } = item.patch.viewDo
      if (op === 'setIndicatorsHidden') p.viewDo = { op, arg: !!item.before.view?.indicatorsHidden }
      else if ((op === 'applyRange' || op === 'stepBar' || op === 'zoom') && item.before.view?.frame) p.viewDo = { op: 'restoreView', arg: item.before.view.frame }
      // the Position Calculator back to exactly what it showed before (closed stays closed, its old prices kept)
      else if (op === 'positionCalc' && item.before.view?.positionCalc) p.viewDo = { op, arg: { ...item.before.view.positionCalc } }
      // chartReplay.playback: the way back its plan worked out (none for play / pause, or for a replay that was playing)
      else if (op === 'replay' && item.patch.viewDo.back) p.viewDo = { op, ...item.patch.viewDo.back }
      else return null
    }
    return p
  },
  // ⭐ round 3 (pl-exec): Undo is FIELD-SCOPED. A change is stale only when what IT touched (its timeframe, its ticker, the
  // settings keys it changed) has moved since; a newer edit to anything else ("undo the timeframe change" after an RSI was
  // added) leaves it undoable, and the Undo writes back only those fields over the chart as it is now (undoPatchNow).
  undoPatchNow(item, cur) {
    const p = chartKind.undoPatch(item)
    if (!p || !('settings' in item.patch) || !cur) return p
    const keys = settingsKeysOf(item)
    const now = cur.stored ?? null
    // nothing else changed since: the exact blob it replaced (byte-exact, null included)
    if (sameJson(settingsOutside(now, keys), settingsOutside(item.patch.settings, keys))) return p
    const back = { ...(now || {}) }
    for (const k of keys) { if (item.before.stored && k in item.before.stored) back[k] = item.before.stored[k]; else delete back[k] }
    return { ...p, settings: back }
  },
  fingerprint: (snap) => JSON.stringify([snap.stored ?? null, snap.tf, snap.symbol]),
  // ⛔ F6: a date jump's Undo is stale once the member has moved the view since — scrolling back
  // would overwrite where they are now. Every other chart change ignores the view.
  fingerprintFor: (host, snap, item) => JSON.stringify([
    ...(item?.patch ? scopedFp(snap, item) : [snap.stored ?? null, snap.tf, snap.symbol]),
    ...('goto' in (item?.patch || {}) ? [snap.view?.rightMs ?? null] : []),
    // a replay's Undo is stale once the member changed the cutoff themselves (the Replay dialog)
    ...('replay' in (item?.patch || {}) ? [snap.replay ?? null] : []),
    // x/y, never the anchor the chart derives from them a moment later (derivedOpts.js)
    ...('watermarkPos' in (item?.patch || {}) ? [watermarkSpot(snap.watermarkPos)] : []),
    ...('volPanePref' in (item?.patch || {}) ? [snap.volPanePref ?? null] : []),
    // a ★ Undo is stale once the member starred or unstarred a tool themselves
    ...('favoriteTools' in (item?.patch || {}) ? [snap.favoriteTools || []] : []),
    // a panel / strip Undo is stale once the member changed the dock themselves (Add to Chart, the chevron, a tab, a drag)
    ...('dock' in (item?.patch || {}) ? [snap.dock ?? null] : []),
    // a range's Undo is stale once the member panned or zoomed off it
    // a step's Undo is stale once the member moved the window themselves (pan, zoom, another step)
    ...('viewDo' in (item?.patch || {}) ? [viewFp(snap, item.patch.viewDo.op, item.patch.viewDo)] : [])]),
  // ⛔ APPROVAL BINDING: before an approved chart change re-plans, the server's copy of this chart must
  // equal this tab's (another tab may have changed its settings — boardInSync does not see settings).
  // Unreadable, or no way to check → the approval fails closed.
  async refreshForApproval(host, ref) {
    if (typeof host?.widgetInSync !== 'function') return { ok: false, what: 'that chart' }
    const r = await host.widgetInSync(String(ref).split('~')[0])
    return r.ok ? { ok: true } : { ok: false, what: 'that chart', why: r.reason || null }
  },
  // A chart that does not exist yet (created earlier in the same request): the
  // product's defaults for a new chart, used ONLY to validate the plan before the
  // first write. The runtime re-plans against the real chart once it exists.
  virtual: ({ alias, n }) => ({
    ref: alias, label: `New chart ${n}`, position: null, symbol: null, tf: 'D',
    cs: mergeChartSettings(null), stored: null, linkedCount: 0, virtual: true,
  }),
  // A new chart given its OWN symbol must be created unlinked, or the symbol
  // would retarget every existing widget in the default link group.
  // …and when its ticker (and timeframe) are already known it is BORN on them
  // (handleAddWidget's unlinkedSymbol) — no default symbol is ever loaded first.
  createFlags: (ops) => {
    const sym = [...ops].reverse().find(o => o.action === 'chart.setSymbol')?.args?.symbol
    if (!sym) return {}
    const tf = [...ops].reverse().find(o => o.action === 'chart.setTimeframe')?.args?.timeframe || null
    // `complete`: the ticker and timeframe ARE everything asked of this chart, so once
    // it is born on them there is nothing left to commit through the mounted widget.
    const complete = ops.every(o => o.action === 'chart.setSymbol' || o.action === 'chart.setTimeframe')
    return { unlink: true, init: { symbol: String(sym).trim().toUpperCase(), tf }, complete }
  },
  // A chart born complete is verified from the workspace's own state (layout +
  // link-group ticker) instead of waiting for it to mount: mounting waits on market
  // data (PANEL_MOUNT_CAP), which says nothing about whether the configuration landed.
  verifyBorn: (host, ref, born) => {
    const c = host?.widgets?.configOf?.(ref)
    return !!c && c.color === 'N' && c.symbol === born.symbol && (!born.tf || c.tf === born.tf)
  },
}

// A whole-look write (restore defaults) with every indicator-owned key carried over from the chart as it
// is now. ⭐ A1.3: this IS the shared Restore — `keepIndicatorState` (indicatorPreservation.js,
// Indicators-owned), the call Chart Settings' own Reset makes: every indicator-owned top-level key AND
// `header.infoValues` (finding C5). Present keeps its value, absent stays absent (door SEVEN: a bulk write
// must never stamp indicatorInstances over what the member had). (chart.applyTemplate does not use this:
// it matches the click, which applies the template's indicators too — see chartTemplateApply.js.)
export function keepOwned(next, prev) {
  return keepIndicatorState(next, prev)
}

export function describeChart(snap, shortRef) {
  const cs = snap.cs || {}
  return {
    ref: shortRef, label: snap.label, position: snap.position || null,
    symbol: snap.symbol, timeframe: snap.tf, timeframeLabel: tfLabel(snap.tf),
    chartType: chartTypeOf(cs, snap.symbol), volume: volState(cs),
    background: cs.bgMode === 'gradient' ? 'gradient' : (cs.background || null),
    upColor: cs.candles?.upColor || null, downColor: cs.candles?.downColor || null,
    extendedHours: sessionOf(cs, snap.tf) === 'extended',
    scale: scaleOf(cs),
    linkedWidgets: snap.linkedCount || 0,
    // chartReplay.playback: only while this chart's bar replay (the Replay / Time Machine button) is on
    ...replayContext(snap.view?.replay),
    // the chart the member last clicked ("this chart" / "this stock"); omitted on every other chart
    ...(snap.selected ? { selected: true } : {}),
  }
}

const onCharts = (ctx) => ctx.surface === 'charts'

// ── fast-path phrases (agent/fastPath.js asks each capability) ──
// ── C1-011 (pl-exec round 5): the timeframe keys' repeat-press cycle, said — one rung up or down the SAME order the keys walk
// (keyboardShortcuts TF_ORDER), from the chart's own timeframe; the ends are said, never wrapped (a spoken step has no cycle) ──
const TF_STEPS = ['next', 'previous']
const stepTf = (tf, dir) => { const i = TF_ORDER.indexOf(String(tf)); if (i < 0) return null; const j = i + (dir === 'next' ? 1 : -1); return TF_ORDER[j] || null }
const stepRefusal = (tf, dir) => (TF_ORDER.indexOf(String(tf)) < 0 ? `This chart's ${tfLabel(tf)} timeframe isn't on the timeframe keys' ladder — say which timeframe you want.`
  : `${tfLabel(tf)} is already the ${dir === 'next' ? 'longest' : 'shortest'} timeframe on the keys' ladder.`)
// "up one timeframe", "next timeframe", "a timeframe higher" / "down a timeframe", "previous timeframe", "one timeframe lower"
const TF_STEP_WORDS = [
  [/^(?:(?:go|step|move|bump|jump|switch)(?: (?:it|this|this chart|the chart))? )?(?:up|higher)(?: (?:one|a|1))? time ?frames?(?: up)?$|^(?:the )?next time ?frame(?: up)?$|^(?:one|a) time ?frame (?:up|higher|longer)$/, 'next'],
  [/^(?:(?:go|step|move|drop|bump|jump|switch)(?: (?:it|this|this chart|the chart))? )?(?:down|lower)(?: (?:one|a|1))? time ?frames?(?: down)?$|^(?:the )?previous time ?frame$|^(?:one|a) time ?frame (?:down|lower|shorter)$/, 'previous'],
]
const TF_WORDS = [
  [/^(1|one)\s*(m|min|mins|minute|minutes)$/, '1'],
  [/^(5|five)\s*(m|min|mins|minute|minutes)$/, '5'],
  [/^(15|fifteen)\s*(m|min|mins|minute|minutes)$/, '15'],
  [/^(30|thirty)\s*(m|min|mins|minute|minutes)$/, '30'],
  [/^(60\s*(m|min|mins|minute|minutes)|1\s*(h|hr|hour)|one hour|hourly)$/, '60'],
  [/^(d|1d|day|daily)$/, 'D'],
  [/^(w|1w|week|weekly)$/, 'W'],
  [/^(mo|1mo|month|monthly)$/, 'M'],
]
const TYPE_WORDS = [
  [/^(candles?|candlesticks?|candlestick chart|candle chart)$/, 'candles'],
  [/^(hollow|hollow candles?|hollow candlesticks?)$/, 'hollow'],
  [/^(bars?|bar chart|ohlc|ohlc bars?)$/, 'bars'],
  [/^(hlc|hlc bars?)$/, 'hlc'],
  [/^(line|line chart)$/, 'line'],
  [/^(area|area chart)$/, 'area'],
]
const firstMatch = (table, s) => { for (const [re, v] of table) if (re.test(s)) return v; return null }

// ── capabilities ────────────────────────────────────────────────────────────
const CAPABILITIES = [
  {
    name: 'chart.setType',
    summary: 'Change how price is drawn on one chart.',
    args: { type: 'object', properties: { type: { type: 'string', enum: CHART_TYPE_IDS } }, required: ['type'], additionalProperties: false },
    check(st, { type }) {
      if (!TYPE_LABEL[type]) return `“${type}” is not a chart type UCT has.`
      const { econ, cap } = capabilityFor(st.symbol)
      if (econ) return `${st.symbol} is an economic series; it always draws in its own style.`
      if (cap && primaryChartTypeFor(type, cap) !== type) return `${st.symbol} can't be drawn as ${chartTypeLabel(type)} — it has no open/high/low data.`
      return null
    },
    fast: ({ core }) => { const type = firstMatch(TYPE_WORDS, core); return type ? { type } : null },
    apply: (st, { type }) => (chartTypeOf(st.cs, st.symbol) === type ? st : { ...st, cs: set(st.cs, { [typeKeyOf(st.symbol)]: type }) }),
    describe: (b, a) => (chartTypeOf(b.cs, b.symbol) === chartTypeOf(a.cs, a.symbol) ? null : `Changed chart to ${chartTypeLabel(chartTypeOf(a.cs, a.symbol))}`),
    noop: (b, a) => `Already ${chartTypeLabel(chartTypeOf(a.cs, a.symbol))}`,
  },
  {
    name: 'chart.setTimeframe',
    summary: "Change one chart's timeframe.",
    hints: '1/5/15/30/60 min, D, W, M; next/previous: one rung.',
    args: { type: 'object', properties: { timeframe: { type: 'string', enum: [...CHART_TIMEFRAMES, ...TF_STEPS] } }, required: ['timeframe'], additionalProperties: false },
    check(st, { timeframe: raw }) {
      if (TF_STEPS.includes(raw) && !stepTf(st.tf, raw)) return stepRefusal(st.tf, raw)
      const timeframe = TF_STEPS.includes(raw) ? stepTf(st.tf, raw) : raw
      if (!TF_LABEL[timeframe]) return `“${timeframe}” is not a timeframe UCT charts.`
      if (isIntraday(timeframe) && !hasIntradayBars(st.symbol)) return `${st.symbol} has daily, weekly and monthly data only.`
      return null
    },
    fast: ({ core }) => {
      const step = TF_STEP_WORDS.find(([re]) => re.test(core))
      if (step) return { timeframe: step[1] }
      const timeframe = firstMatch(TF_WORDS, core)
      return timeframe ? { timeframe } : null
    },
    apply: (st, { timeframe: raw }) => { const timeframe = TF_STEPS.includes(raw) ? stepTf(st.tf, raw) : raw; return st.tf === timeframe ? st : { ...st, tf: timeframe } },
    describe: (b, a) => (b.tf === a.tf ? null : `Switched timeframe to ${tfLabel(a.tf)}`),
    noop: (b, a) => `Already ${tfLabel(a.tf)}`,
  },
  {
    name: 'chart.setSymbol',
    summary: 'Show a different ticker on one chart. Widgets linked to the same color group follow, exactly as a manual symbol search does.',
    args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
    // "$NVDA", or chart|open|show|load|pull up + an UPPERCASE ticker in the RAW
    // text (so "show volume" can never read as the ticker VOLUME).
    fast: ({ raw: said, host }) => {
      // Phase 2: the VERB may be capitalised ("Open NVDA") and "on the main chart" adds nothing on a
      // one-chart board (several charts → the orchestrator asks which). The TICKER keeps its case.
      // Only these verbs ("Chart SPY." is left exactly as before — it may mean a NEW chart).
      const VERB = /^(Open|Show|Load|Pull up|Switch to|Go to)\b/
      const raw = VERB.test(said)
        ? String(said).replace(VERB, w => w.toLowerCase())
          .replace(/\s+(?:on|in|to)\s+(?:the|my|this)\s+(?:main |active |current )?chart[.!]?$/i, '').replace(/[.!]$/, '')
        : String(said).replace(/\s+(?:on|in|to)\s+(?:the|my|this)\s+(?:main |active |current )?chart$/i, '')
      // An explicit "symbol/ticker to X" may be lowercase: the noun removes the
      // ambiguity that keeps "show volume" from ever reading as a ticker.
      const named = /^(?:change|switch|set)\s+(?:the\s+)?(?:symbol|ticker)\s+to\s+\$?([A-Za-z][A-Za-z0-9.]{0,9})$/i.exec(raw)
      const m = /^\$([A-Za-z][A-Za-z0-9.]{0,9})$/.exec(raw)
        || /^(?:chart|open|show|load|pull up|put|switch to|go to|(?:change|flip|switch)(?: it| this| that| the chart| this chart| my chart)? to)\s+\$?([A-Z][A-Z0-9.]{0,9})$/.exec(raw)
        || named
      // ⛔ "change the ticker to it" / "$" aside, a pronoun is never a ticker (nl/tickers.js)
      const typed = m && raw.includes(`$${m[1]}`) ? `$${m[1]}` : m?.[1]   // "$IT" is explicitly a ticker
      // "show YTD" is a range, not a ticker: the request goes on to the model. "$YTD" and "change the ticker to YTD" say ticker.
      if (m) return !isPronounToken(typed, said) && (named || !isReservedWord(typed)) ? { symbol: m[1].toUpperCase() } : null
      // NL N4: a LOWERCASE ticker after a chart verb ("pull up nvda", "chart amd") — only a word UCT
      // does not know (nor a typo of one) and never a pronoun; prepare then asks the ticker search
      // whether it exists (or is an exact company name). "switch to weekly" stays a timeframe.
      // ⭐ PHASE 3: "change the bottom right to amd" — the position is lifted off first (fastPath.extractTarget), leaving
      // "change to amd"; the same N4 rule decides the word ("change to weekly" stays a timeframe)
      const low = /^(?:chart|pull up|bring up|load|switch to|put up|(?:change|flip|switch)(?: it| this| that| the chart| this chart| my chart)? to)\s+([a-z][a-z0-9.]{0,9})$/.exec(raw)
      return low && plainSymbolWord(low[1], host, said) ? { symbol: low[1].toUpperCase() } : null
    },
    // Async lookup BEFORE planning: an unknown ticker is refused, never charted blank. NL N4: a symbol
    // that is not a ticker is tried ONCE as an exact company name through the same ticker search
    // ("NVIDIA" → NVDA); several companies → the member is asked; none → refused. Never a guess.
    // Symbols that came from UCT itself (`trusted`: a screen's results, a saved
    // list's rows) are not looked up again.
    async prepare(ops) {
      const syms = ops.filter(o => !o.trusted).map(o => String(o.args?.symbol || '').trim().toUpperCase()).filter(Boolean)
      if (!syms.length) return {}
      const unknown = await unknownSymbols(syms)
      if (!unknown.size) return { unknownSymbols: unknown }
      const g = await groundSymbols([...unknown])
      return { unknownSymbols: g.unknown, ambiguousSymbols: g.ambiguous, namedSymbols: g.named }
    },
    check(st, { symbol }, env) {
      const s = String(symbol || '').trim().toUpperCase()
      if (!s) return 'Which ticker?'
      if (env?.ambiguousSymbols?.has(s)) return `“${String(symbol).trim()}” could be ${candidatesText(s)} — which one? Say the ticker.`
      if (env?.namedSymbols?.has(s)) return null                       // an exact company name → its one ticker
      if (!/^[A-Z0-9.$:^_\-/]{1,24}$/.test(s)) return `“${symbol}” doesn't look like a ticker.`
      if (env?.unknownSymbols?.has(s)) return `UCT has no symbol “${s}”.${suggestionText(s)}`
      return null
    },
    apply(st, { symbol }) {
      const s = resolvedTicker(symbol)
      if (st.symbol === s) return st
      // Parity with ChartWidget.handleSymbolChange: a new ticker abandons the
      // "group only" compare view and its overlays.
      const cs = st.cs?.compareHideBase ? set(st.cs, { compareHideBase: false, comparisonSymbols: [] }) : st.cs
      return { ...st, cs, symbol: s }
    },
    describe(b, a, args, env) {
      if (b.symbol === a.symbol) return null
      const n = env?.target?.linkedCount || 0
      // NL N4: a company name resolved to its ticker is named in the receipt
      const g = groundingOf(args?.symbol)
      const sym = g?.kind === 'name' ? `${a.symbol} (${g.name})` : a.symbol
      return n > 0 ? `Changed symbol to ${sym} (and ${n} linked widget${n === 1 ? '' : 's'})` : `Changed symbol to ${sym}`
    },
    noop: (b, a) => `Already showing ${a.symbol}`,
  },
  {
    name: 'chart.setSession',
    summary: 'Show or hide pre/post-market (extended hours) on one chart.',
    args: { type: 'object', properties: { mode: { type: 'string', enum: ['regular', 'extended'] } }, required: ['mode'], additionalProperties: false },
    fast: ({ lower, core }) => {
      for (const s of [lower, core]) {
        if (/^(show |turn on |include )?(extended hours|extended|ext hours|extended trading|pre ?\/ ?post)( on)?$/.test(s)) return { mode: 'extended' }
        if (/^(hide extended hours|extended hours off|ext hours off|regular hours( only)?|regular session|rth( only)?)$/.test(s)) return { mode: 'regular' }
      }
      return null
    },
    // The SAME eligibility as the manual toggle (ChartPane → ChartIdentityRow): economic-data
    // charts have no session control at all, and on D/W/M "Include pre/post-market" is DISABLED
    // outside the pre/post window (ChartPane's `extEnabled`, from getExtSessionCached()). The
    // Agent refuses exactly where the button is disabled, instead of writing a state the member
    // could not have chosen.
    check(st, { mode }) {
      if (mode !== 'regular' && mode !== 'extended') return `“${mode}” is not a session.`
      if (st.symbol && isEconomicId(st.symbol)) return 'Economic-data charts have no regular/extended session setting.'
      if (mode === 'extended' && !isIntraday(st.tf) && sessionOf(st.cs, st.tf) !== 'extended' && !extWindowOpen()) {
        return 'On daily, weekly and monthly charts “Include pre/post-market” is only available during pre-market and post-market — the same as the chart’s own toggle. Try again then, or switch this chart to an intraday timeframe.'
      }
      return null
    },
    apply(st, { mode }) {
      if (sessionOf(st.cs, st.tf) === mode) return st
      // The key the manual toggle for THIS timeframe writes: ChartPane.setExtHours
      // on intraday, ChartPane.setSessionView on D/W/M.
      return { ...st, cs: set(st.cs, isIntraday(st.tf) ? { extendedHoursShading: mode === 'extended' } : { sessionView: mode }) }
    },
    describe(b, a) {
      if (sessionOf(b.cs, a.tf) === sessionOf(a.cs, a.tf) && b.cs === a.cs) return null
      return sessionOf(a.cs, a.tf) === 'extended' ? 'Showing extended hours' : 'Showing regular hours only'
    },
    noop: (b, a) => (sessionOf(a.cs, a.tf) === 'extended' ? 'Already showing extended hours' : 'Already regular hours only'),
  },
  {
    name: 'chart.setScale',
    summary: "Set one chart's price scale: linear (arithmetic), logarithmic, or percent.",
    args: { type: 'object', properties: { scale: { type: 'string', enum: ['linear', 'log', 'percent'] } }, required: ['scale'], additionalProperties: false },
    fast: ({ core }) => {
      if (/^(log|log scale|logarithmic|logarithmic scale)$/.test(core)) return { scale: 'log' }
      if (/^(linear|linear scale|arithmetic|arithmetic scale|arith)$/.test(core)) return { scale: 'linear' }
      if (/^(percent scale|percentage scale|% scale)$/.test(core)) return { scale: 'percent' }
      return null
    },
    check(st, { scale }) {
      if (!SCALE_LABEL[scale]) return `“${scale}” is not a price scale.`
      // StockChart forces percent while any "new scale" comparison is on
      // (compareForcesPct) — a receipt must never claim a scale the chart won't show.
      const forcing = (st.cs.comparisonSymbols || []).some(c => c && c.enabled && c.sym && (c.scaleMode || 'new') !== 'same')
      if (forcing && scale !== 'percent') return 'Compare overlays keep this chart on a percent scale — remove them first.'
      return null
    },
    // The exact keys StockChart.setScale (the A/L/% toggle) persists.
    apply: (st, { scale }) => (scaleOf(st.cs) === scale ? st
      : { ...st, cs: set(st.cs, { logScale: scale === 'log', percentScale: scale === 'percent' }) }),
    describe: (b, a) => (scaleOf(b.cs) === scaleOf(a.cs) ? null : `Changed scale to ${SCALE_LABEL[scaleOf(a.cs)]}`),
    noop: (b, a) => `Already on a ${SCALE_LABEL[scaleOf(a.cs)].toLowerCase()} scale`,
  },
  {
    name: 'chart.applyTheme',
    summary: "Apply one of UCT's built-in chart color themes (canvas, candles, grid, text) to one chart.",
    args: { type: 'object', properties: { theme: { type: 'string', enum: CHART_THEMES.map(t => t.id) } }, required: ['theme'], additionalProperties: false },
    // "cream theme" / "apply the nord theme" — only a real chart-theme id or name.
    fast: ({ core }) => {
      const m = /^(?:apply\s+)?(?:the\s+)?(.+?)\s+(?:chart\s+)?theme$/.exec(core)
      if (!m) return null
      const want = m[1].trim().toLowerCase()
      const hit = CHART_THEMES.find(t => t.id === want || t.name.toLowerCase() === want)
      return hit ? { theme: hit.id } : null
    },
    check: (st, { theme }) => (CHART_THEME_BY_ID[theme] ? null : `UCT has no chart theme “${theme}”.`),
    // The SAME function Chart Settings -> theme gallery -> 'this chart' calls (app-mirrored themes use the app surface).
    apply: (st, { theme }) => ({ ...st, cs: applyThemeToOneChart(st.cs, CHART_THEME_BY_ID[theme]) }),
    describe: (b, a, { theme }) => `Applied the ${CHART_THEME_BY_ID[theme]?.name || theme} chart theme`,
  },
  {
    name: 'chart.setBackground',
    summary: "Set one chart's background to a single solid color.",
    hints: 'Pass a hex color like #f3efe4; translate plain color names to hex.',
    args: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false },
    // "background to black" / "change the background to #f3efe4" — only a color
    // that normalizes; anything else goes to the model.
    fast: ({ core }) => {
      const m = /^(?:the\s+)?(?:background|bg|background color|canvas)\s+(?:to\s+|=\s*)?(.+)$/.exec(core)
      return m && normalizeColor(m[1]) ? { color: m[1].trim() } : null
    },
    check: (st, { color }) => (normalizeColor(color) ? canvasLock(st.cs, st.canvasTheme) : `“${color}” isn't a color I can set — use a hex value like #f3efe4.`),
    apply(st, { color }) {
      const c = normalizeColor(color)
      if (st.cs.background === c && st.cs.bgMode !== 'gradient') return st
      return { ...st, cs: set(st.cs, { background: c, bgMode: 'solid' }) }
    },
    describe: (b, a) => (b.cs.background === a.cs.background && b.cs.bgMode === a.cs.bgMode ? null : `Changed background to ${colorName(a.cs.background)}`),
    noop: (b, a) => `Background is already ${a.cs.background}`,
  },
  {
    name: 'chart.setCandleColors',
    summary: "Set one chart's up and/or down candle colors.",
    hints: 'Hex colors; pass null for a side that should not change.',
    args: { type: 'object', properties: { up: { type: ['string', 'null'] }, down: { type: ['string', 'null'] } }, required: ['up', 'down'], additionalProperties: false },
    check(st, { up, down }) {
      if (up == null && down == null) return 'Which candle color?'
      if (up != null && !normalizeColor(up)) return `“${up}” isn't a color I can set.`
      if (down != null && !normalizeColor(down)) return `“${down}” isn't a color I can set.`
      return canvasLock(st.cs, st.canvasTheme, ['sunrise'])
    },
    apply(st, { up, down }) {
      const c = { ...(st.cs.candles || {}) }
      const u = up != null ? normalizeColor(up) : null
      const d = down != null ? normalizeColor(down) : null
      if ((!u || c.upColor === u) && (!d || c.downColor === d)) return st
      if (u) Object.assign(c, { upColor: u, upBorder: u, upWick: u, oneColor: u })
      if (d) Object.assign(c, { downColor: d, downBorder: d, downWick: d })
      return { ...st, cs: set(st.cs, { candles: c }) }
    },
    describe(b, a) {
      const out = []
      if (b.cs.candles?.upColor !== a.cs.candles?.upColor) out.push(`up candles to ${a.cs.candles.upColor}`)
      if (b.cs.candles?.downColor !== a.cs.candles?.downColor) out.push(`down candles to ${a.cs.candles.downColor}`)
      return out.length ? `Changed ${out.join(' and ')}` : null
    },
    noop: () => 'Candle colors already set',
  },
  {
    name: 'volume.setState',
    summary: "Show, hide, or remove one chart's built-in Volume pane.",
    hints: '"hide volume" is hidden (stays in the legend); "remove volume" is removed (off the chart).',
    args: { type: 'object', properties: { state: { type: 'string', enum: ['visible', 'hidden', 'removed'] } }, required: ['state'], additionalProperties: false },
    fast: ({ lower }) => {
      const m = /^(hide|show|remove|delete|turn off|turn on|unhide)\s+(the\s+)?volume( pane)?$/.exec(lower) || /^volume\s+(off|on)$/.exec(lower)
      if (!m) return null
      const v = m[1]
      return { state: v === 'hide' || v === 'turn off' || v === 'off' ? 'hidden' : (v === 'remove' || v === 'delete') ? 'removed' : 'visible' }
    },
    check: (st, { state }) => (['visible', 'hidden', 'removed'].includes(state) ? null : `“${state}” is not a Volume state.`),
    apply(st, { state }) {
      if (volState(st.cs) === state) return st
      const v = { ...(st.cs.volume || {}) }
      if (state === 'visible') { v.visible = true; v.removed = false }
      else if (state === 'hidden') { v.visible = false; v.removed = false }
      else v.removed = true
      return { ...st, cs: set(st.cs, { volume: v }) }
    },
    describe(b, a) {
      const now = volState(a.cs)
      if (volState(b.cs) === now) return null
      return now === 'visible' ? 'Showed Volume' : now === 'hidden' ? 'Hid Volume' : 'Removed Volume'
    },
    noop: (b, a) => ({ visible: 'Volume is already showing', hidden: 'Volume is already hidden', removed: 'Volume is already removed' })[volState(a.cs)],
  },  {
    // ── chart.setSetting: ONE capability over the product's own descriptor table ──
    // Only rows classified `agent: 'eligible'` in components/chart/chartSettingsDescriptors.js
    // are offered (the id enum is generated from that table); the value is typed and validated
    // by the descriptor; the write is the descriptor's `withSetting` — the same shape Chart
    // Settings' own setters produce — committed through the chart's normal onOptsChange path,
    // read back, and undoable like every other chart change. A UI prerequisite (thin bars only
    // on Bars/HLC) refuses exactly where the dialog hides the control.
    name: 'chart.setSetting',
    summary: 'Change one chart display setting from UCT\'s approved list (grid, crosshair, scale text, legend, watermark, labels, event/IPO markers, dark-pool levels, swing labels, prev-day lines, countdown, title, color mode, thin bars, inverted scale, gradient background, Volume pane look, Heikin Ashi, Chart IQ, position calculator, Info row / Bar info fields).',
    hints: SETTING_HINTS,
    args: { type: 'object', properties: {
      setting: { type: 'string', enum: [...ELIGIBLE_SETTINGS.map(d => d.id), ...LIST_SETTINGS.map(l => l.id)] },
      value: { type: ['string', 'number', 'boolean'] },
    }, required: ['setting', 'value'], additionalProperties: false },
    fast: ({ lower, core }) => fastSetting(lower) || fastSetting(core),
    // W1.1 R-01 (LT-3): what the live planner sent for the promoted rows — a differently named key for `setting`
    // (the value's own typing — "off", "90%" — is read by coerceSettingValue, as the dialog reads it)
    argAliases: { setting: ['key', 'id', 'name', 'option', 'settingId', 'setting_id', 'path', 'property'] },
    shape: 'args {"setting": <one id from the list>, "value": …} — "turn the gradient off" = {"setting":"bgMode","value":"solid"}, '
      + '"gradient on" = {"setting":"bgMode","value":"gradient"}, "hide the grid" = {"setting":"grid.visible","value":false}. Never invent '
      + 'a setting id (no "bgGradient.enabled", no "background.gradient"): an on/off wish for a setting not listed is unsupported.',
    check(st, { setting, value }) {
      const l = listSetting(setting)
      if (l) return listMember(l, value).why || null
      const d = settingDescriptor(setting)
      if (!d || d.agent !== 'eligible') return `“${setting}” isn't a chart setting UCT Agent can change.`
      const v = coerceSettingValue(d, d.type === 'color' ? (normalizeColor(value) || value) : value)
      if (!v.ok) return `${d.label}: ${v.why}.`
      if (d.store === 'volumePanePref' && !st.prefsWritable) return 'I can\'t reach your saved Volume pane height from here.'
      return settingUnavailable(d, st.cs, { canvasTheme: st.canvasTheme }) || d.refuseValue?.(v.value) || null
    },
    apply(st, { setting, value }) {
      const l = listSetting(setting)
      if (l) {
        const { member, on } = listMember(l, value)
        if (l.read(st.cs).includes(member.value) === on) return st
        return { ...st, cs: l.write(st.cs, member.value, on) }
      }
      const d = settingDescriptor(setting)
      const v = coerceSettingValue(d, d.type === 'color' ? (normalizeColor(value) || value) : value).value
      if (sameJson(readSetting(st, d), v)) return st
      return writeSetting(st, d, v)
    },
    describe(b, a, { setting }) {
      const l = listSetting(setting)
      if (l) {
        const was = l.read(b.cs), now = l.read(a.cs)
        if (sameJson(was, now)) return null
        const added = now.filter(k => !was.includes(k)), gone = was.filter(k => !now.includes(k))
        return `${l.label}: ${[...added.map(k => `added ${listWord(l, [k])}`), ...gone.map(k => `removed ${listWord(l, [k])}`)].join(', ')} — it shows ${listWord(l, now)}`
      }
      const d = settingDescriptor(setting)
      const now = readSetting(a, d)
      if (sameJson(readSetting(b, d), now)) return null
      return `${d.label}: ${settingWord(d, now)}${d.scope === 'member' ? ' (this applies to all your charts)' : ''}${settingHiddenNote(d, a.tf, now)}`
    },
    noop: (b, a, { setting, value } = {}) => {
      const l = listSetting(setting)
      if (l) { const r = listMember(l, value); return r.member ? `${l.label} ${r.on ? 'already shows' : "doesn't show"} ${r.member.label}` : 'Already set' }
      const d = settingDescriptor(setting)
      return d ? `${d.label} is already ${settingWord(d, readSetting(a, d))}` : 'Already set'
    },
  },
  {
    // ── chart.applyTemplate: EXACTLY what clicking a saved template does ──
    // (Chart Settings → Templates, and right-click → Chart template). All three doors call the
    // ONE shared apply, `chartTemplateSettings` (chartTemplateApply.js): the template's whole
    // saved settings, its indicators included. Integrator ruling 2026-10-11 (owner delegated):
    // one behaviour, the one members already know from clicking; parity is asserted in
    // agentChartTemplateParity.test.jsx. A whole-chart change, so it is always proposed, and
    // Undo restores the chart exactly as it was, indicators included.
    name: 'chart.applyTemplate',
    risk: 'confirm',
    summary: "Apply one of the member's saved chart templates to ONE chart, exactly as clicking it does (Chart Settings → Templates, or right-click → Chart template): the chart takes the template's whole saved setup, its indicators included.",
    hints: 'template = a name from chartTemplates, exactly. For several charts ("all my charts"), one op per chart.',
    args: { type: 'object', properties: { template: { type: 'string' } }, required: ['template'], additionalProperties: false },
    // NL N2: a template name that is not exact but close ("swing setp") is HIGH-IMPACT (it replaces the
    // chart's indicators): never applied on a guess — the member is asked “Did you mean …?” with the
    // real name(s); their pick fills `template` and the plan continues (useAgent's pickArg flow).
    resolveArgs({ template }) {
      if (findTemplate(template)) return null
      const f = matchName(template, templatesNow().map(t => t.name))
      const names = f.kind === 'fuzzy' ? [f.name] : f.kind === 'several' ? f.names : []
      if (!names.length) return null
      return { ask: { arg: 'template', text: names.length === 1 ? `Did you mean your template “${names[0]}”?` : `Which template — ${names.map(n => `“${n}”`).join(' or ')}?`, choices: names.map(n => ({ ref: n, label: n })) } }
    },
    check: (st, { template }) => (findTemplate(template) ? null
      : templatesNow().length ? `You have no chart template named “${template}” (you have: ${templatesNow().map(t => t.name).slice(0, 8).join(', ')}).` : 'You have no saved chart templates yet — save one in Chart Settings → Templates.'),
    apply: (st, { template }) => ({ ...st, cs: chartTemplateSettings(findTemplate(template)) }),
    describe: (b, a, { template }) => (sameJson(b.cs, a.cs) ? null : `Applied your chart template “${findTemplate(template)?.name || template}” — its look and its indicators, as clicking it does: the indicators on this chart now are replaced by the template’s`),
    noop: () => 'The chart already looks exactly like that template',
  },
  {
    // ── chart.resetDefaults: Chart Settings' own "Restore defaults" (a clone of the LIVE
    // CHART_DEFAULTS), EXCEPT the indicator-owned keys, which stay exactly as the chart has them ──
    name: 'chart.resetDefaults',
    risk: 'confirm',
    summary: "Restore ONE chart's look to UCT's defaults (Chart Settings → Restore defaults): colours, markers, header, watermark and display settings. The chart's indicators are kept exactly as they are.",
    hints: 'target = the chart. Always shown as a proposal first.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check: () => null,
    apply: (st) => ({ ...st, cs: keepOwned(JSON.parse(JSON.stringify(CHART_DEFAULTS)), st.cs) }),
    describe: (b, a) => (sameJson(b.cs, a.cs) ? null : "Restored this chart's default look (your indicators are unchanged)"),
    noop: () => 'This chart already has the default settings',
  },
  {
    // ── chart.goToDate: the Time Navigator's jump (a VIEW; nothing is saved) ──
    name: 'chart.goToDate',
    summary: 'Scroll ONE chart so a past date is at its right edge — exactly the Time Navigator date box. A view change only: every bar stays on the chart (it is not a replay), nothing is saved; Undo scrolls back.',
    hints: 'date = YYYY-MM-DD. "As it looked on <date>" = this (say in the reply that later bars are still there, just scrolled off to the right).',
    args: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false },
    check(st, { date }) {
      const ms = dateMs(date)
      if (ms == null) return `“${date}” isn't a date — use YYYY-MM-DD.`
      if (ms < Date.UTC(1900, 0, 1)) return 'That date is earlier than any chart history.'
      if (ms > Date.now() + DAY_MS) return 'That date is in the future.'
      return null
    },
    // ⛔ F6: said on the receipt whenever this change came with no Undo (the earlier view was unknown)
    undoNote: "I couldn't read where the chart was scrolled before, so this can't be undone here — scroll the chart back, or jump to another date.",
    apply: (st, { date }) => ({ ...st, goto: dateMs(date) }),
    describe: (b, a) => (a.goto != null ? `Moved the view to ${fmtDay(a.goto)} — the right edge shows the last bar on or before it (view only; later bars are still there)` : null),
  },
  {
    // ── chart.replay (W1-B B-06): Tools → Replay Mode — the workspace's ONE shared cutoff (ChartsWorkspace replayCutoff,
    // StockChart's `replayCutoff` prop): every chart in the workspace hides the bars after it, linked or not. A VIEW: nothing is saved; the Replay
    // dialog's own startReplay / exitReplayMode write it; Undo puts the previous cutoff back (off → every bar is back).
    name: 'chart.replay',
    summary: 'Replay Mode (Tools → Replay): hide every bar after a date on the linked charts, as if it were that day — or exit replay (date null). A view only: nothing is saved; Undo clears it (or restores the previous cutoff).',
    hints: 'date = YYYY-MM-DD (or the member\'s date word: "last friday", "oct 15") for the cutoff; null = exit replay. "As of <date>" / "replay from <date>" / "go back to <date> and hide what came after" = this; "scroll to <date>" with every bar kept = chart.goToDate.',
    args: { type: 'object', properties: { date: { type: ['string', 'null'] } }, required: ['date'], additionalProperties: false },
    // W1.1 R-01 (LT-3, live "exit replay" refused as off-schema): the cutoff under another key, and the exit said as a word
    argAliases: { date: ['cutoff', 'to', 'until', 'day', 'at', 'as_of', 'asOf', 'replay_date', 'replayDate'] },
    // (W1.1 review NB-1: "none"/"nothing" are no longer null words for a string arg — replay declares them itself)
    coerce: { date: { exit: null, off: null, stop: null, end: null, false: null, clear: null, 'exit replay': null, none: null, nothing: null, nil: null } },
    // AUDIT #1174 ruling 1: an EXIT here writes every chart, so "exit / stop the replay" is decided from state with the bar
    // replay's (chartReplay.exitVerdict): only Replay Mode on → this; the bar replay on, or both → never this without its name
    fastWhole: true,
    fast: bareExitFast('cutoff'),
    resolveArgs: exitGuard(isCutoffExit, 'cutoff'),
    shape: '{"date":"YYYY-MM-DD"} to replay from a date; {"date":null} to EXIT replay ("exit replay", "leave replay", "replay off", '
      + '"show every bar again") — the JSON null, never the word "null" and never an "exit" or "enabled" key.',
    check(st, { date }) {
      if (st.replay === undefined) return 'Replay Mode isn\'t reachable from here.'
      if (date == null) return null
      const r = resolveDateWord(date)
      if (!r) return `I couldn\'t read “${date}” as a date — use YYYY-MM-DD or a day like “last Friday”.`
      if (r.future) return `${dayWord(r.to)} hasn\'t happened yet — replay only goes back.`
      if (isoDayMs(r.to) < Date.UTC(1900, 0, 1)) return 'That date is earlier than any chart history.'
      return null
    },
    apply(st, { date }) {
      const to = date == null ? null : resolveDateWord(date).to
      return (st.replay ?? null) === to ? st : { ...st, replay: to }
    },
    describe(b, a) {
      if ((b.replay ?? null) === (a.replay ?? null)) return null
      if (a.replay == null) return 'Exited Replay Mode — every bar is back on every chart'
      return `Replay Mode: every chart in this workspace shows bars up to ${dayWord(a.replay)} and hides what came after (a view only — nothing is saved; exit replay to see every bar again)`
    },
    noop: (b, a, { date } = {}) => (date == null ? 'Replay Mode is already off' : 'Replay is already at that date'),
  },
  {
    // ── chart.compare: the Compare Symbols panel's add / remove / clear (comparisonSymbols) ──
    // Entries are exactly the panel's: {sym, enabled:true, color: pickComparisonColor, scaleMode:'new'};
    // clear also leaves "Group only", and (as the open panel does) a percent scale is switched off.
    name: 'chart.compare',
    summary: 'Overlay other symbols on ONE chart (Tools → Compare Symbols): add tickers, remove some, or clear all comparisons.',
    hints: 'add = tickers to overlay, uppercase ([] for none); remove = tickers to take off ([] for none); clear = true to remove every comparison. "Compare NVDA against QQQ on this chart" = target the NVDA chart, add [QQQ].',
    args: { type: 'object', properties: {
      add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } }, clear: { type: 'boolean' },
    }, required: ['add', 'remove', 'clear'], additionalProperties: false },
    // (`trusted`: tickers UCT itself showed — a screen's rows, Gate C "compare it to the others" — are
    // not looked up again, exactly as chart.setSymbol; anything the member or the model typed still is)
    async prepare(ops) {
      const syms = ops.filter(o => !o.trusted).flatMap(o => (o.args?.add || []).map(x => String(x || '').trim().toUpperCase())).filter(Boolean)
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { add, remove, clear }, env) {
      const list = (add || []).map(x => String(x || '').trim().toUpperCase())
      if (!clear && !list.length && !(remove || []).length) return 'Which symbols should I compare?'
      const odd = list.find(x => !/^[A-Z0-9.$:^_\-/]{1,24}$/.test(x))
      if (odd) return `“${odd}” doesn't look like a ticker.`
      if (list.includes(String(st.symbol || '').toUpperCase())) return `The chart already shows ${st.symbol} — compare it against a different symbol.`
      const bad = list.find(x => env?.unknownSymbols?.has(x))
      if (bad) return `UCT has no symbol “${bad}”.`
      // ⛔ F5: the product's published ceiling (chartCeilings.MAX_COMPARISONS), counted on the RESULT —
      // after removals and duplicates. Never blocks a change that leaves fewer than the chart has now.
      const cur = Array.isArray(st.cs?.comparisonSymbols) ? st.cs.comparisonSymbols.length : 0
      const after = comparisonsAfter(st, { add, remove, clear }).length
      if (after > MAX_COMPARISONS && after > cur) return `A chart can compare at most ${MAX_COMPARISONS} symbols — this one would have ${after}. Remove some first.`
      return null
    },
    apply(st, { add, remove, clear }) {
      const list = comparisonsAfter(st, { add, remove, clear })
      const next = { ...st.cs, comparisonSymbols: list, preset: 'custom' }
      if (clear) next.compareHideBase = false
      if (list.length && next.percentScale) { next.percentScale = false; next.logScale = false }
      return sameJson(next.comparisonSymbols, st.cs?.comparisonSymbols ?? []) && !clear ? st : { ...st, cs: next }
    },
    describe(b, a) {
      const was = (b.cs?.comparisonSymbols || []).map(x => x.sym), now = (a.cs?.comparisonSymbols || []).map(x => x.sym)
      if (sameJson(was, now)) return null
      return now.length ? `Comparing ${a.symbol || 'this chart'} with ${now.join(', ')}` : 'Removed every comparison from this chart'
    },
    // ⛔ F5: the no-op says what was asked — "remove QQQ" when QQQ isn't compared is not "already there"
    noop: (b, a, args) => ((args?.add || []).length ? 'Those comparisons are already there'
      : (args?.remove || []).length ? 'None of those is being compared on this chart' : 'This chart has no comparisons'),
  },
  {
    // ── chart.addCustomTimeframe: the timeframe menu's "Custom interval" (ChartPane.addCustomTf):
    // the code joins header.customTimeframes and, when asked, the chart switches to it.
    name: 'chart.addCustomTimeframe',
    summary: 'Add a custom timeframe (e.g. 45 minutes, 2 hours, 3 days) to ONE chart\'s timeframe menu, exactly like the menu\'s Custom interval, and optionally switch the chart to it.',
    hints: 'unit = minutes | hours | days | weeks | months; count = how many (45 for 45 minutes); switch = true to show the chart on it now (the usual case), false to only add it to the menu.',
    args: { type: 'object', properties: {
      unit: { type: 'string', enum: ['minutes', 'hours', 'days', 'weeks', 'months'] }, count: { type: 'integer' }, switch: { type: 'boolean' },
    }, required: ['unit', 'count', 'switch'], additionalProperties: false },
    check(st, { unit, count }) {
      if (!Number.isInteger(count) || count < 1 || count > 999) return 'Give a whole number of units (1–999).'
      const code = makeTfCode(unit, count)
      if (!code || !isValidTf(code)) return `UCT can't chart a ${count}-${unit} timeframe.`
      return null
    },
    apply(st, { unit, count, switch: sw }) {
      const code = makeTfCode(unit, count)
      const hdr = st.cs?.header || {}
      const customs = Array.isArray(hdr.customTimeframes) ? hdr.customTimeframes : []
      let next = st
      if (!customs.includes(code)) next = { ...next, cs: { ...st.cs, header: { ...hdr, customTimeframes: [...customs, code] }, preset: 'custom' } }
      if (sw && st.tf !== code) next = { ...next, tf: code }
      return next
    },
    describe(b, a, { unit, count }) {
      const code = makeTfCode(unit, count)
      const added = !sameJson(b.cs?.header?.customTimeframes, a.cs?.header?.customTimeframes)
      const switched = a.tf !== b.tf
      if (!added && !switched) return null
      return `${added ? `Added a ${tfShort(code)} timeframe` : `Switched to ${tfShort(code)}`}${added && switched ? ' and switched the chart to it' : ''}`
    },
    noop: () => 'That timeframe is already in the menu',
  },
]

let registered = false
export function registerChartCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(chartKind)
  registerContextProvider({
    key: 'charts',
    build: (host, refFor) => chartKind.list(host).map(s => describeChart(s, refFor('chart', s.ref))),
  })
  registerContextProvider({
    key: 'chartTemplates',
    // The member's saved chart templates, by name (chart.applyTemplate).
    build: (host) => { const t = readTemplates(host); return t.length ? t.slice(0, 30).map(x => x.name) : undefined },
  })
  registerContextProvider({
    key: 'otherWidgets',
    build: (host) => host?.otherWidgets?.() || [],
  })
  for (const c of CAPABILITIES) registerCapability({ ...c, target: 'chart', surfaces: ['charts'], available: onCharts })
}
