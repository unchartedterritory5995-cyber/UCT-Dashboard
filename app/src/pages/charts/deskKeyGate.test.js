import { describe, it, expect, afterEach } from 'vitest'
import { markDeskHidden, isHiddenDeskKey } from './deskKeyGate'

afterEach(() => { markDeskHidden(false) })

const keyOnBody = () => {
  const e = new KeyboardEvent('keydown', { key: 'd' })
  Object.defineProperty(e, 'target', { value: document.body })
  return e
}

describe('deskKeyGate', () => {
  it('passes every key while the desk is visible', () => {
    expect(isHiddenDeskKey(keyOnBody())).toBe(false)
  })

  it('while hidden: a real key on the page the member is reading is not the desk\'s', () => {
    markDeskHidden(true)
    expect(isHiddenDeskKey(keyOnBody())).toBe(true)
  })

  it('while hidden: a key relayed from a popped window (dispatched on document) still is', () => {
    markDeskHidden(true)
    let seen
    const onKey = (e) => { seen = isHiddenDeskKey(e) }
    document.addEventListener('keydown', onKey)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    document.removeEventListener('keydown', onKey)
    expect(seen).toBe(false)
  })

  it('ignores a call with no event rather than throw', () => {
    markDeskHidden(true)
    expect(isHiddenDeskKey(undefined)).toBe(false)
  })
})
