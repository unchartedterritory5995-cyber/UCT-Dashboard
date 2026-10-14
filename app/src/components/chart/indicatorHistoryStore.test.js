// app/src/components/chart/indicatorHistoryStore.test.js — A1.2: the indicator Undo stack
import { describe, it, expect, beforeEach } from 'vitest'
import * as R from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, setInstanceHidden, removeInstance, removeDefinition, addInstance, setInstanceInput, withInstances } from './engine/instanceControls'
import { applyUndo, recordOf, readBack, HISTORY_CONTRACT } from './engine/indicatorHistory'
import {
  recordIndicatorChange, undoIndicatorChange, redoIndicatorChange, peekIndicatorHistory, describeIndicatorChange,
  indicatorHistoryKey, HISTORY_DEPTH, HISTORY_KEY_PREFIX, _resetIndicatorHistoryForTests,
} from './indicatorHistoryStore'

const norm = (cs) => mergeChartSettings(JSON.stringify(cs))
const bytes = (v) => JSON.stringify(v)
const label = (d) => ({ rsi: 'RSI', macd: 'MACD' }[d] || d)

function chart() {
  const base = mergeChartSettings(null)
  const raw = norm({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false },
      { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 21 }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
    header: { ...(base.header || {}), infoValues: [{ instanceId: 'inst:rsi:2', plotKey: 'rsi', format: 'auto' }] },
  })
  return norm(withInstances(raw, raw.indicatorInstances, R))
}

/** A fake surface: `cs` is what the chart holds; `write` is its sink (a JSON round trip). */
function surface(initial = chart()) {
  const s = { cs: initial }
  s.write = (next) => { s.cs = norm(next) }
  return s
}

beforeEach(() => {
  _resetIndicatorHistoryForTests()
  try { window.sessionStorage.clear() } catch { /* jsdom */ }
})

describe('A1.2 — what is recorded, and its label', () => {
  it('hide / show / add / remove / remove-all are recorded; an input edit is not', () => {
    const cs = chart()
    expect(describeIndicatorChange(cs, setIndicatorEnabled(cs, 'rsi', false, R), label)).toEqual({ kind: 'hide', label: 'RSI hidden (2)' })
    const hidden = norm(setIndicatorEnabled(cs, 'rsi', false, R))
    expect(describeIndicatorChange(hidden, setIndicatorEnabled(hidden, 'rsi', true, R), label)).toEqual({ kind: 'show', label: 'RSI shown (2)' })
    expect(describeIndicatorChange(cs, addInstance(cs, 'macd', R), label).kind).toBe('add')
    expect(describeIndicatorChange(cs, removeInstance(cs, 'inst:rsi:1', R), label)).toEqual({ kind: 'remove', label: 'Removed RSI' })
    expect(describeIndicatorChange(cs, removeDefinition(cs, 'rsi', R), label)).toEqual({ kind: 'remove', label: 'Removed 2 RSI' })
    expect(describeIndicatorChange(cs, setInstanceInput(cs, 'inst:rsi:1', 'period', 30, R), label)).toBe(null)
    expect(recordIndicatorChange('global', cs, setInstanceInput(cs, 'inst:rsi:1', 'period', 30, R), { labelOf: label })).toBe(null)
  })
})

describe('A1.2 — Undo and Redo are exact', () => {
  for (const [name, w] of [
    ['definition hide', (cs) => setIndicatorEnabled(cs, 'rsi', false, R)],
    ['instance hide', (cs) => setInstanceHidden(cs, 'inst:macd:1', true, R)],
    ['remove one (severs the MA source and nothing else)', (cs) => removeInstance(cs, 'inst:rsi:1', R)],
    ['remove all RSI (severs the info value)', (cs) => removeDefinition(cs, 'rsi', R)],
    ['add', (cs) => addInstance(cs, 'macd', R)],
  ]) {
    it(`${name}: undo restores the persisted blob byte for byte; redo re-applies it`, () => {
      const s = surface()
      const before = s.cs
      const after = norm(w(before))
      s.write(after)
      expect(recordIndicatorChange('chart:c1', before, after, { labelOf: label })).toBeTruthy()
      expect(undoIndicatorChange('chart:c1', s.cs, s.write).ok).toBe(true)
      expect(bytes(s.cs)).toBe(bytes(before))
      expect(redoIndicatorChange('chart:c1', s.cs, s.write).ok).toBe(true)
      expect(bytes(s.cs)).toBe(bytes(after))
    })
  }

  it('⛔ a STALE undo refuses and writes NOTHING — the instance changed since (another tab, the Agent, an edit)', () => {
    const s = surface()
    const before = s.cs
    s.write(setInstanceHidden(before, 'inst:rsi:1', true, R))
    recordIndicatorChange('chart:c1', before, s.cs, { labelOf: label })
    s.write(setInstanceInput(s.cs, 'inst:rsi:1', 'period', 40, R))   // out-of-band edit to the SAME instance
    const held = s.cs
    let wrote = false
    const r = undoIndicatorChange('chart:c1', s.cs, () => { wrote = true })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('changed-since')
    expect(r.detail.instanceId).toBe('inst:rsi:1')
    expect(wrote).toBe(false)
    expect(s.cs).toBe(held)
    expect(peekIndicatorHistory('chart:c1').past).toHaveLength(1)
  })

  it('an unrelated edit to ANOTHER instance does not block the undo, and survives it', () => {
    const s = surface()
    const before = s.cs
    s.write(setInstanceHidden(before, 'inst:rsi:1', true, R))
    recordIndicatorChange('chart:c1', before, s.cs, { labelOf: label })
    s.write(setInstanceInput(s.cs, 'inst:rsi:2', 'period', 30, R))
    expect(undoIndicatorChange('chart:c1', s.cs, s.write).ok).toBe(true)
    const live = (id) => s.cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(live('inst:rsi:1').hidden).toBe(false)
    expect(live('inst:rsi:2').inputs.period).toBe(30)
  })

  it('a record of another contract or settings version is refused', () => {
    const cs = chart()
    const rec = recordOf(cs, setIndicatorEnabled(cs, 'rsi', false, R))
    expect(rec.contract).toBe(HISTORY_CONTRACT)
    expect(applyUndo(cs, { ...rec, contract: 'uct.indicators.mutation/1' }).ok).toBe(false)
    expect(applyUndo(cs, { ...rec, settingsVersion: 1 }).ok).toBe(false)
    expect(applyUndo(cs, { ...rec, granularity: undefined }).ok).toBe(false)
  })
})

