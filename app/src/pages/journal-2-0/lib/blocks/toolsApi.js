// The client data layer for routine and tracker blocks (Notebook widgets phase 2, wave 9, Task 9.12).
//
// ONE batched read per tick: every `readDay` made in the same macrotask joins one
// `POST <URL>/days {ids, days}` per kind. PER-ITEM writes: a tick, a skip and a log each PUT one item
// and get the merged entry back. ADOPTION: a write that lands is published to this page's subscribers and
// to the other tabs over a BroadcastChannel; a tab that comes back to the front re-reads once.
//
// ⛔ These writes land in the routine and tracker tables, NEVER a note. lib/blocks/blockDoors.test.js
// names this file in WRITE_EXCEPTIONS with seven entries, matched on each call's literal method and URL
// template, so every `fetch` below spells its URL out as a literal (two literals where the kind decides).
// ⛔ The labels a member reads for a day's state ("Not yet", "Done"...) belong to the blocks (Task 9.13);
// this layer hands back the stored state codes and says nothing about them.
//
// Server shapes (api/routers/notebook_routines.py): the batch read answers
// `{resolved?: {today: day}, routines|trackers: {id: {routine|tracker, days: {day: entry}}}}`; a refusal
// answers `{detail: {code, message}}`. The write codes handed on: `window`, `read_only`, `rate`, `invalid`,
// `conflict`, `count_cap`; the server's `not_found` (a write's 404) reads `missing`; with no detail at all a
// refusal is `invalid`, a 429 is `rate`, no answer is `network`, and no connection is `offline`.
// A paid-plan refusal (402) on a read reads `unavailable`, "Not available": accepted.
//
// 'today' is the SERVER's word: `resolved.today`, the session on or after today ET (the next session on a
// weekend or holiday, ruling W9-R27 amended). It is cached per ET day, re-resolved after ET midnight (on a
// timer and on a tab's return), and a 'today' subscriber hears writes for THAT day.
// ORDER: each write is stamped with a per-tab send sequence and the time its answer arrived. An answer to an
// older-sent write never overwrites a newer one, a broadcast older than what this tab already holds is
// dropped, and a re-read applies only if no write landed after the read began.

import { todayET } from '../calendar'
import { readSuccessBody } from '../../../../lib/responseBody'

export const ROUTINES_URL = '/api/j2/routines'
export const TRACKERS_URL = '/api/j2/trackers'
export const CHANNEL = 'uct-nb-tools'

export const TOOL_COPY = Object.freeze({
  offline: "You're offline. Ticks save when you're back online.",
  flagOff: 'Not available right now.',
  missing: 'Not available.',
  readFailedRoutine: "Can't load this routine right now.",
  readFailedTracker: "Can't load this tracker right now.",
  tickFailed: "Didn't save. Retry?",
  window: 'Ticks can be added up to 7 trading days back.',
  archivedRoutine: 'Archived routine, history only',
  archivedTracker: 'Archived tracker, history only',
})

/** The server's batch bounds (routines.READ_IDS_MAX and READ_DAYS_MAX). */
const IDS_PER_REQUEST = 30
const DAYS_PER_REQUEST = 31

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** 'today' or a REAL calendar day: 2026-02-30 rounds to March, so the round trip through UTC parts refuses it. */
function validDay(d) {
  if (d === 'today') return true
  if (!DAY_RE.test(d)) return false
  const [y, m, day] = d.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, day))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enc = encodeURIComponent

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// -- reads: one batched POST per kind per macrotask ----------------------------------------------------

/** One request, as a status code and the parsed body: never throws. */
async function postDays(kind, body) {
  try {
    const payload = JSON.stringify(body)
    // The options are written out in each call: the door rail reads a literal method or refuses the call.
    const res = kind === 'routine'
      ? await fetch('/api/j2/routines/days', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload })
      : await fetch('/api/j2/trackers/days', { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: payload })
    if (!res.ok) return { status: res.status, ok: false, data: null }
    // TERM-033: a success whose body cannot be read is a failed read (answerFor says 'network'), stated, never data.
    const read = await readSuccessBody(res)
    return { status: res.status, ok: read.ok, data: read.ok ? read.body : null }
  } catch {
    return { status: 0, ok: false, data: null }
  }
}

