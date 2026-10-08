// ── ALERT capabilities: the member's PRICE alerts (UCT's existing Alerts product) ──
//
// Registered through the same public seam as charts, watchlists and the Screener. The
// Agent keeps no alert store of its own: reads and writes go ONLY through the routes the
// Alerts widget, the chart menu and the bell already use — /api/watchlist-alerts (owner-
// scoped server-side). What that product IS, measured from its code (2026-10-08):
//   • a price alert is ONE level on ONE symbol, direction above | below;
//   • it goes off ONCE (the row turns inactive, `triggered_at` set) when the price is AT
//     OR ABOVE (above) / AT OR BELOW (below) the level — there is no separate "cross";
//   • it is checked while the market is open, against the prices UCT is serving;
//   • there is NO pause/resume, NO edit, NO expiry, NO repeat; delete is a HARD delete.
// So the Agent offers exactly: list (query), create (proposed), delete (proposed, no Undo).
//
//   kind 'alertLibrary'  one target — where new alerts are made (and the list is read)
//   kind 'alert'         one target per alert (ref = its real id)
//
// ⛔ Not here: indicator alerts (/api/indicator-alerts — owned and actively changed by the
// Indicator project), bulk/composed creation (no bulk route; deferred), pause/resume/edit
// (the product has none — never emulated by delete + re-create).

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup } from '../capabilities'
import { unknownSymbols } from '../agentClient'
import { mutate as globalMutate } from 'swr'

const ROUTE = '/api/watchlist-alerts'
const TTL_MS = 20_000
const MAX_CREATES = 5                // alerts one request may create (the product has no cap)
const SHOW_IN_CONTEXT = 25
const ALWAYS_SHOW_UP_TO = 10         // a small book is always shown; a big one when alerts are the topic
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const ALERT_WORDS = /\b(alerts?|alarm|notify|notification|ping me|tell me when|let me know when|text me|warn me|triggered|fired|went off|go off|delete|remove|cancel|that one|those|it)\b/i

const req = (u, o) => fetch(u, { credentials: 'include', ...o })
async function json(r, what) {
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(b.detail || `${what} failed (${r.status})`)
  }
  return r.json()
}
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
const when = (dir) => (dir === 'below' ? 'at or below' : 'at or above')
export const alertPhrase = (a) => `${a.sym} ${when(a.direction)} ${money(a.price)}`

function slim(r) {
  return {
    id: String(r.id), sym: String(r.sym || '').toUpperCase(), price: Number(r.target_price), direction: r.direction === 'below' ? 'below' : 'above',
    active: !!r.is_active, triggeredAt: r.triggered_at || null, createdAt: r.created_at || null,
    type: r.alert_type || 'price', bound: !!r.drawing_id,
  }
}
const rowSig = (a) => JSON.stringify([a.id, a.sym, a.price, a.direction, a.active, a.triggeredAt])

// ── the server's list, cached for planning; every write re-reads it first ──
const cache = { rows: null, at: 0, p: null }
export function _resetAlertCache() { cache.rows = null; cache.at = 0; cache.p = null }
export function loadAlerts({ force = false } = {}) {
  if (!force && cache.rows && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.rows)
  if (!cache.p) {
    cache.p = req(`${ROUTE}?active_only=false`, { cache: 'no-store' }).then(r => json(r, 'Reading your alerts')).then(rows => {
      cache.rows = (Array.isArray(rows) ? rows : []).map(slim)
      cache.at = Date.now()
      return cache.rows
    }).finally(() => { cache.p = null })
  }
  return cache.p
}
const rows = () => cache.rows || []
// Every Alerts surface (widget, bell, chart menus) re-reads after an Agent write.
const revalidateAlertViews = () => { try { globalMutate(k => typeof k === 'string' && k.startsWith(ROUTE)) } catch { /* never breaks a write */ } }

/** Last prices for these symbols from the same quotes route the app uses; {} if unavailable. */
export async function quotesFor(symbols) {
  const syms = [...new Set(symbols.map(upper).filter(Boolean))]
  if (!syms.length) return {}
  try {
    const r = await req(`/api/live-prices?tickers=${encodeURIComponent(syms.join(','))}`, { cache: 'no-store' })
    if (!r.ok) return {}
    const body = await r.json()
    const out = {}
    for (const s of syms) {
      const p = Number(body?.[s]?.price)
      if (Number.isFinite(p) && p > 0) out[s] = p
    }
    return out
  } catch { return {} }
}

const etDay = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) } catch { return null }
}
const etStamp = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
  } catch { return iso }
}
const kindWord = (a) => (a.type === 'trendline' ? 'trendline alert' : a.type === 'line' ? 'line alert' : 'price alert')
const statusOf = (a) => (a.active ? 'active' : a.triggeredAt ? `went off ${etStamp(a.triggeredAt)}` : 'inactive')

