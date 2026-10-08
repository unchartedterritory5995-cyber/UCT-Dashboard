// Tour `review-drafts` (W14-B2, plan 4.2 row 11): the Home door of "Reviews that write
// themselves". Anchors live in ResearchHome.jsx's ReviewDraftsHomeBox (wave 13 lane 13F).
const F = 'components/notebook/ResearchHome.jsx'
const step = (id, anchor, file = F) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('home', 'review-drafts-home'),
  step('daily', 'review-drafts-daily'),
  step('weekly', 'review-drafts-weekly'),
  step('monthly', 'review-drafts-monthly'),
])

export const COPY = Object.freeze({
  home: Object.freeze({
    title: 'Reviews that write themselves',
    body: 'One click drafts a review note from your journal: trades, P&L, how well you kept your plans, and charts of the best and worst trade. You edit it from there.',
  }),
  daily: Object.freeze({
    title: "Today's recap",
    body: "Adds today's trades and results to today's daily note, so your end-of-day review starts with the facts already written down.",
  }),
  weekly: Object.freeze({
    title: "This week's review",
    body: 'A new note for the week, with your discipline record, setup changes and links to the plans and reviews you wrote.',
  }),
  monthly: Object.freeze({
    title: "This month's review",
    body: 'The same for the month. Any leaks found are listed with their sample size, what they cost and the trades they rest on.',
  }),
})
