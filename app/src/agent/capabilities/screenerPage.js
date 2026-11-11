// ── SCREENER PAGE capabilities (W2-C1): the screen ON /screener, through the page's own doors ───────────
//
// The Screener's ENGINE capabilities (capabilities/screener.js: run / runSaved / state / listSaved) are
// server queries and work on every page. THIS module is the page itself, offered only on /screener:
//   screener.page        a QUERY: what the page shows now (the screen's name, its matches, the first rows)
//   screener.openSaved   a WRITE: open one of the member's saved screens (or a UCT starter) ON THE PAGE —
//                        the same door the Screen menu and the Pinned chips call (FocusScreener.applyScreen →
//                        useScreenSpec.applySpec; ScannerShell → useScreenSpec.applySpec). Exact Undo: the
//                        screen that was on the page (its spec) is applied back, refused if the member
//                        changed the filters since.
// Saving the page's screen is capabilities/savedScreens.js (`screener.saveAs`, its own routes), offered
// on this surface too. ⛔ No filter-by-filter editing of the page here (it has no single writer for that).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { matchName } from '../nl/match'

const REF = 'screenerPage'
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()

function snap(host) {
  const src = host?.screenerPage
  if (!src) return null
  const p = src.snapshot()
  const lib = src.saved()
  return {
    ref: REF, label: 'Screener page', current: p.current, total: p.total, rows: p.rows, rowCount: p.rowCount,
    filters: p.filters, loading: p.loading, edited: p.edited, saved: lib.saved, starters: lib.starters, canOpen: !!src.apply,
  }
}
const nameOf = (s) => (s.current ? `${s.current.name}${s.edited ? ' (edited)' : ''}` : (s.filters?.length ? 'an unsaved screen' : 'no screen'))

export const screenerPageKind = {
  name: 'screenerPage',
  source: 'screenerPage',             // fix-nothing-on-workspace: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "The screener page isn't available here — open the Screener to use it.",
  boardScoped: false,
  selfDescribing: true,
  persistsInCommit: true,
  list: (host) => { const s = snap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? snap(host) : null),
  // what the page is ON: the applied screen's id (null = an unsaved / edited one) and its spec
  stateOf: (s) => ({ open: s.current?.id || null, name: s.current?.name || null, kind: s.current?.kind || null, spec: null, pick: null }),
  patch: (before, after) => (after.pick && after.pick.id !== before.open ? { open: after.pick, from: { id: before.open, name: before.name, kind: before.kind } } : null),
  async commit(host, ref, patch) {
    const src = host.screenerPage
    if (!src?.apply) throw new Error('this Screener layout has no door the Agent can open a screen through')
    const lib = src.saved()
    const item = patch.open.spec ? patch.open : [...lib.saved, ...lib.starters].find(s => s.id === patch.open.id) || null
    if (!item) throw new Error(`“${patch.open.name || patch.open.id}” isn't among your screens any more`)
    src.apply({ id: item.id, name: item.name, kind: item.kind, spec: item.spec || { filters: [] } })
    return { undoData: { fromSpec: patch.from } }
  },
  landed: (s, patch) => !!s && (s.current?.id || null) === (patch.open?.id || null),
  // back to the screen that was on the page; an unsaved one (no id) cannot be put back exactly
  undoPatch: (it) => (it.patch?.from?.id ? { open: { id: it.patch.from.id, name: it.patch.from.name, kind: it.patch.from.kind }, from: it.patch.open } : null),
  fingerprint: (s) => JSON.stringify([s.current?.id || null, s.edited === true, s.filters || []]),
}

