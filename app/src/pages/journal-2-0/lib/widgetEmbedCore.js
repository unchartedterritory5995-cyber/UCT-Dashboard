// Journal Widgets — pure core for the widgetEmbed node: attr construction,
// slash-command arg parsing, and the render-path decision. NO React, NO
// TipTap — everything here is unit-testable data-in/data-out, and the node
// view / slash menu / capture paths all build on it.

import {
  widgetMeta, normalizeParams, validateParams, paramsPlainText, isReconstructable, asOfDayOf,
} from '../../../widgets/registry'
import { peekDrawings } from '../../../components/chart/drawingsStore'
import { notebookFlag } from './offline/notebookFlags'

/** Wave 13 lane 13H-2: the ONE client gate for the chart-plan doors -- the plan panel, bar
 *  replay, the weekly /mtf stack and /vs. It is 13H-1's flag, reused (never a second one):
 *  `NOTEBOOK_CHART_PLAN_ENABLED` on the server, latched per tab. Absent => OFF. */
export const CHART_PLAN_FLAG = 'notebook_chart_plan_enabled'
export const chartPlanEnabled = () => notebookFlag(CHART_PLAN_FLAG) === true

// ⭐ `ownChartSettings` is loaded ON FIRST STAMP, never statically. It merges
// through chartDefaults → nativeRegistry → the whole Pine engine, and a static
// import here put that engine on the Notebook's first open (NotebookTab →
// NoteEditorPage → here) and on every Journal page (AddPositionModal → here),
// where the promotion gate's first-open byte budget is measured. Nothing on
// those routes needs the engine until a chart is inserted, and the stamp is
// fire-and-forget into editor storage — so a lazy import costs nothing a member
// can see. `entryExcludesChartEngine.test.js` rails the Notebook's closure.
let _ownChart = null
let _ownChartLoad = null
function loadOwnChartSettings() {
  if (!_ownChartLoad) {
    _ownChartLoad = import('../../../components/chart/pane/ownChartSettings').then(
      (mod) => { _ownChart = mod; return mod },
      (err) => { _ownChartLoad = null; throw err }, // a failed load is retried next stamp
    )
  }
  return _ownChartLoad
}

// The embed document schema, v1 (see the plan doc: "expensive to change
// later"). Every stored notebook doc carries these attrs verbatim.
export const WIDGET_EMBED_VERSION = 1

let embedSeq = 0

/** A fresh identity for ONE embed node (Wave 4 chart identity).
 *
 *  ⛔ EVERY NODE GETS ITS OWN, AT BUILD. capturedAt is stamped per node build
 *  too, but every chart of one /mtf or /compare insert is built in the same
 *  millisecond, so `widgetId|capturedAt` names the whole insert, not one chart
 *  — a citation to one of them could not be told from its siblings (rereview2
 *  R2-1). This id is what lets Ask cite each chart exactly
 *  (askCitation.js::citationAtomIdentity, note_citation_text.py::_widget_identity).
 *
 *  ⛔ NOT `crypto.randomUUID` ALONE: it exists only in a SECURE CONTEXT, and a
 *  device reached over plain http (a LAN address, a tunnel) has no
 *  `randomUUID` at all — a bare call throws and every insert fails. It is used
 *  when present; otherwise time + a per-module counter + Math.random, which is
 *  not a secret and needs not be: it only has to differ from the other embeds
 *  of one note. The counter alone keeps two builds in one page apart. The
 *  fallback never contains '|', so it can never equal a legacy
 *  `widgetId|capturedAt` identity. */
export function newEmbedId() {
  try {
    const c = globalThis.crypto
    if (c && typeof c.randomUUID === 'function') {
      const id = c.randomUUID()
      if (typeof id === 'string' && id) return id
    }
  } catch { /* an insecure context can throw here too: fall through */ }
  embedSeq = (embedSeq + 1) % 0x7fffffff
  const r = () => Math.floor(Math.random() * 0x100000000).toString(36)
  return `e${Date.now().toString(36)}-${embedSeq.toString(36)}-${r()}${r()}`
}

