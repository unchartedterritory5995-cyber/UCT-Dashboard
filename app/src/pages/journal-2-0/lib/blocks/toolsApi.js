// The client data layer for routine and tracker blocks (Notebook widgets phase 2, wave 9, Task 9.12).
//
// ONE batched read per tick: every `readDay` made in the same macrotask joins one
// `POST <URL>/days {ids, days}` per kind. PER-ITEM writes: a tick, a skip and a log each PUT one item
// and get the merged entry back. ADOPTION: a write that lands is published to this page's subscribers and
// to the other tabs over a BroadcastChannel; a tab that comes back to the front re-reads once.
//
// ⛔ These writes land in the routine and tracker tables, NEVER a note. lib/blocks/blockDoors.test.js
// names this file in WRITE_EXCEPTIONS with five entries, matched on each call's literal method and URL
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
const validDay = (d) => d === 'today' || DAY_RE.test(d)

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
    const data = res.ok ? await res.json().catch(() => null) : null
    return { status: res.status, ok: res.ok, data }
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
  try {
    const ids = [...new Set(items.map((i) => i.id))]
    const days = [...new Set(items.map((i) => i.day))].sort()      // sorted, so a split is the same split every time
    const idChunks = chunks(ids, IDS_PER_REQUEST)
    const dayChunks = chunks(days, DAYS_PER_REQUEST)
    const jobs = []
    for (const idChunk of idChunks) {
      for (const dayChunk of dayChunks) {
        const mine = items.filter((i) => idChunk.includes(i.id) && dayChunk.includes(i.day))
        if (!mine.length) continue
        jobs.push(postDays(kind, { ids: idChunk, days: dayChunk }).then((res) => {
          const today = res.data?.resolved?.today
          if (res.ok && typeof today === 'string' && DAY_RE.test(today)) todayCache = { et: todayET(), day: today }
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
  if (todayCache && !resolving) {                     // a new ET day: ask the server again
    resolving = true
    reReadSubs((s) => s.day === 'today').finally(() => { resolving = false })
  }
  return et
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
  try { getChannel()?.postMessage({ kind, id, day, entry, at, seq: sent }) } catch { /* the page already has it */ }
}

/** Re-read the chosen subscriptions (one batched read); apply a result only if no write for its day landed
 *  after the read began. */
function reReadSubs(pick) {
  const jobs = []
  for (const sub of [...subs]) {
    if (!pick(sub)) continue
    const startedAt = Date.now()
    jobs.push(readDay(sub.kind, sub.id, sub.day).then((r) => {
      if (!r.ok || !subs.has(sub)) return
      if ((lastAt.get(stampKey(sub.kind, sub.id, r.resolvedDay)) ?? 0) >= startedAt) return
      try { sub.fn(r.entry) } catch { /* see notify */ }
    }))
  }
  return Promise.all(jobs)
}

function reReadAll() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  reReadSubs(() => true)
}

let visibilityOn = false
function setVisibilityListener(on) {
  if (typeof document === 'undefined' || visibilityOn === on) return
  visibilityOn = on
  if (on) document.addEventListener('visibilitychange', reReadAll)
  else document.removeEventListener('visibilitychange', reReadAll)
}

/** Milliseconds to the next ET midnight, plus a second so the new day has begun. */
function msToEtMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now)
  const get = (t) => Number(parts.find((p) => p.type === t)?.value) || 0
  return (86400 - ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second'))) * 1000 - now.getMilliseconds() + 1000
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
  if (sub.day === 'today') armMidnight()
  return () => {
    subs.delete(sub)
    if (!subs.size) setVisibilityListener(false)
    if (![...subs].some((x) => x.day === 'today')) disarmMidnight()
  }
}

// -- writes: one item at a time, the merged entry back --------------------------------------------------

function offlineFailure() {
  return { ok: false, code: 'offline', message: TOOL_COPY.offline }
}

/** The merged entry on success; on a refusal the server's own code and sentence. */
async function settle(res) {
  const data = await res.json().catch(() => null)
  if (res.ok) return data && typeof data === 'object' ? { ok: true, entry: data } : { ok: false, code: 'network', message: TOOL_COPY.tickFailed }
  const detail = data?.detail
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

/** Day P&L against the tool (a GET). @returns {Promise<{ok: true, data} | {ok: false, code}>} */
export async function vsPnl(kind, id) {
  if (isOffline()) return { ok: false, code: 'offline' }
  try {
    const res = kind === 'routine'
      ? await fetch(`/api/j2/routines/${enc(id)}/vs-pnl`, { credentials: 'include' })
      : await fetch(`/api/j2/trackers/${enc(id)}/vs-pnl`, { credentials: 'include' })
    if (!res.ok) return { ok: false, code: failureCode(res.status) }
    const data = await res.json().catch(() => null)
    return data ? { ok: true, data } : { ok: false, code: 'network' }
  } catch {
    return { ok: false, code: 'network' }
  }
}
