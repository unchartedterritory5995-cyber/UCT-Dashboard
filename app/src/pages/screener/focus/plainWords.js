import { chipLabel } from '../chipLabel'

// Plain words for the Focus layout (owner decision 5, 2026-10-14). ONE place: the list's setup
// line, the chart pane's facts and the sort menu all read it, so a column or a structure never
// carries two names on one screen. A column with no entry keeps the label the server's meta gives
// it; a structure with no entry keeps its textbook name.

// "ADR" collides with the "ADRs" type filter, so the range is spelled out.
export const PLAIN_COLUMN_LABELS = {
  vol_ratio: 'Volume vs avg',
  // Live only: today's volume against what the stock usually trades by this minute.
  rvol_live: 'Volume vs usual by now',
  adr_pct: 'Avg daily range',
  adr_pct_1w: 'Avg daily range (5-day)',
  atr_pct: 'Avg true range',
  pct_vs_sma20: 'vs 20-day avg',
  pct_vs_sma50: 'vs 50-day avg',
  pct_vs_sma200: 'vs 200-day avg',
  pct_vs_ema20: 'vs 20-day exp. avg',
  chg_pct_1d: 'Change today',
  // The live overlay's columns (live_tier.LIVE_COLUMNS), named for the receipt's "Live: ..." line.
  chg_pct_ytd: 'Change YTD',
  chg_from_open_pct: 'Change from open',
  gap_pct: 'Gap',
  above_50sma: 'Above 50-day avg',
  ma_stack: 'MA stack',
  atr_ext_sma50: 'ATRs from 50-day avg',
  dist_52w_high_pct: 'From 52-week high',
  dist_52w_low_pct: 'From 52-week low',
  // The live tier sets these from the INTRADAY high while every distance above reads the close,
  // so "New 52-week high" next to "From 52-week high: -0.4%" read as a contradiction. The stock
  // touched the high; it did not necessarily close there.
  new_52w_high: 'Hit a 52-week high',
  dist_20d_high_pct: 'From 20-day high',
  dist_20d_low_pct: 'From 20-day low',
  dist_ath_pct: 'From all-time high',
  new_ath: 'Hit an all-time high',
  pattern_entry_dist_pct: 'To pattern entry',
  pattern_stop_dist_pct: 'To pattern stop',
  pt_upside_pct: 'To price target',
  body_pct: 'Candle body',
  upper_wick_pct: 'Upper wick',
  lower_wick_pct: 'Lower wick',
  close_position: 'Close in day range',
  candle_type: 'Candle type',
  candle_label: 'Candle',
}

export const plainColumnLabel = key => PLAIN_COLUMN_LABELS[key] || null

// Preset labels are written to stand alone ("Over 4%"); mid-sentence the operator word reads
// lowercase ("Avg daily range over 4%"). Only these words: a name, a ticker or an acronym keeps
// its capitals.
const OPERATOR_WORDS = /^(Over|Under|Above|Below|At least|At most|More than|Less than|Between|Within|Up|Down|Near|Rising|Falling|Positive|Negative)\b/
export const lowerOperator = s => String(s ?? '').replace(/^(.*?:\s*)(.*)$/, (m, head, rest) => head + rest.replace(OPERATOR_WORDS, w => w.toLowerCase()))

// The Focus layout's label for an active filter: the shared chip label (the old page's, unchanged)
// with the plain column name and the operator word lowercased. "Avg daily range: over 4%".
export function focusChipLabel(def, spec) {
  if (!def) return ''
  const plain = plainColumnLabel(def.key) || plainColumnLabel(def.column) || def.label
  return lowerOperator(chipLabel({ ...def, label: plain }, spec))
}

// The server's meta with each filter's label said plainly, for the Filters drawer's headings.
// Only labels change; keys, presets and order are the server's. Same object back when nothing moves.
export function plainMeta(meta) {
  if (!Array.isArray(meta?.filters)) return meta
  let moved = false
  const filters = meta.filters.map(f => {
    const plain = plainColumnLabel(f.key) || plainColumnLabel(f.column)
    if (!plain || plain === f.label) return f
    moved = true
    return { ...f, label: plain }
  })
  return moved ? { ...meta, filters } : meta
}

