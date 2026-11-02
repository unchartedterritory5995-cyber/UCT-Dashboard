// SC-2 §7 (owner: agent-sc) — the DETERMINISTIC intent layer: trader language → ONE SC-1 screen, or an honest exit.
//
//   intent(message, { fields, last }) →
//     { kind: 'spec', args, delta, used }   every word accounted for; `args` is exactly screener.run's arguments
//     { kind: 'ask', slot, question }       clearly a screen, but one slot has two readings (local, no model call)
//     { kind: 'refuse', reason, sentence }  SC-1 / SC-2 §6 refusals (indicator conditions, no field, flow fields)
//     { kind: 'planner', why, leftover }    anything it cannot FULLY account for: the existing model path, unchanged
//
// ⛔ ZERO FALSE RESOLVES is the contract (SC-2 §5). The layer answers only when EVERY word of the message is either
// matched by a rule below or is filler; one unknown word sends the message to the planner. It never drops a word,
// never substitutes a nearby field, and never invents a default that is not in SC-2 §4.
// Every field it names is checked against the live catalog (`fields`, the keys GET /api/screener/fields served);
// a rule whose field the catalog does not hold is not applied (→ planner).
// Pure: no network, no state, no clock. NOT wired anywhere yet — agent-lead wires the fast-path hook (SC-2 §7).

const TIME = /\b(today|right now|now|this morning|so far)\b/
const N = '(\\d+(?:\\.\\d+)?)'
const AMT = '\\$?\\s?(\\d+(?:\\.\\d+)?)\\s?(k|m|mm|million|b|bn|billion|t|trillion)?\\b'
const SCALE = { k: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 }
const amount = (n, unit) => Number(n) * (unit ? SCALE[unit] : 1)
const cmp = (w) => (/^(under|below|less than|<)/.test(w) ? 'lt' : /at least|>=/.test(w) ? 'gte' : 'gt')

const F = (field, op, value, max = null, values = null) => ({ field, op, value, max, values })
const bool = (field, yes = true) => F(field, 'eq', yes ? 1 : 0)
const UNIVERSE_KEYS = new Set(['sector', 'industry', 'theme'])
const SEMIS = () => F('industry', 'in', null, null, ['Semiconductors'])
const SOFTWARE = () => F('industry', 'in', null, null, ['Software - Application', 'Software - Infrastructure'])
const TECH = () => F('sector', 'in', null, null, ['Technology'])
const ENERGY = () => F('sector', 'in', null, null, ['Energy'])
const WINDOW = { day: 'chg_pct_1d', today: 'chg_pct_1d', week: 'chg_pct_1w', month: 'chg_pct_1m', '3 months': 'chg_pct_3m',
  'three months': 'chg_pct_3m', '6 months': 'chg_pct_6m', year: 'chg_pct_1y', ytd: 'chg_pct_ytd' }
const RIP = { chg_pct_1d: 5, chg_pct_1w: 10, chg_pct_1m: 20 }                       // SC-2 §4 PROPOSED
const REMOVE_WORDS = { rs: ['rs_rank'], price: ['price'], adr: ['adr_pct'], volume: ['vol_ratio', 'rvol_live'],
  'market cap': ['market_cap'], size: ['market_cap'], liquidity: ['dollar_vol_30d', 'dollar_vol_1d'] }

// Words that carry no screen meaning. Anything else left over sends the message to the planner.
const FILLER = new Set(('stocks stock names name companies company show me find screen screens for with and the that are '
  + 'is in of their a an on to have has which what whats all any list ones those these them only just now same thing also '
  + 'plus please give get i want looking look by trading traded trade yesterday today this morning right so far it').split(' '))

// SC-1 / SC-2 §6 refusals, checked first on the whole message.
const REFUSALS = [
  [/\bcross(es|ed|ing|over|overs)?\b|\bmacd\b|\bcustom\b[\w\s]*\bindicator\b|\bindicator\b[\w\s]*\bscan\b/, 'indicator-condition scans',
    "Scans on indicator conditions (crosses, MACD, custom indicators) aren't available in UCT Agent yet."],
  [/\bput\s*\/?\s*call\b/, 'the Screener has no field', "The Screener doesn't have a put/call ratio."],
  [/\bdark\s*pool\b|\boptions?\s+flow\b/, 'flow fields need owner approval',
    "Dark pool and options-flow screens aren't available in UCT Agent yet."],
]

