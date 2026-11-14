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
  // The pattern-engine library, never the base read: the row's setup line names base_catalog's
  // structures, and the two detectors share names (Flat Base, Double Bottom, VCP) while
  // disagreeing about which stocks carry them. "Pattern engine: VCP" says whose verdict it is.
  pattern_engine_id: 'Pattern engine',
  pattern_entry_dist_pct: 'To pattern entry',
  pattern_stop_dist_pct: 'To pattern stop',
  pt_upside_pct: 'To price target',
  body_pct: 'Candle body',
  upper_wick_pct: 'Upper wick',
  lower_wick_pct: 'Lower wick',
  close_position: 'Close in day range',
  candle_type: 'Candle type',
  candle_label: 'Candle',
  // UCT Relative Strength (Phase 2a, 2a-08): the chart's RS line, said plainly. "RS line" is the
  // stock against SPY; "52-week" is the 252-session lookback the chart draws its dots on.
  rs_new_high: 'RS line at a 52-week high',
  rs_nh_before_price: 'RS line at a 52-week high before price',
  rs_nh_red_day: 'RS line at a 52-week high on a red day',
  rs_nh_bars_ago: 'Sessions since the RS high',
  green_on_red_20: 'Up on down days (of 20)',
  rs_line_above_ma: 'RS line above its 21-day avg',
  rs_cross_up_bars_ago: 'Sessions since RS crossed its 21-day avg',
  mansfield: 'Mansfield RS vs 200-day avg',
  mansfield_cross_bars_ago: 'Sessions since Mansfield crossed zero',
  rs_benchmark_agree: 'RS agrees vs SPY and RSP',
  rs_rating_ibd: 'RS rating (IBD-style)',
  rs_rating_chg_5: 'RS rating change, 1 week',
  rs_rating_chg_20: 'RS rating change, 1 month',
  rs_rating_1m: '1-month return rank',
  rs_rating_3m: '3-month average return rank',
  rs_rating_6m: '6-month weighted return rank',
  rs_rating_9m: '9-month weighted return rank',
  rs_rating_12m: '12-month weighted return rank',
  // UCT RS Phase 3 (unit 3-11). The quadrant is read on WEEKLY bars, the other two on daily.
  rrg_quadrant: 'Rotation vs SPY (weekly)',
  clenow_score: 'Clenow trend score (90 days)',
  vars_state: 'Volatility-adjusted RS vs SPY',
  // UCT RS Exit Warnings (Mike Webster's method): the RS line against SPY, daily.
  rs_exit_last: 'Latest RS exit warning',
  rs_exit_bars_ago: 'Sessions since an RS exit warning',
  rs_quicksand_bars_ago: 'Sessions since a Quicksand',
  rs_quick_break_bars_ago: 'Sessions since a Quick Break',
  rs_dead_break_bars_ago: 'Sessions since a Grateful Dead Break',
  // UCT RS screens (unit U1): a place is a position in the liquid-stock ranking, 1 = strongest.
  rs_rating_pos: 'RS Rating place',
  rs_rating_pos_n: 'Stocks ranked',
  rs_rating_pos_prev20: 'Place a month ago',
  rs_pos_1m: '1-month place',
  rs_pos_3m: '3-month place',
  rs_pos_6m: '6-month place',
  rs_pos_12m: '12-month place',
  rs_rating_session: 'Ratings as of',
  rs_rating_score: 'RS Rating score',
  // UCT RS screens (unit U4): the rating a month ago, the RS line's recent highs, the Setup label.
  rs_rating_prev20: 'RS Rating a month ago',
  rs_nh_count_20: 'RS highs in the last 20 sessions',
  rs_nh_quiet: 'Sessions between the last two RS highs',
  rs_nh_red_bars_ago: 'Sessions since an RS high on a market down day',
  rs_nhbp_age: 'Sessions since an RS high ahead of price',
  rs_nh_span: 'How long a high the RS line made',
  px_below_high_pct: 'Below its 52-week closing high',
  rs_setup: 'Setup',
  rs_tight: 'Tight range',
  rs_flag: 'Setup flag',
  rs_near_buy: 'Near a buy point',
  atr_ext_ema21: 'ATRs from 21-day exp. avg',
  pct_vs_ema8: 'vs 8-day exp. avg',
  pct_vs_ema21: 'vs 21-day exp. avg',
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
const sessions = n => `${n} session${n === 1 ? '' : 's'}`
const ratingDelta = (v, span) => v === 0 ? `unchanged in a ${span}` : `${v > 0 ? 'up' : 'down'} ${Math.abs(v)} in a ${span}`
const FACTS = {
  vol_ratio: v => `Volume ${v.toFixed(1)}× avg`,
  rvol_live: v => `Volume ${v.toFixed(1)}× usual by now`,
  adr_pct: v => `Avg daily range ${v.toFixed(1)}%`,
  // UCT Relative Strength (Phase 2a, 2a-08). A flag at 0 is no fact (the pane says what IS, not
  // what is not); an age of 0 is "today"; the rating is "N of 99" so the scale travels with it.
  rs_new_high: v => v === 1 ? 'RS line at a 52-week high' : null,
  rs_nh_before_price: v => v === 1 ? 'RS line at a 52-week high while price is not' : null,
  rs_nh_red_day: v => v === 1 ? 'RS line at a 52-week high on a red day' : null,
  rs_nh_bars_ago: v => v === 0 ? 'RS line at a 52-week high today' : `RS high ${sessions(v)} ago`,
  green_on_red_20: v => `Up on ${v} down day${v === 1 ? '' : 's'} in the last 20 sessions`,
  rs_line_above_ma: v => v === 1 ? 'RS line above its 21-day avg' : 'RS line below its 21-day avg',
  rs_cross_up_bars_ago: v => v === 0 ? 'RS line crossed above its 21-day avg today' : `RS line crossed above its 21-day avg ${sessions(v)} ago`,
  mansfield: v => `Mansfield RS ${v >= 0 ? '+' : ''}${v.toFixed(2)}% vs its 200-day avg`,
  mansfield_cross_bars_ago: v => v === 0 ? 'Mansfield RS crossed zero today' : `Mansfield RS crossed zero ${sessions(v)} ago`,
  rs_benchmark_agree: v => v === 1 ? 'RS slope agrees vs SPY and RSP' : 'RS slope differs vs SPY and RSP',
  rs_rating_ibd: v => `RS rating ${Math.round(v)} of 99`,
  rs_rating_chg_5: v => `RS rating ${ratingDelta(v, 'week')}`,
  rs_rating_chg_20: v => `RS rating ${ratingDelta(v, 'month')}`,
  rs_rating_1m: v => `1-month return rank ${Math.round(v)} of 99`,
  rs_rating_3m: v => `3-month average return rank ${Math.round(v)} of 99`,
  rs_rating_6m: v => `6-month weighted return rank ${Math.round(v)} of 99`,
  rs_rating_9m: v => `9-month weighted return rank ${Math.round(v)} of 99`,
  rs_rating_12m: v => `12-month weighted return rank ${Math.round(v)} of 99`,
  // UCT RS Phase 3 (unit 3-11): the Clenow score is a fraction, so it prints as the number, never a %.
  clenow_score: v => `Clenow trend score ${v.toFixed(2)} over 90 sessions`,
  // RS Exit Warnings: an age of 0 is "today"; a warning is a prompt to review, never "sell".
  rs_exit_bars_ago: v => v === 0 ? 'RS exit warning today' : `RS exit warning ${sessions(v)} ago`,
  rs_quicksand_bars_ago: v => v === 0 ? 'RS Quicksand today' : `RS Quicksand ${sessions(v)} ago`,
  rs_quick_break_bars_ago: v => v === 0 ? 'RS Quick Break today' : `RS Quick Break ${sessions(v)} ago`,
  rs_dead_break_bars_ago: v => v === 0 ? 'RS Grateful Dead Break today' : `RS Grateful Dead Break ${sessions(v)} ago`,
}

