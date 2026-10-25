// Notebook widgets phase 2 (wave 8, Task 8.13): the built-widget client.
//
// ⛔ LAZY. Only lazy code imports this file: SnapshotFrame (in the snapshot embeds chunk), and later the builder,
// My tools and the / menu's Mine rows. An eager import puts every byte below on the Notebook's first open.
//
// A placed built widget is an ordinary widgetEmbed whose `widgetId` is `builtWidget`. See it now and Change re-run
// it through `POST /api/j2/widget-definitions/run`; the server ECHOES every key the note keeps (def, defId,
// defRev, title, labels and the viewer settings), so the refresh merge copies nothing from the old params but the
// member's own `share` switch (spec 5.6). Phase 1's refreshParams is not used: it copies only REQUEST_KEYS.

export const BUILT_KIND = 'builtWidget'
export const DEFS_URL = '/api/j2/widget-definitions'
export const ACCOUNTS_URL = '/api/j2/accounts'

/** The client's own ceiling on one request (the server bounds its scan at 1.5 s; this is for a stalled wire). */
export const FETCH_TIMEOUT_MS = 15000

/** The settings a placed widget's Change edits. They live in the widget's params, never in the definition. */
export const BUILT_CHANGE_KEYS = Object.freeze(['range', 'accountId', 'filter'])

/** Spec 5.10: the copy for each state a member can reach, by the server's error `code` (plus the three the client
 *  decides: `offline`, no request made; `unavailable`, a 404 while wave 8 is dark; `paid`, a 402). `superseded` (a newer
 *  preview replaced this one) and `invalid` (the server's own sentence) are answered by failureText, not here. */
export const FAILURE_COPY = Object.freeze({
  busy: 'Busy right now. Try again in a moment.',
  too_long: 'This is a lot of data to add up. Try a shorter range or fewer splits.',
  rate: 'Too many refreshes in a minute. Try again shortly.',
  rate_preview: 'Pausing the preview for a moment; your changes are kept.',
  daily_cap: 'You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow.',
  count_cap: 'You have 100 widgets. Archive one in My tools to make room.',
  conflict: 'Changed in another tab. Reload to see the newer version.',
  too_new: 'This widget was made with a newer version of the app. Reload to use it.',
  offline: "Offline. The preview updates when you're back.",
  unavailable: 'Not available right now.',
  // A 402: the member's plan does not include widgets (the client's own words; the server's sentence names an engine
  // noun). My tools says it its own way (myToolsLib COPY.paid).
  paid: 'Widgets need a paid plan.',
})
/** Anything else (a network error, a 500, an unreadable answer): the snapshot is untouched. */
export const FAILED_SENTENCE = "Couldn't refresh. The saved snapshot is unchanged."

/** The member sentence for a failed call. `superseded` is internal (the caller already has a newer request in
 *  flight) and answers '' so the caller shows nothing; `invalid` shows the server's own sentence. */
