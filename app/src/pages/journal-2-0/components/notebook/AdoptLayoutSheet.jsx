// P4b Task 7: the confirm for adopting a shared PAGE LAYOUT (LayoutLibraryCard.jsx opens it). It shows what changes,
// list by list, by the labels of the shown panels, before anything is written.
//
// On "Use this layout":
//   1. `adoptLayout(item.id, {version})`: the server answers the LISTED layout (and counts the use). It writes no
//      preference. A refusal (a newer version, the adopt budget, an unusable layout) is the server's sentence and
//      NOTHING is written.
//   2. `setPrefMerged(LAYOUT_PREF, updater)`: the member's OWN `journal_page_layout`, the only write, through the
//      preference door every layout writer uses. The lists it replaces are captured INSIDE the updater, from the
//      exact layout the write merges into, never from an earlier render's `prefs`, so Undo puts back what was
//      really there. Only `{ok: true}` is a write; a failure says so and offers Try again, which repeats ONLY this
//      write (the adopt is not sent twice).
// ⛔ No note writes, and the client never sends a list to the server: the server owns every rule about the layout.
// ⛔ If the member's layout could not be read (`readFailed`), a merge would write defaults over every list the
//    layout does not name, so "Use this layout" is disabled with the Customize editor's LOAD_FAILED sentence.
// ⛔ The success line and its Undo go to the gallery's message host (`onMessage`), which outlives this sheet; Undo
//    goes through the same door, replacing exactly the captured lists with what they were.
import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import usePreferences, { refreshPreferences } from '../../../../hooks/usePreferences'
import { LAYOUT_UNSUPPORTED_SENTENCE, adoptLayout } from '../../lib/styleLibrary'
import {
  LAYOUT_PREF, LOAD_FAILED, PHASE_LABELS, applySharedPage, layoutDiff, listsFor, normalizeLayout, replaceLists,
} from '../../lib/pageLayouts'
import { refusalSentence } from './StyleLibraryCard'
import { withStop } from './useHelpfulToggle'
import styles from './TemplateGallery.module.css'

export const CHANGE_FAILED = "Couldn't change your layout. Nothing was changed."
export const UNDO_FAILED = "Couldn't put your previous layout back. Open Customize to change it."
export const STANDING_LINE = "A panel that needs something you don't have on yet keeps its place and shows once it can."
const TITLES = { today: 'Use this layout for Today?', trade: 'Use this layout for the trade page?' }
const PAGE_WORDS = { today: 'Today', trade: 'trade page' }       // "Your current Today layout", "… trade page layout"
const PAGE_SUBJECTS = { today: 'Today', trade: 'The trade page' } // "Today now uses …", "The trade page now uses …"

const labels = (list) => (list.length ? list.join(', ') : 'no panels')

/** One diff row's sentence: `<phase>: now <labels> · after <labels>`, or `<phase>: stays the same`. */
function diffSentence(page, row) {
  const name = page === 'trade' ? 'The trade page' : PHASE_LABELS[row.list]
  return row.changed ? `${name}: now ${labels(row.now)} · after ${labels(row.after)}` : `${name}: stays the same`
}

