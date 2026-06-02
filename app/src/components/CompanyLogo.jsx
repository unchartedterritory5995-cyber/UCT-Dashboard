// app/src/components/CompanyLogo.jsx
import { useState } from 'react'
import styles from './CompanyLogo.module.css'

// Deterministic pleasant background from the symbol (stable across renders).
function bgFor(sym) {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return `hsl(${h} 32% 26%)`
}

export default function CompanyLogo({ sym, size = 38 }) {
  const [failed, setFailed] = useState(false)
  const s = (sym || '').toUpperCase()
  const px = `${size}px`
  if (failed || !s) {
    return (
      <span className={styles.mono} aria-label={`${s} logo`}
            style={{ width: px, height: px, background: bgFor(s), fontSize: size * 0.4 }}>
        {s.slice(0, 1) || '?'}
      </span>
    )
  }
  return (
    <span className={styles.wrap} style={{ width: px, height: px }}>
      <img className={styles.img} src={`/api/ticker-logo/${s}`} alt={`${s} logo`}
           loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}
