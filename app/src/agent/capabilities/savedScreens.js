// ── SAVED SCREENS: the member's own saved Screener screens ────────────────────────────
//
// The same routes the Screener's "Screener ▾" menu and "Save as scan" button use
// (api/routers/screener.py — paid, owner-scoped in SQL):
//   POST   /api/screener/saved-screens          {name, spec}      create
//   PUT    /api/screener/saved-screens/{id}     {name}            rename
//   DELETE /api/screener/saved-screens/{id}                       delete (hard)
// The spec saved is exactly the wire spec the Agent's last screen RAN with
// ({filters, sort, rank?, logic?}) — the Screener's own stored shape — or, for a copy, the
// source screen's stored spec, unchanged (view/columns/rank/logic included; see `storable`).
// Nothing is re-parsed or rebuilt.
//
// ⛔ The server checks nothing about names (no uniqueness, no length) and has no revision:
// the Agent re-reads the list right before every write and refuses a name you already use,
// a screen that changed or vanished since the plan, and anything not yours (UCT's starter
// screens are read-only). Overwriting a screen's filters is NOT offered (last write wins
// with no history unless version history is on).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { loadSaved, savedScreensNow, lastScreenNow } from './screener'

const ROUTE = '/api/screener/saved-screens'
const MAX_NAME = 80
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()
const quote = (n) => `“${n}”`
const req = (u, o) => fetch(u, { credentials: 'include', ...o })
async function json(r, what) {
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(r.status === 402 ? 'saved screens need a paid plan' : (typeof b.detail === 'string' ? b.detail : `${what} failed (${r.status})`))
  }
  return r.json()
}
const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function snap() {
  const lib = savedScreensNow()
  return {
    ref: 'screens', label: 'Saved screens', loaded: !!lib,
    mine: (lib?.saved || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec })),
    starters: (lib?.starters || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec })),
    last: lastScreenNow()?.spec || null,
  }
}
const findAny = (st, id) => st.mine.find(s => s.id === String(id)) || st.starters.find(s => s.id === String(id)) || null
const findMine = (st, id) => st.mine.find(s => s.id === String(id)) || null

function nameProblem(st, name, exceptId = null) {
  const n = String(name || '').trim()
  if (!n) return 'A saved screen needs a name.'
  if (n.length > MAX_NAME) return `Screen names can be at most ${MAX_NAME} characters.`
  const clash = st.mine.find(s => s.id !== exceptId && norm(s.name) === norm(n))
  if (clash) return `You already have a saved screen named ${quote(clash.name)} — I won't overwrite it. Pick another name.`
  return null
}
const oneAtATime = (st) => (st.op ? 'One saved-screen change at a time — ask for the next one after this.' : null)
// Exactly the shape the Screener itself stores — `useScreenSpec`'s `baseSpec`
// ({filters, sort, view, columns?, rank?, logic?}; pages/screener/shell/useScreenSpec.js), the
// object SaveScanButton / ScreensManager hand to `create`. Every key the source carries is
// kept (rank and logic change WHICH stocks match and in what order — dropping them made a
// copy a different screen); only paging, which never belongs in a saved screen, is left out.
export const SAVED_SPEC_KEYS = ['filters', 'sort', 'view', 'columns', 'rank', 'logic']
export const storable = (spec) => {
  const out = { filters: Array.isArray(spec?.filters) ? spec.filters : [] }
  for (const k of SAVED_SPEC_KEYS.slice(1)) if (spec?.[k] != null) out[k] = spec[k]
  return out
}

