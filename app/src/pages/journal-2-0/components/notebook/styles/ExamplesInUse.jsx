// P3b Task 6: "In use" -- a style's approved example notes, shown in the surface P3a already uses to show one style in
// full (its Preview, ruling P3b-R7; there is no style item page). One card per example: its title and its STORED
// body (the server's example reduction, ruling P3b-R13), rendered read-only by the library's own renderer
// (TemplatePreview's DocBody, the one the author's preview sheet uses). Its images are on the gallery image route, as
// the server stored them: the approved copies, which any paid member may load.
// Nothing at all when the style has no examples, or when the server sent none (the switch off, an older pod).
// ⛔ Lazy-only: StyleItemPreview.jsx imports this, and TemplateGallery.jsx (a lazy chunk) imports that. DocBody is
//    NOT edited (it is in the Notebook's first open; +0 B).
import { useId } from 'react'
import { DocBody } from '../TemplatePreview'
import styles from '../TemplateGallery.module.css'

export const IN_USE_HEADING = 'In use'
export const IN_USE_NOTE = 'Notes its author wrote with this style, reviewed by UCT. Amounts and account details are replaced.'

export default function ExamplesInUse({ examples }) {
  const uid = useId()
  if (!Array.isArray(examples) || !examples.length) return null
  return (
    <section className={styles.inUse} aria-labelledby={`${uid}-in-use`} data-examples-in-use="">
      <h3 className={styles.inUseHeading} id={`${uid}-in-use`}>{IN_USE_HEADING}</h3>
      <p className={styles.inUseNote}>{IN_USE_NOTE}</p>
      <ul className={styles.inUseList}>
        {examples.map((e) => (
          <li key={e.id} className={styles.inUseCard} data-example-in-use={e.id}>
            <h4 className={styles.inUseTitle}>{e.title}</h4>
            <DocBody body={e.bodyJson} />
          </li>
        ))}
      </ul>
    </section>
  )
}
