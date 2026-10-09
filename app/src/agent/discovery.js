// ── DISCOVERY: truthful answers to "can you…?" / "what can you do with…?" ──────────────
//
// KNOWING IS NOT DOING. This module answers capability questions DETERMINISTICALLY from:
//   • the live capability registry  — what UCT Agent can execute right now (a topic's `caps`
//     count only if they are actually registered), and
//   • the PRODUCT's own registries  — what UCT has but the Agent cannot operate yet (chart
//     settings classified `known`, the drawing tool schema), and
//   • the roadmap (docs/agent/ROADMAP.md) — what is PLANNED, always worded as future.
// It never executes anything and never calls the model. A roadmap item is never described as
// working; a topic with no registered capability is never "available".
//
// Status of a topic:
//   available  — every part of it the Agent can do now
//   partial    — some of it now; the rest is a known product feature or planned
//   known      — UCT has it, the Agent can't operate it yet
//   planned    — not in UCT or the Agent today; on the roadmap (future)
//   unsupported— neither, and not planned
// agentDiscovery.test.js rails: every topic cap is registered, every registered capability is
// covered by some topic, every planned batch/stage label exists in docs/agent/ROADMAP.md.

import { allCapabilityNames } from './capabilities'
import { CHART_SETTING_DESCRIPTORS } from '../components/chart/chartSettingsDescriptors'
import { SCHEMA as DRAWING_SCHEMA, RETIRED_TYPES } from '../components/chart/drawingSettingsSchema'

