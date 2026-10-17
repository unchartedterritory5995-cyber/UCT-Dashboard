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
}

export function drillFor(type) {
  return DRILLS[String(type || '').toLowerCase()] || RecallDrill
}

export { RecallDrill, SpotDrill, SizeDrill, RegimeDrill, ScenarioDrill, TapDrill, CallDrill }
