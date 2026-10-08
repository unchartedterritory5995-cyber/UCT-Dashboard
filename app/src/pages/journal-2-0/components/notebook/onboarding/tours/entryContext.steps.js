// Tour `entry-context` (W14-B2, plan 4.2 row 10): the market context frozen at the fill.
// Anchors live in EntryContextCard.jsx and WhyPrompt.jsx, the capability's own components
// (wave 13 lane 13E-2). The two "why" steps are on screen only before a reason is saved;
// once one is saved the engine skips them.
const CARD = 'components/EntryContextCard.jsx'
const WHY = 'components/WhyPrompt.jsx'
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('card', 'entry-context-card', CARD),
  step('fields', 'entry-context-fields', CARD),
  step('why', 'entry-context-why', WHY),
  step('save', 'entry-context-why-save', WHY),
])

export const COPY = Object.freeze({
  card: Object.freeze({
    title: 'Market context at the fill',
    body: 'When you enter a trade, the market backdrop is saved with it. Later you see what the market looked like then, not what you remember.',
  }),
  fields: Object.freeze({
    title: 'What was saved',
    body: 'Regime, exposure, the share of stocks above their 50-day, RS rank, days to earnings and the UCT scans that held the name. Anything that was not available says so.',
  }),
  why: Object.freeze({
    title: 'Why did you take it?',
    body: 'Write a line or two on your reason while it is fresh. It is optional.',
  }),
  save: Object.freeze({
    title: 'Saved with the trade',
    body: 'Your reason is kept with this entry and stays after the position closes, so a later review can read it next to the numbers.',
  }),
})
