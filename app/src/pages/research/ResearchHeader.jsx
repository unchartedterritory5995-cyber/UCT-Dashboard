import CompanyLogo from '../../components/CompanyLogo'
import SymbolSearch from '../../components/chart/SymbolSearch'
import RatingBadges from './RatingBadges'
import styles from './ResearchPage.module.css'

function pctClass(v) {
  if (v == null) return ''
  return v >= 0 ? styles.up : styles.down
}

export default function ResearchHeader({ sym, meta, live, onSymbolChange }) {
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
      <div className={styles.hdrRatings}>
        <RatingBadges ratings={null} />
      </div>
    </header>
  )
}
