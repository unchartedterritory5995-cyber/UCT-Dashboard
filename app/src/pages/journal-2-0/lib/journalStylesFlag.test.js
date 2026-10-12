import { describe, it, expect, afterEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags, FLAG_FALLBACKS } from './offline/notebookFlags'
import { journalStylesEnabled, JOURNAL_STYLES_FLAG, STYLE_EVENT } from './journalStylesFlag'

afterEach(() => __resetNotebookFlags())

describe('the journal styles switch', () => {
  it('is OFF when the server never answered', () => {
    expect(FLAG_FALLBACKS[JOURNAL_STYLES_FLAG]).toBe(false)
    expect(journalStylesEnabled()).toBe(false)
  })
  it('is ON only when the payload says true', () => {
    latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true })
    expect(journalStylesEnabled()).toBe(true)
  })
  it('names its event', () => {
    expect(STYLE_EVENT).toBe('uct:notebook-journal-style')
  })
})
