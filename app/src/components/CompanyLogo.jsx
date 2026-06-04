// app/src/components/CompanyLogo.jsx
import { useState } from 'react'
import styles from './CompanyLogo.module.css'

// Deterministic pleasant background from the symbol (stable across renders).
function bgFor(sym) {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return `hsl(${h} 32% 26%)`
}

export default function CompanyLogo({ sym, size = 38, round = false }) {
  const [failed, setFailed] = useState(false)
  const s = (sym || '').toUpperCase()
  const px = `${size}px`
  const rc = round ? ` ${styles.round}` : ''
  if (failed || !s) {
    return (
      <span className={`${styles.mono}${rc}`} aria-label={`${s} logo`}
            style={{ width: px, height: px, background: bgFor(s), fontSize: size * 0.4 }}>
        {s.slice(0, 1) || '?'}
      </span>
    )
  }
  // A cold logo returns a 1x1 transparent PNG (loads "successfully"), so onError
  // alone won't catch it. Detect the placeholder via naturalWidth and fall back
  // to the monogram — otherwise cold tickers render as blank white circles.
  const handleLoad = (e) => {
    if (e.currentTarget.naturalWidth <= 2) setFailed(true)
  }
  return (
    <span className={`${styles.wrap}${rc}`} style={{ width: px, height: px }}>
      <img className={styles.img} src={`/api/ticker-logo/${s}`} alt={`${s} logo`}
           loading="lazy" onError={() => setFailed(true)} onLoad={handleLoad} />
    </span>
  )
}
