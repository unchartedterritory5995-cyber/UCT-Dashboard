// ⛔ NOTHING IN THE MANIFEST MAY BE SILENTLY CUT. The server (api/services/uct_agent/turn.py
// validate_manifest) keeps at most MAX_CAPABILITIES entries, drops an entry over MAX_CAP_BYTES,
// and cuts `summary` at 400 / `hints` at MAX_HINTS characters — each a silent change of
// behaviour (a cut hint once dropped widget.add's alias rule). This test fails the build first.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor } from './capabilities'

const SERVER = { MAX_CAPABILITIES: 60, MAX_CAP_BYTES: 6000, MAX_HINTS: 1000, MAX_SUMMARY: 400 }

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
