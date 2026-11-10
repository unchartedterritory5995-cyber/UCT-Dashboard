// UCT Agent AUTOTEST: UNSEEN batch 17, MULTI CHART GRID (2026-11-10), written BEFORE any run and before pl-grid's
// agent/pl/exec-multichart-grid lands, in pl-auto's own words (pl-grid's held-out family file was not read for phrasings; only the
// capability's op names and argument shape were read, so a plan can be scripted at all):
//   multiChart.set   target = the grid ($grid): layout (rows x cols, or both null = open it) / exit / syncCrosshair / syncTimeRange /
//                    groupsMode / applySaved / saveGrid / deleteSaved / openSettings / restoreGrid
//   multiChart.cell  target = ONE cell (a chart ref): maximize / resetToMine
// Boards (boards.mjs): G4 2x2 TL SPY TR NVDA BL AMD BR TSLA; G6 2x3 TL QQQ TM SPY TR NVDA / BL TSLA BM AMD BR AAPL; G9 3x3 TL SPY TM QQQ
// TR NVDA / ML TSLA MM AMD MR AAPL / BL MSFT BM META BR AVGO; an F suffix = every cell has its own settings (forked); G4X both syncs
// on; GWS the grid kept while the Charts board is on screen. The saved grid "Fixture Grid" is the member's own (layouts=1).
// Oracles read the grid as PERSISTED (multichart_state) plus the maximized cell and the Shared Chart Settings dialog on screen
// (driver snapshot `grid`), never the receipt. A cell op lands where the cell's `cell` read (max / fork) or its chart print moved.
// Plan kinds as in unseen10-16: honest (plan right), adversary (plan guessed wrong: landing as intended or asking passes, landing
// anywhere else fails), ask (nothing may land and the Agent asks). BROWSER-MOCK-MODEL: plans are scripted.
import { family, op, say, refuses } from './dsl.mjs'

const G = '$grid'
const gset = (o, extra = {}) => op('multiChart.set', G, { op: o, rows: null, cols: null, on: null, name: null, direction: null, ...extra })
const layout = (rows, cols) => gset('layout', { rows, cols })
const cell = (r, o) => op('multiChart.cell', `$chart:${r}`, { op: o })
const tf = (r, t) => op('chart.setTimeframe', `$chart:${r}`, { timeframe: t })
const g = (k, want) => [`grid.${k}`, 'eq', want]
const grid = (expect, o = {}) => ({ outcome: 'change', expect, undo: true, ...o })
const lands = (roles, expect, click, o = {}) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click }, ...o })
const guarded = (roles, click) => ({ outcome: 'guarded', target: { intended: roles, click, guarded: true } })
const ask = (click, says = '\\?') => ({ outcome: 'guarded', says, target: { intended: 'ask', click, guarded: true } })
const adv = (text, plan) => [say(text, plan, { approve: false })]
const FORK4 = (...off) => ['TL', 'TR', 'BL', 'BR'].map(r => !off.includes(r))
const FORK6 = (...off) => ['TL', 'TM', 'TR', 'BL', 'BM', 'BR'].map(r => !off.includes(r))

