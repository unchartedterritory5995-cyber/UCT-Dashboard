// app/src/components/CompanyLogo.jsx
import { useEffect, useRef, useState } from 'react'
import styles from './CompanyLogo.module.css'
import brandMarkAsset from './intro/assets/compass-mark.png'

const LOGO_ASSET_VERSION = 2   // bump to force browsers past the 7-day immutable cache (e.g. after a resolution upgrade)
// Retry backoff (ms). Fast first (a cold logo resolves server-side in ~1-2s), then
// LONGER so a transient miss is ridden out: a post-deploy /api blip, backend
// cold-start, or a page-load burst of many logos in flight. The monogram shows the
// whole time (never an empty/broken box), so these retries are invisible and the
// real logo upgrades IN PLACE the moment it resolves — even right after a deploy.
const RETRY_BACKOFF = [900, 1800, 3200, 6000, 10000, 16000, 24000]   // ~62s total

// Deterministic pleasant background from the symbol (stable across renders).
function bgFor(sym) {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return `hsl(${h} 32% 26%)`
}

export default function CompanyLogo({ sym, size = 38, round = false, tile = false, name = null, alt = null, brandMark = false }) {
  const s = (sym || '').toUpperCase()
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState(false)   // a REAL logo (naturalWidth > 2) has loaded
  const [prevSym, setPrevSym] = useState(s)
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  // New symbol → start the retry budget over + hide any prior logo. React's
  // sanctioned "reset state during render" pattern (avoids a stale monogram/logo
  // after a ticker swap without a keyed remount).
  if (s !== prevSym) {
    setPrevSym(s)
    setRetry(0)
    setLoaded(false)
  }

  const px = `${size}px`
  const rc = round ? ` ${styles.round}` : ''
  const tc = tile ? ` ${styles.tile}` : ''   // uniform rounded-square tile (contain + hairline)

  // UCT-branded pseudo-tickers (breadth symbols, theme indexes): render the compass
  // brand mark instead of a company logo / monogram — they have no company logo. (After
  // the hooks above so hook order is unconditional — rules-of-hooks.)
  if (brandMark) {
    return (
      <span className={`${styles.wrap}${rc}${tc}`} style={{ width: px, height: px, background: '#12141a' }} aria-label={`${s || 'UCT'} logo`}>
        {/* scale(1.35) fills the circle: the compass PNG carries transparent margin, so
            even at padding 0 it renders small — the transform enlarges the visible mark. */}
        <img className={styles.imgFill} style={{ opacity: 1, objectFit: 'contain', transform: 'scale(1.35)' }}
             src={brandMarkAsset} alt="UCT" loading="lazy" />
      </span>
    )
  }

  const scheduleRetry = (curRetry) => {
    if (curRetry >= RETRY_BACKOFF.length) return   // give up retrying; the monogram (always shown) remains
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setRetry(r => r + 1), RETRY_BACKOFF[curRetry])
  }
  // A cold logo returns a 1x1 transparent PNG (loads "successfully"), so onLoad must
  // check naturalWidth: a real logo reveals itself; a placeholder schedules a retry
  // (the first view kicked off a background resolve server-side). onError (a request
  // failure — deploy blip / cold start / dropped) retries the same way.
  const handleLoad = (e) => {
    if (e.currentTarget.naturalWidth > 2) {
      setLoaded(true)
      if (timerRef.current) clearTimeout(timerRef.current)
    } else {
      scheduleRetry(retry)
    }
  }
  const handleError = () => scheduleRetry(retry)

  // Optional resolution hints for non-US tickers (company name + exchange-suffixed
  // symbol) so the backend can fall back to name→domain / alt-symbol logo sources.
  const q = [`v=${LOGO_ASSET_VERSION}`]
  if (name) q.push(`name=${encodeURIComponent(name)}`)
  if (alt) q.push(`alt=${encodeURIComponent(alt)}`)
  if (retry) q.push(`_r=${retry}`)   // cache-bust the 60s placeholder so the retry re-hits the server
  const src = `/api/ticker-logo/${s}?${q.join('&')}`

  return (
    <span className={`${styles.wrap}${rc}${tc}`} style={{ width: px, height: px }} aria-label={`${s || '?'} logo`}>
      {/* Monogram base — ALWAYS present; the real logo fades over it when it loads. */}
      <span className={styles.base} style={{ background: bgFor(s), fontSize: size * 0.4, opacity: loaded ? 0 : 1 }}>
        {s.slice(0, 1) || '?'}
      </span>
      {s && (
        <img className={styles.imgFill} style={{ opacity: loaded ? 1 : 0 }} src={src}
             alt={`${s} logo`} loading="lazy" onError={handleError} onLoad={handleLoad} />
      )}
    </span>
  )
}
