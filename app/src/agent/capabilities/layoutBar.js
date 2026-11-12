// ── THE LAYOUT BAR: pin, reorder and take layouts off the Layout Dock (C3-037..039) ──
//
// The Layout Dock along the bottom of /charts has two parts (pages/charts/LayoutDock.jsx):
// the LIBRARY (every layout the member has; the only place one can be deleted) and the RAIL
// or BAR (positional slots that point into the library, for switching fast). This file is
// the bar only. It reads and writes through the dock's own door (host.layoutDock, agent/host.js
// buildLayoutDockSource), which uses the dock's own writer and the menu's positional helpers.
//
//   layout.pinToBar      the library's "add to bar". The slot goes on the end. Unlike the click,
//                        it does NOT open the layout: switching the board is layout.open, which
//                        asks first when unsaved edits would be lost. Undo takes that slot off.
//   layout.unpinFromBar  the slot menu's "Close". The layout stays in the library (never a
//                        delete). Undo puts the same layout back in the same slot.
//   layout.moveOnBar     the slot menu's "← Move left" / "Move right →", once or repeated
//                        ("to the front", "to position 2"). Undo moves it back.
//
// Targets are the member's words for a layout, resolved the way layout.open resolves them
// (layoutCandidates: an id, an exact name, or every layout whose name holds all the words).
// Several layouts, or one layout sitting in two slots → the Agent asks with the real names and
// changes nothing. A fast phrase is claimed only when it says "bar"/"dock" (or "pin"/"unpin"
// with "layout") and names exactly one layout; everything else goes to the model.
//
// Every write is checked against the bar as it was planned (nothing is written over a bar that
// changed since), and a receipt is given only when the server accepted the write. A refused
// write is put back, and the member is told nothing changed.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { layoutCandidates } from './layout'
import { addPin, removePin, shiftPin } from '../../pages/charts/layoutDockPins'
import { afterRender } from '../frames'

const quote = (n) => `“${n}”`
const same = (a, b) => JSON.stringify((a || []).map(String)) === JSON.stringify((b || []).map(String))
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

async function waitFor(fn, budgetMs = 4000) {
  const t0 = Date.now()
  for (;;) {
    if (fn()) return true
    if (Date.now() - t0 > budgetMs) return false
    await afterRender()
  }
}

function snapOf(host) {
  const s = host?.layoutDock?.snapshot?.()
  return s ? { ref: 'layoutDock', label: 'Layout bar', ...s } : null
}

/** Why the bar can't be changed now, or null. */
function barProblem(st) {
  if (!st) return 'The layout bar is only on the Charts workspace.'
  // one bar change per request: each is checked against the bar the next would be planned on
  if (st.op) return 'One layout bar change at a time. Ask for the next one after this.'
  if (!st.ready) return 'Your layouts are still loading. Try again in a moment.'
  if (st.hidden) return 'The layout bar is hidden, so there is nothing to change on it.'
  return null
}

/** The ONE library layout these words name, or the sentence that asks / refuses (never a guess). */
function resolveLayout(st, phrase) {
  const c = layoutCandidates(st.library, phrase)
  if (c.length === 1) return { entry: c[0] }
  if (c.length > 1) return { ask: `Which layout do you mean: ${c.map(e => quote(e.name)).join(' or ')}? Nothing was changed.` }
  return { ask: `You have no layout called ${quote(String(phrase ?? '').trim())}. Nothing was changed.` }
}

/** The ONE bar slot for these words (a layout that is on the bar exactly once), or the sentence that asks. */
function resolveSlot(st, phrase) {
  const r = resolveLayout(st, phrase)
  if (r.ask) return r
  const slots = st.slots.filter(s => String(s.id) === String(r.entry.id))
  if (!slots.length) return { ask: `${quote(r.entry.name)} isn't on the layout bar. Nothing was changed.` }
  if (slots.length > 1) return { ask: `${quote(r.entry.name)} is on the layout bar ${slots.length} times (the ${slots.map(s => ord(s.index + 1)).join(' and ')} spots). Move or close the one you mean from its right-click menu. Nothing was changed.` }
  return { entry: r.entry, slot: slots[0] }
}

