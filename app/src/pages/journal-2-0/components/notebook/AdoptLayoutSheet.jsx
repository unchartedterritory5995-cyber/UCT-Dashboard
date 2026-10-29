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
import usePreferences, { mergeIntoPreferenceCache, refreshPreferences } from '../../../../hooks/usePreferences'
import { beginPrefsOp } from '../../../../lib/prefsSession'
import { LAYOUT_UNSUPPORTED_SENTENCE, adoptLayout } from '../../lib/styleLibrary'
import {
  LAYOUT_PREF, LOAD_FAILED, PHASE_LABELS, applySharedPage, layoutDiff, listsFor, normalizeLayout, replaceLists,
} from '../../lib/pageLayouts'
import { refusalSentence } from './StyleLibraryCard'
import { withStop } from './useHelpfulToggle'
import styles from './TemplateGallery.module.css'

export const CHANGE_FAILED = "Couldn't change your layout. Nothing was changed."
export const UNDO_FAILED = "Couldn't put your previous layout back. Open Customize to change it."
// How long a failed write waits for the re-read of the member's layout before ABORTING it (review N-1, T7-R4 M-2). An
// aborted read is a failed read: it settles, it never lands in the cache later, and only then is Try again offered.
export const REFRESH_TIMEOUT_MS = 8000

/** The re-read after a failed write, bounded: at REFRESH_TIMEOUT_MS the fetch itself is aborted, so the promise settles
 *  only when the request has, and a late answer can never overwrite a newer write (T7-R4 M-2). The timer is cleared as
 *  soon as the read settles (M-3). */
async function boundedRefresh() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => { controller?.abort() }, REFRESH_TIMEOUT_MS)
  try {
    return await refreshPreferences(controller ? { signal: controller.signal } : undefined)
  } finally {
    clearTimeout(timer)
  }
}

