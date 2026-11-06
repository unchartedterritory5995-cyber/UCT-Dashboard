// Selection run 11-06: a Multi Chart change reported "did not take effect" and was taken back although it had landed, once in a
// while (three cells written in a row). The runtime read a target back one frame after its write; a target whose own re-render
// comes later was called lost. It now reads back until the write shows, bounded, and a write that never shows still fails.
import { describe, it, expect, beforeEach } from 'vitest'
import { commitPlan, LANDED_WAIT_MS } from './runtime'
import { registerTargetKind, registerCapability } from './capabilities'

// a target kind whose write shows only after `lag` reads (a re-render that comes later), or never
const H = { state: {}, reads: {}, lag: {} }
registerTargetKind({
  name: 'lagged',
  list: () => Object.keys(H.state).map(ref => ({ ref, label: `Lagged ${ref}`, v: H.state[ref].shown })),
  read: (host, ref) => {
    const s = H.state[ref]
    if (!s) return null
    H.reads[ref] = (H.reads[ref] || 0) + 1
    if (s.pending != null && H.reads[ref] > (H.lag[ref] ?? 0)) { s.shown = s.pending; s.pending = null }
    return { ref, label: `Lagged ${ref}`, v: s.shown }
  },
  stateOf: (snap) => ({ v: snap.v }),
  patch: (b, a) => (b.v === a.v ? null : { v: a.v }),
  commit: (host, ref, patch) => { if (H.commitFails) return false; H.reads[ref] = 0; H.state[ref].pending = patch.v; return true },
  landed: (snap, patch) => !!snap && snap.v === patch.v,
  undoPatch: (it) => ({ v: it.before.v }),
  fingerprint: (snap) => String(snap?.v),
})
registerCapability({ name: 'lagged.set', target: 'lagged', risk: 'local', reversible: true, summary: 'set', args: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'], additionalProperties: false },
  check: () => null, apply: (st, { v }) => ({ ...st, v }), describe: (b, a) => `Set to ${a.v}` })

const host = {}
const planOf = (refs) => ({ ok: true, changed: true, lines: [], noops: [], plans: refs.map(ref => ({ ref, kind: 'lagged', snap: { ref, label: `Lagged ${ref}`, v: 0 }, before: { v: 0 }, after: { v: 7 }, patch: { v: 7 }, items: [], lines: [`Set ${ref}`], changed: true, virtual: false, siblings: refs.length })) })
beforeEach(() => { H.state = { a: { shown: 0 }, b: { shown: 0 }, c: { shown: 0 } }; H.reads = {}; H.lag = {} })

describe('a write is read back until it shows', () => {
  it('three targets, the last one a few reads behind: every one landed, nothing taken back', async () => {
    H.lag = { a: 0, b: 1, c: 4 }
    const res = await commitPlan(host, planOf(['a', 'b', 'c']), { env: {} })
    expect(res.ok).toBe(true)
    expect(Object.values(H.state).map(s => s.shown)).toEqual([7, 7, 7])
  })
  it('NEGATIVE: a write its kind refused is not waited for', async () => {
    H.lag = { a: 0 }
    const real = H.commitFails
    H.commitFails = true
    const t0 = Date.now()
    const res = await commitPlan(host, planOf(['a']), { env: {} })
    H.commitFails = real
    expect(res.ok).toBe(false)
    expect(Date.now() - t0).toBeLessThan(LANDED_WAIT_MS)
  })
  it('NEGATIVE: a write that never shows still fails, after the bound, and is taken back', async () => {
    H.lag = { a: 0, b: Infinity }
    const t0 = Date.now()
    const res = await commitPlan(host, planOf(['a', 'b']), { env: {} })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/did not take effect/)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(LANDED_WAIT_MS)
    expect(H.state.a.shown).toBe(0)
  }, 10000)
})
