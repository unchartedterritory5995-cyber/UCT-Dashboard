// Market Context widget — the pure model. The `/api/breadth` payload in, the
// reading set the widget renders AND freezes out. Kept beside the component so
// the live board and a frozen note embed resolve through ONE derivation.
// The .js extension lets the Node parity rail (tests/test_trader_blocks_market_context.py) load this as is.
import { REGIME_WORDS } from '../../journal-2-0/lib/blocks/regimeWords.js'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round1 = (v) => (num(v) == null ? null : Math.round(v * 10) / 10)

/** The wire payload → the frozen reading set. The field names mirror
 *  `engine._normalize_breadth` + `_normalize_exposure`. */
export function readingsFrom(breadth) {
  const b = breadth && typeof breadth === 'object' ? breadth : {}
  const exp = b.exposure && typeof b.exposure === 'object' ? b.exposure : {}
  return {
    marketPhase: typeof b.market_phase === 'string' && b.market_phase ? b.market_phase : null,
    exposureScore: round1(exp.score),
    exposureDelta: round1(exp.score_delta),
    breadthScore: round1(b.breadth_score),
    distributionDays: num(b.distribution_days),
    pctAbove50: round1(b.pct_above_50ma),
    pctAbove200: round1(b.pct_above_200ma),
    // ⛔ NULL BY OWNER DIRECTION (2026-04-17): "rule not yet defined". It is
    // written here unconditionally and reads NOTHING off the payload, so a
    // future wire that starts publishing a power-trend-shaped field cannot
    // start populating it by accident. Turning this on is a decision, not a
    // data change. Renders as an em dash; do not derive one, do not hide the
    // row — the row is the record that the reading is UNDEFINED, not missing.
    powerTrend: null,
  }
}

// Row order + copy. `fmt` turns a reading into its displayed string; a null
// reading never reaches it (the renderer emits the em dash instead).
export const CONTEXT_ROWS = [
  { key: 'marketPhase', label: 'Market phase', fmt: (v) => String(v) },
  { key: 'exposureScore', label: 'UCT Exposure', fmt: (v) => String(v), delta: 'exposureDelta' },
  { key: 'breadthScore', label: 'Breadth score', fmt: (v) => String(v) },
  { key: 'distributionDays', label: 'Distribution days', fmt: (v) => String(v) },
  { key: 'pctAbove50', label: '% above 50-day', fmt: (v) => `${v}%` },
  { key: 'pctAbove200', label: '% above 200-day', fmt: (v) => `${v}%` },
  { key: 'powerTrend', label: 'Power trend', fmt: (v) => String(v) },
]

/** A finite number, else null — shared by the renderer's delta tint. */
export const finite = num

// ── Notebook P2a: the market context STAMP (a note's frozen capture, IR-S6) ──────────────────────
// The stamp adds sourced fields to the same `readings` object. A key a capture does not hold renders
// NO row, so an older capture and every /charts board reading look exactly as before. Each sourced
// field is {value, source, asOf, missing}, and `missing` is a SENTENCE (IR-S4) — never rendered as
// an object: anything else reads "Not available.".
// ⛔ REGIME_WORDS is ONE map (M2, R-M2-1 e): the option labels of builtin:regime_at_write, owned by
// journal-2-0/lib/blocks/regimeWords.js and shared with the position sizing block. Re-exported, never restated.
export { REGIME_WORDS }
export const SOURCED_ROWS = Object.freeze([
  { key: 'regime', label: 'Regime' }, { key: 'spy', label: 'SPY' },
  { key: 'qqq', label: 'QQQ' }, { key: 'vix', label: 'VIX' },
])
// ⛔ The keys ARE the `fields` options of journalBlocks.js's marketcontext setting (S20, railed by
// marketContextModel.test.js); registry.js's paramsSchema carries the same three, railed too.
export const FIELD_SETS = Object.freeze({
  all: { context: CONTEXT_ROWS.map((r) => r.key), sourced: ['regime', 'spy', 'qqq', 'vix'] },
  regime: { context: CONTEXT_ROWS.map((r) => r.key), sourced: ['regime'] },
  indexes: { context: [], sourced: ['spy', 'qqq', 'vix'] },
})
export const UNCAPTURED_SENTENCE = 'Market context is captured when a note is created. This note was written before it had one.'

