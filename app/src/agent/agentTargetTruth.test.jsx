// Selection oracle 11-06: a change lands on the chart the member meant. Through the REAL panel on the fixture board with a chart
// clicked and the model scripted to a WRONG plan (no paid call): the gates must stop it. Drawing targets are one entry per symbol,
// words that name a chart outrank the click, and positions are read from the area the charts cover.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { buildDrawingSource, positionWord } from './host'
import { chartRefOf, screenUnnamedTargets, screenDeicticOps } from './deixis'
import { getCapability, getTargetKind } from './capabilities'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 12, h = 10) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
const quad = (clicked) => {
  const m = p.mount([cell('tl', 0, 0), cell('tr', 12, 0), cell('bl', 0, 10), cell('br', 12, 10)], { 'N:tl': 'SPY', 'N:tr': 'QQQ', 'N:bl': 'NVDA', 'N:br': 'TSLA' })
  if (clicked) p.select(clicked)
  return m
}
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const setTf = (target, timeframe) => ({ action: 'chart.setTimeframe', target, args: { timeframe } })
const setSym = (target, symbol) => ({ action: 'chart.setSymbol', target, args: { symbol } })
const level = (sym, price = 120) => ({ action: 'drawing.addLevel', target: sym, args: { price } })
const asked = () => /Did you mean|Which chart/.test(p.transcript())

describe('a drawing plan passes the same gates as any chart change', () => {
  it('each drawing target names its chart, the clicked one when charts share the symbol', () => {
    const charts = { list: () => [{ ref: 'a', symbol: 'NVDA', label: 'A' }, { ref: 'b', symbol: 'NVDA', label: 'B', selected: true }, { ref: 'c', symbol: 'SPY', label: 'C' }] }
    const store = { peekDrawings: () => [], getActiveTracingId: () => null }
    const list = buildDrawingSource(charts, store).list()
    expect(list.map(e => [e.ref, e.chartRef])).toEqual([['NVDA', 'b'], ['SPY', 'c']])
    expect(chartRefOf(getTargetKind('drawing'), list[0])).toBe('b')
  })
  // the real drawing source over the board's charts; the browser side of these is the selection set's sel-*-level-* cases
  const board = (clicked) => {
    const list = [['a', 'SPY', 'top-left'], ['b', 'QQQ', 'top-right'], ['c', 'TSLA', 'bottom-right']].map(([ref, symbol, position]) => ({ ref, symbol, position, label: ref, ...(ref === clicked ? { selected: true } : {}) }))
    const charts = { list: () => list, selected: () => clicked }
    return { charts, drawings: buildDrawingSource(charts, { peekDrawings: () => [], getActiveTracingId: () => null }) }
  }
  const op = (target) => [level(target)]
  const gates = { getTargetKind, getCapability }
  it.each(['draw a line at 120', 'put a level at 120'])('NEGATIVE: "%s", nothing clicked, plan on the first chart: asked', (text) => {
    expect(screenUnnamedTargets({ host: board(null), ops: op('SPY'), text, ...gates })?.ask).toBeTruthy()
  })
  it('NEGATIVE: "this chart", TSLA clicked, plan on SPY: moved to the clicked chart, never SPY', () => {
    const r = screenDeicticOps({ host: board('c'), ops: op('SPY'), text: 'kindly mark a line at 120 on this chart', ...gates })
    expect(r.aim?.[0].target ?? null).not.toBe('SPY')
    expect(r.ask || r.aim).toBeTruthy()
  })
  it('NEGATIVE: words name QQQ, TSLA clicked, plan on TSLA: asked', () => {
    expect(screenUnnamedTargets({ host: board('c'), ops: op('TSLA'), text: 'mark a line at 120 on the top-right chart', ...gates })?.ask).toBeTruthy()
  })
  it('a bare request lands on the clicked chart', () => {
    expect(screenUnnamedTargets({ host: board('c'), ops: op('TSLA'), text: 'mark a line at 120', ...gates })).toBeNull()
  })
  it('NEGATIVE: a bare request planned on another chart, TSLA clicked: asked', () => {
    expect(screenUnnamedTargets({ host: board('c'), ops: op('SPY'), text: 'mark a line at 120', ...gates })?.ask).toBeTruthy()
  })
})

