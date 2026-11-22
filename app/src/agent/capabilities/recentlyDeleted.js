// ── RECENTLY DELETED: bring back a watchlist, a saved layout or a saved screen the member deleted ─────────────────────
//
// The product's own feature (COV-06 follow-up, `ARTIFACT_VERSIONS_ENABLED`, armed on web since 2026-10-02): a delete
// leaves a TOMBSTONE in the artefact's version history, so the history outlives it. The Layout library, the Screens menu
// and Watchlists → My Lists each show "Recently deleted (n)" with a "Bring back" button
// (components/artifactHistory/RecentlyDeleted.jsx). The Agent reads and writes ONLY through the same routes that panel
// uses (api/routers/artifact_versions.py, owner-scoped, screens paid):
//   GET  /api/artifact-versions/{kind}/deleted          my artefacts of this kind that no longer exist but kept a history
//   GET  /api/artifact-versions/{kind}/{id}             one artefact's versions (head first)
//   POST /api/artifact-versions/{kind}/{id}/undelete    {version, base_version}: recreate it under its OLD id from that
//                                                       version, compare-and-set on the head (409 on a stale head)
// What "Bring back" does, measured from its code: it restores the NEWEST kept version (how it was when it was deleted),
// unpublished / unshared; a layout whose name the member has used since comes back as "<name> (restored)". Nothing is
// ever overwritten: an artefact that exists again is a 409.
//
//   kind 'recentlyDeleted'        ONE target (ref 'deleted'): the three kinds' deleted lists, read together
//   recentlyDeleted.list          QUERY — what is in Recently deleted (one kind, or all three)
//   recentlyDeleted.restore       bring ONE item back (one op per item, at most 5 in one request); always shown first.
//                                 The item is named deterministically (its id, or a name that fits exactly ONE deleted
//                                 item); two that fit → asked with the real names, nothing changed.
//                                 Read back: it is gone from Recently deleted AND present in its own list again.
//                                 NO Undo (PL decision 2026-11-19: a member's Undo never deletes a list, layout or
//                                 screen): the receipt says how to reverse it — delete it as usual, and it goes back to
//                                 Recently deleted. Only a request that fails PART-WAY takes back what it had brought back
//                                 (all or nothing, as every creator's compensation), through the kind's own delete, only
//                                 while unchanged, never the open layout, never a list a Watchlist widget is showing.
//
// ⛔ Not here: "Earlier versions" of a deleted item (only the newest, as the panel's Bring back), version history of a
// LIVE artefact (the board's Version history is layoutHistory.*), anything not the member's own.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { ARTIFACT_VERSIONS_URL, requestJson } from '../../components/artifactHistory/ArtifactHistory'
import { loadSaved, savedScreensNow } from './screener'
import { afterRender } from '../frames'

