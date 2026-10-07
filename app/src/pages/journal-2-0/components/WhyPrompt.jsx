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
 * ⛔ THE SAVE IS A COMPARE-AND-SET, AND A REFUSED SAVE NEVER COSTS THE MEMBER THEIR WORDS
 * (fin-data I5). Each save names the version the typed words were based on (`base`, taken the
 * moment editing starts and never moved by a refetch landing mid-edit). When another tab or
 * device saved in between, the server answers 409: this component stays in the editor with the
 * typed words exactly as they were, shows the server's sentence and the other version, and
 * adopts the other version as the new base -- so pressing Save again is the member's
 * deliberate "replace it", and "Keep the other version" drops nothing but the unsaved draft.
 */
import { useEffect, useRef, useState } from 'react'
import VoiceInputButton from './VoiceInputButton'
import { notebookFlag } from '../lib/offline/notebookFlags'
import { putWhy, WHY_CHANGED } from '../hooks/useEntryContext'
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
  // The stored note as this component last heard it from the SERVER (a save's answer or a
  // refusal's `current`), when that is newer than the parent's `why` prop. Undefined = the
  // prop is the latest we know.
  const [heard, setHeard] = useState(undefined)
  // What another tab or device saved while this one was typing ({text, updatedAt} or null for
  // "cleared"); undefined when there is no conflict to show.
  const [theirs, setTheirs] = useState(undefined)
  // The version the typed words are based on. A ref: it is read at Save, never rendered.
  const base = useRef(why?.updatedAt ?? null)

  // Reseed when the identity changes (a different position's card) or the server's own
  // answer changes (another tab saved it) — never mid-edit on this same key.
  useEffect(() => {
    setText(why?.text || '')
    setEditing(!why?.text)
    setError(null)
    setHeard(undefined)
    setTheirs(undefined)
    base.current = why?.updatedAt ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, entryDay])

  // Once the parent's refetch catches up with what the server told us, the prop leads again.
  useEffect(() => {
    if (heard !== undefined && (why?.updatedAt ?? null) === (heard?.updatedAt ?? null)) setHeard(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [why?.updatedAt])

  if (!symbol || !entryDay) return null

  const known = heard !== undefined ? heard : (why || null)

  const startEditing = () => {
    base.current = known?.updatedAt ?? null   // taken HERE; a refetch mid-edit never moves it
    setText(known?.text || '')
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await putWhy(symbol, entryDay, text, base.current)
      const saved = res.context?.why ?? null
      setHeard(saved)
      base.current = saved?.updatedAt ?? null
      setTheirs(undefined)
      setEditing(false)
      onSaved?.(res.context)
    } catch (e) {
      if (e.status === 409 && e.code === WHY_CHANGED) {
        // ⛔ The typed words stay exactly where they are. Only the base moves, so the next
        // Save is a deliberate replacement of the version shown below.
        const current = e.current ?? null
        setTheirs(current)
        setHeard(current)
        base.current = current?.updatedAt ?? null
      }
      setError(e.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    const kept = theirs !== undefined
    setText(known?.text || '')
    setEditing(!known?.text)
    setError(null)
    setTheirs(undefined)
    if (kept) onSaved?.(null)   // the parent refetches the version that was kept
  }

  if (!editing) {
    // ⛔ `why` can still be the PARENT's stale (null) prop for one render after a successful
    // FIRST save -- this component flips local `editing` to false the instant the PUT resolves,
    // before the parent's own refetch (onSaved -> retry()) lands. `why?.text` alone would render
    // an empty flash (or, before this fix, `why.text` on a null `why` CRASHED the component
    // outright); falling back to the just-typed `text` shows the member their own words with no
    // gap at all, and resolves to the server's text within one render once the refetch arrives.
    const shown = known?.text ?? text
    return (
      <div className={styles.wrap} data-testid="why-prompt-saved">
        <div className={styles.label}>Why did you take it?</div>
        <p className={styles.savedText}>{shown}</p>
        <button type="button" className={styles.linkBtn} onClick={startEditing}>
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
        {theirs !== undefined || known?.text ? (
          <button type="button" className={styles.cancelBtn} onClick={cancel} disabled={busy}>
            {theirs !== undefined ? 'Keep the other version' : 'Cancel'}
          </button>
        ) : null}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {theirs !== undefined && (
        <p className={styles.savedText} data-testid="why-prompt-theirs">
          {theirs?.text
            ? <>The other version: <q>{theirs.text}</q></>
            : 'The other version is empty: the note was cleared.'}
        </p>
      )}
    </div>
  )
}
