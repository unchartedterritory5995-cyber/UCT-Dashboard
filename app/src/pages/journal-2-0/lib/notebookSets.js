// Notebook widgets Task 17 (wave 5, "make it yours"): saved chart sets (C16) and saved widget presets (C17).
//
// ⛔ NOT ON THE FIRST OPEN. Only lazy code imports this file statically (SetsDialog, SnapshotFrame); the / menu
// loads it with a dynamic import, and only while wave 5 is on. An eager import here puts every byte below back
// on the Notebook's first open.
//
// Both live in ONE preference, `notebook_chart_sets`, as the JSON string
//   {"v":1,"sets":[{id,name,charts:[{symbol,tf}]}],"presets":[{id,name,kind,params}]}
// `POST /api/auth/preferences` REPLACES the whole value, so every save reads the current value, changes its
// own key and writes BOTH keys back (saveSets). A save whose read fails writes nothing: writing onto an
// unreadable value would wipe the other key.
//
// A chart set is N ordinary chart embeds (chartInsertNodes), never a new node kind. A preset stores SETTINGS
// only, never data; inserting one runs the normal fetch-and-freeze (Ruling R4).
import { chartInsertNodes } from './widgetEmbedCore'
import { WIDGET_KINDS } from './notebookWidgets'
import { widgetsWaveOn } from './notebookWidgetsFlags'
import { PREFS_URL, mergeIntoPreferenceCache } from '../../../hooks/usePreferences'

export const CHART_SETS_PREF = 'notebook_chart_sets'
export const MAX_SETS = 30
export const MAX_CHARTS_PER_SET = 12
export const MAX_PRESETS = 50
export const NAME_MAX = 60

/** The request keys a snapshot kind's builder reads (api/routers/notebook_widgets.py PASS_PARAMS). A preset
 *  keeps these and nothing else; `share` is forced off (a preset never publishes an account widget). */
export const SETTINGS_KEYS = Object.freeze(['symbol', 'list', 'from', 'to', 'month', 'definitionId', 'tradeId'])

/** The timeframes a set's chart can take, in the order the dialog offers them. */
export const SET_TFS = Object.freeze(['D', 'W', '60', '30', '15', '5', '1'])

const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/
const SNAPSHOT_IDS = new Set(WIDGET_KINDS.map((k) => k.id))
const LIST_FROM_LABEL = { Watchlist: 'watchlist', Flagged: 'flagged' }
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '')

export const EMPTY_DOC = Object.freeze({ v: 1, sets: [], presets: [] })

/** A fresh id for a set or a preset. */
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function readChart(c) {
  if (!isRecord(c) || typeof c.symbol !== 'string' || !SYMBOL_RE.test(c.symbol)) return null
  const tf = SET_TFS.includes(String(c.tf)) ? String(c.tf) : 'D'
  return { symbol: c.symbol.toUpperCase(), tf }
}

/** The settings a preset inserts with: the builder's request keys and nothing else, `share` off.
 *  `list` is recovered from the payload's `listLabel` (which list is a setting). A date range is NOT
 *  recovered from the payload's `range`: when no range was asked for, those dates were the default
 *  of the day it ran, and a preset made from them would freeze one week forever. */
export function presetParams(preset) {
  const p = isRecord(preset?.params) ? preset.params : {}
  const out = {}
  for (const k of SETTINGS_KEYS) {
    if (typeof p[k] === 'string' && p[k]) out[k] = p[k]
  }
  // R60: only the map's own labels (a stored "__proto__" never reaches Object.prototype).
  if (!out.list && typeof p.listLabel === 'string' && Object.hasOwn(LIST_FROM_LABEL, p.listLabel)) out.list = LIST_FROM_LABEL[p.listLabel]
  out.share = false
  return out
}

/** The stored value, read. Never throws: garbled input (bad JSON, wrong shapes) gives empty lists, and a
 *  bad entry is dropped while the good ones stay. */
export function readSets(raw) {
  let doc = raw
  if (typeof raw === 'string') {
    try { doc = JSON.parse(raw) } catch { doc = null }
  }
  if (!isRecord(doc)) return { v: 1, sets: [], presets: [] }
  const sets = (Array.isArray(doc.sets) ? doc.sets : []).flatMap((s) => {
    if (!isRecord(s) || !cleanName(s.name) || typeof s.id !== 'string') return []
    const charts = (Array.isArray(s.charts) ? s.charts : []).map(readChart).filter(Boolean).slice(0, MAX_CHARTS_PER_SET)
    return charts.length ? [{ id: s.id, name: cleanName(s.name), charts }] : []
  }).slice(0, MAX_SETS)
  const presets = (Array.isArray(doc.presets) ? doc.presets : []).flatMap((p) => {
    if (!isRecord(p) || !cleanName(p.name) || typeof p.id !== 'string' || !SNAPSHOT_IDS.has(p.kind)) return []
    return [{ id: p.id, name: cleanName(p.name), kind: p.kind, params: presetParams(p) }]
  }).slice(0, MAX_PRESETS)
  return { v: 1, sets, presets }
}

