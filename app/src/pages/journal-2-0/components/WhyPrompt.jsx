/**
 * Wave 13 lane 13E-2 — the optional "Why did you take it?" prompt on the Entry-context card.
 *
 * Text only, saved through `PUT /api/j2/entry-context/why` (13E-1's own door for exactly this —
 * it writes only the context row's two `why_*` columns, never a new note). Dictation is a plain
 * `VoiceInputButton`, the SAME component every other J2 text field uses, mounted ONLY while
 * `notebook_voice_notes_enabled` is armed — off, this component never imports a microphone: the
 * button is not in the tree at all, not merely hidden, so nothing it owns can call
 * `getUserMedia`.
 */
import { useEffect, useState } from 'react'
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

  // Reseed when the identity changes (a different position's card) or the server's own
  // answer changes (another tab saved it) — never mid-edit on this same key.
  useEffect(() => {
    setText(why?.text || '')
    setEditing(!why?.text)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, entryDay])

  if (!symbol || !entryDay) return null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await putWhy(symbol, entryDay, text)
      setEditing(false)
      onSaved?.(res.context)
    } catch (e) {
      setError(e.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setText(why?.text || '')
    setEditing(false)
    setError(null)
  }

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
        <button type="button" className={styles.linkBtn} onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-testid="why-prompt-editing" data-tour="entry-context-why">
      <label className={styles.label} htmlFor="why-prompt-text">Why did you take it?</label>
      <div className={styles.row}>
        <textarea
          id="why-prompt-text"
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
    </div>
  )
}
