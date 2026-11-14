// ── LAYOUT HISTORY: Layouts → Version history (the Charts board's saved versions, and restoring one) ────────────────
//
// What a member does by hand on the desktop Charts board: Layouts ▾ → Version history lists every save of the board
// (newest first, "Current" on the head); choosing an older one shows which parts of the board it would change, and
// Restore puts it back. The server (TERM-021, api/routers/workspace_doc.py) RESTORES BY APPENDING a copy of the chosen
// version as the new head — nothing in the history is deleted — compare-and-set on the head the caller read (a stale
// base is 409, nothing written). The board then re-reads its preferences and re-seeds itself (ChartsWorkspace's
// handleVersionRestored). The Agent goes through exactly those: the panel's own routes (pages/charts/versionHistoryApi.js)
// and the workspace's own re-seed (pages/charts/versionHistoryAgent.js). It never writes a preference or a layout.
//
//   layoutHistory.list      QUERY: the board's recent versions (number, when, how it came to be, which is current)
//   layoutHistory.restore   ALWAYS SHOWN FIRST (risk confirm; it replaces the whole board, so `exclusive`). The card
//                           names the version, when it was saved, and which parts of the board it changes. Read back:
//                           the server's new head is a restore OF that version with that version's content hash.
//                           Undo = restore the version that was current before (its own content hash read back) —
//                           exact for the board document, and refused (never forced) once the board has been saved again.
//
// ⛔ Dark store (404), the phone shell, Multi Chart: "not available here", no request is a write.
// ⛔ A version that matches the current board: "already matches", nothing sent, no Undo.

import { registerCapability, registerTargetKind, registerContextProvider, normalizeArgs } from '../capabilities'
import { diffPrefs, keyLabel, sourceLabel, listWorkspaceVersions, readWorkspaceVersion } from '../../pages/charts/versionHistoryApi'

const REF = 'boardVersions'
const LABEL = 'Board version history (Layouts → Version history)'
const LIST_LIMIT = 50
const SHOW_DEFAULT = 10
const SHOW_MAX = 25
const NOTHING = 'Nothing was changed.'
export const HISTORY_NOT_HERE = `Version history isn't available here: it is on the desktop Charts board (Layouts → Version history), not the phone app or Multi Chart. ${NOTHING}`
export const HISTORY_DARK = `Version history isn't turned on for your account yet, so there are no saved versions of your board to restore. ${NOTHING}`
const UNREADABLE = `I couldn't read your board's version history just now, so I won't restore anything. Try again in a moment. ${NOTHING}`
const STALE = 'your board was saved again after I read its history, so nothing was restored — ask again and I’ll show you the current list'

const quote = (s) => `“${s}”`
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// ── the server's list, read for planning; every write re-reads it first ──
const cache = { status: 'unknown', versions: [], at: 0, docs: new Map() }
export function _resetLayoutHistoryCache() { cache.status = 'unknown'; cache.versions = []; cache.at = 0; cache.docs = new Map() }

const slim = (v) => ({
  version: Number(v.version), createdAt: Number(v.created_at), source: v.source || null,
  restoredFrom: v.restored_from == null ? null : Number(v.restored_from), tombstone: !!v.tombstone, sha: v.content_sha256 || null,
})

// The host the Agent last read this kind on. The executor's `prepare` runs without a host, so it reads through this one
// (the same panel routes), and reads NOTHING when the last host has no Version history (phone, Multi Chart, other pages).
let lastHost = null
const hereOn = (host) => { try { return !!host?.layoutHistory?.read?.()?.here } catch { return false } }
const sourceFor = (host) => (host?.layoutHistory ? host.layoutHistory : { read: () => ({ here: true }), list: listWorkspaceVersions, readVersion: readWorkspaceVersion })

/** Re-read the board's versions from the server → 'ok' | 'dark' | 'error' | 'absent'. */
export async function loadHistory(host) {
  const src = sourceFor(host)
  if (host?.layoutHistory && !hereOn(host)) { cache.status = 'absent'; return cache.status }
  let r
  try { r = await src.list(LIST_LIMIT) } catch { r = { status: 0, ok: false } }
  if (r?.status === 404) { cache.status = 'dark'; cache.versions = []; return cache.status }
  if (!r?.ok || !Array.isArray(r.body?.versions)) { cache.status = 'error'; return cache.status }
  cache.versions = r.body.versions.map(slim).filter(v => Number.isFinite(v.version)).sort((a, b) => b.version - a.version)
  cache.status = 'ok'
  cache.at = Date.now()
  return cache.status
}