/** Build a complete widgetEmbed attr set from a widget id + a loose capture.
 *  Normalizes params through the registry schema and derives searchText from
 *  the SAME params object at the only moment they change — the server-side
 *  serializer reads that stored line, so client and server can never drift. */
export function buildWidgetEmbedAttrs(widgetId, capture = {}, extra = {}) {
  const cap = { ...capture }
  // Frozen means ANCHORED. A chart capture arriving with NO `to` — the slash
  // and preset paths — gets the insert moment stamped, or the "snapshot"
  // fetches a today-ending window forever under a months-old caption (panel
  // finding, confirmed independently by two reviewers). `to: null` is the
  // explicit opt-out for the one deliberately rolling window (/compare's
  // "after · now" half — its caption says so).
  if (widgetId === 'chart' && cap.to === undefined) cap.to = Math.floor(Date.now() / 1000)
  const params = normalizeParams(widgetId, cap)
  return {
    v: WIDGET_EMBED_VERSION,
    widgetId,
    params,
    capturedAt: extra.capturedAt || new Date().toISOString(),
    // One per NODE, never carried over from a capture or another node: a
    // placed capture, a slash insert and each chart of /mtf are all new nodes.
    embedId: newEmbedId(),
    mode: extra.mode === 'live' ? 'live' : 'snapshot',
    fallback: extra.fallback || null,           // {url, w, h} once the archive lands
    tradeRef: extra.tradeRef || null,
    // Wave 3: j2_trades.id and j2_option_strategies.id are independent
    // uuid4 namespaces, so a bare tradeRef alone cannot safely identify
    // which table it names — every NEW write pairs it with the type the
    // caller already knows (see note_trade_links.py's resolver).
    tradeRefType: extra.tradeRef ? (extra.tradeRefType || null) : null,
    // A chart capture freezes a COPY of the symbol's /charts drawings (the
    // annotation layer renders the same ChartDrawingOverlay objects the global
    // store holds). One-way by design: journal edits land on the node's own
    // attrs, never back in the store. An explicit extra.annotations (recapture
    // paths carrying existing marks) always wins over the store read.
    annotations: Array.isArray(extra.annotations)
      ? extra.annotations
      : (widgetId === 'chart' && params.symbol ? peekDrawings(params.symbol) : []),
    caption: extra.caption || null,             // user free-text only; auto-caption derives at render
    layout: {
      width: extra.layout?.width === 'half' ? 'half' : 'full',
      // null = AUTO: the view derives height from its rendered width at the
      // chart page's aspect (embedRenderHeight), so an embed is proportioned
      // like a screenshot of the real chart instead of a full-chrome chart
      // crammed into a short box (owner feedback after first prod use).
      height: Number.isFinite(extra.layout?.height) ? extra.layout.height : null,
    },
    searchText: paramsPlainText(widgetId, params),
  }
}

/** Stamp the user's RESOLVED own-chart settings onto editor storage — the
 *  blob SlashMenu's /chart, /mtf and /compare commands freeze into typed
 *  inserts. Resolution rides ownChartSettings.js (named default widget →
 *  board scan → chart_settings seed → defaults) — the SAME order ChartPane
 *  renders by, so a typed insert and a widget-door capture can never look
 *  different. ⛔ Never stamp the bare chart_settings seed: it is only what an
 *  untouched widget starts from, and stamping it is how journal charts lost
 *  the user's MAs/legend/colors (chart-parity round). NoteEditorPage calls
 *  this whenever prefs land/change; never throws (storage not ready → the
 *  insert falls back to unset settings). The first stamp waits for the lazy
 *  settings module (see the loader above); once it is loaded every stamp is
 *  synchronous again. Stamps waiting on that first load share ONE promise, so
 *  they apply in call order and the newest prefs win (railed). Returns a
 *  promise that settles when this stamp is applied; it never rejects. */
