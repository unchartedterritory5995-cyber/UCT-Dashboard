// app/src/components/chart/indicatorHistoryStore.js
//
// ⭐ A1.2 — THE INDICATOR UNDO STACK. A module singleton, one stack per (member, chart
// surface), depth 50 with redo; mirrored to `sessionStorage` so a reload keeps it.
// Indicators-owned. The records themselves are `engine/indicatorHistory.js`'s.
//
// ⛔ EXACT KEYS ONLY. The app shares its origin with other sessions' features, so this
// module never iterates, reads or removes a storage key it did not write. Its keys are
// `uct.indicators.history.v1:<userId>:<surfaceKey>`, and it finds them again through
// its own index key `uct.indicators.history.v1:index:<userId>` — never by scanning.
//
// ⛔ MEMBER-SCOPED. The user id is part of every key and every stack, so signing in as
// someone else in the same tab never shows the previous member's history.
//
// ⛔ WHAT IS RECORDED: a member's own indicator change that hides, shows, adds or removes
// something (`describeIndicatorChange`). Input edits are not recorded (a refusal on the
// same instance keeps Undo honest — see `indicatorHistory.js`). The Agent's writes are
// never recorded here: the Agent keeps its own exact Undo.

import { useSyncExternalStore } from 'react'
import { recordOf, applyUndo, applyRedo, readBack, HISTORY_CONTRACT, HISTORY_SETTINGS_VERSION } from './engine/indicatorHistory'
import { isInstanceTombstone } from './instanceShape'

export const HISTORY_DEPTH = 50
export const HISTORY_KEY_PREFIX = 'uct.indicators.history.v1:'
const PER_KEY_BYTES = 256 * 1024
const TOTAL_BYTES = 2 * 1024 * 1024

const stacks = new Map()          // `${userId}:${surfaceKey}` → { past: [], future: [] }
const listeners = new Set()
let version = 0
let seq = 0

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const keyOf = (userId, surfaceKey) => `${userId || 'anon'}:${surfaceKey}`
const storageKey = (userId, surfaceKey) => `${HISTORY_KEY_PREFIX}${userId || 'anon'}:${surfaceKey}`
const indexKey = (userId) => `${HISTORY_KEY_PREFIX}index:${userId || 'anon'}`

