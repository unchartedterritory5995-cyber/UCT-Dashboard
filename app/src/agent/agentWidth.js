// ── UCT Agent sidebar width: limits, persistence, clamping ──────────────────────
//
// The member drags the sidebar's LEFT edge (AgentDock). The width is kept the same way the
// sidebar's open/closed state is (`AGENT_OPEN_KEY`): this browser's storage, read once at mount,
// so it survives close/reopen and a refresh. Limits come from the layout:
//   • MIN 320 — the composer (input + mic + send), the header's controls and a two-column breadth
//     card still fit on one line each;
//   • MAX 760, and never more than leaves the charts MIN_BOARD of the row — the workspace must
//     stay a workspace, never a strip beside the Agent.
// A stored width the current window can't hold is shown clamped and kept as chosen (a wider
// window gets it back).

import { readLocal, writeLocal } from './agentFlag'

export const AGENT_WIDTH_KEY = 'uct.agent.width'
export const AGENT_W_DEFAULT = 392
export const AGENT_W_MIN = 320
export const AGENT_W_MAX = 760
export const MIN_BOARD = 520
export const KEY_STEP = 16
export const KEY_STEP_BIG = 64

/** The widest the sidebar may be in a row `rowWidth` px wide (unknown ⇒ the absolute max). */
export function maxAgentWidth(rowWidth) {
  const room = Number.isFinite(rowWidth) && rowWidth > 0 ? Math.floor(rowWidth - MIN_BOARD) : AGENT_W_MAX
  return Math.max(AGENT_W_MIN, Math.min(AGENT_W_MAX, room))
}

export function clampAgentWidth(w, rowWidth) {
  const n = Number(w)
  if (!Number.isFinite(n)) return Math.min(AGENT_W_DEFAULT, maxAgentWidth(rowWidth))
  return Math.round(Math.min(maxAgentWidth(rowWidth), Math.max(AGENT_W_MIN, n)))
}

/** The member's chosen width (unclamped by the window), or the default. */
export function readAgentWidth() {
  const n = parseInt(readLocal(AGENT_WIDTH_KEY), 10)
  return Number.isFinite(n) ? Math.min(AGENT_W_MAX, Math.max(AGENT_W_MIN, n)) : AGENT_W_DEFAULT
}

export function writeAgentWidth(w) {
  writeLocal(AGENT_WIDTH_KEY, String(Math.round(w)))
}
