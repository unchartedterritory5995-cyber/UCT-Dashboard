// GRADE — Compass's buy / hold / skip verdict for one security, in the terminal.
//
// ⛔ NOT A NEW ANALYSIS. The server route (`/api/terminal/grade/:sym`, api/routers/terminal_grade.py)
// is a thin read over `grade_ticker` — the SAME deterministic GO/HOLD/SKIP orchestrator Compass
// voice and chat call. This panel only words what it returns: verdict, regime, setup, grade,
// entry, stop, size, first target, basis, hard flags and sources.
//
// ⛔ NEVER A FAKE VERDICT. While Compass grading is off on the server (BRAIN_TOOLS_ENABLED, or the
// Brain Pack not installed) the route answers `available: false` and this panel says
// "Grade not available yet." — it never draws a verdict it was not handed.
import { useEffect, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelSkeleton, PanelState, usePanelFreshness } from '../../../components/terminal'
import { formatCurrency, formatDateTimeEt, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import styles from '../TerminalShell.module.css'

/** What each verdict means, in plain words (the word itself is always shown — never colour alone). */
export const VERDICT_TEXT = {
  GO: 'Buy setup: every check passed.',
  HOLD: 'Wait: the setup is there but something argues against acting now.',
  SKIP: 'Pass: this is not a trade right now.',
}

/** Hard flags in plain English. An unknown flag is shown as-is rather than dropped. */
export const FLAG_TEXT = {
  no_setup: 'No clean, tradable setup was found',
  regime_red: 'The market regime is RED (hostile)',
  grade_below_b: 'The setup grades below B',
  risk_over_cap: 'Account risk would exceed the 2% cap',
  size_skip: 'The sizing table says do not size this',
  size_unavailable: 'The trade could not be sized',
  extended: 'Price is already more than 3% past the entry',
  quote_unavailable: 'No live price, so extension could not be checked',
}

export function flagText(f) { return FLAG_TEXT[f] || String(f) }

const VERDICT_INK = { GO: 'var(--success-ink)', SKIP: 'var(--danger-ink)' }

export default function GradePanel({ sym }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!sym) return undefined
    let live = true
    setState({ phase: 'loading', data: null, error: null })
    jsonFetcher(`/api/terminal/grade/${encodeURIComponent(sym)}`)
      .then((data) => { if (live) setState({ phase: 'ready', data, error: null }) })
      .catch((err) => { if (live) setState({ phase: 'error', data: null, error: err }) })
    return () => { live = false }
  }, [sym, attempt])

  const d = state.data || {}
  const graded = state.phase === 'ready' && d.available === true && d.ok === true && d.verdict
  // The server stamps when the verdict was computed (cached up to a minute); that instant is the
  // honest "as of". Nothing is reported until a verdict has actually landed.
  usePanelFreshness(graded && Number.isFinite(Number(d.as_of))
    ? { source: 'Compass grade_ticker', observedAt: new Date(Number(d.as_of) * 1000).toISOString() }
    : null)

  const retry = <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>

  if (!sym) {
    return (
      <PanelState kind="input" title="GRADE needs a ticker.">
        Type one first, e.g. <kbd>NVDA GRADE</kbd>
      </PanelState>
    )
  }
  if (state.phase === 'loading') return <PanelSkeleton label={`Grading ${sym}`} testId="terminal-grade-loading" />
  if (state.phase === 'error') {
    const status = state.error?.status
    if (status === 404) return <PanelState kind="locked" role="status" title="GRADE isn't switched on yet." testId="terminal-grade-error" />
    if (status === 402) return <PanelState kind="locked" role="status" title="GRADE is part of the paid plan." testId="terminal-grade-error" />
    if (status === 400) return <PanelState kind="input" title={`${sym} is not a ticker GRADE can read.`} testId="terminal-grade-error" />
    return (
      <PanelState kind="error" title={`Could not grade ${sym} just now.`} testId="terminal-grade-error" action={retry}>
        Run {sym} GRADE again, or retry here.
      </PanelState>
    )
  }
  if (d.available !== true) {
    return (
      <PanelState kind="locked" role="status" title="Grade not available yet." testId="terminal-grade-unavailable">
        {d.reason || 'Compass grading is not switched on for this server yet.'} No verdict is shown until it is.
      </PanelState>
    )
  }
  if (d.ok !== true || !d.verdict) {
    return (
      <PanelState kind="empty" role="status" title="Grade not available yet." testId="terminal-grade-unavailable" action={retry}>
        {d.reason ? `${d.reason}. ` : ''}No verdict was computed, so none is shown.
      </PanelState>
    )
  }

  const flags = Array.isArray(d.hard_flags) ? d.hard_flags : []
  const sources = Array.isArray(d.sources) ? d.sources : []
  const asOf = formatDateTimeEt(Number(d.as_of))
  const rows = [
    ['Regime', d.regime ? `${d.regime}${d.regime_note ? ` · ${d.regime_note}` : ''}` : null],
    ['Setup', d.setup],
    ['Grade', d.grade],
    ['Entry', d.entry != null ? formatCurrency(Number(d.entry)) : null],
    ['Stop', d.stop != null ? `${formatCurrency(Number(d.stop))}${d.stop_pct != null ? ` (${formatPercent(Number(d.stop_pct), { decimals: 1 })} below entry)` : ''}` : null],
    ['Size', d.size_pct != null ? `${formatPercent(Number(d.size_pct), { decimals: 1 })} of the account` : null],
    ['Account risk', d.account_risk_pct != null ? formatPercent(Number(d.account_risk_pct), { decimals: 1 }) : null],
    ['First target', d.first_target != null ? formatCurrency(Number(d.first_target)) : null],
  ]
  return (
    <div className={styles.help} data-testid="terminal-grade">
      <p className={styles.helpSyntax} data-testid="terminal-grade-verdict">
        <strong>{sym}</strong>{' '}
        <strong style={{ color: VERDICT_INK[d.verdict] }}>{d.verdict}</strong>
        {': '}{VERDICT_TEXT[d.verdict] || ''}
      </p>
      <dl className={styles.helpRule} data-testid="terminal-grade-fields">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className={styles.helpScope} style={{ display: 'inline' }}>{label}: </dt>
            <dd style={{ display: 'inline', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value ?? 'none'}</dd>
          </div>
        ))}
      </dl>
      {d.basis && <p className={styles.helpRule} data-testid="terminal-grade-basis">{d.basis}</p>}

      <h3 className={styles.helpGroup}>Hard flags</h3>
      {flags.length === 0
        ? <p className={styles.helpRule} data-testid="terminal-grade-no-flags">None raised.</p>
        : (
          <ul className={styles.helpRule} data-testid="terminal-grade-flags">
            {flags.map((f) => <li key={f}>{flagText(f)}</li>)}
          </ul>
        )}

      <h3 className={styles.helpGroup}>Sources</h3>
      <ul className={styles.helpRule} data-testid="terminal-grade-sources">
        {sources.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <p className={styles.helpScope} data-testid="terminal-grade-footnote">
        The same computed verdict Compass gives{asOf ? `, as of ${asOf}` : ''}. A rules-based read, not advice.
      </p>
    </div>
  )
}
