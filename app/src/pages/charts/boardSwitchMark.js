// app/src/pages/charts/boardSwitchMark.js — the grid's "a layout switch is committing" mark (ChartsWorkspace `switchLayout`).
//
// ⚡ (2026-11-26, the board switch; owner: "jumpy") react-grid-layout ships `.react-grid-item { transition: all 200ms }`. A
// switch to a layout that keeps a widget's id kept its grid item and ANIMATED the new size and place over 200 ms. The mark
// (`charts-switching`, transition none in ChartsWorkspace.module.css) goes on the grid's node before the commit that shows
// the new board and comes off two animation frames after THAT commit, so a later drag or resize animates as before.
// ⛔ The frames count from the commit, not the call (review of #2860): a switch made after an await or from an effect
// commits in a later task, and frames counted from the call could be spent on the old board.
// ⛔ On the node, not in React state: a state flag would render the whole board again just to drop a class.

export const SWITCH_MARK_CLASS = 'charts-switching'
// ⛔ A SWITCH WHOSE BOARD NEVER COMMITS STILL DROPS ITS MARK (review of #2860): switching to X and back to the board on
// screen in one batch is a React bail-out, no commit and no layout effect, and the class would stay on the grid: every
// later drag would lose react-grid-layout's transition. After this long without its commit, the switch arms the frames.
export const SWITCH_MARK_FALLBACK_MS = 250

const defaultRaf = (f) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16))

/**
 * @param {{ raf?: (f: () => void) => any, setTimer?: (f: () => void, ms: number) => any }} [o]
 * `mark(grid)`: a switch is about to commit (puts the class on `grid`); `committed()`: the commit that shows the new
 * board ran (its layout effect): the class comes off two frames later, unless a newer switch marked the grid meanwhile.
 */
export function createBoardSwitchMark({ raf = defaultRaf, setTimer = (f, ms) => setTimeout(f, ms) } = {}) {
  let seq = 0
  let pending = null   // { seq, grid } of a marked switch whose board has not committed yet
  const clearAfterFrames = (p) => {
    // two frames: the first may run before this commit's own frame computes its styles; a newer switch keeps the mark
    raf(() => raf(() => { if (p.seq === seq) p.grid.classList.remove(SWITCH_MARK_CLASS) }))
  }
  return {
    mark(grid) {
      if (!grid) return
      const s = ++seq
      grid.classList.add(SWITCH_MARK_CLASS)
      pending = { seq: s, grid }
      setTimer(() => {
        if (!pending || pending.seq !== s) return   // committed, or a newer switch is waiting on its own commit
        const p = pending
        pending = null
        clearAfterFrames(p)
      }, SWITCH_MARK_FALLBACK_MS)
    },
    committed() {
      const p = pending
      if (!p) return
      pending = null
      clearAfterFrames(p)
    },
  }
}