function storage() {
  try { return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null } catch { return null }
}
function readJson(key) {
  const s = storage()
  if (!s) return null
  try { const raw = s.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeRaw(key, value) {
  const s = storage()
  if (!s) return false
  try { if (value === null) s.removeItem(key); else s.setItem(key, value); return true } catch { return false }
}

/** The surface a chart's history belongs to.
 *  · `chart:<chartId>` — a surface with its own sink (a /charts widget tab; the phone
 *    shares the desktop tab's id, so both see one stack for one blob);
 *  · `mount:<mountId>` — an isolated surface with no stable id (does not survive reload);
 *  · `global` — everything writing the global `chart_settings` (grid cells, standalone pages). */
export function indicatorHistoryKey({ chartId = null, isolated = false, mountId = null } = {}) {
  if (isolated && chartId) return `chart:${chartId}`
  if (isolated) return `mount:${mountId || 'anon'}`
  return 'global'
}

const validEntry = (e) => isObj(e) && isObj(e.record) && e.record.contract === HISTORY_CONTRACT
  && e.record.settingsVersion === HISTORY_SETTINGS_VERSION && typeof e.label === 'string'

function load(userId, surfaceKey) {
  const k = keyOf(userId, surfaceKey)
  if (stacks.has(k)) return stacks.get(k)
  const saved = readJson(storageKey(userId, surfaceKey))
  const st = {
    past: Array.isArray(saved?.past) ? saved.past.filter(validEntry) : [],
    future: Array.isArray(saved?.future) ? saved.future.filter(validEntry) : [],
  }
  stacks.set(k, st)
  return st
}

function persist(userId, surfaceKey, st) {
  const key = storageKey(userId, surfaceKey)
  let body = { past: st.past, future: st.future }
  let text = JSON.stringify(body)
  // ⛔ PER-KEY CAP: drop the oldest entries first.
  while (text.length > PER_KEY_BYTES && (body.past.length || body.future.length)) {
    body = body.past.length ? { ...body, past: body.past.slice(1) } : { ...body, future: body.future.slice(0, -1) }
    text = JSON.stringify(body)
  }
  if (!writeRaw(key, text)) return
  // ⛔ TOTAL CAP across this member's surfaces: evict the least recently used surface.
  const idx = (readJson(indexKey(userId)) || []).filter((e) => isObj(e) && typeof e.key === 'string' && e.key.startsWith(HISTORY_KEY_PREFIX))
  const now = Date.now()
  const next = [...idx.filter((e) => e.key !== key), { key, bytes: text.length, at: now }].sort((a, b) => a.at - b.at)
  let total = next.reduce((n, e) => n + (e.bytes || 0), 0)
  while (total > TOTAL_BYTES && next.length > 1) {
    const old = next.shift()
    writeRaw(old.key, null)
    total -= old.bytes || 0
  }
  writeRaw(indexKey(userId), JSON.stringify(next))
}

function emit() {
  version++
  for (const fn of [...listeners]) { try { fn() } catch { /* a listener's failure is its own */ } }
}

const labelsOf = (ids, byId, labelOf) => {
  const counts = new Map()
  for (const id of ids) {
    const d = byId.get(id)?.defId
    const name = (d && labelOf && labelOf(d)) || d || 'indicator'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts.entries()]
}

/** What kind of change `before → after` is, for the record and its toast. `null` when it
 *  hides, shows, adds and removes nothing (an input edit, or no change at all). */
export function describeIndicatorChange(before, after, labelOf) {
  const live = (cs) => new Map(((readBack(cs) || {}).indicatorInstances || [])
    .filter((i) => isObj(i) && typeof i.instanceId === 'string' && !isInstanceTombstone(i)).map((i) => [i.instanceId, i]))
  const a = live(before)
  const b = live(after)
  const added = [...b.keys()].filter((id) => !a.has(id))
  const removed = [...a.keys()].filter((id) => !b.has(id))
  const hid = [...a.keys()].filter((id) => b.has(id) && a.get(id).hidden !== true && b.get(id).hidden === true)
  const showed = [...a.keys()].filter((id) => b.has(id) && a.get(id).hidden === true && b.get(id).hidden !== true)
  const kinds = [added.length && 'add', removed.length && 'remove', hid.length && 'hide', showed.length && 'show'].filter(Boolean)
  if (!kinds.length) return null
  const say = (ids, byId, verb) => labelsOf(ids, byId, labelOf).map(([n, c]) => (c > 1 ? `${n} ${verb} (${c})` : `${n} ${verb}`)).join(', ')
  if (kinds.length > 1) return { kind: 'mixed', label: 'Indicators changed' }
  if (kinds[0] === 'hide') return { kind: 'hide', label: say(hid, a, 'hidden') }
  if (kinds[0] === 'show') return { kind: 'show', label: say(showed, b, 'shown') }
  if (kinds[0] === 'add') return { kind: 'add', label: say(added, b, 'added') }
  return { kind: 'remove', label: labelsOf(removed, a, labelOf).map(([n, c]) => (c > 1 ? `Removed ${c} ${n}` : `Removed ${n}`)).join(', ') }
}

/**
 * ⭐ Record a member's indicator change on `surfaceKey`. Returns the new entry, or null
 * when the change is not one this stack records. A new entry clears Redo.
 * @param {{userId?:string, labelOf?:(defId)=>string, origin?:string|null, toast?:boolean}} opts
 */
export function recordIndicatorChange(surfaceKey, before, after, opts = {}) {
  const what = describeIndicatorChange(before, after, opts.labelOf)
  if (!what) return null
  const record = recordOf(before, after)
  if (!record) return null
  const st = load(opts.userId, surfaceKey)
  const entry = {
    id: `h${Date.now().toString(36)}${(seq++).toString(36)}`, label: what.label, kind: what.kind,
    origin: opts.origin ?? null, at: Date.now(), toast: opts.toast !== false, record,
  }
  st.past = [...st.past, entry].slice(-HISTORY_DEPTH)
  st.future = []
  persist(opts.userId, surfaceKey, st)
  emit()
  return entry
}

/**
 * Undo the newest entry on `surfaceKey` against the chart's CURRENT settings `cs`.
 * `write(nextCs)` is the surface's own sink. Never partial: a refusal writes nothing and
 * leaves the entry where it is.
 * @returns {{ok:true, entry} | {ok:false, reason:'empty'|'changed-since'|'bad-record', entry?, detail?}}
 */
export function undoIndicatorChange(surfaceKey, cs, write, { userId } = {}) {
  const st = load(userId, surfaceKey)
  const entry = st.past[st.past.length - 1]
  if (!entry) return { ok: false, reason: 'empty' }
  const r = applyUndo(cs, entry.record)
  if (!r.ok) return { ...r, entry }
  write(r.cs)
  st.past = st.past.slice(0, -1)
  st.future = [...st.future, entry]
  persist(userId, surfaceKey, st)
  emit()
  return { ok: true, entry }
}

/** Redo the newest undone entry. Same rules as Undo. */
export function redoIndicatorChange(surfaceKey, cs, write, { userId } = {}) {
  const st = load(userId, surfaceKey)
  const entry = st.future[st.future.length - 1]
  if (!entry) return { ok: false, reason: 'empty' }
  const r = applyRedo(cs, entry.record)
  if (!r.ok) return { ...r, entry }
  write(r.cs)
  st.future = st.future.slice(0, -1)
  st.past = [...st.past, entry]
  persist(userId, surfaceKey, st)
  emit()
  return { ok: true, entry }
}

/** `{past, future, lastAt}` for one surface (read-only snapshots). */
export function peekIndicatorHistory(surfaceKey, { userId } = {}) {
  const st = load(userId, surfaceKey)
  const last = st.past[st.past.length - 1]
  return { past: st.past, future: st.future, lastAt: last ? last.at : null }
}

export function subscribeIndicatorHistory(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React: re-render when this surface's stack changes. */
export function useIndicatorHistory(surfaceKey, userId) {
  useSyncExternalStore(subscribeIndicatorHistory, () => version, () => version)
  return peekIndicatorHistory(surfaceKey, { userId })
}

/** Test-only: forget every in-memory stack (storage untouched). */
export function _resetIndicatorHistoryForTests() {
  stacks.clear()
  version = 0
}
