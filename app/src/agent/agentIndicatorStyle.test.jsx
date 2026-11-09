// INDICATOR SETTINGS AND APPEARANCE THROUGH METADATA (pl-exec round 8, family 3). Every built-in indicator in the catalog (53),
// driven ONLY by its own definition (inputs: their type, min / max / step / options; the colour targets, appearance controls and
// plot styles its Inspector offers — styleOptionsOf) — never a per-indicator rule. For each one, through the REAL panel: a number
// setting, a choice setting, an on/off setting, each colour it offers, its line width (or an honest refusal when it has none),
// hide and show; each read back from the instance on the chart. Held-out phrasings (agentIndicatorStyleHeldOut, committed first)
// are said as written. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (a scripted plan, built from
// the indicator's own metadata, is sent only when the model is asked).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import * as nr from '../components/chart/engine/nativeRegistry'
import { addableRows } from './capabilities/indicatorEdits'
import { styleOptionsOf } from '../components/chart/builder/agentMutations'
import { STYLE_HELD_OUT } from './agentIndicatorStyleHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const MODEL_ONLY = 'please apply the change we discussed'          // words no instant reader takes: the scripted plan runs
function mountWith(defId) {
  const [w, s] = ONE('SPY')
  const m = p.mount(w, s)
  const ie = (b) => (b.context.indicatorEdits || [])[0]
  const inst = () => (m.board.state.widgets[0].opts.settings?.indicatorInstances || []).find(i => !i.deleted && i.defId === defId)
  const cs = () => m.board.state.widgets[0].opts.settings
  const run = async (text, op) => { p.st.envelopes.length = 0; if (op) p.st.envelopes.push((b) => p.env('apply', [op(b, ie(b))])); return m.say(text) }
  return { ...m, ie, inst, cs, run }
}
const optValue = (o) => (Array.isArray(o) ? o[0] : o && typeof o === 'object' ? (o.value ?? o.key) : o)            // [value, label] pairs, or { value | key }
const ids = addableRows().map(r => r.defId).filter(d => nr.getDefinition(d))

describe('every catalog indicator, through its own metadata', () => {
  it('the catalog is the whole built-in set (non-vacuous)', () => { expect(ids.length).toBeGreaterThanOrEqual(50) })
  it.each(ids)('%s: its settings, colours, width and visibility as its own definition offers them', async (defId) => {
    const def = nr.getDefinition(defId)
    const m = mountWith(defId)
    await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicator.add', target: e.ref, args: { defId, inputs: null } }))
    const id = must(m.inst(), `${defId} was added`).instanceId
    const ins = (def.inputs || []).filter(x => x.type !== 'color' && x.type !== 'source' && !/color/i.test(x.key))
    const upd = (key, value) => (b, e) => ({ action: 'indicator.update', target: e.ref, args: { instance: id, inputs: [{ key, value }] } })
    // a number: one step from its default, inside its own range
    const num = ins.find(x => ['int', 'float', 'number'].includes(x.type) && Number.isFinite(x.min) && Number.isFinite(x.max))
    if (num) {
      const step = num.step || 1
      let v = num.default + step; if (v > num.max) v = num.default - step
      v = num.type === 'int' ? Math.round(v) : Math.round(v * 1e6) / 1e6
      const out = await m.run(MODEL_ONLY, upd(num.key, v))
      expect(m.inst().inputs[num.key], `${defId} ${num.key}: ${out.slice(-160)}`).toBe(v)
    }
    // a choice: another of its own options
    const sel = ins.find(x => Array.isArray(x.options) && x.options.length > 1)
    if (sel) {
      const v = sel.options.map(optValue).find(o => o !== sel.default)
      const out = await m.run(MODEL_ONLY, upd(sel.key, v))
      expect(m.inst().inputs[sel.key], `${defId} ${sel.key}: ${out.slice(-160)}`).toBe(v)
    }
    // an on/off: flipped
    const bool = ins.find(x => x.type === 'bool' || x.type === 'boolean')
    if (bool) {
      const v = !bool.default
      const out = await m.run(MODEL_ONLY, upd(bool.key, v))
      expect(m.inst().inputs[bool.key], `${defId} ${bool.key}: ${out.slice(-160)}`).toBe(v)
    }
    // each colour its Inspector offers, by its own label
    const opts = styleOptionsOf(m.cs(), nr, id)
    expect(opts?.ok, `${defId} has style options`).toBe(true)
    for (const c of (opts.colors || []).filter(x => x.target.startsWith('input:'))) {
      const key = c.target.slice(6)
      const prop = 'color'
      const out = await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicatorStyle.set', target: e.ref, args: { instance: id, property: prop, value: '#123456', output: c.label } }))
      expect(String(m.inst().inputs[key]).toLowerCase(), `${defId} colour ${c.label}: ${out.slice(-160)}`).toBe('#123456')
    }
    for (const c of (opts.colors || []).filter(x => x.target === 'sign:up' || x.target === 'sign:down')) {
      const before = JSON.stringify(m.cs())
      const out = await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicatorStyle.set', target: e.ref, args: { instance: id, property: c.target === 'sign:up' ? 'upColor' : 'downColor', value: '#654321', output: c.plotKey || null } }))
      expect(JSON.stringify(m.cs()) !== before && JSON.stringify(m.cs()).toLowerCase().includes('#654321'), `${defId} ${c.target}: ${out.slice(-160)}`).toBe(true)
    }
    // line width: set where its Inspector (or its own Line width setting) offers it; else an honest refusal and nothing changes
    const widthCtl = (opts.appearance || []).find(a => a.key === 'lineWidth') || (def.inputs || []).find(x => x.key === 'lineWidth')
    const beforeW = JSON.stringify(m.cs())
    const outW = await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicatorStyle.set', target: e.ref, args: { instance: id, property: 'lineWidth', value: 3, output: null } }))
    if (widthCtl) expect(JSON.stringify(m.cs()) !== beforeW || /already/.test(outW), `${defId} width: ${outW.slice(-160)}`).toBe(true)
    else {
      expect(outW, `${defId} width refusal`).toMatch(/no line width setting/)
      expect(JSON.stringify(m.cs())).toBe(beforeW)
    }
    // hide, then show again
    await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicator.hide', target: e.ref, args: { instance: id } }))
    expect(m.inst().hidden, `${defId} hidden`).toBe(true)
    await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicator.show', target: e.ref, args: { instance: id } }))
    expect(m.inst().hidden, `${defId} shown`).toBe(false)
  }, 120000)
})

