// AUDIT #1027 point 1: the FULL list of keys UCT Agent can press on a widget (an `action` row, run through the door's act(key)),
// each tagged read / write / destructive. Fails when:
//   • an `action` row has no tag, or a tag outside the three;
//   • a widget's door source can press a key (`key === '<k>'` inside its act) that no tagged row lists — a new button is never
//     pressable by accident;
//   • the pinned list changes (a new pressable key is a reviewed change: add it here, with its tag);
//   • widget.setOption would press anything but a 'read' button (write / destructive / untagged are refused before any door).
// Evidence: LOCAL, vitest; the source scan reads the real files; the refusal runs the real capability's check.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { widgetControls } from './widgetNames'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(SRC, p), 'utf8')
const TAGS = ['read', 'write', 'destructive']
// every pressable key, by widget type → [key, effect]. A reviewed list: change it on purpose.
const PINNED = {
  scanner: [['refresh', 'read']],
  periodsort: [['refresh', 'read']],
}
// the files whose door has an act(key) (a door is `useWidgetDoor(() => ({ … act: … }))`)
const DOOR_FILES = {
  scanner: 'pages/charts/widgets/ScannerResults.jsx',
  periodsort: 'pages/charts/widgets/PeriodSortWidget.jsx',
}
const actionRows = () => Object.keys(WIDGET_REGISTRY).flatMap(t => widgetControls(t).filter(f => f.type === 'action').map(f => [t, f]))

describe('the keys UCT Agent can press on a widget', () => {
  it('every action row is tagged read / write / destructive', () => {
    const bad = actionRows().filter(([, f]) => !TAGS.includes(f.effect)).map(([t, f]) => `${t}.${f.key}`)
    expect(bad).toEqual([])
  })
  it('the full list is the pinned list (a new pressable key is a reviewed change)', () => {
    const now = {}
    for (const [t, f] of actionRows()) (now[t] ||= []).push([f.key, f.effect])
    expect(now).toEqual(PINNED)
  })
  it('no door can press a key no tagged row lists; every door with act() is in the scan', () => {
    const files = [...new Set(Object.values(DOOR_FILES))]
    // any widget source with an act: in its door must be listed above, so a new one is scanned
    const all = [...readdirSync(resolve(SRC, 'pages/charts/widgets')).filter(n => /\.jsx$/.test(n) && !/\.test\./.test(n)).map(n => `pages/charts/widgets/${n}`),
      'pages/Watchlists.jsx', 'pages/ThemeTrackerPage.jsx']
    for (const f of all) {
      const s = read(f); const at = s.indexOf('useWidgetDoor(')
      const door = at < 0 ? '' : s.slice(at, s.indexOf('\n\n', at))
      if (/\bact:/.test(door)) expect(files, `${f} has a door act(): list it in DOOR_FILES`).toContain(f)
    }
    for (const [t, f] of Object.entries(DOOR_FILES)) {
      const s = read(f); const at = s.indexOf('useWidgetDoor(')
      const door = s.slice(at, s.indexOf('\n\n', at))
      const act = door.slice(door.indexOf('act:'))
      const keys = [...act.matchAll(/key === '([^']+)'/g)].map(m => m[1])
      expect(keys.length, `${f}: act() presses something`).toBeGreaterThan(0)
      for (const k of keys) expect(PINNED[t]?.map(([x]) => x), `${t}: act('${k}') has no tagged row`).toContain(k)
    }
  })
  it('widget.setOption presses only a read button: a write / destructive / untagged action is refused before the door', async () => {
    await registerBuiltins()
    const cap = getCapability('widget.setOption')
    const door = { act: () => { throw new Error('pressed') } }
    const st = { board: [{ id: 'x', type: 'scanner', opts: { scanKey: 'ipo-1y' } }], doors: {} }
    const env = { target: { doorOf: () => door } }
    expect(cap.check(st, { widget: 'x', key: 'refresh', value: 'run' }, env)).toBe(null)
    const rows = widgetControls('scanner')
    const row = rows.find(f => f.key === 'refresh')
    for (const effect of ['write', 'destructive', undefined]) {
      const was = row.effect
      row.effect = effect
      try { expect(cap.check(st, { widget: 'x', key: 'refresh', value: 'run' }, env), String(effect)).toMatch(/can't press/) } finally { row.effect = was }
    }
  })
  it('AUDIT #1027 (3): a button is pressed at most ONCE per widget per request (a second press in the same plan is refused)', async () => {
    await registerBuiltins()
    const cap = getCapability('widget.setOption')
    const env = { target: { doorOf: () => ({ act: () => Promise.resolve() }) } }
    const st0 = { board: [{ id: 'x', type: 'scanner', opts: { scanKey: 'ipo-1y' } }, { id: 'y', type: 'scanner', opts: { scanKey: 'ipo-1y' } }], doors: {}, acts: [] }
    const a = { widget: 'x', key: 'refresh', value: 'run' }
    expect(cap.check(st0, a, env)).toBe(null)
    const st1 = cap.apply(st0, a, env)
    expect(cap.check(st1, a, env)).toMatch(/already being pressed once/)
    expect(cap.check(st1, { ...a, widget: 'y' }, env)).toBe(null)          // another widget's own button is its own press
  })
})
