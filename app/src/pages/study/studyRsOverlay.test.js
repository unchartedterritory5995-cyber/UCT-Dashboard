/**
 * studyRsOverlay rails (RS 4-09): the drill draws the REAL rsLine definition
 * from the columns the bank item carries, through the server lane's cache,
 * with no request. Every family is exercised on a REAL item from
 * docs/study/bank/rs.drills.json (the generator's own output, 546fa9fa3d).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computeFor, getDefinition, resolveInputs } from '../../components/chart/engine/nativeRegistry'
import { cachedColumns, clearServerColumns, pickServerInputs, revMismatch, SERVER_COLUMNS_PATH } from '../../components/chart/engine/serverCompute'
import { validateInstance } from '../../components/chart/engine/instances'
import { legendChips, paneReadoutLabel } from '../../components/chart/engine/readout'
import { normalizeBars } from './useStudySession'
import {
  RS_DEF_ID, RS_INSTANCE_ID, RS_REVEAL_INSTANCE_ID, classicInputs, isRsItem, isRsPairItem, keyInputs,
  primeRsColumns, rsInstances, rsLinesFor, rsMarkMarkers, rsPairKey, rsRev, wireAgrees,
} from './studyRsOverlay'

const here = dirname(fileURLToPath(import.meta.url))
const BANK = JSON.parse(readFileSync(resolve(here, '../../../../docs/study/bank/rs.drills.json'), 'utf8'))
const SOURCE = readFileSync(resolve(here, 'studyRsOverlay.js'), 'utf8')

/** The member-facing shape: what GET /api/study/today serves (no sym, no reveal) with the bars inline. */
function served(raw) {
  return { id: raw.id, version: 1, type: raw.type, skill_id: raw.skill_id, prompt_json: raw.prompt_json,
    ...(raw.bars_embed ? { bars: { tf: 'D', bars: raw.bars_embed.bars } } : {}) }
}
/** The lane's request is asked on a microtask (`fetchColumns`), so a "no request" assertion waits a turn first. */
const settle = () => new Promise((r) => setTimeout(r, 0))
const tap = BANK.find((i) => i.type === 'tap' && i.reveal_json?.rs)
const pair = BANK.find((i) => i.prompt_json?.chart?.rs_pair)
const redDay = BANK.find((i) => i.prompt_json?.chart?.mark && i.prompt_json?.chart?.rs)
const recall = BANK.find((i) => i.type === 'recall')
const barsOf = (raw) => normalizeBars(raw.bars_embed.bars)
const finite = (col) => Array.from(col).filter(Number.isFinite).length
const nonNull = (col) => col.filter((v) => v != null).length

