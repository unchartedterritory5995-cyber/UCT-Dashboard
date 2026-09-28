/**
 * Test helper (wave 10, lane 10D): a door that fires Notebook telemetry makes ONE more
 * request — `POST /api/j2/telemetry` — beside its own. Tests that pin a feature's exact
 * requests read `featureCalls` (everything but that door), and the telemetry rails read
 * `telemetryBodies` (the parsed `{event, props}` of every telemetry POST, in order).
 *
 * ⛔ NOT a filter that hides requests: the telemetry door is ONE fixed URL, and each
 * door's own rail asserts what it sent there. A test that stopped counting the
 * feature's calls would be weaker; this keeps both counts exact.
 */
export const TELEMETRY_URL = '/api/j2/telemetry'

const urlOf = (call) => (typeof call?.[0] === 'string' ? call[0] : call?.[0]?.url || '')

export const isTelemetryCall = (call) => urlOf(call) === TELEMETRY_URL

/** The mock's calls that are NOT the telemetry door. */
export function featureCalls(fetchMock) {
  return fetchMock.mock.calls.filter((c) => !isTelemetryCall(c))
}

/** `{event, props}` of every telemetry POST the mock received, in order. */
export function telemetryBodies(fetchMock) {
  return fetchMock.mock.calls.filter(isTelemetryCall).map(([, init]) => JSON.parse(init.body))
}

/** Words that must never appear in any telemetry body a test drove. */
export function expectNoContent(bodies, words) {
  const blob = JSON.stringify(bodies)
  return words.filter((w) => w && blob.includes(w))
}
