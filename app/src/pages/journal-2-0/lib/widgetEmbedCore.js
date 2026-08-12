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
  const params = normalizeParams(widgetId, capture)
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
  h: '60', d: 'D', day: 'D', daily: 'D', w: 'W', week: 'W', weekly: 'W',
  mo: 'M', month: 'M', monthly: 'M',
}

export function parseTfToken(tok) {
  if (!tok) return null
  const t = String(tok).trim().toLowerCase()
  if (TF_TOKENS[t]) return TF_TOKENS[t]
  if (/^\d+$/.test(t)) return t
  if (t === 'm') return 'M' // bare capital-M convention: month (minutes need '1m' etc.)
  return null
}

const SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

/** Parse the free text after '/chart' — "AMD 15m", "amd", "NVDA d" —
 *  → { symbol, tf } or null. STRICT on shape (review finding): with
 *  allowSpaces keeping a mid-text '/' suggestion alive, prose like
 *  "/chart looks great here" must parse as NOTHING (menu closes, Enter is a
 *  newline) — never as a LOOKS·D embed that eats the sentence. At most two
 *  tokens, and a second token must be a real timeframe. */
export function parseChartSlashArgs(rest) {
  const tokens = String(rest || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 2) return null
  if (!SYMBOL_RE.test(tokens[0])) return null
  const tf = tokens[1] ? parseTfToken(tokens[1]) : null
  if (tokens[1] && !tf) return null
  return { symbol: tokens[0].toUpperCase(), tf: tf || 'D' }
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

/** The auto-caption ("AMD · 5m · captured Mar 13") — DERIVED from params at
 *  render, never stored (derive-don't-restate: no drift possible). */
export function embedAutoCaption(attrs) {
  const line = paramsPlainText(attrs?.widgetId, attrs?.params)
  const inner = line.replace(/^\[|\]$/g, '')
  if (!attrs?.capturedAt) return inner
  const d = new Date(attrs.capturedAt)
  if (Number.isNaN(d.getTime())) return inner
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${inner} · captured ${day}`
}
