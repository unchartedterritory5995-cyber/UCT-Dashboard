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

import { namesAnotherKind } from '../nl/collisions'
import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { hasUsableDraft } from './indicatorAuthoring'
import { afterRender } from '../frames'
import { matchName } from '../nl/match'

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
/** NL N2, for HIGH-IMPACT actions (rename, copy): the exact name, else ONE layout within the STRICT
 *  threshold (one edit, 5+ letter words). These are proposals — the card names the real layout. */
function resolveNameStrict(entries, phrase) {
  const exact = resolveName(entries, phrase)
  if (exact) return exact
  const f = matchName(phrase, entries.map(e => e.name), { level: 'strict' })
  return f.kind === 'fuzzy' ? entries.find(e => e.name === f.name) : null
}

/**
 * The layouts the member's words can mean, for OPENING ONLY (rename / delete / save keep the exact
 * name): an id or an exact name → that one; otherwise EVERY layout whose name holds all the words
 * ("my trading layout" → "Main Trading"; with "Day Trading" too → both). [] = none. The caller
 * decides: one opens, several are asked about with the real names, none is refused.
 */
export function layoutCandidates(entries, phrase) {
  const p = String(phrase ?? '').trim()
  if (!p) return []
  const byId = entries.filter(e => String(e.id) === p)
  if (byId.length) return byId
  const bare = p.replace(/^(?:my|the|our)\s+/i, '')
  const exact = resolveName(entries, bare) || (/ layout$/i.test(bare) ? resolveName(entries, bare.replace(/ layout$/i, '')) : null)
  if (exact) return [exact]
  const words = norm(bare).replace(/ layout$/, '').split(' ').filter(w => w.length >= 3)
  if (!words.length) return []
  return entries.filter(e => { const n = ` ${norm(e.name)} `; return words.every(w => n.includes(` ${w} `)) })
}