export function stampChartSettings(editor, prefs) {
  if (!editor) return Promise.resolve()
  const apply = (mod) => {
    try {
      editor.storage.uctJournalWidgets = {
        ...(editor.storage.uctJournalWidgets || {}),
        chartSettings: mod.resolveOwnChartMergedSettings(prefs || {}),
      }
    } catch { /* storage not ready — the insert falls back to unset settings */ }
  }
  if (_ownChart) { apply(_ownChart); return Promise.resolve() }
  return loadOwnChartSettings().then(apply, () => { /* retried on the next stamp */ })
}

// Slash-command timeframe tokens → the tf codes the bars API speaks.
// Bare numbers pass through ('15' → '15'); '1h' and '60m' land on '60'.
const TF_TOKENS = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '60m': '60', '1h': '60',
  '1d': 'D', '1w': 'W', '1mo': 'M',
  h: '60', d: 'D', day: 'D', daily: 'D', w: 'W', week: 'W', weekly: 'W',
  mo: 'M', month: 'M', monthly: 'M',
}

export function parseTfToken(tok) {
  if (!tok) return null
  const raw = String(tok).trim()
  // Case decides month-vs-minute exactly like the chart's own labels ('1m'
  // one minute, '1M' one month) — resolve the ambiguous forms BEFORE
  // lowercasing. Panel finding: '/chart AMD 1M' silently inserted a
  // one-MINUTE chart, wrong evidence with a 60-day re-render lifespan.
  if (raw === 'M' || raw === '1M') return 'M'
  const t = raw.toLowerCase()
  if (TF_TOKENS[t]) return TF_TOKENS[t]
  if (/^\d+$/.test(t)) return t
  if (t === 'm') return 'M' // bare lowercase m: month (minutes are '1m' etc.)
  return null
}

const SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

/** Each trailing token after the symbol must claim exactly one unclaimed slot
 *  (tf or day, either order). Anything else → null: the strictness contract
 *  every slash parser shares ("/chart looks great here" parses as NOTHING). */
function parseTfDayTokens(tokens) {
  let tf = null
  let day = null
  for (const tok of tokens) {
    const asTf = parseTfToken(tok)
    if (asTf && !tf) { tf = asTf; continue }
    const asDay = parseDayToken(tok)
    if (asDay && !day) { day = asDay; continue }
    return null
  }
  return { tf, day }
}

/** Parse the free text after '/chart' — "AMD 15m", "amd", "NVDA d 3/13",
 *  "AMD 2026-03-13" — → { symbol, tf, day } or null. STRICT on shape (review
 *  finding): with allowSpaces keeping a mid-text '/' suggestion alive, prose
 *  like "/chart looks great here" must parse as NOTHING (menu closes, Enter
 *  is a newline) — never as a LOOKS·D embed that eats the sentence. An
 *  optional day token anchors the window at that date (panel batch 3):
 *  reviewing March from August is one command, no toolbar surgery. */
export function parseChartSlashArgs(rest) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 3) return null
  if (!SYMBOL_RE.test(tokens[0])) return null
  const slots = parseTfDayTokens(tokens.slice(1))
  if (!slots) return null
  return { symbol: tokens[0].toUpperCase(), tf: slots.tf || 'D', day: slots.day }
}

// ── Composition presets (spec Phase 6 #4/#5): one action → N chart nodes ──

/** The MTF stack's timeframes, top-down (the house read: daily structure →
 *  hourly context → 15m execution). One preset, not a config surface. */
export const MTF_STACK_TFS = ['D', '60', '15']
/** Wave 13 lane 13H-2: the WEEKLY stack (weekly structure -> daily -> hourly), beside today's
 *  D/60/15 (plan A.13H H7). 60 stands in for the plan's "60/65": 65 is a custom multiplier,
 *  which falls through both durability rails (no `to=`, no warm) by design. Dark behind the
 *  chart-plan gate -- the caller passes `weekly: true` only when it is on. */
