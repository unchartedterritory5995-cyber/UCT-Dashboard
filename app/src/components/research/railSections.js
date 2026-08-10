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
  { id: 'history', label: 'Earnings History', icon: 'clock' },
  { id: 'brief', label: 'Brief', icon: 'document' },
  { id: 'call', label: 'Call', icon: 'chat' },
  { id: 'analyst', label: 'Analyst & Ownership', icon: 'user' },
  { id: 'filings', label: 'Filings', icon: 'document' },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

export function normalizeSection(id) {
  return SECTION_IDS.includes(id) ? id : DEFAULT_SECTION
}

// UIcon registry note: there is no `users` glyph — `user` is the correct name.
//
// Kept as an empty list rather than deleted: SectionRail still accepts `links`
// for the sibling group, and a caller that wants an out-of-modal destination
// later should not have to re-derive the shape. Nothing navigates away today.
export function railLinks() {
  return []
}
