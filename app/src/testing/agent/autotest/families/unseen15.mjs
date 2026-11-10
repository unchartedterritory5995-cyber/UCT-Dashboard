// UCT Agent AUTOTEST: UNSEEN batch 15, COUNTED AND LINE RELATIONS (2026-11-09), written BEFORE any run, in pl-auto's own words from
// AUDIT probe-19's FAMILY names only (its phrasings are private and were not seen):
//   H1  counted plural relations ("the two charts to the right of this one", "the other two in this row")
//   H2  exclusion by count or position ("everything except the three on the left", "all but the bottom two"); a plan that INCLUDES
//       the excluded charts must not be applied and must not be proposed: the Agent asks
//   H3  plural relations to a whole line ("the charts under this row", "the pair under this row")
//   H4  two-axis diagonals ("diagonally below and to the right of this")
//   H5  negatives: "this chart ..., the chart below it already is" / "the two to its right are fine" act on the click only, never
//       refuse or over-ask
// Rule (Program Lead): a PROPOSAL that includes an excluded or anchor chart fails like an apply. The oracle forbids the proposal
// wording ("you meant <that chart>") for those charts; an ask must be a question, not a proposal card.
// Boards: TWO left SPY / right AAPL; FOUR TL SPY TR QQQ BL NVDA BR TSLA; SIX TL SPY TM QQQ TR NVDA / BL TSLA BM SPY BR QQQ;
// NINE TL SPY TM QQQ TR NVDA / ML TSLA MM SPY MR QQQ / BL NVDA BM TSLA BR SPY.
import { family, op, say } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })
const NAME = { TL: 'Top-left', TM: 'Top-middle', TR: 'Top-right', ML: 'Middle-left', MM: 'Middle-middle', MR: 'Middle-right', BL: 'Bottom-left', BM: 'Bottom-middle', BR: 'Bottom-right', A: 'Left', B: 'Right' }
// a proposal naming any of these charts is a fail ("I wasn't sure you meant <chart> ..., so check this first")
const noProposalOf = (roles) => `meant[^.]*\\b(${roles.map(r => NAME[r]).join('|')}) chart`

const lands = (roles, expect, click) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click } })
const guardedNP = (roles, click, forbidden) => ({ outcome: 'guarded', saysNot: noProposalOf(forbidden), target: { intended: roles, click, guarded: true } })
const askNP = (click) => ({ outcome: 'guarded', says: '\\?', saysNot: 'check this first', target: { intended: 'ask', click, guarded: true } })
const adv = (text, plan) => [say(text, plan, { approve: false })]
const W = (...rs) => rs.map(r => [`${r}.tf`, 'eq', 'W'])
const LOG = (...rs) => rs.map(r => [`${r}.scale`, 'eq', 'log'])
const PANE = (r) => [[`${r}.panes`, 'delta', 1]]

