// app/src/components/chart/builder/RunsOnLine.jsx
//
// W5-T18 - the editor's "Runs on" line. It renders the SERVER's per-lane answer
// (`server_lanes`, stamped by `api/routers/user_definitions.py::_stamped` for
// runtime rows only) and decides nothing itself.
//
//   - no stamp (an `ast` row carries no key) -> nothing is rendered;
//   - a lane `true` -> listed under "Runs on:" (the chart lane is the client's);
//   - a lane `{guard, sentence}` -> the server's sentence, verbatim, never listed;
//   - anything else (not an object, a lane that is neither `true` nor a refusal
//     with a sentence) -> FAILS CLOSED: that lane is never claimed to run.
import { withoutGuardIds } from '../engine/ast/guardIdText'
import styles from './BuilderSheet.module.css'

export const SERVER_LANES = ['alerts', 'screener', 'scans']

function laneState(v) {
  if (v === true) return { ok: true }
  if (v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.sentence === 'string' && v.sentence.trim()) return { ok: false, sentence: v.sentence }
  return null // malformed: neither a pass nor a sentenced refusal
}

export default function RunsOnLine({ serverLanes }) {
  if (serverLanes === undefined || serverLanes === null) return null
  const states = SERVER_LANES.map((lane) => [lane, laneState(serverLanes[lane])])
  const running = states.filter(([, s]) => s && s.ok).map(([lane]) => lane)
  const refused = states.filter(([, s]) => s && !s.ok)
  const unknown = states.filter(([, s]) => !s).map(([lane]) => lane)
  return (
    <div className={styles.pickerNote} role="status" data-testid="runs-on">
      {running.length > 0 && (
        <p data-testid="runs-on-lanes">{`Runs on: ${['chart', ...running].join(', ')}`}</p>
      )}
      {refused.map(([lane, s]) => (
        <p key={lane} data-testid={`runs-on-refused-${lane}`}>{`${lane}: ${withoutGuardIds(s.sentence)}`}</p>
      ))}
      {unknown.length > 0 && (
        <p data-testid="runs-on-unconfirmed">{`Not confirmed for: ${unknown.join(', ')}`}</p>
      )}
    </div>
  )
}
