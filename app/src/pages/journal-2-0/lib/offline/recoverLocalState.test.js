/**
 * Wave Q1 — which of the three copies is the member's newest work (§11).
 *
 * ⛔ THE RULE THIS FILE EXISTS TO PIN: localStorage is written synchronously on
 * every keystroke and IndexedDB lags it by the ~200 ms coalescing window, so
 * within a session the draft can only be EQUAL OR NEWER. "Prefer IndexedDB
 * because it is the offline store" would silently regress the member's last
 * couple of hundred milliseconds of typing — the exact window the crash buffer
 * exists to hold.
 */
import { describe, it, expect } from 'vitest'
import { chooseLocalRecovery, newSessionId } from './recoverLocalState'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const SERVER = { title: 'Thesis', subtitle: '', bodyJson: doc('server text'), updatedAt: 'T1' }

describe('nothing to recover', () => {
  it('returns the server when there is no local copy at all', () => {
    const r = chooseLocalRecovery({ server: SERVER })
    expect(r.source).toBe('server')
    expect(r.unsynced).toBe(false)
  })

  it('returns the server when every local copy matches it', () => {
    // A draft identical to the server saved fine — offering it is pure noise,
    // which is the same judgement the existing Restore banner already makes.
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { ...SERVER, generation: 4, sessionId: 's1', localSavedAt: 10 },
      lsDraft: { ...SERVER, savedAt: 20 },
    })
    expect(r.source).toBe('server')
    expect(r.unsynced).toBe(false)
  })
})

describe('one local copy', () => {
  it('recovers the durable copy when only it differs', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('offline work'), generation: 3, sessionId: 's1', localSavedAt: 50, baseUpdatedAt: 'T1' },
    })
    expect(r.source).toBe('idb')
    expect(r.unsynced).toBe(true)
    expect(r.baseUpdatedAt).toBe('T1')
  })

  it('recovers the synchronous draft when only it differs', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('crash-window text'), savedAt: 99 },
    })
    expect(r.source).toBe('localStorage')
    expect(r.state.bodyJson).toEqual(doc('crash-window text'))
  })

  it('a legacy draft with no generation still carries the server base', () => {
    // Drafts written before Wave Q have {title, subtitle, bodyJson, savedAt}
    // and nothing else. They must still be recoverable, against the base the
    // server currently reports.
    const r = chooseLocalRecovery({
      server: SERVER,
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('old draft'), savedAt: 1 },
    })
    expect(r.source).toBe('localStorage')
    expect(r.baseUpdatedAt).toBe('T1')
  })
})

describe('⛔ two local copies — no silent regression to the older one', () => {
  const s = 's-same'

  it('the higher generation in the same session wins', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('older durable'), generation: 7, sessionId: s, localSavedAt: 100 },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('newer keystroke'), savedAt: 101, generation: 9, sessionId: s },
    })
    expect(r.state.bodyJson).toEqual(doc('newer keystroke'))
    expect(r.ambiguous).toBe(false)
  })

  it('and it wins the OTHER way round too — this is not "always prefer localStorage"', () => {
    // ⭐ THE CONTROL. If the durable copy is genuinely newer (a draft cleared
    // late, a restore), the rule must follow the generation, not the store.
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('newer durable'), generation: 12, sessionId: s, localSavedAt: 100 },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('older keystroke'), savedAt: 101, generation: 4, sessionId: s },
    })
    expect(r.source).toBe('idb')
    expect(r.state.bodyJson).toEqual(doc('newer durable'))
  })

  it('same session with no usable generations falls back to the STRUCTURAL fact', () => {
    // The draft is written ahead of the durable copy by construction, so it is
    // the safe choice — and the reason says structural, not exact.
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('durable'), sessionId: s },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('keystroke'), sessionId: s },
    })
    expect(r.source).toBe('localStorage')
    expect(r.ambiguous).toBe(false)
    expect(r.reason).toMatch(/ahead of the durable copy/)
  })

  it('across DIFFERENT sessions it takes the newest timestamp and admits it is a hint', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('yesterday'), generation: 40, sessionId: 's-old', localSavedAt: 1000 },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('today'), savedAt: 5000, generation: 2, sessionId: 's-new' },
    })
    expect(r.state.bodyJson).toEqual(doc('today'))
    // ⛔ Generations from two different sessions are NOT comparable — 40 vs 2
    // must not decide this, and the answer is flagged so a surface can offer a
    // choice rather than assert one.
    expect(r.ambiguous).toBe(true)
  })

  it('two copies that cannot be ordered at all are reported as ambiguous', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('a'), sessionId: 's-1' },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('b'), sessionId: 's-2' },
    })
    expect(r.ambiguous).toBe(true)
    expect(r.unsynced).toBe(true)
  })

  it('agreeing copies are not dressed up as a decision', () => {
    const r = chooseLocalRecovery({
      server: SERVER,
      idbRecord: { title: 'Thesis', subtitle: '', bodyJson: doc('same'), sessionId: 's-1' },
      lsDraft: { title: 'Thesis', subtitle: '', bodyJson: doc('same'), sessionId: 's-2' },
    })
    expect(r.ambiguous).toBe(false)
    expect(r.state.bodyJson).toEqual(doc('same'))
  })
})

describe('the session id', () => {
  it('is produced even without a secure context', () => {
    // ⛔ `crypto.randomUUID` is secure-context only and this repo has been bitten
    // by that before. A session id must never be the thing that throws.
    const a = newSessionId()
    const b = newSessionId()
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(8)
    expect(a).not.toBe(b)
  })
})
