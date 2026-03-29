// app/src/components/chart/ColorPicker.jsx — Reusable color picker with swatches + hex input
import { useState, useRef, useEffect } from 'react'
import styles from './ColorPicker.module.css'

const SWATCHES = [
  '#c9a84c', '#4ade80', '#ef4444', '#60a5fa',
  '#f472b6', '#fb923c', '#a78bfa', '#e2e8f0',
  '#3cb868', '#e74c3c', '#2196f3', '#ff9800',
  '#26a69a', '#00c853', '#ff1744', '#131722',
]

export default function ColorPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value || '#c9a84c')
  const ref = useRef(null)

  useEffect(() => { setHex(value || '#c9a84c') }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pick = (c) => {
    setHex(c)
    onChange(c)
    setOpen(false)
  }

  const commitHex = () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
      onChange(hex)
      setOpen(false)
    } else if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{3}$/.test(hex)) {
      onChange('#' + hex)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}
      <button
        className={styles.swatch}
        style={{ background: value }}
        onClick={() => setOpen(!open)}
        title={value}
      />
      {open && (
        <div className={styles.popup}>
          <div className={styles.grid}>
            {SWATCHES.map(c => (
              <button
                key={c}
                className={`${styles.cell} ${c === value ? styles.cellActive : ''}`}
                style={{ background: c }}
                onClick={() => pick(c)}
                title={c}
              />
            ))}
          </div>
          <div className={styles.hexRow}>
            <input
              className={styles.hexInput}
              value={hex}
              onChange={e => setHex(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && commitHex()}
              placeholder="#hex"
              spellCheck={false}
            />
            <button className={styles.hexOk} onClick={commitHex}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
