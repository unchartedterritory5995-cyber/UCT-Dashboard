// ⛔ INV2 SAFETY through the REAL AgentPanel (useAgent, the instant path, the model path's sequential follow-ups and Undo):
// P1 a single resize whose save is refused (409); P2 a multi-step plan whose middle step fails; R3 an earlier Undo after a
// failure. The host's `screen` is what the tab holds; `server` changes only when a persist is accepted. A 409 makes the
// conflict sticky for the tab (saveBlocked), as usePreferences + lib/workspaceConflict do.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { AuthContext } from '../context/AuthContext'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const CTX = { surface: 'charts' }
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
function board() {
  const screenS = { c1: {} }
  let server = clone(screenS)
  const read = (ref) => (ref in screenS ? { ref, label: 'Left chart (QQQ)', position: 'left', symbol: 'QQQ', tf: 'D', stored: screenS[ref], cs: load(screenS[ref]), linkedCount: 0 } : null)
  const b = { screen: screenS, get server() { return server }, answers: [], calls: 0, blocked: false, duringPersist: null }
  b.host = {
    charts: { list: () => Object.keys(screenS).map(read), read, commit: (ref, p) => { if ('settings' in p) screenS[ref] = clone(p.settings); return true }, canManageIndicators: () => true, canCreateIndicator: () => true },
    persist: async () => {
      b.calls++
      const a = b.answers.length ? b.answers.shift() : { ok: true }
      if (b.duringPersist) { const f = b.duringPersist; b.duringPersist = null; f(b) }
      if (a.slowMs) await new Promise(r => setTimeout(r, a.slowMs))
      if (a.conflict) b.blocked = true
      if (a.ok) server = clone(screenS)
      return a
    },
    saveBlocked: () => b.blocked,
    widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
  }
  return b
}
const CONFLICT = { ok: false, conflict: true, reason: 'conflict' }
async function addRsi(b) {
  const ops = [{ action: 'indicator.add', target: 'ixe:c1', args: { defId: 'rsi', inputs: null } }]
  buildContext(b.host, CTX); const env = await prepareOps(ops)
  const p = planOps(collectTargets(b.host, ['indicatorEdits']), ops, env, CTX)
  expect((await commitPlan(b.host, p, { env, ctx: CTX })).ok).toBe(true)
}
const rsiOf = (cs) => (cs?.indicatorInstances || []).find(i => i.defId === 'rsi')
const view = (cs) => ({ sizes: cs?.paneSizes ?? null, order: cs?.paneOrder ?? null, rsiColor: rsiOf(cs)?.inputs?.color ?? rsiOf(cs)?.style?.color ?? null })
let script
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
beforeEach(() => {
  setOwnedDefinitionSource(() => []); _resetProposedPlans()
  script = () => answer({ reply: 'ok' })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') return json(await script(JSON.parse(init.body)))
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json({ stream: false })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount(b) {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}><AgentPanel host={b.host} onClose={() => {}} /></AuthContext.Provider></SWRConfig>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
    await new Promise(r => setTimeout(r, 300))
  }
  return { say, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
const plan3 = (body) => {
  const ref = (body.context.indicatorEdits || [])[0]?.ref
  return answer({ disposition: 'apply', ops: [
    { action: 'pane.move', target: ref, args: { pane: 'rsi', to: 'top', relativeTo: null } },
    { action: 'pane.resize', target: ref, args: { pane: 'rsi', size: 40 } },
    { action: 'indicatorStyle.set', target: ref, args: { instance: 'rsi', property: 'color', value: 'orange', output: null } },
  ] })
}

describe('INV2 panel', () => {
  it('P1: instant "make the rsi pane bigger", save refused (409) → put back and said so; no Undo; the next edit is refused up front', async () => {
    const b = board(); await addRsi(b)
    const before = JSON.stringify(b.screen.c1)
    b.answers = [CONFLICT]
    const { say, transcript } = mount(b)
    await say('make the rsi pane bigger')
    expect(JSON.stringify(b.screen.c1)).toBe(before)
    expect(JSON.stringify(b.server.c1)).toBe(before)
    const t = transcript()
    expect(t).toMatch(/I didn’t change Left chart \(QQQ\): the save didn’t go through \(your workspace was changed in another window or device\), so I put the chart back\. Nothing was changed\./)
    expect(t).not.toMatch(/could not be reversed/)
    expect(document.querySelectorAll('[data-undoable]')).toHaveLength(0)
    await say('undo')
    expect(transcript()).toMatch(/nothing of mine to undo/)
    const calls = b.calls
    await say('make the rsi pane bigger')
    expect(b.calls).toBe(calls)                                          // sticky: refused before any write
    expect(JSON.stringify(b.screen.c1)).toBe(before)
    expect(transcript()).toMatch(/can’t be saved until you reload this page\. Nothing was changed\./)
  })

  it('P2: move (saves) + resize (409) + recolor → the resize is put back and the loop STOPS; the recolor never runs', async () => {
    const b = board(); await addRsi(b)
    const color0 = view(b.screen.c1).rsiColor
    const calls0 = b.calls
    b.answers = [{ ok: true }, CONFLICT]
    const { say, transcript } = mount(b)
    script = plan3
    await say('move the rsi to the top, make it 40 percent and orange')
    await new Promise(r => setTimeout(r, 800))
    const v = view(b.screen.c1)
    expect(v.order).not.toBe(null)                                       // step 1 saved and on screen
    expect(v.sizes?.['inst:rsi:1'] ?? null).toBe(null)                   // step 2 put back
    expect(v.rsiColor).toBe(color0)                                      // step 3 never ran
    expect(JSON.stringify(b.server.c1)).toBe(JSON.stringify(b.screen.c1))
    expect(b.calls).toBe(calls0 + 2)                                     // the move and the resize; never the recolor
    const t = transcript()
    expect(t).toMatch(/so I put the chart back\. Nothing was changed\./)
    expect(t).toMatch(/I stopped there, so I didn’t start the next step of your request\./)
    expect(t).not.toMatch(/could not be reversed/)
  })

  it('P2b: the middle step stays ON SCREEN unsaved (the member edited during a slow save) → never "didn\'t do"; the loop stops', async () => {
    const b = board(); await addRsi(b)
    const color0 = view(b.screen.c1).rsiColor
    b.answers = [{ ok: true }, { ...CONFLICT, slowMs: 60 }]
    const { say, transcript } = mount(b)
    script = plan3
    let n = 0
    const orig = b.host.persist
    b.host.persist = async () => { n++; if (n === 2) b.duringPersist = (bb) => { bb.screen.c1 = { ...bb.screen.c1, memberEdit: 1 } }; return orig() }
    await say('move the rsi to the top, make it 40 percent and orange')
    await new Promise(r => setTimeout(r, 800))
    expect(b.screen.c1.memberEdit).toBe(1)
    expect(view(b.screen.c1).rsiColor).toBe(color0)
    const t = transcript()
    expect(t).toMatch(/The change above went through\. That change to Left chart \(QQQ\) is on this screen but NOT saved/)
    expect(t).not.toMatch(/didn’t do the next part: That change/)
    expect(t).toMatch(/I stopped there, so I didn’t start the next step of your request\./)
  })

  it('R3: an earlier saved change, then a failed one (one 409, put back) → "undo" takes back the earlier change', async () => {
    const b = board(); await addRsi(b)
    const base = JSON.stringify(b.screen.c1)
    const { say, transcript } = mount(b)
    script = (body) => answer({ disposition: 'apply', ops: [{ action: 'pane.resize', target: (body.context.indicatorEdits || [])[0]?.ref, args: { pane: 'rsi', size: 40 } }] })
    await say('make the rsi pane 40 percent')
    expect(b.screen.c1.paneSizes?.['inst:rsi:1']).toBe(0.4)
    b.answers = [{ ok: false, conflict: false, reason: 'not-saved' }]
    script = (body) => answer({ disposition: 'apply', ops: [{ action: 'pane.move', target: (body.context.indicatorEdits || [])[0]?.ref, args: { pane: 'rsi', to: 'top', relativeTo: null } }] })
    await say('move the rsi pane to the top')
    expect(transcript()).toMatch(/so I put the chart back\. Nothing was changed\./)
    await say('undo')
    expect(transcript()).not.toMatch(/can no longer be undone exactly/)
    expect(JSON.stringify(b.screen.c1)).toBe(base)
    expect(JSON.stringify(b.server.c1)).toBe(base)
  })
})
