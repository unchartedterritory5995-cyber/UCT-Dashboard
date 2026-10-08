// ── WATCHLIST capabilities: the member's saved watchlists (the DATA) ────────
//
// Registered through the same public seam as charts, widgets and layouts. This is
// about the LISTS — `widget.add {type: watchlist}` (a Watchlist widget on the board)
// is a different thing and stays where it is. Reads come from the same
// `/api/watchlists` the Watchlists page uses; writes go ONLY through the same REST
// routes the page calls (host.watchlists — see agent/host.js buildWatchlistSource).
//
//   kind 'watchlist'         one target per OWN saved list (ref = its real id).
//                            Not board-scoped: a saved list is the same list in
//                            every layout, so a layout switch does not stale it.
//   kind 'watchlistLibrary'  one target — where a NEW list is created
//   watchlist.list / .show   QUERIES — answered from the real lists
//   watchlist.add            bulk add (the server skips symbols already there);
//                            every ticker checked first, all or nothing.
//                            Undo removes exactly the items THIS add created.
//   watchlist.remove         delete-by-item; Undo re-adds them (with their notes)
//                            and restores the exact order through the reorder route.
//   watchlist.create         a new list (proposed; never replaces one — names are
//                            checked against your lists first). `as` names it for
//                            later ops in the same request (create + populate).
//   watchlist.rename         proposed; Undo renames it back.
//
//   watchlist.clear          every symbol out (the remove path: per item, re-checked first,
//                            taken back on a partial failure); proposed; Undo re-adds them.
//   watchlist.delete         the whole list (the Watchlists page's DELETE, hard): proposed;
//                            never a list a Watchlist widget on this board is showing (the
//                            widget would keep pointing at a list that is gone); no Undo.
//
// ⛔ Not here: reorder, the flagged list (it syncs as a
// whole set — an overwrite race), prebuilt / community / linked lists (read-only).
// No revision exists server-side, so every write re-reads the list from the server
// first and refuses if it moved since the plan was made.

import { registerCapability, registerTargetKind, registerContextProvider, isRef, SYMBOLS } from '../capabilities'
import { unknownSymbols } from '../agentClient'
import { afterRender } from '../frames'
// Each list's tickers ARE shown to the model (removing "TSLA from Momentum" needs it:
// without them the production model asked whether TSLA was in the list, 0/5 —
// measured 2026-10-08). Provenance does not depend on hiding them: a copied list
// is bound back to the list deterministically (compose.bindCopiedLiterals).
const SHOW_IN_CONTEXT = 40           // symbols per list the model is shown
const COMPACT_SHOW = 8               // …per list when the context is over budget

const MAX_PER_REQUEST = 50           // symbols one add/remove may carry
const CONFIRM_OVER = 10              // a bigger batch is proposed first
const MAX_NAME = 80
const TICKER = /^[A-Z0-9.$:^_\-/]{1,24}$/
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()
const quote = (n) => `“${n}”`
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')

