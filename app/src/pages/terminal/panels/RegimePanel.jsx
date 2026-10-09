// REGM: the market regime call and what it means for exposure (wave 7, lane C).
//
// ⭐ ONE AUTHORITY, READ TWICE. `GET /api/regime` is the live classifier (api/services/
// voice_regime_classifier.py, the one Compass's grade and sizing read); `GET /api/regime/vocabulary`
// is its published vocabulary, which carries each regime's sizing band. The band is READ from the
// vocabulary, never mapped here, so this panel cannot disagree with the verdicts GRADE gives.
// The guidance per band words grade_ticker's own gate: RED skips every buy, ORANGE holds them,
// YELLOW holds a B-grade setup, GREEN lets a clean setup go.
//
// ⛔ NEVER A GUESSED REGIME. When the classifier could not answer it returns its declared sentinel
// (`unknown`, with `error`); the panel says the call is not available and shows no band.
import { useMemo } from 'react'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureText, useMarketRead } from './marketRead'
import styles from './marketPanels.module.css'

export const REGIME_URL = '/api/regime'
export const VOCAB_URL = '/api/regime/vocabulary'
const POLL_MS = 5 * 60 * 1000

/** What each sizing band means for a new buy, in plain words (grade_ticker's verdict gate). */
export const BAND_GUIDANCE = {
  GREEN: 'Clean setups can be bought at normal size.',
  YELLOW: 'Be selective. Only A-grade setups are buys; a B-grade setup is a hold.',
  ORANGE: 'Hold off on new buys. Watch and wait for the tape to improve.',
  RED: 'No new buys. Every buy verdict is a skip until the regime turns.',
}
const BAND_TONE = { GREEN: 'badge_up', RED: 'badge_down' }

/** Pure: the regime's band from the published vocabulary, or null when it is not in it. */
export function bandFor(vocab, regimeId) {
  const hit = (Array.isArray(vocab?.regimes) ? vocab.regimes : []).find((r) => r && r.id === regimeId)
  return hit?.band || null
}

/** Pure: whether the classifier answered (a real regime, not its "could not answer" sentinel). */
export function regimeKnown(body, vocab) {
  if (!body || body.error) return false
  const unknownId = vocab?.unknown?.id || 'unknown'
  return Boolean(body.regime) && body.regime !== unknownId
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export default function RegimePanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(REGIME_URL, { refreshInterval: POLL_MS })
  const vocab = useMarketRead(VOCAB_URL)
  const body = read.body
  const known = regimeKnown(body, vocab.body)
  const band = known ? bandFor(vocab.body, body.regime) : null
  usePanelFreshness(known ? { source: 'UCT regime classifier (breadth and VIX)' } : null)

  const s = body?.signals || {}
  const fields = useMemo(() => [
    ['Confidence', num(body?.confidence) != null ? formatPercent(num(body.confidence) * 100, { decimals: 0 }) : null],
    ['UCT exposure rating', num(s.uct_exposure_rating) != null ? `${formatNumber(num(s.uct_exposure_rating), { decimals: 0 })} of 150` : null],
    ['Above 50-day', num(s.pct_above_50ma) != null ? formatPercent(num(s.pct_above_50ma), { decimals: 0 }) : null],
    ['Above 200-day', num(s.pct_above_200ma) != null ? formatPercent(num(s.pct_above_200ma), { decimals: 0 }) : null],
    ['New highs / lows', num(s.new_highs) != null || num(s.new_lows) != null
      ? `${formatNumber(num(s.new_highs), { decimals: 0 })} / ${formatNumber(num(s.new_lows), { decimals: 0 })}` : null],
    ['Distribution days', num(s.distribution_days) != null ? formatNumber(num(s.distribution_days), { decimals: 0 }) : null],
    ['VIX', num(s.vix) != null ? formatNumber(num(s.vix), { decimals: 2 }) : null],
    ['Market phase', s.market_phase || null],
  ], [body, s])

  if (read.loading) return <PanelSkeleton label="Reading the market regime" testId="terminal-regime-loading" />
  if (read.error && !body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'The regime call')} testId="terminal-regime-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'Retry, or run REGM again.'}
      </PanelState>
    )
  }
  if (!known) {
    return (
      <PanelState kind="empty" role="status" title="The regime call is not available right now." testId="terminal-regime-unknown"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        The classifier could not read its inputs, so no regime or band is shown.
      </PanelState>
    )
  }

  const reasons = Array.isArray(body.reasons) ? body.reasons : []
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-regime" data-regime={body.regime}>
      <p className={styles.callLine} data-testid="terminal-regime-call">
        <strong>{body.label || body.regime}</strong>
        {band ? <span className={`${styles.badge} ${styles[BAND_TONE[band] || 'badge_flat']}`} data-testid="terminal-regime-band">{band} band</span> : null}
      </p>
      <p className={styles.lede} data-testid="terminal-regime-guidance">
        {band ? BAND_GUIDANCE[band] || `Sizing band ${band}.` : 'The sizing band could not be read, so no exposure guidance is shown.'}
      </p>
      <dl className={styles.fields} data-testid="terminal-regime-fields">
        {fields.filter(([, v]) => v != null).map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <>
          <h3 className={styles.lede}>Why</h3>
          <ul className={styles.reasons} data-testid="terminal-regime-reasons">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </>
      )}
      <p className={styles.muted} data-testid="terminal-regime-asof">
        {read.receivedAt ? `Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}. ` : ''}
        The server recomputes the call at most every 15 minutes from breadth and VIX. The same call gates every GRADE verdict.
        A rules-based read, not advice.
      </p>
    </div>
  )
}
