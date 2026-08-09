// app/src/pages/calendar/MainEventCard.jsx
// Exactly ONE per day (when the day clears the week's importance bar):
// the curated lead. Front-page comprehension in one fixation, zero LLM —
// the editorial line is composed from fields already on the entry.
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { useTickerActions } from '../../components/TickerActions'
import TickerActionsMenu from '../../components/TickerActions'
import { editorialLine } from './importance'
import { isReportingNow } from './calendarTime'
import { BeatDots, ReactionSpark, ExpectedMovePair, DateMovedChip } from './cardBits'
import styles from './Calendar.module.css'

function fmtEps(v) { return v == null ? null : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}` }
function fmtRev(v) { if (v == null) return null; return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M` }
function fmtCap(v) { if (v == null || v <= 0) return null; return v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : v >= 1 ? `$${Math.round(v)}B` : `$${Math.round(v * 1000)}M` }

function surprisePct(a, e) {
  if (a == null || e == null || e === 0) return null
  const p = ((a - e) / Math.abs(e)) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}

export default function MainEventCard({ entry, timing, livePrice, reaction, hasKeyMacro, onSelect, pulsed }) {
  const { menu, openMenu, closeMenu, longPressProps } = useTickerActions()
  const reported = entry.eps_act != null
  const em = entry.expected_move?.pct
  const typical = entry.hist_stats?.avg_abs_move
  const lede = editorialLine(entry, true)
  const surp = surprisePct(entry.eps_act, entry.eps_est)

  const sessionLbl = timing === 'bmo' ? 'BMO' : timing === 'amc' ? 'AMC' : 'TBD'
  const sessionCls = timing === 'bmo' ? styles.sessionBmo : timing === 'amc' ? styles.sessionAmc : styles.sessionTbd

  // Metric line: null parts render nothing — never a dash.
  const metricBits = []
  if (reported) {
    if (entry.eps_act != null) {
      metricBits.push(`EPS ${entry.eps_est != null ? `${fmtEps(entry.eps_est)} est → ` : ''}${fmtEps(entry.eps_act)}`)
    }
    if (entry.rev_act != null) {
      metricBits.push(`Rev ${fmtRev(entry.rev_act)}${entry.rev_est != null ? ` vs ${fmtRev(entry.rev_est)} est` : ''}`)
    }
  } else {
    if (entry.eps_est != null) metricBits.push(`EPS ${fmtEps(entry.eps_est)} est`)
    if (entry.rev_est != null) metricBits.push(`Rev ${fmtRev(entry.rev_est)} est`)
    if (livePrice != null) metricBits.push(`$${Number(livePrice).toFixed(2)}`)
  }

  return (
    <>
      <div
        className={`${styles.card} ${styles.cardMainEvent} ${entry.mine ? styles.cardMine : ''} ${pulsed ? styles.cardPulse : ''}`}
        onClick={() => onSelect?.(entry, timing)}
        {...longPressProps(entry.sym)}
      >
        <div className={styles.mainEyebrow}>
          MAIN EVENT
          {hasKeyMacro && <span className={styles.macroCollide} title="A high-impact economic release shares this date">MACRO DAY</span>}
        </div>
        <div className={styles.cardTop}>
          <CompanyLogo sym={entry.sym} size={40} tile />
          <div className={styles.cardHead}>
            <div className={`${styles.sym} ${styles.symMain}`}>
              {entry.sym}
              {entry.mine && <UIcon name="star-fill" size={13} />}
              {/* BEAT/MISS only when a surprise is actually COMPUTABLE — a
                  reported name with no estimate (or a $0 estimate) has no
                  basis for either verdict; branding it 'BEAT' is misinformation
                  on the flagship card. Mirrors the Surprise-row guard below. */}
              {reported && surp && (
                <span className={surp.startsWith('-') ? styles.missPill : styles.beatPill}>
                  {surp.startsWith('-') ? 'MISS' : 'BEAT'}
                </span>
              )}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
            <DateMovedChip moved={entry.date_moved} />
          </div>
          <span className={styles.mainRight}>
            {isReportingNow(entry) ? (
              <span className={styles.reportingChip} title="In its reporting window now — results expected shortly">
                REPORTING
              </span>
            ) : (
              <span className={`${styles.session} ${sessionCls}`}
                    title={timing === 'bmo' ? 'Before market open' : timing === 'amc' ? 'After market close' : 'Report session not yet confirmed'}>
                {sessionLbl}
              </span>
            )}
            {fmtCap(entry.mc_b) && <span className={styles.capBadge}>{fmtCap(entry.mc_b)}</span>}
          </span>
        </div>

        {lede && <div className={styles.mainLede}>{lede}</div>}

        {metricBits.length > 0 && (
          <div className={styles.mainMetrics}>{metricBits.join('  ·  ')}</div>
        )}

        {reported && surp && (
          <div className={styles.met}><span className={styles.dim}>Surprise</span>
            <span className={surp.startsWith('-') ? styles.neg : styles.pos}>{surp}</span></div>
        )}
        {reported && reaction != null && (
          <div className={styles.react}><span className={styles.dim}>Post-print gap</span>
            <span className={reaction >= 0 ? styles.pos : styles.neg}>
              {reaction >= 0 ? '▲ +' : '▼ '}{reaction.toFixed(1)}%</span></div>
        )}

        {!reported && <ExpectedMovePair em={em} typical={typical} big
                                        outcome={entry.expected_move_outcome} />}

        {(entry.beat_history?.length > 0 || entry.hist_stats?.last_n?.length > 1) && (
          <div className={styles.mainMetaRow}>
            <BeatDots history={entry.beat_history} />
            <ReactionSpark lastN={entry.hist_stats?.last_n} />
          </div>
        )}
      </div>
      {menu && <TickerActionsMenu menu={menu} onClose={closeMenu} />}
    </>
  )
}
