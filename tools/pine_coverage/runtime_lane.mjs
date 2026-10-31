// tools/pine_coverage/runtime_lane.mjs
//
// ─── WHICH LANE A MEASUREMENT MEASURED, STATED AND PROVED (Phase 3, WS-0) ─────
//
// The coverage census (`coverageMapDoorCensus.measure.test.js`, driven by
// `run_census.py`) and the vendor harness (`vendorHarness.corpus.test.js`) each
// have two committed lanes:
//
//   production  objects-only pane ARMED, runtime pane DARK (what members get)
//   runtime-on  both panes on, as a PERMITTED member with EVERY script graded:
//               what arming the per-bar runtime lane would draw (an upper bound;
//               the server's starter allowlist is not applied)
//
// ⛔⛔ WHY THIS EXISTS (docs/pine/PHASE3-RUNTIME-PLAN.md, 2.4). The runtime pane
// needs the build flag AND a latched per-member permission AND the allowlist.
// `src/test-setup.js` grants the last two in a `beforeEach`, and the harness
// grades every capture at COLLECTION time, before any `beforeEach` has run. So
// setting `VITE_PINE_RUNTIME_PANE_ENABLED=1`, or `vi.stubEnv` at module scope,
// silently measured the DARK pane: 92 / 98 / 146 both ways, capture for capture.
// A lane is therefore never inferred from what was asked for. Each run counts
// what the door actually did and `assertLaneMeasured` refuses a run whose
// evidence disagrees with the lane it was asked to measure.
//
// ⛔ A MODE IS OPT-IN AND SPELLED EXACTLY: '1' is runtime-on, '0' is the explicit
// production lane, unset or '' is the caller's legacy default, anything else
// THROWS (a typo must never measure the other lane quietly).

export const LANE_PRODUCTION = 'production'
export const LANE_RUNTIME_ON = 'runtime-on'

/** The census's switch (`run_census.py --runtime-on` sets it). */
export const CENSUS_RUNTIME_ENV = 'COVERAGE_RUNTIME_ON'
/** The vendor harness's switch. */
export const HARNESS_RUNTIME_ENV = 'VENDOR_HARNESS_RUNTIME_ON'

/** The tag `ourSide.js::enterMemberDoor` puts in a refusal the runtime lane declined.
 *  Counted here, so the two cannot drift: the tag is built by `runtimeDeclinedTag`. */
const TAG_HEAD = '[runtime declined: '
export function runtimeDeclinedTag(code) {
  return `${TAG_HEAD}${code || 'runtime'}]`
}
const TAG_RE = /\[runtime declined: ([^\]]+)\]/

/** The decline code a refusal sentence carries, or null. */
export function runtimeDeclineCodeIn(text) {
  const m = TAG_RE.exec(String(text == null ? '' : text))
  return m ? m[1] : null
}

/** Read a mode variable. @returns {'production'|'runtime-on'|null} null = unset. */
export function requestedLane(value, name = 'mode variable') {
  if (value === undefined || value === null || value === '') return null
  if (value === '1') return LANE_RUNTIME_ON
  if (value === '0') return LANE_PRODUCTION
  throw new Error(`${name}=${JSON.stringify(value)}: expected '1' (runtime-on), '0' (production) or unset`)
}

/** The lane the evidence shows.
 *  @param {{gateOpen: boolean, reachedRuntime: number}} ev */
export function laneShown({ gateOpen, reachedRuntime }) {
  return gateOpen || reachedRuntime > 0 ? LANE_RUNTIME_ON : LANE_PRODUCTION
}

/**
 * ⛔ THE RAIL. Throws, loudly, when a run did not measure the lane it was asked to.
 *
 * @param {object} ev
 * @param {'production'|'runtime-on'} ev.requested
 * @param {boolean} ev.gateOpen         `runtimePaneEnabled()` while the run graded
 * @param {number}  ev.reachedRuntime   door answers the runtime lane gave: drawn by
 *                                      it, or declined by it
 * @param {number}  ev.hostRefused      door answers the HOST lane refused (each one
 *                                      is offered to the runtime lane when it is on)
 * @param {string}  [ev.what]           names the run in the message
 * @returns {string} the lane line to print
 */
export function assertLaneMeasured({ requested, gateOpen, reachedRuntime, hostRefused, what = 'this run' }) {
  const facts = `gate ${gateOpen ? 'OPEN' : 'CLOSED'}, runtime lane reached ${reachedRuntime}, host refusals ${hostRefused}`
  if (requested === LANE_RUNTIME_ON) {
    if (!gateOpen) {
      throw new Error(`⛔ ${what}: RUNTIME-ON WAS REQUESTED BUT THE RUNTIME PANE IS DARK (${facts}). `
        + 'The build flag, the per-member permission and the allowlist override must all hold where the door is asked.')
    }
    if (hostRefused > 0 && reachedRuntime === 0) {
      throw new Error(`⛔ ${what}: RUNTIME-ON WAS REQUESTED BUT THE RUNTIME LANE WAS NEVER EXERCISED (${facts}). `
        + 'Every host refusal is offered to the runtime lane when it is on; none reached it.')
    }
  } else if (requested === LANE_PRODUCTION) {
    if (gateOpen || reachedRuntime > 0) {
      throw new Error(`⛔ ${what}: THE PRODUCTION LANE WAS REQUESTED BUT THE RUNTIME LANE ANSWERED (${facts}).`)
    }
  } else {
    throw new Error(`${what}: unknown lane ${JSON.stringify(requested)}`)
  }
  return `LANE MEASURED: ${requested} (${facts})`
}
