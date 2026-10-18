import { describe, it, expect, beforeEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags, FLAG_FALLBACKS } from './offline/notebookFlags'
import { starterPacksEnabled, STARTER_PACKS_FLAG } from './starterPacksFlag'

describe('starterPacksEnabled', () => {
  beforeEach(() => __resetNotebookFlags())
  it('is an enablement gate: the fallback is OFF', () => {
    expect(STARTER_PACKS_FLAG).toBe('notebook_starter_packs_enabled')
    expect(FLAG_FALLBACKS[STARTER_PACKS_FLAG]).toBe(false)
  })
  it('is false until the payload says true', () => {
    expect(starterPacksEnabled()).toBe(false)
  })
  it('reads the latched payload key', () => {
    latchNotebookFlags({ [STARTER_PACKS_FLAG]: true })
    expect(starterPacksEnabled()).toBe(true)
  })
  it('is false for a non-boolean value', () => {
    latchNotebookFlags({ [STARTER_PACKS_FLAG]: 'yes' })
    expect(starterPacksEnabled()).toBe(false)
  })
})
