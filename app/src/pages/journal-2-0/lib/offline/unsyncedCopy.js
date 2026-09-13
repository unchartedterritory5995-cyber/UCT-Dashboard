/**
 * Wave Q1 — THE ONE AUTHORITY FOR "THE SERVER DOES NOT HAVE THIS YET".
 *
 * The editor header shipped these two sentences inline. Now a second surface
 * (the notes list) has to say the same thing about a note the member is not
 * looking at, and a second surface is exactly where a vocabulary splits: one
 * screen ends up saying "waiting to sync" and the other "not backed up", and a
 * member reasonably reads them as two different states
 * (`lesson_a_second_authority_over_one_value`).
 *
 * ⛔ So the strings live here and nowhere else. Both surfaces import them; the
 * rails assert the RENDERED TEXT rather than a flag, so a copy change that
 * breaks one surface fails loudly instead of quietly reading blank
 * (that is the JournalToast `message`/`msg` defect, in this wave's grammar).
 */

/**
 * ⛔ THE NOUN NARROWS WHEN THE PLATFORM WILL NOT PROMISE RETENTION.
 * "This device" implies the words outlive the browsing session; only a granted
 * `persisted()` supports that. Everywhere else — a private window, a fresh
 * profile, Safari and Firefox as measured in the §32 matrix — the honest claim
 * is "in this browser".
 *
 * ⛔ THIS IS NOT PRIVATE-MODE DETECTION AND MUST NEVER BECOME IT.
 * `persisted() === false` is equally true of a brand-new ordinary profile.
 */
export function savedLocally(persisted) {
  return persisted === true ? 'Saved on this device' : 'Saved in this browser'
}

/** The work is queued and the queue can still move on its own. */
export function unsyncedLabel(persisted) {
  return `${savedLocally(persisted)} · waiting to sync`
}

/**
 * The work is queued and the queue will NOT move on its own.
 *
 * ⛔ The second half is the whole point of this string. A blocked entry is not
 * "waiting" — the drain has retired it from retrying, deliberately, because it
 * could not prove the write was not clobbering. It moves again when, and only
 * when, the member edits that note again: a fresh durable write REPLACES the
 * outbox entry (the key is `note:<id>`) and the replacement carries no
 * `permanent` flag. So the sentence names the action, not the state.
 */
export function blockedLabel(persisted) {
  return `${savedLocally(persisted)} · edit it again to sync`
}

/** The compact form for a list row, where the noun has no room to narrow. */
export const BLOCKED_BADGE = 'Edit again to sync'

/** What the badge says when a pointer rests on it — the full sentence. */
export const BLOCKED_TITLE =
  'This note has words that have not reached the server, and will not until you edit it again.'