export const savedScreensKind = {
  name: 'savedScreens',
  boardScoped: false,
  selfDescribing: true,
  list: () => [snap()],
  read: (host, ref) => (ref === 'screens' ? snap() : null),
  stateOf: (s) => ({ ...s, op: null }),
  patch: (before, after) => after.op || null,
  async commit(host, ref, patch) {
    const fresh = await loadSaved({ force: true })                  // the server's list, never the cache
    const mine = (fresh?.saved || []).map(s => ({ id: String(s.id), name: s.name }))
    const taken = (n, except = null) => mine.some(s => s.id !== except && norm(s.name) === norm(n))
    if (patch.create) {
      if (taken(patch.create.name)) throw new Error(`you already have a saved screen named ${quote(patch.create.name)}`)
      const row = await json(await req(ROUTE, send('POST', { name: patch.create.name, spec: patch.create.spec })), 'Saving the screen')
      await loadSaved({ force: true })
      return { created: { [`#${patch.create.name}`]: String(row.id) } }
    }
    const cur = mine.find(s => s.id === String(patch.id))
    if (!cur) throw new Error(`${quote(patch.fromName || 'that screen')} is already gone`)
    if (cur.name !== patch.fromName) throw new Error('that screen changed since I read it — ask again')
    if (patch.rename) {
      if (taken(patch.rename, cur.id)) throw new Error(`you already have a saved screen named ${quote(patch.rename)}`)
      await json(await req(`${ROUTE}/${encodeURIComponent(cur.id)}`, send('PUT', { name: patch.rename })), 'Renaming the screen')
    } else if (patch.remove) {
      await json(await req(`${ROUTE}/${encodeURIComponent(cur.id)}`, { method: 'DELETE' }), 'Deleting the screen')
    }
    await loadSaved({ force: true })
    return true
  },
  landed(s, patch) {
    if (!s) return false
    if (patch.create) return s.mine.some(x => x.name === patch.create.name)
    if (patch.rename) return s.mine.find(x => x.id === String(patch.id))?.name === patch.rename
    if (patch.remove) return !s.mine.some(x => x.id === String(patch.id))
    return false
  },
  // Undo: a rename renames back; a new screen (save-as / copy) is deleted again. A delete has none.
  undoPatch(item) {
    const p = item.patch || {}
    if (p.rename) return { id: p.id, fromName: p.rename, rename: p.fromName }
    if (p.create) {
      const id = Object.values(item.created || {})[0]
      return id ? { id, fromName: p.create.name, remove: true } : null
    }
    return null
  },
  fingerprint: (s) => JSON.stringify(s.mine.map(x => [x.id, x.name])),
  fingerprintFor(host, s, item) {
    const p = item.patch || {}
    const id = p.create ? Object.values(item.created || {})[0] : p.id
    return JSON.stringify(s.mine.find(x => x.id === String(id))?.name ?? null)
  },
}