describe('words that name a chart outrank the click', () => {
  it.each([
    ['swap the top-right chart over to AVGO', setSym('br', 'AVGO'), 'symbol'],
    ['kindly flip the top right chart over to the weekly view', setTf('br', 'W'), 'tf'],
    ['flip the QQQ one over to weekly please', setTf('br', 'W'), 'tf'],
    ['kindly flip the second chart over to the weekly view', setTf('br', 'W'), 'tf'],
  ])('NEGATIVE: "%s", BR clicked, plan on BR: asked, BR untouched', async (t, op) => {
    const b = quad('br')
    p.st.envelopes.push(p.env('apply', [op]))
    await b.say(t)
    expect(tfOf(b.board, 'br')).toBe('D')
    expect(b.board.state.groupSyms['N:br']).toBe('TSLA')
    expect(asked()).toBe(true)
  }, 30000)
  it('NEGATIVE: a position fitting several charts, the click not among them: asked', async () => {
    const b = quad('br')
    p.st.envelopes.push(p.env('apply', [setTf('br', 'W')]))
    await b.say('kindly flip the top one over to the weekly view')
    expect(tfOf(b.board, 'br')).toBe('D')
  }, 30000)
  it('a position fitting several charts, the click among them: that one', async () => {
    const b = quad('tr')
    p.st.envelopes.push(p.env('apply', [setTf('tr', 'W')]))
    await b.say('kindly flip the top one over to the weekly view')
    expect(tfOf(b.board, 'tr')).toBe('W')
  }, 30000)
  it('the plan on the chart the words name runs, with another clicked', async () => {
    const b = quad('br')
    p.st.envelopes.push(p.env('apply', [setTf('tr', 'W')]))
    await b.say('kindly flip the top right chart over to the weekly view')
    expect(tfOf(b.board, 'tr')).toBe('W')
    expect(tfOf(b.board, 'br')).toBe('D')
  }, 30000)
  it('a bare "this" keeps meaning the clicked chart, also beside a named one', async () => {
    const b = quad('br')
    p.st.envelopes.push(p.env('apply', [setTf('br', 'W')]))
    await b.say('kindly flip this over to the weekly view')
    expect(tfOf(b.board, 'br')).toBe('W')
  }, 30000)
  it.each([['kindly set the top was 150 line weekly'], ['kindly flip it right now to the weekly view'], ['kindly go weekly with the label on top'], ['kindly go weekly, the left shoulder matters']])('NEGATIVE: "%s": a position word that is not a chart leaves the click standing', async (t0) => {
    const b = p.mount([cell('t', 0, 0, 24, 10), cell('m', 0, 10, 12, 10), cell('r', 12, 10, 12, 10)], { 'N:t': 'SPY', 'N:m': 'QQQ', 'N:r': 'TSLA' })
    p.select('r')
    p.st.envelopes.push(p.env('apply', [setTf('r', 'W')]))
    await b.say(t0)
    expect(tfOf(b.board, 'r')).toBe('W')
  }, 30000)
  it('nothing named: the click answers, as before', async () => {
    const b = quad('br')
    p.st.envelopes.push(p.env('apply', [setTf('br', 'W')]))
    await b.say('kindly flip over to the weekly view')
    expect(tfOf(b.board, 'br')).toBe('W')
  }, 30000)
})

describe('a position word reads the area the charts cover', () => {
  const at = (x, y, w, h) => ({ x, y, w, h })
  const words = (all) => all.map(o => positionWord(o, all))
  const THREE = [at(0, 0, 6, 20), at(6, 0, 6, 20), at(12, 0, 6, 20)]
  it('three across beside a rail: left, middle, right', () => expect(words(THREE)).toEqual(['left', 'middle', 'right']))
  it('three across a whole board', () => expect(words([at(0, 0, 8, 20), at(8, 0, 8, 20), at(16, 0, 8, 20)])).toEqual(['left', 'middle', 'right']))
  it('three stacked: top, middle, bottom', () => expect(words([at(0, 0, 24, 6), at(0, 6, 24, 7), at(0, 13, 24, 7)])).toEqual(['top', 'middle', 'bottom']))
  it('two beside a rail: left and right', () => expect(words([at(0, 0, 9, 20), at(9, 0, 9, 20)])).toEqual(['left', 'right']))
  it('a 2×2 beside a rail', () => expect(words([at(0, 0, 9, 10), at(9, 0, 9, 10), at(0, 10, 9, 10), at(9, 10, 9, 10)])).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']))
  it('NEGATIVE: unchanged on a full 2×2 and a tall chart beside two', () => {
    expect(words([at(0, 0, 12, 10), at(12, 0, 12, 10), at(0, 10, 12, 10), at(12, 10, 12, 10)])).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    expect(words([at(0, 0, 12, 20), at(12, 0, 12, 10), at(12, 10, 12, 10)])).toEqual(['left', 'top-right', 'bottom-right'])
  })
  it('NEGATIVE: two above one full-width are not three clean columns: no "middle"', () => {
    expect(words([at(0, 0, 12, 10), at(12, 0, 12, 10), at(0, 10, 24, 10)]).join(' ')).not.toMatch(/middle/)
  })
  it('the widgets of a whole board keep their words: a rail on the right', () => {
    const all = [at(0, 0, 18, 20), at(18, 0, 6, 20)]
    expect(words(all)).toEqual(['left', 'right'])
  })
})
