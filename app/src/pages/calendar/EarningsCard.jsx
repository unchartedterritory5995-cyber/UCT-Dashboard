// app/src/pages/calendar/EarningsCard.jsx
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { useTickerActions } from '../../components/TickerActions'
import TickerActionsMenu from '../../components/TickerActions'
import { BeatDots, ReactionSpark, ExpectedMovePair, DateMovedChip } from './cardBits'
import { isReportingNow } from './calendarTime'
import styles from './Calendar.module.css'
// NOTE: FwdPeChip (useFundamentals per card) removed — firing ~60 requests on
// feed load is too expensive. If fwd-P/E is wanted on cards, batch it via the
// enrichment payload (/api/calendar/enrichment) instead.

function fmtEps(v) { return v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}` }
function fmtRev(v) { if (v == null) return '—'; return v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${Math.round(v)}M` }
function surprise(a, e) { if (a == null || e == null || e === 0) return null
  const p = ((a - e) / Math.abs(e)) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%` }

// A4: Format extended-hours change vs regular-session close
function fmtExtChange(extPrice, closePrice) {
  if (extPrice == null || closePrice == null || closePrice === 0) return null
  const pct = ((extPrice - closePrice) / Math.abs(closePrice)) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

// A5: Format countdown from now to a report time
function fmtCountdown(timeEt) {
  if (!timeEt) return null
  try {
    const reportDate = new Date(timeEt)
    const now = new Date()
    const diffMs = reportDate - now
    if (diffMs <= 0) return null
    const diffH = diffMs / (1000 * 60 * 60)
    const h = Math.floor(diffH)
    const m = Math.floor((diffH - h) * 60)
    // Format time in ET (display only — we just show the time string as-is)
    const timeStr = reportDate.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })
    if (h >= 1) {
      return `in ~${h}h · ${timeStr} ET`
    }
    return `in ~${m}m · ${timeStr} ET`
  } catch {
    return null
  }
}

export default function EarningsCard({ entry, timing, livePrice, liveSnap, reaction, onSelect, pulsed }) {
  const reported = entry.eps_act != null
  const em = entry.expected_move?.pct
  // Most recent reported quarter's actual (beat_history arrives newest-first)
  const priorEps = entry.beat_history?.[0]?.actual ?? null
  // Live SSE price first, day-metrics price as the fallback (covers past days
  // and names outside the live-prices universe). Null → the row is SUPPRESSED.
  const priceVal = livePrice ?? entry._price ?? null
  const px = priceVal != null ? `$${Number(priceVal).toFixed(2)}` : null

  // A4: Extended-hours price — only shown when regular session is closed
  const extPrice   = liveSnap?.ext_price ?? null
  const extSession = liveSnap?.ext_session ?? null
  const closePrice = liveSnap?.price ?? livePrice ?? null
  const extChange  = fmtExtChange(extPrice, closePrice)
  const showExt    = extPrice != null && extSession != null

  // A5: Countdown
  const countdown = fmtCountdown(entry.time_et)

  const { menu, openMenu, closeMenu, longPressProps } = useTickerActions()

  return (
    <>
      <div
        className={`${styles.card} ${entry.mine ? styles.cardMine : ''} ${pulsed ? styles.cardPulse : ''}`}
        onClick={() => onSelect?.(entry, timing)}
        {...longPressProps(entry.sym)}
      >
        {entry.mine && <span className={styles.star}><UIcon name="star-fill" size={13} /></span>}
        <div className={styles.cardTop}>
          <CompanyLogo sym={entry.sym} size={28} tile />
          <div className={styles.cardHead}>
            <div className={styles.sym}>
              {entry.sym}
              {/* Only render a verdict when a surprise is COMPUTABLE — a
                  no-estimate report has no BEAT/MISS basis. Negatives use the
                  red miss pill (was always the green beat pill). */}
              {reported && surprise(entry.eps_act, entry.eps_est) && (
                <span className={surprise(entry.eps_act, entry.eps_est).startsWith('-') ? styles.missPill : styles.beatPill}>
                  {surprise(entry.eps_act, entry.eps_est).startsWith('-') ? 'MISS' : 'BEAT'}
                </span>
              )}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
            <DateMovedChip moved={entry.date_moved} />
          </div>
          {isReportingNow(entry) ? (
            <span className={styles.reportingChip} title="In its reporting window now — results expected shortly">
              REPORTING
            </span>
          ) : (
            <span
              className={`${styles.session} ${
                timing === 'bmo' ? styles.sessionBmo
                : timing === 'amc' ? styles.sessionAmc
                : styles.sessionTbd}`}
              title={timing === 'bmo' ? 'Before market open'
                   : timing === 'amc' ? 'After market close'
                   : 'Report session not yet confirmed'}
            >
              {timing === 'tbd' ? 'TBD' : (timing || '').toUpperCase()}
              {entry.date_est && <span className={styles.dateEst}> · est.</span>}
            </span>
          )}
        </div>

        {!reported ? (
          <>
            {/* Null metrics render NOTHING — a wall of "—" rows is banned.
                An estimate means little without the bar it must clear: the
                most recent actual rides beside it when history exists. */}
            {entry.eps_est != null && (
              <div className={styles.met}><span className={styles.dim}>EPS est</span>
                <span className={styles.mono}>{fmtEps(entry.eps_est)}
                  {priorEps != null && <span className={styles.dim}> · last {fmtEps(priorEps)}</span>}
                </span></div>
            )}
            {entry.rev_est != null && (
              <div className={styles.met}><span className={styles.dim}>Rev est</span><span className={styles.mono}>{fmtRev(entry.rev_est)}</span></div>
            )}
            {px != null && (
              <div className={styles.met}><span className={styles.dim}>Price</span><span className={styles.mono}>{px}</span></div>
            )}

            {/* A4: Extended-hours price line */}
            {showExt && (
              <div className={styles.extRow}>
                <span className={styles.extLbl}>EXT</span>
                <span className={styles.mono}>${extPrice.toFixed(2)}</span>
                {extChange && (
                  <span className={extChange.startsWith('+') ? styles.pos : styles.neg}>
                    ({extChange})
                  </span>
                )}
              </div>
            )}

            {/* A5: Countdown (timing now lives in the de-pilled top-right label) */}
            {countdown && <div className={styles.countdown}><UIcon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{countdown}</div>}

            {/* Implied vs realized — the pair no competitor puts on entries */}
            <ExpectedMovePair em={em} typical={entry.hist_stats?.avg_abs_move} />
            {/* Dot strip + reaction sparkline replace the text lines: same
                data at 10× scan speed (counts live in the tooltips/labels) */}
            {(entry.beat_history?.length > 0 || entry.hist_stats?.last_n?.length > 1) && (
              <div className={styles.cardMetaRow}>
                <BeatDots history={entry.beat_history} />
                <ReactionSpark lastN={entry.hist_stats?.last_n} />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Reported grammar: the estimate arrow renders only when the
                estimate exists; null surprise/revenue rows render NOTHING. */}
            <div className={styles.met}><span className={styles.dim}>EPS</span>
              <span className={styles.mono}>
                {entry.eps_est != null && <span className={styles.dim}>{fmtEps(entry.eps_est)}→ </span>}
                {fmtEps(entry.eps_act)}</span></div>
            {surprise(entry.eps_act, entry.eps_est) != null && (
              <div className={styles.met}><span className={styles.dim}>Surprise</span>
                <span className={styles.mono}>{surprise(entry.eps_act, entry.eps_est)}</span></div>
            )}
            {entry.rev_act != null && (
              <div className={styles.met}><span className={styles.dim}>Revenue</span>
                <span className={styles.mono}>{fmtRev(entry.rev_act)}{entry.rev_est != null && <span className={styles.dim}> / {fmtRev(entry.rev_est)}</span>}</span></div>
            )}
            {reaction != null && (
              <div className={styles.react}><span className={styles.dim}>Post-print gap</span>
                <span className={reaction >= 0 ? styles.pos : styles.neg}>
                  {reaction >= 0 ? '▲ +' : '▼ '}{reaction.toFixed(1)}%</span></div>
            )}
            {(entry.beat_history?.length > 0 || entry.hist_stats?.last_n?.length > 1) && (
              <div className={styles.cardMetaRow}>
                <BeatDots history={entry.beat_history} />
                <ReactionSpark lastN={entry.hist_stats?.last_n} />
              </div>
            )}
            {/* A4: EXT price also shown on reported cards during ext hours */}
            {showExt && (
              <div className={styles.extRow}>
                <span className={styles.extLbl}>EXT</span>
                <span className={styles.mono}>${extPrice.toFixed(2)}</span>
                {extChange && (
                  <span className={extChange.startsWith('+') ? styles.pos : styles.neg}>
                    ({extChange})
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {menu && (
        <TickerActionsMenu menu={menu} onClose={closeMenu} />
      )}
    </>
  )
}