const knownSettings = () => CHART_SETTING_DESCRIPTORS.filter(d => d.agent === 'known' && d.label).map(d => d.label)
const drawingTools = () => Object.keys(DRAWING_SCHEMA).filter(t => !RETIRED_TYPES.has(t))
const sample = (xs, n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '))

/**
 * Topics, most specific first (the future-stage topics lead, so “can you backtest my screen?” is about backtesting). `words` are matched against the lowercased question.
 * `canDo` describes ONLY the registered `caps`; `known` lists product features the Agent can't
 * operate; `planned` is a roadmap pointer (future tense only); `productHas` says whether UCT
 * itself offers the feature today.
 */
export const TOPICS = [
  {
    id: 'backtest', title: 'Backtesting',
    words: [/\bback ?test\w*/, /\bsimulat\w+/, /\b(win rate|expectancy|equity curve)\b/, /\bhow (would|did) (this|that|a) strateg/],
    caps: [], productHas: false,
    planned: { when: 'Stage 4', what: 'describing a strategy in words and running it on a deterministic backtest engine with stated assumptions and costs' },
  },
  {
    id: 'vision', title: 'Reading a chart screenshot',
    words: [/\b(screenshot|screen shot|image|picture|photo|png|upload)\w*/, /\brecreate (this|a|my|the) chart\b/],
    caps: [], productHas: false,
    planned: { when: 'Stage 2', what: 'reading a chart screenshot and rebuilding it in UCT, saying what it saw, what it inferred and what it could not tell' },
  },
  {
    id: 'history', title: 'Historical market questions',
    words: [/\b(last time|when was|how often|historically|in the past|all[- ]time high|since \d{4})\b/],
    caps: [], productHas: false,
    planned: { when: 'Stage 3', what: 'answering questions about UCT’s historical data (e.g. “when was breadth this low while QQQ was at a high?”) with explicit definitions and no look-ahead' },
  },
  {
    id: 'arrange', title: 'Moving, resizing and arranging widgets',
    words: [/\b(resiz|rearrang|arrang|repositi|reorgani)\w*/, /\bmove (my |the |a |this )?(\w+ )?(widget|chart|panel|watchlist|scanner)s?\b/, /\b(bigger|smaller|wider|taller|narrower|shorter)\b.*\b(widget|chart|panel)s?\b/, /\b(2x2|grid of|side by side|split (the )?screen)\b/, /\blink\w*\b/],
    caps: ['widget.remove', 'widget.move', 'widget.resize', 'widget.arrange', 'widget.setLink'], productHas: true,
    canDo: 'remove a widget (Undo puts it back exactly), move one (the others re-tile around it, as when you drag), resize one by an edge (the neighbour gives up the space, as when you drag the edge), make widgets fill the empty space or tile them as a grid, columns or rows, and set link colours (gold, blue, green, purple, or not linked)',
    known: () => ['floating, popping out or merging widgets', 'widget tabs on non-chart widgets', 'the extra link colours E–H'],
    planned: null,
  },
  {
    id: 'widgets', title: 'Adding widgets and charts',
    words: [/\bwidgets?\b/, /\badd (a |another |some |\d+ )?(new )?charts?\b/, /\bremove (a |the |this )?(widget|chart)s?\b/, /\bclose (a |the |this )?(widget|chart)s?\b/],
    caps: ['widget.add', 'widget.addCharts', 'widget.showList', 'widget.showScan'], productHas: true,
    canDo: 'add widgets into empty space, add up to 12 charts at once with their symbols, timeframes and chart types (Undo closes what I added), make a Watchlist widget show one of your lists, and make a Scanner widget show one of UCT’s scans',
    known: () => ['other widgets’ settings (news filters, scatter axes, breadth metrics…)'],
    planned: null,
  },
  {
    id: 'layouts', title: 'Saved layouts',
    words: [/\blayouts?\b/, /\bworkspaces?\b/],
    caps: ['layout.current', 'layout.list', 'layout.open', 'layout.saveAs', 'layout.saveCurrent', 'layout.rename', 'layout.create', 'layout.delete', 'layout.duplicate'], productHas: true,
    canDo: 'list, open, save as, rename, duplicate, delete your own layouts, create a new blank one, and save the board into the layout that is open',
    known: () => ['layout version history', 'dock pins', 'sharing a layout'],
    planned: null,
  },
  {
    id: 'customIndicator', title: 'Creating a custom indicator',
    words: [/\b(custom|my own|new|build|write|author)\b.*\b(indicator|formula|study|script)s?\b/, /\b(indicator|formula)s? (from|in) (plain |natural )?(english|words|language)\b/, /\bcreate indicator\b/, /\bpine ?script\b/],
    caps: [], productHas: true,
    known: () => ['Create Indicator (Indicators → + New Formula / Create Indicator), where you describe an indicator and UCT builds it — currently available to admins and a rollout group'],
    planned: { when: 'Batch 7', what: 'handing your request to Create Indicator, together with the Indicator team' },
  },
  {
    id: 'indicators', title: 'Indicators',
    words: [/\bindicators?\b/, /\b(rsi|macd|bollinger|vwap|atr|stochastic|ema|sma|moving averages?|oscillators?|studies|study)\b/, /\bpanes?\b/],
    caps: [], productHas: true,
    known: () => ['the indicator library (Indicators on the chart toolbar): adding, removing, inputs, colours and pane placement'],
    planned: { when: 'Batch 7', what: 'adding and configuring indicators, together with the Indicator team (I only show/hide/remove the built-in Volume pane today)' },
  },
  {
    id: 'drawings', title: 'Drawing tools',
    words: [/\bdraw\w*\b/, /\b(trend ?lines?|horizontal (line|level)s?|fib\w*|rectangles?|channels?|pitchforks?|annotat\w+)\b/],
    caps: [], productHas: true,
    known: () => [`the drawing toolbar (${drawingTools().length} tools: ${sample(drawingTools())})`],
    planned: { when: 'Batch 8', what: 'drawing lines, levels, rectangles and Fibonacci tools from prices and dates you give me' },
  },
  {
    id: 'chartSettings', title: 'Chart appearance and settings',
    words: [/\b(chart )?settings?\b/, /\b(theme|colou?rs?|background|candles?|grid|crosshair|legend|watermark|labels?|markers?|countdown|swing)\b/],
    caps: ['chart.setSetting', 'chart.applyTheme', 'chart.applyThemeAll', 'chart.applyTemplate', 'chart.resetDefaults', 'chart.setBackground', 'chart.setCandleColors', 'volume.setState'], productHas: true,
    canDo: 'apply any UCT chart theme to one chart or to every chart on the board, apply one of your saved chart templates, restore a chart’s default settings, set a solid background or candle colours, show/hide/remove Volume, and change the approved display settings (grid and its colour, crosshair and its colour, scale text, legend, watermark and its size/weight/lines, labels, event markers, swing labels, prev-day lines and their style/width/colour, countdown, title, colour mode, thin bars, inverted scale) — each with Undo',
    known: () => knownSettings(),
    planned: null,
  },
  {
    id: 'charts', title: 'Chart symbol, timeframe, type, scale and session',
    words: [/\b(timeframe|symbol|ticker|chart type|log scale|percent scale|extended hours|pre-?market|post-?market|weekly|daily|monthly|intraday|tabs?|compare|overlay|go to|scroll)\b/],
    caps: ['chart.setSymbol', 'chart.setTimeframe', 'chart.addCustomTimeframe', 'chart.setType', 'chart.setScale', 'chart.setSession', 'chart.goToDate', 'chart.compare', 'chart.addTab', 'chart.selectTab', 'chart.closeTab', 'chart.renameTab', 'chart.linkTab'], productHas: true,
    canDo: 'change a chart’s symbol, timeframe (including custom ones like 45 minutes or 2 days), chart type, scale and regular vs extended hours; scroll it to a past date (view only); overlay comparison symbols; and add, switch, rename, link and close chart tabs — with Undo',
    known: () => ['replay (hiding the bars after a date)', 'removing a custom timeframe from the menu'],
    planned: null,
  },
  {
    id: 'savedScreens', title: 'Saved screens',
    words: [/\bsaved? (screen|scan)\w*/, /\b(screen|scan)s? (i|you) saved\b/, /\bmy (screens|scans)\b/],
    caps: ['screener.listSaved', 'screener.runSaved', 'screener.saveAs', 'screener.duplicateSaved', 'screener.renameSaved', 'screener.deleteSaved'], productHas: true,
    canDo: 'list and run your saved screens and UCT’s starters, save the last screen I ran as a new one, copy, rename and delete your own (copies keep the full definition — filters, sort, ranking and logic)',
    known: () => ['overwriting an existing saved screen (waits on revision protection in the Screener)'],
    planned: { when: 'Batch 9', what: 'overwriting a saved screen once the Screener protects revisions' },
  },
  {
    id: 'screener', title: 'Screener',
    words: [/\bscreen\w*\b/, /\bscan\w*\b/, /\bfilters?\b/, /\bfind (me )?stocks\b/, /\bsort (by|on)\b/],
    caps: ['screener.run', 'screener.state'], productHas: true,
    canDo: 'run screens on UCT’s numeric and yes/no fields with one sort, refine the last screen, and send the results to a watchlist or open them as charts',
    known: () => ['category (enum) fields', 'field-vs-field comparisons', 'formula logic and ranking in new screens', 'custom-date (period) sorting', 'preset scans'],
    planned: { when: 'Batch 9', what: 'advanced conditions, ranking and custom-date sorting' },
  },
  {
    id: 'watchlists', title: 'Watchlists',
    words: [/\bwatch ?lists?\b/, /\blists?\b/],
    caps: ['watchlist.list', 'watchlist.show', 'watchlist.add', 'watchlist.remove', 'watchlist.create', 'watchlist.rename', 'watchlist.clear', 'watchlist.delete'], productHas: true,
    canDo: 'show, create, rename, add to, remove from, clear and delete your watchlists, and copy one into a new list',
    known: () => ['reordering and sorting a list', 'notes', 'tags and colours'],
    planned: { when: 'Batch 10', what: 'reordering, notes and sorting' },
  },
  {
    id: 'alerts', title: 'Alerts',
    words: [/\balerts?\b/, /\bnotify\b/, /\bping me\b/],
    caps: ['alert.list', 'alert.create', 'alert.delete'], productHas: true,
    canDo: 'list your price alerts, create price alerts (above/below a level) and delete them. Note: UCT checks price alerts as live prices are fetched — there is no separate background monitor yet',
    known: () => ['indicator alerts and trendline alerts (owned by the Indicator project)', 'snoozing or re-arming alerts'],
    planned: { when: 'Batch 10', what: 'clearer alert-monitoring wording; indicator alerts later with the Indicator team' },
  },
  {
    id: 'stockInfo', title: 'Stock information and news',
    words: [/\b(news|catalysts?|earnings|profile|fundamentals?|compare|headlines?)\b/],
    caps: ['stock.profile', 'stock.earnings', 'stock.compare', 'news.latest', 'news.catalysts'], productHas: true,
    canDo: 'look up a company’s profile and key numbers, its earnings, compare two stocks, and show the latest news and catalysts',
    known: () => ['calendar, ownership, insider, ETF holdings, breadth, options flow and themes (on their own widgets)'],
    planned: { when: 'Batch 10', what: 'more read-only data questions' },
  },
  {
    id: 'appSettings', title: 'App settings and pages',
    words: [/\b(app theme|dark mode|light mode|default timeframe|alert sound|digest|email)\b/, /\b(open|go to) (the )?\w+ page\b/],
    caps: ['settings.show', 'settings.setAppTheme', 'settings.setDefaultTimeframe', 'settings.setAlertSound', 'settings.setWatchlistDigest', 'app.open'], productHas: true,
    canDo: 'show your settings, change the app theme, default chart timeframe and alert sound, turn the watchlist email digest on or off, and open other UCT pages',
    known: () => [], planned: null,
  },
  {
    id: 'similarity', title: 'Finding similar historical charts',
    words: [/\b(similar|look(s)? like|analog(ue)?s?|same pattern|resembl)\w*/],
    caps: [], productHas: false,
    planned: { when: 'Stage 5', what: 'finding historical setups that look like a chart you pick, with what happened next' },
  },
]

const registeredSet = () => new Set(allCapabilityNames())

/** A topic's status from the LIVE registry (a cap that isn't registered doesn't count). */
export function topicStatus(t, reg = registeredSet()) {
  const live = (t.caps || []).filter(c => reg.has(c))
  const more = (t.known ? t.known() : []).length > 0 || !!t.planned
  if (live.length) return more ? 'partial' : 'available'
  if (t.productHas) return 'known'
  return t.planned ? 'planned' : 'unsupported'
}

export function matchTopic(text) {
  const q = String(text || '').toLowerCase()
  return TOPICS.find(t => t.words.some(re => re.test(q))) || null
}

const LEAD = {
  available: 'Yes —', partial: 'Partly.', known: 'Not yet.', planned: 'Not yet.', unsupported: 'No.',
}

/** The deterministic answer for one topic (plain text). */
export function answerTopic(t, reg = registeredSet()) {
  const status = topicStatus(t, reg)
  const lines = []
  if (status === 'available' || status === 'partial') {
    lines.push(`${LEAD[status]} ${t.title}: I can ${t.canDo}.`)
  } else if (status === 'known') {
    lines.push(`${LEAD[status]} ${t.title} is in UCT, but I can't do it for you yet.`)
  } else if (status === 'planned') {
    lines.push(`${LEAD[status]} ${t.title} isn't something UCT Agent can do today.`)
  } else {
    lines.push(`${LEAD[status]} UCT Agent can't do that.`)
  }
  const known = t.known ? t.known() : []
  if (known.length) lines.push(`In UCT itself (not through me yet): ${sample(known, 8)}.`)
  if (t.planned) lines.push(`Planned for UCT Agent (${t.planned.when}, not available yet): ${t.planned.what}.`)
  return { status, text: lines.join('\n') }
}

/** "What can you do?" — the overview, from the live registry only. */
export function answerOverview(reg = registeredSet()) {
  const now = TOPICS.filter(t => ['available', 'partial'].includes(topicStatus(t, reg)))
  const later = TOPICS.filter(t => !['available', 'partial'].includes(topicStatus(t, reg)) && t.planned)
  return {
    status: 'overview',
    text: [
      'Here is what I can do on Charts right now:',
      ...now.map(t => `• ${t.title}: ${t.canDo}.`),
      `Not yet (planned, not available today): ${later.map(t => t.title.toLowerCase()).join('; ')}.`,
      'Ask “can you …?” about any of these for details.',
    ].join('\n'),
  }
}

export function answerUnknown(reg = registeredSet()) {
  return {
    status: 'unknown',
    text: `I'm not sure UCT has that, and I won't guess. ${answerOverview(reg).text}`,
  }
}

export const TOPIC_IDS = [...TOPICS.map(t => t.id), 'overview', 'other']

export function answerFor(topicId, reg = registeredSet()) {
  if (topicId === 'overview') return answerOverview(reg)
  const t = TOPICS.find(x => x.id === topicId)
  return t ? answerTopic(t, reg) : answerUnknown(reg)
}

// ── the deterministic fast path ──
// A capability QUESTION is answered here without the model. A polite COMMAND ("can you switch
// this to weekly?") is NOT intercepted when the topic is something the Agent can do — it goes on
// to be planned and executed as before.
const OVERVIEW = /^(?:so )?(?:what|which things) (?:else )?(?:can|could) (?:you|uct agent) (?:do|help (?:me )?with)(?: for me| here| on charts)?\??$|^(?:help|what are your capabilities|what do you do)\??$/
const WHAT_WITH = /^(?:what|which things|what else) (?:can|could) (?:you|uct agent) do (?:with|about|for|on) (.+?)\??$/
const CAN_YOU = /^(?:(?:can|could|will|would) (?:you|uct agent)|are you able to|do you (?:support|know how to|have)|is it possible (?:for you )?to)\b(.+?)\??$/

export function fastDiscovery(raw) {
  const q = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (OVERVIEW.test(q)) return { topic: 'overview' }
  const w = WHAT_WITH.exec(q)
  if (w) { const t = matchTopic(w[1]); return { topic: t ? t.id : 'other' } }
  const c = CAN_YOU.exec(q)
  if (c) {
    const t = matchTopic(c[1])
    if (!t) return null                                    // unclear → let the model decide
    const st = topicStatus(t)
    // Executable topics: the member may be ASKING me to do it — never swallow that here.
    return st === 'available' || st === 'partial' ? null : { topic: t.id }
  }
  return null
}