export function failureText(code, message) {
  if (code === 'superseded') return ''
  if (typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code)) return FAILURE_COPY[code]
  if (code === 'invalid' && typeof message === 'string' && message.trim()) return message.trim()
  return FAILED_SENTENCE
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A refused answer as `{ok: false, code, message, status}` (`status`: the HTTP status). The server's errors are
 *  `{detail: {code, message}}` (a plain-string `detail` is read as a failure with that message); a 404 is the dark
 *  wave (or a widget that is not the member's); a 402 is the plan (`paid`); ruling R-27: a 428 (no If-Match) is a
 *  conflict. */
async function refusal(res) {
  const status = res.status
  if (status === 404) return { ok: false, code: 'unavailable', message: FAILURE_COPY.unavailable, status }
  if (status === 402) return { ok: false, code: 'paid', message: FAILURE_COPY.paid, status }
  let detail = null
  try { detail = (await res.json())?.detail } catch { detail = null }
  if (status === 428) return { ok: false, code: 'conflict', message: FAILURE_COPY.conflict, status }
  const code = isRecord(detail) && typeof detail.code === 'string' && detail.code ? detail.code : 'failed'
  const message = isRecord(detail) && typeof detail.message === 'string' ? detail.message
    : (typeof detail === 'string' ? detail : '')
  return { ok: false, code, message, status }
}

function withTimeout() {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null
  return { signal: ctl ? { signal: ctl.signal } : {}, done: () => { if (timer) clearTimeout(timer) } }
}

async function answer(res) {
  if (!res.ok) return refusal(res)
  const data = await res.json()
  return isRecord(data) ? { ok: true, data } : { ok: false, code: 'failed', message: '', status: res.status }
}

const lost = () => ({ ok: false, code: isOffline() ? 'offline' : 'failed', message: '' })
const offline = () => ({ ok: false, code: 'offline', message: FAILURE_COPY.offline })

/** `POST DEFS_URL + path` with a JSON body. Never throws: `{ok: true, data}` or `{ok: false, code, message, status}`.
 *  Offline makes no request at all. `etag` is sent as If-Match (ruling R-15; a version restore). `idempotencyKey`
 *  (ruling R-43: the builder's create POST) is sent as `Idempotency-Key`, so a repeat of that POST answers the widget it
 *  already made. ⛔ Each fetch below names its method LITERALLY: the door rail (lib/offline/doorEnumeration.test.js)
 *  reads methods from the call site. */
export async function postJson(path, body, { etag, idempotencyKey } = {}) {
  if (isOffline()) return offline()
  const t = withTimeout()
  const headers = {
    'Content-Type': 'application/json', ...ifMatchHeader(etag),
    ...(typeof idempotencyKey === 'string' && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
  try {
    const res = await fetch(`${DEFS_URL}${path}`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify(body ?? {}), ...t.signal,
    })
    return await answer(res)
  } catch {
    return lost()
  } finally {
    t.done()
  }
}

/** `PUT DEFS_URL + path` carrying `If-Match: <etag>` (ruling R-15: the widget's `etag`, its save sequence, never
 *  its `rev`). A missing etag is sent as no header, which the server answers 428 = conflict (R-27). `idempotencyKey`
 *  (ruling R-49: a save as a new widget) is sent as `Idempotency-Key`. */
export async function putJson(path, body, etag, { idempotencyKey } = {}) {
  if (isOffline()) return offline()
  const t = withTimeout()
  const headers = {
    'Content-Type': 'application/json', ...ifMatchHeader(etag),
    ...(typeof idempotencyKey === 'string' && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
  try {
    const res = await fetch(`${DEFS_URL}${path}`, {
      method: 'PUT', credentials: 'include', headers, body: JSON.stringify(body ?? {}), ...t.signal,
    })
    return await answer(res)
  } catch {
    return lost()
  } finally {
    t.done()
  }
}

// ── idempotency keys (rulings R-43, R-48, R-49, R-50): ONE authority for every caller ─────────────────

/** A uuid4 for one request's `Idempotency-Key`. Built from `crypto.getRandomValues` (available outside a secure context,
 *  unlike `crypto.randomUUID`); `Math.random` only where there is no `crypto` at all. */
export function newIdempotencyKey() {
  const b = new Uint8Array(16)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40          // version 4
  b[8] = (b[8] & 0x3f) | 0x80          // the RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** Whether `k` is a key this client makes (the server's own check is the same shape). */
export const isIdempotencyKey = (k) => typeof k === 'string' && IDEMPOTENCY_KEY_RE.test(k)

/** The server's answer settles what happened to a request: it landed, or it was refused. Only a lost answer (no status:
 *  the network, a timeout) or a bare 5xx from in front of the app leaves it unknown, and only then may the same request
 *  be sent again under the same key. */
export const outcomeConfirmed = (got) => !!got && (got.ok
  || (Number.isInteger(got.status) && (got.status < 500 || got.code !== 'failed')))

/**
 * One keyed request per member intent (ruling R-50, for the doors that have no draft: My tools). `send(intent, body,
 * fetchWith)` sends `fetchWith(key)` under the intent's key: the SAME key while that intent's earlier request is
 * unconfirmed and carried the same body (a retry after a lost answer, so the server replays it), else a fresh one. A
 * confirmed answer ends the intent, so the next press is a new intent with a new key.
 */
export function keyedSender() {
  const pending = new Map()
  return async (intent, body, fetchWith) => {
    const same = JSON.stringify(body ?? {})
    let p = pending.get(intent)
    if (!p || p.same !== same) p = { key: newIdempotencyKey(), same }
    pending.set(intent, p)
    const got = await fetchWith(p.key)
    if (outcomeConfirmed(got) && pending.get(intent) === p) pending.delete(intent)
    return got
  }
}

/** `{'If-Match': '<etag>'}` for a widget's etag, or `{}` when it has none (a number, or a numeric string). */
export function ifMatchHeader(etag) {
  if (typeof etag === 'number' && Number.isInteger(etag)) return { 'If-Match': String(etag) }
  if (typeof etag === 'string' && /^\d+$/.test(etag.trim())) return { 'If-Match': etag.trim() }
  return {}
}

/** `GET` of a JSON read (a URL relative to the site). Never throws. */
export async function getJson(url) {
  if (isOffline()) return offline()
  const t = withTimeout()
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'include', ...t.signal })
    return await answer(res)
  } catch {
    return lost()
  } finally {
    t.done()
  }
}

// ── the placed widget ────────────────────────────────────────────────────────────────────────────

/** Ruling R-19: the viewer settings a placed widget runs with: `range` (a plan range, `{token}` or `{from, to}`),
 *  `accountId` (one of the member's accounts; absent is all of them) and `filter` (the values that replace the
 *  definition's ONE overridable filter, a list; `{values: [...]}` is read too). Only what is set is sent. */
export function viewerSettingsOf(params) {
  const p = isRecord(params) ? params : {}
  const out = {}
  const r = p.range
  if (isRecord(r)) {
    if (typeof r.token === 'string' && r.token) out.range = { token: r.token }
    else if (typeof r.from === 'string' && r.from && typeof r.to === 'string' && r.to) out.range = { from: r.from, to: r.to }
  }
  if (typeof p.accountId === 'string' && p.accountId) out.accountId = p.accountId
  const f = Array.isArray(p.filter) ? p.filter : (isRecord(p.filter) && Array.isArray(p.filter.values) ? p.filter.values : null)
  if (f && f.length) out.filter = [...f]
  return out
}

/** The request that runs a placed widget: its pinned revision, the frozen copy it falls back to (the definition
 *  deleted, or the note copied into another account), and its own settings. */
function runBody(params) {
  const p = isRecord(params) ? params : {}
  const body = { settings: viewerSettingsOf(p) }
  if (typeof p.defId === 'string' && p.defId) body.defId = p.defId
  if (Number.isInteger(p.defRev)) body.defRev = p.defRev
  if (isRecord(p.def)) body.def = p.def
  return body
}

/** See it now (and Change, with the new settings in `params`): `{ok: true, data}` (the payload, which echoes
 *  every key) or a refusal. An answer with no `asOf` is not a snapshot and counts as failed. */
export async function runBuilt(params) {
  const got = await postJson('/run', runBody(params))
  if (got.ok && typeof got.data.asOf !== 'string') return { ok: false, code: 'failed', message: '' }
  return got
}

/** The rows behind one cell of a placed widget (Task 8.14 draws them). `snapshotAt` is the snapshot's own
 *  `asOf`, so the server can say "Live data; the snapshot was taken on <date>". */
export function drillBuilt(params, cell) {
  const p = isRecord(params) ? params : {}
  return postJson('/drill', {
    ...runBody(p), cell,
    ...(Number.isInteger(p.count) ? { snapshotCount: p.count } : {}),
    ...(typeof p.asOf === 'string' && p.asOf ? { snapshotAt: p.asOf } : {}),
  })
}

/** The params a refresh writes: the server's payload, which echoed every key the note keeps, and the member's
 *  CURRENT `share` switch (a refresh never publishes or unpublishes). Nothing else is copied from `old`. */
export function builtRefreshParams(old, payload) {
  const prev = isRecord(old) ? old : {}
  return { ...(isRecord(payload) ? payload : {}), share: prev.share === true }
}

/** The definition's one overridable filter, or null (only that filter can be changed from the note). */
export function overridableFilter(def) {
  const filters = isRecord(def) && Array.isArray(def.filters) ? def.filters : []
  return filters.find((f) => isRecord(f) && f.overridable === true) || null
}

// ── the reads Change and the builder need (each cached per tab after its first answer) ─────────────

/** A refused read as an Error that carries its `code` (e.code), so a caller can say "Not available right now." for
 *  the dark wave instead of a generic failure. */
const refusedRead = (got) => Object.assign(new Error(got.code), { code: got.code })

let accountsLoad = null
let catalogLoad = null
const vocabLoads = new Map()

const cached = (fn, keep) => fn().then((v) => v, (e) => { keep(null); throw e })

/** The member's accounts as `[{id, name}]`, for "All my accounts" plus each account. */
export function loadAccounts() {
  if (!accountsLoad) {
    accountsLoad = cached(async () => {
      const got = await getJson(ACCOUNTS_URL)
      if (!got.ok) throw refusedRead(got)
      const list = Array.isArray(got.data.accounts) ? got.data.accounts : []
      return list.filter((a) => isRecord(a) && a.id != null)
        .map((a) => ({ id: String(a.id), name: typeof a.name === 'string' && a.name ? a.name : 'Account' }))
    }, (v) => { accountsLoad = v })
  }
  return accountsLoad
}

/** A saved widget's plan (`GET DEFS_URL/{defId}` -> `plan`), for a placed widget that carries only `defRef`
 *  (its plan was over 4 KB, so no frozen `def`). Not cached: the widget can change. Rejects when unreadable. */
export async function loadDefinition(defId) {
  const got = await getJson(`${DEFS_URL}/${encodeURIComponent(String(defId || ''))}`)
  if (!got.ok) throw refusedRead(got)
  if (!isRecord(got.data.plan)) throw Object.assign(new Error('failed'), { code: 'failed' })
  return got.data.plan
}

/** The member's own values for one whitelisted field (`setup`, `mistake`, `emotion`, `symbol`, `account`). */
export function loadVocabulary(field) {
  const key = String(field || '')
  if (!vocabLoads.has(key)) {
    vocabLoads.set(key, cached(async () => {
      const got = await getJson(`${DEFS_URL}/vocabulary?field=${encodeURIComponent(key)}`)
      if (!got.ok) throw refusedRead(got)
      return Array.isArray(got.data.values) ? got.data.values : []
    }, () => vocabLoads.delete(key)))
  }
  return vocabLoads.get(key)
}

/** The static catalog: sources and their fields, measures, views, range tokens with their labels, accents. */
export function loadCatalog() {
  if (!catalogLoad) {
    catalogLoad = cached(async () => {
      const got = await getJson(`${DEFS_URL}/vocabulary`)
      if (!got.ok) throw refusedRead(got)
      return got.data
    }, (v) => { catalogLoad = v })
  }
  return catalogLoad
}

/** Tests only: forget every cached read. */
export function __resetBuiltCaches() {
  accountsLoad = null
  catalogLoad = null
  vocabLoads.clear()
}