export const MTF_WEEKLY_STACK_TFS = ['W', 'D', '60']
const WEEKLY_STACK_TOKENS = new Set(['w', 'week', 'weekly', '1w'])

/** Parse the free text after '/mtf' — SYMBOL [day] → {symbol, tfs, day}.
 *  Same strictness contract as /chart: prose must parse as NOTHING. The
 *  optional day (panel batch 3 follow-through: /chart and /compare speak
 *  dates, so the stack does too) anchors all three charts at that date; a
 *  TIMEFRAME token is deliberately NOT accepted — the stack's tfs are the
 *  preset, not a config surface. */
export function parseMtfSlashArgs(rest, { weekly = false } = {}) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 3 || !SYMBOL_RE.test(tokens[0])) return null
  let day = null
  let stack = 'intraday'
  for (const tok of tokens.slice(1)) {
    // 13H-2: one optional STACK token selects the weekly stack -- still a preset, never a
    // free timeframe (the stack's tfs are not a config surface).
    if (weekly && stack === 'intraday' && WEEKLY_STACK_TOKENS.has(tok.toLowerCase())) { stack = 'weekly'; continue }
    const d = !day ? parseDayToken(tok) : null
    if (!d) return null
    day = d
  }
  const tfs = stack === 'weekly' ? MTF_WEEKLY_STACK_TFS : MTF_STACK_TFS
  return { symbol: tokens[0].toUpperCase(), tfs: [...tfs], day, ...(stack === 'weekly' ? { stack } : {}) }
}

/** Wave 13 lane 13H-2 -- `/vs`: the stock beside a benchmark (plan A.13H H7).
 *  The broad pair is named; `sector` / `theme` are KEYWORDS the server resolves to an ETF
 *  (`GET /api/j2/chart-plan/benchmarks`, chart_plan.benchmark_options). Any other symbol is an
 *  explicit benchmark. Same strictness contract as /chart: prose parses as NOTHING.
 *    /vs AMD                 -> { symbol, bench: null }            (the menu offers the four)
 *    /vs AMD SPY [day] [tf]  -> { symbol, bench: 'SPY', day, tf }
 *    /vs AMD sector          -> { symbol, bench: 'sector', ... } */
export const VS_BROAD = ['SPY', 'QQQ']
export const VS_KEYWORDS = ['sector', 'theme']
export function parseVsSlashArgs(rest) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 4 || !SYMBOL_RE.test(tokens[0])) return null
  const symbol = tokens[0].toUpperCase()
  let bench = null
  let more = tokens.slice(1)
  const second = more[0]
  if (second) {
    const low = second.toLowerCase()
    if (VS_KEYWORDS.includes(low)) { bench = low; more = more.slice(1) }
    else if (!parseTfToken(second) && !parseDayToken(second) && SYMBOL_RE.test(second)) {
      bench = second.toUpperCase(); more = more.slice(1)
    }
  }
  if (bench === symbol) return null                 // a stock against itself compares nothing
  const slots = parseTfDayTokens(more)
  if (!slots) return null
  return { symbol, bench, day: slots.day, tf: slots.tf || 'D' }
}

