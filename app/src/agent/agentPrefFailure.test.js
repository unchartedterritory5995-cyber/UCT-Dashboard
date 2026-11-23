// ⛔ INV2 (item 5): a preference-writing kind whose write the server refused never says "nothing was left changed" unless a
// READ-BACK proves the old value is what this tab holds. usePreferences keeps the optimistic value on a refused write (the
// settle contract), so the read-back usually shows the change: the receipt then says it may show until a reload.
// Covers chart volume pane height, chart templates, settings, indicator templates and layout saveCurrent, through the
// real kinds and the real runtime tail (commitPlan.fail).
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { getTargetKind } from './capabilities'
import { commitPlan } from './runtime'
import { MAY_SHOW_UNTIL_RELOAD } from './prefFailure'

registerBuiltins()

// a member preference store with setPref's contract: `optimistic` → a refused write still lands in this tab's cache
function prefsHost({ initial = {}, refuse = () => true, optimistic = true } = {}) {
  const prefs = { ...initial }
  const h = {
    prefsStore: prefs,
    prefs: {
      read: () => prefs,
      write: async (k, v) => { if (optimistic || !refuse(k)) prefs[k] = v; return !refuse(k) },
      merge: async (k, fn) => { const next = fn(prefs[k] ? JSON.parse(prefs[k]) : []); if (next === undefined) return undefined; if (optimistic || !refuse(k)) prefs[k] = JSON.stringify(next); return refuse(k) ? { ok: false } : { ok: true } },
    },
  }
  return h
}
async function runKind(host, kindName, ref, patch) {
  const kind = getTargetKind(kindName)
  const snap = kind.read(host, ref)
  expect(snap, `${kindName} reads`).toBeTruthy()
  const plan = { plans: [{ kind: kindName, ref, changed: true, snap, patch, lines: ['x'], siblings: [] }] }
  return commitPlan(host, plan, {})
}
const NOTHING = /nothing was left changed/

beforeEach(() => {})

describe('INV2 preference kinds — "nothing was left changed" only on a read-back', () => {
  it('chart templates: a refused write that stays in the cache → "may keep showing it", never "nothing was left changed"', async () => {
    const h = prefsHost({ initial: { chart_templates: '[]' } })
    const res = await runKind(h, 'chartTemplates', 'chartTemplates', { write: [{ name: 'A', settings: {} }], prev: [] })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).not.toMatch(NOTHING)
    expect(res.failed[0].reason).toContain(MAY_SHOW_UNTIL_RELOAD)
  })
  it('chart templates: a refused write the cache did NOT keep (read-back = old list) → "nothing was left changed"', async () => {
    const h = prefsHost({ initial: { chart_templates: '[]' }, optimistic: false })
    const res = await runKind(h, 'chartTemplates', 'chartTemplates', { write: [{ name: 'A', settings: {} }], prev: [] })
    expect(res.failed[0].reason).toMatch(NOTHING)
  })
  it('settings: a refused write → "may keep showing it"; with the old value read back → "nothing was left changed"', async () => {
    const kind = getTargetKind('settings')
    const h = prefsHost()
    const key = Object.keys(kind.read(h, 'settings').values)[0]
    const from = kind.read(h, 'settings').values[key]
    const res = await runKind(h, 'settings', 'settings', { set: { [key]: `${from}-x` }, from: { [key]: from } })
    expect(res.failed[0].reason).not.toMatch(NOTHING)
    expect(res.failed[0].reason).toContain(MAY_SHOW_UNTIL_RELOAD)
    const h2 = prefsHost({ optimistic: false })
    const res2 = await runKind(h2, 'settings', 'settings', { set: { [key]: `${from}-x` }, from: { [key]: from } })
    expect(res2.failed[0].reason).toMatch(NOTHING)
  })
  it('indicator templates: a refused merge kept in the cache → "may keep showing it"', async () => {
    const h = prefsHost({ initial: { indicator_templates: '[]' } })
    h.charts = { list: () => [] }
    const kind = getTargetKind('indicatorTemplates')
    const put = { id: 't1', name: 'T', savedAt: 1, version: 1, instances: [] }
    let err = null
    try { await kind.commit(h, 'indicatorTemplates', { put }) } catch (e) { err = e }
    expect(err?.message).toMatch(/did not confirm/)
    expect(err.keptNote).toBe(MAY_SHOW_UNTIL_RELOAD)
    const h2 = prefsHost({ initial: { indicator_templates: '[]' }, optimistic: false })
    h2.charts = { list: () => [] }
    let err2 = null
    try { await kind.commit(h2, 'indicatorTemplates', { put }) } catch (e) { err2 = e }
    expect(err2?.message).toMatch(/did not confirm/)
    expect(err2.keptNote).toBeUndefined()
  })
  it('chart volume pane height: a refused write kept in the cache → "may keep showing it"', async () => {
    const kind = getTargetKind('chart')
    const h = prefsHost()
    h.charts = { read: () => ({ ref: 'c1', label: 'Left chart', cs: {}, stored: null, tf: 'D' }), commit: () => true }
    let err = null
    try { await kind.commit(h, 'c1', { volPanePref: '30' }) } catch (e) { err = e }
    expect(err?.message).toMatch(/did not confirm/)
    expect(err.keptNote).toBe(MAY_SHOW_UNTIL_RELOAD)
    const h2 = prefsHost({ optimistic: false })
    h2.charts = h.charts
    let err2 = null
    try { await kind.commit(h2, 'c1', { volPanePref: '30' }) } catch (e) { err2 = e }
    expect(err2?.message).toMatch(/did not confirm/)
    expect(err2.keptNote).toBeUndefined()
  })
  it('layout saveCurrent: board saved, named layout not → says the board was saved, never "nothing was left changed"', async () => {
    const kind = getTargetKind('layout') || getTargetKind('layouts')
    const L = {
      snapshot: () => ({ active: { id: 7, name: 'Mine' }, entries: [{ id: 7, name: 'Mine', kind: 'yours' }] }),
      saveCurrent: async () => ({ ok: false, named: 'failed' }),
    }
    let err = null
    try { await kind.commit({ layouts: L }, 'layouts', { saveCurrent: { id: 7 } }) } catch (e) { err = e }
    expect(err?.message).toMatch(/the board was saved but/)
    expect(err.keptNote).toMatch(/the board itself was saved/)
    L.saveCurrent = async () => ({ ok: true, named: 'failed' })
    let err2 = null
    try { await kind.commit({ layouts: L }, 'layouts', { saveCurrent: { id: 7 } }) } catch (e) { err2 = e }
    expect(err2.keptNote).toMatch(/the board itself was saved/)
  })
})
