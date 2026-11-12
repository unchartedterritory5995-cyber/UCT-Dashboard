// Notebook simplify, Task 3 (2026-11-11): the ONE door behind "Reviews that write themselves".
//
// Research Home's box (ReviewDraftsHomeBox) and the notes list's New ▾ "Reviews" group both run a draft through here,
// so the two can never draft differently. It was the body of the box's own `run`, lifted unchanged: draft the
// period's review for the member's account, say where a NEW daily note went, tell every note list a note was made or
// changed, and open the note on its first collapsed block (lane KEYS3, Q18). Each caller keeps its own busy state and
// shows its own error; a failure throws, with `reviewDraftFailedSentence` to word it.
//
// ⛔ The drafts module (`reviewDrafts.js`, the doc builder) is fetched on the first draft, never statically: it is
// kept off the Notebook's first open (wave 14 perf lane). The flag is `reviewDraftsFlag.js`, also never this file.
import { importWithOneRetry } from './lazyChunk'
import { DAILY_FOLDER_NOTICE } from './dailyNote'
import { invalidateNoteViews } from './offline/invalidateNoteViews'

const loadReviewDrafts = () => importWithOneRetry(() => import('./reviewDrafts'))

const DRAFTERS = {
  daily: (m, accountId) => m.draftDailyReview({ accountId, day: m.todayDayIso() }),
  weekly: (m, accountId) => m.draftWeeklyReview({ accountId, weekStart: m.mondayOfIso() }),
  monthly: (m, accountId) => m.draftMonthlyReview({ accountId, month: m.thisMonthIso() }),
}

/** The three reviews, in order, with the words both doors show. */
export const REVIEW_PERIODS = [
  { period: 'daily', label: "Today's recap" },
  { period: 'weekly', label: "This week's review" },
  { period: 'monthly', label: "This month's review" },
]

/**
 * Draft `period`'s review ('daily' | 'weekly' | 'monthly') and open it.
 * `accountId`: the member's selected account (null is "All accounts"). `onOpenNote(note, null, { to: 'collapsed' })`
 * opens it; `onNotice(sentence)` is told where a newly made daily note went.
 */
export async function draftReview(period, { accountId = null, onOpenNote, onNotice = null } = {}) {
  // A failed fetch of the drafts chunk throws to the caller, like a failed draft.
  const { note, created } = await DRAFTERS[period](await loadReviewDrafts(), accountId)
  // S2 (B12): Today's recap that MADE the day's note says where it went (the server files it in
  // a root Daily folder, made on first use). A recap added to an existing note says nothing more.
  if (period === 'daily' && created) onNotice?.(DAILY_FOLDER_NOTICE)
  // S6 (B5): a drafted review made or changed a note behind every list's back.
  invalidateNoteViews({ tags: true })
  // Lane KEYS3 (Q18): a drafted review's findings are its collapsed blocks. The note opens
  // with focus on the first of them, not at its top (18 to 24 Tab stops above it).
  onOpenNote(note, null, { to: 'collapsed' })
}

/** What a failed draft says. `memberMessage` is a sentence the door wrote for the member (the note is still syncing). */
export function reviewDraftFailedSentence(period, error) {
  return error?.memberMessage || `Could not draft the ${period} review — try again.`
}

/** Go-live wave 1 (D4): what the notes list's notice line says while a draft runs ("Drafting today's recap…"). */
export function reviewDraftingSentence(period) {
  const label = REVIEW_PERIODS.find((p) => p.period === period)?.label || 'the review'
  return `Drafting ${label.charAt(0).toLowerCase()}${label.slice(1)}…`
}
