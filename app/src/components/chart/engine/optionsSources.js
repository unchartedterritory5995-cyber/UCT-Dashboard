/**
 * ⭐ A LIST OF CHOICES THE SERVER OWNS, FOR A `string` INPUT (2026-11-12).
 *
 * An `enum` input's choices are declared by the definition and are the same on
 * every chart. Some lists are not: the UCT themes behind the RS indicators'
 * "Pick a theme" benchmark change when the owner edits the taxonomy. Such an
 * input is a `string` (what it STORES is a stable ID, so a rename never breaks a
 * saved chart) that declares `optionsSource: '<name>'`, a name from
 * {@link OPTIONS_SOURCES}. Every settings surface (the settings dialog, the
 * Chart Settings inspector, the phone sheet) renders it as one searchable
 * chooser (`OptionsSourcePicker`), and the server validates the stored value
 * again: a value the list no longer holds falls back there, with a note.
 *
 * ⛔ A NAME, NEVER A URL, IN A DEFINITION. A definition is data (members can
 * author them); the table below is code. `defSchema` refuses a name it does not
 * list, so a definition cannot point a chart at an arbitrary endpoint.
 *
 * The endpoint answers `{options: [{value, label}]}`. The list is fetched once
 * per page load, shared by every input and surface that names it, and kept
 * here so a label can be printed synchronously (`optionLabelFor`, read by the
 * pane label and the settings list through `defSchema.identityTextFor`).
 */

/** name → where the list lives and what one entry is called. */
export const OPTIONS_SOURCES = Object.freeze({
  rsThemes: Object.freeze({ url: '/api/signature/rs-themes', noun: 'theme', plural: 'themes' }),
})

export function isOptionsSource(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(OPTIONS_SOURCES, name)
}

/** name → { status: 'loading'|'ready'|'error', options, at, promise } */
const _state = new Map()
const _subs = new Map()

function notify(name) {
  for (const fn of (_subs.get(name) || [])) {
    try { fn() } catch { /* a subscriber never breaks the store */ }
  }
}

/** Clean one server answer: `[{value, label}]`, strings only, de-duplicated. */
export function cleanOptions(body) {
  const raw = body && Array.isArray(body.options) ? body.options : []
  const seen = new Set()
  const out = []
  for (const o of raw) {
    if (!o || typeof o.value !== 'string' || !o.value || seen.has(o.value)) continue
    seen.add(o.value)
    out.push({ value: o.value, label: typeof o.label === 'string' && o.label ? o.label : o.value })
  }
  return out
}

/** The current state of a source, `{status: 'idle'}` before anyone asked. */
export function peekOptionsSource(name) {
  return _state.get(name) || IDLE
}
const IDLE = Object.freeze({ status: 'idle', options: [] })

/**
 * ⛔ THE LOADER LIVES OUTSIDE THE ENGINE. This module is in the Pine runtime
 * closure (`defSchema` reads `optionLabelFor`), which admits no network call and
 * no wall clock (`tools/pine_runtime_closure.mjs`). The fetch and its timestamps
 * are `../optionsSourceLoader.js`'s; it records what it learns through this one
 * door, and every reader here sees it.
 */
export function _recordOptionsSource(name, st) {
  _state.set(name, st)
  notify(name)
}

/** `useSyncExternalStore`'s subscribe for one source. */
export function subscribeOptionsSource(name, fn) {
  if (!_subs.has(name)) _subs.set(name, new Set())
  _subs.get(name).add(fn)
  return () => { const s = _subs.get(name); if (s) s.delete(fn) }
}

/** The label of `value` in a LOADED source, or null (not loaded, or not listed). */
export function optionLabelFor(name, value) {
  const st = _state.get(name)
  if (!st || st.status !== 'ready' || typeof value !== 'string') return null
  const hit = st.options.find((o) => o.value === value)
  return hit ? hit.label : null
}

/** A stored ID read as words while its list is not loaded:
 *  `semiconductor_equipment` → `Semiconductor Equipment`. */
export function humanizeOptionValue(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  return value.trim().split(/[_\-\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * The options matching a typed query, best first: a label that STARTS with the
 * query, then a word in it that does, then one that contains it anywhere (the
 * ID is searched too). Case-blind; an empty query keeps the list's own order.
 */
export function filterOptions(options, query) {
  const list = Array.isArray(options) ? options : []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return list.slice()
  const ranked = []
  list.forEach((o, i) => {
    const label = String(o.label || '').toLowerCase()
    const value = String(o.value || '').toLowerCase()
    let rank = -1
    if (label.startsWith(q)) rank = 0
    else if (label.split(/[\s/&()\-]+/).some((w) => w.startsWith(q))) rank = 1
    else if (label.includes(q) || value.includes(q)) rank = 2
    if (rank >= 0) ranked.push([rank, i, o])
  })
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return ranked.map((r) => r[2])
}

/** Tests only: forget every loaded list and every subscriber. */
export function _resetOptionsSources() {
  _state.clear()
  _subs.clear()
}
