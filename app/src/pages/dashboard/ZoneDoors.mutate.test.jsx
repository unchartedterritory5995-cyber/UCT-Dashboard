// app/src/pages/dashboard/ZoneDoors.mutate.test.jsx
//
// 🔴 THE THIRD PATH, AND THE ONE THE OTHER TWO FILES CANNOT SEE.
//
// `ZoneDoors.readOnly.test.jsx` pins the four `revalidateOn*: false` flags;
// `ZoneDoors.clientFill.test.jsx` pins the values they produce. Both are
// correct and neither could catch this: those flags gate SWR's AUTOMATIC
// triggers only. `internalMutate` calls the hook's `revalidate` directly, and
// that function short-circuits on `!key || !fetcher || unmounted ||
// isPaused()` — none of the four flags is consulted
// (`node_modules/swr/dist/index/index.mjs`, the `revalidate` useCallback).
//
// `Dashboard.jsx`'s `handleRefresh` is exactly that call —
// `mutate(() => true, undefined, { revalidate: true })` — wired to
// `<PullToRefresh>`. So a weekday pull-to-refresh made ZoneDoors fetch
// `/api/desk/articles?limit=12` on its own, which is precisely what its
// header comment promised could never happen.
//
// ⛔ A FETCH SPY *DOES* DISCRIMINATE HERE, unlike on the mount path. The mount
// case is deferred to `requestAnimationFrame`, which jsdom will not settle
// inside `act()`; a mutate-triggered revalidation is a plain promise on the
// same tick, so awaiting it is reliable. That difference is the whole reason
// this file exists as a behavioural test while its neighbour is a config one.
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig, useSWRConfig } from 'swr'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import ZoneDoors from './ZoneDoors'

vi.mock('../../hooks/useMobileSWR', () => ({
  default: () => ({ data: {} }),
}))

/** The keys ZoneDoors reads but must never itself request. */
const READ_ONLY_KEYS = [
  '/api/j2/positions',
  '/api/j2/options?status=open',
  '/api/community/unread',
]

let fired

function Refresher({ onReady }) {
  const { mutate } = useSWRConfig()
  onReady.current = () => mutate(() => true, undefined, { revalidate: true })
  return null
}

const mount = (onReady) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter>
      <Refresher onReady={onReady} />
      <ZoneDoors />
    </MemoryRouter>
  </SWRConfig>,
)

beforeEach(() => {
  fired = []
  global.fetch = vi.fn(async (url) => {
    fired.push(String(url))
    return {
      ok: true,
      status: 200,
      // Enough shape for every reader here; `enabled` keeps the community
      // door (and therefore its /unread key) mounted.
      json: async () => ({ enabled: true, total: 0, positions: [], strategies: [], articles: [] }),
    }
  })
})
afterEach(() => { cleanup(); delete global.fetch; vi.restoreAllMocks() })

describe('ZoneDoors under Dashboard\'s pull-to-refresh mutate', () => {
  test('an explicit revalidate-all does NOT make the client-fill reads fetch', async () => {
    const refresh = { current: null }
    mount(refresh)
    await act(async () => { await Promise.resolve() })
    fired.length = 0                       // ignore anything the mount itself did

    await act(async () => { await refresh.current() })

    const offenders = fired.filter((u) => READ_ONLY_KEYS.some((k) => u.includes(k)))
    expect(offenders,
      'a pure cache reader fired its own request on the mutate path — the '
      + 'four revalidateOn* flags do not gate an explicit mutate, only '
      + 'isPaused does').toEqual([])
  })

  test('⚰️ the desk key is not subscribed AT ALL any more — not merely paused', async () => {
    // This was the sharpest case: on a weekday `TheWeek` is not mounted, so
    // ZoneDoors was the SOLE subscriber to `/api/desk/articles?limit=12` and a
    // request for it was unambiguously this component's own — which is what
    // made the "incapable of EVER independently firing a request" claim false
    // rather than merely unproven.
    //
    // ⛔ A PAUSED READ WOULD MAKE THIS TEST VACUOUS, so it asserts the
    // stronger thing: the count moved to `dashboard_signposts.py` and this
    // component no longer holds the key on ANY path — mount or mutate.
    const refresh = { current: null }
    mount(refresh)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await refresh.current() })
    expect(fired.filter((u) => u.includes('/api/desk/articles'))).toEqual([])
  })

  test('CONTROL: the spy really does see fetches on this path', async () => {
    // Without this, every assertion above passes for a harness whose mutate
    // never reaches any revalidator at all.
    const refresh = { current: null }
    mount(refresh)
    await act(async () => { await Promise.resolve() })
    fired.length = 0
    await act(async () => { await refresh.current() })
    expect(fired.some((u) => u.includes('/api/community/status')),
      'the non-READ_ONLY read must still revalidate, or this file is measuring '
      + 'a mutate that does nothing at all').toBe(true)
  })
})
