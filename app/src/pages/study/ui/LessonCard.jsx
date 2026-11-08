// THE LESSON CARD (round 18; round 21 after the owner, batch 21: "I think our explanations our better than before but
// can still be simpler to read and more direct as a teacher and mentor. Also I think the explanation text box can look
// a lot better."). A coach's card in three moves, the way a teacher walks a student through a chart:
//   1. a direct headline: "Why it's an Oops Reversal" / "Why nothing fired";
//   2. THE LAST CANDLE, MEASURED: six numbers read off the bars in front of the member (ui/candleRead.js);
//   3. ON THIS CHART: the bank's own measured sentence about this chart, one clause a line (or, on a chart where nothing
//      fired, the bank's reason the candidate setup did not), then THE RULE as the numbered steps the bank already wrote
//      (lesson.stepsOf), with the rest of the rule on demand.
// Not a word of a lesson is rewritten. A near-miss chart's lesson is a template with no rule in it, so the rule comes
// from the reveal's `setup_rule`: the same setup's definition as the approved lessons write it (study_hard.setup_rule).
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { readCandle, readText, readTone } from './candleRead'
import { sentencesOf, splitLesson, stepsOf } from './lesson'
import Emph from './emphasize'
import s from './study.module.css'

const an = (n) => `${/^[AEIOU]/i.test(String(n || '')) ? 'an' : 'a'} ${n}`
const low = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)

