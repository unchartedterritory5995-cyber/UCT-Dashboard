/**
 * studyRsOverlay under `VITE_RS_SPLIT_ENABLED=1` (UCT RS split, U8). `studyRsOverlay.test.js`
 * pins the overlay against today's UCT Relative Strength (the suite default, flag OFF); this
 * file pins it against the slim UCT RS Line through a fresh module graph (the env stubbed,
 * `vi.resetModules()`, dynamic imports: the `rsSplitFlagOn.test.jsx` pattern). The two must
 * stay separate files: `nativeRegistry` reads the flag once at module load.
 *
 * What must hold whichever definition is registered: every one of the bank's RS drills gets
 * its line(s) with no request, the slot key is what the binder asks for, the inputs validate
 * on the registered definition, and no preset is read anywhere under pages/study.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BANK = JSON.parse(readFileSync(resolve(here, '../../../../docs/study/bank/rs.drills.json'), 'utf8'))
const REG = '../../components/chart/engine/nativeRegistry'

/** The member-facing shape: what GET /api/study/today serves (no sym, no reveal) with the bars inline. */
function served(raw) {
  return { id: raw.id, version: 1, type: raw.type, skill_id: raw.skill_id, prompt_json: raw.prompt_json,
    ...(raw.bars_embed ? { bars: { tf: 'D', bars: raw.bars_embed.bars } } : {}) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const finite = (col) => Array.from(col).filter(Number.isFinite).length
const nonNull = (col) => col.filter((v) => v != null).length
const tap = BANK.find((i) => i.type === 'tap' && i.reveal_json?.rs)
const pair = BANK.find((i) => i.prompt_json?.chart?.rs_pair)
const redDay = BANK.find((i) => i.prompt_json?.chart?.mark && i.reveal_json?.rs?.columns?.dotNH?.some((v) => v != null))

let m, fetchSpy
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_RS_SPLIT_ENABLED', '1')
  const [reg, sc, inst, readout, session, overlay] = await Promise.all([
    import(REG), import('../../components/chart/engine/serverCompute'), import('../../components/chart/engine/instances'),
    import('../../components/chart/engine/readout'), import('./useStudySession'), import('./studyRsOverlay'),
  ])
  m = { reg, sc, inst, readout, session, overlay }
  m.sc.clearServerColumns()
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in a drill')))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

const barsOf = (raw) => m.session.normalizeBars(raw.bars_embed.bars)
const draw = (inst, sym, bars) => m.reg.computeFor(m.reg.getDefinition(m.overlay.RS_DEF_ID), bars, inst.inputs, { sym, tf: 'D' })

/** The labels as the chart renders them (the same pipeline `studyRsOverlay.test.js` drives). */
function renderedLabels(insts) {
  const def = m.reg.getDefinition(m.overlay.RS_DEF_ID)
  const seriesData = new Map()
  const bindings = insts.map((i, n) => {
    const series = { id: i.instanceId }
    seriesData.set(series, { value: 0.2 + n / 10, time: '2020-01-02' })
    return { defId: m.overlay.RS_DEF_ID, plotKey: 'rsLine', series, lastValue: 0.2 + n / 10, instanceId: i.instanceId }
  })
  const chips = m.readout.legendChips(bindings, seriesData, { getDefinition: m.reg.getDefinition }, insts, { scalarsOf: () => null })
    .filter((c) => c.plotKey === 'rsLine')
  return chips.map((c) => ({ chip: c.label, pane: m.readout.paneReadoutLabel(c, def), short: m.readout.readoutChipName(c, def) }))
}

describe('the slim UCT RS Line is what the overlay draws with', () => {
  it('the registered rsLine is the slim definition: no presets, mansfieldLength legacy and still a server input', () => {
    expect(m.reg.rsSplitEnabled()).toBe(true)
    const def = m.overlay.rsDefinition()
    expect(def.meta.name).toBe('UCT RS Line')
    expect(def.meta.presets).toBeUndefined()
    // the slot key: declared (so F20 keeps the instance), rendered by nothing, sent (so two lines key apart)
    expect(def.inputs.find((i) => i.key === 'mansfieldLength')).toMatchObject({ legacy: true, default: 200 })
    expect(def.meta.serverInputs).toContain('mansfieldLength')
    expect(m.overlay.rsRev()).toBe(def.compute.rev)
  })

  it('the inputs are the registry object plus Show average, and every instance validates on the slim definition', () => {
    expect(m.overlay.classicInputs()).toEqual({ ...m.reg.RS_CLASSIC_INPUTS, showAverage: true })
    for (const raw of [tap, pair, redDay]) {
      const it0 = served(raw)
      for (const inst of m.overlay.rsInstances(m.overlay.primeRsColumns(it0, it0.id, 'D'))) {
        if (inst.deleted) continue
        expect(m.inst.validateInstance(inst, { getDefinition: m.reg.getDefinition }).errors || []).toEqual([])
      }
    }
  })

  it('every RS drill in the bank primes every line it carries, prompt and reveal, with no request', async () => {
    let lines = 0
    for (const raw of BANK) {
      const it0 = served(raw)
      const isPair = !!raw.prompt_json?.chart?.rs_pair
      const isLine = !!raw.prompt_json?.chart?.rs
      const prompt = m.overlay.primeRsColumns(it0, it0.id, 'D')
      expect(prompt.length, raw.id).toBe(isPair ? 2 : isLine ? 1 : 0)
      lines += prompt.length
      if (!isPair && !isLine) continue
      const reveal = isPair ? { rs_pair: raw.reveal_json.rs_pair } : { rs: raw.reveal_json.rs }
      const after = m.overlay.primeRsColumns(it0, it0.id, 'D', { reveal, revealed: true })
      expect(after.length, raw.id).toBe(isPair ? 2 : 1)
      expect(after.every((p) => p.reveal), raw.id).toBe(true)
      lines += after.length
      // the primed key is the one the binder computes: a draw finds the entry and asks the network for nothing
      for (const inst of m.overlay.rsInstances([...prompt, ...after]).filter((i) => !i.deleted)) {
        expect(finite(draw(inst, it0.id, barsOf(raw)).rsLine), `${raw.id} ${inst.instanceId}`).toBe(120)
      }
    }
    expect(BANK).toHaveLength(40)
    expect(lines).toBe(12 * 2 + 10 * 4 + 10 * 2)             // tap 1+1, leader 2+2, red day 1+1
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the slot key is stable: slot 0 sends the default, slots past it differ, and four lines take four keys', () => {
    const def = m.overlay.rsDefinition()
    expect(m.overlay.slotInputs(0)).toEqual(m.overlay.classicInputs())
    expect(m.overlay.keyInputs(m.overlay.slotInputs(0)).mansfieldLength).toBe(200)
    for (const n of [1, 2, 3]) expect(m.overlay.keyInputs(m.overlay.slotInputs(n)).mansfieldLength).toBe(200 + n)
    expect(m.overlay.keyInputs(m.overlay.classicInputs()))
      .toEqual(m.sc.pickServerInputs(def, m.reg.resolveInputs(def, m.overlay.classicInputs())))
    const it0 = served(pair)
    const prompt = m.overlay.primeRsColumns(it0, it0.id, 'D')
    const after = m.overlay.primeRsColumns(it0, it0.id, 'D', { reveal: { rs_pair: pair.reveal_json.rs_pair }, revealed: true })
    expect(new Set([...prompt, ...after].map((p) => p.key)).size).toBe(4)
    expect(after.map((p) => p.instanceId)).toEqual([m.overlay.rsPairInstanceId('A', true), m.overlay.rsPairInstanceId('B', true)])
  })

  it('the 21 EMA column draws (Show average holds on the slim definition) and the reveal dots land', async () => {
    const it0 = served(tap)
    const [inst] = m.overlay.rsInstances(m.overlay.primeRsColumns(it0, it0.id, 'D'))
    const cols = draw(inst, it0.id, barsOf(tap))
    expect(finite(cols.rsMa)).toBe(120)
    expect(finite(cols.dotNH) + finite(cols.dotNHbeforePx)).toBe(0)
    const after = m.overlay.primeRsColumns(it0, it0.id, 'D', { reveal: { rs: tap.reveal_json.rs }, revealed: true })
    const live = m.overlay.rsInstances(after).find((i) => !i.deleted)
    const bars = [...barsOf(tap), ...m.session.normalizeBars(tap.bars_embed.forward)]
    const got = draw(live, it0.id, bars)
    expect(finite(got.dotNH)).toBe(nonNull(tap.reveal_json.rs.columns.dotNH))
    expect(got.dotNH[tap.answer_json.bar_index]).toBeGreaterThan(0)
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the labels read UCT RS Line · SPY, the leader lines by name, never the stock or the slot input', () => {
    const one = served(redDay)
    expect(renderedLabels(m.overlay.rsInstances(m.overlay.primeRsColumns(one, one.id, 'D'))))
      .toEqual([{ chip: 'UCT RS(SPY)', pane: 'UCT RS Line · SPY', short: 'UCT RS · SPY' }])
    const two = served(pair)
    const labels = renderedLabels(m.overlay.rsInstances(m.overlay.primeRsColumns(two, two.id, 'D')))
    expect(labels).toEqual([
      { chip: 'UCT RS(SPY) · Line A', pane: 'UCT RS Line · SPY · Line A', short: 'UCT RS · SPY · Line A' },
      { chip: 'UCT RS(SPY) · Line B', pane: 'UCT RS Line · SPY · Line B', short: 'UCT RS · SPY · Line B' },
    ])
    for (const l of labels) expect(JSON.stringify(l)).not.toContain('mansfieldLength')
    for (const l of labels) for (const n of Object.values(pair.reveal_json.example.names)) expect(JSON.stringify(l)).not.toContain(n)
  })

  it('refuses as before: a disagreeing wire, a malformed wire, a non-daily chart', () => {
    const it0 = served(redDay)
    const rs = it0.prompt_json.chart.rs
    const chart = (patch) => ({ ...it0, prompt_json: { ...it0.prompt_json, chart: { ...it0.prompt_json.chart, rs: { ...rs, ...patch } } } })
    expect(m.overlay.primeRsColumns(chart({ inputs: { maLength: 50 } }), it0.id, 'D')).toEqual([])
    expect(m.overlay.primeRsColumns(chart({ times: rs.times.slice(1) }), it0.id, 'D')).toEqual([])
    expect(m.overlay.primeRsColumns(it0, it0.id, '60')).toEqual([])
  })
})

describe('no preset lookup under pages/study', () => {
  it('no source file under pages/study reads meta.presets or a preset id (tests excepted)', () => {
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) files.push(p)
      }
    }
    walk(here)
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      // code only: the overlay's own header says in words what it no longer reads
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/meta\.presets|presets\s*\.\s*find|presetId|['"]classic['"]/)
    }
  })
})