/** The preset a stored `fields` names; an unknown one (a newer version's) shows everything. */
export const presetFor = (fields) =>
  (typeof fields === 'string' && Object.prototype.hasOwnProperty.call(FIELD_SETS, fields) ? FIELD_SETS[fields] : FIELD_SETS.all)

const ET = 'America/New_York'
const etParts = (iso) => {
  const d = new Date(iso)
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return null
  return {
    day: d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric', year: 'numeric' }),
    // Newer ICU puts a narrow no-break space before AM/PM; the stamp's words use a plain one.
    clock: `${d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ')} ET`,
  }
}
// A bare YYYY-MM-DD is already an ET day (the wire's run date): shown as stored.
const etWhen = (iso) => {
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const p = etParts(iso)
  return p ? `${p.day}, ${p.clock}` : null
}

// The regime's stored `source` is a server code path (entry_context's SRC_REGIME): the member reads
// what it IS, the wire's UCT Exposure Rating, never the path.
const REGIME_SOURCE = 'UCT Exposure Rating'
const PRICE_SOURCE_WORDS = { 'live price': 'Live price', 'last close': 'Last close' }
const priceSourceWords = (s) => {
  if (typeof s !== 'string' || !s) return null
  const key = s.trim().toLowerCase()
  if (PRICE_SOURCE_WORDS[key]) return PRICE_SOURCE_WORDS[key]
  // A plain-words label passes; anything shaped like code (dots, underscores, brackets) does not.
  return /^[A-Za-z][A-Za-z ',&-]*$/.test(s.trim()) ? s.trim()[0].toUpperCase() + s.trim().slice(1) : 'Quoted price'
}

const NOT_AVAILABLE = (f) => ({
  text: typeof f.missing === 'string' && f.missing ? f.missing : 'Not available.', missing: true, asOfText: null,
})

/** One sourced field -> the words a member reads: the value line, whether it is a missing sentence
 *  (rendered muted), and the source line (its source, worded, and its ET date). */
export function sourcedText(key, field) {
  const f = field && typeof field === 'object' ? field : {}
  if (f.value == null) return NOT_AVAILABLE(f)
  if (key === 'regime') {
    // R-T9-1: an OWN key only — `REGIME_WORDS['constructor']` is a function, not a word; an id this
    // table does not hold is not a regime this client can name.
    if (typeof f.value !== 'string' || !Object.prototype.hasOwnProperty.call(REGIME_WORDS, f.value)) return NOT_AVAILABLE({})
    const when = etWhen(f.asOf)
    return { text: REGIME_WORDS[f.value], missing: false,
      asOfText: `${REGIME_SOURCE}${when ? `, as of ${when}` : ''}` }
  }
  const p = typeof f.value?.price === 'number' && Number.isFinite(f.value.price) ? f.value.price : null
  if (p == null) return NOT_AVAILABLE({})
  const c = f.value.changePct
  // R-T3-5: a null change is UNAVAILABLE, never 0.00% and never blank.
  const change = typeof c === 'number' && Number.isFinite(c)
    ? ` (${c > 0 ? '+' : ''}${c.toFixed(2)}%)` : ' · change unavailable'
  const at = etParts(f.asOf)
  const when = f.value.closed ? 'last close' : (at ? `as of ${at.clock}` : 'time unknown')
  const words = priceSourceWords(f.source) || (f.value.closed ? 'Last close' : null)
  return { text: `${p.toFixed(2)}${change} · ${when}`, missing: false,
    asOfText: words ? `${words}${at ? `, ${at.day}, ${at.clock}` : ''}` : (at ? `${at.day}, ${at.clock}` : null) }
}
