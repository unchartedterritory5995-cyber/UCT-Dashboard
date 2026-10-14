import { useEffect, useId, useRef, useState } from 'react'
import Input from '../../../components/ui/Input'
import styles from './FocusScreener.module.css'

// NameDialog — the one small "name it" box the Save menu and the screen menu share
// (spec §8.1: named inline, never window.prompt). A modal dialog: the input takes
// focus, Enter submits, Escape cancels, Tab stays inside, and focus goes back to
// whatever opened it. An empty name cannot be saved.
export default function NameDialog({ title, label, initial = '', submitLabel = 'Save', onSubmit, onCancel }) {
  const [value, setValue] = useState(initial)
  const box = useRef(null)
  const input = useRef(null)
  const titleId = useId()
  const inputId = useId()
  useEffect(() => {
    const opener = document.activeElement
    input.current?.focus()
    input.current?.select?.()
    return () => { if (opener && opener.isConnected) opener.focus?.() }
  }, [])
  const name = value.trim()
  const submit = e => { e.preventDefault(); if (name) onSubmit(name.slice(0, 80)) }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return }
    if (e.key !== 'Tab') return
    const list = [...box.current.querySelectorAll('input,button:not([disabled])')]
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className={styles.dialogScrim} onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.nameDialog}
        onSubmit={submit} onKeyDown={onKeyDown}>
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <label htmlFor={inputId} className={styles.dialogLabel}>{label}</label>
        <Input id={inputId} ref={input} type="text" className={styles.dialogInput} value={value} maxLength={80}
          onChange={e => setValue(e.target.value)} />
        <div className={styles.stateActions}>
          <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={!name}>{submitLabel}</button>
        </div>
      </form>
    </div>
  )
}
