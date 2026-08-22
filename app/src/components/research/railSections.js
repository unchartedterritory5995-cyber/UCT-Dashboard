// app/src/components/research/railSections.js
//
// §4.3: the LAUNCH modal is Banner + Setup + Earnings History + Brief + Call,
// with Analyst & Ownership and Filings as LINK items that deep-open the
// corresponding /research section. They are links, not tabs, on purpose: a
// 45-day-stale 13F adds little on print night, and duplicating those panels
// in-modal cannibalises the "Open full report" funnel. SectionRail keeps them
// in a sibling group so a screen reader is never told "tab 6 of 7" about
// something that navigates away.
export const DEFAULT_SECTION = 'setup'

// Owner preference (2026-08-09): the modal is the surface, not a doorway to
// one. Analyst & Ownership and Filings used to be `links` that CLOSED the modal
// and navigated to /research — a context switch in the middle of reading one
// company. They are ordinary sections now, so the whole report is reachable
// without ever leaving the pop-up.
export const SECTIONS = [
  { id: 'setup', label: 'Setup', icon: 'chart' },
  // Owner ask (2026-08-21): "what does the company do, market cap, this year's
  // story" belongs in the calendar too, not only on the /charts Profile widget.
  // It answers a question no other section did — the bar for a new entry.
  { id: 'profile', label: 'Profile', icon: 'info' },
  { id: 'history', label: 'Earnings History', icon: 'clock' },
  { id: 'brief', label: 'Brief', icon: 'document' },
  { id: 'call', label: 'Call', icon: 'chat' },
  { id: 'financials', label: 'Financials', icon: 'chart' },
  { id: 'analysts', label: 'Analysts', icon: 'user' },
  // Our generated catalysts (+ earnings reactions + curated wire) sit right
  // beside News on purpose: News is outside links; this is OUR read of what
  // actually moved the stock.
  { id: 'catalysts', label: 'Catalysts', icon: 'bolt' },
  { id: 'news', label: 'News', icon: 'document' },
  { id: 'filings', label: 'Filings', icon: 'document' },
  // Last on purpose (owner, 2026-08-10: "just under News and Filings"). It is the
  // only section that answers a question the reader brought rather than presenting
  // what we hold, so it reads as the follow-on to the report, not part of it.
  { id: 'ai', label: 'Ask AI', icon: 'sparkle' },
]

// Order is the reading order for an earnings event: the four original sections
// tell the story of THIS print, and the reference sections follow. Appending
// rather than interleaving keeps existing muscle memory intact.

export const SECTION_IDS = SECTIONS.map((s) => s.id)

export function normalizeSection(id) {
  const mapped = MERGED[id] || id
  return SECTION_IDS.includes(mapped) ? mapped : DEFAULT_SECTION
}

// UIcon registry note: there is no `users` glyph — `user` is the correct name.
//
// Kept as an empty list rather than deleted: SectionRail still accepts `links`
// for the sibling group, and a caller that wants an out-of-modal destination
// later should not have to re-derive the shape. Nothing navigates away today.
export function railLinks() {
  return []
}


// Old section ids, kept resolvable. Eleven sections collapsed into six, and a
// bookmark or a shared `?section=statements` link should land where the reader
// meant rather than silently falling back to Setup.
const MERGED = {
  fundamentals: 'financials',
  statements: 'financials',
  estimates: 'analysts',
  ratings: 'analysts',
  analyst: 'analysts',
  ownership: 'analysts',
}

export function resolveSectionId(id) {
  return MERGED[id] || id
}
