// app/src/hooks/useUserDefinitions.delete.test.js
//
// ─── 🔴 THE DELETE DOOR'S REFUSAL CONTRACT (W4a.6) ──────────────────────────
//
// ⚰️ `deleteUserDefinition` ANSWERED A BARE BOOLEAN, and that made every caller
// structurally unable to tell a member WHY. The store answers a delete it will
// not do with a sentence — `"Not found"` for a definition that is not yours,
// `require_paid`'s own 402 line for a lapsed plan — and all of it was thrown
// away at `return r.ok`, one layer below every surface that needed it.
//
// ⛔ THAT IS NOT A COSMETIC GAP. This file's own header states the split it
// keeps: the store's refusal sentence is NEVER rewritten here, and the only
// sentences written in this file are the two the server cannot supply (it never
// answered / its body is unreadable). A caller downstream of a boolean has no
// way to honour that rule — it can only invent a sentence, which is the second
// vocabulary the header forbids. `saveUserDefinition`, two functions up, has had
// the right shape all along; this is the same contract applied to the door that
// was missing it.
//
// ⚠️ THE K3 REVALIDATION IS PINNED NEXT DOOR (`useUserDefinitions.metaMutate.test.js`)
// and is deliberately NOT re-asserted here — one owner per claim.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mutate = vi.fn()
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, mutate: (...a) => mutate(...a) }
})

import { deleteUserDefinition, USER_DEFINITIONS_KEY } from './useUserDefinitions'

beforeEach(() => {
  mutate.mockClear()
  vi.restoreAllMocks()
})

/** The shipped router's refusal for a definition that is not the caller's
 *  (`api/routers/user_definitions.py::delete_definition` → 404 "Not found").
 *  Spelled here as a FIXTURE of what a server says — the point of every case
 *  below is that this string is never authored on the client. */
const STORE_REFUSAL = 'Not found'

const respond = (over) => vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ ok: true }), ...over,
}))

describe('a delete answers what the STORE said, not a boolean', () => {
  it('sends DELETE to the store\'s own URL for that id, and answers ok', async () => {
    const f = respond()
    vi.stubGlobal('fetch', f)
    const out = await deleteUserDefinition('u_1')
    expect(out).toEqual({ ok: true })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe(`${USER_DEFINITIONS_KEY}/u_1`)
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'include' })
  })

  it('⭐ a refusal carries the store\'s OWN `detail`, verbatim', async () => {
    vi.stubGlobal('fetch', respond({
      ok: false, status: 404, json: async () => ({ detail: STORE_REFUSAL }),
    }))
    const out = await deleteUserDefinition('u_1')
    expect(out.ok).toBe(false)
    // ⛔ EXACTLY the store's words. Not framed, not prefixed — a caller that
    // renders this renders the engine, and there is one voice on one fact.
    expect(out.error).toBe(STORE_REFUSAL)
  })

  it('a refusal whose body is unreadable gets the ONE sentence this file owns — naming the status', async () => {
    vi.stubGlobal('fetch', respond({
      ok: false, status: 500, json: async () => { throw new Error('<html>502 Bad Gateway</html>') },
    }))
    const out = await deleteUserDefinition('u_1')
    expect(out.ok).toBe(false)
    expect(out.error).toContain('500')
  })

  it('⛔ a `detail` that is NOT a string is never interpolated', async () => {
    // FastAPI answers a schema-invalid request with `detail: [{loc, msg, type}]`.
    // Interpolating that shows a member "[object Object]", which is worse than
    // silence — the same trap `saveUserDefinition` documents.
    vi.stubGlobal('fetch', respond({
      ok: false, status: 422, json: async () => ({ detail: [{ loc: ['path'], msg: 'bad id' }] }),
    }))
    const out = await deleteUserDefinition('u_1')
    expect(out.ok).toBe(false)
    expect(out.error).not.toContain('object Object')
    expect(out.error).toContain('422')
  })

  it('⛔ a transport failure is a DIFFERENT sentence from a refusal — one is "try again", the other is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const out = await deleteUserDefinition('u_1')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/connection/i)
    // A request that never left cannot have changed what the store holds, so
    // nothing is revalidated on this branch.
    expect(mutate).not.toHaveBeenCalled()
  })

  it('⭐ every branch answers an OBJECT, and a refusal always carries a non-empty sentence', async () => {
    const branches = [
      respond(),
      respond({ ok: false, status: 404, json: async () => ({ detail: STORE_REFUSAL }) }),
      respond({ ok: false, status: 402, json: async () => ({ detail: 'Custom indicators require a paid plan' }) }),
      respond({ ok: false, status: 500, json: async () => { throw new Error('nope') } }),
      respond({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'bad' }] }) }),
      vi.fn(async () => { throw new TypeError('Failed to fetch') }),
    ]
    for (const f of branches) {
      vi.stubGlobal('fetch', f)
      const out = await deleteUserDefinition('u_1')
      expect(out, 'a caller reads `.ok` unconditionally — null is not an answer').toBeTruthy()
      expect(typeof out.ok).toBe('boolean')
      if (!out.ok) {
        expect(typeof out.error).toBe('string')
        // ⛔ NON-EMPTY IS THE LOAD-BEARING HALF. A caller told to render the
        // store's words verbatim renders an EMPTY alert if this is ever blank —
        // a refusal a member cannot read is a refusal they did not get.
        expect(out.error.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
