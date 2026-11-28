// FEED: the SEC filings feed's pure half. `NVDA FEED` = one company; bare `FEED` = the whole market;
// `FEED 8-K`, `FEED DILUTION`, `NVDA FEED 10-K` = one form (or the dilution group) of either.
//
// The panel is the Research tab (pages/research/tabs/FilingsFeedTab.jsx); this module holds what the
// command line, the tab and the Agent share: the form chips, the words a member types for each, the
// parser, what a chip writes back into the command, and the plain name of a dilution form.
//
// Reads (api/routers/research_cov.py over api/services/filings_feed.py; FILINGS_FEED_ENABLED, 404 off;
// paid, 402 otherwise; cache only, `pending` until the first poll):
//   GET /api/research/filings-feed?form=...        the market feed (EDGAR's latest-filings feed, polled)
//   GET /api/research/filings-feed/{SYM}?form=...  one company (its EDGAR submissions list + newer feed rows)
// `form` is one of the server's FEED_FORMS, or the group name DILUTION (filings_feed.FORM_GROUPS).

export const FEED_CODE = 'FEED'
export const FEED_MARKET_URL = '/api/research/filings-feed'
export const feedTickerUrl = (sym) => `${FEED_MARKET_URL}/${encodeURIComponent(String(sym || '').toUpperCase().trim())}`

/** The forms a dilution read covers: a copy of api/services/filings_feed.py DILUTION_FORMS (pinned by
 *  tests/test_filings_feed_dilution.py, which parses this file). */
export const DILUTION_FORMS = Object.freeze(['S-1', 'S-3', 'S-3ASR', '424B1', '424B2', '424B3', '424B4', '424B5', '424B7', 'S-8'])
export const DILUTION = 'DILUTION'

/**
 * The form chips, in the order the tab draws them. `value` is what the server's `form` takes (null =
 * every form), `label` the chip's words, `token` the ONE word the chip writes back into the command.
 */
export const FEED_FORMS = Object.freeze([
  Object.freeze({ value: null, label: 'All', token: null }),
  Object.freeze({ value: '8-K', label: '8-K', token: '8-K' }),
  Object.freeze({ value: '10-Q', label: '10-Q', token: '10-Q' }),
  Object.freeze({ value: '10-K', label: '10-K', token: '10-K' }),
  Object.freeze({ value: '4', label: 'Form 4', token: 'FORM4' }),
  Object.freeze({ value: 'SCHEDULE 13D', label: '13D', token: '13D' }),
  Object.freeze({ value: 'SCHEDULE 13G', label: '13G', token: '13G' }),
  Object.freeze({ value: 'S-1', label: 'S-1', token: 'S-1' }),
  Object.freeze({ value: DILUTION, label: 'Dilution', token: DILUTION,
    title: 'Share offerings: S-1 and S-3 registrations, 424B prospectuses, S-8 employee stock plans' }),
])

/** The words a member types for each form (upper case: the shell upper-cases typed tokens). */
export const FEED_FORM_ARG_WORDS = Object.freeze({
  '8-K': '8-K', '8K': '8-K',
  '10-Q': '10-Q', '10Q': '10-Q',
  '10-K': '10-K', '10K': '10-K',
  4: '4', FORM4: '4', F4: '4',
  '13D': 'SCHEDULE 13D', SC13D: 'SCHEDULE 13D',
  '13G': 'SCHEDULE 13G', SC13G: 'SCHEDULE 13G',
  'S-1': 'S-1', S1: 'S-1',
  DILUTION: DILUTION, OFFERING: DILUTION, OFFERINGS: DILUTION, SHELF: DILUTION, SHELFS: DILUTION, SHELVES: DILUTION,
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)

/** A typed word to the form the server takes, or null when it names none. */
export const parseFeedForm = (token) => own(FEED_FORM_ARG_WORDS, String(token ?? '').trim().toUpperCase())

/** A prop (a server form, a typed word, or nothing) to one of the chip values; null = every form. */
export function normFeedForm(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toUpperCase()
  return FEED_FORMS.some((f) => f.value === s) ? s : parseFeedForm(s)
}

/** The chip a value draws as (the `All` chip for null or anything unknown). */
export const feedFormChip = (value) => FEED_FORMS.find((f) => f.value === normFeedForm(value)) || FEED_FORMS[0]

/** `?form=...` for a read, or '' for every form. */
export const feedFormQuery = (value) => {
  const v = normFeedForm(value)
  return v ? `?form=${encodeURIComponent(v)}` : ''
}

/** What a chip pick writes back after the code: the form's token, then MINE when the feed is the member's names. */
export function feedCommandArgs({ form = null, mine = false } = {}) {
  const chip = feedFormChip(form)
  return [...(chip.token ? [chip.token] : []), ...(mine ? ['MINE'] : [])]
}

/** The form's name in an empty or a heading sentence ("8-K filing", "Form 4 filing"). */
export function feedFormNoun(value) {
  const v = normFeedForm(value)
  if (!v) return 'filing in the forms this feed covers'
  if (v === DILUTION) return 'share-offering filing (S-1, S-3, 424B or S-8)'
  return `${v === '4' ? 'Form 4' : v.replace('SCHEDULE ', 'Schedule ')} filing`
}

const DILUTION_WORDS = Object.freeze({
  'S-1': 'Registration (a listing or an offering)',
  'S-3': 'Shelf registration (shares it may sell later)',
  'S-3ASR': 'Shelf registration, effective at once (shares it may sell later)',
  'S-8': 'Shares for an employee stock plan',
})

/** A dilution form's plain words for the Details cell, or null for any other form. Amendments keep their base form's words. */
export function dilutionWords(form) {
  const f = String(form || '').trim().toUpperCase()
  const base = f.endsWith('/A') ? f.slice(0, -2) : f
  if (/^424B[1-57]$/.test(base)) return 'Prospectus (shares being sold now)'
  const words = own(DILUTION_WORDS, base)
  return words && base !== f ? `${words}, amended` : words
}
