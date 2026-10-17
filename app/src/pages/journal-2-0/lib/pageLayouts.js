// P4a -- the page-layout model. Pure functions over ONE preference blob, `journal_page_layout`:
// which panels the Journal's Today page (per market phase) and the trade page show, and in what
// order. No React and no network; every function takes a layout and returns a layout.
//
// The registry below is the ONLY place a panel id is named. The server checks the blob's shape and
// never its ids (R-P4-7), so an id a newer build writes is KEPT here, in place, and simply never
// resolved: a toggle or a move on another panel must not lose a member's hidden future panel.
//
// Nothing eager may import this module. Today and the trade page are lazy routes, and so is
// everything they pull in.

export const LAYOUT_PREF = 'journal_page_layout'

export const PHASES = Object.freeze(['premarket', 'market', 'postclose'])
export const PHASE_LABELS = Object.freeze({ premarket: 'Premarket', market: 'Market', postclose: 'After close' })

export const PANELS = Object.freeze({
  today: Object.freeze([
    { id: 'coachStrip', label: 'Coach notes', defaultShown: true },
    { id: 'weekStrip', label: 'This week', defaultShown: true },
    { id: 'goalProgress', label: 'Goal progress', defaultShown: true },
    { id: 'quickActions', label: 'Quick actions', defaultShown: true },
    { id: 'checklistToday', label: 'Checklist for today', defaultShown: false },
    { id: 'myRules', label: 'My rules', defaultShown: false },
    { id: 'regime', label: 'Market regime', defaultShown: false },
    { id: 'todayNote', label: "Today's note", defaultShown: false },
    { id: 'notices', label: 'Notices', defaultShown: false },
  ]),
  trade: Object.freeze([
    { id: 'linkedNotes', label: 'Linked notes', defaultShown: true },
    { id: 'entryContext', label: 'Market at entry', defaultShown: true },
    { id: 'planGrade', label: 'Plan vs execution', defaultShown: true },
    { id: 'outcome', label: 'Outcome', defaultShown: true },
    { id: 'chart', label: 'Chart', defaultShown: true },
    { id: 'beforeAfter', label: 'Before and after', defaultShown: true },
    { id: 'story', label: 'The story', defaultShown: true },
    { id: 'executions', label: 'Executions', defaultShown: true },
    { id: 'review', label: 'Compass review', defaultShown: true },
  ]),
})

// The bounds the server validator enforces (`_validate_page_layout` in api/routers/auth.py).
// tests/test_page_layout_preference.py READS these three constants from this file, so the two sides
// cannot drift: a layout this model writes is never a 400. Keep each declaration a plain integer
// literal -- that test reads the source text.
export const LAYOUT_VERSION = 1
export const LAYOUT_MAX_ENTRIES = 40
export const LAYOUT_MAX_ID_LENGTH = 40
export const LAYOUT_MAX_BYTES = 16384

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const defaultList = (page) => PANELS[page].map((p) => ({ id: p.id, shown: p.defaultShown }))

const buildDefault = () => ({
  version: LAYOUT_VERSION,
  today: Object.fromEntries(PHASES.map((phase) => [phase, defaultList('today')])),
  trade: defaultList('trade'),
})

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    Object.values(v).forEach(deepFreeze)
  }
  return v
}

export const DEFAULT_LAYOUT = deepFreeze(buildDefault())

const validEntry = (e) =>
  isObject(e) && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= LAYOUT_MAX_ID_LENGTH
  && typeof e.shown === 'boolean'

// One saved list -> a full list. Not an array: the default. Otherwise keep the valid entries
// (unknown ids included), the first occurrence of each id, and append any registry id the saved list
// lacks at the END with its defaultShown -- so a panel a later release adds appears hidden and last.
function normalizeList(page, saved) {
  if (!Array.isArray(saved)) return defaultList(page)
  const seen = new Set()
  const out = []
  for (const e of saved) {
    if (!validEntry(e) || seen.has(e.id)) continue
    seen.add(e.id)
    out.push({ id: e.id, shown: e.shown })
  }
  for (const p of PANELS[page]) {
    if (!seen.has(p.id)) out.push({ id: p.id, shown: p.defaultShown })
  }
  return out
}

// Never throws; always returns a full, fresh layout (never the shared DEFAULT_LAYOUT object).
export function normalizeLayout(raw) {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return buildDefault() }
  }
  if (!isObject(value) || value.version !== LAYOUT_VERSION) return buildDefault()
  const today = isObject(value.today) ? value.today : {}
  return {
    version: LAYOUT_VERSION,
    today: Object.fromEntries(PHASES.map((phase) => [phase, normalizeList('today', today[phase])])),
    trade: normalizeList('trade', value.trade),
  }
}

const knownPage = (page) => page === 'today' || page === 'trade'

// The list a (page, phase) names inside a normalized layout, or null when it names nothing.
// For `trade`, the phase is ignored.
function listOf(layout, page, phase) {
  if (page === 'trade') return layout.trade
  if (page === 'today' && PHASES.includes(phase)) return layout.today[phase]
  return null
}

// Replace that list, leaving every other list as it was.
function withList(layout, page, phase, list) {
  if (page === 'trade') return { ...layout, trade: list }
  return { ...layout, today: { ...layout.today, [phase]: list } }
}

// The registry panels of one page and phase, in the member's order, unknown ids dropped.
export function resolvePanels(layout, page, phase) {
  if (!knownPage(page)) return []
  const list = listOf(normalizeLayout(layout), page, phase)
  if (!list) return []
  const labels = new Map(PANELS[page].map((p) => [p.id, p.label]))
  return list.filter((e) => labels.has(e.id)).map((e) => ({ id: e.id, shown: e.shown, label: labels.get(e.id) }))
}

export function togglePanel(layout, page, phase, id) {
  const base = normalizeLayout(layout)
  const list = knownPage(page) ? listOf(base, page, phase) : null
  if (!list || !list.some((e) => e.id === id)) return base
  return withList(base, page, phase, list.map((e) => (e.id === id ? { id: e.id, shown: !e.shown } : e)))
}

// Move a panel past its neighbouring PANEL, up or down. The two registry entries trade slots; every
// entry that is not in the registry (a panel a newer build wrote) stays at the index it had, so a
// move can never reorder a member's hidden future panels. The first panel moving up and the last
// moving down are no-ops, not errors.
export function movePanel(layout, page, phase, id, dir) {
  const base = normalizeLayout(layout)
  const list = knownPage(page) ? listOf(base, page, phase) : null
  if (!list || (dir !== 'up' && dir !== 'down')) return base
  const known = new Set(PANELS[page].map((p) => p.id))
  const slots = []
  list.forEach((e, i) => { if (known.has(e.id)) slots.push(i) })
  const at = slots.findIndex((i) => list[i].id === id)
  const to = dir === 'up' ? at - 1 : at + 1
  if (at < 0 || to < 0 || to >= slots.length) return base
  const next = list.slice()
  next[slots[at]] = list[slots[to]]
  next[slots[to]] = list[slots[at]]
  return withList(base, page, phase, next)
}

// That page and phase back to the registry default. Other pages and phases are untouched.
export function resetPage(layout, page, phase) {
  const base = normalizeLayout(layout)
  if (!knownPage(page) || !listOf(base, page, phase)) return base
  return withList(base, page, phase, defaultList(page))
}
