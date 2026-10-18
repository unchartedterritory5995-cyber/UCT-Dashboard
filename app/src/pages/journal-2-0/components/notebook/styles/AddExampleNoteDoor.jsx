// P3b Task 5: the author's door, "Add an example note" (plan R-P3b-9, ruling P3b-R7). There is no style item page:
// the door is in the Share form of a style already in the library (ShareStyleForm) and on the author's own listed
// style in Your submissions (TemplateGallery's MySubmissions). Each host offers it only while the library list says
// `capabilities.exampleNotes` (ruling P3b-R6), and only on a style the server would link (styleLibrary.js's
// `isLinkableStyleItem`: the author's own, pending or approved, not hidden; the server re-checks under its lock).
// The door is the button, then the picker (ExampleNotePicker), then the preview (ExamplePreviewSheet). It stays
// mounted through all three, so the sentence after Submit is said by something that outlives the sheet that closed.
// ⛔ LOADED ON DEMAND: both hosts take this file through `lazyChunk(() => import('./AddExampleNoteDoor'))`, so its
//    chunk (and the picker's, the sheet's and their stylesheet) is named only inside the lazy chunks that open it,
//    never in the Notebook's first open -- a STATIC import from two lazy chunks made a shared chunk whose name rode
//    in the eager chunk's preload list (+53 B, measured). P3b-R9: +0 B.
// ⛔ There is no door in the note editor (eager), by design (R-P3b-9).
import { useRef, useState } from 'react'
import ExampleNotePicker from './ExampleNotePicker'
import ExamplePreviewSheet from './ExamplePreviewSheet'
import styles from './ExampleNote.module.css'

export const ADD_EXAMPLE_LABEL = 'Add an example note'

/**
 * The door: the button, then the picker, then the preview sheet. It stays mounted through all three, so the
 * sentence after Submit is said by something that outlives the sheet that closed.
 * @param styleItemId the author's style item (pending or approved, not hidden)
 * @param describedBy optional id of the element naming the style (a Your submissions row's title)
 * @param onSent      optional `(sentence) => void`: the host says it (the gallery's message line); without it the
 *                    door says it beside itself
 */
export default function AddExampleNoteDoor({ styleItemId, describedBy, onSent }) {
  const [step, setStep] = useState(null)               // null | 'pick' | {note}
  const [said, setSaid] = useState('')
  const doorRef = useRef(null)
  // ⛔ P3b-T5-R8 (review I-2): the picker unmounts and the preview mounts in ONE commit, and the preview's Sheet
  // records its opener while rendering -- the picker row being removed. Focus goes to the door FIRST, so the
  // preview's opener is the door, and closing it (Cancel, Escape, a sent example) gives focus back to the door.
  const pick = (note) => {
    doorRef.current?.focus()
    setStep({ note })
  }

  const sent = (sentence) => {
    setStep(null)
    if (onSent) onSent(sentence)
    else setSaid(sentence)
  }

  return (
    <div className={styles.door}>
      <button type="button" ref={doorRef} className={styles.btn} aria-describedby={describedBy || undefined}
        onClick={() => { setSaid(''); setStep('pick') }}>
        {ADD_EXAMPLE_LABEL}
      </button>
      {!onSent && <p className={styles.status} role="status">{said}</p>}
      {step === 'pick' && (
        <ExampleNotePicker styleItemId={styleItemId} onClose={() => setStep(null)} onPick={pick} />
      )}
      {step?.note && (
        <ExamplePreviewSheet note={step.note} styleItemId={styleItemId} onClose={() => setStep(null)} onSent={sent} />
      )}
    </div>
  )
}
