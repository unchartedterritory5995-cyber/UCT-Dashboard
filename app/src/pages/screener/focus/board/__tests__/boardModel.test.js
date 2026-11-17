// The scan board's rules (boardModel.js): presets that tile the grid, a stored layout that can
// always be drawn, and actions that never leave a widget squeezed, hidden or overlapping.
import { describe, expect, test } from 'vitest'
import {
  COLS, ROWS, WIDGETS, PRESETS, ROW_STYLES, MAX_MINE, DEFAULT_STATE,
  sanitize, serialize, cleanWidgets, pickLayout, addWidget, removeWidget, acceptArrangement, saveMine, updateMine, deleteMine,
  setRows, rowsOf, setOption, missingWidgets, currentLayout, fillGaps, settleDrop, shareable, freeName, adoptLayout, MAX_NAME,
} from '../boardModel'

const area = ws => ws.reduce((n, w) => n + w.w * w.h, 0)
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const sound = ws => ws.every(w => w.x >= 0 && w.y >= 0 && w.x + w.w <= COLS && w.y + w.h <= ROWS && w.w >= WIDGETS[w.type].minW && w.h >= WIDGETS[w.type].minH)
  && ws.every((a, i) => ws.every((b, j) => i === j || !overlap(a, b)))
const fresh = () => sanitize(null)

describe('the presets', () => {
  test('there are one to three, and each tiles the whole grid with sound widgets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(1)
    expect(PRESETS.length).toBeLessThanOrEqual(3)
    for (const p of PRESETS) {
      expect(sound(p.widgets)).toBe(true)
      expect(area(p.widgets)).toBe(COLS * ROWS)
      // a preset survives the board's own cleaning unchanged, so it draws exactly as written
      expect(cleanWidgets(p.widgets)).toEqual(p.widgets)
    }
  })
  test('a new member starts on the first preset', () => {
    const s = fresh()
    expect(s.layoutId).toBe(PRESETS[0].id)
    expect(s.widgets).toEqual(PRESETS[0].widgets)
    expect(s.changed).toBe(false)
    expect(s.widgets).not.toBe(PRESETS[0].widgets) // a copy: editing the board never edits the preset
  })
})

describe('owner ruling 2026-11-17: no table and no heat map as options', () => {
  test('neither is a widget, a row style or a preset', () => {
    expect(Object.keys(WIDGETS)).toEqual(['results', 'chart', 'details', 'news', 'screens'])
    expect(ROW_STYLES.map(r => r[0])).toEqual(['line', 'compact', 'two', 'cards', 'chips'])
    const words = JSON.stringify([WIDGETS, ROW_STYLES, PRESETS]).toLowerCase()
    expect(words).not.toMatch(/table|heat ?map/)
  })
  test('a stored layout that still holds them is cleaned on read', () => {
    const s = sanitize({ layoutId: null, widgets: [
      { id: 'map', type: 'map', x: 0, y: 0, w: 9, h: 10 },
      { id: 'results', type: 'results', x: 0, y: 10, w: 9, h: 10, opts: { rows: 'wide' } },
      { id: 'chart', type: 'chart', x: 9, y: 0, w: 15, h: 20 },
    ] })
    expect(s.widgets.map(w => w.type)).toEqual(['results', 'chart'])
    expect(rowsOf(s)).toBe('line')
  })
})

