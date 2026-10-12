// The price stamps block (P2a Task 10, spec §P2 item 4): one switch, one param. The stamping itself is
// the editor extension lib/blocks/priceStamps.js, which reads this block's `on` from the document.
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

export default function PriceStampsBlock({ params, setParams, editable }) {
  const on = params.on === 'yes'
  const switchOn = journalStylesEnabled()
  return (
    <div className={styles.empty}>
      <button type="button" role="switch" aria-checked={on} aria-label="Stamp prices as I write"
        className={`btn btn-ghost ${styles.tap}`} disabled={!editable || !switchOn}
        onClick={() => setParams({ on: on ? 'no' : 'yes' })}>
        {on ? 'Price stamps: on' : 'Price stamps: off'}
      </button>
      {switchOn
        ? <p className={styles.muted}>Write $NVDA and press Enter: the price is added below the line a moment later, and stays as it was. Outside market hours it is the last close, with its date.</p>
        : <BlockNeedsSwitch what="Journal styles" />}
    </div>
  )
}