/** "A", "A and B", "A, B and C" */
export function andList(xs) {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** Split "RKLB, PLTR and ASTS" → ['RKLB','PLTR','ASTS']; null if anything isn't a ticker. */
export function parseTickers(text) {
  const parts = String(text || '').split(/\s*(?:,|\band\b|&|\+)\s*/i).map(s => s.trim().replace(/^\$/, '')).filter(Boolean)
  if (!parts.length || parts.length > MAX_PER_REQUEST) return null
  if (!parts.every(p => /^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(p))) return null
  return parts.map(p => p.toUpperCase())
}

function snapOf(l, all = []) {
  return {
    ref: l.id, label: l.name, name: l.name, items: l.items, symbols: l.items.map(i => i.sym),
    editable: l.editable, why: l.why, shownIn: l.shownIn, position: null,
    otherNames: all.filter(x => x.id !== l.id).map(x => x.name),
  }
}
const listsOf = (host) => (host?.watchlists ? host.watchlists.snapshot() : [])
const sigOf = (items) => JSON.stringify(items.map(i => [i.id, i.sym]))

/** One list by name (exact, case/quote-insensitive), or the one visible list for "my/this/the watchlist". */
function resolveList(host, phrase) {
  const lists = listsOf(host)
  const p = norm(phrase).replace(/ (watch ?list|list)$/, '')
  if (/^(my|this|the|our) ?(watch ?list|list)?$/.test(norm(phrase)) || /^(my|this|the)$/.test(p)) {
    const shown = lists.filter(l => l.shownIn.length)
    return shown.length === 1 ? shown[0] : null
  }
  const hits = lists.filter(l => norm(l.name) === p || norm(l.name) === norm(phrase))
  return hits.length === 1 ? hits[0] : null
}

// Wait for React to commit (never for a paint: a hidden tab never paints) — see agent/frames.js.
const nextFrame = afterRender

export const watchlistKind = {
  name: 'watchlist',
  boardScoped: false,
  // Its receipt lines already name the list ("Added AMD to “Momentum”").
  selfDescribing: true,
  list: (host) => { const all = listsOf(host); return all.map(l => snapOf(l, all)) },
  read: (host, ref) => { const all = listsOf(host); const l = all.find(x => x.id === ref); return l ? snapOf(l, all) : null },
  virtual: ({ alias, spec }) => ({ ref: alias, label: spec?.name || 'New watchlist', name: spec?.name || 'New watchlist', items: [], symbols: [], editable: true, why: null, shownIn: [], position: null, otherNames: [], virtual: true }),
  stateOf: (snap) => ({ name: snap.name, symbols: snap.symbols, items: snap.items, otherNames: snap.otherNames || [], add: [], skipped: [], remove: [], absent: [], rename: null, addFrom: null, deleteList: false }),
  patch(before, after) {
    if (after.deleteList) return { deleteList: true, name: before.name, beforeSig: sigOf(before.items) }
    const p = {}
    if (after.add.length) p.add = after.add
    if (after.remove.length) p.remove = after.remove
    if (after.rename) p.rename = after.rename
    if (!Object.keys(p).length) return null
    return { ...p, beforeSig: sigOf(before.items), beforeItems: before.items }
  },
  async commit(host, ref, patch) {
    const W = host.watchlists
    // No revision exists server-side: re-read the list and refuse if it moved since
    // this plan was made (a write in another tab, a manual edit, a pending undo).
    let cur
    try { cur = await W.fetchList(ref) } catch (e) {
      if (patch.deleteList) throw new Error(`${patch.name ? `“${patch.name}”` : 'that watchlist'} is already gone`)
      throw e
    }
    const curItems = (cur.items || []).map(i => ({ id: String(i.id), sym: String(i.sym).toUpperCase(), notes: i.notes || '' }))
    if (patch.beforeSig && sigOf(curItems) !== patch.beforeSig) throw new Error('changed since I read it — ask again')
    if (patch.deleteList) {
      if (cur.name !== patch.name) throw new Error('changed since I read it — ask again')
      const shown = (W.snapshot().find(l => l.id === String(ref))?.shownIn || [])
      if (shown.length) throw new Error('a Watchlist widget on this board is showing it now')
      await W.deleteList(ref)                    // throws if the server refuses
      await nextFrame()
      return true
    }
    if (patch.undoAdd) {
      const ids = new Set(curItems.map(i => i.id))
      if (!patch.undoAdd.every(id => ids.has(id))) throw new Error('changed since — undoing would remove the wrong things')
      for (const id of patch.undoAdd) await W.removeItem(ref, id)
    }
    if (patch.undoRemove) {
      // Only onto the list exactly as the Agent left it: putting rows back in their old
      // places rewrites the whole order, which must not overwrite a newer manual edit.
      if (patch.expectSig && sigOf(curItems) !== patch.expectSig) throw new Error('changed since — undoing would overwrite newer edits')
      // Re-add (with their notes), then put every row back exactly where it was.
      for (const it of patch.undoRemove) await W.addItem(ref, it.sym, it.notes)
      const now = (await W.fetchList(ref)).items.map(i => ({ id: String(i.id), sym: String(i.sym).toUpperCase() }))
      const idOf = Object.fromEntries(now.map(i => [i.sym, i.id]))
      const order = patch.order.map(sym => idOf[sym]).filter(Boolean)
      if (order.length === now.length) await W.reorder(ref, order)
    }
    if (patch.add) await W.bulkAdd(ref, patch.add)
    // A later step that fails takes back what bulkAdd just added (the rows that were
    // not there before), so a half-applied patch never stays behind silently.
    const takeBackAdds = async (e) => {
      if (!patch.add) return e
      try {
        const had = new Set(curItems.map(i => i.id))
        const now = (await W.fetchList(ref)).items || []
        const wanted = new Set(patch.add.map(s => String(s).toUpperCase()))
        for (const i of now) if (!had.has(String(i.id)) && wanted.has(String(i.sym).toUpperCase())) await W.removeItem(ref, String(i.id))
      } catch { e.unreverted = true }
      return e
    }
    if (patch.remove) {
      const done = []
      try {
        for (const it of patch.remove) { await W.removeItem(ref, it.id); done.push(it) }
      } catch (e) {
        for (const it of done) { try { await W.addItem(ref, it.sym, it.notes) } catch { e.unreverted = true } }
        throw await takeBackAdds(e)
      }
    }
    if (patch.rename) {
      try { await W.rename(ref, patch.rename.to) } catch (e) { throw await takeBackAdds(e) }
    }
    if (patch.undoRename) await W.rename(ref, patch.undoRename)
    await W.settle(ref)
    await nextFrame()
    return true
  },
  landed(snap, patch) {
    if (patch.deleteList) return !snap
    if (!snap) return false
    const have = new Set(snap.symbols)
    if (patch.add && !patch.add.every(s => have.has(s))) return false
    if (patch.remove && patch.remove.some(it => have.has(it.sym))) return false
    if (patch.undoAdd && patch.undoAdd.some(id => snap.items.some(i => i.id === id))) return false
    if (patch.undoRemove && !patch.undoRemove.every(it => have.has(it.sym))) return false
    if (patch.rename && snap.name !== patch.rename.to) return false
    if (patch.undoRename && snap.name !== patch.undoRename) return false
    return true
  },
  // Undo an add = remove exactly the rows THIS add created (found by comparing the
  // list before and after). Undo a remove = re-add them and restore the old order.
  undoPatch(item) {
    const p = item.patch || {}
    if (p.deleteList) return null              // a hard delete: nothing brings the same list back
    const out = {}
    if (p.add) {
      const before = new Set((item.before?.items || []).map(i => i.id))
      const mine = (item.after?.items || []).filter(i => p.add.includes(i.sym) && !before.has(i.id)).map(i => i.id)
      out.undoAdd = mine
    }
    if (p.remove) {
      out.undoRemove = p.remove
      out.order = (item.before?.items || []).map(i => i.sym)
      out.expectSig = sigOf(item.after?.items || [])
    }
    if (p.rename) out.undoRename = p.rename.from
    return Object.keys(out).length ? out : null
  },
  fingerprint: (snap) => (snap ? sigOf(snap.items) + '|' + snap.name : 'gone'),
  // Stale undo, delta-aware: an ADD can be taken back while every row it created is
  // still there (other edits to the list are left alone); a REMOVE restores the old
  // order, so it needs the list exactly as the Agent left it; a RENAME needs the name.
  fingerprintFor(host, snap, item) {
    if (!snap) return 'gone'                   // after a whole-list delete there is nothing to read
    const p = item.patch || {}
    if (p.remove) return sigOf(snap.items)
    if (p.add) {
      const u = watchlistKind.undoPatch(item)
      const ids = new Set(snap.items.map(i => i.id))
      return JSON.stringify((u?.undoAdd || []).map(id => ids.has(id)))
    }
    if (p.rename) return snap.name
    return sigOf(snap.items)
  },
}

function libSnap(host) {
  const all = listsOf(host)
  return { ref: 'watchlists', label: 'Watchlists', names: all.map(l => l.name), lists: all.map(l => ({ name: l.name, count: l.items.length, shownIn: l.shownIn })) }
}

// Where new lists are made. Creating returns the real id for `as` (create + populate).
export const watchlistLibraryKind = {
  name: 'watchlistLibrary',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => (host?.watchlists ? [libSnap(host)] : []),
  read: (host, ref) => (ref === 'watchlists' && host?.watchlists ? libSnap(host) : null),
  stateOf: (snap) => ({ names: snap.names, creates: [] }),
  patch: (before, after) => (after.creates.length ? { create: after.creates } : null),
  async commit(host, ref, patch) {
    const W = host.watchlists
    if (patch.deleteCreated) {
      for (const id of patch.deleteCreated) await W.deleteCreated(id)
      return true
    }
    // Names are not unique server-side, so check the CURRENT library right before
    // creating: a list of that name is never duplicated or replaced.
    const taken = new Set((await W.fetchAll()).map(l => norm(l.name)))
    // Every name is checked BEFORE the first create, so a clash never strands an
    // earlier list of the same request.
    for (const c of patch.create) {
      if (taken.has(norm(c.name))) throw new Error(`you already have a watchlist named ${quote(c.name)}`)
      taken.add(norm(c.name))
    }
    const created = {}
    for (const c of patch.create) {
      try {
        const row = await W.create(c.name)
        created[c.alias || `#${c.name}`] = String(row.id)
      } catch (e) {
        e.created = created                // the runtime takes these back
        throw e
      }
    }
    return { created }
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.deleteCreated) return true
    return patch.create.every(c => snap.names.some(n => n === c.name))
  },
  // A member's Undo never deletes a list. If a LATER step of the same request fails,
  // the list this transaction just created is taken back (it held nothing else).
  undoPatch: () => null,
  compensatePatch(item) {
    const ids = Object.values(item.created || item.partial || {})
    return ids.length ? { deleteCreated: ids } : null
  },
  fingerprint: (snap) => JSON.stringify(snap.names),
}