/** One version's stored preferences (null for a tombstone / no doc; undefined when unreadable). Versions never change. */
async function prefsOf(host, version) {
  if (cache.docs.has(version)) return cache.docs.get(version)
  let r
  try { r = await sourceFor(host).readVersion(version) } catch { r = null }
  if (!r?.ok || !r.body) return undefined
  const prefs = r.body.tombstone ? null : (r.body.doc?.prefs || null)
  cache.docs.set(version, prefs)
  return prefs
}

const etStamp = (sec) => {
  try {
    return new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
  } catch { return '' }
}
const verLabel = (v) => `version ${v.version} (${etStamp(v.createdAt)}, ${sourceLabel({ source: v.source, restored_from: v.restoredFrom }).replace(/^./, c => c.toLowerCase())})`

/** Seconds since the epoch of a New York wall-clock moment. */
function etEpoch(y, mo, d, h, mi, s) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess))
    const g = (t) => Number(parts.find(p => p.type === t)?.value)
    const off = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - guess
    return Math.floor((guess - off) / 1000)
  } catch { return Math.floor(guess / 1000) }
}
/** "2026-11-13" (that whole day, ET) or "2026-11-13T09:30" (ET) → epoch seconds, or null. */
export function beforeMoment(text) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?\s*$/.exec(String(text || ''))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return m[4] != null ? etEpoch(y, mo, d, Number(m[4]), Number(m[5]), 59) : etEpoch(y, mo, d, 23, 59, 59)
}

const asksFor = (args) => [args?.version, args?.stepsBack, args?.before].filter(v => v != null && v !== '').length
/** The version the member's words name, against the list → { target } | { refuse }. */
function resolveTarget(versions, args) {
  const head = versions[0]
  const usable = versions.filter(v => !v.tombstone)
  if (!head) return { refuse: `Your board has no saved versions yet. ${NOTHING}` }
  if (head.tombstone) return { refuse: `Your board's history was cleared, so there is no version to restore from here. Use Layouts → Version history. ${NOTHING}` }
  if (asksFor(args) > 1) return { refuse: `Name the version one way: its number, how many saves back, or a date. ${NOTHING}` }
  let target = null
  if (args?.version != null) {
    const n = Number(args.version)
    target = versions.find(v => v.version === n) || null
    if (!target) return { refuse: `There is no version ${n} in your board's recent history (the newest ${versions.length} are kept here; Layouts → Version history shows them). ${NOTHING}` }
    if (target.tombstone) return { refuse: `Version ${n} is where the history was cleared, not a board, so it can't be restored. ${NOTHING}` }
  } else if (args?.stepsBack != null) {
    const k = Math.trunc(Number(args.stepsBack))
    if (!(k >= 1)) return { refuse: `How many saves back? (1 = the version before the current one.) ${NOTHING}` }
    const older = usable.filter(v => v.version < head.version)
    target = older[k - 1] || null
    if (!target) return { refuse: `Your board's history doesn't go back ${plural(k, 'save')} — it has ${plural(older.length, 'earlier version')}. ${NOTHING}` }
  } else if (args?.before) {
    const t = beforeMoment(args.before)
    if (t == null) return { refuse: `I couldn't read the date ${quote(args.before)}. ${NOTHING}` }
    if (t * 1000 > Date.now() + 60_000) return { refuse: `That moment hasn't happened yet, so there is no version from then. ${NOTHING}` }
    target = usable.find(v => v.createdAt <= t) || null
    if (!target) return { refuse: `Your board's history doesn't go back that far — the oldest version kept here is ${verLabel(usable[usable.length - 1] || head)}. ${NOTHING}` }
  } else {
    const shown = usable.slice(0, 5).map(v => `${verLabel(v)}${v === head ? ' — current' : ''}`).join('; ')
    return { refuse: `Which version should I restore? The latest: ${shown}. Say a version number, how many saves back, or a date. ${NOTHING}` }
  }
  if (target.version === head.version) return { refuse: `Version ${head.version} is your current board, so there is nothing to restore. ${NOTHING}` }
  return { target, head }
}

function readSnap(host) {
  if (host) lastHost = host                      // a host without Version history too: prepare then reads nothing
  if (!host?.layoutHistory) return null
  const here = hereOn(host)
  const head = cache.status === 'ok' ? (cache.versions[0] || null) : null
  return { ref: REF, label: LABEL, here, status: here ? cache.status : 'absent', head: head ? { ...head } : null }
}
const headSig = (h) => (h ? `${h.version}:${h.sha || ''}:${h.source || ''}:${h.restoredFrom ?? ''}` : 'none')