describe('a stored board can always be drawn', () => {
  test.each([[null], [undefined], [''], ['{not json'], [42], [[]], [{ widgets: 'x' }], [{ widgets: [] }], [{ widgets: [{ type: 'nope' }] }]])(
    'unreadable input %j is the default preset', raw => {
      expect(sanitize(raw)).toEqual({ ...DEFAULT_STATE, widgets: PRESETS[0].widgets })
    })
  test('overlapping widgets are refused whole (never a pile-up)', () => {
    const s = sanitize({ widgets: [{ type: 'chart', x: 0, y: 0, w: 17, h: 20 }, { type: 'results', x: 10, y: 0, w: 14, h: 20 }] })
    expect(s.widgets).toEqual(PRESETS[0].widgets)
    expect(s.layoutId).toBe(PRESETS[0].id)
  })
  test('a widget is pulled inside the grid and up to its minimum size; a second of a type is dropped', () => {
    const s = sanitize({ widgets: [
      { type: 'chart', x: 20, y: 15, w: 2, h: 2 },
      { type: 'chart', x: 0, y: 0, w: 8, h: 8 },
      { type: 'results', x: -3, y: -1, w: 99, h: 5.4 },
    ] })
    expect(s.widgets).toEqual([
      { id: 'chart', type: 'chart', x: COLS - WIDGETS.chart.minW, y: ROWS - WIDGETS.chart.minH, w: WIDGETS.chart.minW, h: WIDGETS.chart.minH },
      { id: 'results', type: 'results', x: 0, y: 0, w: COLS, h: 5, opts: { rows: 'line' } },
    ])
    expect(sound(s.widgets)).toBe(true)
  })
  test('an unknown layout id is forgotten; the member\'s own layouts are kept, cleaned and capped', () => {
    const good = { id: 'm-1', name: '  Mine  ', widgets: PRESETS[1].widgets }
    const many = Array.from({ length: MAX_MINE + 5 }, (_, i) => ({ ...good, id: `m-${i}` }))
    const s = sanitize({ layoutId: 'gone', widgets: PRESETS[1].widgets, changed: true,
      mine: [{ id: 'x-1', name: 'bad id', widgets: PRESETS[0].widgets }, { id: 'm-9', name: '', widgets: PRESETS[0].widgets }, { id: 'm-8', name: 'no widgets', widgets: [] }, ...many] })
    expect(s.layoutId).toBeNull()
    expect(s.changed).toBe(true)
    expect(s.mine).toHaveLength(MAX_MINE)
    expect(s.mine[0]).toEqual({ id: 'm-0', name: 'Mine', widgets: PRESETS[1].widgets })
  })
  test('the switches are on only when stored as true; what is written reads back the same', () => {
    const s = sanitize({ widgets: PRESETS[0].widgets, layoutId: 'board', logos: true, spark: 'yes', group: 1, seen: true, screens: 'sideways', extra: 'x' })
    expect([s.logos, s.spark, s.group, s.seen, s.hints, s.roomy, s.screens]).toEqual([true, false, false, true, false, false, 'tabs'])
    expect(s).not.toHaveProperty('extra')
    expect(sanitize(serialize(s))).toEqual(s)
    expect(JSON.parse(serialize({ ...s, edit: true }))).not.toHaveProperty('edit') // Customize is never stored
  })
})

describe('adding and removing a widget', () => {
  test('a new widget takes its room from the biggest one: nothing else moves, the grid stays full', () => {
    const s0 = fresh()
    expect(missingWidgets(s0)).toEqual(['news', 'screens'])
    const s = addWidget(s0, 'news')
    expect(s.changed).toBe(true)
    expect(sound(s.widgets)).toBe(true)
    expect(area(s.widgets)).toBe(COLS * ROWS)
    const byType = Object.fromEntries(s.widgets.map(w => [w.type, w]))
    // the chart (17 x 20, the biggest) gave up its right side; results and details did not move
    expect(byType.results).toEqual(s0.widgets.find(w => w.type === 'results'))
    expect(byType.details).toEqual(s0.widgets.find(w => w.type === 'details'))
    expect(byType.chart.w + byType.news.w).toBe(17)
    expect(byType.news.x).toBe(byType.chart.x + byType.chart.w)
  })
  test('a widget already on the board is not added twice; an unknown one is ignored', () => {
    const s0 = fresh()
    expect(addWidget(s0, 'chart')).toBe(s0)
    expect(addWidget(s0, 'map')).toBe(s0)
  })
  test('when the biggest widget cannot give up enough room, the board is left as it was', () => {
    const s0 = { ...fresh(), widgets: [{ id: 'results', type: 'results', x: 0, y: 0, w: 4, h: 4, opts: { rows: 'line' } }] }
    expect(addWidget(s0, 'chart')).toBe(s0)
  })
  test('the last widget is never removed', () => {
    let s = fresh()
    s = removeWidget(s, 'details')
    s = removeWidget(s, 'results')
    expect(s.widgets.map(w => w.type)).toEqual(['chart'])
    expect(removeWidget(s, 'chart')).toBe(s)
    expect(removeWidget(fresh(), 'nope')).toEqual(fresh())
  })
  test('removing a widget leaves no hole: its neighbours grow into the room', () => {
    let s = removeWidget(fresh(), 'details')
    expect(s.widgets).toEqual([{ id: 'chart', type: 'chart', x: 0, y: 0, w: 17, h: 20 }, { id: 'results', type: 'results', x: 17, y: 0, w: 7, h: 20, opts: { rows: 'line' } }])
    s = removeWidget(s, 'results')
    expect(s.widgets).toEqual([{ id: 'chart', type: 'chart', x: 0, y: 0, w: 24, h: 20 }])
  })
})

