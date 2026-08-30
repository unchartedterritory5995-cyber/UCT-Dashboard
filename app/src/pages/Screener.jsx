import { useState } from 'react'
import ScannerShell from './screener/shell/ScannerShell'
import ErrorBoundary from '../components/ErrorBoundary'
import UIcon from '../components/ui/UIcon'
import styles from './Screener.module.css'

// ── ScannerShell error fallback — defense-in-depth (the stress-sweep's
// blank-root finding traced to the SPA's static asset delivery, not a React
// escape — see project_screener_deep_work_2026_08_21.md — but a render throw
// INSIDE ScannerShell is still possible and had no boundary of its own
// before this).
// `onRetry` bumps a key one level up, remounting both this boundary and the
// shell fresh — mirrors the `key={openSeq}` idiom in Calendar.jsx/CatalystFlow.jsx. ─
function ScannerShellErrorFallback({ onRetry }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '320px',
      padding: '24px',
      textAlign: 'center',
      color: 'var(--text-muted)',
      fontSize: '13px',
      gap: '12px',
    }}>
      <p style={{ margin: 0 }}>Screener hit an error.</p>
      <button
        onClick={onRetry}
        style={{
          background: 'var(--ut-gold, #c9a84c)',
          color: '#0e0f0d',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          letterSpacing: '0.3px',
        }}
      >
        Retry
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
//
// ⛔ THIS PAGE IS THE SCANNER NOW — there is no tab strip, because there is
// nothing to switch between. The Candidate Board (the 7 AM pre-market setup
// scan) and Live Scan retired 2026-08-29; the owner writes screens in
// ScannerShell instead. See project_live_scan_retirement_2026_08_29.
//
// ⛔⛔ THE 7 AM SCAN ITSELF IS UNTOUCHED AND MUST STAY THAT WAY. `candidates.json`
// still feeds the morning wire's top-picks pool (Source 1), `build_prompt`'s
// SCREENED CANDIDATES block, `voice_market_tools.get_scanner_candidates`, and
// bar warming. This page stopping its `/api/candidates` fetch is the ONLY thing
// that changed — do not read the absence of a UI here as the feed being dead.
//
// ⚠️ AND THAT FETCH WAS LOAD-BEARING IN ONE PLACE, WHICH IS WHY THIS COMMIT ALSO
// TOUCHES THE WARMERS: `/api/candidates` fired `warm_bars_async` as a side
// effect, and it was the ONLY candidate warming that actually worked —
// `bars_prewarm` and `bars_seeder` both read the envelope as if it were the
// buckets and warmed zero. They were pointed at `engine.candidate_rows()` in
// the same change, so removing this page LOSES no warming.
export default function Screener({ embedded = false }) {
  const [shellKey, setShellKey] = useState(0)

  const containerCls = `${styles.containerFull} ${embedded ? styles.pageEmbedded : ''}`.trim()

  return (
    <div className={containerCls}>
      <div className={styles.headerFull}>
        {!embedded && (
          <h1 className={styles.heading}>
            <UIcon name="screener" size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Screener
          </h1>
        )}
      </div>

      <ErrorBoundary
        key={shellKey}
        fallback={<ScannerShellErrorFallback onRetry={() => setShellKey(k => k + 1)} />}
      >
        <ScannerShell embedded={embedded} />
      </ErrorBoundary>
    </div>
  )
}