/** "left" / "right" / "first" / "last" / a 1-based spot → the target index, or null. */
function targetIndex(to, from, n) {
  const t = String(to ?? '').toLowerCase().trim()
  if (/^(?:one )?(?:to the )?left$|^(?:one )?(?:spot |place )?(?:back|earlier)$/.test(t)) return from - 1
  if (/^(?:one )?(?:to the )?right$|^(?:one )?(?:spot |place )?(?:forward|later)$/.test(t)) return from + 1
  if (/^(?:the )?(?:first|front|start|beginning|leftmost|far left|all the way (?:to the )?left)$/.test(t)) return 0
  if (/^(?:the )?(?:last|end|back of the bar|rightmost|far right|all the way (?:to the )?right)$/.test(t)) return n - 1
  const m = /^(?:position |spot |place |slot |number )?#?(\d{1,2})(?:st|nd|rd|th)?(?: (?:position|spot|place|slot))?$/.exec(t)
  return m ? Number(m[1]) - 1 : null
}

// ── the receipt lines ──
function lineOf(p) {
  if (p.op === 'pin') return `Pinned ${quote(p.name)} to the layout bar (the ${ord(p.index + 1)} spot). It is not opened; say “open ${p.name}” to switch to it.`
  if (p.op === 'unpin') return `Took ${quote(p.name)} off the layout bar. It is still in your layout library (＋ on the bar).`
  if (p.op === 'shift') return `Moved ${quote(p.name)} on the layout bar from the ${ord(p.from + 1)} spot to the ${ord(p.to + 1)}.`
  if (p.op === 'restore') return `Put ${quote(p.name)} back on the layout bar in the ${ord(p.index + 1)} spot.`
  return null
}

function write(src, p) {
  if (p.op === 'pin') return src.pin(p.id)
  if (p.op === 'unpin') return src.unpin(p.index)
  if (p.op === 'shift') return src.shift(p.from, p.to)
  if (p.op === 'restore') return src.restore(p.id, p.index)
  return Promise.resolve(false)
}
/** The exact inverse of a bar patch (also what Undo runs). */
function inverseOf(p) {
  const back = { before: p.expect, expect: p.before, id: p.id, name: p.name }
  if (p.op === 'pin') return { ...back, op: 'unpin', index: p.index }
  if (p.op === 'unpin') return { ...back, op: 'restore', index: p.index }
  if (p.op === 'restore') return { ...back, op: 'unpin', index: p.index }
  if (p.op === 'shift') return { ...back, op: 'shift', from: p.to, to: p.from }
  return null
}

export const layoutBarKind = {
  name: 'layoutDock',
  source: 'layoutDock',           // #1112 rail: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "The layout bar isn't available on this page — open Charts to use it.",
  // the bar is the member's own, the same whichever layout is open
  boardScoped: false,
  selfDescribing: true,
  list: (host) => { const s = snapOf(host); return s ? [s] : [] },
  read: (host, ref) => (ref === 'layoutDock' ? snapOf(host) : null),
  stateOf: (s) => ({ ready: s.ready, hidden: s.hidden, slots: s.slots, pins: s.pins, library: s.library, op: null }),
  patch: (before, after) => (after.op ? { ...after.op } : null),
  async commit(host, ref, p) {
    const src = host?.layoutDock
    const now = () => src?.snapshot?.()
    const s = now()
    if (!s) throw new Error('the layout bar is not on screen')
    // ⛔ Never written over a bar that changed since it was read (another tab, a click, a reload).
    if (!same(s.pins, p.before)) {
      const e = new Error('The layout bar changed since I read it, so nothing was changed. Ask again to see it as it is now.')
      e.complete = true
      throw e
    }
    const ok = await write(src, p)
    if (ok !== true) {
      // Refused by the server (or not confirmed): put the bar back the same way, and say so. Never a receipt.
      const inv = inverseOf(p)
      // (the server never took the change, so a bar that reads as it was before IS the saved one)
      if (!same(now()?.pins, p.before) && inv) await write(src, inv)
      const back = same(now()?.pins, p.before)
      const e = new Error(back
        ? 'Saving the layout bar to your account did not go through, so I put it back. Nothing was changed.'
        : 'Saving the layout bar to your account did not go through, and it may look changed on this device until you reload. Nothing was saved.')
      e.complete = true
      if (!back) e.unreverted = true
      throw e
    }
    await waitFor(() => same(now()?.pins, p.expect))
    const line = lineOf(p)
    return { lines: line ? [line] : [] }
  },
  landed: (s, p) => !!s && same(s.pins, p.expect),
  undoPatch: (item) => inverseOf(item.patch || {}),
  fingerprint: (s) => JSON.stringify(s.pins.map(String)),
  // Exact Undo only while the bar is still as this change left it.
  fingerprintFor: (host, s) => (s ? JSON.stringify(s.pins.map(String)) : null),
}

