// The screener.run hint the planner reads (owner: agent-sc) states the daily-dollar-volume rule (agent-lead ruling):
// "a day" / "per day" with no session named = the 30-day average; a NAMED session = the (latest session) field.
// Pinned in both directions so the planner's instruction and the corpora (tests/test_uct_agent_scan_sc2_corpus.py)
// cannot drift apart again (they did: discovery d08).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

registerBuiltins()
const hint = () => (getCapability('screener.run') || {}).hints || ''

describe('screener.run hint: daily dollar volume', () => {
  it('no session named ("a day" / "per day") reads the 30-day average', () => {
    expect(hint()).toMatch(/"\$10M a day" \/ "per day" if none named = the 30-day average, not share volume/)
  })
  it('a NAMED session reads the latest-session field, and only then', () => {
    expect(hint()).toMatch(/"\(latest session\)" fields only when a session is named \("today", "yesterday"\)/)
    expect(hint()).not.toMatch(/use them for a daily dollar volume/)
  })
})
