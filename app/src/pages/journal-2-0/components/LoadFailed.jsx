/**
 * LoadFailed — the ONE inline "this didn't load" state (wave 10 follow-up F7, Part A; clause 5d:
 * every failure a member can see is said).
 *
 * ⛔ WHY IT EXISTS. The proof walk of 26e03bbe8 forced each endpoint to fail (a 500, then the
 * request dropped) and 30 of them left no visible sentence: the folder tree, the tag list, a
 * note's side panels, the Settings cards simply rendered EMPTY -- which reads as "you have no
 * folders", a false statement, not a notice. Each consumer now renders this element where its
 * data would have shown: one sentence naming what did not load, and a button that asks again.
 *
 * One element for every consumer, not thirty bespoke ones. It takes a list, so a place that
 * loads several things (the folders panel) says ONE sentence naming what failed rather than a
 * stack of alerts.
 *
 *   <LoadFailed failures={[{ what: 'your folders', error, retry }, ...]} />
 *   <LoadFailed what="your tags" error={error} onRetry={refresh} />
 *
 * Renders nothing while nothing has failed. The copy is the Notebook's voice: plain, no codes,
 * no error text. OFFLINE says offline -- a member whose connection dropped has lost nothing and
 * must not read "error":
 *   · the browser is offline          "You're offline, so your folders didn't load."
 *   · the request never reached us     "Couldn't reach the server to load your folders."
 *   · the server answered with a fault "Couldn't load your folders."
 * Rail: LoadFailed.test.jsx (the rendered sentence, and Try again asks again).
 */
import { useState } from 'react'
import styles from './LoadFailed.module.css'

/** A fetch that never got an answer: the browser rejects it with a TypeError. */
export function isNetworkFailure(error) {
  return !!error && (error instanceof TypeError || error?.name === 'TypeError')
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function joinWhat(list) {
  if (list.length <= 1) return list[0] || ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** The sentence for these failures (exported for the rail and for callers that need the text). */
export function loadFailedSentence(failures) {
  const failed = (failures || []).filter((f) => f && f.error)
  if (!failed.length) return ''
  const what = joinWhat(failed.map((f) => f.what))
  if (isOffline()) return `You're offline, so ${what} didn't load.`
  if (failed.every((f) => isNetworkFailure(f.error))) return `Couldn't reach the server to load ${what}.`
  return `Couldn't load ${what}.`
}

export default function LoadFailed({ failures, what, error, onRetry, compact = false, className = '' }) {
  const list = failures || [{ what, error, retry: onRetry }]
  const failed = list.filter((f) => f && f.error)
  const [asking, setAsking] = useState(false)
  if (!failed.length) return null
  const retries = failed.map((f) => f.retry).filter((r) => typeof r === 'function')
  const retry = async () => {
    setAsking(true)
    // Each read is asked again NOW (in the click), and a retry that throws or rejects cannot
    // stop the others -- its own read reports the new answer.
    const asked = retries.map((r) => {
      try { return Promise.resolve(r()).catch(() => {}) } catch { return Promise.resolve() }
    })
    try { await Promise.all(asked) } finally { setAsking(false) }
  }
  return (
    <div
      role="status"
      className={`${styles.loadFailed} ${compact ? styles.compact : ''} ${className}`.trim()}
      data-load-failed={failed.map((f) => f.what).join('|')}
    >
      <span className={styles.sentence}>{loadFailedSentence(failed)}</span>
      {retries.length > 0 && (
        <button type="button" className={styles.retry} onClick={retry} disabled={asking}>
          {asking ? 'Trying…' : 'Try again'}
        </button>
      )}
    </div>
  )
}

/**
 * SaveFailed -- the same element for a WRITE that did not land (the add-tag and favorite writes
 * of the 26e03bbe8 sweep). A member who pressed something believes it saved, so the sentence
 * STAYS until it is dismissed or the next attempt succeeds -- a message that fades after two
 * seconds is gone by the time a member who looked away looks back (the tag write's did exactly
 * that). Role alert: a failed save is announced, not merely available.
 */
export function SaveFailed({ message, onDismiss, className = '' }) {
  if (!message) return null
  return (
    <div role="alert" className={`${styles.loadFailed} ${styles.compact} ${className}`.trim()} data-save-failed="">
      <span className={styles.sentence}>{message}</span>
      {onDismiss && (
        <button type="button" className={styles.retry} onClick={onDismiss}>Dismiss</button>
      )}
    </div>
  )
}
