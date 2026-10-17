/**
 * The Phase-1 drill registry: item type → drill module (see ./types.js for the
 * module shape). `call_scan` and `call_archive` share CallDrill; an unknown type
 * falls back to RecallDrill so a new bank type renders as a choice question
 * rather than a blank screen (the scorer's own fallback is exact match too).
 */
import RecallDrill from './RecallDrill'
import SpotDrill from './SpotDrill'
import SizeDrill from './SizeDrill'
import RegimeDrill from './RegimeDrill'
import ScenarioDrill from './ScenarioDrill'
import TapDrill from './TapDrill'
import CallDrill from './CallDrill'
import WalkthroughDrill from './WalkthroughDrill'

export const DRILLS = {
  recall: RecallDrill,
  spot: SpotDrill,
  size: SizeDrill,
  regime: RegimeDrill,
  scenario: ScenarioDrill,
  tap: TapDrill,
  call_scan: CallDrill,
  call_archive: CallDrill,
  call: CallDrill,
  walkthrough: WalkthroughDrill,   // unscored: seen, never checked (spec §13.9 #1)
}

export function drillFor(type) {
  return DRILLS[String(type || '').toLowerCase()] || RecallDrill
}

/** True for a drill the player never checks or scores: no Check step, no
 *  reveal card, the sticky button reads Continue, the attempt still posts. */
export function isUnscoredDrill(mod) {
  return !!mod?.unscored
}

export { RecallDrill, SpotDrill, SizeDrill, RegimeDrill, ScenarioDrill, TapDrill, CallDrill, WalkthroughDrill }