let fetchSpy
beforeEach(() => {
  clearServerColumns()
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in a drill')))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals() })

/** What the chart's binder computes for one instance: `computeFor` with the chart's ctx (sym = item id, tf = D). */
function draw(inst, sym, bars) {
  return computeFor(getDefinition(RS_DEF_ID), bars, inst.inputs, { sym, tf: 'D' })
}

describe('the bank has one item of each family', () => {
  it('finds a tap, a pair, a red-day item and a recall item', () => {
    expect(tap && pair && redDay && recall).toBeTruthy()
    expect(isRsItem(served(tap)) && isRsItem(served(pair)) && isRsItem(served(redDay))).toBe(true)
    expect(isRsItem(recall)).toBe(false)
    expect(isRsPairItem(served(pair))).toBe(true)
    expect(isRsPairItem(served(tap))).toBe(false)
  })
})

describe('the rev comes from the definition', () => {
  it('primes the definition rev, so revMismatch never flags a drill', () => {
    const it0 = served(redDay)
    const [line] = primeRsColumns(it0, it0.id, 'D')
    const parsed = cachedColumns(RS_DEF_ID, it0.id, 'D', keyInputs(line.inputs))
    const def = getDefinition(RS_DEF_ID)
    expect(rsRev()).toBe(def.compute.rev)
    expect(parsed.rev).toBe(def.compute.rev)
    expect(revMismatch(parsed, def)).toBe(false)
  })
  it('never types a rev number', () => {
    expect(SOURCE).not.toMatch(/rev\s*:\s*\d/)
  })
})

describe('the Classic preset', () => {
  it('is the definition preset, and every instance it makes validates', () => {
    const def = getDefinition(RS_DEF_ID)
    expect(classicInputs()).toEqual(def.meta.presets.find((p) => p.id === 'classic').inputs)
    for (const raw of [tap, pair, redDay]) {
      const it0 = served(raw)
      for (const inst of rsInstances(primeRsColumns(it0, it0.id, 'D'))) {
        if (inst.deleted) continue
        expect(validateInstance(inst, { getDefinition }).errors || []).toEqual([])
      }
    }
  })
})

describe('a single line (red-day item): prompt columns, drawn with no request', () => {
  it('draws the bank columns, joined by time onto the item bars', async () => {
    const it0 = served(redDay)
    const primed = primeRsColumns(it0, it0.id, 'D')
    expect(primed.map((p) => p.instanceId)).toEqual([RS_INSTANCE_ID])
    const [inst] = rsInstances(primed)
    expect(inst.inputs).toEqual(classicInputs())               // slot 0 IS Classic, nothing added
    const cols = draw(inst, it0.id, barsOf(redDay))
    expect(Array.from(cols.rsLine)).toEqual(redDay.prompt_json.chart.rs.columns.rsLine)
    expect(finite(cols.rsMa)).toBe(120)
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('an unprimed instance WOULD fetch (the control that makes the rail mean something)', async () => {
    const it0 = served(redDay)
    draw({ inputs: classicInputs() }, it0.id, barsOf(redDay))
    await settle()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain(SERVER_COLUMNS_PATH)
  })
  it('marks the red day with a muted dot under the marked bar', () => {
    const it0 = served(redDay)
    const bars = barsOf(redDay)
    const m = rsMarkMarkers(it0, bars)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ position: 'belowBar', shape: 'circle', text: '', time: bars[redDay.prompt_json.chart.mark.bar_index].t })
    expect(rsMarkMarkers(served(tap), barsOf(tap))).toBeNull()
  })
})

describe('a tap item: the prompt blanks the dots, the reveal draws them', () => {
  it('prompt: line and average, no dot', () => {
    const it0 = served(tap)
    const [inst] = rsInstances(primeRsColumns(it0, it0.id, 'D'))
    const cols = draw(inst, it0.id, barsOf(tap))
    expect(finite(cols.rsLine)).toBe(120)
    expect(finite(cols.dotNH)).toBe(0)
    expect(finite(cols.dotNHbeforePx)).toBe(0)
  })
  it('reveal: the real dots, under their own key, and the prompt line tombstoned', async () => {
    const it0 = served(tap)
    const prompt = primeRsColumns(it0, it0.id, 'D')
    const reveal = { rs: tap.reveal_json.rs, forward_bars: tap.bars_embed.forward }
    const after = primeRsColumns(it0, it0.id, 'D', { reveal, revealed: true })
    expect(after.map((p) => p.instanceId)).toEqual([RS_REVEAL_INSTANCE_ID])
    expect(after[0].key).not.toBe(prompt[0].key)
    const insts = rsInstances(after)
    expect(insts).toContainEqual({ instanceId: RS_INSTANCE_ID, deleted: true })
    const live = insts.find((i) => !i.deleted)
    const bars = [...barsOf(tap), ...normalizeBars(tap.bars_embed.forward)]
    const cols = draw(live, it0.id, bars)
    expect(finite(cols.dotNH)).toBe(nonNull(tap.reveal_json.rs.columns.dotNH))
    expect(finite(cols.dotNH)).toBeGreaterThan(0)
    expect(cols.dotNH[tap.answer_json.bar_index]).toBeGreaterThan(0)     // the answer bar carries its dot
    // the prompt entry is untouched: a stale paint of the prompt still reads blank dots
    expect(finite(draw(rsInstances(prompt)[0], it0.id, barsOf(tap)).dotNH)).toBe(0)
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('without reveal columns the prompt line stays', () => {
    const it0 = served(tap)
    expect(rsLinesFor(it0, { reveal: { lesson: 'x' }, revealed: true }).map((l) => l.instanceId)).toEqual([RS_INSTANCE_ID])
  })
})

describe('a leader item: Line A and Line B, two keys, two lines', () => {
  it('draws each stock its own line on the market chart', async () => {
    const it0 = served(pair)
    const primed = primeRsColumns(it0, it0.id, 'D')
    expect(primed.map((p) => p.label)).toEqual(['Line A', 'Line B'])
    expect(new Set(primed.map((p) => p.key)).size).toBe(2)
    expect(rsPairKey(primed)).toEqual(['Line A', 'Line B'])
    const [a, b] = rsInstances(primed)
    const bars = barsOf(pair)
    expect(Array.from(draw(a, it0.id, bars).rsLine)).toEqual(pair.prompt_json.chart.rs_pair.A.columns.rsLine)
    expect(Array.from(draw(b, it0.id, bars).rsLine)).toEqual(pair.prompt_json.chart.rs_pair.B.columns.rsLine)
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the pane label never names the stock', () => {
  it('reads UCT Relative Strength · SPY on every family', () => {
    const def = getDefinition(RS_DEF_ID)
    for (const raw of [tap, pair, redDay]) {
      const it0 = served(raw)
      const insts = rsInstances(primeRsColumns(it0, it0.id, 'D')).filter((i) => !i.deleted)
      const chips = legendChips([], null, { getDefinition }, insts, { scalarsOf: () => null })
      const labels = chips.filter((c) => c.plotKey === 'rsLine').map((c) => paneReadoutLabel(c, def))
      expect(labels.length).toBe(insts.length)
      for (const label of labels) {
        expect(label).toBe('UCT Relative Strength · SPY')
        const names = [raw.bars_embed.sym, raw.reveal_json?.example?.sym, ...Object.values(raw.reveal_json?.example?.names || {})]
        for (const n of names.filter((x) => x && x !== 'SPY')) expect(label).not.toContain(n)
      }
    }
  })
})

describe('refusals: no line, so no instance and no request', () => {
  it('drops a line whose wire inputs disagree with Classic', () => {
    const it0 = served(redDay)
    const bad = { ...it0, prompt_json: { ...it0.prompt_json, chart: { ...it0.prompt_json.chart, rs: { ...it0.prompt_json.chart.rs, inputs: { maLength: 50 } } } } }
    expect(wireAgrees(bad.prompt_json.chart.rs, classicInputs())).toBe(false)
    expect(primeRsColumns(bad, bad.id, 'D')).toEqual([])
    expect(rsInstances([])).toBeNull()
  })
  it('drops a malformed wire (a column longer than its times)', () => {
    const it0 = served(redDay)
    const rs = it0.prompt_json.chart.rs
    const bad = { ...it0, prompt_json: { ...it0.prompt_json, chart: { ...it0.prompt_json.chart, rs: { ...rs, times: rs.times.slice(1) } } } }
    expect(primeRsColumns(bad, bad.id, 'D')).toEqual([])
  })
  it('draws nothing on a non-daily chart or without a symbol', () => {
    const it0 = served(redDay)
    expect(primeRsColumns(it0, it0.id, '60')).toEqual([])
    expect(primeRsColumns(it0, '', 'D')).toEqual([])
    expect(primeRsColumns(served(recall), 'si_x', 'D')).toEqual([])
  })
  it('keys exactly as computeFor does (resolveInputs then pickServerInputs)', () => {
    const def = getDefinition(RS_DEF_ID)
    expect(keyInputs(classicInputs())).toEqual(pickServerInputs(def, resolveInputs(def, classicInputs())))
  })
})