export const layoutHistoryKind = {
  name: 'layoutHistory',
  source: 'layoutHistory',
  boardScoped: false,            // a restore replaces the board (and may switch the open layout's name): the history is the target
  selfDescribing: true,
  unavailable: HISTORY_NOT_HERE,
  list: (host) => { const s = readSnap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? readSnap(host) : null),
  stateOf: (s) => ({ ...s, want: null }),
  patch: (before, after) => (after.want ? { restore: { ...after.want } } : null),
  async commit(host, ref, patch) {
    const want = patch?.restore
    const src = host?.layoutHistory
    if (!want || !src) throw new Error('the version history is not on this page')
    // The CURRENT head (never the planning read): saved again since → refused, never restored over.
    const st = await loadHistory(host)
    const head = cache.versions[0]
    if (st !== 'ok' || !head) throw Object.assign(new Error(UNREADABLE), { complete: true })
    if (head.version !== want.base || (want.baseSha && head.sha !== want.baseSha)) {
      throw Object.assign(new Error(`That couldn't run — ${STALE}.`), { complete: true })
    }
    const r = await src.restore(want.version, want.base)
    if (r?.status === 409) throw Object.assign(new Error(`That couldn't run — ${STALE}.`), { complete: true })
    if (r?.status === 404) throw Object.assign(new Error(`Version ${want.version} is no longer kept, so nothing was restored. ${NOTHING}`), { complete: true })
    if (!r?.ok || !r.body) throw new Error('the restore did not go through')
    // READ BACK from the server: the new head is a restore OF that version, with that version's content
    await loadHistory(host)
    const now = cache.versions[0]
    if (!now || now.source !== 'restore' || now.restoredFrom !== want.version || (want.sha && now.sha !== want.sha)) {
      throw new Error(`the server did not show version ${want.version} as restored`)
    }
    const failed = Array.isArray(r.body.prefs_failed) ? r.body.prefs_failed : []
    if (failed.length) {
      const e = new Error(`Version ${want.version} was restored except ${failed.map(keyLabel).join(', ')}, which kept the current value. Try again, or use Layouts → Version history.`)
      e.complete = true
      e.unreverted = true
      throw e
    }
    return { undoData: { version: want.base, sha: want.baseSha || null, base: now.version, baseSha: now.sha || null } }
  },
  landed(snap, patch) {
    const w = patch?.restore
    const h = snap?.head
    if (!w || !h) return false
    return h.source === 'restore' && h.restoredFrom === w.version && (!w.sha || h.sha === w.sha)
  },
  // Undo = restore the version that was current before, compare-and-set on the head this restore made.
  undoPatch: (item) => {
    const d = item?.undoData
    return d && d.version != null && d.base != null ? { restore: { version: d.version, sha: d.sha, base: d.base, baseSha: d.baseSha } } : null
  },
  // Planning never trips on the history moving (the board saves itself as the member works): the plan carries the head it
  // was made on (`base`), the write re-reads the server and refuses a moved head, and the server's restore is itself
  // compare-and-set. Undo is narrowed to the head THIS restore made: once the board is saved again, Undo refuses.
  fingerprint: () => 'boardVersions',
  fingerprintFor: (host, snap, item) => (item?.undoData ? headSig(snap?.head) : 'boardVersions'),
  // ⛔ APPROVAL BINDING: "do it" re-reads the history from the server first; unreadable → the approval fails closed
  async refreshForApproval(host) {
    const st = await loadHistory(host)
    return st === 'ok' ? { ok: true } : { ok: false, what: 'your board’s version history' }
  },
}

