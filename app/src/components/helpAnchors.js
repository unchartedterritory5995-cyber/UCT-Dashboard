// S14 (audit 2026-11-05): where Help lives on the Support page. ONE authority for each anchor, read by the page
// that owns it (pages/Support.jsx), the one Help menu (FeedbackWidget.jsx), the Learn menu's "All walkthroughs in
// Help" (learnMenuCopy.js) and every in-feature "?" (HelpAnswerLink.jsx). Tiny and eager on purpose: the Help menu
// is on every page.
export const SUPPORT_PATH = '/support'
export const WALKTHROUGHS_ID = 'walkthroughs'
export const QUICK_ANSWERS_ID = 'quick-answers'
export const HELP_SEARCH_ID = 'help-search'
/** One Quick Answer's own anchor: `answer-<faq id>`. Arriving with it opens that answer. */
export const ANSWER_PREFIX = 'answer-'

export const HELP_WALKTHROUGHS_HREF = `${SUPPORT_PATH}#${WALKTHROUGHS_ID}`
export const QUICK_ANSWERS_HREF = `${SUPPORT_PATH}#${QUICK_ANSWERS_ID}`
export const HELP_SEARCH_HREF = `${SUPPORT_PATH}#${HELP_SEARCH_ID}`
// Tier 2 fix round 1 (review Important 3): the new-ticket form (Support.jsx reads `?view=new`).
export const NEW_TICKET_HREF = `${SUPPORT_PATH}?view=new`
export const answerHref = (faqId) => `${SUPPORT_PATH}#${ANSWER_PREFIX}${faqId}`