function failureCode(status) {
  if (status === 404 || status === 402) return 'unavailable'   // the route, the wave gate, or a paid-plan refusal
  if (status === 400 || status === 413 || status === 422) return 'invalid'
  if (status === 429) return 'rate'
  return 'network'
}

/** What one waiting read gets from one answered request. */
function answerFor(kind, item, res) {
  if (!res.ok) return { ok: false, code: failureCode(res.status) }
  const data = res.data
  if (!data || typeof data !== 'object') return { ok: false, code: 'network' }
  const per = (kind === 'routine' ? data.routines : data.trackers)?.[item.id]
  if (!per) return { ok: false, code: 'missing' }
  const resolvedDay = item.day === 'today' ? data.resolved?.today : item.day
  const entry = resolvedDay ? per.days?.[resolvedDay] : undefined
  if (!entry) return { ok: false, code: 'missing' }
  const { days: _days, routine, tracker, ...extras } = per
  return { ok: true, entry, tool: kind === 'routine' ? routine : tracker, resolvedDay, extras }
}

const queue = { routine: [], tracker: [] }
let flushTimer = null

async function flushKind(kind, items) {
  const etAtStart = todayET()                         // the ET day this request was made in
  try {
    const ids = [...new Set(items.map((i) => i.id))]
    const days = [...new Set(items.map((i) => i.day))].sort()      // sorted, so a split is the same split every time
    const idChunks = chunks(ids, IDS_PER_REQUEST)
    // A tracker's summary (recent, average, latest, n) is bounded to the LATEST day of its request (W9-R13), so one
    // request per day: batching a past note's day with a later one would hand the past block the later entries
    // (Task 9.14 fix round 1). Routines carry no summary, so their days share requests.
    const dayChunks = kind === 'tracker' ? days.map((d) => [d]) : chunks(days, DAYS_PER_REQUEST)
    const jobs = []
    for (const idChunk of idChunks) {
      for (const dayChunk of dayChunks) {
        const mine = items.filter((i) => idChunk.includes(i.id) && dayChunk.includes(i.day))
        if (!mine.length) continue
        jobs.push(postDays(kind, { ids: idChunk, days: dayChunk }).then((res) => {
          const today = res.data?.resolved?.today
          if (res.ok && typeof today === 'string' && DAY_RE.test(today)) {
            if (etAtStart === todayET()) todayCache = { et: etAtStart, day: today }
            else {                                    // answered on the far side of ET midnight: that 'today' is yesterday's
              todayCache = null
              reResolveToday()
            }
          }
          for (const item of mine) item.resolve(answerFor(kind, item, res))
        }))
      }
    }
    await Promise.all(jobs)
  } catch {
    // A malformed answer settles every read still waiting; a promise settles once, so the answered keep theirs.
    for (const item of items) item.resolve({ ok: false, code: 'network' })
  }
}

function flush() {
  flushTimer = null
  for (const kind of ['routine', 'tracker']) {
    const items = queue[kind]
    queue[kind] = []
    if (items.length) flushKind(kind, items).catch(() => {})
  }
}

/**
 * One day of one routine or tracker. Every call made in one macrotask shares ONE request per kind.
 * `code`: 'offline' (no request made), 'unavailable' (404 on the route itself, or the wave gate),
 * 'missing' (answered, but not this id or day), 'rate', 'network'.
 * @returns {Promise<{ok: true, entry: object, tool: object, resolvedDay: string, extras: object} | {ok: false, code: string}>}
 */
export function readDay(kind, id, day) {
  if (kind !== 'routine' && kind !== 'tracker') return Promise.resolve({ ok: false, code: 'missing' })
  if (!validDay(String(day))) return Promise.resolve({ ok: false, code: 'missing' })   // one bad day never poisons a batch
  if (isOffline()) return Promise.resolve({ ok: false, code: 'offline' })
  return new Promise((resolve) => {
    queue[kind].push({ id: String(id), day: String(day), resolve })
    if (flushTimer == null) flushTimer = setTimeout(flush, 0)
  })
}

