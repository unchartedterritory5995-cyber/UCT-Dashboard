// ── LAYOUT capabilities: the member's named Charts layouts ──────────────────
//
// Registered through the same public seam as charts and widgets. The Agent reads
// the Layout Dock's own catalog + active pointer and changes layouts ONLY through
// the dock's handlers (reached via host.layouts — see ChartsWorkspace's
// agentLayoutsRef). It never writes a layout record or layout JSON itself.
//
//   target kind 'layouts'   one target — the member's layout library
//   context 'layouts'       compact catalog: id, name, kind (yours | prebuilt |
//                           built-in), which one is open, unsaved edits
//   layout.current/.list    QUERIES — answered locally from the catalog
//   layout.open             the dock's open. Immediate when nothing is lost;
//                           PROPOSED when it would discard unsaved edits (UCT
//                           Default, a prebuilt or a blank board don't auto-save).
//                           Undo = open the previous layout the same way.
//   layout.saveAs           saveCurrentAs with createOnly: a NEW layout, never a
//                           replacement (the server refuses an existing name).
//                           Always proposed; no Undo (that would be a delete).
//   layout.rename           the dock's rename (PATCH by id; a duplicate is a 409).
//                           Your own layouts only. Proposed; Undo renames back.
//
//   layout.delete           the dock's delete (DELETE by id): your own layouts only,
//                           never the OPEN one (the dock would switch the board to UCT
//                           Default first). Always proposed; re-checked against the
//                           server at Apply; no Undo (a hard delete).
//   layout.duplicate        a copy of a STORED layout under a new name — create-only (the
//                           dock's own duplicate is a name-keyed upsert). Proposed; no Undo.
//
//   layout.create           a NEW EMPTY layout, saved create-only BEFORE anything else
//                           and without touching the board (the dock's own "New layout"
//                           blanks the board first, then upserts by name). Proposed; read
//                           back; it is NOT opened — switching is the ordinary layout.open.
//                           Undo deletes it while it is still unopened and unchanged.
//
// ⛔ Not here, deliberately: deleting the open layout, and overwrite of any kind.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { afterRender } from '../frames'

const MAX_NAME = 60
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()
const quote = (n) => `“${n}”`
const entryOf = (st, id) => st.entries.find(e => String(e.id) === String(id)) || null
const KIND_WORD = { yours: 'yours', prebuilt: 'prebuilt', 'built-in': 'built-in' }

// Wait for React to commit (never for a paint: a hidden tab never paints) — see agent/frames.js.
const nextFrame = afterRender
async function waitFor(fn, budgetMs = 8000) {
  const t0 = Date.now()
  for (;;) {
    if (fn()) return true
    if (Date.now() - t0 > budgetMs) return false
    await nextFrame()
  }
}

/** Exactly one layout whose name is `phrase` (case/quote-insensitive), else null. */
function resolveName(entries, phrase) {
  const want = norm(phrase)
  if (!want) return null
  const hits = entries.filter(e => norm(e.name) === want)
  return hits.length === 1 ? hits[0] : null
}

function snapshotOf(host) {
  if (!host?.layouts) return null
  const s = host.layouts.snapshot()
  return { ref: 'layouts', label: 'Layouts', ...s }
}

