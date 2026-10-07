// The offer card's words and Help's "What's new" words (wave 14, lane W14-C2), in one
// place so the rails assert the rendered TEXT against the same source.
export const OFFER_COPY = Object.freeze({
  title: (tourTitle) => `New in your Notebook: ${tourTitle}`,
  body: 'A short walkthrough shows where it is and how to use it. You can always find it again under Help.',
  accept: 'Take the tour',
  later: 'Not now',
})

export const WHATS_NEW_COPY = Object.freeze({
  heading: "What's new",
  lead: "Switched on for you, and you haven't taken the tour yet.",
  start: 'Start',
})