// -- adoption: this page's subscribers, and the other tabs over a BroadcastChannel --------------------

const subs = new Set()               // { kind, id, day, fn }: the parts are kept, never packed into a key and split
let channel = null
let todayCache = null                // { et, day }: what the server resolved 'today' to, good for that ET day
let resolving = false
let midnightTimer = null
const lastAt = new Map()             // `${kind}|${id}|${day}` -> when the newest write for it arrived (ms)
const lastSent = new Map()           // the same key -> the send sequence of the newest write applied
let sendSeq = 0
const stampKey = (kind, id, day) => `${kind}|${id}|${day}`

/** The day a 'today' subscription means now: the server's resolved day while it is still this ET day. */
function resolveToday() {
  const et = todayET()
  if (todayCache && todayCache.et === et) return todayCache.day
  if (todayCache) reResolveToday()                    // a new ET day: ask the server again
  return et
}

/** The server's resolved 'today' while it is still this ET day, else null. Read-only: never asks the server.
 *  (Ruling W9-R35: the ONE authority a block reads; a block keeps no copy of its own.) */
export function resolvedTodayIfCurrent() { return todayCache && todayCache.et === todayET() ? todayCache.day : null }

function reResolveToday() {
  if (resolving) return
  resolving = true
  reReadSubs((s) => s.day === 'today').finally(() => { resolving = false })
}

function notify(kind, id, writeDay, entry) {
  for (const sub of [...subs]) {
    if (sub.kind !== kind || sub.id !== id) continue
    if ((sub.day === 'today' ? resolveToday() : sub.day) !== writeDay) continue
    try { sub.fn(entry) } catch { /* one block's handler never stops the others */ }
  }
}

function onChannelMessage(ev) {
  const m = ev?.data
  if (!m || typeof m !== 'object' || !m.entry) return
  if (m.kind !== 'routine' && m.kind !== 'tracker') return
  const key = stampKey(m.kind, String(m.id), String(m.day))
  const at = Number(m.at)
  if (Number.isFinite(at)) {
    if (at < (lastAt.get(key) ?? 0)) return           // older than what this tab already holds
    lastAt.set(key, at)
  }
  notify(m.kind, String(m.id), String(m.day), m.entry)
  toolChanged(m.kind, String(m.id))
}

function getChannel() {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = onChannelMessage
  } catch {
    channel = null
  }
  return channel
}

/** `sent` is the write's send sequence: an answer to an older-sent write never overwrites a newer one. */
function publish(kind, id, day, entry, sent) {
  const key = stampKey(kind, id, day)
  if (sent < (lastSent.get(key) ?? 0)) return
  lastSent.set(key, sent)
  const at = Math.max(Date.now(), lastAt.get(key) ?? 0)
  lastAt.set(key, at)
  notify(kind, id, day, entry)
  toolChanged(kind, id)
  try { getChannel()?.postMessage({ kind, id, day, entry, at, seq: sent }) } catch { /* the page already has it */ }
}

// -- tool subscriptions (ruling W9-R40): a write for ANY day refreshes every placed block of that tool ----------
// A block's summary (its recent entries, average, latest, count) spans many days, so a log for day Y moves a block
// bound to day X. `subscribe` hears only its own day's entry; a TOOL subscriber is re-read from the SERVER (its own
// day, so a past note's summary stays bounded to that day, W9-R13) once writes for the tool settle. Never a client
// merge of another day's value. ⛔ This path never writes lastAt or lastSent: it is a reader, and a reader that
// stamped would make a real write's broadcast look old.

/** How long writes for one tool must be quiet before its subscribers are re-read once. */
export const TOOL_SETTLE_MS = 300
const toolSubs = new Set()           // { kind, id, day, fn }
const toolTimers = new Map()         // `${kind}|${id}` -> timer
const toolGen = new Map()            // `${kind}|${id}|${day}` -> the newest re-read round started for it (MIN-1)