function libSnap() {
  const all = rows()
  return { ref: 'alerts', label: 'Price alerts', loaded: !!cache.rows, alerts: all }
}

export const alertLibraryKind = {
  name: 'alertLibrary',
  boardScoped: false,
  selfDescribing: true,
  list: () => [libSnap()],
  read: (host, ref) => (ref === 'alerts' ? libSnap() : null),
  stateOf: (snap) => ({ alerts: snap.alerts, loaded: snap.loaded, creates: [] }),
  patch: (before, after) => (after.creates.length ? { create: after.creates } : null),
  async commit(host, ref, patch) {
    if (patch.deleteCreated) {
      // Undo / compensation of a create: only an alert that is STILL waiting. One that
      // already went off has notified the member — deleting it now would not undo that.
      const cur = await loadAlerts({ force: true })
      for (const id of patch.deleteCreated) {
        const a = cur.find(x => x.id === id)
        if (!a) continue
        if (!a.active || a.triggeredAt) throw new Error(`the alert ${alertPhrase(a)} already went off`)
      }
      for (const id of patch.deleteCreated) {
        if (cur.some(x => x.id === id)) await json(await req(`${ROUTE}/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Removing the alert')
      }
      await loadAlerts({ force: true })
      revalidateAlertViews()
      return true
    }
    // The CURRENT book (never the cache): a duplicate made in another tab since the
    // proposal is refused, never doubled.
    const cur = await loadAlerts({ force: true })
    for (const c of patch.create) {
      const dup = cur.find(a => a.active && a.sym === c.sym && a.direction === c.direction && a.price === c.price)
      if (dup) throw new Error(`you already have an active alert for ${alertPhrase(dup)}`)
    }
    const created = {}
    for (const [i, c] of patch.create.entries()) {
      try {
        const row = await json(await req(ROUTE, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sym: c.sym, target_price: c.price, direction: c.direction, alert_type: 'price' }),
        }), 'Creating the alert')
        created[`#${i}`] = String(row.id)
      } catch (e) {
        e.created = created               // the runtime takes these back
        throw e
      }
    }
    // READ BACK: the receipt claims only what the server now holds.
    await loadAlerts({ force: true })
    revalidateAlertViews()
    return { created }
  },
  landed(snap, patch) {
    if (!snap) return false
    const have = snap.alerts
    if (patch.deleteCreated) return patch.deleteCreated.every(id => !have.some(a => a.id === id))
    return patch.create.every(c => have.some(a => a.active && a.sym === c.sym && a.direction === c.direction && a.price === c.price))
  },
  // Undo a create = delete exactly the alerts it made, refused if one already went off.
  undoPatch: (item) => {
    const ids = Object.values(item.created || {})
    return ids.length ? { deleteCreated: ids } : null
  },
  compensatePatch(item) {
    const ids = Object.values(item.created || item.partial || {})
    return ids.length ? { deleteCreated: ids } : null
  },
  // Planning never trips on the book moving (an alert going off elsewhere); the write
  // itself re-reads the server. Undo is narrowed to the alerts it made.
  fingerprint: () => 'alerts',
  fingerprintFor(host, snap, item) {
    const ids = Object.values(item.created || {})
    return JSON.stringify(ids.map(id => { const a = snap.alerts.find(x => x.id === id); return a ? rowSig(a) : null }))
  },
}

export const alertKind = {
  name: 'alert',
  boardScoped: false,
  selfDescribing: true,
  list: () => rows().map(a => ({ ...a, ref: a.id, label: alertPhrase(a) })),
  read: (host, ref) => { const a = rows().find(x => x.id === ref); return a ? { ...a, ref: a.id, label: alertPhrase(a) } : null },
  stateOf: (snap) => ({ ...snap, deleted: false }),
  patch: (before, after) => (after.deleted ? { delete: true, sig: rowSig(before) } : null),
  async commit(host, ref, patch) {
    const cur = await loadAlerts({ force: true })
    const a = cur.find(x => x.id === ref)
    if (!a) throw new Error('that alert is already gone')
    if (rowSig(a) !== patch.sig) throw new Error('that alert changed since I read it (it may have gone off) — ask again')
    await json(await req(`${ROUTE}/${encodeURIComponent(ref)}`, { method: 'DELETE' }), 'Deleting the alert')
    await loadAlerts({ force: true })
    revalidateAlertViews()
    return true
  },
  landed: (snap, patch) => (patch.delete ? !snap : true),
  // A delete is a HARD delete in the product: nothing can bring the same alert back.
  undoPatch: () => null,
  fingerprint: (snap) => (snap ? rowSig(snap) : 'gone'),       // after its delete there is no row
}

function libraryEntry(refFor) {
  const all = rows()
  return {
    ref: refFor('alertLibrary', 'alerts'),
    label: 'Price alerts (create new alerts here)',
    ...(cache.rows ? { active: all.filter(a => a.active).length, wentOff: all.filter(a => !a.active && a.triggeredAt).length } : { status: 'loading' }),
  }
}

let registered = false
export function registerAlertCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(alertLibraryKind)
  registerTargetKind(alertKind)
  registerWarmup(() => loadAlerts())

  registerContextProvider({
    key: 'alertLibrary',
    // Alerts change outside the panel (chart menu, widget, one going off): the book is
    // re-read before every model turn, so the model never targets an alert from a stale list.
    refresh: () => loadAlerts({ force: true }),
    build: (host, refFor) => [libraryEntry(refFor)],
  })
  // Each alert is a target (so "delete my AMD alert" names a real id). A small book is
  // always shown; a big one only when the request is about alerts — the rest of the
  // time the library's counts are enough for the model to know they exist.
  registerContextProvider({
    key: 'alerts',
    compact: (list) => (list || []).slice(0, 8),
    build: (host, refFor, { message = '' } = {}) => {
      const all = rows()
      if (!all.length) return undefined
      if (all.length > ALWAYS_SHOW_UP_TO && !ALERT_WORDS.test(message)) return undefined
      const ordered = [...all.filter(a => a.active), ...all.filter(a => !a.active)]
      return ordered.slice(0, SHOW_IN_CONTEXT).map(a => ({
        ref: refFor('alert', a.id), symbol: a.sym, when: `${when(a.direction)} ${money(a.price)}`,
        status: statusOf(a), ...(a.type !== 'price' ? { kind: kindWord(a) } : {}),
      }))
    },
  })

  // ── alert.list (QUERY) ──
  registerCapability({
    name: 'alert.list',
    surfaces: ['charts'],
    target: 'alertLibrary', query: true,
    summary: 'Show the member\'s price alerts from UCT\'s real alert list: which are active, which went off (and when). Use this (disposition apply) for "show my alerts", "do I have an alert on NVDA?", "which alerts went off today?".',
    hints: 'target = the ref of the alertLibrary entry. symbol: one ticker to filter by, or null. status: active | triggered | all, or null (= all). '
      + 'triggered_today: true only for "today"; else null. These are PRICE alerts only — indicator alerts (RSI, MACD…) are not listed here.',
    args: {
      type: 'object',
      properties: {
        symbol: { type: ['string', 'null'] },
        status: { type: ['string', 'null'], enum: ['active', 'triggered', 'all', null] },
        triggered_today: { type: ['boolean', 'null'] },
      },
      required: ['symbol', 'status', 'triggered_today'], additionalProperties: false,
    },
    fastWhole: true,
    fast: ({ lower }) => (/^((show|list)( me)?( all)?( of)? my( price)? alerts|what alerts do i have|my alerts)[?.!]?$/.test(lower) ? { symbol: null, status: null, triggered_today: null } : null),
    async answer(_snap, { symbol, status, triggered_today: today }) {
      let all
      try { all = await loadAlerts({ force: true }) } catch (e) { return `I couldn't read your alerts right now (${e?.message || 'error'}).` }
      const sym = symbol ? upper(symbol) : null
      const todayET = etDay(new Date().toISOString())
      let xs = all.filter(a => !sym || a.sym === sym)
      const st = today ? 'triggered' : (status || 'all')
      if (st === 'active') xs = xs.filter(a => a.active)
      if (st === 'triggered') xs = xs.filter(a => !a.active && a.triggeredAt)
      if (today) xs = xs.filter(a => etDay(a.triggeredAt) === todayET)
      const what = `${today ? 'alerts that went off today' : st === 'active' ? 'active alerts' : st === 'triggered' ? 'alerts that went off' : 'alerts'}${sym ? ` on ${sym}` : ''}`
      if (!xs.length) return `You have no ${what}.`
      const line = (a) => `${alertPhrase(a)} — ${statusOf(a)}${a.type !== 'price' ? ` (${kindWord(a)})` : ''}`
      const head = `Your ${what} (${xs.length}):`
      return [head, ...xs.slice(0, 30).map(a => `• ${line(a)}`), ...(xs.length > 30 ? [`…and ${xs.length - 30} more.`] : [])].join('\n')
    },
  })

  // ── alert.create ──
  registerCapability({
    name: 'alert.create',
    surfaces: ['charts'],
    target: 'alertLibrary',
    risk: 'confirm',
    createsResource: true,
    summary: 'Create ONE price alert in UCT\'s Alerts: it goes off ONCE when the stock is at or above (direction above) or at or below (direction below) a price level, '
      + 'checked while the market is open. Only price levels — no percent-move, indicator, volume or time alerts; alerts cannot be paused, edited or made repeating.',
    hints: 'target = the ref of the alertLibrary entry; symbol = the ticker, uppercase; price = the level as a number; '
      + 'direction = above ("crosses above", "breaks above", "rises to", "gets to … from below") or below ("drops below", "falls to", "breaks down under"). '
      + 'If they give a level WITHOUT saying above or below (e.g. "an alert on NVDA at 200", "when it hits 200"), clarify with choices above / below — never guess. '
      + 'One op per alert, at most 5 in one request. An earlier alert at that level that already went off does NOT stop a new one — create it. '
      + 'Creating is always shown to the member as a proposal first, so plan it (disposition propose) — even inside a question ("why is TSLA moving? and set an alert above 300": propose the alert AND ask research for the question). '
      + 'For an alert on an indicator (RSI, MACD, a moving average…) or a percent move, use disposition unsupported: those are not price-level alerts.',
    args: {
      type: 'object',
      properties: { symbol: { type: 'string' }, price: { type: 'number' }, direction: { type: 'string', enum: ['above', 'below'] } },
      required: ['symbol', 'price', 'direction'], additionalProperties: false,
    },
    // Fresh book (duplicates), real symbols, and the price now (an alert whose level is
    // already reached would go off at once — said instead of created).
    async prepare(ops) {
      const syms = [...new Set(ops.map(o => upper(o.args?.symbol)).filter(s => TICKER.test(s)))]
      const [unknown, quotes] = await Promise.all([
        syms.length ? unknownSymbols(syms) : new Set(),
        quotesFor(syms),
        loadAlerts({ force: true }).catch(() => null),
      ])
      return { unknownSymbols: unknown, alertQuotes: quotes }
    },
    check(st, { symbol, price, direction }, env) {
      const sym = upper(symbol)
      if (!TICKER.test(sym)) return `“${symbol}” doesn't look like a ticker.`
      if (env?.unknownSymbols?.has(sym)) return `UCT has no symbol “${sym}” — no alert was created.`
      const p = Number(price)
      if (!Number.isFinite(p) || p <= 0 || p >= 1e7) return `${price} isn't a usable price level.`
      if (direction !== 'above' && direction !== 'below') return 'Should it go off above or below that price?'
      if (st.creates.length >= MAX_CREATES) return `That's more than ${MAX_CREATES} alerts in one request — ask for them in smaller groups.`
      const same = (a) => a.sym === sym && a.direction === direction && a.price === p
      const dup = st.alerts.find(a => a.active && same(a)) || st.creates.find(same)
      if (dup) return `You already have an active alert for ${alertPhrase({ sym, direction, price: p })}.`
      const now = env?.alertQuotes?.[sym]
      if (now != null && (direction === 'above' ? now >= p : now <= p)) {
        return `${sym} is already ${direction === 'above' ? 'at or above' : 'at or below'} ${money(p)} (last ${money(now)}), so that alert would go off right away. `
          + `Pick a level ${direction === 'above' ? 'above' : 'below'} the current price, or say if you meant ${direction === 'above' ? 'below' : 'above'}.`
      }
      return null
    },
    apply: (st, { symbol, price, direction }) => ({ ...st, creates: [...st.creates, { sym: upper(symbol), price: Number(price), direction }] }),
    describe(b, a, { symbol, price, direction }) {
      if (a.creates.length <= b.creates.length) return null
      return `Price alert: ${alertPhrase({ sym: upper(symbol), price: Number(price), direction })} — goes off once, checked while the market is open`
    },
  })

  // ── alert.delete ──
  registerCapability({
    name: 'alert.delete',
    surfaces: ['charts'],
    target: 'alert',
    risk: 'confirm', reversible: false,
    summary: 'Delete one of the member\'s price alerts (permanent — UCT cannot restore a deleted alert).',
    hints: 'target = the ref of that alert in the alerts list. One op per alert. Deleting is always shown to the member as a proposal first, so when the alert '
      + 'is clear (including "it" / "that one" right after an alert was named) plan the op — never ask "are you sure?". "All my inactive alerts" = one op per alert whose '
      + 'status is not active. If more than one alert could be the one they mean (e.g. two alerts on AMD), clarify with the real alerts as choices — never pick one. '
      + 'If the alerts list is not shown, use alert.list first.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    // Same as the Alerts widget's ✕: a line-bound alert is deleted the same way (its line stays).
    check: () => null,
    apply: (st) => ({ ...st, deleted: true }),
    describe: (b, a) => (a.deleted ? `Deleted the alert ${alertPhrase(b)} (permanent)` : null),
  })
}
