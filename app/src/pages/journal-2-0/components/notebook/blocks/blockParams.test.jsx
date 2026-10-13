// Spec §P2 integrity rule: a block's state changes ONLY through an editor transaction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useBlockParams } from './useBlockParams'

function Probe({ attrs, updateAttributes, editable }) {
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  return <button type="button" onClick={() => setParams({ checked: ['r1'] })}>tick</button>
}

describe('useBlockParams', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('a tick is ONE transaction through updateAttributes, no fetch', () => {
    const updateAttributes = vi.fn()
    const attrs = { widgetId: 'preEntryChecklist', params: { setup: 'VCP', checked: [] } }
    render(<Probe attrs={attrs} updateAttributes={updateAttributes} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0]).toEqual({
      params: { setup: 'VCP', checked: ['r1'] }, searchText: '[pre-entry checklist]',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fix round 1: an optional capturedAt rides the SAME transaction (one call, three keys)', () => {
    const updateAttributes = vi.fn()
    function Stamp() {
      const set = useBlockParams({ attrs: { widgetId: 'marketcontext', params: { uncaptured: true, fields: 'all' } }, updateAttributes, editable: true })
      return <button type="button" onClick={() => set({ readings: { marketPhase: 'Uptrend' }, uncaptured: undefined }, { capturedAt: '2026-10-13T17:26:00.123000Z' })}>stamp</button>
    }
    render(<Stamp />)
    fireEvent.click(screen.getByRole('button', { name: 'stamp' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0].capturedAt).toBe('2026-10-13T17:26:00.123000Z')
    expect(Object.keys(updateAttributes.mock.calls[0][0]).sort()).toEqual(['capturedAt', 'params', 'searchText'])
  })

  it('CONTROL: a block call (no second argument, or one that is not a time) writes exactly params + searchText', () => {
    const updateAttributes = vi.fn()
    function Block() {
      const set = useBlockParams({ attrs: { widgetId: 'prepWire', params: {} }, updateAttributes, editable: true })
      return <button type="button" onClick={() => { set({ snapshot: { part: 'wire' } }); set({ x: 1 }, { capturedAt: '' }); set({ y: 2 }, { other: 1 }) }}>three</button>
    }
    render(<Block />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'three' })) })
    expect(updateAttributes).toHaveBeenCalledTimes(3)
    for (const [arg] of updateAttributes.mock.calls) expect(Object.keys(arg).sort()).toEqual(['params', 'searchText'])
  })

  it('a reader (not editable) writes nothing', () => {
    const updateAttributes = vi.fn()
    render(<Probe attrs={{ widgetId: 'preEntryChecklist', params: {} }} updateAttributes={updateAttributes} editable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'tick' }))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('two ticks in a row read the LATEST params, never a stale render', () => {
    const calls = []
    let attrs = { widgetId: 'preEntryChecklist', params: { checked: [] } }
    const updateAttributes = (a) => { calls.push(a); attrs = { ...attrs, params: a.params } }
    function Two() {
      const set = useBlockParams({ attrs, updateAttributes, editable: true })
      return <button type="button" onClick={() => { set({ checked: ['a'] }); set({ setup: 'VCP' }) }}>two</button>
    }
    render(<Two />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'two' })) })
    expect(calls[1].params).toEqual({ checked: ['a'], setup: 'VCP' })
  })
})
