// app/src/components/chart/flipReady.js
//
// ⭐⭐ (2026-11-28, COV-def-wm-arrows: presses 0-2 and 7-8 never moved the W+M board) CAN THIS CHART'S DOUBLE BUFFER FLIP
// TO `sym` NOW? The double buffer decides on the symbol the handoff RELEASES (useDoubleBuffer's `sym` is
// useSymbolHandoff's), so a press to the row its shadow already shows whole still waited behind the daily hold: a W/M hold
// that outlived the 3.2 s between presses was left for the next press, and the board never moved, though the shadow held
// the row. The handoff asks here first (sameTaskRoute): a row the shadow can flip to is shown at once, and the flip shows
// it. One probe per member (the token the widget's chart paints under), set by its useDoubleBuffer. A leaf.

const _probes = new WeakMap()

/** `member`'s double buffer answers flipReadyFor through `fn(sym) -> boolean`; null takes it away. */
export function setFlipProbe(member, fn) {
  if (!member || typeof member !== 'object') return
  if (typeof fn === 'function') _probes.set(member, fn)
  else _probes.delete(member)
}

/** Would `member`'s double buffer FLIP to `sym` if the handoff released it now (its own decision, asked early)? */
export function flipReadyFor(member, sym) {
  if (!member || typeof member !== 'object' || !sym) return false
  const fn = _probes.get(member)
  if (!fn) return false
  try { return fn(sym) === true } catch { return false }
}
