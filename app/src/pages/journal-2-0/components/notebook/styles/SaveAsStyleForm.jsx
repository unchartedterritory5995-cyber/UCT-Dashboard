// Notebook P1 (spec P1.4): "Save this note's setup as a style". The SERVER reads the note (its blocks, the
// rest of the body as the outline, its property values), so the editor's pending words go first:
// `onBeforeSave` is the editor's sendPendingEdits (the note menu's onBeforeTemplate). If words are still
// unsent, nothing is copied. Lazy chunk (NoteMenuActions lazyChunk).
import { useEffect, useRef, useState } from 'react'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { createJournalStyle } from '../../../lib/journalStyles'
import { NOTE_KIND_PROPERTY } from '../../../lib/noteKinds'
import styles from './SaveAsStyleForm.module.css'

export const UNSENT_BEFORE_STYLE = 'Some words are still saving. Try again in a moment.'

/**
 * @param onBeforeSave  `() => Promise<boolean>`; true once the server holds every word the editor has.
 * @param onDone  `(sentence | null, { failed? }) => void`: the host says the sentence and closes the form.
 */
export default function SaveAsStyleForm({ note, onBeforeSave, onDone }) {
  const { data, error: listError, mutate } = useJournalStyles()
  const [phase, setPhase] = useState('checking')        // checking | form
  const [name, setName] = useState(note?.title || '')
  const [picked, setPicked] = useState(null)             // null = the member has not touched the select
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const startedRef = useRef(false)

  // Words first: nothing is shown to name until the server holds the note as the editor has it.
  useEffect(() => {
    if (startedRef.current) return undefined
    startedRef.current = true
    let live = true
    ;(async () => {
      let ok = true
      try { ok = !onBeforeSave || (await onBeforeSave()) } catch { ok = false }
      if (!live) return
      if (ok) setPhase('form'); else onDone?.(UNSENT_BEFORE_STYLE, { failed: true })
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [])

  const kinds = data?.kinds || []
  // The note's CURRENT kind is the builtin:note_kind property; the column is only what it was stamped with
  // at a styled create. A kind this app does not know is no default at all. Nothing is guessed.
  const noteKind = note?.propertiesJson?.[NOTE_KIND_PROPERTY] || note?.kindId || ''
  const defaultKind = kinds.some((k) => k.id === noteKind) ? noteKind : ''
  const chosenKind = picked ?? defaultKind
  // While the list loads (or when the note has no kind) there is nothing chosen, so Save waits; if the list
  // cannot load, the server's own fallback (property, then column) decides, but only when the note has a kind.
  const cannotSave = !chosenKind && !(listError && noteKind)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Words typed while the member was naming it count too.
      if (onBeforeSave && !(await onBeforeSave())) { setError(UNSENT_BEFORE_STYLE); return }
      const out = await createJournalStyle({
        fromNoteId: note.id, name: name.trim() || undefined,
        // An explicit kind overrides the server's fallback, so it is sent only when the member chose one.
        ...(picked && picked !== defaultKind ? { kindId: picked } : {}),
      })
      mutate()
      onDone?.(`Saved as the style “${out?.style?.name || name.trim() || note.title || 'Untitled style'}”.`)
    } catch (err) {
      setError(err?.status ? (err.message || "Couldn't save this style. Nothing was saved.") : "Couldn't save this style. Nothing was saved.")
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'checking') return <span className={styles.status} role="status">Saving your latest words…</span>
  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.label}>Style name</span>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Kind of note</span>
        <select className={styles.input} value={chosenKind} onChange={(e) => setPicked(e.target.value)}>
          {!defaultKind && <option value="">Choose a kind</option>}
          {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <button type="submit" className={styles.btn} disabled={busy || cannotSave}>Save style</button>
      <button type="button" className={styles.btn} onClick={() => onDone?.(null)}>Cancel</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </form>
  )
}