/** Why a set cannot be saved, in the member's words; null when it can. */
export function setRefusal(set) {
  if (!cleanName(set?.name)) return 'Give the set a name.'
  const charts = Array.isArray(set?.charts) ? set.charts : []
  if (!charts.length) return 'Add at least one chart to the set.'
  if (charts.length > MAX_CHARTS_PER_SET) {
    return `A chart set holds up to ${MAX_CHARTS_PER_SET} charts. This one has ${charts.length}.`
  }
  const bad = charts.find((c) => !readChart(c))
  if (bad) return `${String(bad?.symbol || '').trim() || 'A blank row'} is not a symbol.`
  return null
}

/** Why the whole value cannot be saved; null when it can. */
export function docRefusal({ sets = [], presets = [] }) {
  if (sets.length > MAX_SETS) return `You can keep up to ${MAX_SETS} chart sets.`
  if (presets.length > MAX_PRESETS) return `You can keep up to ${MAX_PRESETS} presets.`
  for (const s of sets) {
    const why = setRefusal(s)
    if (why) return `${cleanName(s?.name) || 'A set'}: ${why}`
  }
  const names = sets.map((s) => cleanName(s.name).toLowerCase())
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) return 'Two sets have the same name. Give each one its own.'
  return null
}

/** N ordinary chart embeds, one per chart, in the set's order (ONE builder: chartInsertNodes). */
export function chartSetNodes(set, settings) {
  const charts = Array.isArray(set?.charts) ? set.charts.map(readChart).filter(Boolean) : []
  return charts.flatMap((c) => chartInsertNodes('chart', { symbol: c.symbol, tf: c.tf }, settings))
}

// ── Reading and saving ───────────────────────────────────────────────────────

const READ_TIMEOUT_MS = 8000
let _cached = null   // the last value read or saved in this tab
// R60 (privacy audit M-5): the member that value belongs to. A different member on the same browser starts from
// nothing, and a read or a save another member started never lands in this member's cache.
let _uid

async function readRaw() {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), READ_TIMEOUT_MS) : null
  try {
    const res = await fetch(PREFS_URL, { credentials: 'include', ...(ctl ? { signal: ctl.signal } : {}) })
    if (!res || !res.ok) return { ok: false }
    const data = await res.json()
    return { ok: true, raw: isRecord(data) ? data[CHART_SETS_PREF] ?? null : null }
  } catch {
    return { ok: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The member's sets and presets. Cached for the tab after the first read (a save updates it), keyed by the member
 *  (`uid`; omitted, the member already held). A failed read answers the empty value and caches nothing, so the next
 *  menu open asks again. */
export async function loadSets({ fresh = false, uid = _uid } = {}) {
  if (uid !== _uid) { _cached = null; _uid = uid }
  if (_cached && !fresh) return _cached
  const r = await readRaw()
  if (!r.ok) return { ...EMPTY_DOC, failed: true }
  const doc = readSets(r.raw)
  if (uid === _uid) _cached = doc
  return doc
}

/** What is already loaded in this tab for member `uid` (a save updates it), or null. Never a request. */
export const peekSets = (uid) => (uid === _uid ? _cached : null)

/** Tests only. */
export function __resetSetsCache() { _cached = null; _uid = undefined }

export const READ_FAILED_REASON = "Your saved sets couldn't be read just now, so nothing was saved. Try again."
export const SAVE_FAILED_REASON = "Couldn't save just now. Your sets are unchanged."

/** Save `next` (`{sets}` and/or `{presets}`), or an updater `(fresh) => next` applied to a FRESH read taken
 *  just before the write (so an edit another tab made meanwhile is not dropped): read the stored value,
 *  replace only the key(s) given, and post the WHOLE value (the endpoint replaces it).
 *  `{ok: true, doc}` or `{ok: false, reason}`. */
export async function saveSets(update) {
  const owner = _uid
  const cur = await readRaw()
  if (!cur.ok) return { ok: false, reason: READ_FAILED_REASON }
  const stored = readSets(cur.raw)
  const next = typeof update === 'function' ? update(stored) : update
  const merged = {
    v: 1,
    sets: Array.isArray(next?.sets) ? next.sets : stored.sets,
    presets: Array.isArray(next?.presets) ? next.presets : stored.presets,
  }
  const why = docRefusal(merged)
  if (why) return { ok: false, reason: why }
  const doc = readSets(merged)
  const value = JSON.stringify(doc)
  try {
    const res = await fetch(PREFS_URL, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: CHART_SETS_PREF, value }),
    })
    if (!res || !res.ok) return { ok: false, reason: SAVE_FAILED_REASON }
  } catch {
    return { ok: false, reason: SAVE_FAILED_REASON }
  }
  if (owner === _uid) _cached = doc
  try { await mergeIntoPreferenceCache(CHART_SETS_PREF, value) } catch { /* the cache is a convenience */ }
  return { ok: true, doc }
}