describe('a drop is taken only when every widget is still a real widget', () => {
  const base = fresh()
  const move = (type, patch) => base.widgets.map(w => (w.type === type ? { ...w, ...patch } : w))
  test('a sound arrangement is accepted and marks the layout changed', () => {
    const next = acceptArrangement(base, [
      { id: 'chart', type: 'chart', x: 7, y: 0, w: 17, h: 20 },
      { id: 'results', type: 'results', x: 0, y: 0, w: 7, h: 12, opts: { rows: 'cards' } },
      { id: 'details', type: 'details', x: 0, y: 12, w: 7, h: 8 },
    ])
    expect(next).not.toBe(base)
    expect(next.changed).toBe(true)
    expect(rowsOf(next)).toBe('cards') // a widget's own settings ride through a move
    expect(sound(next.widgets)).toBe(true)
  })
  test.each([
    ['squeezed below its minimum width', move('details', { w: 2 })],
    ['squeezed below its minimum height', move('chart', { h: 3 })],
    ['pushed off the right edge', move('results', { x: 20 })],
    ['pushed off the bottom', move('details', { y: 15 })],
    ['overlapping another', move('results', { x: 10 })],
    ['a widget missing', base.widgets.slice(1)],
    ['not a list', null],
  ])('refused: %s', (_why, proposed) => {
    expect(acceptArrangement(base, proposed)).toBe(base)
  })
})

