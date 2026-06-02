// app/src/pages/calendar/EarningsCard.jsx
import CompanyLogo from '../../components/CompanyLogo'
import { useTickerActions } from '../../components/TickerActions'
import TickerActionsMenu from '../../components/TickerActions'
import styles from './Calendar.module.css'

function fmtEps(v) { return v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}` }
function fmtRev(v) { if (v == null) return '—'; return v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${Math.round(v)}M` }
function surprise(a, e) { if (a == null || e == null || e === 0) return null
  const p = ((a - e) / Math.abs(e)) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%` }

export default function EarningsCard({ entry, timing, livePrice, reaction, onSelect }) {
  const reported = entry.eps_act != null
  const beats = (entry.beat_history || []).slice(0, 4).reverse()
  const beatCount = beats.filter(b => b.beat === true).length
  const em = entry.expected_move?.pct
  const px = livePrice != null ? `$${livePrice.toFixed(2)}` : '—'

  const { menu, openMenu, closeMenu } = useTickerActions()

  return (
    <>
      <div
        className={`${styles.card} ${entry.mine ? styles.cardMine : ''}`}
        onClick={() => onSelect(entry, timing)}
        onContextMenu={e => openMenu(e, entry.sym)}
      >
        {entry.mine && <span className={styles.star}>★</span>}
        <div className={styles.cardTop}>
          <CompanyLogo sym={entry.sym} size={38} />
          <div>
            <div className={styles.sym}>
              {entry.sym}
              <span className={`${styles.tpill} ${timing === 'bmo' ? styles.bmo : styles.amc}`}>
                {timing.toUpperCase()}
              </span>
              {reported && <span className={styles.beatPill}>{
                surprise(entry.eps_act, entry.eps_est)?.startsWith('-') ? 'MISS' : 'BEAT'}</span>}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
          </div>
        </div>

        {!reported ? (
          <>
            <div className={styles.met}><span className={styles.dim}>EPS est</span><span className={styles.mono}>{fmtEps(entry.eps_est)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Rev est</span><span className={styles.mono}>{fmtRev(entry.rev_est)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Price</span><span className={styles.mono}>{px}</span></div>
            {em != null && (
              <div className={styles.emv}><span className={styles.emvLbl}>Expected move</span><span className={styles.emvBig}>±{em}%</span></div>
            )}
            {beats.length > 0 && (
              <div className={styles.hist}>
                {beats.map((b, i) => (
                  <i key={i} className={b.beat ? styles.histPos : styles.histNeg}
                     style={{ height: `${40 + i * 12}%` }} />
                ))}
                <span className={styles.histLbl}>{beatCount}/{beats.length} beat</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles.met}><span className={styles.dim}>EPS</span>
              <span className={styles.mono}><span className={styles.dim}>{fmtEps(entry.eps_est)}→ </span>{fmtEps(entry.eps_act)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Surprise</span>
              <span className={styles.mono}>{surprise(entry.eps_act, entry.eps_est) ?? '—'}</span></div>
            <div className={styles.met}><span className={styles.dim}>Revenue</span>
              <span className={styles.mono}>{fmtRev(entry.rev_act)} <span className={styles.dim}>/ {fmtRev(entry.rev_est)}</span></span></div>
            {reaction != null && (
              <div className={styles.react}><span className={styles.dim}>Post-print gap</span>
                <span className={reaction >= 0 ? styles.pos : styles.neg}>
                  {reaction >= 0 ? '▲ +' : '▼ '}{reaction.toFixed(1)}%</span></div>
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