// [regex, effect(m, ctx) → { f?, uni?, sort?, remove?, show?, ask?, replaceLast?, reset?, mark? }]
// Ordered: the most specific phrase first; each match is CONSUMED (blanked) so a later rule cannot reuse its words.
const RULES = [
  [/\bstart over\b/, () => ({ reset: true })],
  [/\bstrongest sectors'? leaders\b/, () => ({ f: [F('sector_rs_pct', 'gte', 80), F('rs_rank', 'gte', 80)] })],
  [/\bpullbacks? to the 20[- ]?(day )?ema( in (an )?uptrends?)?\b/, () => ({ f: [F('pct_vs_ema20', 'gte', -2), F('pct_vs_ema20', 'lte', 2), bool('ema20_rising')] })],
  [/\bema stack intact\b/, () => ({ f: [bool('ema_stack_intact')] })],
  [/\brs line trending up\b/, () => ({ f: [F('rs_line_trend', 'in', null, null, ['up'])] })],
  [/\bin (an )?uptrends?\b|\buptrends?\b/, () => ({ f: [bool('ema_stack_intact')] })],
  [/\bstage ?2\b/, () => ({ f: [bool('stage2')] })],
  [/\babove the 50[- ]?day( moving average| sma| ma)?\b/, () => ({ f: [bool('above_50sma')] })],
  [/\bno etfs?\b|\bexclude etfs?\b/, () => ({ f: [bool('is_etf', false)], mark: 'narrow' })],
  [/\bs&p ?500\b/, () => ({ f: [bool('index_sp500')] })],
  [/\bnasdaq ?100\b/, () => ({ f: [bool('index_ndx')] })],
  // liquidity / dollar volume
  // agent-lead ruling: "a day" / "per day" with no session named = the 30-day average; a NAMED session = that session
  [new RegExp(`\\b(?:over|above|more than) ${AMT}(?: of dollar volume)? (yesterday|today|last session)\\b`), (m) => ({ f: [F('dollar_vol_1d', 'gt', amount(m[1], m[2]))] })],
  [new RegExp(`\\b(?:over|above|more than) ${AMT} (?:a|per) day\\b`), (m) => ({ f: [F('dollar_vol_30d', 'gt', amount(m[1], m[2]))] })],
  [/\b(very|highly) liquid\b/, () => ({ f: [F('dollar_vol_30d', 'gte', 100000000)] })],
  [/\bliquid\b|\btradable\b/, () => ({ f: [F('dollar_vol_30d', 'gte', 20000000)] })],
  // size
  [new RegExp(`\\bmarket cap (under|below|over|above|less than|more than) ${AMT}`), (m) => ({ f: [F('market_cap', cmp(m[1]), amount(m[2], m[3]))] })],
  [new RegExp(`\\b(small|large|mid|mega|big)[- ]?caps?(?: (under|below|over|above) ${AMT})?`), (m) => {
    if (m[2]) return { f: [F('market_cap', cmp(m[2]), amount(m[3], m[4]))] }
    const s = m[1]
    if (s === 'small') return { f: [F('market_cap', 'lt', 2e9)] }
    if (s === 'mid') return { f: [F('market_cap', 'gte', 2e9), F('market_cap', 'lte', 1e10)] }
    if (s === 'mega') return { f: [F('market_cap', 'gt', 2e11)] }
    return { f: [F('market_cap', 'gt', 1e10)] }
  }],
  [new RegExp(`\\b(over|above|under|below) \\$?${N} ?(billion|bn|trillion)\\b`), (m) => ({ f: [F('market_cap', cmp(m[1]), amount(m[2], m[3]))] })],
  // price
  [new RegExp(`\\bdrop anything (under|below) \\$${N}\\b`), (m) => ({ f: [F('price', 'gte', Number(m[2]))], mark: 'narrow' })],
  [new RegExp(`\\bbetween \\$${N} and \\$${N}\\b`), (m) => ({ f: [F('price', 'gte', Number(m[1])), F('price', 'lte', Number(m[2]))] })],
  [new RegExp(`\\b(?:price )?(over|above|under|below|less than|more than) \\$${N}(?! ?(?:k|m|mm|million|b|bn|billion))\\b`), (m) => ({ f: [F('price', cmp(m[1]), Number(m[2]))] })],
  [new RegExp(`\\b(under|below) ${N} bucks\\b`), (m) => ({ f: [F('price', 'lt', Number(m[2]))] })],
  [new RegExp(`\\bprice (over|above|under|below) ${N}\\b`), (m) => ({ f: [F('price', cmp(m[1]), Number(m[2]))] })],
  // strength
  [new RegExp(`\\brs(?: rank)? (above|over|of at least|at least) ${N}\\b`), (m) => ({ f: [F('rs_rank', /least/.test(m[1]) ? 'gte' : 'gt', Number(m[2]))] })],
  [/\btop rs names\b|\bstrong rs\b|\bleaders\b|\bstrong\b/, () => ({ f: [F('rs_rank', 'gte', 80)] })],
  // location
  [new RegExp(`\\bwithin ${N} ?% of (?:their |the )?20[- ]?day high\\b`), (m) => ({ f: [F('dist_20d_high_pct', 'lte', Number(m[1]))] })],
  [/\bmaking new (52[- ]week )?highs\b|\bnew (52[- ]week )?highs\b/, () => ({ f: [bool('new_52w_high')] })],
  [/\bnear (their |the )?(52[- ]week )?highs?\b/, () => ({ f: [F('dist_52w_high_pct', 'lte', 5)] })],
  // volume (SC-1 §2c): a time word → rvol_live "at this time of day", sorted; none → vol_ratio, the full session
  [/\bsort by (relative volume|rvol)\b/, () => ({ sort: { key: 'rvol_live', dir: 'desc' } })],
  [/\bvolume dried up(?: to a (\d+)[- ]week low)?\b/, (m) => ({ f: [F('vol_nweek_low', 'gte', Number(m[1] || 4))] })],
  [new RegExp(`\\b(?:at least )?${N} ?x (?:their )?(?:average|normal|avg)(?: volume)?\\b|\\bvolume (?:at least )?${N} ?x (?:average|normal)\\b`),
    (m, c) => { const n = Number(m[1] || m[2]); return c.time ? { f: [F('rvol_live', 'gte', n)], sort: { key: 'rvol_live', dir: 'desc' } } : { f: [F('vol_ratio', 'gte', n)] } }],
  [/\bunusual volume\b/, (m, c) => (c.time ? { sort: { key: 'rvol_live', dir: 'desc' } } : { f: [F('vol_ratio', 'gte', 2)] })],
  [/\bvolume picking up\b/, (m, c) => (c.time ? { f: [F('rvol_live', 'gte', 1.5)], sort: { key: 'rvol_live', dir: 'desc' } } : { f: [F('vol_ratio', 'gte', 1.5)] })],
  [/\bon volume\b/, (m, c) => (c.time ? null : { f: [F('vol_ratio', 'gte', 1.5)] })],
  [/\bvolume up\b/, (m, c) => (c.time ? null : { ask: { slot: 'volume', question: 'Volume vs its 30-day average for the full last session, or so far today at this time of day?' } })],
  // performance
  [new RegExp(`\\bup (?:more than |over )?${N} ?% (?:this |in the past |over the past |in |in the last )?(day|week|month|3 months|three months|6 months|year|ytd)\\b`),
    (m) => ({ f: [F(WINDOW[m[2]], 'gt', Number(m[1]))] })],
  [/\bripp\w* (today|this week|this month)\b/, (m) => { const k = WINDOW[m[1].replace('this ', '')]; return { f: [F(k, 'gte', RIP[k])] } }],
  [new RegExp(`\\bgapping up (?:more than |over )?${N} ?%( today)?`), (m) => ({ f: [F('gap_pct', 'gt', Number(m[1]))] })],
  [/\b(?:are )?up today\b/, () => ({ f: [F('chg_pct_1d', 'gt', 0)] })],
  [/\b(?:are )?down today\b/, () => ({ f: [F('chg_pct_1d', 'lt', 0)] })],
  [/\btop (3|6)[- ]month performers\b/, (m) => ({ sort: { key: `chg_pct_${m[1]}m`, dir: 'desc' } })],
  [/\bsorted by rs\b|\bsort by rs\b/, () => ({ sort: { key: 'rs_rank', dir: 'desc' } })],
  [/\bbiggest movers first\b/, () => ({ sort: { key: 'chg_pct_1d', dir: 'desc' } })],
  // fundamentals / events
  [new RegExp(`\\beps growth (?:above|over) ${N} ?%`), (m) => ({ f: [F('eps_growth', 'gt', Number(m[1]))] })],
  [new RegExp(`\\brevenue growth (?:above|over) ${N} ?%`), (m) => ({ f: [F('rev_growth', 'gt', Number(m[1]))] })],
  [new RegExp(`\\boperating margins? (?:above|over) ${N} ?%`), (m) => ({ f: [F('op_margin', 'gt', Number(m[1]))] })],
  [/\bfast growers\b/, () => ({ f: [F('rev_growth', 'gte', 25)] })],
  [new RegExp(`\\bshort float (?:above|over) ${N} ?(?:%|percent)`), (m) => ({ f: [F('short_float_pct', 'gt', Number(m[1]))] })],
  [/\bheavily shorted\b/, () => ({ f: [F('short_float_pct', 'gt', 20)] })],
  [new RegExp(`\\breporting earnings in the next ${N} days\\b`), (m) => ({ f: [F('days_to_earnings', 'gte', 0), F('days_to_earnings', 'lte', Number(m[1]))] })],
  [/\boversold\b/, () => ({ f: [F('rsi14', 'lt', 30)] })],
  [/\boverbought\b/, () => ({ f: [F('rsi14', 'gt', 70)] })],
  [new RegExp(`\\brsi(?:14)? (over|above|under|below) ${N}\\b`), (m) => ({ f: [F('rsi14', cmp(m[1]), Number(m[2]))] })],
  // setups / volatility
  [/\bnr7( days)?\b/, () => ({ f: [bool('nr7')] })],
  [/\btight (consolidations?|setups?)\b/, () => ({ f: [bool('tight_consolidation')] })],
  [new RegExp(`\\badr ${N} to ${N} ?(?:%|percent)`), (m) => ({ f: [F('adr_pct', 'gte', Number(m[1])), F('adr_pct', 'lte', Number(m[2]))] })],
  [new RegExp(`\\bhigh adr(?: stocks)?,? (?:above|over) ${N} ?%`), (m) => ({ f: [F('adr_pct', 'gt', Number(m[1]))] })],
  [new RegExp(`\\badr (?:above|over) ${N} ?%`), (m) => ({ f: [F('adr_pct', 'gt', Number(m[1]))] })],
  [/\bhigh adr\b/, () => ({ f: [F('adr_pct', 'gt', 5)] })],
  // universe
  [/\bsemis?\b|\bsemiconductors?\b|\bchips?\b/, () => ({ uni: [SEMIS()] })],
  [/\bsoftware\b/, () => ({ uni: [SOFTWARE()] })],
  [/\btech(nology)?\b/, () => ({ uni: [TECH()] })],
  [/\benergy\b/, () => ({ uni: [ENERGY()] })],
  [/\bfinancials?\b/, () => ({ ask: { slot: 'universe', question: 'The Financial Services sector, or banks only?' } })],
  // follow-up only
  [/\bshow me (\d+)\b/, (m) => ({ show: Number(m[1]) })],
  [/\b(?:forget|drop|remove|without) the (rs|price|adr|volume|market cap|size|liquidity)(?: filter| limit| condition)?\b/, (m) => ({ remove: REMOVE_WORDS[m[1]], removeWord: m[1] })],
  [new RegExp(`\\bmake that ${N}\\b`), (m) => ({ replaceLast: Number(m[1]) })],
  [/\bsame thing in\b|\bnow just\b/, () => ({ mark: 'replace_universe' })],
]

// A message that only makes sense against a previous screen.
const REFERS = /^(only|just)\b|\b(those|them|the ones)\b|^(sort|forget|without|remove|drop|make that|same thing|now just|biggest|show me \d+)\b/
const CONTINUES = /^(and|also|plus|no)\b/

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[’']s\b/g, 's').replace(/[“”"?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()} `

/** The deterministic reading of one message. `fields`: Set of catalog keys; `last`: the last screen's args or null. */
export function intent(message, { fields = null, last = null } = {}) {
  let text = norm(message)
  if (text.trim() === '') return { kind: 'planner', why: 'empty' }
  for (const [re, reason, sentence] of REFUSALS) if (re.test(text)) return { kind: 'refuse', reason, sentence }
  const t0 = text.trim()
  const refers = REFERS.test(t0)
  const ctx = { time: TIME.test(text) }
  const out = { f: [], uni: [], sort: null, remove: [], show: null, marks: [], reset: false, replaceLast: null, used: [] }
  for (const [re, fn] of RULES) {
    const g = new RegExp(re.source, 'g')
    let m
    while ((m = g.exec(text)) !== null) {
      const eff = fn(m, ctx)
      if (!eff) continue
      if (eff.ask) return { kind: 'ask', ...eff.ask }
      out.used.push(m[0].trim())
      if (eff.f) out.f.push(...eff.f)
      if (eff.uni) out.uni.push(...eff.uni)
      if (eff.sort) out.sort = eff.sort
      if (eff.remove) { out.remove.push(...eff.remove); out.removeWord = eff.removeWord }
      if (eff.show != null) out.show = eff.show
      if (eff.mark) out.marks.push(eff.mark)
      if (eff.reset) out.reset = true
      if (eff.replaceLast != null) out.replaceLast = eff.replaceLast
      text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length)
      g.lastIndex = m.index + m[0].length
    }
  }
  const leftover = text.split(/\s+/).filter(w => w && !FILLER.has(w))
  if (leftover.length) {
    if (leftover.some(w => /^(over|above|under|below)$/.test(w)) && leftover.some(w => /^\$?\d/.test(w)) && leftover.length <= 3)
      return { kind: 'ask', slot: last || refers ? 'follow_up' : 'price', question: 'Which measure is that number for? For example: price above $20.' }
    return { kind: 'planner', why: 'words the intent layer does not read', leftover }
  }
  const nothing = !out.f.length && !out.uni.length && !out.sort && !out.remove.length && out.show == null && out.replaceLast == null
  if (nothing) return { kind: 'planner', why: 'no screen criteria' }
  // the catalog decides: a rule whose field this catalog does not hold is never applied
  if (fields) {
    const named = [...out.f, ...out.uni].map(x => x.field).concat(out.sort ? [out.sort.key] : [])
    const missing = named.filter(k => !fields.has(k))
    if (missing.length) return { kind: 'planner', why: 'a field the catalog does not hold', leftover: missing }
  }
  const followUp = !out.reset && (refers || (last && (CONTINUES.test(t0) || out.marks.length || out.remove.length || out.show != null || out.replaceLast != null
    || (!out.f.length && !out.uni.length && out.sort))))
  if (followUp && !last) return { kind: 'ask', slot: 'follow_up', question: 'Which screen should I change? Run one first, for example: liquid semis above the 50-day.' }
  if (!followUp) {
    if (out.remove.length || out.show != null || out.replaceLast != null) return { kind: 'planner', why: 'a follow-up word in a new screen' }
    return { kind: 'spec', delta: out.reset ? 'reset' : 'new', used: out.used,
      args: { filters: [...out.f, ...out.uni], sort_field: out.sort?.key || null, sort_dir: out.sort?.dir || null, mode: 'new', show: null, as: null, within: null } }
  }
  return followUpSpec(out, last)
}

/** A follow-up applied to the last screen's args → the WHOLE new args, sent as `mode: new` (the spec is complete, so
 *  screener.run must not merge it with the last screen again; a merge would re-add a removed filter). The step itself
 *  follows refine semantics: a filter on a key it names REPLACES the old ones on that key. */
function followUpSpec(out, last) {
  let filters = [...(last.filters || [])]
  let delta = 'add'
  if (out.remove.length) {
    const keys = new Set(out.remove)
    if (!filters.some(f => keys.has(f.field))) return { kind: 'ask', slot: 'follow_up', question: `Your last screen has no ${out.removeWord} filter.` }
    filters = filters.filter(f => !keys.has(f.field))
    delta = 'remove'
  }
  if (out.replaceLast != null) {
    const nums = filters.filter(f => ['gt', 'gte', 'lt', 'lte'].includes(f.op))
    if (nums.length !== 1) return { kind: 'ask', slot: 'follow_up', question: 'Which condition should be that number?' }
    filters = filters.map(f => (f === nums[0] ? { ...f, value: out.replaceLast } : f))
  }
  if (out.uni.length) {
    filters = filters.filter(f => !UNIVERSE_KEYS.has(f.field))
    delta = 'replace_universe'
  }
  if (out.f.length) {
    const mine = new Set(out.f.map(f => f.field))
    filters = [...filters.filter(f => !mine.has(f.field)), ...out.f]
    if (out.marks.includes('narrow')) delta = 'narrow'
  }
  filters = [...filters, ...out.uni]
  if (out.sort && !out.f.length && !out.uni.length && !out.remove.length) delta = 'sort'
  if (out.show != null && !out.f.length && !out.uni.length && !out.sort) delta = 'show'
  return { kind: 'spec', delta, used: out.used, args: { filters, sort_field: out.sort?.key ?? last.sort_field ?? null,
    sort_dir: out.sort?.dir ?? last.sort_dir ?? null, mode: 'new', show: out.show ?? last.show ?? null, as: null, within: null } }
}

/** screener.run args → criteria leaves in the Screener grammar's shape (for measurement and receipts). */
export function argsToLeaves(args) {
  return (args?.filters || []).flatMap((f) => {
    if (f.op === 'gt' || f.op === 'gte') return [{ key: f.field, op: f.op, min: f.value }]
    if (f.op === 'lt' || f.op === 'lte') return [{ key: f.field, op: f.op, max: f.value }]
    if (f.op === 'between') return [{ key: f.field, op: 'between', min: f.value, max: f.max }]
    if (f.op === 'eq') return [{ key: f.field, op: 'eq', value: f.value }]
    return [{ key: f.field, op: f.op, values: f.values || [] }]
  })
}