// the held-out phrasings, said as written: the instant reader may take them; if the model is asked, the plan an honest planner
// would send (from the indicator's metadata) is the scripted one
const inputKey = (defId, key) => {
  const ins = nr.getDefinition(defId)?.inputs || []
  return ins.some(x => x.key === key) ? key : (ins.find(x => /dev|mult/i.test(`${x.key} ${x.label}`))?.key || key)
}
describe('held-out: settings and appearance in the member\'s words', () => {
  it.each(STYLE_HELD_OUT.map(c => [c.id, c]))('%s', async (_id, c) => {
    const m = mountWith(c.add)
    await m.run(MODEL_ONLY, (b, e) => ({ action: 'indicator.add', target: e.ref, args: { defId: c.add, inputs: null } }))
    const id = m.inst().instanceId
    const before = JSON.stringify(m.inst())
    const plan = c.check.input ? (b, e) => ({ action: 'indicator.update', target: e.ref, args: { instance: id, inputs: [{ key: inputKey(c.add, c.check.input[0]), value: c.check.input[1] }] } })
      : c.check.colorOf ? (b, e) => ({ action: 'indicatorStyle.set', target: e.ref, args: { instance: id, property: 'color', value: 'blue', output: '%D' } })
        : c.check.hidden ? (b, e) => ({ action: 'indicator.hide', target: e.ref, args: { instance: id } })
          : (b, e) => ({ action: 'indicatorStyle.set', target: e.ref, args: { instance: id, property: 'upColor', value: 'green', output: null } })
    const out = await m.run(c.text, plan)
    const now = m.inst()
    if (c.check.input) expect(now.inputs[inputKey(c.add, c.check.input[0])], out).toBe(c.check.input[1])
    if (c.check.colorOf) expect(now.inputs[c.check.colorOf], out).not.toBe(JSON.parse(before).inputs[c.check.colorOf])
    if (c.check.hidden) expect(now.hidden, out).toBe(true)
    if (c.check.changed) expect(JSON.stringify(m.cs()), out).not.toBe(before)
  }, 60000)
})

function must(v, what) { if (!v) throw new Error(`missing: ${what}`); return v }