let registered = false
export function registerLayoutHistoryCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(layoutHistoryKind)
  registerContextProvider({
    key: 'layoutHistory',
    build: (host, refFor) => {
      const s = readSnap(host)
      if (!s || !s.here) return undefined
      return [{ ref: refFor('layoutHistory', REF), label: 'Board version history' }]
    },
  })

  registerCapability({
    name: 'layoutHistory.list',
    target: 'layoutHistory', query: true, surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    summary: 'List the saved versions of the Charts board (Layouts → Version history): number, when, how each came to be, which is current. Answered from the server.',
    hints: 'count = how many to show (default 10), else null.',
    args: { type: 'object', properties: { count: { type: ['integer', 'null'] } }, required: ['count'], additionalProperties: false },
    argAliases: { count: ['limit', 'n'] },
    async answer(snap, args, host) {
      if (!snap || !snap.here) return HISTORY_NOT_HERE
      const st = await loadHistory(host)
      if (st === 'dark') return HISTORY_DARK
      if (st !== 'ok') return UNREADABLE
      const all = cache.versions
      if (!all.length) return 'Your board has no saved versions yet. One is kept each time your board is saved.'
      const n = Math.max(1, Math.min(SHOW_MAX, Math.trunc(Number(args?.count) || SHOW_DEFAULT)))
      const rows = all.slice(0, n).map((v, i) => `Version ${v.version} — ${etStamp(v.createdAt)} · ${sourceLabel({ source: v.source, restored_from: v.restoredFrom })}${i === 0 ? ' (current)' : ''}`)
      const more = all.length > n ? `\n…and ${plural(all.length - n, 'older version')}.` : ''
      return `${rows.join('\n')}${more}\nI can restore one of these (I'll show you what it changes first). Restoring adds it back as a new version; nothing is deleted.`
    },
  })

  registerCapability({
    name: 'layoutHistory.restore',
    target: 'layoutHistory', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    risk: 'confirm',
    exclusive: true,
    exclusiveReason: 'Restoring a version replaces the whole board, so do it on its own: restore first, then ask for the changes.',
    summary: 'Restore an earlier saved version of the Charts board (Layouts → Version history): always shown first with what it changes. Added back as a new version, nothing deleted. Undo restores the version that was current.',
    hints: 'Exactly one of: version = its number; stepsBack = saves before the current one (1 = previous version); before = "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" ET, the board as it was then. Others null.',
    args: { type: 'object', properties: {
      version: { type: ['integer', 'null'] },
      stepsBack: { type: ['integer', 'null'] },
      before: { type: ['string', 'null'] },
    }, required: ['version', 'stepsBack', 'before'], additionalProperties: false },
    argAliases: { version: ['versionNumber', 'v'], stepsBack: ['back', 'steps', 'savesBack'], before: ['at', 'asOf', 'date', 'when'] },
    // the server's list (re-read) and, for the version each op names, its stored preferences against the head's
    async prepare(ops) {
      if (lastHost && !hereOn(lastHost)) return { layoutHistory: { status: 'absent', byKey: new Map() } }
      return { layoutHistory: await resolveLayoutHistoryOps(lastHost, ops) }
    },
    check(st, args, env) {
      if (!st || !st.here) return HISTORY_NOT_HERE
      const res = env?.layoutHistory
      if (!res) return UNREADABLE
      if (res.status === 'absent') return HISTORY_NOT_HERE
      if (res.status === 'dark') return HISTORY_DARK
      if (res.status !== 'ok') return UNREADABLE
      const r = res.byKey.get(keyOf(args))
      if (!r) return UNREADABLE
      if (r.refuse) return r.refuse
      if (r.diff === undefined) return `I couldn't read ${verLabel(r.target)} just now, so I won't restore it. ${NOTHING}`
      if (!r.diff.changes.length) return `${verLabel(r.target).replace(/^./, c => c.toUpperCase())} already matches your current board, so there is nothing to restore. ${NOTHING}`
      return null
    },
    apply(st, args, env) {
      const r = env.layoutHistory.byKey.get(keyOf(args))
      return { ...st, want: { version: r.target.version, sha: r.target.sha, base: r.head.version, baseSha: r.head.sha, createdAt: r.target.createdAt, source: r.target.source, restoredFrom: r.target.restoredFrom, changes: r.diff.changes, kept: r.diff.kept } }
    },
    describe(b, a) {
      const w = a.want
      if (!w) return null
      const changes = w.changes.map(keyLabel).join(', ')
      const kept = w.kept.length ? `; kept as they are now: ${w.kept.map(keyLabel).join(', ')}` : ''
      return `Restored your board to ${verLabel({ version: w.version, createdAt: w.createdAt, source: w.source, restoredFrom: w.restoredFrom })} — changes ${changes}${kept}. Version ${w.base} (your board before this) stays in the history`
    },
  })
}

// one key per request, on the args as the planner will see them (aliases / coercion applied)
const keyOf = (a) => JSON.stringify([a?.version ?? null, a?.stepsBack ?? null, a?.before ?? null])

/** Each op's named version, resolved against a fresh read of the list → { status, byKey: Map(key → { target, head, diff } | { refuse }) }. */
export async function resolveLayoutHistoryOps(host, ops) {
  const byKey = new Map()
  const status = await loadHistory(host)
  if (status !== 'ok') return { status, byKey }
  for (const o of ops) {
    let args = o?.args && typeof o.args === 'object' ? o.args : {}
    try { args = normalizeArgs(o.action, args).args || args } catch { /* the planner's shape check refuses it */ }
    const key = keyOf(args)
    if (byKey.has(key)) continue
    const r = resolveTarget(cache.versions, args)
    if (r.refuse) { byKey.set(key, r); continue }
    const [t, h] = await Promise.all([prefsOf(host, r.target.version), prefsOf(host, r.head.version)])
    byKey.set(key, { ...r, diff: t === undefined || h === undefined ? undefined : diffPrefs(t, h) })
  }
  return { status, byKey }
}
