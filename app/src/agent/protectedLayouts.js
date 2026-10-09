// ── PROTECTED LAYOUTS: the owner's important layouts are never changed by UCT Agent ──────
//
// Main Trading is the owner's live trading layout. Opening /charts restores the ACTIVE layout,
// so anything that drives the page — a test, an automation, the Agent — writes into whatever is
// open. Board saves are protected against STALE writes (per-key CAS), not against a writer that
// should not be there at all. This guard is the Agent's half of that protection:
//
//   • while a protected layout is OPEN, the Agent changes nothing on it — no widget, chart,
//     chart setting, board arrangement, or drawing (drawings are per symbol, so a line drawn
//     "anywhere" shows on that layout's charts) — and does not Undo into it;
//   • from ANY layout, the Agent never saves into, renames or deletes a protected layout;
//   • reading, opening and duplicating a protected layout stay allowed (duplicate makes a copy).
//
// Protected = the built-in names below (case-insensitive), plus names or ids the member adds in
// this browser: localStorage `uct.agent.protectedLayouts` = JSON array of strings.
// A product-level guard for every writer (not only the Agent) is a Charts-workspace handoff:
// docs/agent/PRODUCT-HANDOFFS.md §13.

export const PROTECTED_LAYOUT_NAMES = Object.freeze(['main trading'])
export const PROTECTED_LAYOUTS_KEY = 'uct.agent.protectedLayouts'

const norm = (s) => String(s ?? '').trim().toLowerCase()

export function protectedSet() {
  const out = new Set(PROTECTED_LAYOUT_NAMES)
  try {
    const raw = globalThis.localStorage?.getItem(PROTECTED_LAYOUTS_KEY)
    const extra = raw ? JSON.parse(raw) : []
    if (Array.isArray(extra)) for (const x of extra) if (typeof x === 'string' && x.trim()) out.add(norm(x))
  } catch { /* unreadable storage → the built-in names only */ }
  return out
}

/** The layout entry for an id or name, from the host's layout snapshot. */
function entryOf(snap, ref) {
  const r = norm(ref)
  return (snap?.entries || []).find(e => norm(e.id) === r || norm(e.name) === r) || null
}
export function isProtected(entry, set = protectedSet()) {
  return !!entry && (set.has(norm(entry.name)) || set.has(norm(entry.id)))
}

/** The OPEN layout when it is protected, else null. FAILS CLOSED: an open layout the list has
 *  not confirmed yet (`pendingActive`, the list still loading) is treated as protected unless its
 *  name says otherwise — a guard that opens while loading is open exactly when it matters. */
export function protectedOpenLayout(host) {
  const snap = host?.layouts?.snapshot?.()
  const a = snap?.active
  if (!a) {
    const p = snap?.pendingActive
    if (!p) return null
    if (!p.name) return { id: p.id, name: null, pending: true }
    return isProtected({ id: p.id, name: p.name }) ? { id: p.id, name: p.name } : null
  }
  const entry = entryOf(snap, a.id) || (a.name ? { id: a.id, name: a.name } : null)
  return isProtected(entry) ? entry : null
}
const openWord = (open) => (open.pending ? 'Your layouts are still loading, so I can\u2019t yet tell whether this layout is protected. Try again in a moment.'
  : null)

// Kinds whose writes land on the open board or show on its charts.
const ON_THE_BOARD = new Set(['chart', 'board', 'workspace', 'drawing'])
const NAMES_A_LAYOUT = new Set(['layout.rename', 'layout.delete'])

/**
 * The refusal sentence for a plan (null = allowed). `plan` is planOps' result; `ops` the ops.
 */
export function protectionRefusal(host, plan, ops = []) {
  const open = protectedOpenLayout(host)
  const changed = (plan?.plans || []).filter(p => p.changed)
  if (open) {
    if (changed.some(p => ON_THE_BOARD.has(p.kind)) || ops.some(o => o?.action === 'layout.saveCurrent')) {
      return openWord(open) || `“${open.name}” is a protected layout, so UCT Agent doesn't change anything on it. Open another layout first (Layouts ▾).`
    }
  }
  const snap = host?.layouts?.snapshot?.()
  for (const o of ops) {
    if (!NAMES_A_LAYOUT.has(o?.action)) continue
    const e = entryOf(snap, o?.args?.layout)
    if (isProtected(e)) return `“${e.name}” is a protected layout — UCT Agent never renames or deletes it.`
  }
  return null
}

/** For an Undo: refused while a protected layout is open and the undo touches its board. */
export function undoProtectionRefusal(host, entry) {
  const open = protectedOpenLayout(host)
  if (!open) return null
  const kinds = new Set((entry?.items || []).map(it => it.kind))
  return [...kinds].some(k => ON_THE_BOARD.has(k))
    ? openWord(open) || `“${open.name}” is a protected layout, so UCT Agent doesn't undo changes into it. Open the layout the change was made on, then Undo.`
    : null
}