export const layoutsKind = {
  name: 'layouts',
  list: (host) => { const s = snapshotOf(host); return s ? [s] : [] },
  read: (host, ref) => (ref === 'layouts' ? snapshotOf(host) : null),
  stateOf: (snap) => ({ entries: snap.entries, active: snap.active, unsaved: snap.unsaved, op: null }),
  patch: (before, after) => {
    const op = after.op
    if (!op) return null
    if (op.open) return { open: op.open, from: before.active, discarded: !!before.unsaved }
    if (op.saveAs) return { saveAs: op.saveAs }
    if (op.rename) return { rename: op.rename }
    if (op.remove) return { remove: op.remove }
    if (op.create) return { create: op.create }
    if (op.duplicate) return { duplicate: op.duplicate }
    return null
  },
  async commit(host, ref, patch) {
    const L = host.layouts
    const snap = () => L.snapshot()
    if (patch.open) {
      L.open(patch.open)
      await waitFor(() => snap().active?.id === patch.open.id)
      return true
    }
    if (patch.rename) {
      await L.rename(patch.rename.id, patch.rename.to)
      await waitFor(() => snap().entries.find(e => e.id === patch.rename.id)?.name === patch.rename.to, 5000)
      return true
    }
    if (patch.saveAs) {
      // Re-read the library right before writing: a layout of that name may have
      // been made in another tab since the plan was checked. The server refuses an
      // existing name as well (createOnly), so nothing is ever replaced.
      try { await L.refresh() } catch { /* the server check still holds */ }
      if (snap().entries.some(e => norm(e.name) === norm(patch.saveAs))) {
        throw new Error(`you already have a layout named ${quote(patch.saveAs)}`)
      }
      await L.saveAs(patch.saveAs)
      await waitFor(() => snap().active?.name === patch.saveAs)
      return true
    }
    if (patch.remove) {
      // The CURRENT library, never the plan's: still yours, same name, and not open now.
      try { await L.refresh() } catch { /* checked below against what we have */ }
      const e = snap().entries.find(x => String(x.id) === String(patch.remove.id))
      if (!e) throw new Error(`${quote(patch.remove.name)} is already gone`)
      if (e.name !== patch.remove.name || e.kind !== 'yours') throw new Error('that layout changed since I read it — ask again')
      if (String(snap().active?.id) === String(e.id)) throw new Error(`${quote(e.name)} is open now — open another layout first`)
      await L.remove(e.id)                       // throws if the server refuses
      try { await L.refresh() } catch { /* landed() reads the cache the delete already updated */ }
      await waitFor(() => !snap().entries.some(x => String(x.id) === String(e.id)), 5000)
      return true
    }
    if (patch.create) {
      try { await L.refresh() } catch { /* the server's create-only check still holds */ }
      if (snap().entries.some(e => norm(e.name) === norm(patch.create.name))) {
        throw new Error(`you already have a layout named ${quote(patch.create.name)}`)
      }
      const saved = await L.create(patch.create.name)      // create-only; throws on refusal
      await waitFor(() => snap().entries.some(e => e.name === patch.create.name), 5000)
      return { created: { [`#${patch.create.name}`]: saved?.id ?? snap().entries.find(e => e.name === patch.create.name)?.id } }
    }
    if (patch.duplicate) {
      try { await L.refresh() } catch { /* the server's create-only check still holds */ }
      if (snap().entries.some(e => norm(e.name) === norm(patch.duplicate.name))) {
        throw new Error(`you already have a layout named ${quote(patch.duplicate.name)}`)
      }
      await L.duplicate(patch.duplicate.fromId, patch.duplicate.name)   // create-only; throws on refusal
      await waitFor(() => snap().entries.some(e => e.name === patch.duplicate.name), 5000)
      return true
    }
    return false
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.open) return snap.active?.id === patch.open.id
    if (patch.rename) return snap.entries.find(e => e.id === patch.rename.id)?.name === patch.rename.to
    if (patch.saveAs) return snap.active?.name === patch.saveAs && snap.entries.some(e => e.name === patch.saveAs)
    if (patch.remove) return !snap.entries.some(e => String(e.id) === String(patch.remove.id))
    if (patch.create) return snap.entries.some(e => e.name === patch.create.name)
    if (patch.duplicate) return snap.entries.some(e => e.name === patch.duplicate.name)
    return false
  },
  // Undo a switch = open the previous layout the same way — only when nothing was
  // discarded by the switch and the previous board was a real layout. Undo a rename
  // = rename it back. A new layout has no Undo (that would be a delete).
  undoPatch(item) {
    const p = item.patch || {}
    if (p.open) return p.from && !p.discarded ? { open: p.from } : null
    if (p.rename) return { rename: { id: p.rename.id, from: p.rename.to, to: p.rename.from } }
    // Undo a create = delete that new, empty, never-opened layout (the delete re-checks it).
    if (p.create) {
      const id = Object.values(item.created || {})[0]
      return id != null ? { remove: { id, name: p.create.name } } : null
    }
    return null
  },
  fingerprint: (snap) => JSON.stringify([snap.active?.id ?? null, snap.entries.map(e => [e.id, e.name])]),
  // Stale undo: a switch is stale once the member changes the board or opens another
  // layout; a rename is stale once that layout is renamed again (or its old name taken).
  fingerprintFor(host, snap, item) {
    const p = item.patch || {}
    if (p.create) {
      const id = Object.values(item.created || {})[0]
      const e = snap.entries.find(x => String(x.id) === String(id))
      return JSON.stringify([e?.name ?? null, String(snap.active?.id) === String(id)])
    }
    if (p.rename) {
      const e = snap.entries.find(x => x.id === p.rename.id)
      const oldTaken = snap.entries.some(x => x.id !== p.rename.id && norm(x.name) === norm(p.rename.from))
      return JSON.stringify([e?.name ?? null, oldTaken])
    }
    return JSON.stringify([snap.active?.id ?? null, snap.arrangement])
  },
}

