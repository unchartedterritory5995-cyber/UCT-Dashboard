import { describe, it, expect, beforeEach } from 'vitest'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags, notebookFlag } from './notebookFlags'

// G-064 — an ENABLEMENT gate: absent means OFF, and a tab that never latched
// reports `null`, which every consumer treats as OFF.
beforeEach(() => __resetNotebookFlags())

describe('notebook_ask_insert_on', () => {
  it('falls back to false', () => {
    expect(FLAG_FALLBACKS.notebook_ask_insert_on).toBe(false)
  })

  it('is false when the payload predates it', () => {
    latchNotebookFlags({ notebook_offline_default_on: true })
    expect(notebookFlag('notebook_ask_insert_on')).toBe(false)
  })

  it('latches true when the server says so', () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    expect(notebookFlag('notebook_ask_insert_on')).toBe(true)
  })

  it('is null before anything latched', () => {
    expect(notebookFlag('notebook_ask_insert_on')).toBeNull()
  })
})
