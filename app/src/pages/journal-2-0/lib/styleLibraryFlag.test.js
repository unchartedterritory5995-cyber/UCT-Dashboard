import { describe, it, expect, beforeEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags, FLAG_FALLBACKS } from './offline/notebookFlags'
import { styleLibraryEnabled, STYLE_LIBRARY_FLAG } from './styleLibraryFlag'

describe('styleLibraryEnabled', () => {
  beforeEach(() => __resetNotebookFlags())
  it('is an enablement gate: the fallback is OFF', () => {
    expect(STYLE_LIBRARY_FLAG).toBe('notebook_style_library_enabled')
    expect(FLAG_FALLBACKS[STYLE_LIBRARY_FLAG]).toBe(false)
  })
  it('is false until the payload says true', () => {
    expect(styleLibraryEnabled()).toBe(false)
  })
  it('reads the latched payload key', () => {
    latchNotebookFlags({ [STYLE_LIBRARY_FLAG]: true })
    expect(styleLibraryEnabled()).toBe(true)
  })
  it('is false for a non-boolean value', () => {
    latchNotebookFlags({ [STYLE_LIBRARY_FLAG]: 'yes' })
    expect(styleLibraryEnabled()).toBe(false)
  })
})
