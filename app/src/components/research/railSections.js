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

export const SECTIONS = [
  { id: 'setup', label: 'Setup', icon: 'chart' },
  { id: 'history', label: 'Earnings History', icon: 'clock' },
  { id: 'brief', label: 'Brief', icon: 'document' },
  { id: 'call', label: 'Call', icon: 'chat' },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

export function normalizeSection(id) {
  return SECTION_IDS.includes(id) ? id : DEFAULT_SECTION
}

// UIcon registry note: there is no `users` glyph — `user` is the correct name.
export function railLinks(sym) {
  const s = encodeURIComponent((sym || '').toUpperCase())
  return [
    { id: 'analyst', label: 'Analyst & Ownership', icon: 'user', href: `/research/${s}?section=ownership` },
    { id: 'filings', label: 'Filings', icon: 'document', href: `/research/${s}?section=filings` },
  ]
}
