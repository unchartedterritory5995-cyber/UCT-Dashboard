/**
 * TERM-029 / RM-N14 — the dealer-positioning assumption, AT the number.
 *
 * WHAT A MEMBER GETS. Beside the Total GEX figure and the GEX Summary row there
 * is now a small control naming the basis the figure was computed on ("Naive
 * basis" / "Trade-Aware basis"). Tapping it reveals, in one sentence, what that
 * basis assumes. Before this, the assumption existed only as a native `title=`
 * on the Naive/Trade-Aware toggle — which NEVER OPENS ON TOUCH and sits far
 * from the figures whose SIGN it changes.
 *
 * ⛔ WHY A BUTTON AND NOT A HOVER. `title=` and `:hover` are both
 * desktop-pointer affordances. A phone has neither, and the touch tier in this
 * repo is everything ≤1024px. So the reveal is a real `<button>` with
 * `aria-expanded` — one mechanism that serves tap, click and keyboard, with no
 * second hover path to keep in step. `gexAssumptionMount.guard.test.jsx` pins
 * that: it asserts a click reveals the sentence and that a mouse-enter does not.
 *
 * ⛔ THE BASIS COMES FROM THE PAYLOAD, NEVER FROM LIVE UI STATE. Callers pass
 * `gexData.adjusted` (the flag the served GEX payload carries), not the
 * `gexAdjusted` toggle state. Click Naive then Trade-Aware and the slower reply
 * can land last; labelling from UI state would then caption one basis's numbers
 * with the other's assumption. `optionsFlow/wiring.guard.test.js` already
 * records that exact defect for the GEX expiry label — this is the same trap,
 * and a mislabelled ASSUMPTION is worse than a mislabelled expiry because it
 * inverts the sign a member reads the number by.
 *
 * ⛔ NO STRINGS AND NO RULINGS LIVE HERE. Every sentence comes from
 * `./gexAssumption`, whose own rail pins the long form byte-identical to the
 * partner file's `title=`. This file is the affordance; that one is the copy.
 *
 * ⛔ CLASSNAME HOOKS, NO INLINE STYLES. `OptionsFlow.jsx` is partner-owned and
 * every style for this control rides the additive `OptionsFlow.mobile.css`
 * layer (search `of-gexnote`) — so the partner file gains an import and two
 * mounts, and nothing else. A jsdom test therefore sees no layout; the tap
 * floor is asserted from the stylesheet text instead.
 */

import { useState } from 'react'
import FlowIcon from './FlowIcon'
import {
  gexAssumptionAriaLabel,
  gexAssumptionFor,
  gexModeLabel,
} from './gexAssumption'

/**
 * @param {object} props
 * @param {boolean} [props.adjusted] the GEX payload's own `adjusted` flag —
 *   `false`/absent = naive OI GEX, `true` = trade-aware. Absent falls to naive,
 *   which is the product's default basis, so an older payload with no flag is
 *   captioned correctly rather than confidently wrong.
 */
export default function GexAssumptionNote({ adjusted }) {
  const [open, setOpen] = useState(false)
  const mode = !!adjusted
  return (
    <div className="of-gexnote" data-pin={open ? '1' : undefined}>
      <button
        type="button"
        className="of-gexnote-trigger"
        aria-expanded={open}
        aria-label={gexAssumptionAriaLabel(mode)}
        data-testid="gex-assumption-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="of-gexnote-mode">{gexModeLabel(mode)} basis</span>
        <FlowIcon name="info" size={10} />
      </button>
      {open && (
        <p className="of-gexnote-text" data-gexnote role="note">
          {gexAssumptionFor(mode)}
        </p>
      )}
    </div>
  )
}
