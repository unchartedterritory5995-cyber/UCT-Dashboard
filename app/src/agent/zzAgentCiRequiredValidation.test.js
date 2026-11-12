// agent-ci-required validation B step 3 (PR #1156, never merged): a DELIBERATELY failing Agent test — expect the status FAILURE.
import { it, expect } from 'vitest'
it('fails on purpose (validation of the agent-ci-required status)', () => { expect(1).toBe(2) })