export function unseen17(L) {
  // ── the grid's shape: a preset, a custom rows x columns, too big, open, leave ──
  const s = family(L, 'u17-layout', { inv: ['C3-042'], board: 'G4', select: null })
  s('phrasing', 'switch multi chart to three across, two down', [layout(2, 3)], grid([g('layout', '2x3'), g('cells', 6)]))
  s('phrasing', 'give me a 3 by 3 grid of charts', [layout(3, 3)], grid([g('layout', '3x3'), g('cells', 9)]))
  s('params', 'go down to just two charts side by side', [layout(1, 2)], grid([g('layout', '1x2'), g('cells', 2)], { confirm: true }))
  s('params', 'custom grid please, four rows and two columns', [layout(4, 2)], grid([g('layout', '4x2'), g('cells', 8)]), { board: 'G6', inventory: ['C3-043'] })
  s('invalid', 'make it a 5x5 grid', [layout(5, 5)], refuses({ expect: [g('layout', '2x2')] }), { inventory: ['C3-043'] })
  s('phrasing', 'open multi chart', [gset('layout')], grid([g('mode', 'grid'), g('open', true)]), { board: 'GWS' })
  s('phrasing', 'take me out of the grid, back to my normal board', [gset('exit')], grid([g('mode', 'workspace')]), { inventory: ['C3-044'] })
  // a negative on the grid: the shape stays, one chart changes
  s('target', 'leave the grid layout as it is and just make the top left one weekly', [tf('TL', 'W')], lands(['TL'], [['TL.tf', 'eq', 'W'], g('layout', '2x2')], null), { inventory: ['C3-056'] })

  // ── the two syncs ──
  const y = family(L, 'u17-sync', { inv: ['C3-045'], board: 'G4', select: null })
  y('phrasing', 'link the crosshairs across all the charts', [gset('syncCrosshair', { on: true })], grid([g('syncCrosshair', true), g('syncTimeRange', false)]))
  y('phrasing', 'when I scroll one cell, scroll them all', [gset('syncTimeRange', { on: true })], grid([g('syncTimeRange', true), g('syncCrosshair', false)]), { inventory: ['C3-046'] })
  y('phrasing', 'stop syncing the crosshair', [gset('syncCrosshair', { on: false })], grid([g('syncCrosshair', false), g('syncTimeRange', true)]), { board: 'G4X' })
  y('combo', 'turn off time sync but keep the crosshair linked', [gset('syncTimeRange', { on: false })], grid([g('syncTimeRange', false), g('syncCrosshair', true)]), { board: 'G4X', inventory: ['C3-046'] })
  y('multistep', 'sync both the crosshair and the time range', [gset('syncCrosshair', { on: true }), gset('syncTimeRange', { on: true })], grid([g('syncCrosshair', true), g('syncTimeRange', true)]), { inventory: ['C3-045', 'C3-046'] })

  // ── Groups mode on / off ──
  const m = family(L, 'u17-groups', { inv: ['C3-047'], board: 'G4', select: null })
  m('phrasing', 'turn groups mode on for the grid', [gset('groupsMode', { on: true })], grid([g('groupsMode', true)]))
  m('followup', [say('groups mode on', [gset('groupsMode', { on: true })]), say('actually switch groups back off', [gset('groupsMode', { on: false })])], null, grid([g('groupsMode', false)], { undo: false }), { inventory: ['C3-051'] })

  // ── saved grids and the shared settings ──
  const v = family(L, 'u17-saved', { inv: ['C3-053'], board: 'G4', select: null })
  v('phrasing', 'save this grid as Earnings Watch', [gset('saveGrid', { name: 'Earnings Watch' })], grid([['layouts', 'has', 'Earnings Watch']], { undo: false }))
  v('phrasing', 'load my Fixture Grid', [gset('applySaved', { name: 'Fixture Grid' })], grid([['grid.syms', 'changed']]), { inventory: ['C3-052'] })
  v('phrasing', 'get rid of the saved grid called Fixture Grid', [gset('deleteSaved', { name: 'Fixture Grid' })], grid([['layouts', 'lacks', 'Fixture Grid']], { confirm: true, undo: false }), { inventory: ['C3-055'] })
  v('invalid', 'open my saved grid called Night Shift', [gset('applySaved', { name: 'Night Shift' })], refuses({ expect: [g('layout', '2x2')] }), { inventory: ['C3-052'] })
  v('phrasing', 'open the shared chart settings for the grid', [gset('openSettings')], grid([g('settingsOpen', true)], { undo: false }), { inventory: ['C3-061'] })

  // ── ONE cell: maximize ──
  const x = family(L, 'u17-max', { inv: ['C3-060'] })
  x('target', 'maximize this one', [cell('sel', 'maximize')], lands(['TR'], [g('max', 'g1')], 'TR'), { board: 'G4', select: 'TR' })
  x('target', 'blow up the chart next to SPY so it fills the grid', [cell('TR', 'maximize')], lands(['TR'], [g('max', 'g1')], 'BL'), { board: 'G4', select: 'BL' })
  x('target', 'maximize the cell next to NVDA', null, guarded(['TM'], 'BL'), { board: 'G6', select: 'BL', turns: adv('maximize the cell next to NVDA', [cell('TR', 'maximize')]) })
  x('target', 'maximize the cell next to SPY', null, ask('TL', 'Left|Right|which|\\?'), { board: 'G6', select: 'TL', turns: adv('maximize the cell next to SPY', [cell('TL', 'maximize')]) })
  x('target', 'make the one in the very middle full size', [cell('MM', 'maximize')], lands(['MM'], [g('max', 'g4')], 'TL'), { board: 'G9', select: 'TL' })
  x('target', 'maximize the bottom right one, not the one I clicked', null, guarded(['BR'], 'TL'), { board: 'G9', select: 'TL', turns: adv('maximize the bottom right one, not the one I clicked', [cell('sel', 'maximize')]) })
  x('target', 'expand the AAPL cell', [cell('MR', 'maximize')], lands(['MR'], [g('max', 'g5')], 'BL'), { board: 'G9', select: 'BL' })
  x('target', 'maximize the chart', null, ask(null), { board: 'G6', select: null, turns: adv('maximize the chart', [cell('TL', 'maximize')]) })
  x('followup', [say('maximize the AMD chart', [cell('BL', 'maximize')]), say('ok put the grid back to normal', [gset('restoreGrid')])], null, grid([g('max', null)], { undo: false }), { board: 'G4', select: null })

  // ── ONE cell (or several): reset to my chart ──
  const r = family(L, 'u17-reset', { inv: ['C3-059'] })
  r('target', 'reset this cell to my chart', [cell('sel', 'resetToMine')], lands(['TR'], [g('forked', FORK4('TR'))], 'TR', { undo: true }), { board: 'G4F', select: 'TR' })
  r('target', 'reset every cell except the top row to my chart', [cell('BL', 'resetToMine'), cell('BR', 'resetToMine')], lands(['BL', 'BR'], [g('forked', FORK4('BL', 'BR'))], 'TL'), { board: 'G4F', select: 'TL' })
  r('target', 'reset every cell except the top row', null, guarded(['BL', 'BM', 'BR'], 'TL'), { board: 'G6F', select: 'TL', turns: adv('reset every cell except the top row', [cell('TR', 'resetToMine'), cell('BL', 'resetToMine'), cell('BM', 'resetToMine'), cell('BR', 'resetToMine')]) })
  r('target', 'reset all the cells to my chart but leave this cell alone', [cell('TL', 'resetToMine'), cell('TM', 'resetToMine'), cell('TR', 'resetToMine'), cell('BL', 'resetToMine'), cell('BR', 'resetToMine')], lands(['TL', 'TM', 'TR', 'BL', 'BR'], [g('forked', FORK6('TL', 'TM', 'TR', 'BL', 'BR'))], 'BM'), { board: 'G6F', select: 'BM' })
  r('target', 'leave this cell alone and reset the one above it', null, guarded(['TR'], 'BR'), { board: 'G4F', select: 'BR', turns: adv('leave this cell alone and reset the one above it', [cell('sel', 'resetToMine')]) })
  r('target', 'reset the cell under this one, this one is fine', [cell('BL', 'resetToMine')], lands(['BL'], [g('forked', FORK4('BL'))], 'TL'), { board: 'G4F', select: 'TL' })
  r('target', 'reset the middle one to my chart', null, ask('TL', 'Top|Bottom|which|\\?'), { board: 'G6F', select: 'TL', turns: adv('reset the middle one to my chart', [cell('TM', 'resetToMine')]) })
  r('target', 'don\'t touch this one, reset the TSLA cell', null, guarded(['BL'], 'TM'), { board: 'G6F', select: 'TM', turns: adv('don\'t touch this one, reset the TSLA cell', [cell('sel', 'resetToMine')]) })
}
