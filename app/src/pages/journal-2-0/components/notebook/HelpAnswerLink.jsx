// S14 (audit 2026-11-05, "answers in context"): a feature's own "?" opens ITS Quick Answer on the Support page --
// `/support#answer-<faq id>`, which opens that answer and puts focus on its question (Support.jsx QuickAnswers).
// The Quick Answers (Support.jsx FAQS) are the one source of the words; this is only the door to one of them.
// A real link (new tab, copy, middle-click all work), named for what it answers, at the tap floor on touch.
import { Link, useInRouterContext } from 'react-router-dom'
import { answerHref } from '../../../../components/helpAnchors'
import styles from './HelpAnswerLink.module.css'

export default function HelpAnswerLink({ faqId, topic, className = '' }) {
  // A plain link where no router is above it (a surface rendered on its own): the same address, a document load.
  const routed = useInRouterContext()
  const props = {
    className: `${styles.link} ${className}`, 'aria-label': `Help: ${topic}`, title: `Help: ${topic}`,
    'data-help-answer': faqId,
  }
  const mark = <span aria-hidden="true">?</span>
  return routed ? <Link to={answerHref(faqId)} {...props}>{mark}</Link> : <a href={answerHref(faqId)} {...props}>{mark}</a>
}
