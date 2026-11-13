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

/**
 * ⚰️ OFFLINE_VIEWING_BANNER ("Viewing an earlier saved copy — you're offline.", Accessibility QW-5) lived here as a
 * second header line about the READ axis. VIS-5 (audit 2026-11-05, issue 17) measured it beside two more lines
 * ("Saved in this browser · waiting to sync", "Couldn't reach the server — … retrying…"): three contradictory
 * 11 px lines that pushed the header down 26 px. The fact it carried -- "you are offline, and this is the copy
 * saved here" -- is now the ONE offline pill below (`saveIndicatorWords`, offline branch), in the indicator's
 * reserved slot, whether or not anything is waiting to sync.
 */

/**
 * Audit 2026-11-05, spec S10 (M4): the note header's always-visible save indicator. READ FROM THE EXISTING STATE, never
 * a new store: the editor's own `saveStatus` and the offline outbox's `durable.unsynced` / `persisted` (useDurableNote).
 *   * "Saving…" while an edit is waiting or on its way (`dirty`, `saving`);
 *   * "Saved" once the server has it;
 *   * "Offline · saved on this device" whenever the browser is offline and nothing is only intended (VIS-5: the ONE
 *     offline message; the outbox has COMMITTED the work, or there is no work waiting). The noun narrows exactly as
 *     `savedLocally` does: "in this browser" unless the platform granted persistence.
 * ⛔ Silent ('') where another line in the header already speaks for the state (blocked, conflict, refused, a failed
 *    or reconnecting save while online): two status lines naming one state as two would read as two states.
 * ⛔ Fix round 1 (review finding 5) + VIS-5: OFFLINE, this is the ONE offline message: the editor hides the Wave Q1
 *    "Saved on this device · waiting to sync" line and the retrying line, and the "Viewing an earlier saved copy" banner
 *    is retired. An edit still
 *    inside the durable debounce (`dirty`) is not yet kept anywhere, so it reads "Saving…" even offline. While the note
 *    loads nothing is said (`loading`): "Saved" before the note exists would be a claim nobody measured.
 */
export const SAVING_WORDS = 'Saving…'
export const SAVED_WORDS = 'Saved'
// VIS-5 (audit 2026-11-05, issue 17): ONE offline message, the spec's words "Offline · saved on this device". Tier 1a's
// "Offline, kept on this device" and the two header lines beside it are reconciled into it. The noun still narrows
// exactly as `savedLocally` does (Wave Q1's rule: "this device" only when the platform granted persistence).
export function offlineKept(persisted) {
  return persisted === true ? 'Offline · saved on this device' : 'Offline · saved in this browser'
}
// Follow-up D (F3): `held` is the device's store, read on open, holding this note's unsent work (a dirty record or a
// queued entry). Online, "Saved" is then not claimed; the queue's own words are. `decided` (fix round 1): the device has
// answered for this note, or a save landed here; until then only "Saving…" may be said, never a saved claim.
export function saveIndicatorWords({ status, unsynced = false, persisted = false, offline = false, blocked = false,
  loading = false, held = false, decided = true } = {}) {
  if (loading || blocked || status === 'conflict' || status === 'refused') return ''
  // Fix round 1 (Tier 1a): an edit still inside the durable debounce is not yet kept anywhere -- "Saving…", even offline.
  if (status === 'dirty') return SAVING_WORDS
  if (offline) {
    // VIS-5: committed to the outbox, or nothing waiting at all -- the copy on screen is the one saved here.
    if (unsynced) return offlineKept(persisted)
    // A save that failed with NOTHING committed locally is a real problem, and the header's error line says it.
    if (status === 'error' || status === 'reconnecting') return ''
    // A write on its way but not yet in the outbox is never claimed as saved.
    if (status === 'saving') return SAVING_WORDS
    return decided ? offlineKept(persisted) : ''
  }
  if (status === 'error' || status === 'reconnecting') return ''
  if (status === 'saving' || status === 'dirty') return SAVING_WORDS
  if (!decided) return ''
  return held ? unsyncedLabel(persisted) : SAVED_WORDS
}
