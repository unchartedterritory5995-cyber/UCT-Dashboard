// app/src/components/chart/builder/inspect/inspectDoors.js
//
// THE ENGINE'S THREE DOORS "INSPECT A BAR" READS THROUGH (Studio lane R5).
//
// `barInspection.js` is the method and needs no engine; these are the three engine functions it
// is handed, by the names the engine exports them under. Nothing here is a second implementation:
//
//   names    `engine/runtime/topLevelNames.js::topLevelNames`     the script's own top-level names
//   build    `memberPane/memberPaneDefinition.js`                 the door a pasted script goes through
//   compute  `engine/headlessCompute.js::computeHeadless`         a definition's values with no chart
//
// The probe copy is built and computed exactly as the member's script is, on the chart's own bars.
// ⛔ A refusal is handed back as its sentence, never as an empty column: `barInspection` then says
// it to the member instead of showing every variable as "empty".
import { topLevelNames } from '../../engine/runtime/topLevelNames.js'
import { computeHeadless } from '../../engine/headlessCompute.js'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../memberPane/memberPaneDefinition'

/** The script's top-level names, `[{ name, line }]`. */
export const names = (source) => topLevelNames(source)

/** A script as the definition the chart would draw: `{ ok, definition, reason }`. */
export const build = (source) => memberPaneDefinition({ source, id: MEMBER_PANE_DEF_PREFIX })

/**
 * "Definition to values, for these bars", bound to the chart the builder was opened over.
 * @param {{ tf?: string|null, sym?: string|null }} chart
 * @returns {(definition: object, bars: object[]) => { lane: string|null, outputs: object[]|null, reason?: string }}
 */
export function computeFor({ tf = null, sym = null } = {}) {
  const opts = {
    ...(typeof tf === 'string' && tf ? { tf } : {}),
    ...(typeof sym === 'string' && sym ? { symbol: { ticker: sym } } : {}),
  }
  return (definition, bars) => {
    let out
    try {
      out = computeHeadless(definition, bars, opts)
    } catch (err) {
      return { lane: (err && err.lane) || null, outputs: null, reason: String((err && err.message) || err) }
    }
    if (out && out.refusal) {
      return { lane: out.lane || null, outputs: null, code: out.refusal.code || null,
        reason: out.refusal.message || out.refusal.code || 'it could not be computed' }
    }
    return out
  }
}