export default function AdoptLayoutSheet({ item, version, layout, onClose, onMessage }) {
  const page = item.layoutPage === 'today' ? 'today' : 'trade'
  const { prefs, setPrefMerged, loading, readFailed } = usePreferences()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(null)          // the adopt answer whose WRITE failed: Try again repeats only it
  const workingRef = useRef(false)
  // The hook's `readFailed`, read again at the moment of a write: the click-time check sits before the adopt round trip,
  // and a preferences read can fail during it (review I-1).
  const readFailedRef = useRef(false)
  useEffect(() => { readFailedRef.current = readFailed === true }, [readFailed])
  // The lists the FIRST write attempt replaced, taken from the layout that attempt merged into. A failed write leaves its
  // optimistic value in the hook's cache, so a Try again's updater would see the adopted layout and capture the shared
  // lists as "previous"; the first capture is the member's real previous layout, so it wins (review I-3).
  const firstCaptureRef = useRef(null)

  const cantRead = readFailed === true
  const shared = layout && typeof layout.lists === 'object' ? layout.lists : {}
  const rows = layoutDiff(normalizeLayout(prefs?.[LAYOUT_PREF]), page, shared)

  const dismiss = () => { if (workingRef.current) return; onClose() }

  // Undo runs from the gallery's message host, after this sheet has gone. One run at a time (review M-4). After an adopt
  // the member's layout is always stored, so a MISSING stored value means the preferences read failed and the cache holds
  // nothing: merging onto it would write defaults over every list Undo did not capture. The write is abandoned instead
  // (`undefined` from the updater), and that is a failure to say (review I-1).
  const undo = (captured) => {
    let running = false
    return async () => {
      if (running) return
      running = true
      let ok = false
      try {
        const answer = await setPrefMerged(LAYOUT_PREF, (prev) => (
          prev == null || typeof prev !== 'object' ? undefined : replaceLists(normalizeLayout(prev), page, captured)
        ))
        ok = answer?.ok === true
      } catch {
        ok = false
      }
      running = false
      if (ok) {
        onMessage?.({ tone: 'ok', text: `Your previous ${PAGE_WORDS[page]} layout is back.` })
      } else {
        refreshPreferences()
        onMessage?.({ tone: 'error', text: UNDO_FAILED })
      }
    }
  }

  // The one write. `captured` is set by the updater, from the layout the write merges into.
  const write = async (answer) => {
    const lists = answer?.layout?.lists
    if (!lists || typeof lists !== 'object') {       // the server never answers this; nothing to apply is not a write
      workingRef.current = false
      setWorking(false)
      setError(LAYOUT_UNSUPPORTED_SENTENCE)
      return
    }
    if (readFailedRef.current) {                      // the read failed during the adopt round trip: nothing is written
      workingRef.current = false
      setWorking(false)
      setRetry(answer)
      return
    }
    let captured = null
    let ok = false
    try {
      const res = await setPrefMerged(LAYOUT_PREF, (prev) => {
        const base = normalizeLayout(prev)
        captured = listsFor(base, page, lists)
        if (!firstCaptureRef.current) firstCaptureRef.current = captured
        return applySharedPage(base, page, lists)
      })
      ok = res?.ok === true
    } catch {
      ok = false
    }
    if (!ok || !captured) {
      // The hook applied the value optimistically; take the server's back BEFORE Try again is offered (review I-3).
      await refreshPreferences()
      workingRef.current = false
      setWorking(false)
      setRetry(answer)
      setError(CHANGE_FAILED)
      return
    }
    workingRef.current = false
    setWorking(false)
    captured = firstCaptureRef.current || captured
    const credit = typeof answer?.credit === 'string' && answer.credit.trim() ? ` ${withStop(answer.credit.trim())}` : ''
    onClose()
    onMessage?.({
      tone: 'ok',
      text: `${PAGE_SUBJECTS[page]} now uses "${item.title}".${credit}`,
      action: { label: 'Undo', run: undo(captured) },
    })
  }

  // While a failed write is waiting (`retry`), Use is not offered: it would adopt again and spend the adopt budget a second
  // time. Try again repeats only the write (review I-2).
  const use = async () => {
    if (workingRef.current || cantRead || loading || retry) return
    workingRef.current = true
    setWorking(true)
    setError('')
    setRetry(null)
    firstCaptureRef.current = null
    let answer
    try {
      answer = await adoptLayout(item.id, { version })
    } catch (err) {
      workingRef.current = false
      setWorking(false)
      setError(refusalSentence(err, CHANGE_FAILED))
      return
    }
    await write(answer)
  }

  const tryAgain = async () => {
    if (workingRef.current || !retry || cantRead) return
    workingRef.current = true
    setWorking(true)
    setError('')
    await write(retry)
  }

  const footer = (
    <div className={styles.adoptFooter}>
      {cantRead && <p role="alert" className={styles.error}>{LOAD_FAILED}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          <span>{error}</span>
          {retry && (
            <button type="button" className={styles.btn} onClick={tryAgain} disabled={working}>Try again</button>
          )}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={use}
          disabled={working || cantRead || loading || Boolean(retry)}>
          {working ? 'Working…' : 'Use this layout'}
        </button>
        <button type="button" className={styles.btn} onClick={dismiss} disabled={working}>Cancel</button>
      </div>
    </div>
  )

  return (
    <Sheet open onClose={dismiss} title={TITLES[page]} footer={footer} dismissOnBackdrop={false} maxWidth={520} labelledByTitle>
      <div className={styles.adoptBody}>
        <p className={styles.note}>
          Your current {PAGE_WORDS[page]} layout is replaced for the parts listed below. Nothing else changes.
        </p>
        {loading ? (
          <p className={styles.note} role="status">Loading your layout…</p>
        ) : (
          <ul className={styles.diffList} aria-label="What changes">
            {rows.map((row) => (
              <li key={row.list} className={styles.diffRow} data-changed={row.changed ? 'true' : 'false'}>
                {diffSentence(page, row)}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.note}>{STANDING_LINE}</p>
      </div>
    </Sheet>
  )
}
