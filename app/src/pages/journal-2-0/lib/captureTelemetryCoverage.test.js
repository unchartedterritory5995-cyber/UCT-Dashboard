import { describe, it, expect } from 'vitest'
import { CAPTURE_TARGETS } from './captureTargets'
import { CAPTURE_TELEMETRY_TARGET, NOT_A_CAPTURE } from './sendToJournal'
import { EVENT_SCHEMAS } from './notebookTelemetry'

// Wave 10 10D fix round 1 (review M-9). `CAPTURE_TELEMETRY_TARGET` restates which
// capture destinations exist; the authority is `CAPTURE_TARGETS` (captureTargets.js),
// whose own contract is that a destination added there reaches EVERY door for free.
// Without this rail such a destination would be captured everywhere and counted as
// `capture_used` nowhere. Every registry key must be either mapped to a telemetry word
// or declared not-a-capture — and the real registry is read, never a copy of it.

/** Registry keys that are neither counted nor declared not-a-capture. */
function unaccounted(targets, mapped = CAPTURE_TELEMETRY_TARGET, notCapture = NOT_A_CAPTURE) {
  return Object.keys(targets).filter((k) => !(k in mapped) && !notCapture.includes(k))
}

describe('capture_used covers every capture destination (review M-9)', () => {
  it('every CAPTURE_TARGETS key is counted as a capture or declared not-a-capture', () => {
    const keys = Object.keys(CAPTURE_TARGETS)
    // non-vacuity: the real registry, with entries on both sides of the line
    expect(keys).toEqual(expect.arrayContaining(['note', 'inbox', 'copyChartLink']))
    expect(unaccounted(CAPTURE_TARGETS)).toEqual([])
  })

  it('CONTROL: a destination added to the registry and mapped nowhere is reported by name', () => {
    const grown = { ...CAPTURE_TARGETS, sendToSlack: { id: 'sendToSlack', run: async () => 'ok' } }
    expect(unaccounted(grown)).toEqual(['sendToSlack'])
  })

  it('the two lists are disjoint, name only real keys, and map only to words the schema accepts', () => {
    for (const k of NOT_A_CAPTURE) {
      expect(CAPTURE_TELEMETRY_TARGET[k], `${k} is both counted and not-a-capture`).toBeUndefined()
      expect(CAPTURE_TARGETS, `stale not-a-capture entry ${k}`).toHaveProperty(k)
    }
    const allowed = [...EVENT_SCHEMAS.capture_used.target.values]
    for (const [k, word] of Object.entries(CAPTURE_TELEMETRY_TARGET)) {
      expect(CAPTURE_TARGETS, `stale mapping for ${k}`).toHaveProperty(k)
      expect(allowed, `${k} -> ${word}`).toContain(word)
    }
  })
})