export default function LessonCard({ text, ticker = null, setup = null, fired = null, bars = null, signal = null, setupRule = null, tf = 'Daily', testId = 'hard-lesson', plain = false, trade = null, showReads = true }) {
  const L = splitLesson(text)
  const name = setup || L.setup
  // the rule: this lesson's own, or the setup's definition from the bank when this lesson is a template
  const R = L.ruleLead ? L : (setupRule?.text ? splitLesson(`${setupRule.name || name}: ${setupRule.text}`) : null)
  const ruleName = (R && R !== L ? (setupRule?.name || name) : (L.setup || name)) || name
  const steps = R ? stepsOf(R.ruleLead) : []
  const rest = R ? R.ruleRest : ''
  const reads = bars && showReads ? readCandle(bars, signal == null ? bars.length - 1 : signal) : []
  const onChart = L.here ? sentencesOf(L.here) : (L.nothing && L.reason ? [`Not ${an(L.setup || name)}: ${low(L.reason)}`] : [])
  const title = fired === true ? `Why it’s ${an(name)}` : fired === false ? 'Why nothing fired' : 'The lesson'
  if (!steps.length && !onChart.length && !reads.length && !trade) return null
  return (
    <section className={`${s.coach} ${plain ? s.coachPlain : ''} ${fired === false ? s.coachNone : ''}`} data-testid={testId || undefined} aria-label={title}>
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The lesson</span>
          <h3 className={s.coachTitle}>{title}</h3>
        </div>
        {ticker ? <span className={s.tag}><b>{ticker}</b> · {tf}</span> : null}
      </header>
      {trade ? <p className={s.takeaway}><Emph>{takeaway(trade)}</Emph></p> : null}
      {trade ? <TradeBlock trade={trade} name={name} /> : null}
      {reads.length ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The last candle, measured</span>
          <div className={s.reads} role="list">
            {reads.map((r) => (
              <div key={r.id} className={`${s.read} ${readTone(r) ? s[`read_${readTone(r)}`] : ''}`} role="listitem">
                <small>{r.label}</small>
                <b>{readText(r)}</b>
                <span>{r.note}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {onChart.length ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>On this chart</span>
          <ul className={s.leadList}>{onChart.map((c, i) => <li key={i}><Emph>{c}</Emph></li>)}</ul>
        </div>
      ) : null}
      {steps.length ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>{trade ? 'The setup' : 'The rule'}{ruleName ? ` · ${ruleName}` : ''}</span>
          <ol className={s.steps}>{steps.map((t, i) => <li key={i}><i aria-hidden="true">{i + 1}</i><span><Emph>{t}</Emph></span></li>)}</ol>
          {rest ? <details className={s.more}><summary>Read the whole rule</summary><p>{rest}</p></details> : null}
        </div>
      ) : null}
    </section>
  )
}

// THE TRADE (round 22; the owner, batch 22, on the lesson: "The table of data and numbers I dont like really. I would
// rather have Entry, Stop, Trim, Trail, Advance, Numbers stuff like that. Detail and review the trade and explain the
// trade and the setup and the entry and the pattern and teach it all."). The Kicker's entry and stop are his rules
// (hardMode.kickerTrade); every other setup shows the move measured from the candle that fired, and the line a close
// must not break (hardMode.culmination). Trim and trail wait on his rules per setup.
const px = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—')
const pct = (v, sign = true) => (Number.isFinite(v) ? `${sign && v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')
function Leg({ k, v, note, tone = '' }) {
  return <div className={`${s.leg} ${tone ? s[`leg_${tone}`] : ''}`}><small>{k}</small><b>{v}</b><span>{note}</span></div>
}
function TradeBlock({ trade: t, name }) {
  if (t.kind === 'kicker' && !t.triggered) {
    return (
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The trade · your Kicker rules</span>
        <p className={s.tradeLine}>No entry. Day 2 never traded over the Kicker’s high of <b>{px(t.entry)}</b>, so the rule never took the trade.</p>
      </div>
    )
  }
  if (t.kind === 'kicker') {
    const atLow = Math.abs(t.stop - t.entry * (1 - 0.035)) > 1e-9
    return (
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The trade · your Kicker rules</span>
        <div className={s.legs} role="list">
          <Leg k="Entry" v={px(t.entry)} note="over the Kicker’s high, on day 2" tone="gold" />
          <Leg k="Stop" v={px(t.stop)} note={atLow ? 'under the Kicker’s low' : '3.5% under the entry, closer than the low'} tone="down" />
          <Leg k="Risk" v={pct(t.riskPct, false)} note="entry to stop" />
          <Leg k="Advance" v={pct(t.advancePct)} note={t.bestSessions ? `to the best high, session ${t.bestSessions}${Number.isFinite(t.r) ? ` · ${t.r.toFixed(1)}R` : ''}` : 'no new high after entry'} tone="up" />
        </div>
        <p className={s.tradeLine}>{t.stoppedSession ? <>The stop was hit on session <b>{t.stoppedSession}</b>; the advance counts only up to then.</> : <>The stop was never hit in the sessions shown.</>}</p>
      </div>
    )
  }
  const held = t.broke ? `until session ${t.broke}` : 'the whole run shown'
  return (
    <div className={s.coachBlock}>
      <span className={s.coachLabel}>The move · from the candle that fired</span>
      <div className={s.legs} role="list">
        <Leg k="Signal close" v={px(t.close)} note={`the close of the ${name} candle`} tone="gold" />
        <Leg k={t.short ? 'Must stay under' : 'Must hold'} v={px(t.line)} note={t.short ? 'the candle’s high; a close over it ends it' : 'the candle’s low; a close under it ends it'} tone="down" />
        <Leg k={t.short ? 'Decline' : 'Advance'} v={pct(t.advancePct)} note={`to the ${t.short ? 'lowest low' : 'best high'} in ${t.sessions} session${t.sessions === 1 ? '' : 's'}`} tone={t.short ? 'down' : 'up'} />
        <Leg k="Held" v={t.broke ? `${t.broke}` : 'Yes'} note={held} />
      </div>
    </div>
  )
}

/** The trade in one line, built only from the measured numbers, so the lesson leads with its message. */
function takeaway(t) {
  const p = (v) => `$${v.toFixed(2)}`
  const c = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
  if (t.kind === 'kicker' && !t.triggered) return `No trade: day 2 never cleared the Kicker’s high of ${p(t.entry)}.`
  if (t.kind === 'kicker') {
    const r = Number.isFinite(t.r) ? ` (${t.r.toFixed(1)}R)` : ''
    return `Bought over the Kicker’s high at ${p(t.entry)}, risked ${t.riskPct.toFixed(1)}%, and it ran ${c(t.advancePct)}${r}${t.stoppedSession ? ` before the stop was hit on session ${t.stoppedSession}` : ''}.`
  }
  return t.broke
    ? `From the signal close it went ${c(t.advancePct)} in ${t.sessions} sessions, then a close broke ${p(t.line)} on session ${t.broke}.`
    : `From the signal close it went ${c(t.advancePct)} in ${t.sessions} sessions, and ${p(t.line)} held the whole way.`
}
