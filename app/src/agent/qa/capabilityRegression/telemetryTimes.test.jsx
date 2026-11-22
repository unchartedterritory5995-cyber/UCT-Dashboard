// SPEED TELEMETRY (constant schema, 2026-11-05): a change's row says when it reached the screen and when it was read back and
// saved, as two numbers. docs/agent/LATENCY.md.
import { it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog, kindsFor } from './testing/registry'
import { pinClock } from './testing/clock'
import { mountCase } from './testing/harness'

pinClock()
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const rowsOf = (p) => p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2]?.telemetry).filter(Boolean)

it('a committed change records visible_ms and verified_ms, numbers only', async () => {
  const m = mountCase('ONE', { kinds: kindsFor({}) })
  await m.say('weekly')
  await m.p.idle()
  const t = rowsOf(m.p).find(r => r.path === 'fast' && r.disposition !== 'answer')
  expect(t, 'a telemetry row for the change').toBeTruthy()
  expect(Number.isFinite(t.visible_ms)).toBe(true)
  expect(Number.isFinite(t.verified_ms)).toBe(true)
  expect(t.verified_ms).toBeGreaterThanOrEqual(t.visible_ms)
}, 30000)

it('a turn that changed nothing records no change times', async () => {
  const m = mountCase('ONE', { kinds: kindsFor({}) })
  await m.say('hello')
  await m.p.idle()
  const t = rowsOf(m.p).at(-1)
  if (t) expect([t.visible_ms ?? null, t.verified_ms ?? null]).toEqual([null, null])
}, 30000)
