import { describe, it, expect } from 'vitest'
import { popoutAddWidgetId, popoutRemoveWidgetId } from './popoutState'

describe('popoutAddWidgetId', () => {
  it('appends an id not already popped', () => {
    expect(popoutAddWidgetId(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('is a no-op — same array identity — when the id is already popped', () => {
    const prev = ['a', 'b']
    expect(popoutAddWidgetId(prev, 'a')).toBe(prev)
  })
  it('never mutates the input array', () => {
    const prev = ['a']
    popoutAddWidgetId(prev, 'b')
    expect(prev).toEqual(['a'])
  })
})

describe('popoutRemoveWidgetId', () => {
  it('removes exactly the named id', () => {
    expect(popoutRemoveWidgetId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
  it('removing an id not present is a no-op value (new array, same contents)', () => {
    expect(popoutRemoveWidgetId(['a'], 'z')).toEqual(['a'])
  })
  it('never mutates the input array', () => {
    const prev = ['a', 'b']
    popoutRemoveWidgetId(prev, 'a')
    expect(prev).toEqual(['a', 'b'])
  })
})
