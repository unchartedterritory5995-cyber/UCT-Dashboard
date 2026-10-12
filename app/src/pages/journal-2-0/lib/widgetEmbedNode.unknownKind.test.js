// P1.7(b) rail: a widget kind this bundle does not know survives the load/save round trip with
// every attribute the node declares -- params included -- and an UNDECLARED attribute does not.
// The control is why P2 keeps block state inside `params` (docs/notebook/p1-verify-before-building.md §a).
import { describe, it, expect } from 'vitest'
import { Node as PMNode } from '@tiptap/pm/model'
import { editorSchema } from './tiptap'

const FUTURE = {
  type: 'widgetEmbed',
  attrs: {
    v: 1, widgetId: 'checklistFromTheFuture', embedId: 'e-future-1', mode: 'snapshot',
    capturedAt: '2026-10-11T14:00:00Z', searchText: '[checklist: 1 of 1]',
    params: { items: [{ id: 'a', text: 'Base 5+ weeks', checked: true }], setup: 'VCP' },
  },
}
const doc = (...nodes) => ({ type: 'doc', content: nodes })
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('an unknown block kind in an older bundle', () => {
  it('round-trips with widgetId, params, embedId and searchText intact', () => {
    const back = PMNode.fromJSON(editorSchema(), doc(para('Plan'), FUTURE)).toJSON()
    const node = back.content.find((n) => n.type === 'widgetEmbed')
    expect(node.attrs.widgetId).toBe('checklistFromTheFuture')
    expect(node.attrs.params).toEqual(FUTURE.attrs.params)
    expect(node.attrs.embedId).toBe('e-future-1')
    expect(node.attrs.searchText).toBe('[checklist: 1 of 1]')
  })

  it('CONTROL: an undeclared attribute is dropped, so block state must live in params', () => {
    const withAttr = { ...FUTURE, attrs: { ...FUTURE.attrs, blockState: { ticks: 3 } } }
    const back = PMNode.fromJSON(editorSchema(), doc(withAttr)).toJSON()
    expect(back.content[0].attrs.blockState).toBeUndefined()
    expect(back.content[0].attrs.params).toEqual(FUTURE.attrs.params)
  })
})
