// app/src/pages/calendar/EarningsCard.jsx
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { useTickerActions } from '../../components/TickerActions'
import TickerActionsMenu from '../../components/TickerActions'
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

// C6: Format hist_stats for display on card
function fmtHistStats(hs) {
  if (!hs) return null
  const { avg_abs_move, up_count, total, last_n } = hs
  if (avg_abs_move == null || total == null) return null
  // last_n is an ARRAY of recent moves — interpolating it directly rendered
  // "over 5.1,-2.3,…" garbage. The count is its length.
  const n = Array.isArray(last_n) ? (last_n.length || total) : (last_n ?? total)
  const upStr = up_count != null ? ` · up ${up_count}/${total}` : ''
  return `avg ±${avg_abs_move.toFixed(1)}% over ${n}${upStr}`
}

export default function EarningsCard({ entry, timing, livePrice, liveSnap, reaction, onSelect, pulsed }) {
  const reported = entry.eps_act != null
  const beats = (entry.beat_history || []).slice(0, 4).reverse()
  const beatCount = beats.filter(b => b.beat === true).length
  const em = entry.expected_move?.pct
  // Live SSE price first, day-metrics price as the fallback (covers past days
  // and names outside the live-prices universe). Null → the row is SUPPRESSED.
  const priceVal = livePrice ?? entry._price ?? null
  const px = priceVal != null ? `$${Number(priceVal).toFixed(2)}` : null
  // C6: hist_stats from enrichment
  const histStatsLabel = fmtHistStats(entry.hist_stats)

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
              {reported && <span className={styles.beatPill}>{
                surprise(entry.eps_act, entry.eps_est)?.startsWith('-') ? 'MISS' : 'BEAT'}</span>}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
          </div>
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
        </div>

        {!reported ? (
          <>
            {/* Null metrics render NOTHING — a wall of "—" rows is banned. */}
            {entry.eps_est != null && (
              <div className={styles.met}><span className={styles.dim}>EPS est</span><span className={styles.mono}>{fmtEps(entry.eps_est)}</span></div>
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

            {em != null && (
              <div className={styles.emv}
                   title={`The options market prices roughly a ±${em}% swing after this report`}>
                <span className={styles.emvLbl}>Expected move</span><span className={styles.emvBig}>±{em}%</span></div>
            )}
            {/* C6: Historical post-earnings reaction stats (pending cards too) */}
            {histStatsLabel && (
              <div className={styles.histStats}>
                <span className={styles.dim}>Hist reactions</span>
                <span className={styles.histStatsVal}>{histStatsLabel}</span>
              </div>
            )}
            {beats.length > 0 && (
              <div className={styles.beatNote}>Beat {beatCount} of last {beats.length} quarters</div>
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
            {/* C6: Historical post-earnings reaction stats */}
            {histStatsLabel && (
              <div className={styles.histStats}>
                <span className={styles.dim}>Hist reactions</span>
                <span className={styles.histStatsVal}>{histStatsLabel}</span>
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