describe('A1.2 — the stack', () => {
  it(`depth ${HISTORY_DEPTH}; a new entry clears Redo`, () => {
    const s = surface()
    for (let k = 0; k < HISTORY_DEPTH + 5; k++) {
      const before = s.cs
      s.write(setInstanceHidden(before, 'inst:macd:1', k % 2 === 0, R))
      recordIndicatorChange('global', before, s.cs, { labelOf: label })
    }
    expect(peekIndicatorHistory('global').past).toHaveLength(HISTORY_DEPTH)
    undoIndicatorChange('global', s.cs, s.write)
    expect(peekIndicatorHistory('global').future).toHaveLength(1)
    const before = s.cs
    s.write(setInstanceHidden(before, 'inst:rsi:1', true, R))
    recordIndicatorChange('global', before, s.cs, { labelOf: label })
    expect(peekIndicatorHistory('global').future).toHaveLength(0)
  })

  it('member-scoped: another user id never sees the stack', () => {
    const cs = chart()
    recordIndicatorChange('chart:c1', cs, setIndicatorEnabled(cs, 'rsi', false, R), { userId: 'u1', labelOf: label })
    expect(peekIndicatorHistory('chart:c1', { userId: 'u1' }).past).toHaveLength(1)
    expect(peekIndicatorHistory('chart:c1', { userId: 'u2' }).past).toHaveLength(0)
  })

  it('survives a reload through sessionStorage, under EXACT keys only; foreign keys are untouched', () => {
    window.sessionStorage.setItem('someone.else', 'keep')
    window.sessionStorage.setItem('uct.indicators.other', 'keep')
    const cs = chart()
    recordIndicatorChange('chart:c1', cs, setIndicatorEnabled(cs, 'rsi', false, R), { userId: 'u1', labelOf: label })
    _resetIndicatorHistoryForTests()
    expect(peekIndicatorHistory('chart:c1', { userId: 'u1' }).past.map((e) => e.label)).toEqual(['RSI hidden (2)'])
    expect(window.sessionStorage.getItem('someone.else')).toBe('keep')
    expect(window.sessionStorage.getItem('uct.indicators.other')).toBe('keep')
    const ours = Object.keys(window.sessionStorage).filter((k) => k.startsWith(HISTORY_KEY_PREFIX)).sort()
    expect(ours).toEqual([`${HISTORY_KEY_PREFIX}index:u1`, `${HISTORY_KEY_PREFIX}u1:chart:c1`])
  })

  it('storage failure falls back to memory', () => {
    const real = window.sessionStorage.setItem
    window.sessionStorage.setItem = () => { throw new Error('QuotaExceededError') }
    try {
      const cs = chart()
      expect(recordIndicatorChange('global', cs, setIndicatorEnabled(cs, 'rsi', false, R), { labelOf: label })).toBeTruthy()
      expect(peekIndicatorHistory('global').past).toHaveLength(1)
    } finally { window.sessionStorage.setItem = real }
  })

  it('surface keys', () => {
    expect(indicatorHistoryKey({ chartId: 'w1:t2', isolated: true })).toBe('chart:w1:t2')
    expect(indicatorHistoryKey({ isolated: true, mountId: 'm9' })).toBe('mount:m9')
    expect(indicatorHistoryKey({ chartId: 'w1', isolated: false })).toBe('global')
  })

  it('readBack is the persisted read', () => {
    const cs = chart()
    expect(bytes(readBack(cs))).toBe(bytes(norm(cs)))
  })
})
