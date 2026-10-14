import { Suspense, useContext, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import lazy from '../utils/lazyWithRetry'
import { SkeletonTable } from '../components/Skeleton'
import ErrorBoundary from '../components/ErrorBoundary'
import UIcon from '../components/ui/UIcon'
import { useInTerminalPanel } from '../components/terminal'
import styles from './Screener.module.css'
import { AuthContext } from '../context/AuthContext'
import OptionsScreener from './screener/options/OptionsScreener'
import HowToChecklist from '../components/howTo/HowToChecklist'
import { useIsPhone } from '../hooks/useBreakpoint'

// Each mode is its own chunk: a member downloads only the layout they render (the Focus layout
// is owner-only behind a flag, so most members never need its code, and vice versa).
const ScannerShell = lazy(() => import('./screener/shell/ScannerShell'))
const FocusScreener = lazy(() => import('./screener/focus/FocusScreener'))

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
          background: 'var(--ut-gold)',
          color: 'var(--bg)',
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
//
// ⭐ COV-02/03 — THE ONE EXCEPTION TO "NO TAB STRIP": while `options_screener_enabled` rides
// the auth payload, the full page grows a two-button strip, Stocks | Options. Flag absent (the
// default), the page renders the same DOM as before (rail: OptionsScreener.test.jsx). `useContext` rather than `useAuth`
// so the page still renders outside an AuthProvider (its own tests, embedded widgets).
// The embedded (Charts widget) mode never shows the strip.
export default function Screener({ embedded = false }) {
  const [shellKey, setShellKey] = useState(0)
  // The terminal's SCR panel header already names the screener; its page title steps aside.
  const inPanel = useInTerminalPanel()
  const optionsOn = useContext(AuthContext)?.optionsScreenerEnabled === true && !embedded
  // UCT Terminal's OSCR "Full page" link deep-links here with `?tab=options` (functions.js)
  // so the member lands on the tab they asked for rather than always Stocks. Read once, at
  // mount, as the initial tab — the in-page strip still owns the tab after that (never
  // re-synced from the URL on every render, which would fight the strip's own clicks).
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(() => (searchParams.get('tab') === 'options' ? 'options' : 'stocks'))
  const showOptions = optionsOn && mode === 'options'
  // Owner-only Focus layout (SCREENER_FOCUS_LAYOUT_ENABLED). Never in an embedded widget or a terminal panel.
  // Phones (<=640) keep the current ResultCards page: the Focus layout is tablet and up.
  const isPhone = useIsPhone()
  const focusOn = useContext(AuthContext)?.screenerFocusLayoutEnabled === true && !embedded && !inPanel && !isPhone

  const containerCls = `${styles.containerFull} ${embedded ? styles.pageEmbedded : ''}`.trim()
  const showHeading = !embedded && !inPanel && !focusOn
  // The Focus layout drops the header when it would hold nothing (no Options tab): an empty 60px
  // strip above its top bar. Everywhere else (old page, embedded widget, terminal panel) the header
  // renders exactly as before, even when empty: its min-height is part of those layouts.
  const showHeader = focusOn ? optionsOn : true

  return (
    <div className={containerCls}>
      {showHeader && <div className={styles.headerFull}>
        {showHeading && (
          <h1 className={styles.heading}>
            <UIcon name="screener" size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Screener
          </h1>
        )}
        {optionsOn && (
          <div role="tablist" aria-label="Screener mode" style={{ display: 'flex', gap: 6 }}>
            {[['stocks', 'Stocks'], ['options', 'Options']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                style={{
                  minHeight: 'var(--tap-min)', padding: '4px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  background: 'var(--bg-surface)', color: 'var(--text)',
                  border: `1px solid ${mode === k ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
                  fontWeight: mode === k ? 600 : 400,
                }}>{label}</button>
            ))}
          </div>
        )}
      </div>}

      {/* FT-046: renders nothing unless HOW_TO_CHECKLISTS_ENABLED is on AND the owner
          approved this surface's copy (components/howTo). Full page only. The Focus layout
          carries the Stocks checklist under its ? menu ("How to use this screen"), so the
          bar steps aside there; the Options tab keeps it. */}
      {!embedded && !(focusOn && !showOptions) && (
        <HowToChecklist surface={showOptions ? 'screener.options' : 'screener.stocks'} />
      )}

      {showOptions && <OptionsScreener />}

      {!showOptions && (
        <ErrorBoundary
          key={shellKey}
          fallback={<ScannerShellErrorFallback onRetry={() => setShellKey(k => k + 1)} />}
        >
          <Suspense fallback={<SkeletonTable rows={12} cols={6} />}>
            {focusOn ? <FocusScreener /> : <ScannerShell embedded={embedded} />}
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