function validDay(y, mo, d) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** TODAY as the ET SESSION day — the one basis every cutoff in this file is
 *  measured against.
 *  ⛔ Never `toISOString()` here, and never the LOCAL year: this function used
 *  to default the year from `new Date().getFullYear()` (local) and then test
 *  "is it in the future?" against `new Date().toISOString()` (UTC). Two bases
 *  for one question — so every evening after 7pm CT, once UTC had rolled over,
 *  a yearless M/D for TOMORROW compared equal-not-greater and skipped the
 *  roll-back, accepting a FUTURE cutoff. That is precisely the case the
 *  roll-back exists to prevent ("a future cutoff renders identical
 *  before/after halves with no warning"). en-CA renders YYYY-MM-DD; the same
 *  ET/en-CA idiom as tsToAnchorDay. */
export function etTodayIso() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** A day token → 'YYYY-MM-DD'. Accepts ISO, M/D (current ET year), M/D/YY[YY]. */
export function parseDayToken(tok) {
  const t = String(tok || '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return validDay(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t)
  if (m) {
    const today = etTodayIso()
    let y = m[3] ? +m[3] : +today.slice(0, 4)
    if (y < 100) y += 2000
    let day = validDay(y, +m[1], +m[2])
    // A YEARLESS M/D that lands in the future means LAST year's date —
    // reviewing a late-December setup on Jan 2 must not anchor at NEXT
    // December (panel finding: a future cutoff renders identical
    // before/after halves with no warning).
    if (day && !m[3] && day > today) {
      day = validDay(y - 1, +m[1], +m[2])
    }
    return day
  }
  return null
}

/** Parse the free text after '/compare' — SYMBOL DAY [tf] → the before/after
 *  pair args ({symbol, day, tf}). The "before" chart freezes its window at
 *  DAY via replayCutoff; the "after" renders the current window. The optional
 *  tf (panel batch 3) compares at execution granularity — '/compare AMD 3/13
 *  15m' — instead of always daily; a missing tf stays 'D'. */
export function parseCompareSlashArgs(rest) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2 || tokens.length > 3 || !SYMBOL_RE.test(tokens[0])) return null
  const slots = parseTfDayTokens(tokens.slice(1))
  if (!slots || !slots.day) return null
  return { symbol: tokens[0].toUpperCase(), day: slots.day, tf: slots.tf || 'D' }
}

/** The render-path decision for one embed — the never-a-broken-embed chain.
 *  kind: 'live'        → mount the widget's embed component with frozen params
 *        'image'       → render the stored archive image
 *        'placeholder' → neither is possible; a labeled chip, never a crash */
/** An ISO instant → the ET SESSION day it fell in. Same en-CA/ET idiom as
 *  `etTodayIso`, for the same reason: never `toISOString()` (that is UTC, and
 *  a 9pm ET capture is already tomorrow there), never the local zone. */
export function etDayOf(iso) {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  try {
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  } catch {
    return new Date(t).toISOString().slice(0, 10)
  }
}

/** ⛔ THE TEMPORAL GATE (G-063). Could this capture's subject already have
 *  HAPPENED when the member captured it?
 *
 *  The invariant: what the member could know at capture time must not silently
 *  become what became true later. A member who captured Thursday's calendar on
 *  Tuesday was looking at an EXPECTATION; re-rendering it live in October
 *  shows them the RESULT, inside a note they wrote as a pre-event thesis.
 *
 *  The question is KNOWABILITY, not string ordering, and the honest precision
 *  is the DAY — `date` is 'YYYY-MM-DD' and the widget renders one ET session,
 *  so nothing here can distinguish a 9am capture from a 5pm one. Therefore a
 *  day counts as knowable only once it had FULLY ELAPSED at capture:
 *
 *    asOfDay <  capture ET day  → settled before capture      → live is faithful
 *    asOfDay == capture ET day  → the day was still unfolding → NOT knowable
 *    asOfDay >  capture ET day  → hadn't happened at all      → NOT knowable
 *
 *  Same-day is deliberately on the NOT-knowable side: at day precision we
 *  cannot show the capture followed the outcome, and the failure directions are
 *  not symmetric — wrongly showing the archive costs a re-render, wrongly
 *  showing live rewrites the member's own research.
 *
 *  Widgets that declare no `asOfDay` are untouched. */
export function outcomeKnowableAtCapture(attrs) {
  const asOf = asOfDayOf(attrs?.widgetId, attrs?.params)
  if (!asOf) return true                       // widget makes no as-of claim
  const capturedDay = etDayOf(attrs?.capturedAt)
  if (!capturedDay) return false               // no trustworthy capture time → fail safe
  return asOf < capturedDay
}

