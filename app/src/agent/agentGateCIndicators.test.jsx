// UCT Agent — GATE C: context-aware indicator editing through the REAL panel and the REAL Indicators interface
// (agentMutations `setInputs`, drafted for Indicators' review). "Add a 20 EMA" → "make it a 9" → "change that to an
// SMA" → Undo → the stale case. No model: every turn is answered by UCT. AGENT_TRANSCRIPT_OUT writes transcripts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { AuthContext } from '../context/AuthContext'
import { registerBuiltins } from './builtins'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns
beforeEach(() => {
  turns = []
  setOwnedDefinitionSource(() => []); _resetProposedPlans()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(JSON.parse(init.body)); return json({ detail: 'no model in this test' }, 503) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (url === '/api/agent/config') return json({ stream: false })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
function makeHost() {
  const store = { c1: {} }                                    // a default chart: EMA 9, EMA 20, SMA 50, SMA 200 (ovl:*)
  const read = (ref) => (ref in store ? { ref, label: 'Chart (QQQ)', position: null, symbol: 'QQQ', tf: 'D', stored: store[ref], cs: load(store[ref]), linkedCount: 0 } : null)
  return {
    store,
    charts: {
      list: () => Object.keys(store).map(read), read,
      commit: (ref, patch) => { store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true, canCreateIndicator: () => true, openCreateIndicator: () => ({ ok: true }),
    },
    persist: async () => ({ ok: true }),
    otherWidgets: () => [],
  }
}
const mas = (h) => (load(h.store.c1).indicatorInstances || []).filter(i => i && !i.deleted && i.defId === 'movingAverage')
// the averages the CONVERSATION added (the chart's own defaults are ovl:*)
const live = (h) => mas(h).filter(i => !String(i.instanceId).startsWith('ovl:'))
const ovl = (h, id) => mas(h).find(i => i.instanceId === id)

function mount(h, name) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
        <AgentPanel host={h} onClose={() => {}} />
      </AuthContext.Provider>
    </SWRConfig>,
  )
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  const save = () => {
    const dir = globalThis.process?.env?.AGENT_TRANSCRIPT_OUT
    if (!dir) return
    const items = [...screen.getByTestId('agent-transcript').children].map(el => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.txt`), items.join('\n'))
  }
  return { say, transcript, save }
}

describe('Gate C — "make it a 9": the SAME indicator changes, exactly undone', () => {
  it('add a 20 EMA → make it a 9 → change that to an SMA → undo → undo', async () => {
    const h = makeHost()
    const { say, transcript, save } = mount(h, 'conversation-5-indicator-edit')
    await say('add a 20 ema')
    await waitFor(() => expect(live(h)).toHaveLength(1))
    const id = live(h)[0].instanceId
    expect(live(h)[0].inputs).toMatchObject({ period: 20, maType: 'ema' })
    await say('make it a 9')
    await waitFor(() => expect(live(h)[0].inputs.period).toBe(9))
    expect(live(h)).toHaveLength(1)                                     // edited in place — no second copy
    expect(live(h)[0].instanceId).toBe(id)
    expect(live(h)[0].inputs.maType).toBe('ema')                       // the type it had is kept
    await waitFor(() => expect(transcript()).toMatch(/period 20 → 9/))
    await say('change that to an sma')
    await waitFor(() => expect(live(h)[0].inputs.maType).toBe('sma'))
    expect(live(h)[0].inputs.period).toBe(9)
    await say('undo')
    await waitFor(() => expect(live(h)[0].inputs.maType).toBe('ema'))
    expect(live(h)[0].inputs.period).toBe(9)                            // undo took back ONLY the last edit
    await say('undo')
    await waitFor(() => expect(live(h)[0].inputs.period).toBe(20))
    expect(live(h)[0].instanceId).toBe(id)
    expect(turns).toHaveLength(0)
    save()
  }, 60000)

  it('"change the 20 to a 50" names the one average whose legend shows 20; a second 20 makes it ASK; "already" is said', async () => {
    const h = makeHost()
    const { say, transcript, save } = mount(h, 'conversation-6-named-edit')
    await say('change the 20 to a 50')
    await waitFor(() => expect(ovl(h, 'ovl:1').inputs.period).toBe(50))  // the chart's EMA 20 — the only "20"
    expect(mas(h)).toHaveLength(4)
    await say('make it a 50')
    await waitFor(() => expect(transcript()).toMatch(/Nothing to change — it already has those settings./))
    await say('add a 21 ema')
    await waitFor(() => expect(live(h)).toHaveLength(1))
    await say('add a 21 sma')
    await waitFor(() => expect(live(h)).toHaveLength(2))
    await say('change the 21 to a 10')                                   // two "21"s on the chart → never guessed
    await waitFor(() => expect(transcript()).toMatch(/More than one indicator/))
    expect(live(h).map(i => i.inputs.period)).toEqual([21, 21])
    save()
  }, 60000)

  it('stale: after the indicator is removed by hand, "make it a 9" changes nothing and says so', async () => {
    const h = makeHost()
    const { say, transcript, save } = mount(h, 'conversation-7-stale-indicator')
    await say('add a 20 ema')
    await waitFor(() => expect(live(h)).toHaveLength(1))
    h.store.c1 = {}                                                      // the member deleted it from the legend
    await say('make it a 9')
    await waitFor(() => expect(transcript()).toMatch(/isn't on that chart any more/))
    expect(live(h)).toHaveLength(0)                                      // nothing re-created, nothing guessed
    save()
  }, 60000)

  it('the owner\'s MA defaults: "add the 9" → EMA 9; "add the 50" → SMA 50; an unlisted length is not guessed', async () => {
    const h = makeHost()
    const { say, save } = mount(h, 'conversation-8-ma-defaults')
    await say('add the 9')
    await waitFor(() => expect(live(h).map(i => [i.inputs.period, i.inputs.maType])).toEqual([[9, 'ema']]))
    await say('add the 50')
    await waitFor(() => expect(live(h).map(i => [i.inputs.period, i.inputs.maType])).toEqual([[9, 'ema'], [50, 'sma']]))
    await say('add the 30')
    await waitFor(() => expect(turns.length).toBe(1))                    // no documented default → the model path asks
    expect(live(h)).toHaveLength(2)
    save()
  }, 60000)
})
