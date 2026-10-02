import { useEffect, useMemo, useState } from 'react'
import { STRATEGIES, buildLegs, summary, curve } from './optionPayoff'
import styles from './OptionsChainTab.module.css'

// BRK-01 increment 2: the profit-and-loss picture at expiration, under the chain.
// Read-only. Every number is stated with its assumption (mid fill, one contract,
// at expiration, before commissions) and nothing on it places a trade.

const money = (v) => {
  if (v === Infinity) return 'unlimited'
  if (v === -Infinity) return 'unlimited'
  const n = Math.round(Math.abs(v))
  return `${v < 0 ? '-' : ''}$${n.toLocaleString()}`
}

const W = 520
const H = 180
const PAD = 28

export default function PayoffPanel({ rows, spot }) {
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
  let zeroY = null
  let spotX = null
  if (built.legs && Number.isFinite(spot) && spot > 0) {
    const lo = spot * 0.85
    const hi = spot * 1.15
    const pts = curve(built.legs, lo, hi)
    const ys = pts.map(([, y]) => y)
    const yMin = Math.min(0, ...ys)
    const yMax = Math.max(0, ...ys)
    const span = yMax - yMin || 1
    const X = (x) => PAD + ((x - lo) / (hi - lo)) * (W - 2 * PAD)
    const Y = (y) => H - PAD - ((y - yMin) / span) * (H - 2 * PAD)
    path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
    zeroY = Y(0)
    spotX = X(spot)
  }

  const strikeSelect = (value, set, label) => (
    <select aria-label={label} value={value ?? ''} onChange={(e) => set(Number(e.target.value))}>
      {strikes.map((k) => <option key={k} value={k}>{k.toFixed(2)}</option>)}
    </select>
  )

  return (
    <div className={styles.payoff} data-testid="payoff">
      <div className={styles.head}>
        <strong>Payoff at expiration</strong>
        <select aria-label="Strategy" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(STRATEGIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
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
          </svg>
          <p className={styles.payoffFacts} data-testid="payoff-facts">
            {s.cost >= 0 ? `Costs ${money(s.cost)}` : `Collects ${money(-s.cost)}`}
            {' · '}Max loss {money(s.maxLoss)}
            {' · '}Max profit {money(s.maxProfit)}
            {s.breakevens.length ? ` · Breakeven ${s.breakevens.map((b) => b.toFixed(2)).join(' and ')}` : ''}
          </p>
        </>
      )}
      <p className={styles.muted} data-testid="payoff-basis">
        One contract per leg, priced at the mid of bid and ask, at expiration, before commissions.
        A picture of the risk, not an order.
      </p>
    </div>
  )
}