// One short fact per column, for the chart pane's fact line.
const FACTS = {
  vol_ratio: v => `Volume ${v.toFixed(1)}× avg`,
  rvol_live: v => `Volume ${v.toFixed(1)}× usual by now`,
  adr_pct: v => `Avg daily range ${v.toFixed(1)}%`,
}

export function plainFact(key, v) {
  const f = FACTS[key]
  return f && typeof v === 'number' && Number.isFinite(v) ? f(v) : null
}

// The chart pane's ONE volume fact: the live "by now" reading when the session has one, else the
// completed-session ratio. Never both: two volume numbers side by side read as a contradiction.
export const volumeFact = row => plainFact('rvol_live', row?.rvol_live) || plainFact('vol_ratio', row?.vol_ratio)

// Structure names that are trader shorthand, said plainly. The textbook name stays in the tooltip
// (setupLine's tooltipFor). Keys are the library's labels exactly as base_catalog ships them; a
// label with no entry keeps its textbook name. Each plain name is a noun phrase in sentence case,
// so it reads after "Has a" in the why strip; the ones that cannot are in STRUCTURE_SENTENCES.
export const PLAIN_STRUCTURE_NAMES = {
  'Cheat (3-C)': 'Early entry inside a cup (3-C)',
  'Low Cheat': 'Early entry low in a base',
  'EMA Crossback': 'Pullback through the 9- and 20-day avgs',
  'Wyckoff Spring': 'Dip below the range floor, then reclaimed',
  'Three Weeks Tight': 'Three tight weekly closes',
  'Stage 4 Breakdown': 'Breaking down in a downtrend',
  'Square Box': 'Short boxy base',
  'Green Line Breakout': 'Breakout above its highest monthly high',
  'Saucer': 'Long, shallow rounded base',
  'Ugly Double Bottom': 'Double bottom with a higher second low',
  'Darvas Box': 'Price box with a set ceiling and floor',
  'Pocket Pivot': 'Up day on more volume than recent selling',
  'Buyable Gap-Up': 'Big gap up that held',
  'Climax Top': 'Exhaustion run after a long advance',
  // The trend SHAPES: every stock carries exactly one. They describe the trend, never a setup.
  'Advancing Structure': 'Uptrend: higher highs and lows',
  'Declining Structure': 'Downtrend: lower highs and lows',
  'Contracting Range': 'Range narrowing',
  'Expanding Range': 'Range widening',
  'Undefined Structure': 'No clear trend',
}

// The trend shapes (base_catalog's SHAPES axis): a description of the trend, not a setup.
export const TREND_SHAPES = new Set(['Advancing Structure', 'Declining Structure', 'Contracting Range', 'Expanding Range', 'Undefined Structure'])

export const plainStructure = name => PLAIN_STRUCTURE_NAMES[name] || name

// "Has a …" reads wrong for a state ("Has a Declining Structure") or a plural ("Has a Three tight
// weekly closes"), so those say what the stock is doing instead.
const STRUCTURE_SENTENCES = {
  'Three Weeks Tight': 'Has three tight weekly closes',
  'Stage 4 Breakdown': 'Breaking down in a downtrend',
  'Advancing Structure': 'In an uptrend: higher highs and lows',
  'Declining Structure': 'In a downtrend: lower highs and lows',
  'Contracting Range': 'Its swing range is narrowing',
  'Expanding Range': 'Its swing range is widening',
  'Undefined Structure': 'No clear trend in its swings',
}

// A structure filter, said as what the stock has. A plain name is sentence case, so its first word
// drops its capital mid-sentence; a textbook name ("Inside Day") keeps its capitals.
export function structureSentence(label) {
  if (STRUCTURE_SENTENCES[label]) return STRUCTURE_SENTENCES[label]
  const plain = PLAIN_STRUCTURE_NAMES[label]
  const name = plain ? plain.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()) : String(label ?? '')
  return `Has ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
}

// "Flat Base" -> "Flat base": a title read mid-sentence ("Flat base pivot"). Capitalised words after
// the first drop their capital; acronyms, tickers and codes ("3-C", "EMA") keep theirs.
export const sentenceCase = s => String(s ?? '').split(' ')
  .map((w, i) => (i > 0 && /^[A-Z][a-z]+(-[A-Z][a-z]+)*$/.test(w) ? w.toLowerCase() : w)).join(' ')
