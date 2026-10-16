// app/src/pages/journal-2-0/lib/earningsFollowupFlag.test.js
import { describe, expect, it, afterEach } from 'vitest'
import { EARNINGS_FOLLOWUP_FLAG, earningsFollowupEnabled } from './earningsFollowupFlag'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

describe('earnings follow-up switch', () => {
  afterEach(() => { __resetNotebookFlags() })
  it('is an enablement gate: off until the payload says on', () => {
    expect(FLAG_FALLBACKS[EARNINGS_FOLLOWUP_FLAG]).toBe(false)
    expect(earningsFollowupEnabled()).toBe(false)
  })
  it('follows the latched payload', () => {
    latchNotebookFlags({ [EARNINGS_FOLLOWUP_FLAG]: true })
    expect(earningsFollowupEnabled()).toBe(true)
  })
})
