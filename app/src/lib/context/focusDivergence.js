// S4 CHECKPOINT 1 — the divergence detector. READ-ONLY. MOUNTS NOTHING.
//
// ⛔ APPROVED SCOPE (owner, 2026-09-13), verbatim: *"S4 CP1 (sized M at 24
// consumers — sign on this instruction with yesterday's SCOPE)"*, and the
// packet's own CP1 line: *"A derivation + a divergence rail. Read-only. Mounts
// nothing. One module that derives the current symbol from `useAppFocus` and
// reports whether `HubContext.symbol` and `groupSyms.A` agree, plus one rail
// that is source-derived and fails BY NAME."*
//
// ──────────────────────────────────────────────────────────────────────────
// ⭐⭐ WHAT S4 TURNED OUT TO BE — AN ADOPTION GAP, NOT A CAPABILITY GAP
// ──────────────────────────────────────────────────────────────────────────
//
// The bus was built in August and two files joined it. `useAppFocus.js` carries
// the owner's own ruling: *"charts Group A IS the app focus … There is exactly
// ONE value, so there is no second authority to drift."* Measured over 2,702
// files, nine distinct context mechanisms exist and 184 non-test files still
// hold or pass a symbol by prop or `useState`.
//
// ⛔ SO CP1 IS NOT A BUS. It is the one measurement the estate cannot make
// today: **does `HubContext.symbol` ever actually disagree with Group A?** The
// ruling says there is one value; nothing checks it.
//
// ──────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE TRAP THIS FILE IS ONE STEP AWAY FROM BECOMING
// ──────────────────────────────────────────────────────────────────────────
//
// This is one more file that says "the current symbol", which is exactly the
// shape S4 exists to remove. **It is only safe because it holds nothing.** The
// moment it caches, defaults, or normalises differently from `useAppFocus`, it
// IS the tenth mechanism. There is no state here, no provider, no store, and
// no fallback — and the rail asserts the module has exactly ONE importer so
// "revertible by deletion" is a property the tree enforces rather than a
// sentence in a packet.
//
// ──────────────────────────────────────────────────────────────────────────
// ⛔ SIX STATUSES, AND COLLAPSING ANY TWO IS THE DEFECT
// ──────────────────────────────────────────────────────────────────────────
//
// `CoverageLine`'s discipline, applied to a comparison. In particular
// `not_yet_read` must never fold into `neither`: *a layer that cannot be READ
// is not a layer that is EMPTY*, and a detector that scored an unresolved
// preference as agreement would report perfect health on every cold start.

import useAppFocus from '../../hooks/useAppFocus'
import { useHub } from '../../hub/HubContext'

/** Both sides hold the same symbol. */
export const AGREE = 'agree'
/** Both hold a symbol and they differ. ⛔ The finding this file exists for. */
export const DIVERGE = 'diverge'
/** Focus has a symbol, the hub has none. */
export const FOCUS_ONLY = 'focus_only'
/** The hub has a symbol, focus has none. */
export const HUB_ONLY = 'hub_only'
/** Neither holds one — a genuinely empty state, which is not a disagreement. */
export const NEITHER = 'neither'
/** ⛔ The preference has not resolved yet. NOT `neither`. */
export const NOT_YET_READ = 'not_yet_read'

export const STATUSES = [AGREE, DIVERGE, FOCUS_ONLY, HUB_ONLY, NEITHER, NOT_YET_READ]

/**
 * The comparison, as a PURE function.
 *
 * ⭐ Split out from the hook on purpose. The packet's own ⚠️ said the rail —
 * "compare two React contexts without mounting the app" — could be the whole
 * cost of CP1 and might turn an S into an M. A pure comparison the rail can
 * drive directly makes that cost vanish, and the hook below becomes two reads
 * and a call, which a light harness can cover.
 *
 * ⛔ IT NORMALISES NOTHING. `useAppFocus` upper-cases; the hub does not. If
 * this function upper-cased both sides it would MANUFACTURE agreement between
 * two authorities that disagree on case — which is a real disagreement, and
 * hiding it is the saturated-instrument failure.
 */
export function compareFocus({ focusSymbol, hubSymbol, loading = false } = {}) {
  if (loading) {
    return { status: NOT_YET_READ, focus: focusSymbol ?? null, hub: hubSymbol ?? null }
  }
  const focus = focusSymbol == null || focusSymbol === '' ? null : focusSymbol
  const hub = hubSymbol == null || hubSymbol === '' ? null : hubSymbol
  if (focus === null && hub === null) return { status: NEITHER, focus, hub }
  if (hub === null) return { status: FOCUS_ONLY, focus, hub }
  if (focus === null) return { status: HUB_ONLY, focus, hub }
  return { status: focus === hub ? AGREE : DIVERGE, focus, hub }
}

/** True only for a measured disagreement between two present values. */
export function isDivergence(result) {
  return (result && result.status) === DIVERGE
}

// ──────────────────────────────────────────────────────────────────────────
// THE HOOK — two reads and a call. Nothing else.
// ──────────────────────────────────────────────────────────────────────────


/**
 * The current symbol as the OWNER'S RULING defines it, beside the hub's copy,
 * with the comparison between them.
 *
 * ⛔ `focus` IS THE ANSWER; `hub` IS THE OBSERVATION. This hook has no opinion
 * about which is right and never resolves a divergence — resolving one is CP2,
 * and a detector that quietly picked a winner would be the second authority it
 * exists to detect.
 *
 * ⛔ IT MOUNTS NOTHING AND SUBSCRIBES TO NOTHING NEW. Both hooks are already
 * mounted app-wide (`usePreferences` via SWR, `HubProvider` around `<main>` in
 * `Layout.jsx`), so this adds no provider, no listener and no render path — the
 * property that keeps it clear of the 2026-09-10 render-loop class.
 */
export function useFocusDivergence() {
  const { symbol: focusSymbol, loading } = useAppFocus()
  const { symbol: hubSymbol } = useHub()
  return compareFocus({ focusSymbol, hubSymbol, loading })
}
