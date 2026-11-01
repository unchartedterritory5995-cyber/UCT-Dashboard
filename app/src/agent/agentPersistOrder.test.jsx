// UCT Agent — an indicator change (or its Undo) is SAVED as committed, never one change behind (production,
// 2026-11-01 #548 Chrome acceptance). The workspace below copies ChartsWorkspace's own save mechanics exactly:
//   · the layout is React state; `layoutRef.current = layout` is set during RENDER (ChartsWorkspace.jsx:868)
//   · a chart's opts change is `setLayout(prev => { scheduleSave(next); return next })` (handleOptsChange),
//     scheduleSave = a 500ms debounced write of `next`
//   · persist() — the Agent's ACK — clears that timer and writes `layoutRef.current` NOW (ChartsWorkspace persist)
//   · the chart's agent.read is its render-time ref (ChartWidget agentRef); agent.commit is onOptsChange
// Before the fix the Agent called persist() before React re-rendered: it wrote the PREVIOUS layout and
// cancelled the autosave of the new one, so the server stayed a change behind and a reload lost it.
// Through the REAL panel (AgentPanel + useAgent, runtime, receipts, Undo) and the REAL Indicators interface.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, label } from './testing/panelHarness'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import AgentPanel from './AgentPanel'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const serialize = (layout) => JSON.stringify(layout.widgets)

/** The server's copy of the board: every accepted write in order; `fail` makes the next write refused. */
function makeServer(widgets) {
  return {
    doc: JSON.stringify(widgets), writes: [], fail: false,
    async write(text) {
      await Promise.resolve()                                   // a network hop
      if (this.fail) return false
      this.doc = text
      this.writes.push(text)
      return true
    },
    widgets() { return JSON.parse(this.doc) },
  }
}

function mountWorkspace(server, groupSyms) {
  const api = {}
  function Workspace() {
    const [layout, setLayout] = useState(() => ({ widgets: server.widgets() }))
    const layoutRef = useRef(layout)
    layoutRef.current = layout                                  // ChartsWorkspace: set during render
    const saveTimerRef = useRef(null)
    const scheduleSave = (next) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; server.write(serialize(next)) }, 500)
    }
    api.rendered = layout                                       // ChartWidget's agentRef: what the chart rendered
    api.onOptsChange = (id, opts) => setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => (w.id === id ? { ...w, opts } : w)) }
      scheduleSave(next)
      return next
    })
    api.persist = async () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      const ok = await server.write(serialize(layoutRef.current))
      return { ok, conflict: false, reason: ok ? null : 'not-saved' }
    }
    return null
  }
  const board = makeBoard(server.widgets(), groupSyms)
  const base = board.host.charts
  const widgetOf = (ref) => api.rendered.widgets.find(w => w.id === ref)
  const read = (ref) => {
    const s = base.read(ref)
    const w = widgetOf(ref)
    if (!s || !w) return null
    return label({ ...s, stored: w.opts?.settings ?? null, cs: mergeChartSettings(w.opts?.settings || null) })
  }
  const h = {
    ...board.host,
    charts: {
      ...base, read, list: () => base.list().map(s => read(s.ref)),
      commit: (ref, patch) => {
        const w = widgetOf(ref)
        if (!w) return false
        api.onOptsChange(ref, { ...(w.opts || {}), ...('settings' in patch ? { settings: patch.settings } : {}) })
        return true
      },
      canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null,
    },
    persist: () => api.persist(),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><Workspace /><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  const say = async (t) => {
    await p.idle()
    const before = transcript().length
    fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
    await p.idle()
    await new Promise(r => setTimeout(r, 0))
    await p.idle()
    // everything after the member's own line (timestamps re-render, so not by length alone)
    const all = transcript()
    const at = all.lastIndexOf(t)
    return at >= 0 ? all.slice(at + t.length) : all.slice(before)
  }
  return { api, say, transcript }
}

const settingsIn = (widgets, id = 'c') => widgets.find(w => w.id === id)?.opts?.settings ?? null
const savedSettings = (server) => JSON.stringify(settingsIn(server.widgets()))
const shownSettings = (api) => JSON.stringify(settingsIn(api.rendered.widgets))
const live = (settings) => (mergeChartSettings(settings ? JSON.stringify(settings) : null).indicatorInstances || []).filter(i => !i.deleted)
const savedInstances = (server) => live(settingsIn(server.widgets()))
const colourOf = (server, period) => savedInstances(server).find(i => i.inputs?.period === period)?.inputs?.color