let registered = false
export function registerScreenerPageCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(screenerPageKind)
  registerContextProvider({
    key: 'screenerPage',
    build: (host, refFor) => {
      const s = snap(host)
      if (!s) return undefined
      return [{
        ref: refFor('screenerPage', REF), label: 'The Screener page (what is on it now; open a saved screen here)',
        screen: nameOf(s), matches: s.total, firstRows: s.rows.slice(0, 15).map(r => r.ticker),
        ...(s.loading ? { loading: true } : {}),
        canOpen: s.canOpen,
      }]
    },
  })

  registerCapability({
    name: 'screener.page',
    surfaces: ['screener'],
    target: 'screenerPage', query: true,
    summary: 'Say what the Screener PAGE shows now: which screen is applied, how many stocks matched and the first rows on screen. Use it for "what screen is this?", "what am I looking at?", "what\'s on this page?".',
    hints: 'target = the ref of the Screener page entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower }) => (/^(what('s| is) (on )?(this|the) (screener )?(page|screen)( now)?|what (screen|scan) (is|am i) (this|on|looking at)|what (screen|scan) is (on|applied to|open on) (this|the) (screener )?page|what am i looking at|what('s| is) (applied|open) here)[?.!]?$/.test(lower) ? {} : null),
    answer(s) {
      if (!s) return 'The Screener page is not available here.'
      if (s.loading && !s.rows.length) return 'The Screener page is still loading its results.'
      const matches = s.total == null ? '' : ` — ${Number(s.total).toLocaleString()} match${s.total === 1 ? '' : 'es'}`
      const rows = s.rows.length ? `\nFirst on screen: ${s.rows.slice(0, 10).map(r => r.ticker).join(', ')}${s.rowCount > 10 ? ` (+${s.rowCount - 10} more loaded)` : ''}` : '\nNo rows on screen.'
      return `The page shows ${nameOf(s)}${matches}.${rows}`
    },
  })

  registerCapability({
    name: 'screener.openSaved',
    surfaces: ['screener'],
    target: 'screenerPage',
    summary: 'Open one of the member\'s saved screens (or a UCT starter screen) ON the Screener page — exactly like picking it from the page\'s Screen menu. Use it for "open my Breakout screen", "switch to the Momentum starter". To only SEE the matches without changing the page, use screener.runSaved.',
    hints: 'target = the ref of the Screener page entry; screen = the id (or the exact name) of an entry in the screener entry\'s savedScreens — never invent one; clarify with the real names if unsure.',
    args: { type: 'object', properties: { screen: { type: 'string' } }, required: ['screen'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      const m = /^(?:open|switch to|load|put up|apply) (?:my |the )?(.+?)(?: screen| scan| starter)?(?: on (?:the |this )?(?:page|screener))?[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      const s = snap(host)
      if (!s) return null
      const all = [...s.saved, ...s.starters]
      const hits = all.filter(x => norm(x.name) === norm(m[1]) || norm(x.name) === norm(`${m[1]} screen`))
      return hits.length === 1 ? { screen: hits[0].id, __target: REF, __explicit: true } : null
    },
    check(st, { screen }, env) {
      const s = env?.target
      if (!s?.canOpen) return 'This Screener layout has no door I can open a screen through.'
      const all = [...(s.saved || []), ...(s.starters || [])]
      const want = String(screen || '').trim()
      let hit = all.find(x => x.id === want) || null
      if (!hit) {
        const exact = all.filter(x => norm(x.name) === norm(want))
        if (exact.length === 1) hit = exact[0]
        else if (exact.length > 1) return `You have more than one screen called “${want}” — say which (your screens: ${all.map(x => x.name).join(', ')}).`
        else {
          const f = matchName(want, all.map(x => x.name))
          const one = f.kind === 'fuzzy' ? all.filter(x => x.name === f.name) : []
          if (one.length === 1) hit = one[0]
        }
      }
      if (!hit) return `I couldn't find a saved screen called “${want}”${all.length ? ` (your screens: ${all.slice(0, 12).map(x => x.name).join(', ')})` : ''}.`
      if (st.pick) return 'One screen at a time.'
      return null
    },
    apply(st, { screen }, env) {
      const s = env?.target
      const all = [...(s?.saved || []), ...(s?.starters || [])]
      const want = String(screen || '').trim()
      const hit = all.find(x => x.id === want) || all.find(x => norm(x.name) === norm(want))
        || (() => { const f = matchName(want, all.map(x => x.name)); return f.kind === 'fuzzy' ? all.find(x => x.name === f.name) : null })()
      if (!hit || (hit.id === st.open && !s?.edited)) return st
      return { ...st, pick: { id: hit.id, name: hit.name, kind: hit.kind, spec: hit.spec } }
    },
    noop: (st) => `“${st.name || 'that screen'}” is already open on the page`,
    describe: (b, a) => (a.pick ? `Opened “${a.pick.name}” on the Screener page${b.name ? ` (was “${b.name}”)` : ''}` : null),
  })
}
