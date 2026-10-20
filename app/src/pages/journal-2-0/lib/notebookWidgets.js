// Notebook widgets: the client lib (Task 7).
//
// The kinds and the node builder (the fetch and the refresh merge: notebookWidgetsFetch.js). Every snapshot widget is
// fetched once from `GET /api/j2/notebook-widgets/{kind}`, frozen into the node's `params` and
// rendered from those params by its embed (components/notebook/widgets/*Embed.jsx).
//
// ⛔ KEEP THIS FILE LIGHT. WidgetEmbedView imports it, and WidgetEmbedView is on the Notebook's
// first open. It imports widgetEmbedCore (already there) and nothing else. The fetch and the refresh
// merge live in notebookWidgetsFetch.js, which only lazy code imports (Task 16D: first-open bytes).
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'

/** All nine kinds, in menu order. `group` is when a member reaches for it: before the open,
 *  planning a trade, or reviewing. `account` kinds read the member's own account and stay off
 *  public pages unless the member switches `share` on. */
export const WIDGET_KINDS = Object.freeze([
  { id: 'myWatchlistToday', wave: 1, group: 'open', title: 'My watchlist today',
    description: 'Your names: price, move today, earnings soon',
    keywords: ['watchlist', 'names', 'today', 'premarket', 'prep'], account: false },
  { id: 'myNamesReporting', wave: 1, group: 'open', title: 'My names reporting',
    description: 'Earnings this week with expected move',
    keywords: ['earnings', 'reporting', 'expected move', 'implied move'], account: false },
  { id: 'marketOnMyNames', wave: 3, group: 'open', title: 'Market on my names',
    description: 'Which of your names lead or lag their sector',
    keywords: ['sector', 'leading', 'lagging', 'relative strength'], account: false },
  { id: 'tickerCard', wave: 1, group: 'plan', title: 'Ticker card',
    description: 'Price, levels, earnings date, your history',
    keywords: ['ticker', 'card', 'symbol', 'levels', 'history'], account: false },
  { id: 'tickerFlow', wave: 3, group: 'plan', title: 'Options flow on a ticker',
    description: "Today's biggest options trades and bullish vs bearish premium",
    keywords: ['flow', 'options', 'calls', 'puts'], account: false },
  { id: 'myPnlStats', wave: 1, group: 'review', title: 'My P&L and stats',
    description: 'Net P&L, win rate and average R for a range',
    keywords: ['pnl', 'p&l', 'stats', 'win rate', 'review'], account: true },
  { id: 'myPositionsRisk', wave: 1, group: 'review', title: 'My open positions and risk',
    description: 'Size, open P&L, distance to stop',
    keywords: ['positions', 'risk', 'stops', 'open'], account: true },
  { id: 'myRulesCheck', wave: 2, group: 'review', title: 'My rules check',
    description: 'Which rules you kept this week',
    keywords: ['rules', 'discipline', 'checklist'], account: true },
  { id: 'myMistakes', wave: 2, group: 'review', title: 'My recurring mistakes',
    description: 'What your mistakes cost, and the trend',
    keywords: ['mistakes', 'errors', 'cost', 'review'], account: true },
])

/** Notebook widgets Task 16: existing /charts widget kinds the / menu inserts by fetch-and-freeze, through
 *  the SAME insert path as WIDGET_KINDS. Deliberately NOT in WIDGET_KINDS: they are not endpoint snapshots,
 *  so a stored one gets no refresh doors (isSnapshotKind) and renders exactly as before. `cmd` (a symbol)
 *  or `day` is its slash grammar. `capture(params)` loads ONE module, captures/slashCaptures.js, only when
 *  a command runs (R41: one lazy import for every kind, so a new kind costs a row, not a chunk), and
 *  answers `{ok, payload}` or `{ok: false, reason}`; a chunk that fails to load rejects. Every row is
 *  wave 4 under More unless it says otherwise (the defaults are applied once, below: first-open bytes).
 *  `held`: Wave R keeps it dark (widgets/captureRelease.js captureEnabled()); no wave flag releases it. */
const slashCaptures = () => import('../../charts/widgets/captures/slashCaptures')
export const CAPTURE_KINDS = Object.freeze([
  { id: 'calendar', title: 'UCT Terminal day', day: 1,
    description: "Today's earnings and economic events", keywords: ['calendar', 'economic'] },
  { id: 'news', title: 'News and catalysts', cmd: 'news', description: 'Catalysts and headlines as they read now' },
  { id: 'fundamentals', title: 'Fundamentals', cmd: 'fundamentals', description: 'Reported EPS and sales as shown' },
  { id: 'breadth', title: 'Breadth heatmap', description: 'The breadth readings as they stand now' },
  { id: 'indexes', title: 'Index levels', held: 1, description: 'SPY, QQQ, DIA, IWM, BTC and VIX now', keywords: ['indexes'] },
  { id: 'marketcontext', title: 'Market context', held: 1, description: 'Phase, exposure and breadth from the wire' },
  { id: 'alerts', title: 'My price alerts', description: 'Your alerts and where price sits' },
].map((k) => ({ wave: 4, group: 'more', ...k, capture: (p) => slashCaptures().then((m) => m[k.id](p)) })))

const BY_ID = new Map(WIDGET_KINDS.map((k) => [k.id, k]))

/** The kind's entry, or null for an id that is not a Notebook widget. */
export const widgetKind = (id) => BY_ID.get(id) || null
/** Is this widget id one of the snapshot kinds (the embed host hands it the refresh doors)? */
export const isSnapshotKind = (id) => BY_ID.has(id)

/** A frozen widgetEmbed node for one payload, built by the SAME attr constructor every capture
 *  uses (params normalized through the registry, searchText derived from them). */
export function widgetEmbedNode(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return {
    type: 'widgetEmbed',
    attrs: buildWidgetEmbedAttrs(kind, p, { capturedAt: p.asOf, mode: 'snapshot' }),
  }
}
