// THE PICTURE CARD FOR A COMPUTED QUESTION (VISUALS_PLAN.md step 3, 2026-11-15). The owner, 2026-11-14: "Would prefer
// all of them to have some sort of visual representation or example or card or lesson to enhance the experience and the
// lesson and teaching." A setup question shows its real chart; a computed question (where is 3R, how many shares, how far
// did it fall) shows a small card the bank draws from the question's own calc (scripts/study/calc_visuals.py):
// `prompt_json.visual` holds the question's INPUTS only, each stated in its words; the answer fills in after scoring from
// the reveal's `facts.calc.result`, with the working line under it ("50 + 3 × (50 − 47.50) = 57.50").
// Every computed question also gets the working line after the answer, card or not (the reveal has carried facts.calc
// since the courses began; the games already show it).
// Pure functions here; ui/CalcCard.jsx draws them.
import { evalExpr, exprText } from './challenges/games/earnings'
import { fmtNumber } from './challenges/games/history'
import { answerWord } from './revealCardHelpers'

export const CARD_KINDS = Object.freeze(['ladder', 'move', 'recover', 'size', 'range', 'quote', 'share', 'expectancy', 'payoff'])
const fin = (v) => typeof v === 'number' && Number.isFinite(v)

/** The card a question carries, when its shape is one this file draws and every number on it is a finite number;
 *  otherwise null (an unknown kind from a newer bank draws nothing rather than half a card). */
export function cardOf(item) {
  const v = item?.prompt_json?.visual
  if (!v || typeof v !== 'object' || !CARD_KINDS.includes(v.kind)) return null
  const ok = {
    ladder: () => Array.isArray(v.levels) && v.levels.length >= 1 && v.levels.every((l) => fin(l?.price)),
    move: () => fin(v.from?.value) && fin(v.to?.value) && v.from.value > 0 && v.to.value >= 0,
    recover: () => fin(v.loss_pct) && v.loss_pct > 0 && v.loss_pct < 100,
    size: () => Array.isArray(v.rows) && v.rows.length >= 2 && v.rows.every((r) => fin(r?.value)),
    range: () => fin(v.high) && fin(v.low) && fin(v.close) && v.low < v.high && v.close >= v.low && v.close <= v.high,
    quote: () => fin(v.bid) && fin(v.ask) && v.ask >= v.bid,
    // a slice of a whole: the percent given (1% of the day's volume) or the part given (18 winners of 40 trades)
    share: () => fin(v.whole?.value) && v.whole.value > 0 && ((fin(v.pct) && v.pct > 0 && v.pct <= 100)
      || (fin(v.part?.value) && v.part.value >= 0 && v.part.value <= v.whole.value)),
    expectancy: () => fin(v.win_pct) && fin(v.avg_win_r) && fin(v.avg_loss_r) && v.win_pct > 0 && v.win_pct < 100,
    payoff: () => (v.option === 'call' || v.option === 'put') && (fin(v.strike) || (Array.isArray(v.legs) && v.legs.length === 2 && v.legs.every((l) => fin(l?.strike)))),
  }[v.kind]
  return ok() && v.find && typeof v.find === 'object' ? v : null
}

/** The scored answer's number: the reveal's own calc result (the server computed it from the same inputs). */
export function resultOf(reveal) {
  const r = reveal?.facts?.calc?.result
  const n = typeof r === 'number' ? r : typeof r === 'string' && r.trim() !== '' ? Number(r) : NaN
  return Number.isFinite(n) ? n : null
}

const decimals = (x) => {
  const s = String(Math.abs(x))
  if (/e/i.test(s)) return 6
  const f = s.split('.')[1]
  return f ? Math.min(6, f.length) : 0
}

/** One price format for every price on a card: two decimals when any of them has cents ("50.00" beside "47.50"),
 *  whole numbers otherwise, thousands grouped ("4,800"). */
