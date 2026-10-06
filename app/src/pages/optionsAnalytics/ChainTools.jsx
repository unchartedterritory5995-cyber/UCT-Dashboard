import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useDarkSection from './useDarkSection'
import { price } from './blackScholes'
import { mid, summary, curve } from '../research/tabs/optionPayoff'
import { formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'
import { num, fracPct } from './optionsFormat'
import styles from './optionsAnalytics.module.css'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'

// FT-003 probability analysis, FT-016 chain -> chart -> pricer drill, FT-002 multi-leg builder.
// (api/services/options_analytics/chain_tools.py; payoff math is optionPayoff.js, the one copy)
//
// ⛔ Each is its own dark surface: its route answering 404 renders nothing.
// ⛔ Read-only by charter: a position here is a picture, never an order.
// ⛔ Vendor numbers and computed numbers sit side by side and are labelled as such.

const enc = encodeURIComponent
const money = (v) => (v === Infinity || v === -Infinity ? 'unlimited' : `${v < 0 ? '-' : ''}$${formatNumber(Math.round(Math.abs(v)))}`)

// Today's calendar date IN NEW YORK, as [y, m, d]. Options expire on an exchange calendar, so "days to
// expiry" counts from the ET date -- NOT the UTC one, which turns over at 8 pm EDT / 7 pm EST and made
// every evening's DTE one day short. Intl carries the DST rules, so this is right on both sides of a
// switch.
const ET_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
export function etDateParts(now = new Date()) {
  const p = Object.fromEntries(ET_PARTS.formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]))
  return [p.year, p.month, p.day]
}

export function daysTo(expiration, now = new Date()) {
  if (!expiration) return null
  const [y, m, d] = expiration.split('-').map(Number)
  const exp = Date.UTC(y, m - 1, d)
  const [ty, tm, td] = etDateParts(now)
  const today = Date.UTC(ty, tm - 1, td)
  return Math.round((exp - today) / 86_400_000)
}

// ── FT-003 ─────────────────────────────────────────────────────────────────────

export function ProbabilityPanel({ sym, expiration }) {
  const [pct, setPct] = useState('68.27')
  const p = Math.min(99.9, Math.max(50, Number(pct) || 68.27)) / 100
  const { data, hidden, failed } = useDarkSection(
    `/api/research/options/${enc(sym)}/probability?expiration=${expiration || ''}&probability=${p.toFixed(4)}`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.ranges))) return null
  return (
    <section className={styles.panel} data-testid="probability">
      <div className={styles.head}>
        <span className={styles.title}>Probability analysis</span>
        <span className={styles.badge}>computed</span>
        <label>Probability{' '}
          <Input className={styles.input} aria-label="Probability percent" type="number" min="50" max="99.9" step="0.01"
            value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: 80 }} />%
        </label>
      </div>
      {failed ? <p className={styles.note}>The probability analysis is unavailable right now.</p> : (
        <>
          {data.ranges.length > 0 ? (
            <ul className={styles.list}>
              {data.ranges.map((r) => (
                <li key={r.probability} data-testid={`probability-${r.probability}`}>
                  {formatPercent(r.probability * 100, { decimals: 2 })} range by {data.expiration}: <b>{num(r.low)}</b> to <b>{num(r.high)}</b>
                  <span className={styles.muted}> (z {num(r.z)})</span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.note}>{data.note}</p>}
          <p className={styles.muted}>ATM IV {fracPct(data.atm_iv)} (vendor), {data.days} days. {data.method}</p>
        </>
      )}
    </section>
  )
}

// ── FT-016 ─────────────────────────────────────────────────────────────────────

function Spark({ bars }) {
  const closes = bars.map((b) => b.close).filter((v) => v != null)
  if (closes.length < 2) return null
  const lo = Math.min(...closes)
  const hi = Math.max(...closes)
  const W = 320
  const H = 70
  const x = (i) => 4 + (i / (closes.length - 1)) * (W - 8)
  const y = (v) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8))
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" data-testid="contract-chart"
      aria-label={`Contract closes from ${bars[0].date} to ${bars[bars.length - 1].date}`}>
      <polyline className={styles.lineGold} points={closes.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  )
}

