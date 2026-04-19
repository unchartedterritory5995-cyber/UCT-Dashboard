/**
 * Day reflection — three timed narrative sections (Pre-market Prep /
 * Mid-day Review / Post-market Recap) plus a legacy General Notes
 * catch-all. Each section has its own collapsible card + debounced
 * auto-save (1.5s) and immediate save-on-blur.
 *
 * All four narratives share the same save mutation — each change
 * writes the full day-notes bundle so the server sees the latest
 * state across all fields.
 */

import { useEffect, useRef, useState } from 'react'
import styles from './DayReflection.module.css'

const AUTOSAVE_DEBOUNCE_MS = 1500

const SECTIONS = [
  { key: 'prepNotes', label: 'Pre-market Prep', icon: '📋',
    placeholder: "Watchlist, catalysts, key levels, plan for the day…" },
  { key: 'midDayNotes', label: 'Mid-day Review', icon: '🔍',
    placeholder: "How's the plan going? Deviations? Emotional state?" },
  { key: 'recapNotes', label: 'Post-market Recap', icon: '📊',
    placeholder: "What worked? What didn't? Carries over to tomorrow?" },
  { key: 'notes', label: 'General Notes', icon: '📝',
    placeholder: "Anything else?" },
]

export default function DayReflection({
  initialNotes = '',
  initialPrep = '',
  initialMidDay = '',
  initialRecap = '',
  attachments = [],
  rules = [],
  onSave,
  saving,
  error,
}) {
  return (
    <div className={styles.stack}>
      {SECTIONS.map((s) => (
        <Section
          key={s.key}
          sectionKey={s.key}
          label={s.label}
          icon={s.icon}
          placeholder={s.placeholder}
          initialValue={
            s.key === 'notes' ? initialNotes :
            s.key === 'prepNotes' ? initialPrep :
            s.key === 'midDayNotes' ? initialMidDay :
            initialRecap
          }
          attachments={attachments}
          rules={rules}
          currentAll={{
            notes: initialNotes,
            prepNotes: initialPrep,
            midDayNotes: initialMidDay,
            recapNotes: initialRecap,
          }}
          onSave={onSave}
          externalError={error}
        />
      ))}
    </div>
  )
}

function Section({
  sectionKey, label, icon, placeholder, initialValue,
  attachments, rules, currentAll, onSave, externalError,
}) {
  const [text, setText] = useState(initialValue)
  const [open, setOpen] = useState(() => Boolean(initialValue && initialValue.length > 0))
  const [status, setStatus] = useState('idle') // idle | typing | saving | saved | error
  const lastSavedRef = useRef(initialValue)
  const debounceRef = useRef(null)

  useEffect(() => {
    setText(initialValue)
    lastSavedRef.current = initialValue
    setStatus('idle')
    if (initialValue && initialValue.length > 0) setOpen(true)
  }, [initialValue])

  const triggerSave = async (nextText) => {
    if (nextText === lastSavedRef.current) return
    setStatus('saving')
    const merged = { ...currentAll, [sectionKey]: nextText }
    const ok = await onSave({
      notes: merged.notes,
      prepNotes: merged.prepNotes,
      midDayNotes: merged.midDayNotes,
      recapNotes: merged.recapNotes,
      attachments,
      rules,
    })
    if (ok) {
      lastSavedRef.current = nextText
      setStatus('saved')
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
    externalError || status === 'error' ? <span className={styles.error}>· couldn't save</span>
    : status === 'saving' ? <span className={styles.muted}>· saving…</span>
    : status === 'saved'  ? <span className={styles.saved}>· saved</span>
    : status === 'typing' ? <span className={styles.muted}>· unsaved</span>
    : null

  const preview = text.trim().split('\n')[0].slice(0, 80)

  return (
    <section className={`${styles.section} ${open ? styles.open : ''}`}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
      >
        <span className={styles.chev}>{open ? '▼' : '▶'}</span>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.title}>{label}</span>
        {!open && preview && (
          <span className={styles.preview}>{preview}{text.length > 80 ? '…' : ''}</span>
        )}
        <span className={styles.status}>{indicator}</span>
      </button>
      {open && (
        <div className={styles.body}>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            rows={6}
            maxLength={10000}
            spellCheck="true"
          />
          <p className={styles.charCount}>
            {text.length} / 10,000
          </p>
        </div>
      )}
    </section>
  )
}
