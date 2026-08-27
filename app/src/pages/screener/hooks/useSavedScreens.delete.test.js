// app/src/pages/screener/hooks/useSavedScreens.delete.test.js
//
// ─── 🔴 THE SAVED-SCREENS DELETE DOOR'S REFUSAL CONTRACT (X26 / W9c.1) ──────
//
// ⚰️ `remove` fired the DELETE and threw the response away entirely — no
// `r.ok` check, no body read, `mutate()` unconditionally, nothing returned.
// `ScreensManager`'s one-click delete button had no way to ask "did that
// work?", so it never asked, and a refused delete looked identical to a
// successful one from the caller's side. Mirrors the contract
// `useUserDefinitions.delete.test.js` pins for `deleteUserDefinition` — same
// reasons, applied to the sibling store this repo's own header comments call
// out as the second write door that needed checking.
//
// ⛔ THE BACKEND ANSWERS DIFFERENTLY FROM `deleteUserDefinition`'s ROUTER.
// `screener_saved_delete` used to return 200 `{"deleted": false}` on a miss —
// no non-2xx status at all — so `r.ok` alone could never see the refusal.
// Fixed alongside this file (`api/routers/screener.py`) to raise 404
// `detail: "not found"` on the identical miss, mirroring the sibling PUT
// endpoint two lines above it. This file exercises the CLIENT side of that
// contract; `tests/test_screener_api.py::test_saved_screens_delete_of_a_missing_or_foreign_screen_answers_404_not_found`
// exercises the server side.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// ⚠️ `useSavedScreens` DESTRUCTURES `mutate` OFF ITS OWN `useSWR(...)` CALL —
// the hook-bound, key-scoped revalidator SWR hands back per instance, NOT
// the module-level `import { mutate } from 'swr'` `useUserDefinitions.js`
// uses (its `deleteUserDefinition` calls the bare global one, which is why
// mocking swr's named export is the right spy THERE — measured 2026-08-26:
// mocking the named export here spies on a function this file never calls,
// and every assertion built on it silently sees zero calls). `useSWR`'s
// DEFAULT export is mocked directly instead, so the `mutate` this hook
// actually holds is one a test can see fire — and the mock never touches a
// network, so `fetch` below is called ONLY by `remove` itself, never by an
// incidental list read.
const listMutate = vi.fn()
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, mutate: listMutate }),
  mutate: vi.fn(),
}))

import useSavedScreens from './useSavedScreens'

// `remove` is returned by the hook, not exported standalone — `useSavedScreens`
// calls `useSWR` internally, so it must run inside React's render cycle
// (`renderHook`), not as a bare function call. It closes over nothing
// render-specific, so a fresh render per call is enough to read it.
function getRemove() {
  return renderHook(() => useSavedScreens()).result.current.remove
}

beforeEach(() => {
  listMutate.mockClear()
  vi.restoreAllMocks()
})

const STORE_REFUSAL = 'not found'

const respond = (over) => vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ deleted: true }), ...over,
}))

describe('a saved-screen delete answers what the STORE said, not a discarded response', () => {
  it("sends DELETE to the store's own URL for that id, and answers ok", async () => {
    const f = respond()
    vi.stubGlobal('fetch', f)
    const out = await getRemove()(9)
    expect(out).toEqual({ ok: true })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('/api/screener/saved-screens/9')
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
    expect(listMutate).toHaveBeenCalled()
  })

  it("⭐ a refusal carries the store's OWN `detail`, verbatim", async () => {
    vi.stubGlobal('fetch', respond({
      ok: false, status: 404, json: async () => ({ detail: STORE_REFUSAL }),
    }))
    const out = await getRemove()(9)
    expect(out.ok).toBe(false)
    // ⛔ EXACTLY the store's words. Not framed, not prefixed.
    expect(out.error).toBe(STORE_REFUSAL)
  })

  it('a refusal whose body is unreadable gets the ONE sentence this file owns — naming the status', async () => {
    vi.stubGlobal('fetch', respond({
      ok: false, status: 500, json: async () => { throw new Error('<html>502 Bad Gateway</html>') },
    }))
    const out = await getRemove()(9)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('500')
  })

  it('⛔ a `detail` that is NOT a string is never interpolated', async () => {
    // FastAPI answers a schema-invalid request with `detail: [{loc, msg, type}]`.
    vi.stubGlobal('fetch', respond({
      ok: false, status: 422, json: async () => ({ detail: [{ loc: ['path'], msg: 'bad id' }] }),
    }))
    const out = await getRemove()(9)
    expect(out.ok).toBe(false)
    expect(out.error).not.toContain('object Object')
    expect(out.error).toContain('422')
  })

  it('⛔ a transport failure is a DIFFERENT sentence from a refusal, and revalidates NOTHING', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const out = await getRemove()(9)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/connection/i)
    // A request that never left cannot have changed what the store holds.
    expect(listMutate).not.toHaveBeenCalled()
  })

  it('⭐ every branch answers an OBJECT, and a refusal always carries a non-empty sentence', async () => {
    const branches = [
      respond(),
      respond({ ok: false, status: 404, json: async () => ({ detail: STORE_REFUSAL }) }),
      respond({ ok: false, status: 402, json: async () => ({ detail: 'The screener requires a paid plan' }) }),
      respond({ ok: false, status: 500, json: async () => { throw new Error('nope') } }),
      respond({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'bad' }] }) }),
      // ⭐ THE FIXTURE THAT CATCHES A REAL BUG, not merely "non-empty" cases
      // that were never blank to begin with.
      respond({ ok: false, status: 409, json: async () => ({ detail: '   ' }) }),
      respond({ ok: false, status: 409, json: async () => ({ detail: '\n\t ' }) }),
      vi.fn(async () => { throw new TypeError('Failed to fetch') }),
    ]
    for (const f of branches) {
      vi.stubGlobal('fetch', f)
      const out = await getRemove()(9)
      expect(out, 'a caller reads `.ok` unconditionally — null is not an answer').toBeTruthy()
      expect(typeof out.ok).toBe('boolean')
      if (!out.ok) {
        expect(typeof out.error).toBe('string')
        expect(out.error.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('a blank `detail` falls through to the sentence that NAMES THE STATUS', async () => {
    for (const blank of ['   ', '\n', '\t\t', ' \r\n ']) {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false, status: 409, json: async () => ({ detail: blank }),
      })))
      const out = await getRemove()(9)
      expect(out.ok).toBe(false)
      expect(out.error.trim().length, 'answered a blank refusal').toBeGreaterThan(0)
      expect(out.error).toContain('409')
    }
  })

  it('surrounding whitespace is trimmed off a real sentence rather than rendered with it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({ detail: `\n  ${STORE_REFUSAL}  \n` }),
    })))
    const out = await getRemove()(9)
    expect(out.error).toBe(STORE_REFUSAL)
  })

  it('the revalidation fires on a refusal too — only a transport failure skips it', async () => {
    vi.stubGlobal('fetch', respond({ ok: false, status: 404, json: async () => ({ detail: STORE_REFUSAL }) }))
    await getRemove()(9)
    expect(listMutate).toHaveBeenCalled()
  })
})
