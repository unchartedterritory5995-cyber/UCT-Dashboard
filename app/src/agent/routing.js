// ── CAPABILITY ROUTING: send the model only the action groups a request needs ───────────
//
// The flat manifest grows with every capability (51 after Batch 4 against the server's 60),
// and every action costs prompt tokens on every turn. Routing picks, DETERMINISTICALLY (no
// model call), the action groups a message plausibly needs, and tells the model which other
// groups exist. If the model needs one it was not given, it says so (`need_groups`) and the
// browser asks ONCE more with those groups added. Nothing runs between the two calls.
//
// KNOWING ≠ DOING, still: routing only changes what the model SEES. Every op the model returns
// is re-validated against the FULL registry in the browser (executor.planOps / shapeError),
// and the server validates against the manifest it was sent — a capability the member may
// not use is never selectable, because it is never in manifestFor(ctx) to begin with.
//
// SAFE BY DEFAULT:
//   • nothing recognised → the full manifest (exactly the pre-routing behaviour);
//   • the groups of a pending proposal and of the last change ride along (follow-ups);
//   • the agent group (capability questions) always rides along;
//   • a reroute is bounded to ONE extra call, and only when the first call planned nothing.
// Kill switch: localStorage `uct.agent.routing = '0'` sends the full manifest every turn.

export const ROUTING_VERSION = 1

/** Action groups, keyed by capability DOMAIN (the name prefix). Titles are shown to the model. */
export const GROUPS = [
  { id: 'charts', title: 'Chart symbol, timeframe, type, scale, session, theme, colours, display settings, volume', domains: ['chart', 'volume'],
    words: [/\bcharts?\b/, /\b(timeframe|daily|weekly|monthly|intraday|\d+ ?(min|minute|hour|hr)s?|1h|4h)\b/, /\b(candles?|candlesticks?|hollow|bars|hlc|line chart|area chart|heikin)\b/,
      /\b(log|logarithmic|percent|linear) scale\b|\bscale\b/, /\b(extended|pre-?market|post-?market|regular hours|rth)\b/, /\b(theme|colou?rs?|background|grid|crosshair|legend|watermark|labels?|markers?|countdown|swing|thin bars|invert|template|defaults?|tabs?|compare|versus|against|overlay|go to|scroll|as it looked|custom (time ?frame|interval))\b/,
      /\bvolume\b/] },
  { id: 'workspace', title: 'Widgets on the board (add, remove, move, resize, arrange, link) and saved layouts (open, save, create, copy, rename, delete)', domains: ['widget', 'layout'],
    words: [/\bwidgets?\b/, /\blayouts?\b/, /\bworkspaces?\b/, /\bboard\b/, /\b(add|open|close|remove|delete)\b.*\bcharts?\b/, /\b(move|resize|arrange|rearrange|swap|wider|narrower|taller|shorter|bigger|smaller|fill|side by side|grid of|left|right|top|bottom)\b/,
      /\b(link|unlink|colou?r group)\b/, /\bsave\b.*\b(changes|this|it|layout)\b/] },
  { id: 'drawings', title: 'Chart drawings: horizontal price levels (draw, restyle, remove, list)', domains: ['drawing'],
    words: [/\bdraw\w*\b/, /\b(horizontal (line|level)s?|levels?|price lines?|rays?|trend ?lines?|fib\w*|rectangles?|annotat\w+|support|resistance)\b/] },
  { id: 'lists', title: 'Watchlists (show, create, rename, add, remove, clear, delete)', domains: ['watchlist'],
    words: [/\bwatch ?lists?\b/, /\blists?\b/, /\b(add|put|remove|drop)\b.+\b(to|into|from|off)\b/] },
  { id: 'screener', title: 'Screener (run screens, saved screens: run, save, copy, rename, delete)', domains: ['screener'],
    words: [/\bscreen\w*\b/, /\bscans?\b/, /\bfind (me )?(stocks|names|tickers)\b/, /\bfilter\w*\b/, /\b(stocks|names) (with|above|below|over|under)\b/, /\b(top|first) \d+\b/, /\bresults?\b/, /\b(adr|rs rating|rvol|market cap|dollar volume|52[- ]week)\b/] },
  { id: 'alerts', title: 'Price alerts (list, create, delete)', domains: ['alert'],
    words: [/\balerts?\b/, /\b(notify|ping|tell) me\b/, /\b(crosses|breaks|hits)\b/] },
  { id: 'data', title: 'Stock information and news (profile, earnings, comparisons, news, catalysts)', domains: ['stock', 'news'],
    words: [/\b(news|headlines?|catalysts?|earnings|profile|fundamentals?|compare|versus|vs\.?|sector|industry|market cap|float|why is|what does .+ do)\b/] },
  { id: 'settings', title: 'App settings (app theme, default timeframe, alert sound, email digest) and opening UCT pages', domains: ['settings', 'app'],
    words: [/\bsettings?\b/, /\b(dark|light) mode\b/, /\bapp theme\b/, /\bdefault (chart )?timeframe\b/, /\b(alert )?sound\b/, /\bdigest\b/, /\bemail\b/, /\b(open|go to|take me to)\b.*\b(page|screener|dashboard|breadth|research)\b/] },
  { id: 'agent', title: 'Questions about what UCT Agent can do', domains: ['agent'], always: true, words: [] },
]

