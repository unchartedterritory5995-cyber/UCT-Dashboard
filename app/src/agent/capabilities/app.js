// ── APP capability: open another UCT page (navigation) ─────────────────────────────
//
// The destinations are the sidebar's own NAV_ITEMS (components/NavBar.jsx — the list a
// member clicks), plus Settings (one of its sections) and a stock's Research page. The
// model picks a NAME from that closed list; it never writes a URL. Access stays the
// router's: AuthGuard decides, exactly as for a click — the Agent grants nothing.
//
// ⚠ UCT Agent lives inside /charts: leaving the page closes the panel. The conversation
// is kept (it reopens on Charts), the board autosaves on unmount as it does for any
// click, but Undo and any proposal waiting here do not survive — the receipt says so,
// and the page changes only AFTER the receipt is shown (never mid-Apply: one request
// runs at a time).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { NAV_ITEMS } from '../../components/NavBar'
import { unknownSymbols } from '../agentClient'

const slug = (to) => String(to).replace(/^\//, '').replace(/\//g, '-')
// name → { to, label }
export const DESTINATIONS = Object.fromEntries([
  ...NAV_ITEMS.map(i => [slug(i.to), { to: i.to, label: i.label }]),
  ['settings', { to: '/settings', label: 'Settings' }],
  ['research', { to: '/research', label: 'Research' }],
])
export const SETTINGS_SECTIONS = ['account', 'billing', 'preferences', 'charts', 'compass', 'connections', 'legal']
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const NAV_DELAY_MS = 900                 // the receipt is on screen before the page changes

export function pathFor({ page, section, symbol }) {
  if (page === 'research') return `/research/${encodeURIComponent(upper(symbol))}`
  if (page === 'settings') return section ? `/settings?section=${section}` : '/settings'
  return DESTINATIONS[page]?.to || null
}
const labelFor = ({ page, section, symbol }) => (page === 'research' ? `${upper(symbol)} in Research`
  : page === 'settings' && section ? `Settings → ${section[0].toUpperCase()}${section.slice(1)}` : DESTINATIONS[page]?.label || page)

const appSnap = (host) => ({ ref: 'app', label: 'UCT', here: host?.location?.() || '/charts' })
export const appKind = {
  name: 'app',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => (host?.navigate ? [appSnap(host)] : []),
  read: (host, ref) => (ref === 'app' && host?.navigate ? appSnap(host) : null),
  stateOf: (s) => ({ here: s.here, go: null }),
  patch: (before, after) => (after.go ? { go: after.go } : null),
  async commit(host, ref, patch) {
    // After the receipt (the runtime returns first, then the panel renders it).
    setTimeout(() => host.navigate(patch.go.path), NAV_DELAY_MS)
    return true
  },
  landed: () => true,
  // Leaving the page is not something Undo can take back (the panel itself closes).
  undoPatch: () => null,
  fingerprint: () => 'app',
}

let registered = false
export function registerAppCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(appKind)
  registerContextProvider({ key: 'app', build: (host, refFor) => (host?.navigate ? [{ ref: refFor('app', 'app'), label: 'UCT pages (open one here)', current: 'Charts' }] : undefined) })

  registerCapability({
    name: 'app.open',
    surfaces: ['charts'],
    target: 'app',
    summary: 'Open another UCT page for the member, exactly like clicking it in the sidebar: the Screener, Dashboard, Breadth, Settings, a stock\'s Research page, etc. This closes this panel (the conversation is kept).',
    hints: `target = the ref of the app entry. page: one of ${Object.entries(DESTINATIONS).map(([k, d]) => `${k} (${d.label})`).join(', ')}. `
      + `section: only for page settings — ${SETTINGS_SECTIONS.join(' | ')} — else null. symbol: only for page research (the ticker) — else null. `
      + 'Use this only when they ask to GO somewhere ("open / take me to / go to"); a question about data is answered here instead. Watchlists and Theme Tracker live on Charts (this page).',
    args: {
      type: 'object',
      properties: {
        page: { type: 'string', enum: Object.keys(DESTINATIONS) },
        section: { type: ['string', 'null'], enum: [...SETTINGS_SECTIONS, null] },
        symbol: { type: ['string', 'null'] },
      },
      required: ['page', 'section', 'symbol'], additionalProperties: false,
    },
    fastWhole: true,
    fast: ({ lower }) => {
      const m = /^(?:open|go to|take me to|show me|bring up)(?: the)? (.+?)(?: page)?[.!]?$/.exec(lower)
      if (!m) return null
      const want = m[1].trim()
      const hit = Object.entries(DESTINATIONS).find(([k, d]) => k !== 'research' && (d.label.toLowerCase() === want || k === want))
      return hit ? { page: hit[0], section: null, symbol: null } : null
    },
    async prepare(ops) {
      const syms = [...new Set(ops.filter(o => o.args?.page === 'research').map(o => upper(o.args.symbol)).filter(s => TICKER.test(s)))]
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { page, section, symbol }, env) {
      if (!DESTINATIONS[page]) return `“${page}” isn't a UCT page I can open.`
      if (section != null && page !== 'settings') return 'A section only applies to Settings.'
      if (section != null && !SETTINGS_SECTIONS.includes(section)) return `Settings has no “${section}” section.`
      if (page === 'research') {
        const s = upper(symbol)
        if (!TICKER.test(s)) return 'Which stock should I open in Research?'
        if (env?.unknownSymbols?.has(s)) return `UCT has no symbol “${s}”.`
      } else if (symbol != null && symbol !== '') return null      // a stray symbol is ignored
      if (st.go) return 'One page at a time.'
      return null
    },
    apply(st, args) {
      const path = pathFor(args)
      if (!path || path === st.here) return st
      return { ...st, go: { path, label: labelFor(args) } }
    },
    noop: () => 'You are already on Charts',
    describe: (b, a) => (a.go ? `Opening ${a.go.label} — this panel closes; your conversation is kept (it reopens on Charts), but Undo for earlier changes won't be available` : null),
  })
}