export function priceFormat(values) {
  const d = Math.max(0, ...values.filter(fin).map(decimals))
  const places = d === 0 ? 0 : Math.max(2, d)
  return (v) => (fin(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })}` : '')
}

const signed = (v, body) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${body}`
const plain = (v, d = 2) => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d })

/** The answer as the card writes it, by what the card asks for. */
export function resultText(card, result, fmtPrice = priceFormat([result])) {
  if (!card || !fin(result)) return ''
  const as = card.find?.as
  if (as === 'price') return fmtPrice(result)
  if (as === 'r') return signed(result, `${plain(result)}R`)
  // the slot is labelled "R lost", so the count reads as the choices write it ("3R"), never "−3R" beside a "3R" key
  if (as === 'r_loss') return `${plain(result)}R`
  if (as === 'per_share') return `${result < 0 ? '−' : ''}${Math.abs(result).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} a share`
  if (as === 'dollars') return `${result < 0 ? '−' : ''}$${Math.abs(result).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(result) ? 0 : 2, maximumFractionDigits: 2 })}`
  if (as === 'pct') return `${result < 0 ? '−' : ''}${plain(result)}%`
  if (as === 'frac') return plain(result, 3)
  if (as === 'shares') return `${Math.round(result).toLocaleString('en-US')} shares`
  if (as === 'times') return `${plain(result)}×`
  // a hand-written card's plain number, with the unit it names ("0.8 ATRs", "4 sessions")
  const unit = typeof card.find?.unit === 'string' && card.find.unit.trim() ? ` ${card.find.unit.trim()}` : ''
  return `${result < 0 ? '−' : ''}${plain(result, 4)}${unit}`
}

/** The answer as the slot prints it: the question's own key when it is short and states the scored number ("$57.50",
 *  "0.70", "Made $120", "8,000 shares"), so the card agrees with the choice the member picked (the 2026-11-15 screen
 *  check: the slot printed "57.50" beside a "$57.50" choice, "0.7" beside "0.70"); otherwise the card's own format. */
export function answerText(card, item, reveal, result) {
  if (!fin(result)) return ''
  const key = answerWord(reveal)
  if (key != null) {
    const s = String(key).trim()
    const nums = (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, '')))
    const d = decimals(result)
    if (s && s.length <= 18 && nums.length === 1 && Math.abs(nums[0] - Math.abs(result)) <= 0.5 * 10 ** -d + 1e-9) {
      if (/^-?\d[\d,]*(?:\.\d+)?$/.test(s)) {
        // a typed-number question's key is the bare number; its prefix and suffix are the question's ("$", "%")
        const p = item?.prompt_json || {}
        const suf = p.suffix || ''
        return `${p.prefix || ''}${s}${/^[A-Za-z]/.test(suf) ? ` ${suf}` : suf}`
      }
      return s
    }
  }
  return card ? resultText(card, result, priceFormat([...(card.levels || []).map((l) => l.price), result])) : ''
}

