// ── LIST WIDGET capabilities: a Watchlist or Scanner widget as it is DRAWN, and the Flagged set ─────────────────────
//
// watchlist.js is about the saved LIST (the data on the server). This is about the widget showing one: its column sort,
// its columns, which row the group is on, and what its rows are right now. All of that lives in the mounted widget
// (`colCfg` in Watchlists.jsx, shared by every Watchlist widget through one storage key, per scan for a Scanner, the way
// a header click leaves it), so a target here IS a mounted widget (host.listViews, agent/host.js) and a widget that is not
// on the board is not a target. Writes go through the widget's own writers: saveColCfg, and the pair the arrow keys call.
//
//   kind 'listView'              one target per Watchlist / Scanner widget showing a list on the visible board
//   kind 'flaggedList'           the one Flagged set
//   watchlist.sortColumn         the header click: sort by a column, or go back to the saved order. A column that is not
//                                showing joins first (its data is only fetched while it shows), and the receipt says so.
//   watchlist.setColumns         the right-click column menu: add, hide, reset
//   watchlist.step               the arrow keys: next / previous / first / last, wrapping the same way
//   watchlist.readView           what the widget shows, in its on-screen order (a producer: "the top three of this list")
//   watchlist.setFlag            the star: flag or unflag tickers
//
// ⛔ Not here: the performance column preset. Its popover exists only in the unscoped page mode no member can reach
// (see the note at the top of Watchlists.jsx), so nothing a member sees would change.

import { registerCapability, registerTargetKind, registerContextProvider, SYMBOLS } from '../capabilities'
import { afterRender } from '../frames'
import { andList, lookupTickers, tickerProblem } from './watchlist'
import { resolvedTicker } from '../nl/tickers'
import { OPTIONAL_COLS, EXTRA_COLS, TEXT_COLS, columnLabel, firstSortDir, resolveColumn, withColumn, withoutColumn } from '../../pages/watchlist/watchlistColumns'

const SHOW_IN_CONTEXT = 40             // rows per widget the model is shown
const COMPACT_SHOW = 8                 // …when the context is over budget
const ANSWER_ROWS = 50
const MAX_FLAGS = 50
const CONFIRM_OVER = 10
const FLAG_REF = 'flagged'
const quote = (n) => `“${n}”`
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ALL_COLUMNS = [...OPTIONAL_COLS, ...EXTRA_COLS].map(c => columnLabel(c.key)).join(', ')

const viewsOf = (host) => (host?.listViews ? host.listViews.snapshot() : [])
const viewOf = (host, ref) => viewsOf(host).find(v => v.ref === ref) || null
const dirWords = (key, dir) => (key === 'sym' || TEXT_COLS.has(key) ? (dir === 'asc' ? 'A to Z' : 'Z to A') : (dir === 'asc' ? 'low to high' : 'high to low'))
const sortText = (s) => (s ? `sorted by ${columnLabel(s.key)}, ${dirWords(s.key, s.dir)}` : 'in its saved order')
const notKept = (st) => (st.persisted ? '' : ' (for now: this list goes back to its default columns when reopened)')

export const listViewKind = {
  name: 'listView',
  selfDescribing: true,                // its lines name the list
  list: viewsOf,
  read: viewOf,
  stateOf: (snap) => ({ name: snap.name, cfg: snap.cfg, sort: snap.sort, columns: snap.columns, rows: snap.rows, selected: snap.selected, persisted: snap.persisted, fixedColumns: snap.fixedColumns, select: null, wrapped: false, added: [], hid: [], reset: false, sortDropped: false }),
  patch(before, after) {
    const p = {}
    if (!same(before.cfg, after.cfg)) p.cfg = after.cfg
    if (after.select && after.select !== before.selected) p.select = after.select
    return Object.keys(p).length ? p : null
  },
  async commit(host, ref, patch) {
    if (!viewOf(host, ref)) throw new Error('that list is no longer on the board')
    if (patch.cfg) host.listViews.saveCols(ref, patch.cfg)
    if (patch.select) host.listViews.select(ref, patch.select)
    await afterRender()
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.cfg && !same(snap.cfg, patch.cfg)) return false
    if (patch.select && snap.selected !== patch.select) return false
    return true
  },
  undoPatch(item) {
    const p = item.patch || {}
    const out = {}
    if (p.cfg) out.cfg = item.before?.cfg ?? {}
    if (p.select && item.before?.selected) out.select = item.before.selected
    return Object.keys(out).length ? out : null
  },
  fingerprint: (snap) => (snap ? JSON.stringify([snap.cfg, snap.selected]) : 'gone'),
  fingerprintFor(host, snap, item) {
    if (!snap) return 'gone'
    const p = item.patch || {}
    return JSON.stringify([p.cfg ? snap.cfg : null, p.select ? snap.selected : null])
  },
}

