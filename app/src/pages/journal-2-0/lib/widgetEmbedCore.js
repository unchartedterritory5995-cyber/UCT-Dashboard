// Journal Widgets — pure core for the widgetEmbed node: attr construction,
// slash-command arg parsing, and the render-path decision. NO React, NO
// TipTap — everything here is unit-testable data-in/data-out, and the node
// view / slash menu / capture paths all build on it.

import {
  widgetMeta, normalizeParams, validateParams, paramsPlainText, isReconstructable,
} from '../../../widgets/registry'

// The embed document schema, v1 (see the plan doc: "expensive to change
// later"). Every stored notebook doc carries these attrs verbatim.
export const WIDGET_EMBED_VERSION = 1

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
    mode: extra.mode === 'live' ? 'live' : 'snapshot',
    fallback: extra.fallback || null,           // {url, w, h} once the archive lands
    tradeRef: extra.tradeRef || null,
    annotations: Array.isArray(extra.annotations) ? extra.annotations : [],
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

/** Parse the free text after '/mtf' — SYMBOL [day] → {symbol, tfs, day}.
 *  Same strictness contract as /chart: prose must parse as NOTHING. The
 *  optional day (panel batch 3 follow-through: /chart and /compare speak
 *  dates, so the stack does too) anchors all three charts at that date; a
 *  TIMEFRAME token is deliberately NOT accepted — the stack's tfs are the
 *  preset, not a config surface. */
export function parseMtfSlashArgs(rest) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 2 || !SYMBOL_RE.test(tokens[0])) return null
  let day = null
  if (tokens[1]) {
    day = parseDayToken(tokens[1])
    if (!day) return null
  }
  return { symbol: tokens[0].toUpperCase(), tfs: [...MTF_STACK_TFS], day }
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
function etToday() {
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
    const today = etToday()
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
export function resolveEmbedRender(attrs) {
  const meta = widgetMeta(attrs?.widgetId)
  const hasImage = !!attrs?.fallback?.url
  if (!meta) return { kind: hasImage ? 'image' : 'placeholder', reason: 'unknown-widget' }
  const verdict = validateParams(attrs.widgetId, attrs.params || {})
  if (!verdict.ok) return { kind: hasImage ? 'image' : 'placeholder', reason: 'invalid-params' }
  if (attrs.mode === 'live' && meta.liveCapable) return { kind: 'live', reason: 'live-mode' }
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
