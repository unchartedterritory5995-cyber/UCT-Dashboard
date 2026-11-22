// Tier 2 fix round 1 (review Important 2): the quick thought teaches "alert me if NVDA closes below 190", so when the
// member types such a sentence the DIALOG offers it -- the same offer the note's "Set alert" chip makes
// (AlertPhraseMenu.jsx): the sentence is read by the one parser (lib/alertPhrase.js), its word is confirmed as a
// ticker by the server once (lib/smartChipsApi.js, after typing pauses), and "Set alert…" opens the same
// TextAlertSheet, filled in. Nothing is set until the member presses there. A pronoun ("it") has no note ticker here,
// so it is never offered. A lazy chunk: the parser and the sheet never ride the app's first open.
import { Component, Suspense, useEffect, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { lazyLeaf } from '../../lib/lazyChunk'
import { describeAlert, parseAlertPhrase } from '../../lib/alertPhrase'
import { confirmsSymbol, tickersIn } from '../../lib/smartChipsApi'
import styles from './CaptureDialog.module.css'

// A LEAF (D-I2): inside its own boundary (Quiet below), a chunk that cannot load costs the offer, never a page reload.
const TextAlertSheet = lazyLeaf(() => import('./TextAlertSheet'))
export const CHECK_DELAY_MS = 600

// The sheet is its own chunk; one that cannot load or throws costs the offer, never the capture dialog around it.
class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

export default function CaptureAlertOffer({ text }) {
  const parsed = parseAlertPhrase(text)
  const symbol = parsed && !parsed.pronoun ? parsed.symbol : null
  const [confirmed, setConfirmed] = useState(null)   // { text, symbol }
  const [sheet, setSheet] = useState(null)
  const [done, setDone] = useState('')

  useEffect(() => {
    if (!symbol) return undefined
    let live = true
    const t = setTimeout(async () => {
      const tickers = await tickersIn(text)
      if (live && confirmsSymbol(tickers, symbol)) setConfirmed({ text, symbol })
    }, CHECK_DELAY_MS)
    return () => { live = false; clearTimeout(t) }
  }, [text, symbol])

  const ready = symbol && confirmed && confirmed.text === text && confirmed.symbol === symbol
  return (
    <>
      {/* Mounted empty, filled when the offer is ready, so it is announced. */}
      <div className={styles.offer} role="status" data-capture-alert-offer={ready ? 'ready' : ''}>
        {ready ? (
          <>
            <UIcon name="bell" size={14} />
            <span>{describeAlert(parsed, symbol)}</span>
            <button type="button" className={styles.link} onClick={() => setSheet({ ...parsed, symbol })}>Set alert…</button>
          </>
        ) : done}
      </div>
      {sheet && (
        <Quiet><Suspense fallback={null}>
          <TextAlertSheet open initial={sheet} onClose={() => setSheet(null)}
            onDone={(said) => { setSheet(null); setConfirmed(null); setDone(said || 'Alert set.') }} />
        </Suspense></Quiet>
      )}
    </>
  )
}
