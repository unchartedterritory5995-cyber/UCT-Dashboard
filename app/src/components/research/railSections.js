// app/src/components/research/railSections.js
//
// The modal's navigation model. TWO levels, ONE piece of state.
//
// ⭐ THE STATE IS STILL THE LEAF ID. `section` is, and always was, one of
// SECTION_IDS ('setup' | 'profile' | 'history' | …), and that has not changed.
// The GROUP is DERIVED from the leaf (`groupOf`), never stored beside it —
// a second authority over one value is how the two would drift apart, and it
// means every existing deep link, bookmark and `?section=` query keeps landing
// exactly where it did before this file grew a second level.
//
// WHY GROUPS. This rail reached TWELVE items. The history is written in the
// commits: eleven sections were collapsed into six (2026-08-09), then four more
// were appended one at a time, each individually justified. At 12 the rail was
// 196px of a 960px modal — 20% of the surface spent on navigation, beside a
// canvas that is mostly dense numbers. Grouping returns that width to the
// canvas without retiring a single panel: every one of the twelve is still
// reachable, one level down.
export const DEFAULT_SECTION = 'setup'

// The LEAF sections — one per panel in EarningsResearchModal's PANELS map.
// Order is the reading order for an earnings event.
export const SECTIONS = [
  { id: 'setup', label: 'Setup', icon: 'chart' },
  { id: 'profile', label: 'Profile', icon: 'info' },
  { id: 'financials', label: 'Financials', icon: 'chart' },
  { id: 'history', label: 'Earnings History', icon: 'clock' },
  { id: 'brief', label: 'Brief', icon: 'document' },
  { id: 'call', label: 'Call', icon: 'chat' },
  // Label matches the chart pop-up's own Analyst+Ownership tab (owner ask,
  // 2026-08-28) — same question, same name everywhere it's asked.
  { id: 'analysts', label: 'The Street', icon: 'user' },
  // Our generated catalysts (+ earnings reactions + curated wire) sit beside
  // News on purpose: News is outside links; this is OUR read of what moved it.
  { id: 'catalysts', label: 'Catalysts', icon: 'bolt' },
  { id: 'news', label: 'News', icon: 'document' },
  { id: 'filings', label: 'Filings', icon: 'document' },
  // Last on purpose (owner, 2026-08-10). It is the only section that answers a
  // question the reader BROUGHT rather than presenting what we hold, so it
  // reads as the follow-on to the report rather than part of it.
  { id: 'ai', label: 'Ask AI', icon: 'sparkle' },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]))

/** The label a leaf id carries, for a sub-tab row or an aria string. */
export function sectionLabel(id) {
  return SECTION_BY_ID.get(id)?.label ?? ''
}

/**
 * The five TABS. `members` is the ordered leaf list behind each one; the FIRST
 * member is the group's landing panel.
 *
 * The grouping answers "what question is the reader asking?", not "what
 * endpoint does this come from":
 *   Setup     — is there a trade into this print?
 *   Company   — what is this business and how is it doing?
 *   The Print — what happened, and what will be said about it?
 *   Coverage  — what is everyone else saying?
 *   Ask AI    — whatever the reader brought.
 */
export const GROUPS = [
  { id: 'setup', label: 'Setup', icon: 'chart', members: ['setup'] },
  { id: 'company', label: 'Company', icon: 'info', members: ['profile', 'financials'] },
  { id: 'print', label: 'The Print', icon: 'clock', members: ['history', 'brief', 'call'] },
  { id: 'coverage', label: 'Coverage', icon: 'bolt', members: ['analysts', 'catalysts', 'news', 'filings'] },
  { id: 'ai', label: 'Ask AI', icon: 'sparkle', members: ['ai'] },
]

export const GROUP_IDS = GROUPS.map((g) => g.id)

// Leaf -> group, built FROM `GROUPS` rather than typed a second time. A
// hand-written mirror of this map is precisely how a leaf ends up in no group
// (or two), which the coverage test below the fold asserts can't happen.
const GROUP_OF = new Map()
for (const g of GROUPS) for (const leaf of g.members) GROUP_OF.set(leaf, g.id)

/** Which tab is lit for a given leaf section. Falls back to the default group. */
export function groupOf(sectionId) {
  return GROUP_OF.get(sectionId) ?? GROUP_OF.get(DEFAULT_SECTION) ?? GROUP_IDS[0]
}

/** The leaf a tab lands on when clicked. */
export function defaultSectionFor(groupId) {
  const g = GROUPS.find((x) => x.id === groupId)
  return g?.members?.[0] ?? DEFAULT_SECTION
}

/**
 * The sub-tab row for a group, or an EMPTY array when the group is a single
 * panel. Empty — not a one-item row: a lone sub-tab under its own identical
 * group tab is chrome that says nothing, and it would make Setup and Ask AI
 * (the two most-used tabs) taller than the three that actually branch.
 */
export function subsectionsFor(groupId) {
  const g = GROUPS.find((x) => x.id === groupId)
  const members = g?.members ?? []
  return members.length > 1 ? members.map((id) => SECTION_BY_ID.get(id)).filter(Boolean) : []
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

export function normalizeSection(id) {
  const mapped = MERGED[id] || id
  return SECTION_IDS.includes(mapped) ? mapped : DEFAULT_SECTION
}

// Kept as an empty list rather than deleted: nothing navigates AWAY from this
// modal today (owner, 2026-08-09: "the modal is the surface, not a doorway to
// one"), but the shape is what a caller with an out-of-modal destination would
// need, and re-deriving it later is worse than an empty export now.
export function railLinks() {
  return []
}
