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
    // Gate B vocabulary (soft): an overlay or a symbol swap said without "compare" / "chart"
    vocab: [/\b(next to (this|it)|on top of (this|it)|swap \$?[a-z]{1,5} (for|with)|instead of \$?[a-z]{1,5})\b/],
    words: [/\bcharts?\b/, /\b(timeframe|daily|weekly|monthly|hourly|intraday|\d+ ?(min|minute|hour|hr)s?|1h|4h)\b/, /\b(candles?|candlesticks?|hollow|bars|hlc|line chart|area chart|heikin)\b/,
      /\b(log|logarithmic|percent|linear) scale\b|\bscale\b/, /\b(extended|pre-?market|post-?market|regular hours|rth)\b/, /\b(theme|colou?rs?|background|grid|crosshair|legend|watermark|labels?|markers?|countdown|swing|thin bars|invert|template|defaults?|tabs?|compare|versus|against|overlay|go to|scroll|as it looked|custom (time ?frame|interval))\b/,
      /\bvolume\b/] },
  { id: 'workspace', title: 'Widgets on the board (add, remove, move, resize, arrange, link, widget tabs)', domains: ['widget'],
    words: [/\bwidgets?\b/, /\bworkspaces?\b/, /\bboard\b/, /\b(another|new|one more|second|extra) chart\b/, /\b(add|open|close|remove|delete)\b.*\bcharts?\b/, /\b(move|resize|arrange|rearrange|swap|wider|narrower|taller|shorter|bigger|smaller|fill|side by side|grid of|left|right|top|bottom)\b/,
      /\b(link|unlink|colou?r group)\b/, /\btabs?\b/] },
  // Split from 'workspace' (2026-10-09): a whole-group packer packs better with smaller groups, and
  // saved layouts are their own concept ("open my Swing layout", "save this").
  { id: 'layouts', title: 'Saved layouts (open, save, create, copy, rename, delete)', domains: ['layout'],
    words: [/\blayouts?\b/, /\bworkspaces?\b/, /\bsave\b.*\b(changes|this|it|layout|arrangement|board)\b/] },
  // INDICATORS M1 (agreed with Indicators, AGENT-INTEGRATION-HANDOFF §11). A message matching an
  // indicators word AND a charts word routes BOTH; the hints decide.
  { id: 'indicators', title: 'Indicators on a chart (list, add, remove, show, hide; build, preview and save indicator drafts)', domains: ['indicator'],
    words: [/\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|atr|bollinger|keltner|stochastic|supertrend|regression|correlation|momentum|oscillator|histogram)\b/,
      // "what's on this chart", "do i have the 50 on here", "a weekly 10 line": the chart's indicators
      /\bwhat'?s on (this|the|my) chart\b|\b(have|got) the \d+ on\b|\b\d+ (line|ma|average)\b/,
      /\b(build|make|create|write|code)\b.*\b(indicator|study|signal|formula)\b/, /\b(when|whenever|if)\b.*\b(cross(es)?|above|below)\b/,
      // a colour RULE ("colour the candles by trend"), not a colour ("colour the candles green")
      /\b(colou?r|paint|highlight|shade)\w*\b.*\bby (trend|momentum|strength|signal|condition)\b/,
      // INDICATORS M3: the authoring draft ("show me the preview", "save the draft")
      /\b(preview|draft)\b/] },
  { id: 'drawings', title: 'Chart drawings: horizontal price levels (draw, restyle, remove, list)', domains: ['drawing'],
    words: [/\bdraw\w*\b/, /\b(a |the )?line at \$?\d/, /\b(horizontal (line|level)s?|levels?|price lines?|rays?|trend ?lines?|fib\w*|rectangles?|annotat\w+|support|resistance)\b/] },
  { id: 'lists', title: 'Watchlists (show, create, rename, add, remove, clear, delete)', domains: ['watchlist'],
    words: [/\bwatch ?lists?\b/, /\blists?\b/, /\b(add|put|remove|drop)\b.+\b(to|into|from|off)\b/] },
  { id: 'screener', title: 'Screener (run screens, saved screens: run, save, copy, rename, delete)', domains: ['screener'],
    words: [/\bscreen\w*\b/, /\bscans?\b/, /\bfind (me )?(stocks|names|tickers)\b/, /\bfilter\w*\b/, /\b(stocks|names) (with|above|below|over|under)\b/, /\b(top|first) \d+\b/, /\bresults?\b/, /\b(adr|rs rating|rvol|market cap|dollar volume|52[- ]week)\b/,
      // STRENGTH / LEADERSHIP screens (stabilization, 2026-10-11). A strength/rank word ATTACHED to a
      // stock noun (≤2 words between): "my strongest stocks", "the weakest names", "best semiconductor
      // stocks", "top performers". Never the bare word — "strongest chart color", "best chart theme"
      // or "top-right chart" stays where it was. "momentum" alone stays an indicator word — only
      // "momentum stocks/names/leaders" is a screen.
      /\b(strongest|weakest|best|worst|top|bottom|leading|lagging|top[- ]rated|highest[- ]rated)(?:[- ]performing)?\s+(?:[a-z0-9&.-]+\s+){0,2}?(stocks|names|tickers|equities|performers|movers|setups)\b/,
      /\b(relative strength|rs rank|rs leaders?|market leaders?|strength leaders?|leaders and laggards)\b/,
      /\b(leaders?|leading) (stocks|names)\b|\b(stocks|names) leading\b/,
      /\btop (momentum|performing|performers?|gainers?|losers?|movers?)\b|\bmomentum (stocks|names|leaders?)\b/],
    // ⭐ Gate B (0C): TRADING VOCABULARY that names a SCREEN without the word "screen" (soft, see
    // selectGroups). Routing only: it changes which actions the model SEES first, never what a word
    // means (meanings are Phase 1B) and never drops a group that would otherwise have been sent.
    vocab: [/\b(semis|semiconductors?|semi conductors?|chips?|chip stocks|biotechs?|software (stocks|names)|banks|miners|small[- ]?caps?|mid[- ]?caps?|large[- ]?caps?|mega[- ]?caps?|ipos?|etfs)\b/,
      /\b(gainers?|losers?|movers?|gap(ped|ping|s)? (up|down)|new highs?|near (the )?highs?|all[- ]time highs?|pull(ing|s)?[- ]?backs?|pulling back|tagging|tight (bases?|flags?|ranges?)|bases?|flags?|breakouts?|unusual volume|big volume|leaders?|leading groups?|laggards?|acting well|working)\b/,
      /\b(over|under|above|below) \$?\d+ (bucks|dollars)\b|\b\d+ (million|mil|m|billion|bn?) (a day|dollar volume)\b|\bliquid (names|stocks)\b/,
      /\b(sort (it|them|that|by)|only the ones|same thing but|just (the )?(large|small|mid)[- ]?caps)\b/] },
  { id: 'alerts', title: 'Price alerts (list, create, delete)', domains: ['alert'],
    words: [/\balerts?\b/, /\b(notify|ping|tell) me\b/, /\b(crosses|breaks|hits)\b/] },
  { id: 'data', title: 'Stock information and news (profile, earnings, comparisons, news, catalysts)', domains: ['stock', 'news'],
    words: [/\b(news|headlines?|catalysts?|earnings|profile|fundamentals?|compare|versus|vs\.?|sector|industry|market cap|float|why is|what does .+ do)\b/],
    // Gate B vocabulary (soft): "when does nvda report", "anything new on tesla", "stack up on valuation"
    vocab: [/\b(reports?|reporting|valuation|stacks? up|anything new (on|with)|what'?s (going on|happening) with|why did .+ (gap|move|drop|fall|jump|rally|sell off))\b/] },
  // MARKET INTELLIGENCE breadth slice 1 (2026-10-11): historical breadth QUESTIONS. "breadth" alone is
  // a question — except a request to GO TO the breadth page / monitor, which stays navigation
  // (settings group). The lookahead is anchored at the start of the message (no lookbehind).
  { id: 'breadth', title: 'Market breadth now and history (US, NYSE, Nasdaq: % of stocks above moving averages, new highs/lows, advance/decline, Stage 2/4)', domains: ['breadth'],
    words: [/^(?!.*\b(open|go to|take me to|navigate to|bring up|pull up|switch to)\b.*\bbreadth\b.*\b(page|monitor|dashboard|tab|screen)\b).*\bbreadth\b/,
      /\b(percent|pct|share|portion|how many|what %|what percent)\b.*\b(above|below|over|under)\b.*\b\d+[- ]?(day|d|dma|sma|ema|week)\b/,
      /% (of )?(all )?(us |nyse |nasdaq |uct )?(stocks|names|issues)\b/,
      /\b(us|nyse|nasdaq|uct) (stocks|names|issues) (are |were )?above\b/,
      /\b(?:(?:us|nyse|nasdaq|uct)\s*:?\s*)?a(?:5|10|20|40|50|100|150|200)\b/,
      /\b(last|first|most recent) time\b.*\b(below|above|under|over|cross(?:ed|es)?)\b/, /\bhow (?:many times|often)\b.*\b(below|above|under|over|cross)/,
      /\bcross(?:ed|es)? (above|below) \d+(\.\d+)?\s*%/, /\b(below|above)[\s-]*\d+(\.\d+)?\s*%[\s-]*(episode|stretch|streak|run)\b/,
      /\bnew (52[- ]week |52w |20[- ]day )?(highs?|lows?)\b/, /\bnet new (highs?|lows?)\b|\bhighs? (minus|vs\.?|versus) lows?\b/,
      /\badvance[- /]decline\b|\badvancers?\b|\bdecliners?\b|\ba\/d (line|ratio|numbers?)\b|\badvancing (issues|stocks)\b/,
      /\bstage ?[24] (counts?|stocks|names)\b/, /\b(up|down) 4%/, /\bmarket internals\b/] },
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
// ⭐ Gate B (0C): the member's OWN names route too — "open swing board", "put the first 3 in swing",
// "take smci off momentum": a layout / watchlist / saved screen named in the message (whole words,
// from live state the caller passes in) brings its group. Pure: nothing here reads state.
const NAME_GROUPS = { layouts: 'layouts', watchlists: 'lists', screens: 'screener' }
const normWords = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9$&+.\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
function namedGroups(q, names) {
  const out = new Set()
  const text = normWords(q)
  for (const [kind, id] of Object.entries(NAME_GROUPS)) {
    for (const n of names?.[kind] || []) {
      const w = normWords(n).trim()
      if (w.length >= 3 && text.includes(` ${w} `)) { out.add(id); break }
    }
  }
  return out
}

/** The member's live names for routing, read from the host (never throws; a source that can't be read is empty). */
export function routingNames(host) {
  const read = (fn) => { try { return fn() || [] } catch { return [] } }
  return {
    layouts: read(() => host?.layouts?.snapshot?.()?.entries?.map(e => e.name)),
    watchlists: read(() => host?.watchlists?.snapshot?.()?.map(l => l.name)),
    screens: read(() => host?.savedScreens?.snapshot?.()?.map(s => s.name)),
  }
}

export function selectGroups(message, { pendingActions = [], recentActions = [], names = null, correct = null } = {}) {
  const raw = String(message || '')
  const q = raw.toLowerCase()
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const hits = new Set()
  // ⭐ Gate B (0C): typo-corrected readings route too ("earnigns date for amd", "opne swng board") —
  // `correct` is the caller's lexicon correction (nl/lexicon.js). Routing only adds groups the model
  // may SEE; nothing here acts on a correction.
  let texts = [q]
  try { if (typeof correct === 'function') texts = [q, ...(correct(raw) || []).map(t => String(t).toLowerCase())] } catch { texts = [q] }
  for (const g of GROUPS) {
    if (g.always) continue
    if (texts.some(t => g.words.some(re => re.test(t)))) hits.add(g.id)
  }
  for (const t of texts) for (const id of namedGroups(t, names)) hits.add(id)
  // "put NVDA on the left", "Switch to AMD": a ticker-shaped word (case-sensitive, on the raw
  // text) after a show/switch verb is a chart symbol request.
  if (SYMBOL_VERB.test(q) && tickerWords(raw).length) hits.add('charts')
  const followUps = [...new Set([...pendingActions, ...recentActions].map(groupOfAction).filter(Boolean))]
  const matched = hits.size > 0
  // ⭐ Gate B (0C) SOFT VOCABULARY: when no group's own words matched, trading vocabulary ("semis",
  // "pulling back", "when does nvda report") moves its groups to the FRONT of the catalog order — it
  // never narrows the request: nothing recognised still means every group is a candidate (and the
  // full manifest when it fits). When a group's own words DID match, vocabulary adds nothing.
  const soft = matched ? [] : GROUPS.filter(g => !g.always && (g.vocab || []).some(re => texts.some(t => re.test(t)))).map(g => g.id)
  // PRIORITY order (Batch 6): always-on, then follow-ups, then the message's own groups (catalog
  // order). routeManifest packs them in this order under the per-request budget. When NOTHING was
  // recognised, every group is a candidate in catalog order (charts first — the page's own
  // controls), so a catalog bigger than one request still sends as much as fits, not just the
  // always-on group; the rest are named and the model can ask for them.
  const own = matched ? GROUPS.map(g => g.id).filter(id => hits.has(id)) : [...soft, ...GROUPS.map(g => g.id)]
  const priority = [...new Set([...always, ...followUps, ...own])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched, soft }
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