// ── "the previous layout": this tab's layout trail (pages/charts/layoutTrail.js) ──
// The WHOLE argument must say "previous" (never a substring: "Back Test" is a name).
export const PREVIOUS = 'previous'
const PREVIOUS_WORDS = /^(?:(?:the|my|our) )?(?:(?:previous|last|prior|other|old|earlier)(?: (?:layout|one|board))?|(?:layout|one|board) (?:i|we) (?:was|were|had) (?:just )?(?:on|using|in|open|looking at)|(?:layout|one|board) (?:i|we) had(?: open)?(?: before)?|(?:layout|one|board) before(?: (?:this|that)(?: one)?)?)$/
export const isPrevious = (v) => typeof v === 'string' && PREVIOUS_WORDS.test(norm(v))
// A "go back" lead ("switch back to", "go back to", "return to") takes any previous-phrase; a plain
// open verb only with the word layout/board ("open the last layout"), so "open the last one" is the model's.
const BACK_LEAD = /^(?:please )?(?:(?:switch|go|change|flip|take me|bring me|head|jump|get) back(?: to)?|return to|back to) (.+)$/
const OPEN_LEAD = /^(?:please )?(?:open|load|switch to|change to|go to|take me to|bring up|pull up|jump to) (.+ (?:layout|board))$/
export function backPhrase(lower) {
  const m = BACK_LEAD.exec(lower) || OPEN_LEAD.exec(lower)
  return m && isPrevious(m[1]) ? m[1] : null
}
// The trail's layouts that are still in the layout list, newest first, with today's names (a
// rename keeps its id), never the one open now; at most 5.
function liveRecent(s) {
  const byId = new Map((s.entries || []).map(e => [String(e.id), e]))
  return (s.recent || []).map(r => byId.get(String(r.id))).filter(e => e && String(e.id) !== String(s.active?.id ?? '')).slice(0, 5)
}
function previousSection(s) {
  const live = liveRecent(s)
  const trail = s.recent || []
  const prev = live[0] && trail[0] && String(live[0].id) === String(trail[0].id) ? live[0] : null
  return {
    previous: prev ? { id: String(prev.id), name: prev.name } : null,
    ...(live.length ? { recent: live.map(e => ({ id: String(e.id), name: e.name })) } : {}),
  }
}
function previousProblem(st) {
  const trail = st.recent || []
  if (!(st.entries || []).length) return 'Your layouts are still loading — try again in a moment.'
  if (!trail.length) return "This tab hasn't had another layout open yet, so there's no previous layout to go back to. Tell me which layout to open."
  return `${quote(trail[0].name || 'The layout you had open before')} isn't in your layout list anymore, so I can't go back to it. Tell me which layout to open.`
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
  stateOf: (snap) => ({ entries: snap.entries, active: snap.active, unsaved: snap.unsaved, recent: snap.recent || [], op: null }),
  patch: (before, after) => {
    const op = after.op
    if (!op) return null
    if (op.open) return { open: op.open, from: before.active, discarded: !!before.unsaved }
    if (op.saveAs) return { saveAs: op.saveAs }
    if (op.rename) return { rename: op.rename }
    if (op.remove) return { remove: op.remove }
    if (op.create) return { create: op.create }
    if (op.duplicate) return { duplicate: op.duplicate }
    if (op.saveCurrent) return { saveCurrent: op.saveCurrent }
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
    if (patch.saveCurrent) {
      // The open layout NOW must still be the one the plan saw, and still yours.
      const a = snap().active
      const e = snap().entries.find(x => String(x.id) === String(patch.saveCurrent.id))
      if (!a || String(a.id) !== String(patch.saveCurrent.id) || !e || e.kind !== 'yours') throw new Error('the open layout changed since I read it — ask again')
      const res = await L.saveCurrent()
      if (!res?.ok) throw new Error(res?.named === 'failed' ? `the board was saved but ${quote(e.name)} could not be updated` : 'the board could not be saved (it changed in another tab or device)')
      if (res.named !== 'saved') throw new Error(`${quote(e.name)} could not be updated`)
      return true
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
    if (patch.saveCurrent) return String(snap.active?.id) === String(patch.saveCurrent.id)
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
        // This tab's layout history: `previous` = what "switch back" / "the previous layout" opens
        // (layout.open takes "previous" and resolves it itself); null = none to go back to.
        ...previousSection(s),
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
    hints: 'target = the ref of the layouts entry; layout = the id of one entry in its `layouts` list, or the member\'s own words for it '
      + '("my trading layout" → "trading") — UCT matches the words itself: one match opens, several are asked about with the real names. Do not ask yourself. '
      + 'Only the open layout\'s widgets are in workspace_context; after a switch, ask again for changes on the new board.',
    args: {
      type: 'object',
      properties: { layout: { type: 'string' } },
      required: ['layout'], additionalProperties: false,
    },
    // Tried on the WHOLE sentence too (fastPath matchWhole), so "Okay, now switch back to the
    // previous layout" is not split at its comma into a lead-in that matches nothing.
    fastWhole: true,
    fast: ({ lower, host }) => {
      if (!host?.layouts) return null
      // "switch back to the previous layout" → this tab's layout trail (resolveArgs). A layout
      // whose NAME the words match still wins ("open my last layout" with a layout called "Last").
      const back = backPhrase(lower)
      if (back) {
        const c = layoutCandidates(host.layouts.snapshot().entries, back)
        return c.length === 1 ? { layout: String(c[0].id) } : c.length > 1 ? { layout: back } : { layout: PREVIOUS }
      }
      const m = /^(?:please )?(?:open|load|switch to|change to|go to|go back to|take me to|bring up|pull up|jump to)(?: (?:my|the))? (.+?)$/.exec(lower)
      if (!m) return null
      const entries = host.layouts.snapshot().entries
      const phrase = m[1]
      // "switch to my trading layout" → the layouts named with those words (several → resolveArgs asks);
      // a bare word with no "layout" must be an exact name (so "open NVDA" never opens a layout)
      if (/ layout$/.test(phrase)) {
        const c = layoutCandidates(entries, phrase)
        if (c.length) return c.length === 1 ? { layout: String(c[0].id) } : { layout: phrase }
      }
      // ⛔ Gate B: a bare name that ALSO names a watchlist or saved screen is not claimed here
      // (the model path sees both and asks); "… layout" removes the doubt and was handled above.
      if (namesAnotherKind(host, phrase, 'layout')) return null
      const hit = resolveName(entries, phrase)
      if (hit) return { layout: String(hit.id) }
      // NL N2: a TYPO in a layout's own name ("open swng board") — one clear match opens (switching
      // is reversible and still asks first when edits would be lost); a tie is asked in resolveArgs.
      const f = matchName(phrase.replace(/^(?:my|the|our) /, '').replace(/ layout$/, ''), entries.map(e => e.name))
      if (f.kind === 'fuzzy') return { layout: String(entries.find(e => e.name === f.name).id) }
      return f.kind === 'several' ? { layout: phrase } : null
    },
    // ⭐ The member's WORDS → a real layout, the SAME way on every path (instant, model-planned,
    // approved): useAgent.execute calls this before planning. One match → that id; several → a
    // question with the real names (the panel's own pick flow); none → the check below refuses.
    // Order: an id → a name (exact, or every layout the words name) → "previous" (the trail).
    resolveArgs(args, host) {
      const snap = host?.layouts?.snapshot?.() || {}
      const entries = snap.entries || []
      if (entries.some(e => String(e.id) === String(args.layout))) return null
      const c = layoutCandidates(entries, args.layout)
      if (c.length === 1) return { args: { ...args, layout: String(c[0].id) } }
      if (c.length > 1) return { ask: { arg: 'layout', text: `Which layout — ${c.map(e => quote(e.name)).join(' or ')}?`, choices: c.map(e => ({ ref: String(e.id), label: e.name })) } }
      if (!isPrevious(args.layout)) {
        // NL N2 (after exact names and "previous"): a typo in the name — the same words the model may
        // pass. One clear match → it; a tie → asked with the real names; nothing close → check refuses.
        const f = matchName(String(args.layout || '').replace(/^(?:my|the|our) /i, '').replace(/ layout$/i, ''), entries.map(e => e.name))
        const byName = (n) => entries.find(e => e.name === n)
        if (f.kind === 'fuzzy') return { args: { ...args, layout: String(byName(f.name).id) } }
        if (f.kind === 'several') return { ask: { arg: 'layout', text: `Which layout — ${f.names.map(quote).join(' or ')}?`, choices: f.names.map(n => ({ ref: String(byName(n).id), label: n })) } }
        return null
      }
      // "previous" = the most recent OTHER layout this tab had open, read now (Alt-Tab: A→B, back
      // → A, back → B). Gone since (deleted / no longer offered) → ask among the recent ones left.
      const trail = snap.recent || []
      const live = liveRecent(snap)
      if (!trail.length) return null                                   // check() says why
      if (live[0] && String(live[0].id) === String(trail[0].id)) return { args: { ...args, layout: String(live[0].id) } }
      if (!live.length) return null                                    // check() says why
      return { ask: { arg: 'layout', text: `${quote(trail[0].name || 'The layout you had open before')} isn't in your layout list anymore. Open one of your other recent layouts?`, choices: live.map(e => ({ ref: String(e.id), label: e.name })) } }
    },
    check(st, { layout }) {
      const busy = oneAtATime(st)
      if (busy) return busy
      if (isPrevious(layout) && !entryOf(st, layout)) return previousProblem(st)
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
      // the layout left, from the read-back BEFORE state (never from context or the model); a
      // discard clause already names it. Reads right as a receipt and as a proposal ("Open … in place of …").
      const was = !lost && b.active?.name ? ` in place of ${quote(b.active.name)}` : ''
      return `Opened ${quote(a.op.open.name)}${was}${lost}`
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
    hints: 'target = the ref of the layouts entry; name = the exact name the member gave. If that name is already in the layouts list, do not use this — tell the member instead. ONLY for saving the WORKSPACE/LAYOUT/BOARD: while an indicator draft is active (indicatorDrafts), "save it as X" means the indicator (indicator.saveDraft) unless the member says layout/workspace/board; if you cannot tell, ask.',
    args: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'], additionalProperties: false,
    },
    fast: ({ raw, host }) => {
      const m = /^(?:please )?save (?:this|this setup|this layout|this workspace|this board|the current (?:setup|layout|workspace|board)|it|the board|my setup)? ?as (?:a )?(?:new )?(?:layout )?(?:called |named )?(.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      // ⛔ S6 F2: "save it as X" / "save this as X" / "save as X" name no layout. While an indicator
      // draft is open the referent is not clear, so the fast path never claims it — the planner
      // (and its "which one?" question) decides. Explicit layout/workspace/board wording still fast-paths.
      if (!/\b(layout|workspace|board|setup)\b/i.test(String(raw)) && hasUsableDraft(host)) return null
      const name = m[1].replace(/^[“"'‘]|[”"'’]$/g, '').trim()
      return name ? { name } : null
    },
    check(st, { name }) {
      return oneAtATime(st) || nameProblem(st, name)
    },
    apply: (st, { name }) => ({ ...st, op: { saveAs: String(name).trim() } }),
    describe: (b, a) => (a.op?.saveAs ? `Saved this workspace as a new layout ${quote(a.op.saveAs)} (now open)` : null),
  })

  // ── layout.saveCurrent ──
  // "Save these changes to my current layout": the Layouts ▾ menu's own "Save current
  // arrangement" (the board first; the open layout's saved copy only after the board was
  // accepted). Only the member's OWN layout; there is no Undo (it replaces the saved copy),
  // so it is always proposed. Your own layouts also auto-save as you work — this makes it
  // explicit and confirms it.
  registerCapability({
    name: 'layout.saveCurrent',
    target: 'layouts',
    surfaces: ['charts'],
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Save the layout on its own, after the other changes are done.',
    summary: 'Save the board as it is now into the layout that is OPEN (only the member’s own layout). Replaces that layout’s saved copy; no Undo.',
    hints: 'target = the ref of the layouts entry. Use for "save these changes to my layout". For a NEW layout use layout.saveAs.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      if (!/^(?:please )?save (?:these |the |my |this |all )?(?:changes|arrangement|layout|workspace|board|it)(?: (?:to|into|in|on) (?:my |the |this )?(?:current |open )?(?:layout|workspace))?[.!]?$/i.test(String(raw).trim())) return null
      // ⛔ S6 F2b: "save it" / "save the changes" name no layout. With an indicator draft open the
      // indicator rule decides (saveReferent: the selected draft, or a question) — only explicit
      // layout / workspace / board wording still means this layout's Save.
      if (!/\b(layout|workspace|board|setup|arrangement)\b/i.test(String(raw)) && hasUsableDraft(host)) return null
      return {}
    },
    check(st) {
      const busy = oneAtATime(st)
      if (busy) return busy
      if (!st.active) return 'No saved layout is open — save this board as a new layout instead (give it a name).'
      const e = entryOf(st, String(st.active.id))
      if (!e || e.kind !== 'yours') return `${quote(st.active.name)} is ${e?.kind === 'prebuilt' ? 'a prebuilt' : 'a built-in'} layout — it can't be overwritten. Save this board as a new layout instead.`
      return null
    },
    apply: (st) => ({ ...st, op: { saveCurrent: { id: String(st.active.id), name: st.active.name } } }),
    describe: (b, a) => (a.op?.saveCurrent ? `Saved the current board into your layout ${quote(a.op.saveCurrent.name)} (replaces its saved copy)` : null),
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
      const which = /^(this|this one|current|the current one|it)$/i.test(m[1].trim()) ? (s.active && s.entries.find(e => e.id === s.active.id)) : resolveNameStrict(s.entries, m[1])
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
    fastWhole: true,                // the whole sentence first (it may contain "and")
    // "…and switch to it" is accepted and NOT acted on here: creating comes first, alone, and
    // the receipt says how to open it (measured 2026-10-08: the production model planned
    // create + open together, which a creating plan refuses).
    fast: ({ raw }) => {
      const m = /^(?:please )?(?:create|make|start)(?: me)? (?:a )?(?:new )?(?:blank |empty |fresh |clean )+(?:new )?layout (?:called |named )?(.+?)(?:,? and (?:then )?(?:switch|go|move|change)(?: over)? to it|,? and open it)?[.!]?$/i.exec(String(raw).trim())
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
    fastWhole: true,                // the whole sentence first (it may contain "and")
    // …and "duplicate my Trading Layout and call it Morning Prep": the source is resolved by its
    // EXACT name (measured 2026-10-08: the production model picked "Main Trading" for it).
    fast: ({ raw, host }) => {
      const t = String(raw).trim()
      const named = /^(?:please )?(?:make a copy of|copy|duplicate)(?: my| the)? (.+?)(?:,? and (?:call|name) it| as| named| called) (.+?)[.!]?$/i.exec(t)
      const bare = named ? null : /^(?:please )?(?:make a copy of|copy|duplicate)(?: my| the)? (.+?)[.!]?$/i.exec(t)
      const m = named || bare
      if (!m || !host?.layouts) return null
      if (!named && / as | to | called | named /i.test(m[1])) return null
      const entries = host.layouts.snapshot().entries
      const hit = resolveNameStrict(entries, m[1]) || resolveNameStrict(entries, m[1].replace(/ layout$/i, ''))
      if (!hit) return null
      const name = named ? m[2].replace(/^[“"'‘]|[”"'’]$/g, '').trim() : null
      return { layout: String(hit.id), name: name || null }
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
