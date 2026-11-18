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
//                        RS screens (unit U11): a starter is also found by its own search words (`aliases`,
//                        "RSNHBP"), and one that carries quick `controls` can be opened WITH a choice the
//                        member named ("open RS New Highs for today"). The words are matched against that
//                        starter's own options (pages/screener/focus/rsScreens.js choicesNamed), read from the
//                        page's payload: no screen, control or option is named in this file.
// Saving the page's screen is capabilities/savedScreens.js (`screener.saveAs`, its own routes), offered
// on this surface too. ⛔ No filter-by-filter editing of the page here (it has no single writer for that).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { matchName } from '../nl/match'
import { offeredStarters } from '../../pages/screener/focus/screenGroups'
import { controlsOf, choicesNamed, choiceWords } from '../../pages/screener/focus/rsScreens'

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
    canChoose: !!src.canChoose?.(),
  }
}
// Every name a screen answers to: its own, and a starter's search words (the Screen menu's search reads the same).
const namesOf = (x) => [x?.name, ...(Array.isArray(x?.aliases) ? x.aliases : [])].filter(n => typeof n === 'string' && n.trim())
const called = (x, words) => namesOf(x).some(n => norm(n) === norm(words))
// The screen a member's words mean: its id, else ONE screen with that exact name (or search word), else ONE clear
// near-match of a name. { hit } | { many: true } | {}.
function screenFor(all, want) {
  const byId = all.find(x => x.id === want)
  if (byId) return { hit: byId }
  const exact = all.filter(x => called(x, want))
  if (exact.length === 1) return { hit: exact[0] }
  if (exact.length > 1) return { many: true }
  const f = matchName(want, all.map(x => x.name))
  const one = f.kind === 'fuzzy' ? all.filter(x => x.name === f.name) : []
  return one.length === 1 ? { hit: one[0] } : {}
}
// "<a screen's name> <a quick choice of that screen>" in one breath ("rs new highs today"): the screen whose own
// name the words START with (longest first) and the rest as its choice. null unless the rest names real options.
const GLUE = /^(?:for|with|on|at|from|showing|only|and|,|:|-)\s+/
function screenWithChoice(all, words) {
  const text = norm(words)
  const named = all.filter(x => controlsOf(x).length).flatMap(x => namesOf(x).map(n => [norm(n), x])).sort((a, b) => b[0].length - a[0].length)
  for (const [name, x] of named) {
    if (!name || !text.startsWith(`${name} `)) continue
    const rest = text.slice(name.length + 1).replace(GLUE, '').trim()
    const found = rest ? choicesNamed(x, rest) : null
    if (found && !found.problems.length && found.labels.length) return { item: x, choose: rest }
  }
  return null
}
// The quick choice an op asked for, read against the screen it names: null (none asked), { problem } or
// { choices, labels }.
function choiceFor(s, hit, choose) {
  const words = String(choose ?? '').trim()
  if (!words) return null
  if (!controlsOf(hit).length) return { problem: `“${hit.name}” has no quick choices to set. I can open it as it is.` }
  if (!s?.canChoose) return { problem: 'The Table layout has no quick choices. Switch to List and ask again.' }
  const found = choicesNamed(hit, words)
  if (found.problems.length || !found.labels.length) return { problem: `“${hit.name}” has no choice called “${found.problems[0] || words}” (it offers ${choiceWords(hit).join('; ')}).` }
  return found
}
// The names a sentence may LIST: the member's own and the starters the picker offers. A hidden starter still opens
// by its id or its exact name (the lookups below read `s.starters` whole); it is only never offered.
const offeredNames = (s) => [...(s?.saved || []), ...offeredStarters(s?.starters)].map(x => x.name)
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
  // (a pick that carries a quick choice is a change even on the screen already open: the choice is what was asked)
  patch: (before, after) => (after.pick && (after.pick.id !== before.open || after.pick.choices) ? { open: after.pick, from: { id: before.open, name: before.name, kind: before.kind } } : null),
  async commit(host, ref, patch) {
    const src = host.screenerPage
    if (!src?.apply) throw new Error('this Screener layout has no door the Agent can open a screen through')
    const lib = src.saved()
    const item = patch.open.spec ? patch.open : [...lib.saved, ...lib.starters].find(s => s.id === patch.open.id) || null
    if (!item) throw new Error(`“${patch.open.name || patch.open.id}” isn't among your screens any more`)
    if (patch.open.choices && !src.canChoose?.()) throw new Error('this Screener layout has no quick choices to set')
    src.apply({ id: item.id, name: item.name, kind: item.kind, spec: item.spec || { filters: [] }, ...(patch.open.choices ? { choices: patch.open.choices } : {}) })
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
    hints: 'target = the ref of the Screener page entry; screen = the id (or the exact name) of an entry in the screener entry\'s savedScreens — never invent one; clarify with the real names if unsure. '
      + 'choose = null, unless the member also named one of that screen\'s own quick choices (a time span, a minimum, a narrower view): then their words for it, as said. Never invent one: a word the screen does not offer is refused with its real choices.',
    args: { type: 'object', properties: { screen: { type: 'string' }, choose: { type: ['string', 'null'] } }, required: ['screen', 'choose'], additionalProperties: false },
    // `choose` was added in unit U11: a plan or a guide step from before it (the key left out) reads as null
    absentAsNull: ['choose'],
    fastWhole: true,
    fast: ({ raw, host }) => {
      const m = /^(?:open|switch to|load|put up|apply) (?:my |the )?(.+?)(?: screen| scan| starter)?(?: on (?:the |this )?(?:page|screener))?[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      const s = snap(host)
      if (!s) return null
      const all = [...s.saved, ...s.starters]
      const hits = all.filter(x => called(x, m[1]) || called(x, `${m[1]} screen`))
      if (hits.length) return hits.length === 1 ? { screen: hits[0].id, choose: null, __target: REF, __explicit: true } : null
      // "open rs new highs today": a starter's own name, then one of that starter's own quick choices
      const both = s.canChoose ? screenWithChoice(all, m[1]) : null
      return both ? { screen: both.item.id, choose: both.choose, __target: REF, __explicit: true } : null
    },
    check(st, { screen, choose }, env) {
      const s = env?.target
      if (!s?.canOpen) return 'This Screener layout has no door I can open a screen through.'
      const all = [...(s.saved || []), ...(s.starters || [])]
      const want = String(screen || '').trim()
      const { hit, many } = screenFor(all, want)
      if (many) return `You have more than one screen called “${want}” — say which (your screens: ${offeredNames(s).join(', ')}).`
      const offered = offeredNames(s)
      if (!hit) return `I couldn't find a saved screen called “${want}”${offered.length ? ` (your screens: ${offered.slice(0, 12).join(', ')})` : ''}.`
      if (st.pick) return 'One screen at a time.'
      return choiceFor(s, hit, choose)?.problem || null
    },
    apply(st, { screen, choose }, env) {
      const s = env?.target
      const all = [...(s?.saved || []), ...(s?.starters || [])]
      const { hit } = screenFor(all, String(screen || '').trim())
      const asked = hit ? choiceFor(s, hit, choose) : null
      if (!hit || asked?.problem || (hit.id === st.open && !s?.edited && !asked)) return st
      return { ...st, pick: { id: hit.id, name: hit.name, kind: hit.kind, spec: hit.spec, ...(asked ? { choices: asked.choices, chose: asked.labels } : {}) } }
    },
    noop: (st) => `“${st.name || 'that screen'}” is already open on the page`,
    describe: (b, a) => (a.pick ? `Opened “${a.pick.name}” on the Screener page${a.pick.chose?.length ? `, set to ${a.pick.chose.join(', ')}` : ''}${b.name && b.name !== a.pick.name ? ` (was “${b.name}”)` : ''}` : null),
  })
}
