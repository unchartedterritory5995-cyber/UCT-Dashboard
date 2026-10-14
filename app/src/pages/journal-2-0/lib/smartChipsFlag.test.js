import { describe, expect, it, beforeEach } from 'vitest'
import { SMART_CHIPS_FLAG, smartChipsEnabled } from './smartChipsFlag'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

describe('smart chips switch', () => {
  beforeEach(() => { __resetNotebookFlags() })
  it('is an enablement gate: off until the payload says on', () => {
    expect(FLAG_FALLBACKS[SMART_CHIPS_FLAG]).toBe(false)
    expect(smartChipsEnabled()).toBe(false)
  })
  it('follows the latched payload', () => {
    latchNotebookFlags({ [SMART_CHIPS_FLAG]: true })
    expect(smartChipsEnabled()).toBe(true)
  })
})
