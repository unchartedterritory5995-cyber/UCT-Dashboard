import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

const ACCOUNT = 25000
const RISK_PCT = 0.5
const CAP_PCT = 25

/** Round 2, piece 3: the answer card with the trade in it. Entry over the Kicker high, stop under its low, the
 *  distance, the size the house rule gives (position % = risk % / stop distance %), the shares, and what
 *  happened next. Every number is measured from the bars; the tactic lines are the owner's to confirm. */
export default function Piece8AnswerV2() {
  const d = useSample()
  const [showTrade, setShowTrade] = useState(true)
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const bar = n ? vis[n - 1] : null
  const prior = n > 1 ? vis[n - 2] : null
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const t = useMemo(() => {
    if (!bar || !fwd?.length) return null
    const entry = bar.h, stop = bar.l
    const dist = pct(entry, stop) * -1
    const posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT)
    const capped = RISK_PCT / (dist / 100) > CAP_PCT
    const shares = Math.floor((ACCOUNT * posPct / 100) / entry)
    const riskUsd = Math.round(shares * (entry - stop))
    const triggered = fwd.findIndex((b) => b.h > entry)
    const lo = Math.min(...fwd.map((b) => b.l))
    const hi = Math.max(...fwd.map((b) => b.h))
    const last = fwd[fwd.length - 1]
    return { entry, stop, dist, posPct, capped, shares, riskUsd, triggered, held: lo >= stop, hi: pct(entry, hi), end: pct(entry, last.c), priorBody: prior ? pct(prior.o, prior.c) : null }
  }, [bar, fwd, prior])
  const annotations = useMemo(() => {
    if (!bar) return null
    const a = arrowAt(vis, n - 1, { label: 'the Kicker', id: 'a' })
    if (showTrade) { a.push(...rayAt(bar, 'h', { id: 'a-entry', label: 'entry', color: '#1ae51a' })); a.push(...rayAt(bar, 'l', { id: 'a-stop', label: 'stop', color: '#ff6b6b' })) }
    return a
  }, [vis, n, bar, showTrade])
  return (
    <div className={s.col}>
      <div className={s.top}><span>Question 3 of 10</span><span className={s.bar}><i style={{ width: '30%' }} /></span><span>Setup · Kicker</span></div>
      <h1 className={s.h1}>A real red day, then this. Is the candle the arrow points at a Kicker?</h1>
      <div className={s.chartBox}><StudyChart bars={all} annotations={annotations} height={340} rightPadBars={4} /></div>
      <div className={s.card}>
        <div className={`${s.verdict} ${s.ok}`}>✓ Yes. That is a Kicker.</div>
        <div className={s.meta}>{d?.sym} · {d?.asof} · the owner's model example</div>
        <p className={s.lesson}>The day before closed <b>weak and red</b> ({t ? `${t.priorBody.toFixed(1)}% body` : ''}): real sellers, not a baby red candle. This one opened above that red body and <b>never looked back</b>, closing near its high. Yesterday's sellers are trapped. That trap is the Kicker.</p>
        <div className={s.pills}><button type="button" className={`${s.pill} ${showTrade ? s.on : ''}`} onClick={() => setShowTrade((v) => !v)}>{showTrade ? 'Trade lines on' : 'Show the trade'}</button></div>
        {t && showTrade ? (
          <>
            <p className={s.lesson}><b>If you traded it.</b> Buy it above the Kicker's high. The stop goes under the Kicker's low: that low is the line, and a close below it means the trap failed. Size comes from the stop, never the other way round.</p>
            <div className={s.trade}>
              <div className={s.fact}><div className={s.k}>Entry · over the high</div><div className={s.v}>${t.entry.toFixed(2)}</div></div>
              <div className={s.fact}><div className={s.k}>Stop · under the low</div><div className={`${s.v} ${s.down}`}>${t.stop.toFixed(2)}</div></div>
              <div className={s.fact}><div className={s.k}>Stop distance</div><div className={s.v}>{t.dist.toFixed(1)}%</div></div>
              <div className={s.fact}><div className={s.k}>Size at {RISK_PCT}% risk</div><div className={s.v}>{t.posPct.toFixed(0)}%{t.capped ? ' (capped)' : ''}</div></div>
              <div className={s.fact}><div className={s.k}>On a ${ACCOUNT.toLocaleString()} account</div><div className={s.v}>{t.shares} sh · ${t.riskUsd} at risk</div></div>
              <div className={s.fact}><div className={s.k}>What happened</div><div className={`${s.v} ${t.held ? s.up : s.down}`}>{t.triggered >= 0 ? `filled day ${t.triggered + 1}` : 'never triggered'}{t.held ? ', stop held' : ', stopped'}</div></div>
              <div className={s.fact}><div className={s.k}>Best in 20 sessions</div><div className={`${s.v} ${s.up}`}>+{t.hi.toFixed(1)}%</div></div>
              <div className={s.fact}><div className={s.k}>Close of session 20</div><div className={`${s.v} ${t.end >= 0 ? s.up : s.down}`}>{t.end >= 0 ? '+' : ''}{t.end.toFixed(1)}%</div></div>
            </div>
            <p className={s.hint}>Position % = risk % ÷ stop distance % (the house rule), capped at {CAP_PCT}%. Numbers are measured from the bars. The entry and stop tactic is written as proposed: your call.</p>
          </>
        ) : null}
      </div>
      <div className={s.foot}><button type="button" className={s.cta}>Continue</button></div>
    </div>
  )
}
