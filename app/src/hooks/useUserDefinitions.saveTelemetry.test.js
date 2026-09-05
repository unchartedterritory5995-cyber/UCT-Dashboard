// Phase One Track C — `saveUserDefinition`'s optional 3rd `telemetry` arg.
//
// ⛔ ADDITIVE ONLY. Every pre-existing caller passes 0 or 2 arguments; this
// file's job is proving the new 3rd argument is inert when absent and
// correctly threaded into the request body when present.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveUserDefinition } from './useUserDefinitions'

function stubFetch() {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
  return calls
}

beforeEach(() => { vi.restoreAllMocks() })

describe('saveUserDefinition telemetry passthrough', () => {
  it('⛔ omitting telemetry (the pre-existing 2-arg call shape) sends NEITHER field', async () => {
    const calls = stubFetch()
    await saveUserDefinition({ id: 'u_x' }, null)
    expect(calls[0].body).toEqual({ definition: { id: 'u_x' } })
    expect('import_id' in calls[0].body).toBe(false)
    expect('source_dialect' in calls[0].body).toBe(false)
  })

  it('⭐ a telemetry object with an importId adds BOTH sibling fields, never inside `definition`', async () => {
    const calls = stubFetch()
    await saveUserDefinition({ id: 'u_x' }, null, { importId: 'journey-1', dialect: 'pine' })
    expect(calls[0].body.definition).toEqual({ id: 'u_x' })
    expect(calls[0].body.import_id).toBe('journey-1')
    expect(calls[0].body.source_dialect).toBe('pine')
  })

  it('⛔ a telemetry object with NO importId is treated as absent (nothing to join)', async () => {
    const calls = stubFetch()
    await saveUserDefinition({ id: 'u_x' }, null, { dialect: 'pine' })
    expect('import_id' in calls[0].body).toBe(false)
    expect('source_dialect' in calls[0].body).toBe(false)
  })

  it('⭐ a missing dialect still sends import_id, with source_dialect explicitly null', async () => {
    const calls = stubFetch()
    await saveUserDefinition({ id: 'u_x' }, null, { importId: 'journey-2' })
    expect(calls[0].body.import_id).toBe('journey-2')
    expect(calls[0].body.source_dialect).toBeNull()
  })

  it('⭐ works identically on the EDIT (PUT) path', async () => {
    const calls = stubFetch()
    await saveUserDefinition({ id: 'u_x' }, 'u_x', { importId: 'journey-3', dialect: 'pcf' })
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].body.import_id).toBe('journey-3')
    expect(calls[0].body.source_dialect).toBe('pcf')
  })
})
