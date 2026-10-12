// Notebook P1 (spec P1.4): the note menu's "Save this note's setup as a style" door -- the button, the
// naming form and the sentence it leaves behind. It lives in the lazy styles chunk so the menu (in the
// Notebook's first-open closure) carries one Suspense mount and nothing else; NoteMenuActions mounts it only
// while journal styles are on. Same look as the menu's own buttons (it borrows their stylesheet).
import { useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import SaveAsStyleForm from './SaveAsStyleForm'
import styles from '../NoteMenuActions.module.css'

export default function SaveStyleDoor({ note, onBeforeSave }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)   // { message, tone }
  const btnRef = useRef(null)
  return (
    <>
      <button ref={btnRef} type="button" className={styles.btn} aria-expanded={open}
        onClick={() => { setStatus(null); setOpen((v) => !v) }}
        title="Reuse this note's blocks, outline and property values as a journal style">
        <UIcon name="sliders" size={13} gold={false} />
        Save this note&apos;s setup as a style
      </button>
      {open && (
        <SaveAsStyleForm
          note={note}
          onBeforeSave={onBeforeSave}
          onDone={(sentence, { failed } = {}) => {
            setOpen(false)
            if (sentence) setStatus({ tone: failed ? 'error' : 'ok', message: sentence })
            btnRef.current?.focus()
          }}
        />
      )}
      {status && (
        <span className={status.tone === 'error' ? styles.statusError : styles.status} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.message}
        </span>
      )}
    </>
  )
}