/** Save one widget's settings as a named preset (the SnapshotFrame door). */
export async function savePreset({ name, kind, params }) {
  const clean = cleanName(name)
  if (!clean) return { ok: false, reason: 'Give the preset a name.' }
  if (!SNAPSHOT_IDS.has(kind)) return { ok: false, reason: 'This widget cannot be saved as a preset.' }
  // The same name replaces that preset, and says so. The list is read fresh inside the save.
  let replaced = false
  const res = await saveSets((fresh) => {
    const others = fresh.presets.filter((p) => p.name.toLowerCase() !== clean.toLowerCase())
    replaced = others.length < fresh.presets.length
    return { presets: [...others, { id: newId('p'), name: clean, kind, params: presetParams({ params }) }] }
  })
  return res.ok ? { ...res, replaced, message: replaced ? `Replaced the preset ${clean}.` : 'Saved as a preset.' } : res
}

// ── The / menu rows (built here so the menu's first-open bytes stay put) ─────

/** Sets whose name starts with `q` (case-insensitive); all of them for an empty `q`. */
export function matchSets(sets, q) {
  const needle = String(q || '').trim().toLowerCase()
  return needle ? sets.filter((s) => s.name.toLowerCase().startsWith(needle)) : sets
}

function setRow(set, group) {
  const n = set.charts.length
  return {
    title: `Set — ${set.name}`, cmd: 'set', group,
    description: `${n} chart${n === 1 ? '' : 's'}: ${set.charts.map((c) => c.symbol).slice(0, 4).join(' ')}${n > 4 ? ' …' : ''}`,
    command: ({ editor, range }) => {
      // ONE transaction: the typed command leaves and every chart goes in, in order.
      editor.chain().focus().deleteRange(range)
        .insertContent(chartSetNodes(set, editor.storage?.uctJournalWidgets?.chartSettings))
        .caretAfterWidgetEmbed().run()
    },
  }
}

const manageRow = (group) => ({
  title: 'Manage chart sets', cmd: 'sets', group,
  description: 'Make, rename, reorder or delete your chart sets',
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run()
    import('../components/notebook/widgets/SetsDialog').then((m) => m.openSetsDialog({ editor }), () => {
      editor.storage?.uctJournalWidgets?.notify?.("Chart sets couldn't open just now. Try again.", 'error')
    })
  },
})

/** `/set` lists the member's sets (and the door to manage them); `/set <name>` inserts the set whose
 *  name starts with it. Two regimes, like /ticker: a single token is a prefix of the command; once a
 *  space follows, only the exact command, and a name that matches nothing offers nothing. */
/** A bare `/` shows at most this many sets and presets each; typing narrows to every match. */
export const BARE_ROWS = 5

export function chartSetRows(query, doc, group) {
  const raw = String(query || '').trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  if (tokens.length <= 1) {
    const rows = []
    const sets = raw ? doc.sets : doc.sets.slice(0, BARE_ROWS)
    if ('set'.startsWith(first)) rows.push(...sets.map((s) => setRow(s, group)))
    if ('sets'.startsWith(first)) rows.push(manageRow(group))
    return rows
  }
  if (first !== 'set') return []
  return matchSets(doc.sets, raw.slice(first.length)).map((s) => setRow(s, group))
}

/** `/preset` lists the member's presets; `/preset <name>` narrows them. `insert(kind, params)` is the
 *  menu's own snapshot command (the Task 8 insert path), so a preset never has a second insert. */
export function presetRows(query, doc, group, insert) {
  const raw = String(query || '').trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  let presets
  if (!raw) presets = doc.presets.slice(0, BARE_ROWS)
  else if (tokens.length <= 1) presets = 'preset'.startsWith(first) || 'presets'.startsWith(first) ? doc.presets : []
  else if (first === 'preset') presets = matchSets(doc.presets, raw.slice(first.length))
  else presets = []
  const byId = new Map(WIDGET_KINDS.map((k) => [k.id, k]))
  return presets.flatMap((p) => {
    const kind = byId.get(p.kind)
    // A preset of a kind whose wave is off is kept, and not offered (the gate decides what is offered).
    if (!kind || !widgetsWaveOn(kind.wave)) return []
    return [{
      title: `Preset — ${p.name}`, cmd: 'preset', group,
      description: `${kind.title} with your saved settings`,
      command: insert(kind, presetParams(p)),
    }]
  })
}
