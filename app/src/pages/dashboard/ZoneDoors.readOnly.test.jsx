// app/src/pages/dashboard/ZoneDoors.readOnly.test.jsx
//
// "Zero new requests" for the journal/desk/community client fills (see
// ZoneDoors.jsx's header) rests on ONE mechanism: every one of those four
// `useSWR` calls is configured as a PURE cache reader (`READ_ONLY` —
// `revalidateOnMount/revalidateIfStale/revalidateOnFocus/revalidateOnReconnect`
// all `false`, and no `refreshInterval`). This file pins that CONFIGURATION
// directly, by mocking `swr`'s default export and inspecting the arguments
// each call site passes.
//
// ⛔ NOT a real-fetch-timing test, and that is a measured decision, not a
// shortcut. `ZoneDoors.clientFill.test.jsx`'s header explains why: a
// `global.fetch` spy version of this guarantee PASSED even with `READ_ONLY`
// deleted outright, because SWR defers a with-fallback-data mount
// revalidation to `requestAnimationFrame`, and jsdom's rAF does not resolve
// reliably inside `act()` no matter how many microtask/macrotask flushes are
// awaited afterward — a fixture that cannot discriminate is not a rail
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). Asserting the
// CONFIG is both simpler and strictly stronger: it pins the actual mechanism
// the "never fetches on its own" guarantee is built from, rather than trying
// to out-wait SWR's internal scheduling.
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = []
let dataByKey

vi.mock('swr', () => ({
  default: (key, fetcher, options) => {
    calls.push({ key, fetcher, options })
    return { data: key == null ? undefined : dataByKey[key] }
  },
}))

vi.mock('../../hooks/useMobileSWR', () => ({
  default: () => ({ data: {} }),
}))

// Imported AFTER the mocks above so ZoneDoors picks them up.
// eslint-disable-next-line import/first
import ZoneDoors from './ZoneDoors'

beforeEach(() => {
  calls.length = 0
  // Community must be "enabled" or the door — and its /unread read — never
  // mounts at all, and this file would silently stop covering it.
  dataByKey = { '/api/community/status': { enabled: true } }
})
afterEach(() => cleanup())

const mount = () => render(<MemoryRouter><ZoneDoors /></MemoryRouter>)

const READ_ONLY_KEYS = [
  '/api/j2/positions',
  '/api/j2/options?status=open',
  '/api/desk/articles?limit=12',
  '/api/community/unread',
]

describe('ZoneDoors — the client-fill reads never independently fetch', () => {
  test('all four client-fill keys are called with the full READ_ONLY config', () => {
    mount()
    for (const key of READ_ONLY_KEYS) {
      const call = calls.find((c) => c.key === key)
      expect(call, `no useSWR call recorded for ${key}`).toBeTruthy()
      expect(call.options?.revalidateOnMount, `${key}: revalidateOnMount must be false`).toBe(false)
      expect(call.options?.revalidateIfStale, `${key}: revalidateIfStale must be false`).toBe(false)
      expect(call.options?.revalidateOnFocus, `${key}: revalidateOnFocus must be false`).toBe(false)
      expect(call.options?.revalidateOnReconnect, `${key}: revalidateOnReconnect must be false`).toBe(false)
      // Also not a NEW polling site — pollingSites.rail.test.js only counts
      // a literal `refreshInterval` key on a bare useSWR's third argument.
      expect(call.options).not.toHaveProperty('refreshInterval')
    }
  })

  // CONTROL — proves the assertions above actually exercise something: the
  // pre-existing `/api/community/status` read is DELIBERATELY not
  // READ_ONLY-configured (it relies on NavBar's 120s poll + SWR's own
  // dedupe, per ZoneDoors.jsx's comment on that call), so it must NOT match
  // the same shape.
  test('CONTROL: the pre-existing community/status read is a bare useSWR, not READ_ONLY', () => {
    mount()
    const call = calls.find((c) => c.key === '/api/community/status')
    expect(call).toBeTruthy()
    expect(call.options?.revalidateOnMount).not.toBe(false)
  })
})
