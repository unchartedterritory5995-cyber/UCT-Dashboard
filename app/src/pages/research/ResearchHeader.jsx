import { useNavigate } from 'react-router-dom'
import CompanyLogo from '../../components/CompanyLogo'
import SymbolSearch from '../../components/chart/SymbolSearch'
import RsBadge from '../../components/RsBadge'
import RatingBadges from './RatingBadges'
import styles from './ResearchPage.module.css'

function pctClass(v) {
  if (v == null) return ''
  return v >= 0 ? styles.up : styles.down
}

export default function ResearchHeader({ sym, meta, live, ratings, onSymbolChange }) {
  const navigate = useNavigate()
  // Entry point for Cross-Security Comparison V1 (owner authorization). Reuses
  // the same canonical security search this header already uses for its own
  // symbol switch -- no second ticker-search implementation (B2). The picker
  // itself carries no symbol (sym=null) so it never shows a stale/misleading
  // ticker of its own; selecting a comparator navigates straight to the
  // canonical compare route, never mutating state in this header.
  const goToCompare = (comparator) => {
    if (comparator && sym) navigate(`/research/${sym}/compare/${comparator.toUpperCase()}`)
  }
  const change = live?.change_pct
  return (
    <header className={styles.hdr}>
      <CompanyLogo sym={sym} size={52} />
      <div className={styles.hdrId}>
        <div className={styles.hdrName}>
          {sym}
          <span className={styles.hdrCo}> · {meta?.name || ''}</span>
        </div>
        <div className={styles.hdrSub}>
          {[meta?.exchange, meta?.sector, meta?.industry].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className={styles.hdrRs}>
        <RsBadge sym={sym} />
      </div>
      <div className={styles.hdrPx}>
        {live?.price != null && (
          <div className={styles.hdrPxBig}>
            ${Number(live.price).toFixed(2)}{' '}
            {change != null && (
              <span className={pctClass(change)}>
                {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <div className={styles.hdrSearch}>
          <SymbolSearch sym={sym} onSymbolChange={onSymbolChange} />
        </div>
      </div>
      <div className={styles.hdrCompare} data-testid="research-compare-entry">
        <SymbolSearch sym={null} displayLabel="+ Compare" onSymbolChange={goToCompare} />
      </div>
      <div className={styles.hdrRatings}>
        <RatingBadges ratings={ratings} />
      </div>
    </header>
  )
}
