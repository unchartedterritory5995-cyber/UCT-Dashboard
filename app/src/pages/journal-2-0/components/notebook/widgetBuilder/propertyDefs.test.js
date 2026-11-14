// Pass 2 final fix M6: the widget builder reads the member's property definitions through the "Note type" label
// mapping (lib/noteKinds.js `withNoteTypeNames`), so it can never show the server's "Kind of note" beside the "Note
// type" every other Notebook surface shows. Display only: the id is unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPropertyDefs, PROPERTY_DEFS_URL } from './propertyDefs'
import { NOTE_KIND_PROPERTY, NOTE_TYPE_LABEL } from '../../../lib/noteKinds'

afterEach(() => { vi.unstubAllGlobals() })

describe('loadPropertyDefs', () => {
  it('names the built-in note kind "Note type", and leaves every other definition as the server named it', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ propertyDefs: [
        { id: NOTE_KIND_PROPERTY, name: 'Kind of note', type: 'select', options: [{ value: 'trade_plan' }] },
        { id: 'p1', name: 'Kind of note', type: 'text' },   // a member's own property with that name stays theirs
        { id: 'p2', name: 'Conviction', type: 'number' },
      ] }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const defs = await loadPropertyDefs()
    expect(fetchSpy.mock.calls[0][0]).toBe(PROPERTY_DEFS_URL)
    expect(defs.get(NOTE_KIND_PROPERTY)).toEqual({ name: NOTE_TYPE_LABEL, type: 'select', options: [{ value: 'trade_plan' }] })
    expect(defs.get('p1').name).toBe('Kind of note')
    expect(defs.get('p2').name).toBe('Conviction')
  })
})
