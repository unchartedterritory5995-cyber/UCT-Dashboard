// Simplify pass 2, Task 1 fix round 1 (spec A4): the member reads `builtin:note_kind` as "Note type". The server still
// names it "Kind of note" (note_properties.py), so the client renames it where it READS the property: the definitions
// (every list that offers a property: the board's group-by, the table, the filter, RollupEditor), one note's
// resolved properties (its rows), and the autofill suggestions. The id and the stored key never change.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { SWRConfig } from 'swr'
import useJ2PropertyDefs from './useJ2PropertyDefs'
import useNoteProperties from './useNoteProperties'
import { requestAutofill } from '../lib/propertyAutofill'
import { NOTE_KIND_PROPERTY } from '../lib/noteKinds'
import { TYPE_LABELS } from '../lib/templateSlots'
import { slotsOf } from '../components/notebook/library/oneStepUse'

const KIND = { id: NOTE_KIND_PROPERTY, name: 'Kind of note', type: 'select', source: 'user_set', options: [] }
const OTHER = { id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', options: [] }

const serve = (body) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })))
const wrapper = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
afterEach(() => vi.unstubAllGlobals())

describe('"Note type", read from the server\'s "Kind of note"', () => {
  it('the property definitions name it "Note type"; the id and every other property are as served', async () => {
    serve({ propertyDefs: [KIND, OTHER] })
    const { result } = renderHook(() => useJ2PropertyDefs(), { wrapper })
    await waitFor(() => expect(result.current.propertyDefs).toHaveLength(2))
    expect(result.current.propertyDefs).toEqual([{ ...KIND, name: 'Note type' }, OTHER])
  })

  it('one note\'s resolved properties name it "Note type"', async () => {
    serve({ properties: [{ ...KIND, value: 'trade_plan' }, { ...OTHER, value: null }] })
    const { result } = renderHook(() => useNoteProperties('n1'), { wrapper })
    await waitFor(() => expect(result.current.properties).toHaveLength(2))
    expect(result.current.properties.map((p) => [p.id, p.name, p.value])).toEqual([
      [NOTE_KIND_PROPERTY, 'Note type', 'trade_plan'], ['builtin:thesis_status', 'Thesis Status', null]])
  })

  it('a shared template\'s note-kind choice (served as "Kind of note") reads "Note type"; other choices as served', () => {
    const slots = slotsOf({ slots: [{ id: 'p1', type: 'note_kind', label: 'Kind of note', any: true },
      { id: 'p2', type: 'folder', label: 'Folder' }] })
    expect(slots.map((s) => [s.id, s.label])).toEqual([['p1', 'Note type'], ['p2', 'Folder']])
    expect(TYPE_LABELS.note_kind).toBe('Note type')
  })

  it('an autofill suggestion for it is named "Note type"', async () => {
    serve({ suggestions: [{ propertyId: NOTE_KIND_PROPERTY, name: 'Kind of note', value: 'thesis' },
      { propertyId: OTHER.id, name: OTHER.name, value: 'watching' }] })
    const { suggestions } = await requestAutofill('n1')
    expect(suggestions.map((s) => s.name)).toEqual(['Note type', 'Thesis Status'])
    expect(suggestions[0].propertyId).toBe(NOTE_KIND_PROPERTY)
  })
})