describe('an Agent indicator change is saved as committed — never a change behind', () => {
  it('1–5 · add, colour, Undo colour, Undo add, again: after EVERY receipt the server holds exactly what the chart shows', async () => {
    const [widgets, syms] = ONE('SPY')
    const server = makeServer(widgets)
    const before = savedSettings(server)
    const { api, say } = mountWorkspace(server, syms)
    // 1 · add → the saved copy has it, the moment the receipt says so
    expect(await say('add the 9 ema')).toMatch(/Added EMA 9/)
    expect(savedInstances(server).map(i => i.inputs?.period)).toEqual([9])
    expect(savedSettings(server)).toBe(shownSettings(api))
    // 2 · colour → saved
    expect(await say('make it green')).toMatch(/colour/i)
    expect(colourOf(server, 9)).toBe('#2faf68')
    expect(savedSettings(server)).toBe(shownSettings(api))
    const added = JSON.parse(savedSettings(server))
    // 4 · Undo the colour → saved: the original colour back
    await say('undo')
    expect(colourOf(server, 9)).not.toBe('#2faf68')
    expect(savedSettings(server)).toBe(shownSettings(api))
    // 3 · Undo the add → saved: removed, the stored blob exactly as it was (Indicators #517 / #548)
    await say('undo')
    expect(savedInstances(server)).toEqual([])
    expect(savedSettings(server)).toBe(before)
    // 5 · and again, consecutively
    await say('add the 9 ema')
    await say('make it green')
    expect(JSON.parse(savedSettings(server))).toEqual(added)
    await say('undo')
    await say('undo')
    expect(savedSettings(server)).toBe(before)
    expect(savedSettings(server)).toBe(shownSettings(api))
    expect(p.turns()).toBe(0)
  }, 60000)

  it('6 · an Agent change, then the member\'s own chart change: both saved, the newer last', async () => {
    const [widgets, syms] = ONE('SPY')
    const server = makeServer(widgets)
    const { api, say } = mountWorkspace(server, syms)
    await say('add rsi')
    expect(savedInstances(server).map(i => i.defId)).toEqual(['rsi'])
    // the member turns on log scale by hand: the workspace's own debounced autosave
    const w = api.rendered.widgets[0]
    api.onOptsChange('c', { ...w.opts, settings: { ...w.opts.settings, logScale: true } })
    await waitFor(() => expect(settingsIn(server.widgets()).logScale).toBe(true), { timeout: 3000 })
    expect(savedInstances(server).map(i => i.defId)).toEqual(['rsi'])
    expect(savedSettings(server)).toBe(shownSettings(api))
  }, 30000)

  it('7 · the member edits while the Agent is mid-change: no older write lands after a newer one', async () => {
    const [widgets, syms] = ONE('SPY')
    const server = makeServer(widgets)
    const { api, say } = mountWorkspace(server, syms)
    const pending = say('add rsi')
    // the member's edit lands while the Agent's change is being written
    await waitFor(() => expect(live(settingsIn(api.rendered.widgets)).map(i => i.defId)).toEqual(['rsi']), { timeout: 5000 })
    const w = api.rendered.widgets[0]
    api.onOptsChange('c', { ...w.opts, settings: { ...w.opts.settings, logScale: true } })
    await pending
    await new Promise(r => setTimeout(r, 700))                  // past the workspace's own 500ms autosave
    const last = JSON.parse(server.writes.at(-1)).find(x => x.id === 'c').opts.settings
    expect(last.logScale).toBe(true)                            // the member's change is in the LAST write
    expect(live(last).map(i => i.defId)).toEqual(['rsi'])       // and so is the Agent's
    expect(savedSettings(server)).toBe(shownSettings(api))
  }, 30000)

  it('8 · reload after a completed change: the latest confirmed state is what loads', async () => {
    const [widgets, syms] = ONE('SPY')
    const server = makeServer(widgets)
    const first = mountWorkspace(server, syms)
    await first.say('add the 9 ema')
    await first.say('make it green')
    cleanup()                                                    // the page goes away — no unmount flush here
    p = setupPanel()
    const again = mountWorkspace(server, syms)
    expect(live(settingsIn(again.api.rendered.widgets)).map(i => [i.inputs?.period, i.inputs?.color])).toEqual([[9, '#2faf68']])
  }, 30000)

  it('a save the server refuses: the member is told it is not saved — never a success receipt', async () => {
    const [widgets, syms] = ONE('SPY')
    const server = makeServer(widgets)
    const { say } = mountWorkspace(server, syms)
    server.fail = true
    const out = await say('add rsi')
    expect(out).not.toMatch(/Added RSI/)
    expect(out).toMatch(/not (confirmed|saved)|not done/i)
  }, 30000)
})