function toolChanged(kind, id) {
  if (![...toolSubs].some((s) => s.kind === kind && s.id === id)) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return   // the visibility re-read covers it
  const key = `${kind}|${id}`
  if (toolTimers.has(key)) clearTimeout(toolTimers.get(key))
  toolTimers.set(key, setTimeout(() => {
    toolTimers.delete(key)
    reReadTool(kind, id)
  }, TOOL_SETTLE_MS))
}

/** Every tool subscriber's own day, in one batched read; a result is handed on only if no write for that day
 *  landed after the read began, and only if no LATER re-read round was started for that day since (re-reads caused by
 *  writes to other days are ordered among themselves by this generation, so a late, older answer never overwrites a
 *  fresher summary). One generation per `kind|id|day` per round, so two blocks on one day share it. */
function reReadTool(kind, id) {
  const jobs = []
  const round = new Map()
  for (const sub of [...toolSubs]) {
    if (sub.kind !== kind || sub.id !== id) continue
    const genKey = `${kind}|${id}|${sub.day}`
    if (!round.has(genKey)) {
      const g = (toolGen.get(genKey) ?? 0) + 1
      toolGen.set(genKey, g)
      round.set(genKey, g)
    }
    const gen = round.get(genKey)
    const startedAt = Date.now()
    jobs.push(readDay(kind, id, sub.day).then((r) => {
      if (!r.ok || !toolSubs.has(sub)) return
      if (toolGen.get(genKey) !== gen) return
      if ((lastAt.get(stampKey(kind, id, r.resolvedDay)) ?? 0) >= startedAt) return
      try { sub.fn({ entry: r.entry, tool: r.tool, extras: r.extras, resolvedDay: r.resolvedDay }) } catch { /* see notify */ }
    }))
  }
  return Promise.all(jobs)
}

/**
 * `fn({entry, tool, extras, resolvedDay})` runs with a fresh SERVER read of `day` (YYYY-MM-DD or 'today') after a
 * write for any day of this tool lands here or in another tab, or after the tool is restored.
 * @returns {() => void} unsubscribe
 */
export function subscribeTool(kind, id, day, fn) {
  const sub = { kind, id: String(id), day: String(day), fn }
  toolSubs.add(sub)
  getChannel()
  setVisibilityListener(true)
  return () => {
    toolSubs.delete(sub)
    if (!subs.size && !toolSubs.size) setVisibilityListener(false)
    const key = `${kind}|${sub.id}`
    if (![...toolSubs].some((s) => `${s.kind}|${s.id}` === key) && toolTimers.has(key)) {
      clearTimeout(toolTimers.get(key))
      toolTimers.delete(key)
    }
  }
}

/** Re-read the chosen subscriptions (one batched read); apply a result only if no write for its day landed
 *  after the read began. `withTool`: the subscriber also gets the tool as its second argument (after a
 *  restore, so every placed block learns it is no longer archived). */
function reReadSubs(pick, withTool = false) {
  const jobs = []
  for (const sub of [...subs]) {
    if (!pick(sub)) continue
    const startedAt = Date.now()
    jobs.push(readDay(sub.kind, sub.id, sub.day).then((r) => {
      if (!r.ok || !subs.has(sub)) return
      if ((lastAt.get(stampKey(sub.kind, sub.id, r.resolvedDay)) ?? 0) >= startedAt) return
      try { if (withTool) sub.fn(r.entry, r.tool); else sub.fn(r.entry) } catch { /* see notify */ }
    }))
  }
  return Promise.all(jobs)
}

function reReadAll() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  reReadSubs(() => true)
  // The tool subscribers too (W9-R40: a change made while this tab was hidden was not re-read then), in the same tick,
  // so the batch is still one request per kind.
  const tools = new Map()
  for (const s of toolSubs) tools.set(`${s.kind}|${s.id}`, s)
  for (const s of tools.values()) reReadTool(s.kind, s.id)
}

let visibilityOn = false
function setVisibilityListener(on) {
  if (typeof document === 'undefined' || visibilityOn === on) return
  visibilityOn = on
  if (on) document.addEventListener('visibilitychange', reReadAll)
  else document.removeEventListener('visibilitychange', reReadAll)
}