let registered = false
export function registerSavedScreenCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(savedScreensKind)
  registerContextProvider({
    key: 'savedScreenLibrary',
    refresh: () => loadSaved({ force: true }).catch(() => null),
    build: (host, refFor) => {
      const s = snap()
      return [{
        ref: refFor('savedScreens', 'screens'), label: 'Saved screens (save, rename, copy, delete here)',
        ...(s.loaded ? { yours: s.mine.slice(0, 40).map(x => ({ id: x.id, name: x.name })), starters: s.starters.length } : { status: 'loading' }),
        lastScreenHere: s.last ? `${(s.last.filters || []).length} filter${(s.last.filters || []).length === 1 ? '' : 's'}` : null,
      }]
    },
  })

  const common = { surfaces: ['charts'], target: 'savedScreens', exclusive: true, exclusiveReason: 'Do the saved-screen change on its own, then ask for anything else.' }

  registerCapability({
    ...common,
    name: 'screener.saveAs',
    risk: 'confirm',
    createsResource: true,
    summary: 'Save the LAST screen run here (its exact filters, sort, ranking and logic) as a new saved screen in the member\'s Screener. Never replaces an existing one.',
    hints: 'target = the ref of the savedScreenLibrary entry; name = the name as given. Only when a screen was already run here (lastScreenHere is not null). '
      + 'If they ask to run a NEW screen and save it in one go, run it now (screener.run) and say in the reply that they can then say "save it as <name>".',
    args: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    check(st, { name }) {
      if (!st.loaded) return "I couldn't read your saved screens, so I won't save — try again in a moment."
      if (!st.last) return 'Run a screen here first (e.g. “find stocks with ADR above 5%”), then ask me to save it.'
      return oneAtATime(st) || nameProblem(st, name)
    },
    apply: (st, { name }) => ({ ...st, op: { create: { name: String(name).trim(), spec: storable(st.last), from: 'last' } } }),
    describe: (b, a) => (a.op?.create ? `Saved the last screen (${(a.op.create.spec.filters || []).length} filters) as a new screen ${quote(a.op.create.name)}` : null),
  })

  registerCapability({
    ...common,
    name: 'screener.duplicateSaved',
    risk: 'confirm',
    createsResource: true,
    summary: 'Copy a saved screen (one of the member\'s or a UCT starter) to a new saved screen with exactly the same definition (filters, sort, ranking, logic, view, columns).',
    hints: 'target = the ref of the savedScreenLibrary entry; screen = the id of the screen to copy (from yours, or a starter id from the screener entry\'s savedScreens); '
      + 'name = the new name as given, or null for "<name> copy" (do not ask for a name).',
    args: { type: 'object', properties: { screen: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['screen', 'name'], additionalProperties: false },
    check(st, { screen, name }) {
      if (!st.loaded) return "I couldn't read your saved screens — try again in a moment."
      if (!findAny(st, screen)) return "That screen isn't in your saved screens."
      return oneAtATime(st) || (name == null ? null : nameProblem(st, name))
    },
    apply(st, { screen, name }) {
      const src = findAny(st, screen)
      let to = name == null ? `${src.name} copy` : String(name).trim()
      if (name == null) for (let n = 2; st.mine.some(x => norm(x.name) === norm(to)); n += 1) to = `${src.name} copy ${n}`
      return { ...st, op: { create: { name: to.slice(0, MAX_NAME), spec: storable(src.spec), from: src.name } } }
    },
    describe: (b, a) => (a.op?.create ? `Copied the screen ${quote(a.op.create.from)} to a new saved screen ${quote(a.op.create.name)}` : null),
  })

  registerCapability({
    ...common,
    name: 'screener.renameSaved',
    risk: 'confirm',
    summary: 'Rename one of the member\'s own saved screens.',
    hints: 'target = the ref of the savedScreenLibrary entry; screen = the id of one of YOUR screens; name = the new name as given.',
    args: { type: 'object', properties: { screen: { type: 'string' }, name: { type: 'string' } }, required: ['screen', 'name'], additionalProperties: false },
    check(st, { screen, name }) {
      const s = findMine(st, screen)
      if (!s) return findAny(st, screen) ? "UCT's starter screens can't be renamed — copy it first." : "That screen isn't in your saved screens."
      if (String(name).trim() === s.name) return null
      return oneAtATime(st) || nameProblem(st, name, s.id)
    },
    apply(st, { screen, name }) {
      const s = findMine(st, screen)
      const to = String(name).trim()
      return to === s.name ? st : { ...st, op: { id: s.id, fromName: s.name, rename: to } }
    },
    noop: () => 'It already has that name',
    describe: (b, a) => (a.op?.rename ? `Renamed the screen ${quote(a.op.fromName)} to ${quote(a.op.rename)}` : null),
  })

  registerCapability({
    ...common,
    name: 'screener.deleteSaved',
    risk: 'confirm',
    reversible: false,
    summary: 'Delete one of the member\'s own saved screens (permanent). UCT\'s starter screens cannot be deleted.',
    hints: 'target = the ref of the savedScreenLibrary entry; screen = the id of one of YOUR screens. If more than one could be meant, clarify with the real names — '
      + 'never pick one by similarity. Deleting is always shown as a proposal first, so do not ask "are you sure?".',
    args: { type: 'object', properties: { screen: { type: 'string' } }, required: ['screen'], additionalProperties: false },
    check(st, { screen }) {
      if (!findMine(st, screen)) return findAny(st, screen) ? "UCT's starter screens can't be deleted." : "That screen isn't in your saved screens."
      return oneAtATime(st)
    },
    apply(st, { screen }) {
      const s = findMine(st, screen)
      return { ...st, op: { id: s.id, fromName: s.name, remove: true } }
    },
    describe: (b, a) => (a.op?.remove ? `Deleted the saved screen ${quote(a.op.fromName)} (permanent)` : null),
  })
}
