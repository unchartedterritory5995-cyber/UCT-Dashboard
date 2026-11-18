// SHINT and SHRTS: where the numbers come from and what they are not, in plain words. ONE block
// for both panels, always on screen with the numbers, so the two never drift apart: the source,
// that short interest is twice a month and about two weeks old when it comes out, and FINRA's own
// caution that daily short volume is not short interest and covers off-exchange trades only.
import { SOURCE } from './shortInterestModel'
import styles from './marketPanels.module.css'

export default function ShortDataNotes({ testId, children = null }) {
  return (
    <p className={styles.muted} data-testid={testId}>
      Source: {SOURCE}. Short interest is what brokers report to FINRA twice a month: the shares sold short and not yet
      bought back on the settlement date. FINRA publishes each report about two weeks after its settlement date, so the
      newest number is about two weeks old the day it comes out and up to a month old before the next one. Days to cover
      is short interest divided by the average daily volume, as the data vendor works it out. Daily short volume is not
      short interest (FINRA&apos;s own caution): it counts short sales in one day&apos;s off-exchange trades only, most of
      them by market makers who buy back the same day, so a high share of short volume does not mean a large short
      position. A sign (+/-) and a word mark every change; color is not used for it.{children}
    </p>
  )
}