// One layout change per request: each replaces what the next would be checked against.
const oneAtATime = (st) => (st.op ? 'One layout change at a time — ask for the next one after this.' : null)

function nameProblem(st, name, exceptId = null) {
  const n = String(name || '').trim()
  if (!n) return 'A layout needs a name.'
  if (n.length > MAX_NAME) return `Layout names can be at most ${MAX_NAME} characters.`
  const clash = st.entries.find(e => e.id !== exceptId && norm(e.name) === norm(n))
  if (clash) return `You already have a layout named ${quote(clash.name)} — I won't overwrite it. Pick another name.`
  return null
}

let registered = false
export function registerLayoutCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(layoutsKind)

  registerContextProvider({
    key: 'layouts',
    build: (host, refFor) => {
      const s = snapshotOf(host)
      if (!s) return undefined
      return [{
        ref: refFor('layouts', 'layouts'), label: 'Layouts',
        open: s.active ? { id: String(s.active.id), name: s.active.name } : null,
        // Switching away would discard edits on the board (it is not one of the member's own layouts).
        unsavedChanges: s.unsaved,
        layouts: s.entries.slice(0, 80).map(e => ({ id: String(e.id), name: e.name, kind: KIND_WORD[e.kind] || e.kind })),
      }]
    },
  })

  // ── QUERIES (no model, no mutation) ──
  registerCapability({
    name: 'layout.current',
    target: 'layouts', query: true, surfaces: ['charts'],
    summary: 'Tell the member which named layout is open. UCT answers from the real state — use this (disposition apply) for "which layout am I on?" instead of answering yourself.',
    hints: 'target = the ref of the layouts entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^(what|which) layout (am i (on|in|using)|is (this|open|it)|is currently open|is this board)$|^what('s| is) (my |the )?(current|active|open) layout$/.test(lower) ? {} : null),
    answer(snap) {
      if (!snap) return 'Layouts are not available here.'
      if (!snap.active) return "This board isn't saved as a layout. You can say “save this as …” to keep it."
      const e = snap.entries.find(x => x.id === snap.active.id)
      const kind = e ? ` (${KIND_WORD[e.kind] || e.kind})` : ''
      const edits = snap.unsaved ? ' It has unsaved changes.' : ''
      return `You're on ${quote(snap.active.name)}${kind}.${edits}`
    },
  })
  registerCapability({
    name: 'layout.list',
    target: 'layouts', query: true, surfaces: ['charts'],
    summary: 'List the member\'s named layouts. UCT answers from the real list — use this (disposition apply) whenever they ask what layouts they have, instead of listing them yourself.',
    hints: 'target = the ref of the layouts entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^((what|which) layouts (do i have|have i got|are there)|(show|list)( me)?( all)?( of)?( my| the)? layouts|what are my layouts|my layouts)$/.test(lower) ? {} : null),
    answer(snap) {
      if (!snap) return 'Layouts are not available here.'
      const label = (e) => `${e.name}${snap.active?.id === e.id ? ' (open)' : ''}`
      const groups = [['Yours', 'yours'], ['Prebuilt', 'prebuilt'], ['Built-in', 'built-in']]
        .map(([title, k]) => [title, snap.entries.filter(e => e.kind === k)])
        .filter(([, list]) => list.length)
      if (!groups.length) return 'You have no saved layouts yet.'
      return groups.map(([title, list]) => `${title}: ${list.map(label).join(', ')}`).join('\n')
    },
  })

  // ── layout.open ──
  registerCapability({
    name: 'layout.open',
    target: 'layouts',
    surfaces: ['charts'],
    exclusive: true,
    exclusiveReason: 'Opening a layout replaces the whole board, so do it in two steps: open the layout first, then ask for the changes.',
    summary: 'Open (switch to) one of the member\'s named layouts on the Charts workspace — exactly like clicking it in the Layout Dock.',
    hints: 'target = the ref of the layouts entry; layout = the id of one entry in its `layouts` list (never invent one). '
      + 'If more than one layout could be what the member means, or none matches, clarify with the real names instead of guessing. '
      + 'Only the open layout\'s widgets are in workspace_context; after a switch, ask again for changes on the new board.',
    args: {
      type: 'object',
      properties: { layout: { type: 'string' } },
      required: ['layout'], additionalProperties: false,
    },
    fast: ({ lower, host }) => {
      const m = /^(?:please )?(?:open|load|switch to|change to|go to|go back to|take me to|bring up|pull up|jump to)(?: (?:my|the))? (.+?)$/.exec(lower)
      if (!m || !host?.layouts) return null
      const entries = host.layouts.snapshot().entries
      const phrase = m[1]
      const hit = resolveName(entries, phrase) || (/ layout$/.test(phrase) ? resolveName(entries, phrase.replace(/ layout$/, '')) : null)
      return hit ? { layout: String(hit.id) } : null
    },
    check(st, { layout }) {
      const busy = oneAtATime(st)
      if (busy) return busy
      if (!entryOf(st, layout)) return "That layout isn't in your layout list."
      return null
    },
    // Switching away from a board whose edits are not saved anywhere discards them: ask first.
    confirmIf: (st, { layout }) => st.unsaved && String(st.active?.id) !== String(layout),
    apply(st, { layout }) {
      const e = entryOf(st, layout)
      if (String(st.active?.id) === String(e.id)) return st
      return { ...st, op: { open: { id: e.id, name: e.name, scope: e.scope } } }
    },
    noop: (st) => `${quote(st.active?.name || 'That layout')} is already open`,
    describe(b, a) {
      if (!a.op?.open) return null
      const lost = b.unsaved ? ` — unsaved changes on ${b.active ? quote(b.active.name) : 'this board'} are discarded` : ''
      return `Opened ${quote(a.op.open.name)}${lost}`
    },
  })

  // ── layout.saveAs ──
  registerCapability({
    name: 'layout.saveAs',
    target: 'layouts',
    surfaces: ['charts'],
    risk: 'confirm',
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Save the layout on its own, then ask for any other changes.',
    summary: 'Save the current Charts workspace as a NEW named layout (it becomes the open layout). Never replaces an existing layout.',
    hints: 'target = the ref of the layouts entry; name = the exact name the member gave. If that name is already in the layouts list, do not use this — tell the member instead.',
    args: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'], additionalProperties: false,
    },
    fast: ({ raw }) => {
      const m = /^(?:please )?save (?:this|this setup|this layout|this workspace|this board|the current (?:setup|layout|workspace|board)|it|the board|my setup)? ?as (?:a )?(?:new )?(?:layout )?(?:called |named )?(.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      const name = m[1].replace(/^[“"'‘]|[”"'’]$/g, '').trim()
      return name ? { name } : null
    },
    check(st, { name }) {
      return oneAtATime(st) || nameProblem(st, name)
    },
    apply: (st, { name }) => ({ ...st, op: { saveAs: String(name).trim() } }),
    describe: (b, a) => (a.op?.saveAs ? `Saved this workspace as a new layout ${quote(a.op.saveAs)} (now open)` : null),
  })

  // ── layout.rename ──
  registerCapability({
    name: 'layout.rename',
    target: 'layouts',
    surfaces: ['charts'],
    risk: 'confirm',
    exclusive: true,
    exclusiveReason: 'Rename the layout on its own, then ask for any other changes.',
    summary: 'Rename one of the member\'s OWN layouts (not prebuilt or built-in ones).',
    hints: 'target = the ref of the layouts entry; layout = the id of the layout to rename (the open one if they say "this layout"); name = the new name exactly as given.',
    args: {
      type: 'object',
      properties: { layout: { type: 'string' }, name: { type: 'string' } },
      required: ['layout', 'name'], additionalProperties: false,
    },
    fast: ({ raw, host }) => {
      const m = /^(?:please )?rename (?:my |the )?(.+?)(?: layout)? to (.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.layouts) return null
      const s = host.layouts.snapshot()
      const which = /^(this|this one|current|the current one|it)$/i.test(m[1].trim()) ? (s.active && s.entries.find(e => e.id === s.active.id)) : resolveName(s.entries, m[1])
      const name = m[2].replace(/^[“"'‘]|[”"'’]$/g, '').trim()
      return which && name ? { layout: String(which.id), name } : null
    },
    check(st, { layout, name }) {
      const busy = oneAtATime(st)
      if (busy) return busy
      const e = entryOf(st, layout)
      if (!e) return "That layout isn't in your layout list."
      if (e.kind !== 'yours') return `${quote(e.name)} is a ${e.kind} layout — only your own layouts can be renamed.`
      if (String(name).trim() === e.name) return null
      return nameProblem(st, name, e.id)
    },
    apply(st, { layout, name }) {
      const e = entryOf(st, layout)
      const to = String(name).trim()
      if (to === e.name) return st
      return { ...st, op: { rename: { id: e.id, from: e.name, to } } }
    },
    noop: (st, _a, { layout }) => `It is already called ${quote(entryOf(st, layout)?.name || '')}`,
    describe: (b, a) => (a.op?.rename ? `Renamed ${quote(a.op.rename.from)} to ${quote(a.op.rename.to)}` : null),
  })

  // ── layout.create ──
  registerCapability({
    name: 'layout.create',
    target: 'layouts',
    surfaces: ['charts'],
    risk: 'confirm',
    exclusive: true,
    exclusiveReason: 'Create the layout on its own, then ask to open it or for other changes.',
    summary: 'Create a NEW, EMPTY named layout (no widgets) for the member. The current board is not touched and the new layout is NOT opened.',
    hints: 'target = the ref of the layouts entry; name = the exact name the member gave. To save the board AS IT IS NOW, use layout.saveAs instead. '
      + 'If they also want to switch to it, create it now and say in the reply that they can then say "open <name>" (switching is a separate step).',
    args: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    fast: ({ raw }) => {
      const m = /^(?:please )?(?:create|make|start)(?: me)? (?:a )?(?:new )?(?:blank |empty |fresh |clean )+(?:new )?layout (?:called |named )?(.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      const name = m[1].replace(/^[“"'‘]|[”"'’]$/g, '').trim()
      return name ? { name } : null
    },
    check: (st, { name }) => oneAtATime(st) || nameProblem(st, name),
    apply: (st, { name }) => ({ ...st, op: { create: { name: String(name).trim() } } }),
    describe: (b, a) => (a.op?.create ? `Created a new empty layout ${quote(a.op.create.name)} — your current board is unchanged (say “open ${a.op.create.name}” to switch to it)` : null),
  })

  // ── layout.delete ──
  registerCapability({
    name: 'layout.delete',
    target: 'layouts',
    surfaces: ['charts'],
    risk: 'confirm',
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Delete the layout on its own, then ask for any other changes.',
    summary: 'Delete one of the member\'s OWN saved layouts (permanent). Not the layout that is open now, not prebuilt or built-in layouts.',
    hints: 'target = the ref of the layouts entry; layout = the id of that layout in the layouts list. If more than one layout could be meant, '
      + 'or none matches exactly, clarify with the real names — never pick one by similarity. Deleting is always shown as a proposal first, so do not ask "are you sure?".',
    args: { type: 'object', properties: { layout: { type: 'string' } }, required: ['layout'], additionalProperties: false },
    check(st, { layout }) {
      const busy = oneAtATime(st)
      if (busy) return busy
      const e = entryOf(st, layout)
      if (!e) return "That layout isn't in your layout list."
      if (e.kind !== 'yours') return `${quote(e.name)} is a ${e.kind} layout — only your own layouts can be deleted.`
      if (String(st.active?.id) === String(e.id)) return `${quote(e.name)} is the layout open now — open another layout first, then ask me to delete it.`
      return null
    },
    apply(st, { layout }) {
      const e = entryOf(st, layout)
      return { ...st, op: { remove: { id: e.id, name: e.name } } }
    },
    describe: (b, a) => (a.op?.remove ? `Deleted the layout ${quote(a.op.remove.name)} (permanent)` : null),
  })

  // ── layout.duplicate ──
  registerCapability({
    name: 'layout.duplicate',
    target: 'layouts',
    surfaces: ['charts'],
    risk: 'confirm',
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Copy the layout on its own, then ask for any other changes.',
    summary: 'Make a copy of a saved layout (its stored version) under a new name, as one of the member\'s own layouts. Does not open it.',
    hints: 'target = the ref of the layouts entry; layout = the id of the layout to copy (the open one for "this layout"); '
      + 'name = the new name as given, or null when they give none (UCT names it "<name> copy" and the proposal shows it — do not ask for a name). '
      + 'To save the board AS IT IS NOW under a new name, use layout.saveAs instead.',
    args: { type: 'object', properties: { layout: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['layout', 'name'], additionalProperties: false },
    // "make a copy of my Swing Layout" / "duplicate Earnings Watch": an EXACT layout name, no
    // new name → the default "<name> copy" (shown in the proposal). Measured 2026-10-08: the
    // production model asked for a name here 2 of 3 times.
    fast: ({ raw, host }) => {
      const m = /^(?:please )?(?:make a copy of|copy|duplicate)(?: my| the)? (.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.layouts || / as | to | called | named /i.test(m[1])) return null
      const entries = host.layouts.snapshot().entries
      const hit = resolveName(entries, m[1]) || resolveName(entries, m[1].replace(/ layout$/i, ''))
      return hit ? { layout: String(hit.id), name: null } : null
    },
    check(st, { layout, name }) {
      const busy = oneAtATime(st)
      if (busy) return busy
      const e = entryOf(st, layout)
      if (!e) return "That layout isn't in your layout list."
      return name == null ? null : nameProblem(st, name)
    },
    apply(st, { layout, name }) {
      const e = entryOf(st, layout)
      let to = name == null ? `${e.name} copy` : String(name).trim()
      if (name == null) for (let n = 2; st.entries.some(x => norm(x.name) === norm(to)); n += 1) to = `${e.name} copy ${n}`
      return { ...st, op: { duplicate: { fromId: e.id, fromName: e.name, name: to.slice(0, MAX_NAME) } } }
    },
    describe: (b, a) => (a.op?.duplicate ? `Copied ${quote(a.op.duplicate.fromName)} to a new layout ${quote(a.op.duplicate.name)}` : null),
  })
}
