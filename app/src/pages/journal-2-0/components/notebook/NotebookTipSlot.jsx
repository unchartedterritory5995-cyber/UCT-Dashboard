// S13 (audit 2026-11-05): the one-time tips at the moment of need (lib/notebookTips.js has the rules and the words).
// The EAGER half: it listens to the editor's updates and decides; the card itself (NotebookTip.jsx) is a lazy leaf,
// fetched the first time a tip is earned, so the Notebook's first open carries only this file.
//
// ⛔ Never steals focus: the member is typing. The card is announced through ONE status line that is mounted empty
// and filled when a tip shows (a live region added together with its text is often not read).
// ⛔ Recorded when its card has RENDERED (`onShown`, from the card's own mount effect: a chunk that fails to load never
// burns the tip -- Tier 2 review minor 6), through setPrefMerged; the server merges the seen ids as a union, so two
// tabs never erase each other's record (review minor 7). It then appears once per account.
import { Component, Suspense, useEffect, useRef, useState } from 'react'
import usePreferences from '../../../../hooks/usePreferences'
import { lazyLeaf } from '../../lib/lazyChunk'
import { TIPS_PREF, TIP_COPY, restoredWidgetByUndo, seenTips, tipAvailable, tipFor, withTipSeen } from '../../lib/notebookTips'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'

const NotebookTip = lazyLeaf(() => import('./NotebookTip'))

class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

/** No hover (a phone or a tablet): the ticker tip says "Tap". Read when the tip is earned, never at first paint. */
const touchNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: none)').matches

export default function NotebookTipSlot({ editor }) {
  const { prefs, loading, setPrefMerged } = usePreferences()
  const [tip, setTip] = useState(null)          // { id, text }
  const live = useRef({})
  live.current = { prefs, loading, setPrefMerged, tip }

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const onUpdate = ({ transaction }) => {
      // S20 (audit 2026-11-05): a widget deleted and then brought back by undo is a trust incident. Counted on the
      // same update listener, before any tip rule (it is counted whatever the tips say).
      if (restoredWidgetByUndo(transaction)) trackNotebookEvent(NOTEBOOK_EVENTS.TRUST_INCIDENT, { kind: 'widget_restored' })
      const { prefs: p, loading: l, setPrefMerged, tip: showing } = live.current
      if (l || showing || !editor.isEditable) return
      const id = tipFor(transaction, editor.state)
      if (!id || !tipAvailable(id) || seenTips(p?.[TIPS_PREF]).has(id)) return
      setTip({ id, text: id === 'ticker' ? TIP_COPY.ticker(touchNow()) : TIP_COPY.chart() })
    }
    editor.on('update', onUpdate)
    return () => editor.off('update', onUpdate)
  }, [editor])

  return (
    <>
      <p role="status" className="sr-only" data-notebook-tip-status="">{tip ? `${TIP_COPY.label}: ${tip.text}` : ''}</p>
      {tip && (
        <Quiet key={tip.id}>
          <Suspense fallback={null}>
            <NotebookTip id={tip.id} text={tip.text} onDismiss={() => setTip(null)}
              onShown={() => setPrefMerged(TIPS_PREF, (current) => withTipSeen(current, tip.id))} />
          </Suspense>
        </Quiet>
      )}
    </>
  )
}
