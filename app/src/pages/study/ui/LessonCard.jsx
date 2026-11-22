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
import { approvedPlainRule } from '../studyPlainRules'
import brandMark from '../../../components/intro/assets/compass-mark.webp'
import { readCandle, readText, readTone } from './candleRead'
import { sentencesOf, splitLesson, stepsOf } from './lesson'
import Emph from './emphasize'
import { brandWords } from '../drills/types'
import { Takeaway, TradeBlock } from './TradeReview'
import s from './study.module.css'

const an = (n) => `${/^[AEIOU]/i.test(String(n || '')) ? 'an' : 'a'} ${n}`
const low = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)

export default function LessonCard({ text, ticker = null, setup = null, fired = null, bars = null, signal = null, setupRule = null, tf = 'Daily', testId = 'hard-lesson', plain = false, trade = null, showReads = true, skillId = null }) {
  const L = splitLesson(brandWords(text))   // rule 11: UCT, never "the firm" (the bank's words are otherwise unchanged)
  const name = setup || L.setup
  // the rule: this lesson's own, or the setup's definition from the bank when this lesson is a template
  const R = L.ruleLead ? L : (setupRule?.text ? splitLesson(brandWords(`${setupRule.name || name}: ${setupRule.text}`)) : null)
  const ruleName = (R && R !== L ? (setupRule?.name || name) : (L.setup || name)) || name
  // the setup in plain words, once the owner approves that setup's draft (studyPlainRules.js); the bank's words otherwise
  const plainRule = approvedPlainRule(skillId)
  const steps = plainRule ? plainRule.steps : R ? stepsOf(R.ruleLead) : []
  const rest = plainRule ? plainRule.notIt : R ? R.ruleRest : ''
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
      {trade ? <Takeaway trade={trade} /> : null}
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