describe('empty space is filled, except by the widget you just placed', () => {
  const chart = { id: 'chart', type: 'chart', x: 7, y: 0, w: 17, h: 20 }
  const results = { id: 'results', type: 'results', x: 0, y: 12, w: 7, h: 8, opts: { rows: 'line' } }
  const details = { id: 'details', type: 'details', x: 0, y: 4, w: 7, h: 8 }
  test('after a RESIZE the widget keeps exactly its size, even beside a hole only it touches', () => {
    const next = acceptArrangement(fresh(), [chart, results, details], 'details')
    expect(next.widgets.find(w => w.id === 'details')).toEqual(details)
    expect(area(next.widgets)).toBe(COLS * ROWS - 7 * 4)
  })
  test('after a MOVE the widget takes what nothing else could: dropped short of an edge, it reaches it', () => {
    const next = acceptArrangement(fresh(), [chart, results, details], 'details', true)
    expect(next.widgets.find(w => w.id === 'details')).toEqual({ ...details, y: 0, h: 12 })
    expect(area(next.widgets)).toBe(COLS * ROWS)
    expect(sound(next.widgets)).toBe(true)
  })
  test('the others grow first: a moved widget only takes what is left', () => {
    // chart moved to the right half; results (left, top) can take the hole under it before the chart could
    const c = { id: 'chart', type: 'chart', x: 12, y: 0, w: 12, h: 20 }
    const r = { id: 'results', type: 'results', x: 0, y: 0, w: 12, h: 8, opts: { rows: 'line' } }
    const next = acceptArrangement({ ...fresh(), widgets: [c, r] }, [c, r], 'chart', true)
    expect(next.widgets).toEqual([c, { ...r, h: 20 }])
  })
  test('a hole another widget touches is taken by that widget, a row or a column at a time', () => {
    // results was moved to the bottom; the hole above details (rows 0-3) is details' to take
    const next = acceptArrangement(fresh(), [chart, results, details], 'results')
    expect(next.widgets.find(w => w.id === 'details')).toEqual({ ...details, y: 0, h: 12 })
    expect(next.widgets.find(w => w.id === 'results')).toEqual(results)
    expect(area(next.widgets)).toBe(COLS * ROWS)
    expect(sound(next.widgets)).toBe(true)
  })
  test('growing never overlaps, never leaves the grid, and a full board is left exactly as it is', () => {
    for (const p of PRESETS) expect(fillGaps(p.widgets)).toEqual(p.widgets)
    const lone = fillGaps([{ id: 'results', type: 'results', x: 9, y: 7, w: 5, h: 5, opts: { rows: 'line' } }, { id: 'chart', type: 'chart', x: 0, y: 0, w: 8, h: 8 }])
    expect(sound(lone)).toBe(true)
    expect(area(lone)).toBeGreaterThan(5 * 5 + 8 * 8)
    expect(fillGaps([{ id: 'chart', type: 'chart', x: 3, y: 3, w: 8, h: 8 }])).toEqual([{ id: 'chart', type: 'chart', x: 0, y: 0, w: 24, h: 20 }])
  })
  test('the drop decision hands the board the widget that was moved', () => {
    const seen = []
    const run = wasMove => settleDrop(fresh().widgets, { i: 'details', x: 0, y: 4, w: 7, h: 8 }, () => [chart, results, details], (ws, id, moved) => { seen.push([id, moved]); return true }, wasMove)
    expect([run(true), run(false), seen]).toEqual(['accepted', 'accepted', [['details', true], ['details', false]]])
  })
})

describe('layouts of your own', () => {
  test('save, change, save changes, pick a preset, come back, delete', () => {
    let s = setRows(fresh(), 'compact')
    expect(s.changed).toBe(true)
    s = saveMine(s, '  My swing board  ', 'm-a')
    expect(s.mine).toEqual([{ id: 'm-a', name: 'My swing board', widgets: s.widgets }])
    expect([s.layoutId, s.changed]).toEqual(['m-a', false])
    expect(currentLayout(s).name).toBe('My swing board')
    s = removeWidget(s, 'details')
    expect(s.changed).toBe(true)
    expect(s.mine[0].widgets).toHaveLength(3) // the saved copy is untouched until "Save changes"
    s = updateMine(s, 'm-a')
    expect([s.mine[0].widgets.length, s.changed]).toEqual([2, false])
    s = pickLayout(s, 'three')
    expect([s.layoutId, s.widgets.length, rowsOf(s)]).toEqual(['three', 4, 'line'])
    s = pickLayout(s, 'm-a')
    expect([s.widgets.length, rowsOf(s)]).toEqual([2, 'compact'])
    s = deleteMine(s, 'm-a')
    expect([s.mine.length, s.layoutId, s.changed]).toEqual([0, null, true])
    expect(s.widgets).toHaveLength(2) // deleting a layout does not clear the board you are looking at
  })
  test('a blank name saves nothing; the list is capped; an unknown id changes nothing', () => {
    const s0 = fresh()
    expect(saveMine(s0, '   ', 'm-a')).toBe(s0)
    let s = s0
    for (let i = 0; i < MAX_MINE; i++) s = saveMine(s, `L${i}`, `m-${i}`)
    expect(saveMine(s, 'one more', 'm-x')).toBe(s)
    expect(pickLayout(s, 'nope')).toBe(s)
    expect(updateMine(s, 'nope')).toBe(s)
    expect(deleteMine(s, 'nope')).toBe(s)
  })
  test('options: only known keys and values are taken', () => {
    const s0 = fresh()
    expect(setOption(s0, 'logos', true).logos).toBe(true)
    expect(setOption(s0, 'screens', 'menu').screens).toBe('menu')
    expect(setOption(s0, 'screens', 'sideways')).toBe(s0)
    expect(setOption(s0, 'widgets', [])).toBe(s0)
    expect(setRows(s0, 'wide')).toBe(s0)
  })
})

