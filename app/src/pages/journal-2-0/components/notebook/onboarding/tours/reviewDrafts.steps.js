// Tour `review-drafts` (W14-B2, plan 4.2 row 11): "Reviews that write themselves".
// Go-live wave 1: Research home's box is gone; the drafts are the notes list's New menu.
// Simplify pass 2 (C2): the three reviews are the second view of ONE row, "Draft a review", so each tier opens its menu,
// then "Draft a review" (waiting for the first review), then the reviews:
//   * wide (641px and up): the New menu's arrow (`templates`), then "Draft a review" (`review-drafts-open`);
//   * phone (640px and below): the "+ New" group is not drawn there, so ⋯ (`styles-button`) carries the same row
//     (`review-drafts-phone`);
//   * both tiers: today's recap, then the week's and month's reviews in one step (the registry's six-step budget).
// The reviews' anchors are written once in tabs/NotebookTab.jsx and drawn by whichever of the two menus is open.
// Every anchor is a literal `data-tour` in tabs/NotebookTab.jsx.
const TAB = 'tabs/NotebookTab.jsx'
const step = (id, anchor, more = {}) => Object.freeze({ id, anchor, file: TAB, ...more })

export const STEPS = Object.freeze([
  step('open', 'templates', { waitFor: 'review-drafts-open', tier: 'wide' }),
  step('open-reviews', 'review-drafts-open', { waitFor: 'review-drafts-daily', tier: 'wide' }),
  step('phone-open', 'styles-button', { waitFor: 'review-drafts-phone', tier: 'phone' }),
  step('phone-open-reviews', 'review-drafts-phone', { waitFor: 'review-drafts-daily', tier: 'phone' }),
  step('daily', 'review-drafts-daily'),
  step('later', 'review-drafts-weekly'),
])

const WHAT = 'One click drafts a review note from your journal: trades, P&L, how well you kept your plans, and charts of the best and worst trade. You edit it from there.'
export const COPY = Object.freeze({
  open: Object.freeze({
    title: 'Reviews that write themselves',
    body: `Open the arrow next to + New. ${WHAT}`,
  }),
  'open-reviews': Object.freeze({
    title: 'Open Draft a review',
    body: "Choose Draft a review: today's recap, this week's review and this month's review are inside.",
  }),
  daily: Object.freeze({
    title: "Today's recap",
    body: "Adds today's trades and results to today's daily note, so your end-of-day review starts with the facts already written down.",
  }),
  later: Object.freeze({
    title: "This week's and this month's review",
    body: 'Each makes a new note, with your discipline record, setup changes and links to the plans and reviews you wrote. Any leaks found are listed with their sample size, what they cost and the trades they rest on.',
  }),
  'phone-open': Object.freeze({
    title: 'Reviews that write themselves',
    body: `Open More notebook actions (the three dots). ${WHAT}`,
  }),
  'phone-open-reviews': Object.freeze({
    title: 'Open Draft a review',
    body: "Choose Draft a review: today's recap, this week's review and this month's review are inside.",
  }),
})