export const DELETED_KINDS = ['watchlist', 'layout', 'screen']
const NOUN = { watchlist: 'watchlist', layout: 'layout', screen: 'saved screen' }
const PLURAL = { watchlist: 'watchlists', layout: 'layouts', screen: 'saved screens' }
const MAX_RESTORES = 5
const SHOW_IN_CONTEXT = 15
const TTL_MS = 20_000
const SCREEN_ROUTE = '/api/screener/saved-screens'
const enc = encodeURIComponent
const quote = (n) => `“${n}”`
const norm = (s) => String(s ?? '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/[^a-z0-9%$&+]+/g, ' ').trim()
const send = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const nextFrame = afterRender
async function waitFor(fn, budgetMs = 5000) {
  const t0 = Date.now()
  for (;;) {
    if (fn()) return true
    if (Date.now() - t0 > budgetMs) return false
    await nextFrame()
  }
}

// ── the three deleted lists, cached for planning; every write re-reads them first ──
// status per kind: 'ok' | 'off' (404: the store is not armed — every route answers 404) | 'paid' (402: screens) | 'error'
const cache = { rows: null, status: null, at: 0, p: null }
export function _resetRecentlyDeleted() { cache.rows = null; cache.status = null; cache.at = 0; cache.p = null }
const statusOf = (r) => (r.ok && Array.isArray(r.body?.deleted) ? 'ok' : r.status === 404 ? 'off' : r.status === 402 ? 'paid' : 'error')
const slim = (kind, x) => ({ kind, id: String(x.artifact_id), label: String(x.label || `Untitled ${NOUN[kind]}`), head: Number(x.head), deletedAt: x.deleted_at ?? null })
export function loadDeleted({ force = false } = {}) {
  if (!force && cache.rows && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache)
  if (!cache.p) {
    cache.p = Promise.all(DELETED_KINDS.map(k => requestJson(`${ARTIFACT_VERSIONS_URL}/${k}/deleted`, { cache: 'no-store' }))).then(res => {
      const status = Object.fromEntries(DELETED_KINDS.map((k, i) => [k, statusOf(res[i])]))
      cache.status = status
      cache.rows = DELETED_KINDS.flatMap((k, i) => (status[k] === 'ok' ? res[i].body.deleted.map(x => slim(k, x)).filter(x => x.id && Number.isFinite(x.head)) : []))
      cache.at = Date.now()
      return cache
    }).finally(() => { cache.p = null })
  }
  return cache.p
}

// "Nov 18, 3:04 PM ET" — the server's `deleted_at` is epoch seconds (an ISO string is read too)
export function deletedStamp(at) {
  if (at == null) return null
  const d = typeof at === 'number' || /^\d+(\.\d+)?$/.test(String(at)) ? new Date(Number(at) * 1000) : new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

// ── what is LIVE in each kind's own list (the read-back of a restore): null = not readable on this page ──
function liveIds(host) {
  const w = host?.watchlists?.snapshot ? host.watchlists.snapshot().map(l => String(l.id)) : null
  const l = host?.layouts?.snapshot ? (host.layouts.snapshot().entries || []).filter(e => (e.scope || 'user') === 'user').map(e => String(e.id)) : null
  const s = savedScreensNow() ? savedScreensNow().saved.map(x => String(x.id)) : null
  return { watchlist: w, layout: l, screen: s }
}

function libSnap(host) {
  const status = cache.status || null
  const off = !!status && DELETED_KINDS.every(k => status[k] === 'off')
  return { ref: 'deleted', label: 'Recently deleted', loaded: !!cache.rows, off, status, rows: cache.rows || [], live: liveIds(host) }
}
const itemWord = (r) => `${quote(r.label)} (${NOUN[r.kind]}${deletedStamp(r.deletedAt) ? `, deleted ${deletedStamp(r.deletedAt)}` : ''})`
const kindsWord = (kind) => (kind ? PLURAL[kind] : 'watchlists, layouts or saved screens')

/**
 * The ONE deleted item the words name → { row } or { why }. An id ("12", "watchlist:12") is exact; otherwise a name: the
 * exact name (a trailing "watchlist" / "layout" / "screen" word dropped), else every item whose name holds all the words.
 * Two or more → asked with the real names; none → said, with what IS there. Never picked by similarity.
 */
export function resolveDeleted(rows, item, kind = null) {
  const pool = (rows || []).filter(r => !kind || r.kind === kind)
  const raw = String(item ?? '').trim()
  const where = `your recently deleted ${kindsWord(kind)}`
  if (!raw) return { why: `Which one should I bring back? ${pool.length ? `In ${where}: ${pool.slice(0, 6).map(itemWord).join(', ')}.` : `There is nothing in ${where}.`}` }
  const byId = pool.filter(r => r.id === raw || `${r.kind}:${r.id}` === raw)
  if (byId.length === 1) return { row: byId[0] }
  const bare = norm(raw).replace(/^(?:my|the|our)\s+/, '').replace(/^(?:deleted|recently deleted)\s+/, '')
    .replace(/\s+(?:watch ?lists?|lists?|layouts?|saved screens?|screens?|scans?)$/, '').trim()
  const exact = pool.filter(r => norm(r.label) === bare || norm(r.label) === norm(raw))
  const words = bare.split(' ').filter(w => w.length >= 2)
  const hits = exact.length ? exact : (words.length ? pool.filter(r => { const n = ` ${norm(r.label)} `; return words.every(w => n.includes(` ${w} `)) }) : [])
  if (hits.length === 1) return { row: hits[0] }
  if (hits.length > 1) return { why: `Which one do you mean: ${hits.slice(0, 6).map(itemWord).join(' or ')}? Nothing was changed.` }
  return { why: pool.length
    ? `${quote(raw)} isn't in ${where}. What's there: ${pool.slice(0, 6).map(itemWord).join(', ')}${pool.length > 6 ? ` and ${pool.length - 6} more` : ''}.`
    : `There is nothing in ${where}${kind ? '' : ' right now'}, so there is nothing to bring back.` }
}

/** Why the store can't be used now (or null). `kind`: the one asked about, if any. */
function storeProblem(st, kind = null) {
  if (!st.loaded) return "I couldn't read your recently deleted items right now — nothing was changed. Try again in a moment."
  if (st.off) return "Recently deleted isn't available on your account right now, so there is nothing I can bring back."
  if (kind && st.status?.[kind] === 'paid') return 'Saved screens need a paid plan.'
  if (kind && st.status?.[kind] && st.status[kind] !== 'ok') return `I couldn't read your recently deleted ${PLURAL[kind]} right now — nothing was changed.`
  return null
}
const sourceMissing = (st, kind) => (st.live?.[kind] == null
  ? (kind === 'screen' ? "Your saved screens aren't loaded yet — try again in a moment." : `${kind === 'watchlist' ? 'Watchlists' : 'Layouts'} aren't available on this page — open Charts to bring back a ${NOUN[kind]}.`)
  : null)

// ── after a write: the kind's own list becomes what every surface (and the read-back) shows ──
async function settleKind(host, kind, id, present) {
  if (kind === 'watchlist') {
    const W = host.watchlists
    if (present) await (W.revive ? W.revive(id) : W.settle(id))
    await nextFrame()
    return
  }
  if (kind === 'layout') {
    try { await host.layouts.refresh() } catch { /* landed() reads what the dock holds */ }
    await waitFor(() => (host.layouts.snapshot().entries || []).some(e => String(e.id) === String(id)) === present)
    return
  }
  await loadSaved({ force: true })
}

// Compensation of a request that failed part-way (never a member's Undo): what it had brought back goes back to Recently
// deleted, through the kind's own delete, only while unchanged since.
async function sendBack(host, items) {
  for (const it of items) {
    const h = await requestJson(`${ARTIFACT_VERSIONS_URL}/${it.kind}/${enc(it.id)}`, { cache: 'no-store' })
    if (!h.ok || !h.body) throw new Error(`I couldn't check ${quote(it.name)} before taking it back`)
    if (it.version != null && Number(h.body.head) !== Number(it.version)) throw new Error(`${quote(it.name)} changed since I brought it back — I won't delete your newer edits`)
    if (it.kind === 'watchlist') {
      const W = host.watchlists
      const now = (W.snapshot() || []).find(l => String(l.id) === String(it.id))
      if (now?.shownIn?.length) throw new Error(`${quote(it.name)} is showing in a Watchlist widget on this board now`)
      await W.deleteList(it.id)
    } else if (it.kind === 'layout') {
      const L = host.layouts
      if (String(L.snapshot().active?.id ?? '') === String(it.id)) throw new Error(`${quote(it.name)} is the layout open now — open another layout first`)
      await L.remove(it.id)
      await settleKind(host, 'layout', it.id, false)
    } else {
      const r = await requestJson(`${SCREEN_ROUTE}/${enc(it.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`taking ${quote(it.name)} back did not go through`)
      await loadSaved({ force: true })
    }
  }
  await loadDeleted({ force: true })
  return true
}

// What a restore made, carried to its compensation: "kind|id|version|name" per item (one string each: `created` is alias → ref).
const packed = (it) => [it.kind, it.id, it.version ?? '', it.name].join('|')
const unpack = (s) => { const [kind, id, version, ...name] = String(s).split('|'); return { kind, id, version: version === '' ? null : Number(version), name: name.join('|') } }

export const recentlyDeletedKind = {
  name: 'recentlyDeleted',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => [libSnap(host)],
  read: (host, ref) => (ref === 'deleted' ? libSnap(host) : null),
  stateOf: (snap) => ({ ...snap, restores: [] }),
  patch: (before, after) => (after.restores.length ? { restore: after.restores } : null),
  async commit(host, ref, patch) {
    if (patch.sendBack) return sendBack(host, patch.sendBack)
    // The CURRENT lists (never the plan's cache): an item brought back elsewhere, or deleted again since, is refused.
    const fresh = await loadDeleted({ force: true })
    const created = {}
    const lines = []
    for (const r of patch.restore) {
      const fail = (msg) => { const e = new Error(msg); e.created = { ...created }; return e }
      if (fresh.status?.[r.kind] !== 'ok') throw fail(`your recently deleted ${PLURAL[r.kind]} could not be read`)
      const row = fresh.rows.find(x => x.kind === r.kind && x.id === r.id)
      if (!row) throw fail(`${quote(r.label)} is no longer in Recently deleted — it may already be back`)
      if (row.head !== r.head) throw fail(`${quote(r.label)} changed since I read it — ask again`)
      const res = await requestJson(`${ARTIFACT_VERSIONS_URL}/${r.kind}/${enc(r.id)}/undelete`, send({ version: r.head, base_version: r.head }))
      if (!res.ok || !res.body) {
        throw fail(res.status === 409 ? `${quote(r.label)} changed or is already back, so nothing was restored`
          : res.status === 402 ? 'saved screens need a paid plan' : `bringing back ${quote(r.label)} did not go through`)
      }
      const name = String(res.body.artifact?.name ?? r.label)
      created[`deleted:${r.kind}:${r.id}`] = packed({ kind: r.kind, id: r.id, version: res.body.version ?? null, name })
      await settleKind(host, r.kind, r.id, true)
      // ⭐ the receipt says what the server did — including a layout renamed because the name was taken since
      lines.push(`Brought back your ${NOUN[r.kind]} ${quote(name)}${name !== r.label ? ` (you already have one named ${quote(r.label)})` : ''}, as it was when it was deleted. It comes back private. To remove it again, delete it as usual; it goes back to Recently deleted.`)
    }
    await loadDeleted({ force: true })
    return { created, lines }
  },
  landed(snap, patch) {
    if (!snap) return false
    const back = patch.sendBack || null
    if (back) return back.every(it => !(snap.live?.[it.kind] || []).includes(String(it.id)))
    return patch.restore.every(r => (snap.live?.[r.kind] || []).includes(r.id) && !snap.rows.some(x => x.kind === r.kind && x.id === r.id))
  },
  // ⛔ No Undo: a member's Undo never deletes a list, layout or screen (the receipt says how to reverse it)
  undoPatch: () => null,
  // a request that failed part-way takes back exactly what it had brought back (sendBack re-checks each one first)
  compensatePatch(item) {
    const made = Object.values(item.created || item.partial || {}).map(unpack)
    return made.length ? { sendBack: made } : null
  },
  // Planning never trips on the lists moving (another delete elsewhere): the write re-reads them, compare-and-set.
  fingerprint: () => 'deleted',
  // ⛔ APPROVAL BINDING: the card binds its PATCH — each item's kind, id and version head — and Apply re-reads the lists and
  // sends that head as the compare-and-set base, so an item deleted again, brought back elsewhere or changed since is refused
  // there. (The lists themselves are not the material state: a snapshot taken before they were read would void every card.)
  async refreshForApproval() {
    try { await loadDeleted({ force: true }); return { ok: true } } catch { return { ok: false, what: 'your recently deleted items' } }
  },
}

// ── words: the member asks about Recently deleted (the context shows the items only then) ──
export const DELETED_WORDS = /\b(?:recently deleted|undelet\w*|deleted|i (?:just )?(?:deleted|removed)|bring (?:\w+ ){0,6}?back|trash)\b/i
const KIND_OF = { watchlist: 'watchlist', 'watch list': 'watchlist', list: 'watchlist', layout: 'layout', screen: 'screen', 'saved screen': 'screen', scan: 'screen' }
const kindWord = (w) => KIND_OF[norm(w).replace(/s$/, '')] ?? null
const KIND_RE = '(watch ?lists?|lists?|layouts?|saved screens?|screens?|scans?)'
const LEAD = '(?:please )?(?:can you |could you )?'
// "bring back / undelete my Momentum watchlist", "restore my deleted Swing layout", "recover the screen called Breakouts"
const RESTORE_FAST = [
  new RegExp(`^${LEAD}(bring back|undelete|restore|recover|get back)\\s+(?:my |the )?(deleted |recently deleted )?${KIND_RE}\\s+(?:called |named )?(.+?)$`, 'i'),
  new RegExp(`^${LEAD}(bring back|undelete|restore|recover|get back)\\s+(?:my |the )?(deleted |recently deleted )?(.+?)\\s+${KIND_RE}(?: (?:that )?i (?:just )?deleted)?$`, 'i'),
  new RegExp(`^${LEAD}(bring|get)\\s+(?:my |the )?(deleted |recently deleted )?(.+?)\\s+${KIND_RE}\\s+back$`, 'i'),
]
function fastRestore({ raw, lower }) {
  // matched on the member's own text (case kept: the item's name is theirs), verbs and kinds read lowercased
  const t = String(raw ?? lower ?? '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  for (const [i, re] of RESTORE_FAST.entries()) {
    const m = re.exec(t)
    if (!m) continue
    const [verb, deleted] = [m[1].toLowerCase(), !!m[2]]
    const [kw, name] = i === 0 ? [m[3], m[4]] : [m[4], m[3]]
    const kind = kindWord(kw)
    const item = String(name || '').trim()
    if (!kind || !item || /^(?:it|that|this|one|them|those)$/i.test(item)) return null
    // Without "deleted" / "undelete" the words can also mean a VERSION ("restore my layout") or a switch ("bring back my
    // Swing layout" while Swing is still in the library): claimed only when exactly ONE item in Recently deleted fits —
    // an unread list, none or several is the model's (it sees the real items, and asks)
    if (!deleted && verb !== 'undelete' && (!cache.rows || resolveDeleted(cache.rows, item, kind).why)) return null
    return { item, kind }
  }
  return null
}
const LIST_FAST = new RegExp(`^${LEAD}(?:(?:show|list|open)(?: me)?(?: all)?(?: of)? (?:my |the )?(?:recently deleted|deleted)(?: ${KIND_RE}| items| things| stuff)?|what(?: is|'s| are)? in (?:my )?recently deleted|what (?:have|did) i (?:recently )?delete(?:d)?(?: recently| lately)?)$`)
function fastList({ lower }) {
  const t = String(lower || '').trim().replace(/[.!?]+$/, '')
  const m = LIST_FAST.exec(t)
  if (!m) return null
  return { kind: m[1] ? kindWord(m[1]) : null }
}

let registered = false
export function registerRecentlyDeletedCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(recentlyDeletedKind)
  // The items are shown only when the member asks about deleted things (DELETED_WORDS): the model names an item by its real
  // id, never from memory. The lists are re-read before a turn routed with `layoutBar`, the group recentlyDeleted.* rides in
  // (refreshGroup; routing.js RECENTLY_DELETED_WORDS add that group).
  registerContextProvider({
    key: 'recentlyDeleted',
    refreshGroup: 'layoutBar',
    refresh: () => loadDeleted({ force: true }),
    compact: (list) => (list || []).slice(0, 1),
    build: (host, refFor, { message = '', nl1 = false } = {}) => {
      if (!cache.rows) return undefined
      if (!nl1 && !DELETED_WORDS.test(message)) return undefined
      const s = libSnap(host)
      if (s.off) return undefined
      return [{
        ref: refFor('recentlyDeleted', 'deleted'), label: 'Recently deleted (bring back a deleted watchlist, layout or saved screen)',
        items: s.rows.slice(0, SHOW_IN_CONTEXT).map(r => ({ kind: r.kind, item: r.id, name: r.label, ...(deletedStamp(r.deletedAt) ? { deleted: deletedStamp(r.deletedAt) } : {}) })),
        ...(s.rows.length > SHOW_IN_CONTEXT ? { more: s.rows.length - SHOW_IN_CONTEXT } : {}),
      }]
    },
  })

  // ── recentlyDeleted.list (QUERY) ──
  registerCapability({
    name: 'recentlyDeleted.list',
    surfaces: ['charts'],
    target: 'recentlyDeleted', query: true,
    summary: 'Show what is in the member\'s Recently deleted: watchlists, saved layouts and saved screens they deleted that can still be brought back. '
      + 'Use this for "what have I deleted?", "show my recently deleted lists", "can I get my deleted layout back?".',
    hints: 'target = the ref of the recentlyDeleted entry. kind: watchlist | layout | screen, or null for all three.',
    args: { type: 'object', properties: { kind: { type: ['string', 'null'], enum: ['watchlist', 'layout', 'screen', null] } }, required: ['kind'], additionalProperties: false },
    coerce: { kind: { list: 'watchlist', lists: 'watchlist', watchlists: 'watchlist', layouts: 'layout', screens: 'screen', scan: 'screen', scans: 'screen', all: null } },
    fastWhole: true,
    fast: fastList,
    async answer(_snap, { kind }, host) {
      try { await loadDeleted({ force: true }) } catch { /* said below */ }
      const st = libSnap(host)
      const why = storeProblem(st, kind || null)
      if (why) return why
      const kinds = (kind ? [kind] : DELETED_KINDS).filter(k => st.status?.[k] === 'ok')
      const rows = st.rows.filter(r => kinds.includes(r.kind))
      const unread = (kind ? [] : DELETED_KINDS.filter(k => st.status?.[k] !== 'ok' && st.status?.[k] !== 'off'))
      const tail = unread.length ? ` (I couldn't read your deleted ${unread.map(k => PLURAL[k]).join(' or ')}${unread.includes('screen') && st.status.screen === 'paid' ? ' — saved screens need a paid plan' : ''}.)` : ''
      if (!rows.length) return `There is nothing in your recently deleted ${kindsWord(kind)}.${tail}`
      const block = (k) => {
        const xs = rows.filter(r => r.kind === k)
        return xs.length ? [`${PLURAL[k][0].toUpperCase()}${PLURAL[k].slice(1)} (${xs.length}):`, ...xs.slice(0, 20).map(r => `• ${quote(r.label)}${deletedStamp(r.deletedAt) ? ` — deleted ${deletedStamp(r.deletedAt)}` : ''}`), ...(xs.length > 20 ? [`…and ${xs.length - 20} more.`] : [])].join('\n') : null
      }
      return `Recently deleted — say “bring back …” to restore one, as it was when it was deleted:\n\n${kinds.map(block).filter(Boolean).join('\n\n')}${tail}`
    },
  })

  // ── recentlyDeleted.restore ──
  registerCapability({
    name: 'recentlyDeleted.restore',
    surfaces: ['charts'],
    target: 'recentlyDeleted',
    risk: 'confirm',
    // ⛔ no Undo (PL decision 2026-11-19): a member's Undo never deletes a list, layout or screen — deleting it as usual
    // reverses a restore (it goes back to Recently deleted), and the receipt says so
    undo: 'none',
    createsResource: true,
    summary: 'Bring back ONE watchlist, saved layout or saved screen the member deleted, from Recently deleted — as it was when it was deleted '
      + '(the same as its Bring back button). It comes back private; nothing existing is replaced. Not for undoing an edit of something that still exists.',
    hints: 'target = the ref of the recentlyDeleted entry; item = the item value of ONE entry in its items (never invent one); kind = that entry\'s kind. '
      + 'One op per item, at most 5. "All my deleted lists except X" = one op per listed watchlist but X. If two items could be meant, clarify with their names as choices — never pick one. '
      + 'Bringing something back is always shown first, so plan it (disposition propose). If the items are not shown, use recentlyDeleted.list first.',
    args: {
      type: 'object',
      properties: { item: { type: 'string' }, kind: { type: ['string', 'null'], enum: ['watchlist', 'layout', 'screen', null] } },
      required: ['item', 'kind'], additionalProperties: false,
    },
    argAliases: { item: ['name', 'id', 'artifact_id'] },
    coerce: { kind: { list: 'watchlist', lists: 'watchlist', watchlists: 'watchlist', layouts: 'layout', screens: 'screen', scan: 'screen', scans: 'screen' } },
    fastWhole: true,
    fast: fastRestore,
    // the CURRENT lists before planning (the target snapshot may be an older cache): check and apply read the cache
    async prepare() {
      const [ok] = await Promise.all([loadDeleted({ force: true }).then(() => true, () => false), loadSaved().catch(() => null)])
      return { deletedFresh: ok }
    },
    check(st, { item, kind }) {
      const cur = { ...st, ...(cache.rows ? { loaded: true, rows: cache.rows, status: cache.status, off: DELETED_KINDS.every(k => cache.status?.[k] === 'off') } : {}) }
      const store = storeProblem(cur, kind || null)
      if (store) return store
      const { row, why } = resolveDeleted(cur.rows, item, kind || null)
      if (why) return why
      if (cur.status?.[row.kind] !== 'ok') return storeProblem(cur, row.kind)
      // saved screens are read by prepare (their module cache), after the target snapshot was taken
      const live = { ...st.live, screen: savedScreensNow() ? savedScreensNow().saved.map(x => String(x.id)) : st.live?.screen ?? null }
      const missing = sourceMissing({ live }, row.kind)
      if (missing) return missing
      if ((live[row.kind] || []).includes(row.id)) return `${quote(row.label)} is already back in your ${PLURAL[row.kind]}.`
      if (st.restores.some(r => r.kind === row.kind && r.id === row.id)) return `${quote(row.label)} is already being brought back in this request.`
      if (st.restores.length >= MAX_RESTORES) return `That's more than ${MAX_RESTORES} at once — ask for the rest after this.`
      return null
    },
    apply(st, { item, kind }) {
      const { row } = resolveDeleted(cache.rows || st.rows, item, kind || null)
      return row ? { ...st, restores: [...st.restores, { kind: row.kind, id: row.id, label: row.label, head: row.head }] } : st
    },
    describe(b, a) {
      if (a.restores.length <= b.restores.length) return null
      const r = a.restores[a.restores.length - 1]
      return `Bring back your deleted ${NOUN[r.kind]} ${quote(r.label)}, as it was when it was deleted (it comes back private; nothing existing is replaced)`
    },
  })
}
