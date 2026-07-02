/**
 * RH-style Analyst Ratings — stacked Buy/Hold/Sell distribution bar +
 * price target, augmented with the UCT composite rating (spec: "augment
 * Analyst with UCT ratings").
 */
import { money, percent } from '../../../../lib/journal-2-0'
import styles from './PositionDetailPage.module.css'

export default function AnalystSection({ model, priceTarget, composite }) {
  if (!model && composite == null) return null
  const target = priceTarget?.consensus ?? priceTarget?.last_quarter?.avg ?? priceTarget?.median
  return (
    <section className={styles.section} aria-label="Analyst ratings">
      <h2 className={styles.sectionTitle}>Analyst Ratings</h2>
      {model && (
        <>
          <div className={styles.ratingSummary}>
            <span className={styles.ratingBig}>{percent(model.buyPct, { dp: 0 })}</span>
            <span className={styles.ratingOf}>
              of {model.total} analysts rate it Buy{model.label ? ` · consensus ${model.label}` : ''}
            </span>
          </div>
          <div className={styles.ratingBar} aria-hidden="true">
            <span className={styles.ratingBuy} style={{ width: `${model.buyPct * 100}%` }} />
            <span className={styles.ratingHold} style={{ width: `${model.holdPct * 100}%` }} />
            <span className={styles.ratingSell} style={{ width: `${model.sellPct * 100}%` }} />
          </div>
          <div className={styles.ratingLegend}>
            <span><i className={`${styles.dot} ${styles.dotBuy}`} /> Buy {percent(model.buyPct, { dp: 0 })}</span>
            <span><i className={`${styles.dot} ${styles.dotHold}`} /> Hold {percent(model.holdPct, { dp: 0 })}</span>
            <span><i className={`${styles.dot} ${styles.dotSell}`} /> Sell {percent(model.sellPct, { dp: 0 })}</span>
          </div>
        </>
      )}
      <div className={styles.ratingFoot}>
        {Number.isFinite(target) && (
          <span className={styles.ratingTarget}>Avg price target {money(target)}</span>
        )}
        {composite != null && (
          <span className={styles.uctChip}>UCT Rating {composite}</span>
        )}
      </div>
    </section>
  )
}
