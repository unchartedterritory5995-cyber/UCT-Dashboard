// ⛔ NOTHING IN THE MANIFEST MAY BE SILENTLY CUT. The server (api/services/uct_agent/turn.py
// validate_manifest) keeps at most MAX_CAPABILITIES entries, drops an entry over MAX_CAP_BYTES,
// and cuts `summary` at 400 / `hints` at MAX_HINTS characters — each a silent change of
// behaviour (a cut hint once dropped widget.add's alias rule). This test fails the build first.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'

// The server's numbers, from the shared contract (tests/test_uct_agent_contract.py holds turn.py to it).
const L = MANIFEST_CONTRACT.limits
const SERVER = { MAX_CAPABILITIES: L.maxCapabilities, MAX_CAP_BYTES: L.maxCapBytes, MAX_HINTS: L.maxHints, MAX_SUMMARY: L.maxSummary }

describe('the manifest fits the server caps — nothing is cut on the way to the model', () => {
  registerBuiltins()
  const m = manifestFor({ surface: 'charts' })
  it('count', () => { expect(m.length).toBeLessThanOrEqual(SERVER.MAX_CAPABILITIES) })
  it.each(m.map(c => [c.name, c]))('%s', (_name, c) => {
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(SERVER.MAX_CAP_BYTES)
    expect(String(c.summary || '').length).toBeLessThanOrEqual(SERVER.MAX_SUMMARY)
    expect(String(c.hints || '').length).toBeLessThanOrEqual(SERVER.MAX_HINTS)
  })
})