export function plainFact(key, v) {
  const f = FACTS[key]
  return f && typeof v === 'number' && Number.isFinite(v) ? f(v) : null
}

// The chart pane's ONE volume fact: the live "by now" reading when the session has one, else the
// completed-session ratio. Never both: two volume numbers side by side read as a contradiction.
export const volumeFact = row => plainFact('rvol_live', row?.rvol_live) || plainFact('vol_ratio', row?.vol_ratio)

// The RS rating said once, with its week's move folded in: "RS rating 94 of 99, up 6 in a week".
// Null when the rating job has not rated the name (no rating, no sentence).
export function rsRatingFact(row) {
  const head = plainFact('rs_rating_ibd', row?.rs_rating_ibd)
  if (!head) return null
  const chg = plainFact('rs_rating_chg_5', row?.rs_rating_chg_5)
  return chg ? `${head}, ${chg.replace(/^RS rating /, '')}` : head
}

// The ONE RS-line fact for a row: the most specific flag that fired, else the line's phase. Never
// two: "at a 52-week high" and "at a 52-week high before price" side by side read as a repeat.
export function rsLineFact(row) {
  return plainFact('rs_nh_before_price', row?.rs_nh_before_price)
    || plainFact('rs_nh_red_day', row?.rs_nh_red_day)
    || plainFact('rs_new_high', row?.rs_new_high)
    || plainFact('rs_line_above_ma', row?.rs_line_above_ma)
}

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

// A pattern-engine filter, said as the ENGINE's verdict: "Pattern engine flagged a VCP", "...flagged
// a flat base". Never "Has a flat base": that is what the base read says (structureSentence), and the
// engine and the base read disagree about which stocks carry the same-named pattern. `label` is the
// preset label the server ships; with none, the delimiter-wrapped detector id (",flat_base,").
// Article by sound: "an" before a vowel, or before an acronym whose first letter's name starts
// with one ("an NR7", "an RSI"), else "a".
export function patternEngineSentence(label, value) {
  const raw = label || String(value ?? '').replace(/^,+|,+$/g, '').replace(/_/g, ' ')
  const name = String(raw).trim().split(' ')
    .map(w => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(' ')
  if (!name) return 'Pattern engine flagged a pattern'
  const first = name.split(' ')[0]
  // An all-caps word is read letter by letter: "an NR7", "a VCP", "a U and R".
  const an = /^[A-Z0-9]+$/.test(first) ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first)
  return `Pattern engine flagged ${an ? 'an' : 'a'} ${name}`
}

// "Flat Base" -> "Flat base": a title read mid-sentence ("Flat base pivot"). Capitalised words after
// the first drop their capital; acronyms, tickers and codes ("3-C", "EMA") keep theirs.
export const sentenceCase = s => String(s ?? '').split(' ')
  .map((w, i) => (i > 0 && /^[A-Z][a-z]+(-[A-Z][a-z]+)*$/.test(w) ? w.toLowerCase() : w)).join(' ')
