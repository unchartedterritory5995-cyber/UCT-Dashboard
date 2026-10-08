// ── WATCHLIST DIGEST: the member's own watchlist email digest ────────────────────────
//
// The ONE existing control is Settings → Preferences → "Email Digest" (Off / Daily 5 PM ET /
// Weekly Fri 5 PM ET), which calls PUT /api/watchlists/digest-settings (server-validated:
// off | daily | weekly; written as the member's own `watchlist_digest` preference; the 5 PM
// scheduler mails every member whose setting matches). The Agent uses exactly that route.
//
// ⛔ Turning it ON starts recurring email, so it is ALWAYS a proposal that says so — the
// member's Apply is the same opt-in as choosing it in Settings. Turning it OFF (fewer
// emails) applies directly. There is NO Undo either way: an Undo of "off" would quietly
// re-enrol the member in email. Every write is read back from GET before the receipt.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { refreshPreferences } from '../../hooks/usePreferences'

const ROUTE = '/api/watchlists/digest-settings'
const FREQ = ['off', 'daily', 'weekly']
const WHEN = { daily: 'every day at 5 PM ET', weekly: 'every Friday at 5 PM ET' }
const label = (f) => (f === 'off' ? 'off' : `${f} (${WHEN[f]})`)

const cache = { freq: null, p: null }
export function _resetDigestCache() { cache.freq = null; cache.p = null }
async function read() {
  const r = await fetch(ROUTE, { credentials: 'include', cache: 'no-store' })
  if (!r.ok) throw new Error(`Reading the digest setting failed (${r.status})`)
  const body = await r.json()
  return FREQ.includes(body?.frequency) ? body.frequency : 'off'
}
export function loadDigest() {
  if (!cache.p) cache.p = read().then(f => { cache.freq = f; return f }).finally(() => { cache.p = null })
  return cache.p
}

const snap = () => ({ ref: 'digest', label: 'Watchlist email digest', frequency: cache.freq, loaded: cache.freq != null })

export const digestKind = {
  name: 'digest',
  undoable: false,                      // the digest switch keeps no Undo
  boardScoped: false,
  selfDescribing: true,
  list: () => [snap()],
  read: (host, ref) => (ref === 'digest' ? snap() : null),
  stateOf: (s) => ({ frequency: s.frequency, loaded: s.loaded }),
  patch: (before, after) => (after.frequency !== before.frequency ? { to: after.frequency, from: before.frequency } : null),
  async commit(host, ref, patch) {
    const cur = await read()                                   // the SERVER's value, never the cache
    if (cur !== patch.from) { cache.freq = cur; throw new Error(`your digest setting changed since I read it (it is ${label(cur)} now) — ask again`) }
    const r = await fetch(ROUTE, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frequency: patch.to }),
    })
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      throw new Error(b.detail || `the server refused it (${r.status})`)
    }
    cache.freq = await read()                                  // read back before any receipt
    try { await refreshPreferences() } catch { /* Settings re-reads on its own */ }
    return true
  },
  landed: (s, patch) => !!s && s.frequency === patch.to,
  undoPatch: () => null,
  fingerprint: (s) => String(s.frequency),
}

let registered = false
export function registerDigestCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(digestKind)
  registerContextProvider({
    key: 'watchlistDigest',
    refresh: () => loadDigest(),
    build: (host, refFor) => [{ ref: refFor('digest', 'digest'), label: 'Watchlist email digest', setting: cache.freq == null ? 'unknown' : label(cache.freq) }],
  })
  registerCapability({
    name: 'settings.setWatchlistDigest',
    // The digest kind keeps no Undo: the receipt says how to reverse it instead of offering one.
    undo: 'none',
    undoNote: 'No Undo for this — ask me to change the digest again, or use Settings → Email Digest.',
    surfaces: ['charts'],
    target: 'digest',
    summary: 'Turn the member\'s watchlist EMAIL digest (a performance summary of their watchlists, emailed to their account email) on — daily or weekly — or off. Same as Settings → Email Digest.',
    hints: 'target = the ref of the watchlistDigest entry; frequency = daily (every day 5 PM ET) | weekly (Fridays 5 PM ET) | off. '
      + 'Turning it on starts recurring emails: plan it (propose) and say so in the reply. To just see the current setting, answer from the watchlistDigest entry.',
    args: { type: 'object', properties: { frequency: { type: 'string', enum: FREQ } }, required: ['frequency'], additionalProperties: false },
    check(st, { frequency }) {
      if (!FREQ.includes(frequency)) return 'The digest can be daily, weekly or off.'
      if (!st.loaded) return "I couldn't read your current digest setting, so I won't change it — try again in a moment."
      return null
    },
    // Opting INTO recurring email is always the member's explicit Apply.
    confirmIf: (st, { frequency }) => frequency !== 'off',
    apply: (st, { frequency }) => ({ ...st, frequency }),
    noop: (st) => `Your watchlist digest is already ${label(st.frequency)}`,
    describe(b, a) {
      if (a.frequency === b.frequency) return null
      if (a.frequency === 'off') return 'Watchlist email digest: off — no more digest emails'
      return `Watchlist email digest: ON, ${a.frequency} — UCT will email a performance summary of your watchlists to your account email ${WHEN[a.frequency]} until you turn it off`
    },
  })
}
