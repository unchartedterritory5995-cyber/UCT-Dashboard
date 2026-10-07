// The controlled member rollout: who the BROWSER shows Create Indicator to.
// ⛔ A door, not the lock — `/converse` enforces the same rule server-side
// (tests/test_rollout_create_indicator.py).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createIndicatorAccess, CREATE_INDICATOR_COHORT } from './createIndicatorFlag'

describe('createIndicatorAccess — admin review OR the server-released cohort', () => {
  it('the cohort name is spelled exactly as the Python gate spells it', () => {
    const py = fs.readFileSync(path.resolve(__dirname, '../../../../../../api/services/rollout_gate.py'), 'utf8')
    expect(py).toContain(`CREATE_INDICATOR_COHORT = "${CREATE_INDICATOR_COHORT}"`)
  })
  it.each([
    ['admin, flag on', { user: { role: 'admin' }, cohorts: [] }, true, true],
    ['admin, flag off (dark review needs the opt-in)', { user: { role: 'admin' }, cohorts: [] }, false, false],
    ['admin in the cohort, flag off: still the review rule', { user: { role: 'admin' }, cohorts: [CREATE_INDICATOR_COHORT] }, false, false],
    ['member released by the server', { user: { role: 'member' }, cohorts: [CREATE_INDICATOR_COHORT] }, false, true],
    ['member released, flag irrelevant', { user: { role: 'member' }, cohorts: [CREATE_INDICATOR_COHORT] }, true, true],
    ['member NOT released, flag set from DevTools', { user: { role: 'member' }, cohorts: [] }, true, false],
    ['member in a different cohort only', { user: { role: 'member' }, cohorts: ['terminal-next'] }, true, false],
    ['no cohorts field at all', { user: { role: 'member' } }, true, false],
    ['anonymous', { user: null, cohorts: null }, true, false],
    ['a spoofed non-array cohorts value', { user: { role: 'member' }, cohorts: 'create-indicator' }, true, false],
  ])('%s', (_label, auth, flag, want) => {
    expect(createIndicatorAccess(auth, flag)).toBe(want)
  })
})