const SYMBOL_VERB = /\b(switch|change|put|show|pull up|load|open|chart)\b/
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC'])
const tickerWords = (raw) => (String(raw).match(/(?:^|[\s$])([A-Z]{1,5})(?=[\s,.!?]|$)/g) || [])
  .map(w => w.trim().replace('$', '')).filter(w => !NOT_TICKERS.has(w))

const BY_DOMAIN = new Map(GROUPS.flatMap(g => g.domains.map(d => [d, g.id])))
export const groupOfAction = (name) => BY_DOMAIN.get(String(name || '').split('.')[0]) || null

export function routingEnabled() {
  try { return globalThis.localStorage?.getItem('uct.agent.routing') !== '0' } catch { return true }
}

/**
 * The groups for this message. `pendingActions` / `recentActions` are action names of a waiting
 * proposal and of the last change, so follow-ups ("only the first two", "do the same on the
 * right") keep their groups. Returns { selected: [ids], matched: bool }.
 */
export function selectGroups(message, { pendingActions = [], recentActions = [] } = {}) {
  const raw = String(message || '')
  const q = raw.toLowerCase()
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const hits = new Set()
  for (const g of GROUPS) {
    if (g.always) continue
    if (g.words.some(re => re.test(q))) hits.add(g.id)
  }
  // "put NVDA on the left", "Switch to AMD": a ticker-shaped word (case-sensitive, on the raw
  // text) after a show/switch verb is a chart symbol request.
  if (SYMBOL_VERB.test(q) && tickerWords(raw).length) hits.add('charts')
  const followUps = [...new Set([...pendingActions, ...recentActions].map(groupOfAction).filter(Boolean))]
  const matched = hits.size > 0
  // PRIORITY order (Batch 6): always-on, then follow-ups, then the message's own groups (catalog
  // order). routeManifest packs them in this order under the per-request budget. When NOTHING was
  // recognised, every group is a candidate in catalog order (charts first — the page's own
  // controls), so a catalog bigger than one request still sends as much as fits, not just the
  // always-on group; the rest are named and the model can ask for them.
  const own = matched ? GROUPS.map(g => g.id).filter(id => hits.has(id)) : GROUPS.map(g => g.id)
  const priority = [...new Set([...always, ...followUps, ...own])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched }
}

/**
 * Route a manifest. Returns { manifest, routing } — `routing` is what the server needs to tell
 * the model about the groups it was NOT given (null = the full manifest, no routing).
 * `extra` adds groups (the bounded reroute).
 */
export function routeManifest(manifest, message, opts = {}, extra = []) {
  const limit = opts.limit ?? Infinity                     // the server's per-request maximum
  const budget = Math.min(opts.budget ?? limit, limit)     // what one request may carry (routingThreshold)
  // Kill switch / nothing recognised → the FULL manifest — while it fits the per-request limit.
  // Past it, routing always applies: the always-on and follow-up groups, every other group NAMED,
  // so the model asks for what it needs (need_groups) instead of anything being cut.
  if (opts.enabled === false && manifest.length <= limit) return { manifest, routing: null }
  const { priority, matched } = selectGroups(message, opts)
  if (!matched && !extra.length && manifest.length <= limit) return { manifest, routing: null }
  // A reroute's requested groups come straight after the always-on ones.
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const sizeOf = (id) => manifest.filter(c => groupOfAction(c.name) === id).length
  // The message's OWN groups are packed smallest-first (after the always-on, reroute and follow-up
  // groups, which keep their place): more of the distinct things a multi-part request names fit,
  // and if one must wait it is the biggest, most often incidental, group.
  const pinned = [...new Set([...always, ...extra, ...(opts.pendingActions || []), ...(opts.recentActions || [])].map(x => (x.includes?.('.') ? groupOfAction(x) : x)).filter(Boolean))]
  const rest = priority.filter(id => !pinned.includes(id))
  // (nothing recognised: catalog order — charts first — not size order)
  const own = matched ? [...rest].sort((a, b) => sizeOf(a) - sizeOf(b)) : rest
  const order = [...new Set([...pinned, ...own])]
  // PACK under the budget, in priority order. A group that would overflow is NOT sent — it is
  // named (unselected), so the model can ask for it; nothing is ever partially sent.
  const want = new Set()
  let used = manifest.filter(c => groupOfAction(c.name) === null).length
  const over = []
  for (const id of order) {
    const n = sizeOf(id)
    if (!n) continue
    if (used + n > budget && want.size >= always.length) { over.push(id); continue }
    want.add(id); used += n
  }
  const present = GROUPS.filter(g => manifest.some(c => groupOfAction(c.name) === g.id))
  const routed = manifest.filter(c => want.has(groupOfAction(c.name)) || groupOfAction(c.name) === null)
  if (routed.length === manifest.length) return { manifest, routing: null }
  return {
    manifest: routed,
    routing: {
      version: ROUTING_VERSION,
      groups: present.map(g => ({ id: g.id, title: g.title })),
      selected: present.filter(g => want.has(g.id)).map(g => g.id),
    },
    // groups the request needed but the budget could not carry (a reroute cannot add these either)
    overBudget: over,
  }
}