const sameLayout = (a, b) => JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b))
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
  const [refreshing, setRefreshing] = useState(false) // a failed write's re-read in flight: no Try again until it settles
  const workingRef = useRef(false)
  // The hook's `readFailed`, read again at the moment of a write: the click-time check sits before the adopt round trip,
  // and a preferences read can fail during it (review I-1).
  const readFailedRef = useRef(false)
  useEffect(() => { readFailedRef.current = readFailed === true }, [readFailed])
  // The lists the FIRST write attempt replaced, taken from the layout that attempt merged into. A failed write leaves its
  // optimistic value in the hook's cache, so a Try again's updater would see the adopted layout and capture the shared
  // lists as "previous"; the first capture is the member's real previous layout, so it wins (review I-3).
  const firstCaptureRef = useRef(null)
  // ⛔ The member an adopt is FOR, begun in use() BEFORE the adopt round trip and carried into its
  // write, its Try again and its Undo: none of them may write into a member who signed in
  // meanwhile (usePreferences `beginPrefsOp`). Owner-approved rule-12 edit, 2026-10-29.
  const retryOpRef = useRef(null)

  const cantRead = readFailed === true
  const shared = layout && typeof layout.lists === 'object' ? layout.lists : {}
  const rows = layoutDiff(normalizeLayout(prefs?.[LAYOUT_PREF]), page, shared)

  const dismiss = () => { if (workingRef.current) return; onClose() }

  // Undo runs from the gallery's message host, after this sheet has gone. One run at a time (review M-4). After an adopt
  // the member's layout is always stored, so a MISSING stored value means the preferences read failed and the cache holds
  // nothing: merging onto it would write defaults over every list Undo did not capture. The write is abandoned instead
  // (`undefined` from the updater), and that is a failure to say (review I-1).
  const undo = (captured, op) => {
    let running = false
    return async () => {
      if (running) return
      if (op.stale()) return                          // the member changed since the adopt: nothing of theirs to undo here
      running = true
      let ok = false
      try {
        const answer = await setPrefMerged(LAYOUT_PREF, (prev) => (
          prev == null || typeof prev !== 'object' ? undefined : replaceLists(normalizeLayout(prev), page, captured)
        ), op)
        ok = answer?.ok === true
      } catch {
        ok = false
      }
      running = false
      if (op.stale()) return
      if (ok) {
        onMessage?.({ tone: 'ok', text: `Your previous ${PAGE_WORDS[page]} layout is back.` })
      } else {
        refreshPreferences()
        onMessage?.({ tone: 'error', text: UNDO_FAILED })
      }
    }
  }

  // The one write. `captured` is set by the updater, from the layout the write merges into.
  const write = async (answer, op) => {
    if (!op || op.stale()) { workingRef.current = false; setWorking(false); return }   // no op of this member's: nothing is written
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
      retryOpRef.current = op
      setError(CHANGE_FAILED)                         // said, with Try again (disabled until a read answers) (review N-2)
      return
    }
    let captured = null
    let applied = null                                // the optimistic value this attempt put in the cache
    let ok = false
    try {
      const res = await setPrefMerged(LAYOUT_PREF, (prev) => {
        const base = normalizeLayout(prev)
        captured = listsFor(base, page, lists)
        if (!firstCaptureRef.current) firstCaptureRef.current = captured
        applied = applySharedPage(base, page, lists)
        return applied
      }, op)
      ok = res?.ok === true
    } catch {
      ok = false
    }
    if (op.stale()) { workingRef.current = false; setWorking(false); onClose(); return }   // the member changed during the write
    if (!ok || !captured) {
      // Said at once, and the sheet is free at once: Cancel works even if the re-read never answers (review N-1). Use stays
      // off (`retry`), and Try again waits for the re-read, so it never captures the optimistic value (review I-3).
      workingRef.current = false
      setWorking(false)
      setRetry(answer)
      retryOpRef.current = op
      setError(CHANGE_FAILED)
      setRefreshing(true)
      // The hook applied the value optimistically. Take the server's back, bounded so a hung read cannot hold Try again:
      // the read is ABORTED at the bound, so it has settled before Try again shows and cannot land after it (T7-R4 M-2).
      const fresh = await boundedRefresh()
      if (fresh == null && firstCaptureRef.current && applied) {
        // The re-read failed too, so the unsaved layout is still in the cache, where the next adopt would capture it as the
        // member's own. Put the lists back to what they were, locally: no POST, the server never had the adopted value.
        // Compare-and-swap (T7-R4 M-1): only while the cache still holds exactly the value THIS attempt wrote. Anything else
        // means a newer write (Customize, a second adopt) has landed since, and that write POSTed the whole layout, so
        // putting the capture back would make the cache disagree with the server. Then nothing changes.
        const previous = firstCaptureRef.current
        const optimistic = applied
        await mergeIntoPreferenceCache(LAYOUT_PREF, (cur) => (
          cur && typeof cur === 'object' && sameLayout(cur, optimistic)
            ? replaceLists(normalizeLayout(cur), page, previous)
            : undefined
        ), op)
      }
      setRefreshing(false)
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
      action: { label: 'Undo', run: undo(captured, op) },
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
    retryOpRef.current = null
    firstCaptureRef.current = null
    const op = beginPrefsOp()                         // before the adopt round trip (see retryOpRef)
    let answer
    try {
      answer = await adoptLayout(item.id, { version })
    } catch (err) {
      workingRef.current = false
      setWorking(false)
      setError(refusalSentence(err, CHANGE_FAILED))
      return
    }
    await write(answer, op)
  }

  const tryAgain = async () => {
    if (workingRef.current || !retry || cantRead || refreshing) return
    const op = retryOpRef.current
    if (!op || op.stale()) { onClose(); return }      // the retry belongs to a member no longer signed in
    workingRef.current = true
    setWorking(true)
    setError('')
    await write(retry, op)
  }

  const footer = (
    <div className={styles.adoptFooter}>
      {cantRead && <p role="alert" className={styles.error}>{LOAD_FAILED}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          <span>{error}</span>
          {retry && !refreshing && (
            <button type="button" className={styles.btn} onClick={tryAgain} disabled={working || cantRead}>Try again</button>
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