/** Milliseconds to the next ET midnight, from the ET CALENDAR (a day is 23 to 25 hours): the first instant
 *  whose ET date differs from now's, found by bisection between now and 26 hours on (always a new day). */
function msToEtMidnight(now = new Date()) {
  const day = todayET(now)
  let lo = now.getTime()                              // todayET(lo) === day
  let hi = lo + 26 * 3600 * 1000                      // todayET(hi) !== day
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (todayET(new Date(mid)) === day) lo = mid
    else hi = mid
  }
  return hi - now.getTime()
}

function armMidnight() {
  if (midnightTimer != null) return
  midnightTimer = setTimeout(() => {
    midnightTimer = null
    if (![...subs].some((s) => s.day === 'today')) return
    reReadSubs((s) => s.day === 'today')
    armMidnight()
  }, msToEtMidnight())
}

function disarmMidnight() {
  if (midnightTimer != null) clearTimeout(midnightTimer)
  midnightTimer = null
}

/**
 * `fn(entry)` runs with a merged entry from this page's write or another tab's, and with a fresh read when
 * the tab becomes visible again (one batched read for every subscribed pair). `day` is a YYYY-MM-DD or
 * `'today'`, which means the day the server resolves it to.
 * @returns {() => void} unsubscribe
 */
export function subscribe(kind, id, day, fn) {
  const sub = { kind, id: String(id), day: String(day), fn }
  subs.add(sub)
  getChannel()
  setVisibilityListener(true)
  if (sub.day === 'today') {
    armMidnight()
    if (!(todayCache && todayCache.et === todayET())) readDay(sub.kind, sub.id, 'today')   // seeds the server's day; the answer is only for the cache
  }
  return () => {
    subs.delete(sub)
    if (!subs.size && !toolSubs.size) setVisibilityListener(false)
    if (![...subs].some((x) => x.day === 'today')) disarmMidnight()
  }
}

// -- writes: one item at a time, the merged entry back --------------------------------------------------

function offlineFailure() {
  return { ok: false, code: 'offline', message: TOOL_COPY.offline }
}

/** The merged entry on success; on a refusal the server's own code and sentence. */
async function settle(res) {
  if (res.ok) {
    // TERM-033: the merged entry, or a stated failed read when the body is unreadable or not an entry.
    const read = await readSuccessBody(res)
    const entry = read.ok ? read.body : null
    return entry && typeof entry === 'object' ? { ok: true, entry } : { ok: false, code: 'network', message: TOOL_COPY.tickFailed }
  }
  // A refusal: the STATUS already decided it failed; its body only adds the server's code and sentence when readable.
  let detail
  try {
    detail = (await res.json())?.detail
  } catch {
    detail = undefined   // no readable explanation: the status picks the code below
  }
  let code = typeof detail?.code === 'string' ? detail.code : res.status === 429 ? 'rate' : res.status === 404 ? 'missing' : 'invalid'
  if (code === 'not_found') code = 'missing'
  const message = typeof detail?.message === 'string' && detail.message ? detail.message : TOOL_COPY.tickFailed
  return { ok: false, code, message }
}

const networkFailure = () => ({ ok: false, code: 'network', message: TOOL_COPY.tickFailed })

/** Tick or untick one item of a routine's day. @returns {Promise<{ok: true, entry} | {ok: false, code, message}>} */
export async function tick(routineId, day, itemId, ticked) {
  if (isOffline()) return offlineFailure()
  const sent = ++sendSeq
  try {
    const res = await fetch(`/api/j2/routines/${enc(routineId)}/days/${enc(day)}/items/${enc(itemId)}`, {
      method: 'PUT', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ ticked: !!ticked }),
    })
    const out = await settle(res)
    if (out.ok) publish('routine', String(routineId), String(day), out.entry, sent)
    return out
  } catch {
    return networkFailure()
  }
}