function editProblem(st, env) {
  const snap = env?.target
  if (snap && !snap.editable) return `${quote(snap.name)} can't be edited here — ${snap.why}.`
  return null
}

let registered = false
export function registerWatchlistCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(watchlistKind)
  registerTargetKind(watchlistLibraryKind)

  registerContextProvider({
    key: 'watchlists',
    // Over the context budget: fewer tickers per list, and the count of the rest is stated.
    compact: (lists) => (lists || []).map(l => {
      const syms = l.symbols || []
      if (syms.length <= COMPACT_SHOW) return l
      return { ...l, symbols: syms.slice(0, COMPACT_SHOW), moreSymbols: (l.count || syms.length) - COMPACT_SHOW }
    }),
    build: (host, refFor) => {
      if (!host?.watchlists) return undefined
      return listsOf(host).slice(0, 40).map(l => ({
        ref: refFor('watchlist', l.id), name: l.name, count: l.items.length,
        symbols: l.items.slice(0, SHOW_IN_CONTEXT).map(i => i.sym),
        ...(l.items.length > SHOW_IN_CONTEXT ? { moreSymbols: l.items.length - SHOW_IN_CONTEXT } : {}),
        ...(l.shownIn.length ? { shownInWidget: l.shownIn } : {}),
        ...(l.editable ? {} : { readOnly: l.why }),
      }))
    },
  })
  registerContextProvider({
    key: 'watchlistLibrary',
    build: (host, refFor) => (host?.watchlists ? [{ ref: refFor('watchlistLibrary', 'watchlists'), label: 'Watchlists (create new lists here)' }] : undefined),
  })

  // ── QUERIES ──
  registerCapability({
    name: 'watchlist.list',
    surfaces: ['charts'],
    target: 'watchlistLibrary', query: true,
    summary: 'List the member\'s saved watchlists (names and sizes). UCT answers from the real lists — use this (disposition apply) whenever they ask what watchlists they have.',
    hints: 'target = the ref of the watchlistLibrary entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower }) => (/^((what|which) (watch ?lists|lists) (do i have|have i got|are there)|(show|list)( me)?( all)?( of)?( my)? watch ?lists|what are my watch ?lists|my watch ?lists)$/.test(lower) ? {} : null),
    answer(snap) {
      if (!snap) return 'Watchlists are not available here.'
      if (!snap.lists.length) return "You don't have any saved watchlists yet."
      return `Your watchlists: ${snap.lists.map(l => `${l.name} (${l.count})${l.shownIn.length ? ' — showing' : ''}`).join(', ')}`
    },
  })
  registerCapability({
    name: 'watchlist.show',
    surfaces: ['charts'],
    target: 'watchlist', query: true,
    summary: 'Say which symbols are in one of the member\'s watchlists. UCT answers from the real list — use this (disposition apply) for "what\'s in <list>?".',
    hints: 'target = the ref of that watchlist. as: name this list\'s STOCKS (e.g. "list1") when a later op in the same request uses them '
      + '(e.g. widget.addCharts symbols {from:"list1", top:N}); else null.',
    args: { type: 'object', properties: { as: { type: ['string', 'null'] } }, required: ['as'], additionalProperties: false },
    fastWhole: true,
    // ── PRODUCER: a saved list's tickers, in its saved order, read FRESH from the
    // server at apply (bound to the list's stable id — never its name, never the
    // cache). Reading never changes the list.
    produces: SYMBOLS,
    // What the list holds right now, as the panel last read it — used ONLY to
    // recognise a copied literal (compose.bindCopiedLiterals); apply re-reads.
    peekSymbols: (snap) => snap?.symbols || [],
    validateProduce(args, target, host) {
      if (host && !watchlistKind.read(host, target)) return "I couldn't find that watchlist."
      return null
    },
    describeProduce(args, target, host) {
      const snap = host ? watchlistKind.read(host, target) : null
      return `Use the stocks in ${quote(snap?.name || 'that watchlist')} (its saved order) — read when you apply`
    },
    async produce(args, host, target) {
      const row = await host.watchlists.fetchList(target)
      const symbols = [...new Set((row?.items || []).map(i => String(i?.sym || '').toUpperCase()).filter(Boolean))]
      const name = row?.name || watchlistKind.read(host, target)?.name || 'that watchlist'
      return { symbols, summary: symbols.length ? `Read ${quote(name)}: ${symbols.length} stock${symbols.length === 1 ? '' : 's'}` : `${quote(name)} is empty` }
    },
    fast: ({ raw, host }) => {
      // The whole phrase reaches resolveList, which tries it as-is and without a
      // trailing "watchlist" — a list may itself be named "… Watchlist".
      const m = /^(?:what(?:'s| is) in|show(?: me)?|list(?: the symbols in)?|what(?:'s| is) on) (?:my |the )?(.+?)[?.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.watchlists) return null
      const l = resolveList(host, m[1])
      return l ? { as: null, __target: l.id } : null
    },
    answer(snap) {
      if (!snap) return "I couldn't find that watchlist."
      if (!snap.symbols.length) return `${quote(snap.name)} is empty.`
      return `${quote(snap.name)} (${snap.symbols.length}): ${snap.symbols.join(', ')}`
    },
  })

  // ── watchlist.add ──
  registerCapability({
    name: 'watchlist.add',
    surfaces: ['charts'],
    target: 'watchlist',
    fastWhole: true,
    summary: 'Add tickers to one of the member\'s saved watchlists (the list itself, not a widget). Symbols already in the list are skipped.',
    hints: 'target = the ref of the watchlist (or the "as" name of a list created earlier in this request); symbols = the tickers, uppercase, '
      + 'OR {from, top} to add a SCREEN\'s stocks: from = the "as" of a screener op earlier in this request (or "lastScreen" for the last screen run here), '
      + 'top = how many of its results, in its order (null = all, at most 50). Never type tickers you have not been given. '
      + 'If they say "my watchlist" and it is not clear which list, clarify with the real list names. One op per list.',
    args: {
      type: 'object',
      properties: {
        symbols: { anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'object', properties: { from: { type: 'string' }, top: { type: ['integer', 'null'] } }, required: ['from', 'top'], additionalProperties: false },
        ] },
      },
      required: ['symbols'], additionalProperties: false,
    },
    // A typed-output input (compose.js): a screen's ordered tickers may feed it.
    inputs: { symbols: SYMBOLS },
    fast: ({ raw, host }) => {
      const m = /^(?:please )?(?:add|put|throw|stick) (.+?) (?:to|in|into|on|onto) (.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.watchlists) return null
      const syms = parseTickers(m[1])
      const l = syms && resolveList(host, m[2])
      return l ? { symbols: syms, __target: l.id } : null
    },
    // Model-typed tickers are looked up; a screen's results (`trusted` — they came
    // from UCT's own Screener) and pending references are not.
    async prepare(ops) {
      const syms = [...new Set(ops.filter(o => !o.trusted && Array.isArray(o.args?.symbols)).flatMap(o => o.args.symbols.map(upper)).filter(Boolean))]
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { symbols }, env) {
      const bad = editProblem(st, env)
      if (bad) return bad
      if (isRef(symbols)) {
        if (symbols.top === null || symbols.top > MAX_PER_REQUEST) return `Say how many of its stocks to add (up to ${MAX_PER_REQUEST}).`
        return null
      }
      if (!Array.isArray(symbols)) return '“symbols” has the wrong kind of value.'
      const syms = symbols.map(upper)
      if (!syms.length) return 'Which tickers?'
      if (syms.length > MAX_PER_REQUEST) return `That's more than ${MAX_PER_REQUEST} tickers at once — split it up.`
      const odd = syms.find(s => !TICKER.test(s))
      if (odd) return `“${odd}” doesn't look like a ticker.`
      const unknown = syms.filter(s => env?.unknownSymbols?.has(s))
      if (unknown.length) return `UCT has no symbol ${andList(unknown.map(s => `“${s}”`))} — nothing was added.`
      return null
    },
    confirmIf: (st, { symbols }) => isRef(symbols) || (symbols || []).length > CONFIRM_OVER,
    apply(st, { symbols }) {
      // Before approval a reference is only an INTENT — its stocks don't exist yet.
      if (isRef(symbols)) return { ...st, addFrom: symbols }
      const have = new Set([...st.symbols, ...st.add])
      const add = []; const skipped = [...st.skipped]
      for (const s of [...new Set((symbols || []).map(upper))]) (have.has(s) ? skipped : add).push(s)
      if (!add.length) return st          // nothing new: a no-op, said as one
      return { ...st, add: [...st.add, ...add], skipped }
    },
    noop: (st, _a, { symbols }) => `${andList((symbols || []).map(upper))} ${(symbols || []).length === 1 ? 'is' : 'are'} already in ${quote(st.name)}`,
    describe(b, a) {
      if (a.addFrom && !b.addFrom) return `Add the top ${a.addFrom.top} of its results to ${quote(a.name)}`
      if (!a.add.length) return null
      // A long add is counted, not listed — the watchlist itself is the record.
      const what = a.add.length > 5 ? `${a.add.length} stocks` : andList(a.add)
      const skip = !a.skipped.length ? ''
        : a.skipped.length > 3 ? ` · ${a.skipped.length} were already there`
          : ` · ${andList(a.skipped)} ${a.skipped.length === 1 ? 'was' : 'were'} already there`
      return `Added ${what} to ${quote(a.name)}${skip}`
    },
  })

  // ── watchlist.remove ──
  registerCapability({
    name: 'watchlist.remove',
    surfaces: ['charts'],
    target: 'watchlist',
    fastWhole: true,
    summary: 'Remove specific tickers from one of the member\'s saved watchlists. Never clears a whole list.',
    hints: 'target = the ref of the watchlist; symbols = exactly the tickers to remove.',
    args: {
      type: 'object',
      properties: { symbols: { type: 'array', items: { type: 'string' } } },
      required: ['symbols'], additionalProperties: false,
    },
    fast: ({ raw, host }) => {
      const m = /^(?:please )?(?:remove|delete|drop|take) (.+?) (?:from|off|off of|out of) (.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.watchlists) return null
      const syms = parseTickers(m[1])
      const l = syms && resolveList(host, m[2])
      return l ? { symbols: syms, __target: l.id } : null
    },
    check(st, { symbols }, env) {
      const bad = editProblem(st, env)
      if (bad) return bad
      const syms = (symbols || []).map(upper)
      if (!syms.length) return 'Which tickers?'
      if (syms.length > MAX_PER_REQUEST) return `That's more than ${MAX_PER_REQUEST} tickers at once — split it up.`
      if (!syms.some(s => st.symbols.includes(s))) return `${andList(syms)} ${syms.length === 1 ? "isn't" : "aren't"} in ${quote(st.name)}.`
      return null
    },
    confirmIf: (st, { symbols }) => (symbols || []).length > CONFIRM_OVER,
    apply(st, { symbols }) {
      const want = [...new Set((symbols || []).map(upper))]
      const gone = new Set(st.remove.map(r => r.sym))
      const remove = [...st.remove]; const absent = [...st.absent]
      for (const s of want) {
        const it = st.items.find(i => i.sym === s)
        if (it && !gone.has(s)) remove.push({ id: it.id, sym: s, notes: it.notes })
        else if (!it) absent.push(s)
      }
      return { ...st, remove, absent }
    },
    describe(b, a) {
      if (!a.remove.length) return null
      const miss = a.absent.length ? ` · ${andList(a.absent)} ${a.absent.length === 1 ? "wasn't" : "weren't"} in it` : ''
      return `Removed ${andList(a.remove.map(r => r.sym))} from ${quote(a.name)}${miss}`
    },
  })

  // ── watchlist.clear ──
  registerCapability({
    name: 'watchlist.clear',
    surfaces: ['charts'],
    target: 'watchlist',
    risk: 'confirm',
    summary: 'Remove EVERY symbol from one of the member\'s saved watchlists (the list itself stays). Always shown as a proposal with the count first.',
    hints: 'target = the ref of the watchlist. For only some symbols use watchlist.remove. If it is not clear which list, clarify with the real names.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check(st, _a, env) {
      const bad = editProblem(st, env)
      if (bad) return bad
      if (st.remove.length || st.add.length) return 'Clear the list on its own, then ask for other changes.'
      if (!st.items.length) return null
      if (st.items.length > MAX_PER_REQUEST) return `${quote(st.name)} has ${st.items.length} stocks — more than I clear at once (${MAX_PER_REQUEST}). Clear it on the Watchlists page.`
      return null
    },
    apply: (st) => (st.items.length ? { ...st, remove: st.items.map(it => ({ id: it.id, sym: it.sym, notes: it.notes })) } : st),
    noop: (st) => `${quote(st.name)} is already empty`,
    describe: (b, a) => (a.remove.length ? `Cleared all ${a.remove.length} stock${a.remove.length === 1 ? '' : 's'} from ${quote(a.name)}` : null),
  })

  // ── watchlist.delete ──
  registerCapability({
    name: 'watchlist.delete',
    surfaces: ['charts'],
    target: 'watchlist',
    risk: 'confirm',
    reversible: false,
    summary: 'Delete one of the member\'s saved watchlists entirely (permanent). Not a list a Watchlist widget on this board is showing.',
    hints: 'target = the ref of the watchlist. If more than one list could be meant, clarify with the real names — never pick one by similarity. '
      + 'Deleting is always shown as a proposal first, so do not ask "are you sure?". To empty a list but keep it, use watchlist.clear.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check(st, _a, env) {
      const snap = env?.target
      if (snap?.shownIn?.length) return `${quote(st.name)} is showing in a Watchlist widget on this board — switch that widget to another list (or remove it) first, then ask me to delete the list.`
      if (st.remove.length || st.add.length || st.rename) return 'Delete the list on its own.'
      return null
    },
    apply: (st) => ({ ...st, deleteList: true }),
    describe: (b, a) => (a.deleteList ? `Deleted the watchlist ${quote(b.name)} and its ${b.items.length} stock${b.items.length === 1 ? '' : 's'} (permanent)` : null),
  })

  // ── watchlist.create ──
  registerCapability({
    name: 'watchlist.create',
    surfaces: ['charts'],
    target: 'watchlistLibrary',
    risk: 'confirm', reversible: false,
    createsResource: true,
    summary: 'Create a NEW saved watchlist (a named list of tickers) — only when they ask to create or make a list. "Add a watchlist" with no list name means a Watchlist WIDGET on the board: that is widget.add, not this.',
    hints: 'target = the ref of the watchlistLibrary entry; name = exactly as given. To fill it in the same request set "as" to a short name (new1) '
      + 'and target watchlist.add at that name; otherwise "as" is null. Never use this for a name already in the watchlists list — '
      + 'if they ask to put stocks in a list "called X" and X already exists, clarify (add to the existing X, or a new name); never silently append.',
    args: {
      type: 'object',
      properties: { name: { type: 'string' }, as: { type: ['string', 'null'] } },
      required: ['name', 'as'], additionalProperties: false,
    },
    creates: (args) => (args.as ? { kind: 'watchlist', alias: String(args.as), spec: { name: String(args.name || '').trim() } } : null),
    check(st, { name, as }) {
      const n = String(name || '').trim()
      if (!n) return 'A watchlist needs a name.'
      if (n.length > MAX_NAME) return `Watchlist names can be at most ${MAX_NAME} characters.`
      if (as != null && !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(String(as))) return `“${as}” isn't a usable name for a new list.`
      const clash = st.names.find(x => norm(x) === norm(n)) || st.creates.find(c => norm(c.name) === norm(n))?.name
      if (clash) return `You already have a watchlist named ${quote(clash)}, so I won't make a second one. Say “add them to ${clash}” to add to it, or give the new list another name.`
      return null
    },
    apply: (st, { name, as }) => ({ ...st, creates: [...st.creates, { name: String(name).trim(), alias: as ?? null }] }),
    describe: (b, a) => (a.creates.length > b.creates.length ? `Created the watchlist ${quote(a.creates[a.creates.length - 1].name)}` : null),
  })

  // ── watchlist.rename ──
  registerCapability({
    name: 'watchlist.rename',
    surfaces: ['charts'],
    target: 'watchlist',
    risk: 'confirm',
    summary: 'Rename one of the member\'s saved watchlists.',
    hints: 'target = the ref of the watchlist; name = the new name exactly as given.',
    args: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      const m = /^(?:please )?rename (?:my |the )?(.+?) to (.+?)[.!]?$/i.exec(String(raw).trim())
      if (!m || !host?.watchlists) return null
      const l = resolveList(host, m[1])
      const name = m[2].replace(/^[“"'‘]|[”"'’]$/g, '').trim()
      return l && name ? { name, __target: l.id } : null
    },
    check(st, { name }, env) {
      const bad = editProblem(st, env)
      if (bad) return bad
      const n = String(name || '').trim()
      if (!n) return 'A watchlist needs a name.'
      if (n.length > MAX_NAME) return `Watchlist names can be at most ${MAX_NAME} characters.`
      if (n === st.name) return null
      const clash = st.otherNames.find(x => norm(x) === norm(n))
      if (clash) return `You already have a watchlist named ${quote(clash)} — pick another name.`
      return null
    },
    apply: (st, { name }) => (String(name).trim() === st.name ? st : { ...st, rename: { from: st.name, to: String(name).trim() }, name: String(name).trim() }),
    noop: (st) => `It is already called ${quote(st.name)}`,
    describe: (b, a) => (a.rename ? `Renamed the watchlist ${quote(a.rename.from)} to ${quote(a.rename.to)}` : null),
  })
}
