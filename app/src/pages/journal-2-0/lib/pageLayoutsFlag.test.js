import { describe, it, expect, beforeEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { pageLayoutsEnabled, PAGE_LAYOUTS_FLAG } from './pageLayoutsFlag'

describe('pageLayoutsEnabled', () => {
  beforeEach(() => __resetNotebookFlags())
  it('is false until the payload says true', () => {
    expect(pageLayoutsEnabled()).toBe(false)
  })
  it('reads the latched payload key', () => {
    latchNotebookFlags({ [PAGE_LAYOUTS_FLAG]: true })
    expect(pageLayoutsEnabled()).toBe(true)
  })
  it('is false for a non-boolean value', () => {
    latchNotebookFlags({ [PAGE_LAYOUTS_FLAG]: 'yes' })
    expect(pageLayoutsEnabled()).toBe(false)
  })
})
