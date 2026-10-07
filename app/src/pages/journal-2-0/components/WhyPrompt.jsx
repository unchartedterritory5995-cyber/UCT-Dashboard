/**
 * Wave 13 lane 13E-2 — the optional "Why did you take it?" prompt on the Entry-context card.
 *
 * Text only, saved through `PUT /api/j2/entry-context/why` (13E-1's own door for exactly this —
 * it writes only the context row's two `why_*` columns, never a new note). Dictation is a plain
 * `VoiceInputButton`, the SAME component every other J2 text field uses, mounted ONLY while
 * `notebook_voice_notes_enabled` is armed — off, this component never imports a microphone: the
 * button is not in the tree at all, not merely hidden, so nothing it owns can call
 * `getUserMedia`.
 *
 * Lane FIN-A11Y (review R4, I-9): Edit, Save and Cancel each swap the view and unmount the
 * button that was pressed, so focus used to fall to <body>. Edit now lands in the text field;
 * Save and Cancel land on Edit. A status line that is ALWAYS mounted says "Saved." (a status
 * that mounts with its text is often not announced). Focus moves only after one of those three
 * actions, never on first render or when the card shows another position.
 */
import { useEffect, useId, useRef, useState } from 'react'
import VoiceInputButton from './VoiceInputButton'
import { notebookFlag } from '../lib/offline/notebookFlags'
import { putWhy } from '../hooks/useEntryContext'
import styles from './WhyPrompt.module.css'

export const VOICE_NOTES_FLAG = 'notebook_voice_notes_enabled'
const DEFAULT_MAX_CHARS = 500

export default function WhyPrompt({ symbol, entryDay, why, whyMaxChars, onSaved }) {
  const voiceOn = notebookFlag(VOICE_NOTES_FLAG) === true
  const maxChars = Number.isFinite(whyMaxChars) ? whyMaxChars : DEFAULT_MAX_CHARS
  const [editing, setEditing] = useState(!why?.text)
  const [text, setText] = useState(why?.text || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  // One id per card: the position page shows a card per lot, and a fixed id made every
  // label focus the FIRST card's box.
  const fieldId = useId()
  const fieldRef = useRef(null)
  const editRef = useRef(null)
  // Where focus goes after the view swaps: 'field' | 'edit' | null. Set by a member action.
  const focusAfterRef = useRef(null)
  useEffect(() => {
    const want = focusAfterRef.current
    if (!want) return
    const el = want === 'field' ? fieldRef.current : editRef.current
    if (!el) return
    focusAfterRef.current = null
    el.focus()
  }, [editing])

  // Reseed when the identity changes (a different position's card) or the server's own
  // answer changes (another tab saved it) — never mid-edit on this same key.
  useEffect(() => {
    setText(why?.text || '')
    setEditing(!why?.text)
    setError(null)
    setNotice('')
    focusAfterRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, entryDay])

  if (!symbol || !entryDay) return null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await putWhy(symbol, entryDay, text)
      focusAfterRef.current = 'edit'
      setEditing(false)
      setNotice('Saved.')
      onSaved?.(res.context)
    } catch (e) {
      setError(e.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setText(why?.text || '')
    focusAfterRef.current = 'edit'
    setEditing(false)
    setError(null)
  }

  const startEditing = () => {
    focusAfterRef.current = 'field'
    setNotice('')
    setEditing(true)
  }

  // ONE element across both views: both return the same wrapper `<div>`, and the key lets
  // React carry this child from one view's children to the other's, so the region a screen
  // reader is listening to is never replaced, only refilled.
  const status = (
    <p key="why-status" className={styles.notice} role="status" data-why-status="">{notice}</p>
  )

  if (!editing) {
    // ⛔ `why` can still be the PARENT's stale (null) prop for one render after a successful
    // FIRST save -- this component flips local `editing` to false the instant the PUT resolves,
    // before the parent's own refetch (onSaved -> retry()) lands. `why?.text` alone would render
    // an empty flash (or, before this fix, `why.text` on a null `why` CRASHED the component
    // outright); falling back to the just-typed `text` shows the member their own words with no
    // gap at all, and resolves to the server's text within one render once the refetch arrives.
    const shown = why?.text ?? text
    return (
      <div className={styles.wrap} data-testid="why-prompt-saved">
        <div className={styles.label}>Why did you take it?</div>
        <p className={styles.savedText}>{shown}</p>
        <button type="button" ref={editRef} className={styles.linkBtn} onClick={startEditing}>
          Edit
        </button>
        {status}
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-testid="why-prompt-editing" data-tour="entry-context-why">
      <label className={styles.label} htmlFor={fieldId}>Why did you take it?</label>
      <div className={styles.row}>
        <textarea
          ref={fieldRef}
          id={fieldId}
          className={styles.textarea}
          rows={3}
          maxLength={maxChars}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Optional — what you saw, why you entered"
        />
        {voiceOn && (
          <span className={styles.voiceWrap} data-testid="why-prompt-voice">
            <VoiceInputButton onTranscript={(t) => setText((cur) => (cur ? `${cur} ${t}` : t))} />
          </span>
        )}
      </div>
      <div className={styles.actions} data-tour="entry-context-why-save">
        <button type="button" className={styles.saveBtn} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {why?.text ? (
          <button type="button" className={styles.cancelBtn} onClick={cancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {status}
    </div>
  )
}