export function resolveEmbedRender(attrs) {
  const meta = widgetMeta(attrs?.widgetId)
  const hasImage = !!attrs?.fallback?.url
  if (!meta) return { kind: hasImage ? 'image' : 'placeholder', reason: 'unknown-widget' }
  const verdict = validateParams(attrs.widgetId, attrs.params || {})
  if (!verdict.ok) return { kind: hasImage ? 'image' : 'placeholder', reason: 'invalid-params' }
  if (attrs.mode === 'live' && meta.liveCapable) return { kind: 'live', reason: 'live-mode' }
  // G-063: the knowability gate sits BEFORE reconstruction, because
  // reconstruction is exactly the mechanism that would substitute later truth.
  if (!outcomeKnowableAtCapture(attrs)) {
    return { kind: hasImage ? 'image' : 'placeholder', reason: 'captured-before-outcome' }
  }
  if (isReconstructable(attrs.widgetId, attrs.params)) return { kind: 'live', reason: 'reconstructable' }
  return { kind: hasImage ? 'image' : 'placeholder', reason: 'image-only' }
}

// Seconds per bar for re-anchoring math. Daily+ use calendar approximations —
// the bars API aligns to real sessions; this only sizes the WINDOW.
const TF_SECONDS = { D: 86400, W: 7 * 86400, M: 30 * 86400 }
function tfSeconds(tf) {
  const t = String(tf ?? 'D')
  if (/^\d+$/.test(t)) return Number(t) * 60
  return TF_SECONDS[t] || 86400
}

/** Timeframe switches re-anchor around the SAME CENTER timestamp — never jump
 *  to now (spec Phase 4 rule). Keeps the old window's bar count at the new
 *  timeframe's bar size. Inputs/outputs are epoch seconds; null when the old
 *  range is unusable (caller keeps the old anchor). */
export function reanchorRange(from, to, oldTf, newTf) {
  const f = tsToEpochSecondsPublic(from)
  const t = tsToEpochSecondsPublic(to)
  if (f == null || t == null || t <= f) return null
  const center = (f + t) / 2
  const bars = Math.max(1, Math.round((t - f) / tfSeconds(oldTf)))
  const half = (bars * tfSeconds(newTf)) / 2
  return { from: Math.round(center - half), to: Math.round(center + half) }
}

/** Toolbar timeframe switch for a CHART embed (spec Phase 4): re-anchor the
 *  frozen window around the SAME CENTER at the new tf's bar size — never jump
 *  to now. Returns { params, searchText } ready for updateAttributes, or null
 *  when nothing changes. searchText re-derives here because this is one of
 *  the only moments params change (the derive-don't-restate contract both
 *  plain-text serializers rely on). */
export function retimeChartParams(attrs, newTf) {
  const params = attrs?.params || {}
  const oldTf = String(params.tf ?? 'D')
  const tf = String(newTf ?? '')
  if (!tf || tf === oldTf) return null
  const r = reanchorRange(params.from, params.to, oldTf, tf)
  const next = normalizeParams('chart', {
    ...params, tf, ...(r ? { from: r.from, to: r.to } : {}),
  })
  return { params: next, searchText: paramsPlainText('chart', next) }
}

// Exported twin of the registry-private converter (same dual encoding).
export function tsToEpochSecondsPublic(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 10_000_000_000 ? v / 1000 : v
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms / 1000 : null
  }
  return null
}

/** Live embeds allowed per entry (owner decision #11). */
export const LIVE_EMBEDS_PER_ENTRY = 3

/** The per-note crosshair bus (post-v1: linked crosshair, spec Phase 6 #6).
 *  Same shape as the /charts workspace bus minus the color-group arg (notes
 *  have no color groups): imperative pub/sub, NO React state — a setState
 *  per mouse move is what made the first /charts cut step/skip. Mirrors the
 *  house call from 2026-07-29: linking is GLOBAL across chart embeds (the
 *  payload maps by ET day across timeframes), not symbol-scoped. Lives on
 *  editor.storage.uctJournalWidgets so every embed node view in one note
 *  shares one bus; lazily created by the first ChartEmbed that mounts. */
