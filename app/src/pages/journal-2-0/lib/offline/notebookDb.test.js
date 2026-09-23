/**
 * ⛔ G-128 — `openNotebookDb`'s synchronous-throw path is the one raw-error-
 * class violation in the offline layer, and it is a different shape from every
 * other site the same sweep fixed: this is not UI text, it is a data-layer
 * error wrapper. A caller of `openNotebookDb` that has not yet sanitized
 * `.message` (the offline system is large enough that a future caller
 * reasonably could) must never be handed the native IndexedDB exception's raw
 * text — that text can carry engine-internal detail (a quota error's exact
 * byte count, a security-policy string) never meant for a member.
 *
 * The fix keeps full diagnosability via the standard `Error` `cause` chain
 * (an object reference, never stringified) while giving `OfflineUnavailable`
 * itself a fixed, safe `.message`.
 */
import { describe, it, expect } from 'vitest'
import { openNotebookDb, OfflineUnavailable } from './notebookDb'

describe('openNotebookDb — a synchronous idbFactory.open() throw never reaches a member as raw text', () => {
  it('wraps a thrown native error in a FIXED, safe message — never the native one', async () => {
    const nativeMessage = 'QuotaExceededError: the quota has been exceeded, 47331328 bytes requested'
    const idbFactory = {
      open() { throw new Error(nativeMessage) },
    }
    await expect(openNotebookDb('acct-1', { idbFactory })).rejects.toMatchObject({
      constructor: OfflineUnavailable,
    })
    try {
      await openNotebookDb('acct-1', { idbFactory })
      throw new Error('expected a rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineUnavailable)
      // ⛔ THE LOAD-BEARING ASSERTION. Not "some message exists" — that native
      // text must be ABSENT from what a naive `catch (e) { show(e.message) }`
      // caller would render.
      expect(err.message).not.toContain(nativeMessage)
      expect(err.message).not.toContain('QuotaExceededError')
      expect(err.message).not.toContain('47331328')
    }
  })

  it('still preserves the native error for diagnostics, via .cause', async () => {
    const native = new Error('SecurityError: access to the database is denied')
    const idbFactory = { open() { throw native } }
    try {
      await openNotebookDb('acct-1', { idbFactory })
      throw new Error('expected a rejection')
    } catch (err) {
      expect(err.cause).toBe(native)
    }
  })

  it('also wraps a thrown non-Error value (a string, or undefined) safely', async () => {
    const idbFactory = { open() { throw 'not an Error instance' } }
    try {
      await openNotebookDb('acct-1', { idbFactory })
      throw new Error('expected a rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineUnavailable)
      expect(err.message).not.toContain('not an Error instance')
      expect(err.cause).toBe('not an Error instance')
    }
  })

  it('control: a SUCCESSFUL open still resolves normally (the fix touches only the catch branch)', async () => {
    const fakeReq = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: { __fake: true } }
    const idbFactory = {
      open() {
        queueMicrotask(() => fakeReq.onsuccess && fakeReq.onsuccess())
        return fakeReq
      },
    }
    const db = await openNotebookDb('acct-1', { idbFactory })
    expect(db).toBe(fakeReq.result)
  })
})
