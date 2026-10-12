// The price stamps block (P2a Task 10, spec §P2 item 4): one switch, one param. While it is mounted,
// switched on, editable and the journal styles switch is on (S24), it holds the editor's price-stamp
// plugin (lib/blocks/priceStamps.js); unmounting, switching off or removing the block lets it go, and
// the plugin is unregistered when no stamps block holds it (fix round 1, review I-2 option E).
// ⛔ Registering a plugin is reconfigure + updateState: no transaction and no React state, so the
// effect cannot loop (H14); PriceStampsBlock.test.jsx counts the renders.
import { useEffect } from 'react'
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { attachPriceStamps } from '../../../lib/blocks/priceStamps'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

export default function PriceStampsBlock({ params, setParams, editable, editor }) {
  const on = params.on === 'yes'
  const switchOn = journalStylesEnabled()
  useEffect(() => (on && switchOn && editable && editor && !editor.isDestroyed ? attachPriceStamps(editor) : undefined),
    [editor, on, switchOn, editable])
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