describe('sharing a layout, and taking one another member shared', () => {
  test('what is shared is the arrangement and the row style, and nothing else the board holds', () => {
    const s = { ...setRows(saveMine(fresh(), 'Private name', 'm-a'), 'cards'), logos: true, group: true, screens: 'menu' }
    const out = shareable(s)
    expect(Object.keys(out)).toEqual(['widgets'])
    expect(out.widgets).toEqual(s.widgets)
    expect(out.widgets.find(w => w.type === 'results').opts).toEqual({ rows: 'cards' })
    expect(JSON.stringify(out)).not.toMatch(/Private name|logos|group|screens"|mine|layoutId/)
    // a board that somehow cannot be drawn shares the first preset, never garbage
    expect(shareable({ widgets: 'nope' })).toEqual({ widgets: PRESETS[0].widgets })
  })
  test('a taken layout becomes one of your own, picked, as a copy', () => {
    const theirs = [{ id: 'chart', type: 'chart', x: 0, y: 0, w: 24, h: 12 }, { id: 'results', type: 'results', x: 0, y: 12, w: 24, h: 8, opts: { rows: 'chips' } }]
    const s = adoptLayout(fresh(), '  Chart over chips  ', theirs, 'm-z')
    expect(s.mine).toEqual([{ id: 'm-z', name: 'Chart over chips', widgets: theirs }])
    expect([s.layoutId, s.changed, rowsOf(s)]).toEqual(['m-z', false, 'chips'])
    expect(s.widgets).toEqual(theirs)
    expect(s.widgets).not.toBe(s.mine[0].widgets) // editing the board never edits the saved copy
    expect(sanitize(serialize(s)).mine).toEqual(s.mine) // and it survives the preferences
  })
  test('a name already on the menu gets a number; a layout that cannot be drawn, a blank name and a full list change nothing', () => {
    let s = adoptLayout(fresh(), 'Board', PRESETS[1].widgets, 'm-1')
    expect(s.mine[0].name).toBe('Board (2)')
    s = adoptLayout(s, 'board', PRESETS[1].widgets, 'm-2')
    expect(s.mine[1].name).toBe('board (3)')
    expect(freeName(fresh(), 'x'.repeat(60))).toHaveLength(MAX_NAME)
    const long = adoptLayout(fresh(), 'y'.repeat(MAX_NAME), PRESETS[0].widgets, 'm-a')
    expect(freeName(long, 'y'.repeat(MAX_NAME))).toBe(`${'y'.repeat(MAX_NAME - 4)} (2)`)
    const s0 = fresh()
    const pile = [{ type: 'chart', x: 0, y: 0, w: 12, h: 12 }, { type: 'results', x: 4, y: 4, w: 8, h: 8 }]
    expect(adoptLayout(s0, 'Overlapping', pile, 'm-a')).toBe(s0)
    expect(adoptLayout(s0, 'Unknown widgets', [{ type: 'heatmap', x: 0, y: 0, w: 24, h: 20 }], 'm-a')).toBe(s0)
    expect(adoptLayout(s0, '   ', PRESETS[0].widgets, 'm-a')).toBe(s0)
    let full = s0
    for (let i = 0; i < MAX_MINE; i++) full = saveMine(full, `L${i}`, `m-${i}`)
    expect(adoptLayout(full, 'One more', PRESETS[0].widgets, 'm-x')).toBe(full)
  })
})
