// app/src/components/research/SectionLead.jsx
//
// The one lead treatment every canvas in this modal opens with.
//
// The Setup canvas got a derived sentence first and it changed how the panel
// reads: the reader is told the answer, and everything under it is evidence
// for that answer rather than raw material they have to assemble themselves.
// The other canvases still opened on instruments. This is that idiom, made
// ONE component instead of a shape each section re-types — the failure in
// `lesson_one_grammar_four_hand_written_copies`, which this repo has paid for.
//
// PURE DISPLAY, and deliberately dumb: it renders a string. Every sentence is
// built by a pure function beside the data it describes (`sectionLeads.js`,
// and SetupSection's own `pricedLine`/`recordLine`), so each one is unit
// testable without a DOM and none of them can quietly start fetching.
//
// ⛔ RENDERS NOTHING FOR AN ABSENT LEAD. A lead builder returns null whenever
// the payload cannot support the claim, and an empty band where a sentence
// belongs reads as a load failure. `null` is the honest render.
import styles from './SectionLead.module.css'

export default function SectionLead({ children, testId }) {
  const text = typeof children === 'string' ? children.trim() : children
  if (!text) return null
  return (
    <p className={styles.lead} data-testid={testId || 'section-lead'}>
      {text}
    </p>
  )
}
