/**
 * The one place a style key maps to its component. `BreadthViews` dispatches
 * through this map instead of a chain of `&&`s, and `viewRegistry.test.jsx`
 * fails the moment a style is registered in STYLES without a component here.
 */
import TreemapView from './TreemapView'
import RingsView from './RingsView'
import TugView from './TugView'
import MetersView from './MetersView'
import TimelineView from './TimelineView'
import RadarView from './RadarView'
import ScoreboardView from './ScoreboardView'
import EqualizerView from './EqualizerView'
import HeatRibbonView from './HeatRibbonView'
import PercentileLadderView from './PercentileLadderView'
import RegimeClockView from './RegimeClockView'
import DivergenceView from './DivergenceView'
import RotationView from './RotationView'
import EventLedgerView from './EventLedgerView'
import ScoreAttributionView from './ScoreAttributionView'

export { viewsByKind } from './viewMetricConfig'

export const VIEW_COMPONENTS = {
  treemap: TreemapView,
  rings: RingsView,
  tug: TugView,
  meters: MetersView,
  timeline: TimelineView,
  radar: RadarView,
  scoreboard: ScoreboardView,
  equalizer: EqualizerView,
  ribbon: HeatRibbonView,
  ladder: PercentileLadderView,
  clock: RegimeClockView,
  divergence: DivergenceView,
  rotation: RotationView,
  events: EventLedgerView,
  attribution: ScoreAttributionView,
}