// ── deterministic phrases: they must say "bar"/"dock" (or pin/unpin with "layout"), and name ONE layout ──
const LEAD = '^(?:please |can you |could you )?'
const BAR = '(?:the |my )?(?:layouts? )?(?:bar|dock)'
const tidy = (raw) => String(raw || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
const stripQ = (s) => String(s || '').replace(/^[“"'‘]|[”"'’]$/g, '').trim()
/** The words name exactly one layout in the library → its id; else null (the model's). */
function oneLayout(host, phrase) {
  const s = host?.layoutDock?.snapshot?.()
  if (!s) return null
  const c = layoutCandidates(s.library, stripQ(phrase))
  return c.length === 1 ? String(c[0].id) : null
}

let registered = false
export function registerLayoutBarCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(layoutBarKind)
  registerContextProvider({
    key: 'layoutDock',
    build: (host, refFor) => {
      const s = snapOf(host)
      if (!s) return undefined
      return [{
        ref: refFor('layoutDock', 'layoutDock'),
        label: 'Layout bar (the layouts along the bottom of Charts; the library holds every layout)',
        ...(s.hidden ? { hidden: true } : {}),
        bar: s.slots.map(x => ({ spot: x.index + 1, layout: x.name, id: String(x.id) })),
      }]
    },
  })

  registerCapability({
    name: 'layout.pinToBar',
    target: 'layoutDock',
    surfaces: ['charts'],
    summary: 'Pin one of the member\'s layouts to the layout bar along the bottom of Charts (the library\'s "add to bar"). The slot goes on the end. Does NOT open the layout and does not change the board.',
    hints: 'target = the ref of the layoutDock entry; layout = the layout\'s id from the layouts list, or the member\'s own words for it (UCT matches them; several matches are asked about). '
      + 'To also switch to it, that is layout.open, a separate step.',
    args: { type: 'object', properties: { layout: { type: 'string' } }, required: ['layout'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      const t = tidy(raw)
      const m = new RegExp(`${LEAD}(?:pin|add|put) (?:my |the )?(.+?)(?: layout)? (?:back )?(?:to|on|onto|in|into) ${BAR}$`, 'i').exec(t)
        || new RegExp(`${LEAD}pin (?:my |the )?(.+?) layout$`, 'i').exec(t)
      const id = m ? oneLayout(host, m[1]) : null
      return id ? { layout: id } : null
    },
    check(st, { layout }) {
      const bad = barProblem(st)
      if (bad) return bad
      const r = resolveLayout(st, layout)
      return r.ask || null
    },
    apply(st, { layout }) {
      const e = resolveLayout(st, layout).entry
      // Already on the bar: nothing to do (the dock allows a second copy; the Agent does not add one).
      if (st.slots.some(x => String(x.id) === String(e.id))) return st
      const expect = addPin(st.pins, e.id)
      return { ...st, op: { op: 'pin', id: e.id, name: e.name, index: expect.length - 1, before: st.pins, expect } }
    },
    noop: (st, _a, { layout }) => {
      const e = resolveLayout(st, layout).entry
      const at = st.slots.find(x => String(x.id) === String(e?.id))
      return `${quote(e?.name || 'That layout')} is already on the layout bar${at ? ` (the ${ord(at.index + 1)} spot)` : ''}`
    },
    describe: (b, a) => (a.op ? lineOf(a.op) : null),
  })

  registerCapability({
    name: 'layout.unpinFromBar',
    target: 'layoutDock',
    surfaces: ['charts'],
    summary: 'Take one layout off the layout bar along the bottom of Charts (the slot menu\'s "Close"). The layout stays in the library: this NEVER deletes a layout (that is layout.delete).',
    hints: 'target = the ref of the layoutDock entry; layout = the layout\'s id, or the member\'s words for it. If they did not name one, or it sits on the bar twice, clarify with the real names.',
    args: { type: 'object', properties: { layout: { type: 'string' } }, required: ['layout'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      const t = tidy(raw)
      const m = new RegExp(`${LEAD}(?:remove|take|close|drop|unpin|get) (?:rid of )?(?:my |the )?(.+?)(?: layout)? (?:off|from|off of) ${BAR}$`, 'i').exec(t)
        || new RegExp(`${LEAD}unpin (?:my |the )?(.+?) layout$`, 'i').exec(t)
      const id = m ? oneLayout(host, m[1]) : null
      return id ? { layout: id } : null
    },
    check(st, { layout }) {
      return barProblem(st) || resolveSlot(st, layout).ask || null
    },
    apply(st, { layout }) {
      const { entry, slot } = resolveSlot(st, layout)
      return { ...st, op: { op: 'unpin', id: entry.id, name: entry.name, index: slot.index, before: st.pins, expect: removePin(st.pins, slot.index) } }
    },
    describe: (b, a) => (a.op ? lineOf(a.op) : null),
  })

  registerCapability({
    name: 'layout.moveOnBar',
    target: 'layoutDock',
    surfaces: ['charts'],
    summary: 'Reorder the layout bar along the bottom of Charts: move one layout left or right one spot (the slot menu\'s Move left / Move right), to the first or last spot, or to a numbered spot.',
    hints: 'target = the ref of the layoutDock entry; layout = the layout\'s id, or the member\'s words for it; '
      + 'to = "left" or "right" (one spot), "first" or "last", or a spot number counted from 1 on the left (the `spot` in the bar list).',
    args: { type: 'object', properties: { layout: { type: 'string' }, to: { type: 'string' } }, required: ['layout', 'to'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      const t = tidy(raw)
      const m = new RegExp(`${LEAD}(?:move|put|shift|slide) (?:my |the )?(.+?)(?: layout)? (?:one (?:spot |place )?)?(?:to (?:the )?)?(left|right|first|front|start|beginning|last|end|(?:position|spot|place|slot) \\d{1,2}|\\d{1,2}(?:st|nd|rd|th) (?:position|spot|place|slot))(?: (?:on|of|in) ${BAR})$`, 'i').exec(t)
      const id = m ? oneLayout(host, m[1]) : null
      return id ? { layout: id, to: m[2].toLowerCase() } : null
    },
    check(st, { layout, to }) {
      const bad = barProblem(st)
      if (bad) return bad
      const r = resolveSlot(st, layout)
      if (r.ask) return r.ask
      const n = st.slots.length
      const i = targetIndex(to, r.slot.index, st.pins.length)
      if (i == null) return 'Say where on the layout bar: left, right, first, last, or a spot number. Nothing was changed.'
      if (i < 0) return `${quote(r.entry.name)} is already the first on the layout bar. Nothing was changed.`
      if (i >= st.pins.length) return /^\d|position|spot|place|slot/i.test(String(to)) ? `The layout bar has ${n} spots. Nothing was changed.` : `${quote(r.entry.name)} is already the last on the layout bar. Nothing was changed.`
      return null
    },
    apply(st, { layout, to }) {
      const { entry, slot } = resolveSlot(st, layout)
      const i = targetIndex(to, slot.index, st.pins.length)
      if (i === slot.index) return st
      return { ...st, op: { op: 'shift', id: entry.id, name: entry.name, from: slot.index, to: i, before: st.pins, expect: shiftPin(st.pins, slot.index, i) } }
    },
    noop: (st, _a, { layout }) => `${quote(resolveSlot(st, layout).entry?.name || 'That layout')} is already there on the layout bar`,
    describe: (b, a) => (a.op ? lineOf(a.op) : null),
  })
}