/** Skip (or un-skip) a routine's whole day. */
export async function setSkipped(routineId, day, skipped) {
  if (isOffline()) return offlineFailure()
  const sent = ++sendSeq
  try {
    const res = await fetch(`/api/j2/routines/${enc(routineId)}/days/${enc(day)}`, {
      method: 'PUT', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ skipped: !!skipped }),
    })
    const out = await settle(res)
    if (out.ok) publish('routine', String(routineId), String(day), out.entry, sent)
    return out
  } catch {
    return networkFailure()
  }
}

/** Log a tracker's value for a day: a number, a yes/no, or null to clear it. */
export async function logValue(trackerId, day, value) {
  if (isOffline()) return offlineFailure()
  const sent = ++sendSeq
  try {
    const res = await fetch(`/api/j2/trackers/${enc(trackerId)}/days/${enc(day)}`, {
      method: 'PUT', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify({ value: value ?? null }),
    })
    const out = await settle(res)
    if (out.ok) publish('tracker', String(trackerId), String(day), out.entry, sent)
    return out
  } catch {
    return networkFailure()
  }
}

/** Restore an archived routine or tracker (ruling W9-R31): its own row, never a note. On success every
 *  placed block of it on this page re-reads, and hears the tool with its entry.
 *  @returns {Promise<{ok: true, entry} | {ok: false, code, message}>} */
export async function unarchive(kind, id) {
  if (isOffline()) return offlineFailure()
  if (kind !== 'routine' && kind !== 'tracker') return { ok: false, code: 'missing', message: TOOL_COPY.missing }
  try {
    const res = kind === 'routine'
      ? await fetch(`/api/j2/routines/${enc(id)}/unarchive`, { method: 'POST', credentials: 'include' })
      : await fetch(`/api/j2/trackers/${enc(id)}/unarchive`, { method: 'POST', credentials: 'include' })
    const out = await settle(res)
    if (out.ok) await toolEdited(kind, id)
    return out
  } catch {
    return networkFailure()
  }
}

const toolListListeners = new Set()

/** Hear that a routine or tracker changed on this page (`fn(kind)`), from `toolEdited`. Idempotent (a Set). Read
 *  through toolsCrud.onToolsChanged (Task 9.19). @returns {() => void} stop hearing */
export function onToolEdited(fn) {
  if (typeof fn === 'function') toolListListeners.add(fn)
  return () => { toolListListeners.delete(fn) }
}

/** The tool itself changed (an editor's save, archive, delete or undelete; a restore above): every placed block of it
 *  on this page re-reads its day and hears the tool with its entry (its name, items, archived state), and every tool
 *  subscriber (a tracker's summary) re-reads once. The ONE refresh path for a tool-level change; it writes nothing.
 *  ⚠️ This page only: nothing is broadcast, so another tab catches up on its next return to the front (W9-R44). */
export async function toolEdited(kind, id) {
  if (kind !== 'routine' && kind !== 'tracker') return
  // Ruling W9-R49: the ONE notifier for a tool change. Every write lands here (toolsCrud's writes, a block's restore),
  // so the list listeners (the / menu's Mine rows, through toolsCrud.onToolsChanged) hear it once, before any read.
  for (const fn of [...toolListListeners]) {
    try { fn(kind) } catch { /* the listener's own */ }
  }
  await reReadSubs((s) => s.kind === kind && s.id === String(id), true)
  toolChanged(kind, String(id))
}

/** Day P&L against the tool (a GET). @returns {Promise<{ok: true, data} | {ok: false, code}>} */
export async function vsPnl(kind, id) {
  if (isOffline()) return { ok: false, code: 'offline' }
  try {
    const res = kind === 'routine'
      ? await fetch(`/api/j2/routines/${enc(id)}/vs-pnl`, { credentials: 'include' })
      : await fetch(`/api/j2/trackers/${enc(id)}/vs-pnl`, { credentials: 'include' })
    if (!res.ok) return { ok: false, code: failureCode(res.status) }
    const read = await readSuccessBody(res)   // TERM-033: an unreadable success is a stated 'network' failure
    return read.ok && read.body ? { ok: true, data: read.body } : { ok: false, code: 'network' }
  } catch {
    return { ok: false, code: 'network' }
  }
}
