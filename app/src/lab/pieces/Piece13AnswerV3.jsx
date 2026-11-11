import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

const ACCOUNT = 25000
const RISK_PCT = 0.5
const CAP_PCT = 25

/** Round 3, piece 3: the answer card, corrected from the owner's words. The red day shows its PERFORMANCE (no
 *  "body"). Two entry tactics, the house's own: the opening range break (ORB) next morning, or the break of the
 *  previous day's high. The ORB lives on the intraday chart, so the daily bars measure only the second. The stop
 *  under the Kicker's low and the sizing rule stay marked as proposed. */
export default function Piece13AnswerV3() {
  const d = useSample()
  const [tactic, setTactic] = useState('pdh')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const bar = n ? vis[n - 1] : null
  const prior = n > 1 ? vis[n - 2] : null
  const before = n > 2 ? vis[n - 3] : null
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const t = useMemo(() => {
    if (!bar || !fwd?.length || !prior || !before) return null
    const entry = bar.h, stop = bar.l
    const dist = pct(entry, stop) * -1
    const posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT)
    const shares = Math.floor((ACCOUNT * posPct / 100) / entry)
    const riskUsd = Math.round(shares * (entry - stop))
    const triggered = fwd.findIndex((b) => b.h > entry)
    const lo = Math.min(...fwd.map((b) => b.l))
    const hi = Math.max(...fwd.map((b) => b.h))
    const last = fwd[fwd.length - 1]
    return { entry, stop, dist, posPct, capped: RISK_PCT / (dist / 100) > CAP_PCT, shares, riskUsd, triggered, held: lo >= stop, hi: pct(entry, hi), end: pct(entry, last.c), red: pct(before.c, prior.c), kick: pct(prior.c, bar.c) }
  }, [bar, fwd, prior, before])
  const annotations = useMemo(() => {
    if (!bar) return null
    const a = arrowAt(vis, n - 1, { label: 'the Kicker', id: 'a' })
    if (tactic === 'pdh') a.push(...rayAt(bar, 'h', { id: 'a-entry', label: 'entry · break of the high', color: '#1ae51a' }))
    a.push(...rayAt(bar, 'l', { id: 'a-stop', label: 'stop · proposed', color: '#ff6b6b' }))
    return a
  }, [vis, n, bar, tactic])
  return (
    <div className={s.col}>
      <div className={s.top}><span>Question 3 of 10</span><span className={s.bar}><i style={{ width: '30%' }} /></span><span>Setup · Kicker</span></div>
      <div className={s.chartBox}><StudyChart bars={all} annotations={annotations} height={340} rightPadBars={2} /></div>
      <div className={s.card}>
        <div className={`${s.verdict} ${s.ok}`}>✓ Kicker</div>
        <div className={s.meta}>{d?.sym} · {d?.asof}</div>
        {t ? (
          <div className={s.facts}>
            <div className={s.fact}><div className={s.k}>The red day</div><div className={`${s.v} ${s.down}`}>{t.red.toFixed(1)}%</div></div>
            <div className={s.fact}><div className={s.k}>The Kicker</div><div className={`${s.v} ${s.up}`}>+{t.kick.toFixed(1)}%</div></div>
            <div className={s.fact}><div className={s.k}>20 sessions on</div><div className={`${s.v} ${t.end >= 0 ? s.up : s.down}`}>{t.end >= 0 ? '+' : ''}{t.end.toFixed(1)}%</div></div>
          </div>
        ) : null}
        <p className={s.lesson}>The day before closed <b>weak and red</b>: real sellers. This one opened above that red body and <b>closed near its high</b>. Yesterday's sellers are trapped. That trap is the Kicker.</p>
        <label className={s.l}>How the house enters it</label>
        <div className={s.tactics}>
          <button type="button" className={`${s.tactic} ${tactic === 'orb' ? s.on : ''}`} onClick={() => setTactic('orb')}>
            <b>1 · Opening range break</b>
            <span>Next morning, buy the break of the opening range on the intraday chart.</span>
            <small>Lives on the 5-minute chart. Not measured on these daily bars.</small>
          </button>
          <button type="button" className={`${s.tactic} ${tactic === 'pdh' ? s.on : ''}`} onClick={() => setTactic('pdh')}>
            <b>2 · Break of the previous day's high</b>
            <span>Buy as price trades above the Kicker's high{t ? `, $${t.entry.toFixed(2)}` : ''}.</span>
            {t ? <small>{t.triggered >= 0 ? `Filled on session ${t.triggered + 1}.` : 'Never filled in 20 sessions.'}</small> : null}
          </button>
        </div>
        {t && tactic === 'pdh' ? (
          <div className={s.trade}>
            <div className={s.fact}><div className={s.k}>Stop · under the low</div><div className={`${s.v} ${s.down}`}>${t.stop.toFixed(2)}</div></div>
            <div className={s.fact}><div className={s.k}>Stop distance</div><div className={s.v}>{t.dist.toFixed(1)}%</div></div>
            <div className={s.fact}><div className={s.k}>Size at {RISK_PCT}% risk</div><div className={s.v}>{t.posPct.toFixed(0)}%{t.capped ? ' (capped)' : ''}</div></div>
            <div className={s.fact}><div className={s.k}>On ${ACCOUNT.toLocaleString()}</div><div className={s.v}>{t.shares} sh · ${t.riskUsd} at risk</div></div>
            <div className={s.fact}><div className={s.k}>Stop</div><div className={`${s.v} ${t.held ? s.up : s.down}`}>{t.held ? 'held' : 'hit'}</div></div>
            <div className={s.fact}><div className={s.k}>Best in 20 sessions</div><div className={`${s.v} ${s.up}`}>+{t.hi.toFixed(1)}%</div></div>
          </div>
        ) : null}
        <p className={s.hint}>Entries are the house's: ORB or the break of the previous day's high. The stop under the Kicker's low and the sizing rule (position % = risk % ÷ stop distance %, capped at {CAP_PCT}%) are proposed, your call. Every number is measured from the bars.</p>
      </div>
      <div className={s.foot}><button type="button" className={s.cta}>Continue</button></div>
    </div>
  )
}
