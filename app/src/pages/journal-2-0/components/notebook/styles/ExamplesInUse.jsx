// P3b Task 6: "In use" -- a style's approved example notes, shown in the surface P3a already uses to show one style in
// full (its Preview, ruling P3b-R7; there is no style item page). One card per example: its title and its STORED
// body (the server's example reduction, ruling P3b-R13), rendered read-only by the library's own renderer
// (TemplatePreview's DocBody, the one the author's preview sheet uses). Its images are on the gallery image route, as
// the server stored them: the approved copies, which any paid member may load.
// Nothing at all when the style has no examples, or when the server sent none (the switch off, an older pod).
// P3b-F-R8 (final review M-7, spec §P3.3): each card carries its own small Report control, the gallery's ONE report
// flow (`ReportForm`: the same reasons, the same sentences, `reportGalleryTemplate` against THIS example's id), so a
// sanitizer miss a member spots is reported against the example, never only against the whole style. The sentence
// the report answers with stays on the card, and focus goes back to the Report button.
// ⛔ Lazy-only: StyleItemPreview.jsx imports this, and TemplateGallery.jsx (a lazy chunk) imports that. DocBody is
//    NOT edited (it is in the Notebook's first open; +0 B). ReportForm comes from TemplateGallery.jsx, as
//    StyleLibraryCard's does: the same lazy chunk.
import { useId, useRef, useState } from 'react'
import { DocBody } from '../TemplatePreview'
import { ReportForm } from '../TemplateGallery'
import UIcon from '../../../../../components/ui/UIcon'
import styles from '../TemplateGallery.module.css'

export const IN_USE_HEADING = 'In use'
export const IN_USE_NOTE = 'Notes its author wrote with this style, reviewed by UCT. Amounts and account details are replaced.'
export const REPORT_EXAMPLE_LABEL = 'Report'

function ExampleCard({ example, reportable }) {
  const uid = useId()
  const [reporting, setReporting] = useState(false)
  const [said, setSaid] = useState(null)
  const reportBtnRef = useRef(null)
  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }
  return (
    <li className={styles.inUseCard} data-example-in-use={example.id}>
      <div className={styles.inUseHead}>
        <h4 className={styles.inUseTitle} id={`${uid}-title`}>{example.title}</h4>
        {reportable && (
          <button type="button" ref={reportBtnRef} className={`${styles.btn} ${styles.inUseReport}`}
            onClick={() => { setSaid(null); setReporting((v) => !v) }} aria-expanded={reporting}
            aria-label={`Report ${example.title}`} data-example-report={example.id}>
            <UIcon name="flag" size={13} gold={false} /> {REPORT_EXAMPLE_LABEL}
          </button>
        )}
      </div>
      <DocBody body={example.bodyJson} />
      {reporting && (
        <ReportForm item={example} onCancel={closeReport} onDone={(text) => { closeReport(); setSaid(text) }} />
      )}
      {said && <p className={styles.inUseNote} role="status">{said}</p>}
    </li>
  )
}

/** `reportable`: whether the reader may report these examples (false for the style's own author, whose they are). */
export default function ExamplesInUse({ examples, reportable = true }) {
  const uid = useId()
  if (!Array.isArray(examples) || !examples.length) return null
  return (
    <section className={styles.inUse} aria-labelledby={`${uid}-in-use`} data-examples-in-use="">
      <h3 className={styles.inUseHeading} id={`${uid}-in-use`}>{IN_USE_HEADING}</h3>
      <p className={styles.inUseNote}>{IN_USE_NOTE}</p>
      <ul className={styles.inUseList}>
        {examples.map((e) => <ExampleCard key={e.id} example={e} reportable={reportable} />)}
      </ul>
    </section>
  )
}
