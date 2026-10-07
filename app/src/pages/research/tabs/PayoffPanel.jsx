import { useEffect, useMemo, useState } from 'react'
import { STRATEGIES, buildLegs, summary, curve } from './optionPayoff'
import useDarkSection from '../../optionsAnalytics/useDarkSection'
import { todayPnl, popAtExpiry, priceSlices } from '../../optionsAnalytics/chainModels'
import { daysTo } from '../../optionsAnalytics/ChainTools'
import { fractionPct } from '../researchFormat'
import { num } from '../../optionsAnalytics/optionsFormat'
import styles from './OptionsChainTab.module.css'
import Select from '../../../components/ui/Select'

// BRK-01 increment 2: the profit-and-loss picture at expiration, under the chain.
// Read-only. Every number is stated with its assumption (mid fill, one contract,
// at expiration, before commissions) and nothing on it places a trade.
//
// FT-001 (lane/o-options-remainders), DARK behind OPTIONS_PAYOFF_TODAY_ENABLED: while its model
// route answers, the panel adds the "today at IV" curve (each leg by Black-Scholes at its own vendor
// IV, today), the probability of profit at expiration and a price-slice table, every one labelled
// computed with the server's own words (chain_models.PAYOFF_MODEL). 404 = exactly the old panel.

const money = (v) => {
  if (v === Infinity) return 'unlimited'
  if (v === -Infinity) return 'unlimited'
  const n = Math.round(Math.abs(v))
  return `${v < 0 ? '-' : ''}$${n.toLocaleString()}`
}

const W = 520
const H = 180
const PAD = 28

const pct = (p) => fractionPct(p, 1)

export default function PayoffPanel({ rows, spot, sym = '', expiration = '', atmIv = null }) {
  const model = useDarkSection(sym ? `/api/research/options/${encodeURIComponent(sym)}/payoff-model` : null)
  const today = model.data && model.data.today_method ? model.data : null
  const days = daysTo(expiration)
  const strikes = useMemo(() => rows.map((r) => r.strike).filter((k) => k != null), [rows])
  const atm = useMemo(() => {
    let best = null
    for (const k of strikes) if (best == null || Math.abs(k - spot) < Math.abs(best - spot)) best = k
    return best
  }, [strikes, spot])
  const [kind, setKind] = useState('long_call')
  const [k1, setK1] = useState(null)
  const [k2, setK2] = useState(null)

  // A new expiration brings new strikes: re-anchor on the money.
  useEffect(() => {
    if (atm == null) return
    const i = strikes.indexOf(atm)
    setK1(atm)
    setK2(strikes[Math.min(strikes.length - 1, i + 1)] ?? atm)
  }, [atm, strikes])

  const two = STRATEGIES[kind].strikes === 2
  const built = buildLegs(kind, two ? [k1, k2] : [k1], rows)
  const s = built.legs ? summary(built.legs) : null

  let path = ''
  let todayPath = ''
  let zeroY = null
  let spotX = null
  let slices = null
  let pop = null
  const lo = spot * 0.85
  const hi = spot * 1.15
  if (built.legs && Number.isFinite(spot) && spot > 0) {
    const pts = curve(built.legs, lo, hi)
    const tpts = today && days > 0
      ? pts.map(([x]) => [x, todayPnl(built.legs, x, days)]).filter(([, y]) => y != null) : []
    const ys = [...pts, ...tpts].map(([, y]) => y)
    const yMin = Math.min(0, ...ys)
    const yMax = Math.max(0, ...ys)
    const span = yMax - yMin || 1
    const X = (x) => PAD + ((x - lo) / (hi - lo)) * (W - 2 * PAD)
    const Y = (y) => H - PAD - ((y - yMin) / span) * (H - 2 * PAD)
    path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
    if (tpts.length === pts.length) todayPath = tpts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
    if (today) {
      pop = popAtExpiry(built.legs, spot, Number(atmIv), days)
      slices = priceSlices(built.legs, { lo, hi, days, spot, iv: Number(atmIv) })
    }
    zeroY = Y(0)
    spotX = X(spot)
  }

  const strikeSelect = (value, set, label) => (
    <Select aria-label={label} value={value ?? ''} onChange={(e) => set(Number(e.target.value))}>
      {strikes.map((k) => <option key={k} value={k}>{num(k)}</option>)}
    </Select>
  )

  return (
    <div className={styles.payoff} data-testid="payoff">
      <div className={styles.head}>
        <strong>Payoff at expiration</strong>
        <Select aria-label="Strategy" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(STRATEGIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        {strikeSelect(k1, setK1, two ? 'Lower strike' : 'Strike')}
        {two && strikeSelect(k2, setK2, 'Upper strike')}
      </div>
      {built.error ? (
        <p className={styles.note} data-testid="payoff-unpriced">{built.error}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.payoffChart} role="img"
               aria-label={`${STRATEGIES[kind].label} profit and loss at expiration`}>
            <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} className={styles.payoffZero} />
            {spotX != null && <line x1={spotX} x2={spotX} y1={PAD / 2} y2={H - PAD / 2} className={styles.payoffSpot} />}
            <path d={path} className={styles.payoffLine} fill="none" />
            {todayPath && <path d={todayPath} className={styles.payoffToday} fill="none" data-testid="payoff-today-line" />}
          </svg>
          <p className={styles.payoffFacts} data-testid="payoff-facts">
            {s.cost >= 0 ? `Costs ${money(s.cost)}` : `Collects ${money(-s.cost)}`}
            {' · '}Max loss {money(s.maxLoss)}
            {' · '}Max profit {money(s.maxProfit)}
            {s.breakevens.length ? ` · Breakeven ${s.breakevens.map((b) => num(b)).join(' and ')}` : ''}
          </p>
          {today && (
            <div data-testid="payoff-today">
              <p className={styles.payoffFacts} data-testid="payoff-pop">
                <span className={styles.badge}>computed</span>{' '}
                Probability of profit at expiration <b>{pct(pop)}</b>
                {pop == null ? ' (needs the at-the-money vendor IV and time to expiry)' : ` at ATM IV ${pct(atmIv)}, ${days} days`}
                {todayPath ? ' · dashed line = P/L today at each leg’s vendor IV' : ' · no "today" line: a leg has no vendor IV'}
              </p>
              {slices && (
                <table className={styles.grid} data-testid="payoff-slices" aria-label="Payoff by price">
                  <thead><tr><th scope="col">Price</th><th scope="col">P/L today</th><th scope="col">P/L at expiry</th><th scope="col">Chance below</th></tr></thead>
                  <tbody>
                    {slices.map((r) => (
                      <tr key={r.price}>
                        <td>{num(r.price)}</td><td>{r.today == null ? '—' : money(r.today)}</td>
                        <td>{money(r.expiry)}</td><td>{pct(r.below)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={styles.muted} data-testid="payoff-today-basis">
                {today.today_method} {today.pop_method} {today.assumptions}
              </p>
            </div>
          )}
        </>
      )}
      <p className={styles.muted} data-testid="payoff-basis">
        One contract per leg, priced at the mid of bid and ask, at expiration, before commissions.
        A picture of the risk, not an order.
      </p>
    </div>
  )
}