/** A size or share row's value as written ("$40,000", "0.5%", "300 shares"). */
export function valueText(row) {
  if (!row || !fin(row.value)) return ''
  if (row.fmt === '$') return `$${row.value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(row.value) ? 0 : 2 })}`
  if (row.fmt === '%') return `${plain(row.value, 3)}%`
  if (row.fmt === 'sh' || row.fmt === 'shares') return `${row.value.toLocaleString('en-US')} shares`
  return row.value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

// ── the ladder: prices on a ruler ───────────────────────────────────────────────────────────────────────────────────
const TONE = { stop: 'red', entry: 'gold', exit: 'ink', price: 'ink', high: 'ink', line: 'blue' }
/** The rows a ladder draws, top to bottom, each at `top` (a percent of the ruler's height, the price's true place) and
 *  `labelTop` (nudged apart so two close prices never print over each other, `gap` percent at least). After the answer
 *  (`result` known) a price answer joins as its own row, and an entry and stop (`card.r`) add the R steps on the
 *  ruler: up to the level asked ("3R"), or to the trade's own R. */
export function ladderLayout(card, result = null, { gap = 15, pad = 10 } = {}) {
  const rows = card.levels.map((l) => ({ key: l.key, label: l.label || '', price: l.price, tone: /^fill/.test(l.key) ? 'gold' : TONE[l.key] || 'ink' }))
  const done = fin(result)
  // the answer's own row ("hit"): its short tag on the ruler ("Most we pay"), the full label in the answer slot
  if (done && card.find?.as === 'price') rows.push({ key: 'find', label: card.find.tag || card.find.label || '', price: result, tone: 'hit' })
  const ticks = []
  const r = card.r
  if (done && r && fin(r.entry) && fin(r.stop) && r.entry !== r.stop) {
    const risk = Math.abs(r.entry - r.stop)
    const dir = card.side === 'short' ? -1 : 1
    let n = 0
    const m = /^(\d+(?:\.\d+)?)R$/.exec(card.find?.label || '')
    if (m) n = Number(m[1])
    else if (card.find?.as === 'r') n = Math.ceil(Math.max(0, result) - 1e-9)
    else if (card.find?.as === 'r_loss') n = -Math.ceil(Math.max(0, result) - 1e-9)
    const steps = Math.min(12, Math.abs(Math.round(n)))
    for (let k = 1; k <= steps; k += 1) ticks.push({ r: Math.sign(n) * k, price: r.entry + dir * Math.sign(n) * k * risk })
  }
  const prices = [...rows.map((x) => x.price), ...ticks.map((t) => t.price)]
  let lo = Math.min(...prices), hi = Math.max(...prices)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const at = (p) => pad + ((hi - p) / (hi - lo)) * (100 - 2 * pad)
  rows.forEach((x) => { x.top = at(x.price) })
  ticks.forEach((t) => { t.top = at(t.price) })
  rows.sort((a, b) => a.top - b.top || (a.tone === 'hit' ? 1 : -1))
  // nudge labels apart: down the ruler, then back up from the floor
  const lab = rows.map((x) => x.top)
  for (let i = 1; i < lab.length; i += 1) lab[i] = Math.max(lab[i], lab[i - 1] + gap)
  const floor = 100 - pad / 2
  if (lab.length && lab[lab.length - 1] > floor) {
    lab[lab.length - 1] = floor
    for (let i = lab.length - 2; i >= 0; i -= 1) lab[i] = Math.min(lab[i], lab[i + 1] - gap)
  }
  rows.forEach((x, i) => { x.labelTop = lab[i] })
  return { rows, ticks, lo, hi }
}

// ── the working: the calc recomputed here from the reveal's own inputs ─────────────────────────────────────────────
const n0 = (v) => fmtNumber(v)
const pc = (v) => `${fmtNumber(v)}%`
const NAMED = Object.freeze({
  pct_change: { v: (a) => ((a.end - a.start) / a.start) * 100, f: (a) => `(${n0(a.end)} − ${n0(a.start)}) ÷ ${n0(a.start)} × 100`, u: '%' },
  drawdown_pct: { v: (a) => ((a.peak - a.trough) / a.peak) * 100, f: (a) => `(${n0(a.peak)} − ${n0(a.trough)}) ÷ ${n0(a.peak)} × 100`, u: '%' },
  yoy_growth: { v: (a) => ((a.current - a.prior) / Math.abs(a.prior)) * 100, f: (a) => `(${n0(a.current)} − ${n0(a.prior)}) ÷ ${n0(a.prior)} × 100`, u: '%' },
  gain_to_recover: { v: (a) => (1 / (1 - a.loss_pct / 100) - 1) * 100, f: (a) => `100 ÷ (100 − ${n0(a.loss_pct)}) × 100 − 100`, u: '%' },
  shares_from_risk: {
    v: (a) => Math.floor((a.account * a.risk_pct) / 100 / Math.abs(a.entry - a.stop)),
    f: (a) => `$${n0(a.account)} × ${pc(a.risk_pct)} ÷ ${n0(+Math.abs(a.entry - a.stop).toFixed(6))} a share, rounded down`, u: ' shares' },
  risk_dollars: { v: (a) => a.shares * Math.abs(a.entry - a.stop), f: (a) => `${n0(a.shares)} × ${n0(+Math.abs(a.entry - a.stop).toFixed(6))}`, u: '$' },
  r_multiple: {
    v: (a) => (a.side === 'short' ? a.entry - a.exit : a.exit - a.entry) / Math.abs(a.entry - a.stop),
    f: (a) => (a.side === 'short' ? `(${n0(a.entry)} − ${n0(a.exit)})` : `(${n0(a.exit)} − ${n0(a.entry)})`) + ` ÷ ${n0(+Math.abs(a.entry - a.stop).toFixed(6))}`, u: 'R' },
  expectancy_r: {
    v: (a) => (a.win_rate_pct / 100) * a.avg_win_r - (1 - a.win_rate_pct / 100) * a.avg_loss_r,
    f: (a) => `${pc(a.win_rate_pct)} × ${n0(a.avg_win_r)}R − ${pc(+(100 - a.win_rate_pct).toFixed(6))} × ${n0(a.avg_loss_r)}R`, u: 'R' },
  spread: { v: (a) => a.ask - a.bid, f: (a) => `${n0(a.ask)} − ${n0(a.bid)}`, u: '$' },
  spread_pct: { v: (a) => ((a.ask - a.bid) / ((a.ask + a.bid) / 2)) * 100, f: (a) => `(${n0(a.ask)} − ${n0(a.bid)}) ÷ ${n0(+((a.ask + a.bid) / 2).toFixed(6))} × 100`, u: '%' },
  option_breakeven: { v: (a) => (a.kind === 'call' ? a.strike + a.premium : a.strike - a.premium), f: (a) => `${n0(a.strike)} ${a.kind === 'call' ? '+' : '−'} ${n0(a.premium)}`, u: '' },
  intrinsic: {
    v: (a) => Math.max(0, a.kind === 'call' ? a.underlying - a.strike : a.strike - a.underlying),
    f: (a) => (a.kind === 'call' ? `${n0(a.underlying)} − ${n0(a.strike)}` : `${n0(a.strike)} − ${n0(a.underlying)}`), u: '' },
  extrinsic: {
    v: (a) => a.premium - Math.max(0, a.kind === 'call' ? a.underlying - a.strike : a.strike - a.underlying),
    f: (a) => `${n0(a.premium)} − ${n0(Math.max(0, +(a.kind === 'call' ? a.underlying - a.strike : a.strike - a.underlying).toFixed(6)))}`, u: '' },
  avg_price: {
    v: (a) => a.fills.reduce((s, [sh, px]) => s + sh * px, 0) / a.fills.reduce((s, [sh]) => s + sh, 0),
    f: (a) => `(${a.fills.map(([sh, px]) => `${n0(sh)} × ${n0(px)}`).join(' + ')}) ÷ ${n0(a.fills.reduce((s, [sh]) => s + sh, 0))}`, u: '' },
  dollar_volume: { v: (a) => a.shares * a.price, f: (a) => `${n0(a.shares)} × ${n0(a.price)}`, u: '$' },
  pe: { v: (a) => a.price / a.eps, f: (a) => `${n0(a.price)} ÷ ${n0(a.eps)}`, u: '' },
  short_pnl: { v: (a) => (a.entry - a.exit) * a.shares, f: (a) => `(${n0(a.entry)} − ${n0(a.exit)}) × ${n0(a.shares)}`, u: '$' },
  // an option held to expiry: its value then (intrinsic) against the premium, times the shares it controls
  option_payoff: {
    v: (a) => {
      const intr = Math.max(0, a.kind === 'call' ? a.underlying - a.strike : a.strike - a.underlying)
      return (a.side === 'short' ? a.premium - intr : intr - a.premium) * (a.contracts ?? 1) * (a.multiplier ?? 100)
    },
    f: (a) => {
      const intr = n0(+Math.max(0, a.kind === 'call' ? a.underlying - a.strike : a.strike - a.underlying).toFixed(6))
      const per = a.side === 'short' ? `(${n0(a.premium)} − ${intr})` : `(${intr} − ${n0(a.premium)})`
      return `${per} × ${n0((a.contracts ?? 1) * (a.multiplier ?? 100))}`
    }, u: '$' },
  vertical_payoff: {
    v: (a) => {
      const intr = (k) => Math.max(0, a.kind === 'call' ? a.underlying - k : k - a.underlying)
      return (intr(a.long_strike) - intr(a.short_strike) - a.net_debit) * (a.contracts ?? 1) * (a.multiplier ?? 100)
    },
    f: (a) => {
      const intr = (k) => +Math.max(0, a.kind === 'call' ? a.underlying - k : k - a.underlying).toFixed(6)
      // a short leg worth nothing at expiry drops out of the line ("(3 − 1.8)", never "(3 − 0 − 1.8)")
      const short = intr(a.short_strike) ? ` − ${n0(intr(a.short_strike))}` : ''
      return `(${n0(intr(a.long_strike))}${short} − ${n0(a.net_debit)}) × ${n0((a.contracts ?? 1) * (a.multiplier ?? 100))}`
    }, u: '$' },
  margin_equity_pct: { v: (a) => ((a.market_value - a.loan) / a.market_value) * 100, f: (a) => `(${n0(a.market_value)} − ${n0(a.loan)}) ÷ ${n0(a.market_value)} × 100`, u: '%' },
})

/** The working for a computed answer ({filled, result, text}), from the reveal's `facts.calc`: the calculation with the
 *  question's own numbers in it, and the result. Recomputed here and shown only when it rounds to the server's result
 *  (to the decimals that result carries); an unknown calculation, or one that disagrees, shows nothing rather than a
 *  wrong line. `card` (when the question has one) names the result's unit. */
export function workingOf(reveal, card = null) {
  const calc = reveal?.facts?.calc
  const result = resultOf(reveal)
  if (!calc || typeof calc !== 'object' || result == null) return null
  const a = calc.args && typeof calc.args === 'object' ? calc.args : {}
  let raw = null, filled = '', unit = ''
  if (calc.fn === 'arith') {
    if (typeof a.expr !== 'string') return null
    raw = evalExpr(a.expr, a)
    filled = exprText(a.expr, a)
  } else if (NAMED[calc.fn]) {
    try {
      raw = NAMED[calc.fn].v(a)
      filled = NAMED[calc.fn].f(a)
      unit = NAMED[calc.fn].u
    } catch {
      return null
    }
  }
  if (!fin(raw) || !filled || /undefined|NaN/.test(filled)) return null
  const d = decimals(result)
  if (Math.abs(raw - result) > 0.5 * 10 ** -d + 1e-9) return null
  let shown
  if (card) shown = resultText(card, result, priceFormat([result]))
  else if (unit === '%') shown = `${result < 0 ? '−' : ''}${plain(result, 6)}%`
  else if (unit === 'R') shown = signed(result, `${plain(result, 6)}R`)
  else if (unit === '$') shown = `${result < 0 ? '−' : ''}$${plain(result, 6)}`
  else if (unit === ' shares') shown = `${Math.round(result).toLocaleString('en-US')} shares`
  else shown = `${result < 0 ? '−' : ''}${plain(result, 6)}`
  return { filled, result: shown, text: `${filled} = ${shown}` }
}