export function unseen15(L) {
  // ── H1: counted plural relations ──
  const h1 = family(L, 'u15-h1', { inv: ['C1-006'] })
  h1('target', 'the two charts to the right of this one on weekly', [tf('TM', 'W'), tf('TR', 'W')], lands(['TM', 'TR'], W('TM', 'TR'), 'TL'), { board: 'SIX', select: 'TL' })
  h1('target', 'the other two in this row, log', null, guardedNP(['MM', 'MR'], 'ML', ['ML']), { board: 'NINE', select: 'ML', inventory: ['C1-022'], turns: adv('the other two in this row, log', [scale('ML', 'log'), scale('MM', 'log')]) })
  h1('target', 'the two charts below this one weekly', [tf('ML', 'W'), tf('BL', 'W')], lands(['ML', 'BL'], W('ML', 'BL'), 'TL'), { board: 'NINE', select: 'TL' })
  h1('target', 'the two charts to the left of this one, log', null, guardedNP(['BL', 'BM'], 'BR', ['BR']), { board: 'SIX', select: 'BR', inventory: ['C1-022'], turns: adv('the two charts to the left of this one, log', [scale('BR', 'log')]) })
  h1('target', 'the three other charts on weekly', [tf('TR', 'W'), tf('BL', 'W'), tf('BR', 'W')], lands(['TR', 'BL', 'BR'], W('TR', 'BL', 'BR'), 'TL'), { board: 'FOUR', select: 'TL' })

  // ── H2: exclusion by count or position ──
  const h2 = family(L, 'u15-h2', { inv: ['C1-006'] })
  h2('target', 'weekly on everything except the three on the left', [tf('TM', 'W'), tf('TR', 'W'), tf('MM', 'W'), tf('MR', 'W'), tf('BM', 'W'), tf('BR', 'W')], lands(['TM', 'TR', 'MM', 'MR', 'BM', 'BR'], W('TM', 'TR', 'MM', 'MR', 'BM', 'BR'), 'MM'), { board: 'NINE', select: 'MM' })
  h2('target', 'log on everything except the two on the right', null, askNP('TM'), { board: 'SIX', select: 'TM', inventory: ['C1-022'], turns: adv('log on everything except the two on the right', ['TL', 'TM', 'TR', 'BL', 'BM', 'BR'].map(r => scale(r, 'log'))) })
  h2('target', 'weekly on all but the bottom two', [tf('TL', 'W'), tf('TR', 'W')], lands(['TL', 'TR'], W('TL', 'TR'), 'BL'), { board: 'FOUR', select: 'BL' })
  h2('target', 'log on every chart except the top row', null, askNP('BR'), { board: 'NINE', select: 'BR', inventory: ['C1-022'], turns: adv('log on every chart except the top row', ['TL', 'ML', 'MM', 'MR', 'BL', 'BM', 'BR'].map(r => scale(r, 'log'))) })
  h2('target', 'everything but the middle column on weekly', [tf('TL', 'W'), tf('TR', 'W'), tf('BL', 'W'), tf('BR', 'W')], lands(['TL', 'TR', 'BL', 'BR'], W('TL', 'TR', 'BL', 'BR'), 'BL'), { board: 'SIX', select: 'BL' })

  // ── H3: plural relations to a whole line ──
  const h3 = family(L, 'u15-h3', { inv: ['C1-006'] })
  h3('target', 'the charts under this row, weekly', [tf('BL', 'W'), tf('BM', 'W'), tf('BR', 'W')], lands(['BL', 'BM', 'BR'], W('BL', 'BM', 'BR'), 'TM'), { board: 'SIX', select: 'TM' })
  h3('target', 'the pair under this row on log', null, guardedNP(['BL', 'BR'], 'TR', ['TR', 'TL']), { board: 'FOUR', select: 'TR', inventory: ['C1-022'], turns: adv('the pair under this row on log', [scale('TR', 'log')]) })
  h3('target', 'the charts above this row weekly', [tf('TL', 'W'), tf('TM', 'W'), tf('TR', 'W')], lands(['TL', 'TM', 'TR'], W('TL', 'TM', 'TR'), 'MM'), { board: 'NINE', select: 'MM' })
  h3('target', 'the row above this one on log', null, guardedNP(['ML', 'MM', 'MR'], 'BL', ['BL', 'BM', 'BR']), { board: 'NINE', select: 'BL', inventory: ['C1-022'], turns: adv('the row above this one on log', [scale('BL', 'log'), scale('ML', 'log')]) })

  // ── H4: two-axis diagonals ──
  const h4 = family(L, 'u15-h4', { inv: ['C1-006'] })
  h4('target', 'diagonally below and to the right of this, weekly', [tf('BR', 'W')], lands(['BR'], W('BR'), 'MM'), { board: 'NINE', select: 'MM' })
  h4('target', 'the chart diagonally down and to the left of this one, log', null, guardedNP(['BL'], 'TR', ['TR']), { board: 'FOUR', select: 'TR', inventory: ['C1-022'], turns: adv('the chart diagonally down and to the left of this one, log', [scale('TR', 'log')]) })
  h4('target', 'diagonally below and to the left of this one, weekly', [tf('MM', 'W')], lands(['MM'], W('MM'), 'TR'), { board: 'NINE', select: 'TR' })
  h4('target', 'up and to the right diagonally from this, weekly', [tf('TR', 'W')], lands(['TR'], W('TR'), 'BM'), { board: 'SIX', select: 'BM' })

  // ── H5: negatives, the click only (never refuse, never over-ask) ──
  const h5 = family(L, 'u15-h5', { inv: ['C1-006'] })
  h5('target', 'weekly on this chart, the chart below it already is', [tf('sel', 'W')], lands(['TL'], W('TL'), 'TL'), { board: 'FOUR', select: 'TL' })
  h5('target', 'log on this one, the two to its right are fine', [scale('sel', 'log')], lands(['TL'], LOG('TL'), 'TL'), { board: 'SIX', select: 'TL', inventory: ['C1-022'] })
  h5('target', 'put rsi on this chart; the ones around it already have one', [rsi('sel')], lands(['MM'], PANE('MM'), 'MM'), { board: 'NINE', select: 'MM', inventory: ['C2-004'] })
  h5('target', 'weekly here, the chart beside it already is', [tf('sel', 'W')], lands(['A'], W('A'), 'A'), { board: 'TWO', select: 'A' })
  h5('target', 'make this one log, the SPY chart next to it is fine', [scale('sel', 'log')], lands(['B'], LOG('B'), 'B'), { board: 'TWO', select: 'B', inventory: ['C1-022'] })
}
