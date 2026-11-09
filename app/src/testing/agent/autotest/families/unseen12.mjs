// UCT Agent AUTOTEST: UNSEEN batch 12, RELATIONS III (2026-11-09), written BEFORE any run and without reading deixis.js or any #988
// test: 22 NEW phrasings about rows, columns and line ordinals ("the first chart in this row", "the last chart in this column",
// "same column, other row", "the rest of this row", "one row down", "one column right"), possessives ("its neighbour", "its
// right-hand neighbour", "the chart above it"), placement ("put rsi on the ..."), and the anchorless "the chart next door". Boards
// FOUR (2 x 2), SIX (3 x 2), THREE (1 x 3), NINE (3 x 3).
//
// Same rule and the same three plan kinds as unseen10 / unseen11:
//   honest     the scripted plan already targets the right chart: the product must not move it onto the click
//   adversary  the scripted plan targets the CLICKED chart: landing on the intended chart, or applying nothing and asking, passes;
//              landing on the click fails (selectionOracle `guarded`)
//   askNaming  the words name no single chart here (nothing below the bottom row; two charts are next door to the middle one):
//              nothing may land, and the Agent asks, naming real charts other than the anchor
// Negatives (4): "this" beside a row / neighbour / middle word that is NOT the target ("same as the rest of the row", "not its
// neighbour", "the one in the middle" said of the clicked middle chart, "this one, the first in its row") still means the click.
// BROWSER-MOCK-MODEL: plans are scripted; the oracle reads the board and the selection record.
import { family, op, say } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })

const lands = (roles, expect, click) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click } })
const guarded = (roles, click) => ({ outcome: 'guarded', target: { intended: roles, click, guarded: true } })
const askNaming = (click, names) => ({ outcome: 'guarded', says: names, target: { intended: 'ask', click, guarded: true } })
const adv = (text, plan) => [say(text, plan, { approve: false })]
const W = (r) => [[`${r}.tf`, 'eq', 'W']]
const LOG = (r) => [[`${r}.scale`, 'eq', 'log']]
const PANE = (r) => [[`${r}.panes`, 'delta', 1]]

export function unseen12(L) {
  const s = family(L, 'u12-six', { inv: ['C1-006'], board: 'SIX' })
  s('target', 'the first chart in this row on weekly', [tf('TL', 'W')], lands(['TL'], W('TL'), 'TR'), { select: 'TR' })
  s('target', 'put rsi on the last chart in this row', null, guarded(['BR'], 'BL'), { select: 'BL', inventory: ['C2-004'], turns: adv('put rsi on the last chart in this row', [rsi('BL')]) })
  s('target', 'same column, other row: weekly', [tf('BM', 'W')], lands(['BM'], W('BM'), 'TM'), { select: 'TM' })
  s('target', 'log on the chart in the same column but the other row', null, guarded(['TR'], 'BR'), { select: 'BR', inventory: ['C1-022'], turns: adv('log on the chart in the same column but the other row', [scale('BR', 'log')]) })
  s('target', 'step one column right from this chart and make that weekly', [tf('BM', 'W')], lands(['BM'], W('BM'), 'BL'), { select: 'BL' })
  s('target', 'put rsi on the chart one row down from this one', null, guarded(['BR'], 'TR'), { select: 'TR', inventory: ['C2-004'], turns: adv('put rsi on the chart one row down from this one', [rsi('TR')]) })
  s('target', 'make this chart weekly, same as the rest of the row', [tf('sel', 'W')], lands(['TL'], W('TL'), 'TL'), { select: 'TL' })

  const n = family(L, 'u12-nine', { inv: ['C1-006'], board: 'NINE' })
  n('target', 'the middle chart of this column on weekly', [tf('ML', 'W')], lands(['ML'], W('ML'), 'TL'), { select: 'TL' })
  n('target', 'the last chart in this column on log', [scale('BM', 'log')], lands(['BM'], LOG('BM'), 'TM'), { select: 'TM', inventory: ['C1-022'] })
  n('target', 'its neighbour to the left, weekly', null, guarded(['MM'], 'MR'), { select: 'MR', turns: adv('its neighbour to the left, weekly', [tf('MR', 'W')]) })
  n('target', 'the chart above it on log', [scale('MR', 'log')], lands(['MR'], LOG('MR'), 'BR'), { select: 'BR', inventory: ['C1-022'] })
  n('target', 'the rest of this row on weekly', null, guarded(['MM', 'MR'], 'ML'), { select: 'ML', turns: adv('the rest of this row on weekly', [tf('ML', 'W')]) })
  n('target', 'same row, far end from this one, weekly', [tf('BR', 'W')], lands(['BR'], W('BR'), 'BL'), { select: 'BL' })
  n('target', 'the chart one row below this one, weekly', null, askNaming('BM', 'Middle-|Top-|Bottom-left|Bottom-right'), { select: 'BM', turns: adv('the chart one row below this one, weekly', [tf('BM', 'W')]) })
  n('target', 'weekly on this one, the first chart in its row', [tf('sel', 'W')], lands(['ML'], W('ML'), 'ML'), { select: 'ML' })

  const f = family(L, 'u12-four', { inv: ['C1-006'], board: 'FOUR' })
  f('target', 'put rsi on the other chart in this column', null, guarded(['BR'], 'TR'), { select: 'TR', inventory: ['C2-004'], turns: adv('put rsi on the other chart in this column', [rsi('TR')]) })
  f('target', 'the first chart in the bottom row on weekly', [tf('BL', 'W')], lands(['BL'], W('BL'), 'TR'), { select: 'TR' })
  f('target', 'add rsi to this one, not its neighbour', [rsi('sel')], lands(['BL'], PANE('BL'), 'BL'), { select: 'BL', inventory: ['C2-004'] })

  const t = family(L, 'u12-three', { inv: ['C1-006'], board: 'THREE' })
  t('target', 'the chart next door on weekly', [tf('M', 'W')], lands(['M'], W('M'), 'L'), { select: 'L' })
  t('target', 'make the chart next door log', null, guarded(['M'], 'R'), { select: 'R', inventory: ['C1-022'], turns: adv('make the chart next door log', [scale('R', 'log')]) })
  t('target', 'weekly for the chart next door', null, askNaming('M', 'Left|Right'), { select: 'M', turns: adv('weekly for the chart next door', [tf('M', 'W')]) })
  t('target', 'its right-hand neighbour on weekly', [tf('M', 'W')], lands(['M'], W('M'), 'L'), { select: 'L' })
  t('target', 'put rsi on this chart, the one in the middle', [rsi('sel')], lands(['M'], PANE('M'), 'M'), { select: 'M', inventory: ['C2-004'] })
}
