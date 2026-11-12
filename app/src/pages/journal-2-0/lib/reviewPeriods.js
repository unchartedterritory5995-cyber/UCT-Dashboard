// Go-live wave 1, fix round 1 (first-open bytes): the words of "Reviews that write themselves", in a file of their own.
// The notes list's New menu draws its Reviews rows from these on first open; the drafting door itself
// (reviewDraftRun.js, which imports the dailyNote and invalidateNoteViews helpers) is fetched on the first press.
// reviewDraftRun.js re-exports all three, so there is one authority for each.

/** The three reviews, in order, with the words both doors show. */
export const REVIEW_PERIODS = [
  { period: 'daily', label: "Today's recap" },
  { period: 'weekly', label: "This week's review" },
  { period: 'monthly', label: "This month's review" },
]

/** What a failed draft says. `memberMessage` is a sentence the door wrote for the member (the note is still syncing). */
export function reviewDraftFailedSentence(period, error) {
  return error?.memberMessage || `Could not draft the ${period} review — try again.`
}

/** Go-live wave 1 (D4): what the notes list's notice line says while a draft runs ("Drafting today's recap…"). */
export function reviewDraftingSentence(period) {
  const label = REVIEW_PERIODS.find((p) => p.period === period)?.label || 'the review'
  return `Drafting ${label.charAt(0).toLowerCase()}${label.slice(1)}…`
}
