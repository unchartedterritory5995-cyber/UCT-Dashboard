// ─── IS THE BOARD ON SCREEN STILL TRUSTWORTHY? ──────────────────────────────
//
// ⚰️ THE SECOND LOSS, AND IT WAS CAUSED BY THE FIX FOR THE FIRST. Widening the
// switch-away flush so it can finally see a settings edit also widened what a BAD
// board can destroy. Measured 2026-09-11: a hot-reload changed `ChartWidget`'s
// hook order, React threw ("Should have a queue… calling Hooks conditionally"),
// the route boundary recreated the tree from scratch, and the chart came back
// re-seeded — RSI tombstoned, its derived Moving Average severed, the theme reset.
// The flush then faithfully wrote that into the template, because a re-seeded
// board is, to a signature, simply a different board.
//
// ⛔ THIS IS THE SETTINGS-SIDE COUNTERPART OF THE SHRINK GUARD, and it exists for
// the same stated reason: *"auto-save turns any transient bad board into permanent
// loss, so losing widgets is never assumed to be intentional."* The shrink guard
// protects the board from losing WIDGETS. Nothing protected a widget from losing
// its CONTENTS.
//
// ⭐⭐ AND IT KEYS OFF THE CRASH, NOT OFF THE CONTENTS. A guard that refused to
// save whenever a chart had fewer indicators than the stored layout would be a NEW
// data-loss bug: deleting an indicator is an ordinary, deliberate act, and it would
// never be saved again. The only thing that reliably separates "the member removed
// it" from "the tree was rebuilt from scratch" is whether the tree was, in fact,
// rebuilt from scratch. So that is what is recorded.
//
// ⚠️ ONE-WAY, AND FOR THE SESSION. There is no safe moment to declare a crashed
// board healthy again from the inside — the re-seeded chart renders perfectly well,
// it is simply not what the member built. A reload is the recovery, and a reload
// clears this by construction (it is module state). Worst case is "we stopped
// auto-saving until you reload", never "we saved the damage".

let crashed = false
let reason = null
const listeners = new Set()

/** Record that a render error tore down and rebuilt part of the tree. */
export function markBoardCrashed(err) {
  if (crashed) return
  crashed = true
  reason = (err && err.message) || 'a render error'
  // Loud on purpose: the guard is otherwise invisible, and "why did my layout
  // stop auto-saving?" needs an answer in the console rather than a shrug.
  console.warn(
    '[charts] auto-save suspended for this session — the page recovered from a render '
    + `error (${reason}), so the board on screen may have been rebuilt from defaults `
    + 'rather than from what you configured. Reload to resume saving.',
  )
  for (const fn of listeners) { try { fn() } catch { /* a listener must not break the guard */ } }
}

/** Has the tree been rebuilt from an error since this module loaded? */
export const boardCrashed = () => crashed

export function subscribeBoardTrust(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Tests only — module state is per-import and would otherwise leak between cases. */
export function _resetBoardTrustForTests() {
  crashed = false
  reason = null
  listeners.clear()
}

// ⭐ A DEV-ONLY SEAM, so the guard can be exercised live rather than only in a
// unit test. The real trigger — a render error that rebuilds the tree — is not
// something to provoke deliberately against a member's board, and reproducing the
// exact HMR hook-order crash is an artefact of the dev server rather than a
// product behaviour. This exposes the same transition the route boundary drives.
//
// ⛔ IT DOES NOT SHIP. `import.meta.env.DEV` is statically false in a production
// build, so the whole block is dropped at bundle time — there is no "crash button"
// in the product, and nothing here widens what a page can do to a member's state.
if (import.meta.env && import.meta.env.DEV) {
  globalThis.__uctBoardTrust = { markBoardCrashed, boardCrashed }
}
