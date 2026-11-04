// ── NOT DONE (W2 audit, live 2026-11-04) ─────────────────────────────────────────────────────────────
//
// "Change the SPY chart to weekly and email me a screenshot of it." applied the weekly change and said nothing about
// the email: a partial result read as a complete one. A request that mixes what UCT Agent can do with what it can't
// does the part it can AND says plainly, in a FIXED sentence (never model prose — F-16 / F-23), which part it did not do
// and why. Two signals, either is enough:
//   1. the member's own words (deterministic: emailing / texting / trading / printing / exporting), and
//   2. the server's `unsupported_category` on a plan that also carries ops (the model's one-word area, sanitized).
// A part a planned action DOES cover (the email digest) is never reported as not done. Pure.

const PARTS = [
  {
    id: 'email',
    // "email me a screenshot", "send it to my email", "e-mail this chart" — not "my email digest" (a real setting)
    test: (t) => /\b(?:e-?mail|mail) (?:me|it|this|that|them|a |an |the |my |over|out)\b|\bsend (?:it|this|that|them|me)?\s*(?:\w+ )?(?:to|by|via|over) (?:my )?e-?mail\b|\bto my (?:e-?mail|inbox)\b/i.test(t),
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
    test: (t) => /\bprint (?:it|this|that|them|out|me|a copy|the|my)\b|\bprint(?:ed)? (?:it )?out\b/i.test(t),
    coveredBy: [],
    text: 'Not done: I can’t print — use your browser’s Print (Ctrl+P or ⌘P).',
  },
  {
    id: 'export',
    test: (t) => /\bexport\b[^.?!]*\b(?:excel|xlsx|csv|spreadsheet|sheets?|file|pdf)\b|\b(?:to|into|in) (?:an? )?(?:excel|spreadsheet|google sheets?|csv|xlsx)(?: file| sheet)?\b|\bdownload\b[^.?!]*\b(?:excel|csv|spreadsheet|pdf)\b/i.test(t),
    coveredBy: [],
    text: 'Not done: I can’t export to Excel or other files from UCT Agent.',
  },
]

// the server's one-word area (turn.py keeps it only beside ops) → the same fixed sentences; anything else → a generic one
const CATEGORY = { email: 'email', mail: 'email', sms: 'sms', text: 'sms', texting: 'sms', trading: 'trading', trade: 'trading', trades: 'trading',
  orders: 'trading', order: 'trading', broker: 'trading', print: 'print', printing: 'print', export: 'export', exporting: 'export', files: 'export' }
export const GENERIC_NOT_DONE = 'Not done: part of your request isn’t something UCT Agent can do, so I didn’t do that part.'

/** The fixed "Not done: …" sentences for the parts of `text` no planned action covers (in a stable order). */
export function notDoneLines(text, { category = null, actions = [] } = {}) {
  const raw = String(text || '')
  const planned = new Set(actions || [])
  const out = []
  for (const p of PARTS) {
    if (p.coveredBy.some(a => planned.has(a))) continue
    if (p.test(raw)) out.push(p)
  }
  const cat = typeof category === 'string' ? category.trim().toLowerCase() : ''
  if (cat) {
    const id = CATEGORY[cat]
    const p = id ? PARTS.find(x => x.id === id) : null
    if (p && !out.includes(p) && !p.coveredBy.some(a => planned.has(a))) out.push(p)
    if (!p && !out.length) return [GENERIC_NOT_DONE]
  }
  return out.map(p => p.text)
}
