// Tour `review-drafts` (W14-B2, plan 4.2 row 11): "Reviews that write themselves".
// Go-live wave 1: Research home's box is gone; the drafts are the notes list's New menu "Reviews" group.
//   * wide (641px and up): step 1 asks the member to open the New menu's arrow (the `templates` anchor) and waits
//     for "Today's recap"; steps 2 to 4 point at the three rows.
//   * phone (640px and below): the "+ New" group is not drawn there, so ⋯ (`styles-button`) carries the same Reviews
//     group; step 1 asks for ⋯, step 2 points at the group.
// Every anchor is a literal `data-tour` in tabs/NotebookTab.jsx.
const TAB = 'tabs/NotebookTab.jsx'
const step = (id, anchor, more = {}) => Object.freeze({ id, anchor, file: TAB, ...more })

export const STEPS = Object.freeze([
  step('open', 'templates', { waitFor: 'review-drafts-daily', tier: 'wide' }),
  step('daily', 'review-drafts-daily', { tier: 'wide' }),
  step('weekly', 'review-drafts-weekly', { tier: 'wide' }),
  step('monthly', 'review-drafts-monthly', { tier: 'wide' }),
  step('phone-open', 'styles-button', { waitFor: 'review-drafts-phone', tier: 'phone' }),
  step('phone-reviews', 'review-drafts-phone', { tier: 'phone' }),
])

const WHAT = 'One click drafts a review note from your journal: trades, P&L, how well you kept your plans, and charts of the best and worst trade. You edit it from there.'
export const COPY = Object.freeze({
  open: Object.freeze({
    title: 'Reviews that write themselves',
    body: `Open the arrow next to + New: the Reviews are at the bottom. ${WHAT}`,
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
  'phone-open': Object.freeze({
    title: 'Reviews that write themselves',
    body: `Open More notebook actions (the three dots) to see Reviews. ${WHAT}`,
  }),
  'phone-reviews': Object.freeze({
    title: 'Pick a review',
    body: "Today's recap adds today's trades and results to today's daily note. This week's and this month's review each make a new note, with your discipline record and any leaks found.",
  }),
})