export function ContractDrill({ sym, contract, spot, onClose }) {
  const occ = contract?.contract
  const { data, hidden, failed } = useDarkSection(occ ? `/api/research/options/${enc(sym)}/contract/${enc(occ)}` : null)
  const [S, setS] = useState(String(spot ?? ''))
  const [days, setDays] = useState(String(daysTo(contract?.expiration) ?? ''))
  const [ivPct, setIvPct] = useState(contract?.iv != null ? (contract.iv * 100).toFixed(1) : '')
  if (!occ || hidden || (!data && !failed) || (data && !Array.isArray(data.bars))) return null
  const model = price({ type: contract.type, S: Number(S), K: Number(contract.strike), iv: Number(ivPct) / 100, days: Number(days) })
  const vendorMid = mid(contract)
  const rows = [
    ['Price', vendorMid, model?.price, 2], ['Δ', contract.delta, model?.delta, 3], ['Γ', contract.gamma, model?.gamma, 4],
    ['Θ /day', contract.theta, model?.theta, 3], ['Vega', contract.vega, model?.vega, 3],
  ]
  return (
    <section className={styles.panel} data-testid="contract-drill">
      <div className={styles.head}>
        <span className={styles.title}>{occ}: {contract.type} {num(contract.strike)} {contract.expiration}</span>
        <Link reloadDocument to={`/research/${enc(sym)}?section=technical`}>Chart {sym}</Link>
        {onClose && <button type="button" className={styles.input} onClick={onClose}>Close</button>}
      </div>
      {failed ? <p className={styles.note}>The contract history is unavailable right now.</p> : (
        <>
          {data.bars?.length ? <Spark bars={data.bars} /> : <p className={styles.note}>{data.note}</p>}
          <p className={styles.muted}>Contract daily closes (vendor), last {data.bars?.length || 0} sessions.</p>
        </>
      )}
      <div className={styles.head}>
        <label>Spot <Input className={styles.input} aria-label="Pricer spot" value={S} onChange={(e) => setS(e.target.value)} style={{ width: 80 }} /></label>
        <label>Days <Input className={styles.input} aria-label="Pricer days" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 60 }} /></label>
        <label>IV % <Input className={styles.input} aria-label="Pricer IV" value={ivPct} onChange={(e) => setIvPct(e.target.value)} style={{ width: 60 }} /></label>
      </div>
      <table className={styles.table} data-testid="pricer">
        <thead><tr><th /><th>Vendor</th><th>Computed</th></tr></thead>
        <tbody>
          {rows.map(([l, v, c, d]) => <tr key={l}><th>{l}</th><td>{num(v, d)}</td><td>{num(c, d)}</td></tr>)}
        </tbody>
      </table>
      <p className={styles.muted}>
        Vendor: the live quote's bid/ask mid and the vendor's greeks. Computed: Black-Scholes with the inputs above,
        European exercise, no dividends, zero interest rate; listed American options can differ.
      </p>
    </section>
  )
}

/** The keyboard door into the drill (a clicked quote is the pointer one). It probes the drill's
 * own route with one contract, so it is absent exactly while the pricer switch is off. */
export function ContractPicker({ sym, rows, onPick }) {
  const all = useMemo(() => rows.flatMap((r) => [r.call, r.put]).filter((c) => c?.contract), [rows])
  const probe = all[0]?.contract
  const { hidden, data } = useDarkSection(probe ? `/api/research/options/${enc(sym)}/contract/${enc(probe)}` : null)
  if (hidden || !Array.isArray(data?.bars) || !all.length) return null
  return (
    <label className={styles.muted} data-testid="contract-picker">Drill into{' '}
      <Select className={styles.select} aria-label="Drill into contract" value=""
        onChange={(e) => { const c = all.find((x) => x.contract === e.target.value); if (c) onPick(c) }}>
        <option value="">a contract…</option>
        {all.map((c) => <option key={c.contract} value={c.contract}>{c.type} {num(c.strike)}</option>)}
      </Select>
    </label>
  )
}

// ── FT-039 ─────────────────────────────────────────────────────────────────────

const LABELS = { iv_regime: 'IV regime', greeks_fit: 'Greeks fit', dte_fit: 'Time to expiry', liquidity: 'Liquidity', earnings_timing: 'Earnings timing' }

export function StancePanel({ sym, contract }) {
  const [direction, setDirection] = useState(contract?.type === 'put' ? 'bearish' : 'bullish')
  const occ = contract?.contract
  const { data, hidden, failed } = useDarkSection(occ ? `/api/research/options/${enc(sym)}/stance?contract=${enc(occ)}&direction=${direction}` : null)
  if (!occ || hidden || (!data && !failed) || (data && !('fit_score' in data))) return null
  return (
    <section className={styles.panel} data-testid="stance">
      <div className={styles.head}>
        <span className={styles.title}>Option stance</span>
        <span className={styles.badge}>computed</span>
        <span className={styles.seg} role="group" aria-label="Directional view">
          {['bullish', 'bearish'].map((d) => (
            <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)}>{d}</button>
          ))}
        </span>
      </div>
      {failed ? <p className={styles.note}>The stance is unavailable right now.</p> : (
        <>
          <p className={styles.facts} data-testid="stance-score">
            Fit <b>{data.fit_score == null ? '—' : `${num(data.fit_score)} / 5`}</b>
            <span className={styles.muted}> over {data.components_used} of 5 components</span>
          </p>
          <ul className={styles.list}>
            {Object.entries(data.sub_scores).map(([k, v]) => (
              <li key={k}>{LABELS[k] || k}: {v == null ? <span className={styles.muted}>not computed</span> : num(v)}
                <span className={styles.muted}> · {data.reasons?.[k]}</span></li>
            ))}
          </ul>
          <p className={styles.muted}>{data.explanation}</p>
          <p className={styles.muted} data-testid="stance-disclaimer">{data.disclaimer}</p>
        </>
      )}
    </section>
  )
}

