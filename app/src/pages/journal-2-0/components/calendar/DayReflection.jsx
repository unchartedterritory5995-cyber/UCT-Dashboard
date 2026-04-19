/**
 * Day reflection — markdown-style notes editor with debounced auto-save.
 * Saves on blur immediately; saves on idle (~1.5s) while typing.
 */

import { useEffect, useRef, useState } from 'react'
import styles from './DayReflection.module.css'

const AUTOSAVE_DEBOUNCE_MS = 1500

export default function DayReflection({
  initialNotes = '',
  attachments = [],
  rules = [],
  onSave,        // ({ notes, attachments, rules }) => Promise<bool>
  saving,
  error,
}) {
  const [text, setText] = useState(initialNotes)
  const [status, setStatus] = useState('idle') // idle | typing | saving | saved | error
  const lastSavedRef = useRef(initialNotes)
  const debounceRef = useRef(null)

  // Sync from prop only when initialNotes changes (e.g. user navigates days)
  useEffect(() => {
    setText(initialNotes)
    lastSavedRef.current = initialNotes
    setStatus('idle')
  }, [initialNotes])

  const triggerSave = async (nextText) => {
    if (nextText === lastSavedRef.current) return
    setStatus('saving')
    const ok = await onSave({ notes: nextText, attachments, rules })
    if (ok) {
      lastSavedRef.current = nextText
      setStatus('saved')
      // Clear "Saved" indicator after 2s
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
    } else {
      setStatus('error')
    }
  }

  const handleChange = (e) => {
    const v = e.target.value
    setText(v)
    setStatus('typing')
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => triggerSave(v), AUTOSAVE_DEBOUNCE_MS)
  }

  const handleBlur = () => {
    clearTimeout(debounceRef.current)
    triggerSave(text)
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const indicator =
    error || status === 'error' ? <span className={styles.error}>· couldn't save</span>
    : status === 'saving' ? <span className={styles.muted}>· saving…</span>
    : status === 'saved'  ? <span className={styles.saved}>· saved</span>
    : status === 'typing' ? <span className={styles.muted}>· unsaved</span>
    : null

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Reflection notes</h3>
        <span className={styles.status}>{indicator}</span>
      </div>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="What did you learn today? Mistakes, wins, patterns to watch?"
        rows={8}
        maxLength={10000}
        spellCheck="true"
      />
      <p className={styles.charCount}>
        {text.length} / 10,000
      </p>
    </section>
  )
}
