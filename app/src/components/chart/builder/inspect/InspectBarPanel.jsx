// app/src/components/chart/builder/inspect/InspectBarPanel.jsx
//
// INSPECT A BAR, AS THE BUILDER MOUNTS IT (Studio lane R5): `InspectBar` handed the engine's three
// doors (`inspectDoors.js`), on the chart the builder was opened over. Loaded on demand by the
// builder, so the engine's headless export is not part of the builder's own first open.
import { useMemo } from 'react'
import InspectBar from './InspectBar'
import { names, build, computeFor } from './inspectDoors'

/**
 * @param {object} props
 * @param {string} props.source   the script in the builder's box
 * @param {object[]} props.bars   the chart's bars, `{t, o, h, l, c, v}`, oldest first
 * @param {string|null} [props.tf]
 * @param {string|null} [props.sym]
 * @param {(line: number) => void} [props.onGoToLine]
 */
export default function InspectBarPanel({ source, bars, tf = null, sym = null, onGoToLine = null }) {
  const compute = useMemo(() => computeFor({ tf, sym }), [tf, sym])
  return (
    <InspectBar source={source} bars={bars} tf={tf || 'D'} names={names} build={build} compute={compute}
      onGoToLine={onGoToLine} />
  )
}
