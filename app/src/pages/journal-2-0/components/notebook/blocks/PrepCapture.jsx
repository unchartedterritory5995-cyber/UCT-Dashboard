// The frame the four daily-prep blocks share (Notebook P2b, Task 10; spec §P2 item 6, R-P2b-6).
// A prep block is a FROZEN snapshot: nothing is read until the member presses "Capture now", the
// answer is written into the block's params through setParams (one editor transaction, the note's own
// save path), and from then on the block shows that snapshot, "Captured {time} ET", and "Capture again".
// ⛔ It never fetches on mount: an older note offered the block by "Update layout" has no snapshot and
// must not quietly show today's data (IR-S11); a new note's create already captured one server-side.
// ⛔ Every gap is named: a snapshot with `missing` shows its `detail`, one with `needs` says what switch
// it needs. An answer that is not this part never lands in the note.
//
// Audit 2026-11-05, spec S9 (detail #49): a fresh note's create can land before today's earnings list (or a price) is
// in the cache, and the block said "Capture again in a few minutes": the member was asked to retry. Now a snapshot
// whose gap fills itself (RETRYABLE, railed against trader_blocks.PREP_RETRYABLE) and that was captured TODAY (New York)
// is read again in the background while the note is open and editable, every RETRY_MS, at most RETRY_MAX times; the
// first full answer fills the block. ⛔ Still never a read for a block with no snapshot, nor for one captured on an
// earlier day (that note must not quietly show today's data, IR-S11). A background read that fails says nothing.
import EmptyNamesAsk from '../EmptyNamesAsk'
import { useEffect, useRef, useState } from 'react'
import { BlockNeedsSwitch } from './blockStates'
import { CAPTURE_FAILED } from '../../../lib/blocks/captureCopy'
import styles from './Blocks.module.css'

// The ONE copy lives in lib/blocks/captureCopy.js; the market context stamp's Capture now says it too.
const FAILED = CAPTURE_FAILED

/** The gaps the block reads again by itself (trader_blocks.PREP_RETRYABLE; tests/test_prep_gaps_s9.py parses this). */
export const RETRYABLE = ['no_earnings_yet', 'no_quotes', 'source_error']
export const RETRY_MS = 30000
export const RETRY_MAX = 10
/** What a retrying gap says while it waits, whatever sentence the snapshot froze (an older note's asked to retry). */
export const FILLING_WORDS = {
  no_earnings_yet: "Today's earnings list is still loading. It fills in here when it's ready.",
  no_quotes: "Your names' prices are still loading. They fill in here when they're ready.",
  source_error: "This couldn't be read just now. It fills in here when it can.",
}

/** Fix round 1 (review finding 7): what a retrying gap says once nothing will fill it -- its reads ran out, it was
 *  captured on an earlier day, or this is a reader's view. Past tense: no promise the block cannot keep. */
export const FINAL_WORDS = {
  no_earnings_yet: "The earnings list wasn't loaded for this day.",
  no_quotes: "Prices weren't loaded for this day.",
  source_error: "This couldn't be read for this day.",
}

/** "Oct 5, 2026, 10:30 AM" in New York, or null for a time that cannot be read. */
function easternTime(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
}

/** The New York calendar day of a time, or null. */
function etDay(at) {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Does this snapshot wait on a gap that fills itself, captured today? */
export function fillsItself(snap, now = new Date()) {
  return Boolean(snap && RETRYABLE.includes(snap.missing) && snap.capturedAt && etDay(snap.capturedAt) === etDay(now))
}

/** ONE read of a prep part: the answer when it is this part, else null. Never throws. */
async function readPart(part) {
  try {
    const res = await fetch(`/api/j2/trader-blocks/prep/${part}`, { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body && typeof body === 'object' && body.part === part ? body : null
  } catch {
    return null
  }
}

/** S17: what a prep block needs when the member has no names. */
export const PREP_NAMES_ASK = "Add the tickers you watch, and today's prep for them shows up here."

export default function PrepCapture({ part, params, setParams, editable, children }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const snap = params?.snapshot
  // After RETRY_MAX quiet reads the block offers its Capture again once more (the cache may be down for the day).
  const [exhausted, setExhausted] = useState(null)        // the capturedAt whose reads ran out
  const filling = editable && fillsItself(snap) && exhausted !== snap?.capturedAt
  const setParamsRef = useRef(setParams)
  setParamsRef.current = setParams

  // S9: the background fill. Keyed on the frozen snapshot's own time and gap, so a landed answer (a new snapshot)
  // ends it, and a member's own Capture again restarts the count.
  useEffect(() => {
    if (!filling) return undefined
    let alive = true
    let tries = 0
    let timer = null
    const tick = async () => {
      if (!alive) return
      tries += 1
      // Pinned to the snapshot's own day (review finding 7c): a chain started before midnight never reads, or writes,
      // the next day's list into yesterday's snapshot.
      if (!fillsItself(snap, new Date())) { setExhausted(snap?.capturedAt ?? null); return }
      const body = await readPart(part)
      if (!alive) return
      if (body && !body.missing && !body.needs && etDay(body.capturedAt) === etDay(snap.capturedAt)
        && fillsItself(snap, new Date())) {
        setParamsRef.current({ snapshot: body })
        return
      }
      if (tries < RETRY_MAX) timer = setTimeout(tick, RETRY_MS)
      else setExhausted(snap?.capturedAt ?? null)
    }
    timer = setTimeout(tick, RETRY_MS)
    return () => { alive = false; clearTimeout(timer) }
  }, [filling, part, snap?.capturedAt, snap?.missing]) // eslint-disable-line react-hooks/exhaustive-deps

  const capture = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const body = await readPart(part)
      if (!body) throw new Error('not this part')
      if (setParams({ snapshot: body }) === false) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const when = snap ? easternTime(snap.capturedAt) : null
  let body = null
  if (snap?.needs) body = <BlockNeedsSwitch what={snap.needs} />
  // S17 (audit 2026-11-05, M7): a block with no names to read ASKS for them, then captures again.
  else if (snap?.missing === 'no_names' && editable) body = <EmptyNamesAsk sentence={PREP_NAMES_ASK} onAdded={capture} testId="prep-names-ask" />
  else if (snap?.missing) body = <p className={styles.muted} data-prep-filling={filling ? '' : undefined}>{filling ? FILLING_WORDS[snap.missing] : RETRYABLE.includes(snap.missing) ? FINAL_WORDS[snap.missing] : snap.detail}</p>
  else if (snap) body = children(snap)
  // M-4 (R-T12-C fix round): an empty block says why for an editor too, above its "Capture now".
  else body = <p className={styles.muted}>Not captured yet.</p>
  return (
    <div>
      {body}
      {when && !filling && <p className={styles.muted}>{`Captured ${when} ET`}</p>}
      {failed && <p role="status" className={styles.muted}>{FAILED}</p>}
      {/* While a gap fills itself there is nothing to press: the member is never asked to retry (S9). */}
      {editable && !filling && !(snap?.missing === 'no_names') && (
        // btn-secondary: the same visible button as the market context stamp's Capture now.
        <button type="button" className={`btn btn-secondary ${styles.tap}`} disabled={busy} onClick={capture}>
          {snap ? 'Capture again' : 'Capture now'}
        </button>
      )}
    </div>
  )
}
