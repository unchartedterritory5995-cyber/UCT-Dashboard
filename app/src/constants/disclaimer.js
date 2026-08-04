// §12 trust posture. ONE source for the standing disclaimer and for every
// research-kit `info` prop, so the ⓘ on a chip and the footer line can never
// drift from the page that documents them.
//
// LANGUAGE RULE (§12): the word "verdict" never appears in user-facing copy.
// `VerdictChip` is an internal component name only.

export const NOT_ADVICE = 'For informational purposes only - not investment advice.'
export const METHODOLOGY_PATH = '/methodology'

export const SETUP_GRADE_INFO = {
  text: 'Earnings Setup Grade - this report only. Weighted from beat streak, 30-day estimate revisions, relative strength and how the options premium compares with the typical move.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed ->',
}

export const UCT_RATING_INFO = {
  text: 'UCT Rating - the stock, not this report. See the Setup Grade for tonight\'s event.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed ->',
}

export const IMPLIED_MOVE_INFO = {
  text: 'Implied move from the at-the-money straddle on the first expiry on or after the report date. Realized moves are close-to-close over the same span.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed →',
}
