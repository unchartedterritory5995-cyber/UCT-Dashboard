import { createPortal } from 'react-dom'
import { useUctControlsSlot } from './uctHeaderSlot'

// UctCtrlPortal (owner 11-14): a widget's ⚙ (or another small window-level button) goes to the
// top-right of the UCT frame, beside + · pop out · ✕ — on its own or in a tabbed slot, for every
// widget. Off the board (no frame) it renders right where it is written. A portal keeps the
// button's React tree, refs and handlers exactly as they were.
export default function UctCtrlPortal({ children }) {
  const slot = useUctControlsSlot()
  return slot ? createPortal(children, slot) : children
}
