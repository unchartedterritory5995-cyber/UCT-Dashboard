// The RS screens in the Focus layout (unit U5, 2026-11-14): everything the client derives from
// a starter's optional `controls`, `row` and `empty` (the server-to-client contract,
// CONTRACT-SCREENS.md). Pure functions only. A starter that carries none of the three gets
// nothing from this file, and its screen is today's.
//
// ⛔ NOTHING HERE HOLDS STATE. A control's active option is read from the working spec every
// time (never remembered beside it), so the Filters count, the chips, the "(edited)" mark and
// the quick controls cannot disagree: they are four readings of one spec.

// At most three quick controls per screen (plan v2, section 4).
export const MAX_CONTROLS = 3
// The two member preferences this feature writes (both in `_PREFERENCE_KEYS`, api/routers/auth.py).
export const RS_CONTROLS_PREF = 'screener_rs_controls'

const POOL_KEYS = ['universe', 'list']
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

// What a starter adds to its screen, or null when it adds nothing.
export const controlsOf = starter => (Array.isArray(starter?.controls) ? starter.controls.filter(c => c && Array.isArray(c.keys) && Array.isArray(c.options)).slice(0, MAX_CONTROLS) : [])
export const defaultOption = control => (control?.options || []).find(o => o?.default) || null

// A clause as compared: its operator and operands, never its key, label or any other dressing
// (the same fields FocusScreener's normalSpec keeps).
const sig = c => (c ? JSON.stringify([c.op ?? null, c.min ?? null, c.max ?? null, c.value ?? null, c.values ?? null]) : 'none')
const optionClause = (option, key) => (option?.filters || []).find(f => f?.key === key) || null
const thenSig = t => (t?.key ? `${t.key}:${t.dir === 'asc' ? 'asc' : 'desc'}` : '')
export const sameSort = (a, b) => !!a && !!b && a.key === b.key && (a.dir === 'asc') === (b.dir === 'asc') && thenSig(a.then) === thenSig(b.then)

// Does the working spec carry exactly this option's clauses on the control's keys?
// `filters` is the working spec's KEYED filters ({ key: { op, ... } }, useScreenSpec's shape).
const filtersMatch = (control, option, filters) => control.keys.every(k => sig(optionClause(option, k)) === sig(filters?.[k] || null))

// Contract, "Control semantics": the ACTIVE option is the one whose `filters` equal the working
// spec's clauses on the control's keys, and whose `sort`, when it has one, equals the spec's.
// None equal: null, shown as "Custom". A ranked screen is ordered by its rank, not its sort, so
// an option's sort is not asked of it.
export function activeOption(control, { filters, sort, rank = null } = {}) {
  return (control?.options || []).find(o => filtersMatch(control, o, filters) && (!o.sort || !!rank || sameSort(o.sort, sort))) || null
}

// CHANGED: the active option is not the default (a Custom reading is changed too).
export function isChanged(control, spec) {
  return (activeOption(control, spec)?.id ?? null) !== (defaultOption(control)?.id ?? null)
}

// Choosing an option, through the SAME editor the Filters drawer uses (`ed.setFilter`,
// `ed.setSort`): every clause on the control's keys is replaced by the option's (possibly none),
// and the sort is set when the option carries one.
export function applyOption(ed, control, option) {
  for (const key of control.keys) {
    const c = optionClause(option, key)
    if (!c) { ed.setFilter(key, null); continue }
    const { key: _key, ...clause } = c
    ed.setFilter(key, clause)
  }
  if (option.sort) ed.setSort({ ...option.sort, ...(option.sort.then ? { then: { ...option.sort.then } } : {}) })
}

// The same choice made on a whole spec (a starter's, with its filter LIST), for a screen that
// is being opened: one applySpec instead of an open followed by edits.
export function specWithOption(spec, control, option) {
  const keep = (spec?.filters || []).filter(f => f && !control.keys.includes(f.key))
  const add = control.keys.map(k => optionClause(option, k)).filter(Boolean).map(c => ({ ...c }))
  return { ...spec, filters: [...keep, ...add], ...(option.sort ? { sort: { ...option.sort } } : {}) }
}

// A member's remembered choices for one starter ({ controlId: optionId }) laid over its spec.
// An id the starter no longer offers is skipped, so a retired option never breaks the open.
export function specWithChoices(spec, starter, choices) {
  if (!isObj(choices)) return spec
  let out = spec
  for (const control of controlsOf(starter)) {
    const option = control.options.find(o => o && o.id === choices[control.id])
    if (option) out = specWithOption(out, control, option)
  }
  return out
}

// The remembered choices of one starter, from the stored preference value (parsed), or null.
export function choicesFor(stored, starterId) {
  const mine = isObj(stored) ? stored[String(starterId)] : null
  return isObj(mine) ? mine : null
}
// The preference with one choice recorded. Returns a NEW map; never mutates what it was given.
export function withChoice(stored, starterId, controlId, optionId) {
  const all = isObj(stored) ? stored : {}
  return { ...all, [String(starterId)]: { ...(isObj(all[String(starterId)]) ? all[String(starterId)] : {}), [controlId]: optionId } }
}
// The preference with one starter's choices forgotten (Reset); `undefined` when there was
// nothing to forget, so the caller writes nothing.
export function withoutChoices(stored, starterId) {
  if (!isObj(stored) || !(String(starterId) in stored)) return undefined
  const { [String(starterId)]: _gone, ...rest } = stored
  return rest
}

// The part of a screen its quick controls cannot touch: its criteria minus the pool and minus
// every control key, with its logic and rank.
function frame(spec, keys) {
  const f = (spec?.filters || []).filter(x => x && !POOL_KEYS.includes(x.key) && !keys.includes(x.key))
    .map(x => [x.key, sig(x)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return JSON.stringify({ f, logic: spec?.logic || null, rank: spec?.rank || null })
}

// The starter a working spec was made from BY ITS QUICK CONTROLS ALONE: the same frame, and
// every control reading a real option (by its filters). This is how a screen a member changed
// with a quick control keeps its name and its controls across a refresh, Back from a full
// chart, or List to Table and back, where only the URL's spec survives. A screen edited any
// other way matches nothing here and is a custom screen, as before.
export function controlStarterFor(starters, spec) {
  const filters = Object.fromEntries((spec?.filters || []).filter(Boolean).map(({ key, ...rest }) => [key, rest]))
  for (const st of starters || []) {
    const controls = controlsOf(st)
    if (!controls.length || !st.spec) continue
    const keys = [...new Set(controls.flatMap(c => c.keys))]
    if (frame(st.spec, keys) !== frame(spec, keys)) continue
    if (controls.every(c => c.options.some(o => filtersMatch(c, o, filters)))) return st
  }
  return null
}