// ── FT-002 ─────────────────────────────────────────────────────────────────────

const GREEKS = ['delta', 'gamma', 'theta', 'vega']

export function priceLegs(legs, rows) {
  const byStrike = new Map(rows.map((r) => [r.strike, r]))
  const priced = legs.map((l) => {
    const q = byStrike.get(l.strike)?.[l.type]
    return { ...l, side: l.qty, premium: mid(q), quote: q }
  })
  const unpriced = priced.filter((l) => l.premium == null)
  return { priced, unpriced }
}

export function netGreeks(priced) {
  const out = {}
  for (const g of GREEKS) {
    let sum = 0
    let missing = false
    for (const l of priced) {
      const v = l.quote?.[g]
      if (v == null) missing = true
      else sum += v * l.qty * 100
    }
    out[g] = missing ? null : sum
  }
  return out
}

export function PositionBuilder({ sym, rows, spot }) {
  const { data, hidden } = useDarkSection(`/api/research/options/${enc(sym)}/builder`)
  const strikes = useMemo(() => rows.map((r) => r.strike).filter((k) => k != null), [rows])
  const [legs, setLegs] = useState([])
  const [type, setType] = useState('call')
  const [strike, setStrike] = useState('')
  const [qty, setQty] = useState('1')
  if (hidden || !data?.enabled) return null
  const k = strike === '' ? strikes[Math.floor(strikes.length / 2)] : Number(strike)
  const add = (sign) => {
    const n = Math.max(1, Math.min(100, Math.round(Number(qty) || 1)))
    if (legs.length >= data.max_legs || k == null) return
    setLegs([...legs, { type, strike: k, qty: sign * n }])
  }
  const { priced, unpriced } = priceLegs(legs, rows)
  const s = legs.length && !unpriced.length ? summary(priced) : null
  const g = legs.length && !unpriced.length ? netGreeks(priced) : null
  let path = ''
  if (s && spot > 0) {
    const pts = curve(priced, spot * 0.85, spot * 1.15)
    const ys = pts.map(([, y]) => y)
    const lo = Math.min(0, ...ys)
    const hi = Math.max(0, ...ys)
    const X = (x) => 20 + ((x - spot * 0.85) / (spot * 0.3)) * 480
    const Y = (y) => 150 - ((y - lo) / (hi - lo || 1)) * 130
    path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
  }
  return (
    <section className={styles.panel} data-testid="position-builder">
      <div className={styles.head}>
        <span className={styles.title}>Position builder</span>
        <span className={styles.badge}>computed</span>
        <Select className={styles.select} aria-label="Leg type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="call">Call</option><option value="put">Put</option>
        </Select>
        <Select className={styles.select} aria-label="Leg strike" value={k ?? ''} onChange={(e) => setStrike(e.target.value)}>
          {strikes.map((x) => <option key={x} value={x}>{num(x)}</option>)}
        </Select>
        <Input className={styles.input} aria-label="Leg quantity" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 50 }} />
        <button type="button" className={styles.input} onClick={() => add(1)}>Buy</button>
        <button type="button" className={styles.input} onClick={() => add(-1)}>Sell</button>
        {legs.length > 0 && <button type="button" className={styles.input} onClick={() => setLegs([])}>Clear</button>}
      </div>
      <ul className={styles.list} data-testid="builder-legs">
        {priced.map((l, i) => (
          <li key={`${l.type}-${l.strike}-${i}`}>{l.qty > 0 ? 'Buy' : 'Sell'} {Math.abs(l.qty)} {num(l.strike)} {l.type}
            {' @ '}{l.premium == null ? 'no two-sided quote' : num(l.premium)}
            <button type="button" className={styles.input} aria-label={`Remove leg ${i + 1}`} onClick={() => setLegs(legs.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ul>
      {unpriced.length > 0 && <p className={styles.note}>No two-sided quote for {unpriced.map((l) => `the ${l.strike} ${l.type}`).join(' and ')}, so there is no honest price to draw.</p>}
      {s && (
        <>
          {path && <svg className={styles.chart} viewBox="0 0 520 170" role="img" aria-label="Position profit and loss at expiration"><path className={styles.lineGold} d={path} /></svg>}
          <p className={styles.facts} data-testid="builder-facts">
            {s.cost >= 0 ? `Costs ${money(s.cost)}` : `Collects ${money(-s.cost)}`} · Max loss {money(s.maxLoss)} · Max profit {money(s.maxProfit)}
            {s.breakevens.length ? ` · Breakeven ${s.breakevens.map((b) => num(b)).join(' and ')}` : ''}
          </p>
          <p className={styles.facts} data-testid="builder-greeks">
            Net Δ {num(g.delta, 1)} · Γ {num(g.gamma, 2)} · Θ {num(g.theta, 1)}/day · Vega {num(g.vega, 1)} <span className={styles.muted}>(vendor greeks x quantity x 100; blank when a leg has none)</span>
          </p>
        </>
      )}
      <p className={styles.muted}>{data.basis} Up to {data.max_legs} legs, one expiration.</p>
    </section>
  )
}