export function makeCrosshairBus() {
  const listeners = new Set()
  return {
    emit: (sourceId, payload) => listeners.forEach((fn) => fn({ sourceId, payload })),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

// The v1 default embed height. Every embed created before auto-height stored
// this literal (nobody ever CHOSE it — it was only ever the default), so the
// renderer treats a stored 320 as auto too rather than freezing early embeds
// in the cramped look this replaced.
export const EMBED_LEGACY_DEFAULT_HEIGHT = 320

/** The height an embed renders at. Explicit user-set heights win; null/legacy-
 *  default derive from the rendered WIDTH at ~the chart page's proportions
 *  (a full-width prose-column embed lands ~530px — screenshot-like; half-width
 *  pairs scale down with their width, floored so candles stay readable). */
export function embedRenderHeight(layoutHeight, width) {
  if (Number.isFinite(layoutHeight) && layoutHeight > 0 && layoutHeight !== EMBED_LEGACY_DEFAULT_HEIGHT) {
    return Math.round(layoutHeight)
  }
  const w = Number.isFinite(width) && width > 0 ? width : 966
  return Math.max(300, Math.min(640, Math.round(w * 0.55)))
}

// Free-resize ceiling (px) for any chart-embed height computation — the resize
// handles' own max (WidgetEmbedView's corner-drag).
export const EMBED_MAX_H = 1400

// ⚰️ Wave 13 lane 13H-3 built a Draw-mode toolbar-clearance height bump here
// (`ANNOTATE_DRAW_BUFFER_PX` + `annotateEffectiveHeight`) to work around a
// chart embed's Draw mode always rendering StockChart's full desktop
// `ChartToolbar`, floating over the canvas and wrapping onto several rows at a
// touch-narrow width (docs/notebook/wave13-13h3.md §2-4). **13H-4 removed it**:
// StockChart's `annotationsEditable` branch now takes the same `mobileDrawBar`
// prop the `showDrawingTools` branch already had, swapping in MobileDrawBar (a
// fixed-height, bottom-docked, single-row strip — never wraps, never floats
// over the canvas's top) on a coarse pointer, so there is no floating toolbar
// left to grow the embed around. Measured, not assumed: re-enabling
// `mobileDrawBar` WITH this workaround still active mis-measured MobileDrawBar's
// own `aria-label`led tool buttons as "the toolbar to clear" (they sit well
// within `TOOLBAR_BAND_PX` of a short embed's top) and inflated a ~300px canvas
// to ~995px, breaking the very walk this lane re-ran to prove the fix
// (docs/notebook/evidence/wave13-13h4/walk-1/). See wave13-13h4.md §3-4.

/** Count mode:'live' widgetEmbed nodes in a doc JSON. */
export function countLiveEmbeds(doc) {
  let n = 0
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'widgetEmbed' && node.attrs?.mode === 'live') n += 1
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return n
}

/** A template-declarable widget slot. Entry templates (notebookTemplates.js
 *  TEMPLATES[].build(ctx)) push this node straight into their returned doc
 *  content — the stated integration point: the owner's regenerated templates
 *  declare widget slots programmatically with one call, e.g.
 *    widgetSlotNode('chart', { symbol: ctx.ticker, tf: 'D' })
 *  and the node renders/serializes exactly like a hand-inserted embed. */
export function widgetSlotNode(widgetId, capture = {}, extra = {}) {
  return { type: 'widgetEmbed', attrs: buildWidgetEmbedAttrs(widgetId, capture, extra) }
}

/** ONE node builder for every chart insert — the slash commands and the
 *  widget palette both ride it, so the insert payload can never fork into
 *  hand-written copies (the "one grammar, four copies" defect class).
 *  kind: 'chart' (one snapshot) · 'mtf' (D/60/15 stack, top-down) ·
 *  'compare' (half-width before/after pair — before anchored at day, after
 *  the ONE explicit rolling window, its caption says so).
 *  `settings` is the caller's frozen blob (editor storage stamp); day rides
 *  params.to; a missing day lets buildWidgetEmbedAttrs stamp the insert
 *  moment (frozen means anchored). Returns an array ready for
 *  insertContent(...).caretAfterWidgetEmbed(). */
export function chartInsertNodes(kind, args, settings) {
  const frozen = settings ? { settings } : {}
  const anchored = args.day ? { to: args.day } : {}
  if (kind === 'mtf') {
    const tfs = Array.isArray(args.tfs) && args.tfs.length ? args.tfs : MTF_STACK_TFS
    return tfs.map((tf) => widgetSlotNode('chart', {
      symbol: args.symbol, tf, ...anchored, ...frozen,
    }))
  }
  if (kind === 'compare') {
    return [
      widgetSlotNode('chart', { symbol: args.symbol, tf: args.tf, to: args.day, ...frozen },
        { layout: { width: 'half' }, caption: `before · ${args.day}` }),
      // to: null = the EXPLICIT rolling-window opt-out (buildWidgetEmbedAttrs
      // stamps the insert moment on undefined) — "after · now" is the one
      // embed whose caption promises it tracks now.
      widgetSlotNode('chart', { symbol: args.symbol, tf: args.tf, to: null, ...frozen },
        { layout: { width: 'half' }, caption: 'after · now' }),
    ]
  }
  if (kind === 'vs') {
    // 13H-2: BOTH charts frozen at the SAME `to` -- one moment computed once, so the pair is
    // a comparison of one window, never two windows a millisecond apart.
    const bench = String(args.benchmark || '').toUpperCase()
    if (!bench || !args.symbol || bench === args.symbol) return []
    const to = args.day || Math.floor(Date.now() / 1000)
    const tf = args.tf || 'D'
    return [
      widgetSlotNode('chart', { symbol: args.symbol, tf, to, ...frozen },
        { layout: { width: 'half' }, caption: `${args.symbol} · vs ${bench}` }),
      widgetSlotNode('chart', { symbol: bench, tf, to, ...frozen },
        { layout: { width: 'half' }, caption: `vs ${bench}${args.label ? ` · ${args.label}` : ''}` }),
    ]
  }
  if (kind === 'chart') {
    return [widgetSlotNode('chart', {
      symbol: args.symbol, tf: args.tf || 'D', ...anchored, ...frozen,
    })]
  }
  // Fail CLOSED: an unknown kind returns nothing rather than a mislabeled
  // chart node persisted into the v1 stored-document schema. The day a second
  // registry type flips menus.journal on, the palette must grow a real
  // builder + form for it — silently minting charts is not a fallback
  // (review finding).
  return []
}

/** The auto-caption ("Chart — AMD 5m · captured Mar 13, 2026") — DERIVED
 *  from params at render, never stored (derive-don't-restate). The DISPLAY
 *  form maps the widget id through its header label — the raw plainText
 *  line is the SEARCH INDEX, and its key-colon serialization leaking into
 *  the UI was a panel finding. */
export function embedAutoCaption(attrs) {
  const line = paramsPlainText(attrs?.widgetId, attrs?.params)
  const label = widgetMeta(attrs?.widgetId)?.labels?.header
  let inner = line.replace(/^\[|\]$/g, '')
  if (label) {
    const colon = inner.indexOf(':')
    inner = colon > -1 ? `${label} —${inner.slice(colon + 1)}` : `${label} — ${inner}`
  }
  if (!attrs?.capturedAt) return inner
  const d = new Date(attrs.capturedAt)
  if (Number.isNaN(d.getTime())) return inner
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${inner} · captured ${day}`
}
