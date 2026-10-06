import { useSectionsState } from './useDarkSection'
import styles from './optionsAnalytics.module.css'

// The terminal opens these options panels on their own (IVH, VOL, POS, OHIS, TIDE, STRS). Each
// section is a dark surface that renders NOTHING on 404 -- right when it is tucked under the chain
// or on the Options Flow page, wrong when it is the whole panel: the member got a titled box with
// an empty body. The terminal registry passes `offNotice`, and when EVERY section's route answered
// 404 this says so in words.
//
// ⛔ Only a 404 (switch off) counts. A 402, a 5xx or a dropped connection is not "switched off",
//    and each section already says those in its own words.
// ⛔ The better long-term fix is an auth-payload flag per surface so the terminal can know before
//    it opens the panel; that needs a backend change and is not invented here.
/** The line itself, for a panel that already holds its reads (VolStatsPanel). */
export function OffLine({ feature }) {
  return (
    <p className={styles.note} data-testid="feature-off">
      {feature} isn&apos;t switched on yet. That is a setting on our side, not an empty result.
    </p>
  )
}

export default function OffNotice({ urls, feature }) {
  const { allOff, allLoading, allPaywalled } = useSectionsState(urls)
  if (allOff) return <OffLine feature={feature} />
  if (allPaywalled) return <p className={styles.note} data-testid="feature-paywalled">{feature} requires a paid plan.</p>
  if (allLoading) return <p className={styles.note} data-testid="feature-loading">Loading {feature.toLowerCase()}…</p>
  return null
}
