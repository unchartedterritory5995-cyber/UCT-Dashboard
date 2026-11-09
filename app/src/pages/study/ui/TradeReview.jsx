// THE TRADE, REVIEWED, for every Study screen that shows a setup's lesson (Hard mode's coach card, the drills' answer
// card): the owner's rule 8 and the one-fix-everywhere rule (docs/study/OWNER_PRINCIPLES.md).
import { reviewTrade } from '../challenges/hardMode'
import Emph from './emphasize'
import s from './study.module.css'

// THE TRADE (round 22; the owner, batch 22, on the lesson: "The table of data and numbers I dont like really. I would
// rather have Entry, Stop, Trim, Trail, Advance, Numbers stuff like that. Detail and review the trade and explain the
// trade and the setup and the entry and the pattern and teach it all."). Round 23 (2026-11-08, "Those answers are out
// there ... in the app"): every setup the detectors cover comes with its plan from the server (api/services/
// study_trade.py: the detector's own entry and stop, trims at 2R and 3R, its trail; the Kicker on his rulings), reviewed
// against the bars after the signal (hardMode.reviewTrade). A chart without a plan shows the move measured from the
// candle that fired, and the line a close must not break (hardMode.culmination). The table: docs/study/TRADE_PLANS.md.
const px = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—')
const pct = (v, sign = true) => (Number.isFinite(v) ? `${sign && v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')
function Leg({ k, v, note, tone = '' }) {
  return <div className={`${s.leg} ${tone ? s[`leg_${tone}`] : ''}`}><small>{k}</small><b>{v}</b><span>{note}</span></div>
}
export function TradeBlock({ trade: t, name }) {
  if (t.kind === 'plan') {
    const own = t.skill === 'setup.family3.kicker' ? 'your Kicker rules' : `the ${name} rules`
    const hit = (at) => (at == null ? 'not reached' : at === 0 ? 'hit on the signal day' : `hit on session ${at}`)
    const r = Number.isFinite(t.r) ? ` · ${t.r.toFixed(1)}R` : ''
    const notes = [t.trail ? `Trail ${t.trail}.` : null, t.trim_note ? `${t.trim_note.charAt(0).toUpperCase()}${t.trim_note.slice(1)}.` : null].filter(Boolean)
    return (
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The trade · {own}</span>
        <div className={s.legs} role="list">
          <Leg k={t.long ? 'Entry' : 'Short'} v={px(t.entry)} note={t.entry_note} tone="gold" />
          <Leg k="Stop" v={px(t.stop)} note={`${t.stop_note} · risk ${pct(t.riskPct, false)}`} tone="down" />
          <Leg k="Trim" v={`${px(t.t1)} · ${px(t.t2)}`} note={`2R ${hit(t.t1At)}; 3R ${hit(t.t2At)}`} tone={t.t1At != null ? 'up' : ''} />
          <Leg k={t.long ? 'Advance' : 'Fall, in your favour'} v={t.long ? pct(t.advancePct) : `${Math.abs(t.advancePct).toFixed(1)}%`} note={t.bestSessions != null ? `to the best ${t.long ? 'high' : 'low'}, session ${t.bestSessions}${r}` : `no new ${t.long ? 'high' : 'low'} after entry`} tone="up" />
        </div>
        <p className={s.tradeLine}>
          {t.stoppedSession ? <>The stop was hit on session <b>{t.stoppedSession}</b>; the trade ends there. </> : <>The stop was never hit in the sessions shown. </>}
          {notes.join(' ')}
        </p>
      </div>
    )
  }
  const held = t.broke ? `a close broke the line on session ${t.broke}` : 'the whole run shown'
  return (
    <div className={s.coachBlock}>
      <span className={s.coachLabel}>The move · from the candle that fired</span>
      <div className={s.legs} role="list">
        <Leg k="Signal close" v={px(t.close)} note={`the close of the ${name} candle`} tone="gold" />
        <Leg k={t.short ? 'Must stay under' : 'Must hold'} v={px(t.line)} note={t.short ? 'the candle’s high; a close over it ends it' : 'the candle’s low; a close under it ends it'} tone="down" />
        <Leg k={t.short ? 'Decline' : 'Advance'} v={pct(t.advancePct)} note={`to the ${t.short ? 'lowest low' : 'best high'} in ${t.sessions} session${t.sessions === 1 ? '' : 's'}`} tone={t.short ? 'down' : 'up'} />
        <Leg k="Held" v={t.broke ? `${t.broke - 1} session${t.broke - 1 === 1 ? '' : 's'}` : 'Yes'} note={held} />
      </div>
    </div>
  )
}

/** The trade in one line, built only from the measured numbers, so the lesson leads with its message. */
function takeaway(t) {
  const p = (v) => `$${v.toFixed(2)}`
  const c = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
  if (t.kind === 'plan') {
    const verb = t.long ? 'Bought' : 'Shorted'
    const r = Number.isFinite(t.r) ? ` (${t.r.toFixed(1)}R)` : ''
    const targets = t.t2At != null ? ' and reached both targets' : t.t1At != null ? ' and reached 2R' : ''
    const stop = t.stoppedSession ? `, then the stop was hit on session ${t.stoppedSession}` : ''
    const move = t.bestSessions != null ? `${t.long ? `it ran ${c(t.advancePct)}` : `it fell ${Math.abs(t.advancePct).toFixed(1)}% in your favour`}${r}${targets}${stop}` : `it never got going${stop}`
    return `${verb} at ${p(t.entry)}, risking ${t.riskPct.toFixed(1)}% to the stop at ${p(t.stop)}; ${move}.`
  }
  return t.broke
    ? `From the signal close it went ${c(t.advancePct)} in ${t.sessions} sessions, then a close broke ${p(t.line)} on session ${t.broke}.`
    : `From the signal close it went ${c(t.advancePct)} in ${t.sessions} sessions, and ${p(t.line)} held the whole way.`
}

/** The trade in one line, its message first (the owner, batch 24: "easier to read while getting a really good message
 *  across"). */
export function Takeaway({ trade }) {
  return <p className={s.takeaway}><Emph>{takeaway(trade)}</Emph></p>
}

/** The trade on its own, for a screen that has the plan (reveal.trade), the signal bar and the bars after it. */
export default function TradeReview({ plan, signal, forward, name }) {
  const t = reviewTrade(plan, signal, forward)
  if (!t) return null
  return (
    <div className={`${s.kit} ${s.tradeReview}`} data-testid="trade-review">
      <Takeaway trade={t} />
      <TradeBlock trade={t} name={name} />
    </div>
  )
}
