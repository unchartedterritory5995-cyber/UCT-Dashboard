// UCT Agent AUTOTEST: UNSEEN batch 11, RELATIONS II (2026-11-09), written BEFORE any run and without reading deixis.js or any #988
// test: 20 NEW relation phrasings, mostly vocabulary unseen10 did not use (to the right of, straight below, underneath, one over, the
// other side of the row, every chart in this column except, sitting on top of, immediately left, two over, beside, up one row, either
// side, the same side, just right of, furthest from). Boards FOUR (2 x 2), SIX (3 x 2), THREE (1 x 3), NINE (3 x 3).
//
// Same rule and the same three plan kinds as unseen10:
//   honest     the scripted plan already targets the right chart: the product must not move it onto the click
//   adversary  the scripted plan targets the CLICKED chart: landing on the intended chart, or applying nothing and asking, passes;
//              landing on the click fails (selectionOracle `guarded`)
//   askNaming  the relation names no chart on this board (no left of the leftmost chart, nothing above a one-row board): nothing
//              may land, and the Agent asks, naming real charts other than the anchor
// Negatives (2): an anchor ("here", "this one") next to a spatial word that is NOT a relation between charts ("below the price",
// "leave the charts around it alone") still means the click. They guard against a structural rule that over-refuses.
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

export function unseen11(L) {
  const f = family(L, 'u11-four', { inv: ['C1-006'], board: 'FOUR' })
  f('target', 'make the chart to the right of this one weekly', [tf('TR', 'W')], lands(['TR'], [['TR.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  f('target', 'log on the chart straight below the selected one', [scale('BR', 'log')], lands(['BR'], [['BR.scale', 'eq', 'log']], 'TR'), { select: 'TR', inventory: ['C1-022'] })
  f('target', 'the chart next to this one on the left, weekly', null, guarded(['TL'], 'TR'), { select: 'TR', turns: adv('the chart next to this one on the left, weekly', [tf('TR', 'W')]) })
  f('target', 'add rsi to whichever chart sits underneath this one', null, guarded(['BL'], 'TL'), { select: 'TL', inventory: ['C2-004'], turns: adv('add rsi to whichever chart sits underneath this one', [rsi('TL')]) })
  f('target', 'add rsi here, below the price', [rsi('sel')], lands(['BR'], [['BR.panes', 'delta', 1]], 'BR'), { select: 'BR', inventory: ['C2-004'] })

  const s = family(L, 'u11-six', { inv: ['C1-006'], board: 'SIX' })
  s('target', 'the chart one over to the right from the selected one on weekly', [tf('TM', 'W')], lands(['TM'], [['TM.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  s('target', 'the chart on the other side of the top row from this one, log', [scale('TR', 'log')], lands(['TR'], [['TR.scale', 'eq', 'log']], 'TL'), { select: 'TL', inventory: ['C1-022'] })
  s('target', 'weekly on every chart in this column except this one', [tf('BM', 'W')], lands(['BM'], [['BM.tf', 'eq', 'W']], 'TM'), { select: 'TM' })
  s('target', 'the chart sitting right on top of this one, weekly', null, guarded(['TR'], 'BR'), { select: 'BR', turns: adv('the chart sitting right on top of this one, weekly', [tf('BR', 'W')]) })
  s('target', 'the chart to the left of this one weekly', null, askNaming('TL', 'Top-middle|Top-right|Bottom-left|Bottom-middle|Bottom-right'), { select: 'TL', turns: adv('the chart to the left of this one weekly', [tf('TL', 'W')]) })

  const t = family(L, 'u11-three', { inv: ['C1-006'], board: 'THREE' })
  t('target', 'the chart immediately to the left of this one on log', [scale('L', 'log')], lands(['L'], [['L.scale', 'eq', 'log']], 'M'), { select: 'M', inventory: ['C1-022'] })
  t('target', 'make the chart two over from this one weekly', [tf('R', 'W')], lands(['R'], [['R.tf', 'eq', 'W']], 'L'), { select: 'L' })
  t('target', 'the chart beside this one on the right, weekly', null, guarded(['R'], 'M'), { select: 'M', turns: adv('the chart beside this one on the right, weekly', [tf('M', 'W')]) })
  t('target', 'the chart above this one weekly', null, askNaming('L', 'Middle|Right'), { select: 'L', turns: adv('the chart above this one weekly', [tf('L', 'W')]) })

  const n = family(L, 'u11-nine', { inv: ['C1-006'], board: 'NINE' })
  n('target', 'the chart directly up one row from this one, weekly', [tf('MM', 'W')], lands(['MM'], [['MM.tf', 'eq', 'W']], 'BM'), { select: 'BM' })
  n('target', 'both charts on either side of this one on log', [scale('ML', 'log'), scale('MR', 'log')], lands(['ML', 'MR'], [['ML.scale', 'eq', 'log'], ['MR.scale', 'eq', 'log']], 'MM'), { select: 'MM', inventory: ['C1-022'] })
  n('target', 'the chart in the bottom corner on the same side as this one, weekly', [tf('BL', 'W')], lands(['BL'], [['BL.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  n('target', 'add rsi to the chart just right of the selected one', null, guarded(['MM'], 'ML'), { select: 'ML', inventory: ['C2-004'], turns: adv('add rsi to the chart just right of the selected one', [rsi('ML')]) })
  n('target', 'the chart furthest from this one, weekly', null, guarded(['BL'], 'TR'), { select: 'TR', turns: adv('the chart furthest from this one, weekly', [tf('TR', 'W')]) })
  n('target', 'weekly on this one, leave the charts around it alone', [tf('sel', 'W')], lands(['MM'], [['MM.tf', 'eq', 'W']], 'MM'), { select: 'MM' })
}
