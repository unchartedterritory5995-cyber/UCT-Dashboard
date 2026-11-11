// ── NOT DONE (W2 audit, live 2026-11-04) ─────────────────────────────────────────────────────────────
//
// "Change the SPY chart to weekly and email me a screenshot of it." applied the weekly change and said nothing about
// the email: a partial result read as a complete one. A request that mixes what UCT Agent can do with what it can't
// does the part it can AND says plainly, in a FIXED sentence (never model prose — F-16 / F-23), which part it did not do
// and why — decided by the member's OWN words (emailing / texting / trading / printing / exporting), never by the model
// (review #771: its unsupported_category is kept server-side for telemetry, never a line here).
// A part a planned action DOES cover (the email digest) is never reported as not done. Pure.

const PARTS = [
  {
    id: 'email',
    // "email me a screenshot", "send it to my email", "e-mail this chart" — not "my email digest" (a real setting)
    // review #771 (4): an ALERT delivered by email is the alert's own channel, never "not done" ("send alerts to my email")
    test: (t) => !/\balerts?\b/i.test(t) && (/\b(?:e-?mail|mail) (?:me|it|this|that|them|a |an |the |my |over|out)\b|\bsend (?:it|this|that|them|me)?\s*(?:\w+ )?(?:to|by|via|over) (?:my )?e-?mail\b|\bto my (?:e-?mail|inbox)\b/i.test(t)),
    coveredBy: ['settings.setWatchlistDigest'],
    text: 'Not done: I can’t send email — UCT Agent can’t email screenshots, charts or anything else.',
  },
  {
    id: 'sms',
    test: (t) => /\b(?:sms|text messages?|txt)\b|\btext (?:me|it|this|that|my phone)\b|\b(?:by|via|over) text\b|\bsend (?:me )?a text\b/i.test(t),
    coveredBy: [],
    text: 'Not done: I can’t send text messages (SMS) — UCT alerts notify you inside UCT, not by text.',
  },
  {
    id: 'trading',
    test: (t) => /\b(?:place|put in|submit|execute|enter|make) (?:a |an |the |my )?(?:(?:market|limit|stop|buy|sell) )?(?:trade|order)s?\b|\b(?:buy|sell|short) \d[\d,]* (?:shares?|contracts?)\b/i.test(t)
      || /\b(?:[Bb]uy|[Ss]ell|[Ss]hort) (?:me |some )?(?:shares? of )?\$?[A-Z]{1,5}\b(?! point| signal| zone| setup| rating)/.test(t),
    coveredBy: [],
    text: 'Not done: I can’t place trades or orders — UCT doesn’t connect to a broker.',
  },
  {
    id: 'print',
    // review #771 (4): only printing the page / chart itself — never "print the 52-week high" or "dark pool prints"
    test: (t) => /\bprint (?:it|this|that|them)(?: out)?\b|\bprint(?:ed)? (?:it )?out\b|\bprint (?:me )?(?:a copy|a screenshot|the (?:chart|page|screen|layout|board)|my (?:chart|page|screen|layout|board))\b/i.test(t),
    coveredBy: [],
    text: 'Not done: I can’t print — use your browser’s Print (Ctrl+P or ⌘P).',
  },
  {
    id: 'export',
    test: (t) => /\bexport\b[^.?!]*\b(?:excel|xlsx|csv|spreadsheet|sheets?|file|pdf)\b|\b(?:to|into|in) (?:an? )?(?:excel|spreadsheet|google sheets?|csv|xlsx)(?: file| sheet)?\b|\bdownload\b[^.?!]*\b(?:excel|csv|spreadsheet|pdf)\b/i.test(t),
    // u18-export-04: a watchlist's own Export CSV / Excel (C3-095) covers it; a format that export lacks (PDF) is still not done
    coveredBy: ['watchlist.exportList'],
    still: /\bpdf\b/i,
    text: 'Not done: I can’t export to Excel or other files from UCT Agent.',
  },
]


/** The fixed "Not done: …" sentences for the parts of `text` no planned action covers (in a stable order).
 *  review #771 (4): the MEMBER'S OWN WORDS decide — a part is said only when its words are in the request. The model's
 *  `unsupported_category` never adds a line on its own (no generic line from a stray category); it is kept for telemetry. */
export function notDoneLines(text, { actions = [] } = {}) {
  const raw = String(text || '')
  const planned = new Set(actions || [])
  return PARTS.filter(p => (!p.coveredBy.some(a => planned.has(a)) || p.still?.test(raw)) && p.test(raw)).map(p => p.text)
}
