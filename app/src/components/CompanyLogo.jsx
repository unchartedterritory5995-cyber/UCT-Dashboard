// app/src/components/CompanyLogo.jsx
import { useRef, useState } from 'react'
import styles from './CompanyLogo.module.css'

const MAX_RETRY = 3   // cold logos resolve in the background; re-fetch a few times before giving up to the monogram

// Deterministic pleasant background from the symbol (stable across renders).
function bgFor(sym) {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return `hsl(${h} 32% 26%)`
}

export default function CompanyLogo({ sym, size = 38, round = false, name = null, alt = null }) {
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)   // bumped to re-fetch (cache-busted) while a cold logo resolves
  const timerRef = useRef(null)
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
  // alone won't catch it. Detect the placeholder via naturalWidth. The first
  // view kicks off a background resolve server-side, so rather than give up
  // immediately, re-fetch a few times (cache-busted) to pick up the resolved
  // logo without a manual reload; fall back to the monogram only after that.
  const handleLoad = (e) => {
    if (e.currentTarget.naturalWidth <= 2) {
      if (retry < MAX_RETRY) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setRetry(r => r + 1), 1800)
      } else {
        setFailed(true)
      }
    }
  }
  // Optional resolution hints for non-US tickers (company name + exchange-suffixed
  // symbol) so the backend can fall back to name→domain / alt-symbol logo sources.
  const q = []
  if (name) q.push(`name=${encodeURIComponent(name)}`)
  if (alt) q.push(`alt=${encodeURIComponent(alt)}`)
  if (retry) q.push(`_r=${retry}`)   // cache-bust the 60s placeholder so the retry re-hits the server
  const src = `/api/ticker-logo/${s}${q.length ? `?${q.join('&')}` : ''}`
  return (
    <span className={`${styles.wrap}${rc}`} style={{ width: px, height: px }}>
      <img className={styles.img} src={src} alt={`${s} logo`}
           loading="lazy" onError={() => setFailed(true)} onLoad={handleLoad} />
    </span>
  )
}