const flagSnap = (host) => {
  const symbols = host.flagged.read()
  return { ref: FLAG_REF, label: 'Flagged', name: 'Flagged', symbols }
}

export const flaggedKind = {
  name: 'flaggedList',
  boardScoped: false,                  // the same set in every layout
  selfDescribing: true,
  list: (host) => (host?.flagged ? [flagSnap(host)] : []),
  read: (host, ref) => (ref === FLAG_REF && host?.flagged ? flagSnap(host) : null),
  stateOf: (snap) => ({ symbols: snap.symbols, add: [], remove: [], skipped: [] }),
  patch: (before, after) => (after.add.length || after.remove.length ? { add: after.add, remove: after.remove } : null),
  async commit(host, ref, patch) {
    const cur = host.flagged.read()
    let next = [...cur.filter(s => !patch.remove.includes(s)), ...patch.add.filter(s => !cur.includes(s))]
    // an Undo goes back to the order it read, when the set it would give is that same set
    if (patch.order && same([...patch.order].sort(), [...next].sort())) next = patch.order
    await host.flagged.write(next)
    await afterRender()
    return true
  },
  landed(snap, patch) {
    return !!snap && patch.add.every(s => snap.symbols.includes(s)) && !patch.remove.some(s => snap.symbols.includes(s))
  },
  undoPatch(item) {
    const p = item.patch || {}
    return { add: p.remove || [], remove: p.add || [], order: item.before?.symbols || [] }
  },
  fingerprint: (snap) => (snap ? JSON.stringify(snap.symbols) : 'gone'),
  // only what THIS change touched: a flag set by hand since does not cost its Undo
  fingerprintFor(host, snap, item) {
    const p = item.patch || {}
    return JSON.stringify([...(p.add || []), ...(p.remove || [])].map(s => !!snap?.symbols.includes(s)))
  },
}

/** A view's columns said in the model's terms. */
const columnNames = (v) => v.columns.filter(k => k !== 'flag').map(columnLabel)

function unknownColumn(word, st) {
  const here = st.columns.filter(k => k !== 'flag').map(columnLabel)
  return `${quote(String(word))} isn't a column here. Columns: ${[...new Set([...here, ...ALL_COLUMNS.split(', ')])].join(', ')}.`
}
const keyOf = (word, st) => resolveColumn(word, st.columns)

