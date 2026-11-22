// S14 (audit 2026-11-05, "answers in context"): a feature's own "?" opens ITS Quick Answer on the Support page --
// `/support#answer-<faq id>`, which opens that answer and puts focus on its question (Support.jsx QuickAnswers).
// The Quick Answers (Support.jsx FAQS) are the one source of the words; this is only the door to one of them.
// Tier 2 fix round 1 (review minor 11): it opens in a NEW TAB, so the feature is never left -- Ask's streamed answer,
// an import in progress -- and its name says so. A real link (copy, middle-click work), at the tap floor on touch.
import { answerHref } from '../../../../components/helpAnchors'
import styles from './HelpAnswerLink.module.css'

export const NEW_TAB_WORDS = 'opens in a new tab'

export default function HelpAnswerLink({ faqId, topic, className = '' }) {
  const name = `Help: ${topic} (${NEW_TAB_WORDS})`
  return (
    <a href={answerHref(faqId)} target="_blank" rel="noopener noreferrer" className={`${styles.link} ${className}`}
      aria-label={name} title={name} data-help-answer={faqId}>
      <span aria-hidden="true">?</span>
    </a>
  )
}
