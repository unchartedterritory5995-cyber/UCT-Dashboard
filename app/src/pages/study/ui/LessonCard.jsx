// THE LESSON CARD (round 18; owner, batch 18: "significant improvement and simplification"). What happened on THIS chart
// leads, in the bank's own measured sentence; the rule's first sentence follows; the whole rule opens on demand. The
// ticker and timeframe sit as a tag, since the ticker is the one thing Hard mode kept from the member until now.
import { splitLesson } from './lesson'
import s from './study.module.css'

export default function LessonCard({ text, ticker = null, setup = null, tf = 'Daily', testId = 'hard-lesson' }) {
  const L = splitLesson(text)
  const name = setup || L.setup
  const lead = L.here || L.ruleLead || L.rule
  const showRule = !!L.here && !!L.ruleLead
  if (!lead) return null
  return (
    <section className={s.lesson} data-testid={testId || undefined} aria-label="The lesson">
      <div className={s.lessonHead}>
        <span className={s.eyebrow}>What happened here</span>
        {ticker ? <span className={s.tag}><b>{ticker}</b> · {tf}</span> : null}
      </div>
      <p className={s.lead}>{lead}</p>
      {showRule ? (
        <>
          <span className={`${s.eyebrow} ${s.dim}`}>The rule{name ? ` · ${name}` : ''}</span>
          <p className={s.rule}>{L.ruleLead}</p>
          {L.ruleRest ? <details className={s.more}><summary>Read the whole rule</summary><p>{L.ruleRest}</p></details> : null}
        </>
      ) : null}
    </section>
  )
}