let registered = false
export function registerListViewCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(listViewKind)
  registerTargetKind(flaggedKind)

  registerContextProvider({
    key: 'listViews',
    compact: (views) => (views || []).map(v => ((v.rows || []).length <= COMPACT_SHOW ? v : { ...v, rows: v.rows.slice(0, COMPACT_SHOW), moreRows: v.count - COMPACT_SHOW })),
    build(host, refFor) {
      const views = viewsOf(host)
      if (!views.length) return undefined
      return views.map(v => ({
        ref: refFor('listView', v.ref), widget: v.type, name: v.name, count: v.rows.length,
        rows: v.rows.slice(0, SHOW_IN_CONTEXT),
        ...(v.rows.length > SHOW_IN_CONTEXT ? { moreRows: v.rows.length - SHOW_IN_CONTEXT } : {}),
        order: sortText(v.sort), columns: columnNames(v),
        ...(v.selected ? { on: v.selected } : {}),
        ...(v.position ? { position: v.position } : {}),
        ...(v.active ? { active: true } : {}),
        ...(v.listId ? { savedList: true } : {}),      // one of the member's own lists: its name is the watchlists entry's name
      }))
    },
  })
  registerContextProvider({
    key: 'flagged',
    compact: (s) => (s || []).map(f => ((f.symbols || []).length <= COMPACT_SHOW ? f : { ...f, symbols: f.symbols.slice(0, COMPACT_SHOW) })),
    build(host, refFor) {
      if (!host?.flagged) return undefined
      const symbols = host.flagged.read()
      return [{ ref: refFor('flaggedList', FLAG_REF), count: symbols.length, symbols: symbols.slice(0, SHOW_IN_CONTEXT) }]
    },
  })

  const WHICH = 'target = the ref of the listViews entry: the one marked active for "this list", the one named as the list they name ("my Momentum list"; for "the one I just made", the watchlists entry marked recent), the only entry for "my watchlist"; several could be meant → clarify by name or position. No entry means no such widget is on this board: say so, offer watchlist.open.'

  registerCapability({
    name: 'watchlist.sortColumn',
    surfaces: ['charts'],
    target: 'listView',
    summary: 'Sort what a Watchlist or Scanner widget shows by one of its columns (price, % change, RVOL, market cap…), the header click. It changes the view, not the saved order. column null = back to the saved order. Undo puts the old sort back.',
    hints: `${WHICH} column = the column as they said it; direction = asc | desc | null (null = the header's own first click: Symbol A to Z, others high to low; "biggest / top / highest" = desc, "lowest / smallest" = asc). A column not showing is added. Columns: ${ALL_COLUMNS}. For a permanent A to Z of the saved list use watchlist.reorder.`,
    args: { type: 'object', properties: { column: { type: ['string', 'null'] }, direction: { type: ['string', 'null'], enum: ['asc', 'desc', null] } }, required: ['column', 'direction'], additionalProperties: false },
    coerce: { direction: { ascending: 'asc', descending: 'desc', up: 'asc', down: 'desc', 'low to high': 'asc', 'high to low': 'desc', 'a to z': 'asc', 'z to a': 'desc' } },
    shape: '{"column":"RVOL","direction":"desc"}',
    check(st, { column, direction }) {
      if (column == null) return null
      const key = keyOf(column, st)
      if (!key || key === 'flag') return unknownColumn(column, st)
      if (direction != null && direction !== 'asc' && direction !== 'desc') return 'Sort which way: high to low, or low to high?'
      if (st.fixedColumns && !st.columns.includes(key)) return `${quote(st.name)} only has the ${andList(st.columns.filter(k => k !== 'flag').map(columnLabel))} columns.`
      return null
    },
    apply(st, { column, direction }) {
      if (column == null) return st.sort ? { ...st, cfg: { ...st.cfg, sort: null }, sort: null } : st
      const key = keyOf(column, st)
      const sort = { key, dir: direction || firstSortDir(key) }
      const showing = st.columns.includes(key)
      if (showing && same(st.sort, sort)) return st
      const cfg = { ...(showing ? st.cfg : withColumn(st.cfg, key)), sort }
      return { ...st, cfg, sort, columns: showing ? st.columns : [...st.columns, key], added: showing ? st.added : [...st.added, key] }
    },
    noop: (st, _a, { column }) => (column == null ? `${quote(st.name)} isn't sorted by a column` : `${quote(st.name)} is already ${sortText(st.sort)}`),
    describe(b, a) {
      if (same(b.sort, a.sort)) return null
      if (!a.sort) return `${quote(a.name)} is back in its saved order${notKept(a)}`
      const added = a.added.includes(a.sort.key) ? `Added the ${columnLabel(a.sort.key)} column and sorted` : 'Sorted'
      return `${added} ${quote(a.name)} by ${columnLabel(a.sort.key)}, ${dirWords(a.sort.key, a.sort.dir)}${notKept(a)}`
    },
  })

  registerCapability({
    name: 'watchlist.setColumns',
    surfaces: ['charts'],
    target: 'listView',
    summary: 'Add or hide columns on a Watchlist or Scanner widget, or reset them to the defaults (the right-click column menu). Undo puts the old columns back.',
    hints: `${WHICH} add / hide = columns as they said them ([] for none); reset = true only for "reset my columns" (the defaults, then add / hide). Symbol and the flag star can't be hidden. Columns: ${ALL_COLUMNS}. Nothing else exists: a column not listed is refused, never swapped for a near one.`,
    args: { type: 'object', properties: { add: { type: 'array', items: { type: 'string' } }, hide: { type: 'array', items: { type: 'string' } }, reset: { type: 'boolean' } }, required: ['add', 'hide', 'reset'], additionalProperties: false },
    shape: '{"add":["RVOL"],"hide":["Volume"],"reset":false}',
    check(st, { add, hide, reset }) {
      if (!(add || []).length && !(hide || []).length && !reset) return 'Which columns?'
      if (st.fixedColumns) return `${quote(st.name)} has fixed columns.`
      for (const w of [...(add || []), ...(hide || [])]) {
        const k = keyOf(w, st)
        if (!k || k === 'flag') return unknownColumn(w, st)
      }
      if ((hide || []).some(w => keyOf(w, st) === 'sym')) return "Symbol can't be hidden."
      const both = (add || []).find(w => (hide || []).some(h => keyOf(h, st) === keyOf(w, st)))
      return both ? `Show ${columnLabel(keyOf(both, st))}, or hide it?` : null
    },
    apply(st, { add, hide, reset }) {
      let cfg = reset ? {} : st.cfg
      let columns = st.columns
      const addKeys = (add || []).map(w => keyOf(w, st)).filter(k => k !== 'sym')
      const hideKeys = (hide || []).map(w => keyOf(w, st))
      const added = addKeys.filter(k => !columns.includes(k))
      for (const k of added) { cfg = withColumn(cfg, k); columns = [...columns, k] }
      const hid = hideKeys.filter(k => columns.includes(k))
      for (const k of hid) { cfg = withoutColumn(cfg, k); columns = columns.filter(x => x !== k) }
      // a column's data is only fetched while it shows: a sort left on a hidden column would quietly stop ordering anything
      const sortDropped = !!cfg.sort && hid.includes(cfg.sort.key)
      if (sortDropped) cfg = { ...cfg, sort: null }
      if (same(cfg, st.cfg)) return st
      return { ...st, cfg, columns, sort: cfg.sort || null, added: [...st.added, ...added], hid: [...st.hid, ...hid], reset: st.reset || (!!reset && !same(st.cfg, {})), sortDropped: st.sortDropped || sortDropped }
    },
    noop: (st, _a, { add, hide, reset }) => (reset ? `The columns on ${quote(st.name)} are already the defaults` : `${quote(st.name)} already ${(add || []).length ? 'shows' : 'hides'} ${andList([...(add || []), ...(hide || [])].map(w => columnLabel(keyOf(w, st))))}`),
    describe(b, a) {
      const parts = []
      if (a.reset) parts.push(`Reset the columns on ${quote(a.name)}`)
      if (a.added.length) parts.push(`Added ${andList(a.added.map(columnLabel))} to ${quote(a.name)}`)
      if (a.hid.length) parts.push(`Hid ${andList(a.hid.map(columnLabel))} on ${quote(a.name)}`)
      if (!parts.length) return null
      return `${parts.join(' · ')}${a.sortDropped ? ' · it is no longer sorted by that column' : ''}${notKept(a)}`
    },
  })

  registerCapability({
    name: 'watchlist.step',
    surfaces: ['charts'],
    target: 'listView',
    summary: 'Move to the next or previous ticker in a Watchlist or Scanner widget, in the order it shows them (the arrow keys; the linked chart follows). Also first / last. Undo goes back to the ticker before.',
    hints: `${WHICH} direction = next | previous | first | last; by = how many rows (null = 1): "next ticker" = next, "skip two" = next by 3. It wraps at the ends, as the arrow keys do. Never compute the ticker yourself.`,
    args: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous', 'first', 'last'] }, by: { type: ['integer', 'null'] } }, required: ['direction', 'by'], additionalProperties: false },
    absentAsNull: ['by'],
    coerce: { direction: { down: 'next', forward: 'next', prev: 'previous', up: 'previous', back: 'previous', top: 'first', bottom: 'last' } },
    check(st, { direction, by }) {
      if (!['next', 'previous', 'first', 'last'].includes(direction)) return 'Next, previous, first or last?'
      if (!st.rows.length) return `${quote(st.name)} has no tickers showing.`
      if (by != null && (!Number.isInteger(by) || by < 1 || by > st.rows.length)) return `${quote(st.name)} has ${st.rows.length} rows, so I can move 1 to ${st.rows.length}.`
      if ((direction === 'next' || direction === 'previous') && st.selected && !st.rows.includes(st.selected)) return `The linked chart is on ${st.selected}, which isn't in ${quote(st.name)}. Say which ticker, or ask for the first one.`
      return null
    },
    apply(st, { direction, by }) {
      const n = st.rows.length
      if (direction === 'first' || direction === 'last') {
        const select = st.rows[direction === 'first' ? 0 : n - 1]
        return select === st.selected ? st : { ...st, select }
      }
      const at = st.selected ? st.rows.indexOf(st.selected) : -1
      const step = by ?? 1
      if (at < 0) return { ...st, select: direction === 'next' ? st.rows[0] : st.rows[n - 1] }      // nothing selected: the keys' own start
      const raw = direction === 'next' ? at + step : at - step
      const select = st.rows[((raw % n) + n) % n]
      return select === st.selected ? st : { ...st, select, wrapped: raw < 0 || raw >= n }
    },
    noop: (st, _a, { direction, by }) => (direction === 'first' || direction === 'last' ? `${st.selected} is already the ${direction} name in ${quote(st.name)}` : `That lands back on ${st.selected}: ${by ? 'that many rows is the whole of' : "it's the only name in"} ${quote(st.name)}`),
    describe(b, a) {
      if (!a.select || a.select === b.selected) return null
      return `${a.select} in ${quote(a.name)}${b.selected ? ` (from ${b.selected}${a.wrapped ? ', wrapped around' : ''})` : ''}`
    },
  })

  registerCapability({
    name: 'watchlist.readView',
    surfaces: ['charts'],
    target: 'listView',
    query: true,
    summary: 'Say what a Watchlist or Scanner widget shows right now: its tickers in on-screen order (its column sort applied), its sort and columns. Use it for "what\'s at the top of this list". Its rows are in the listViews context too, so "remove the top three" can name them directly.',
    hints: `${WHICH} as: name these STOCKS (e.g. "view1") when a later op in the same request uses them, e.g. watchlist.add symbols {from:"view1", top:3}; else null. It never reports prices.`,
    args: { type: 'object', properties: { as: { type: ['string', 'null'] } }, required: ['as'], additionalProperties: false },
    produces: SYMBOLS,
    peekSymbols: (snap) => snap?.rows || [],
    validateProduce(args, target, host) { return host && !viewOf(host, target) ? 'That list is not on the board.' : null },
    describeProduce(args, target, host) { return `Use the stocks showing in ${quote(viewOf(host, target)?.name || 'that list')}, in that order`; },
    async produce(args, host, target) {
      const v = viewOf(host, target)
      const symbols = [...new Set(v?.rows || [])]
      return { symbols, summary: symbols.length ? `Read ${quote(v.name)}: ${symbols.length} stock${symbols.length === 1 ? '' : 's'}` : `${quote(v?.name || 'that list')} shows nothing` }
    },
    answer(snap) {
      if (!snap) return 'That list is not on the board.'
      if (!snap.rows.length) return `${quote(snap.name)} shows nothing right now.`
      const shown = snap.rows.slice(0, ANSWER_ROWS)
      const more = snap.rows.length - shown.length
      return `${quote(snap.name)} (${snap.rows.length}, ${sortText(snap.sort)}): ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}. Columns: ${columnNames(snap).join(', ')}.`
    },
  })

  registerCapability({
    name: 'watchlist.setFlag',
    surfaces: ['charts'],
    target: 'flaggedList',
    summary: 'Flag or unflag tickers: the star on a row and Shift+F, one Flagged set across the whole app. Undo puts it back.',
    hints: 'target = the ref of the flagged entry; symbols = the tickers, uppercase; flagged = true to flag, false to unflag. Never type tickers you have not been given: "this one" is the chart\'s symbol, "the top three" is the first rows of the listViews entry.',
    args: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } }, flagged: { type: 'boolean' } }, required: ['symbols', 'flagged'], additionalProperties: false },
    prepare: lookupTickers,
    check(st, { symbols, flagged }, env) {
      const syms = (symbols || []).map(upper).filter(Boolean)
      if (!syms.length) return 'Which tickers?'
      if (syms.length > MAX_FLAGS) return `That's more than ${MAX_FLAGS} tickers at once — split it up.`
      return flagged ? tickerProblem(syms, env, 'flagged') : null
    },
    confirmIf: (st, { symbols }) => (symbols || []).length > CONFIRM_OVER,
    apply(st, { symbols, flagged }) {
      const want = [...new Set((symbols || []).map(s => resolvedTicker(upper(s))))]
      if (flagged) {
        const add = want.filter(s => !st.symbols.includes(s) && !st.add.includes(s))
        return add.length ? { ...st, add: [...st.add, ...add], skipped: want.filter(s => !add.includes(s)) } : st
      }
      const remove = want.filter(s => st.symbols.includes(s) && !st.remove.includes(s))
      return remove.length ? { ...st, remove: [...st.remove, ...remove], skipped: want.filter(s => !remove.includes(s)) } : st
    },
    noop: (st, _a, { symbols, flagged }) => {
      const syms = (symbols || []).map(upper)
      return `${andList(syms)} ${flagged ? (syms.length === 1 ? 'is already flagged' : 'are already flagged') : (syms.length === 1 ? "isn't flagged" : "aren't flagged")}`
    },
    describe(b, a, { flagged }) {
      const list = flagged ? a.add : a.remove
      if (!list.length) return null
      const what = list.length > 5 ? `${list.length} stocks` : andList(list)
      const skip = a.skipped.length ? ` · ${andList(a.skipped)} ${flagged ? (a.skipped.length === 1 ? 'was already flagged' : 'were already flagged') : (a.skipped.length === 1 ? "wasn't flagged" : "weren't flagged")}` : ''
      return `${flagged ? 'Flagged' : 'Unflagged'} ${what}${skip}`
    },
  })
}
