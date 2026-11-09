// UCT Agent AUTOTEST: UNSEEN batch 10, RELATIONS (2026-11-09), written BEFORE any run and without reading deixis.js or #988's tests:
// independent evidence for the relative-reference fix (PR #988). Boards FOUR (2 x 2), SIX (3 x 2), THREE (1 x 3) and NINE (3 x 3).
//
// Rule for every case: the result is ONE named chart, or an ask naming the real charts. It is NEVER the clicked chart when a relation
// is anchored on the click ("from this one", "it", "the selected one", "here"). Two kinds of plan:
//   honest     the scripted plan already targets the right chart: the product must not move it onto the click (the u9-refs-boards-07
//              P1: the plan said bottom-right, the clicked top-left changed)
//   adversary  the scripted plan targets the CLICKED chart (a model's bad guess): the product must not apply it there. Landing on the
//              intended chart, or applying nothing and asking, passes; landing on the click fails (selectionOracle `guarded`)
// Negatives: a bare "this" / "here" / "it" with no relation still means the click; "opposite" in a non-chart sense names no chart.
// BROWSER-MOCK-MODEL: plans are scripted; the oracle reads the board and the selection record.
import { family, op, say } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })

// an honest case: lands on exactly `roles`, graded on the sentence by the selection oracle
const lands = (roles, expect, click) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click } })
// an adversary case: the plan guessed the click; the intended chart, or an ask with nothing applied, both pass
const guarded = (roles, click) => ({ outcome: 'guarded', target: { intended: roles, click, guarded: true } })
// an unplaceable relation: the scripted plan guesses the click (or the first chart); nothing may land, and the Agent asks, naming
// real charts (its OWN question: the scripted plan never asks here)
const askNaming = (click, names) => ({ outcome: 'guarded', says: names, target: { intended: 'ask', click, guarded: true } })

export function unseen10(L) {
  const f = family(L, 'u10-four', { inv: ['C1-006'], board: 'FOUR' })
  f('target', 'switch the chart kitty-corner from this one to weekly', [tf('BR', 'W')], lands(['BR'], [['BR.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  f('target', 'log scale on the one in the far corner from here', [scale('TL', 'log')], lands(['TL'], [['TL.scale', 'eq', 'log']], 'BR'), { select: 'BR', inventory: ['C1-022'] })
  f('target', 'add rsi to the chart catty-corner to the selected one', [rsi('BL')], lands(['BL'], [['BL.panes', 'delta', 1]], 'TR'), { select: 'TR', inventory: ['C2-004'] })
  f('target', 'weekly on the chart across from it diagonally', [tf('TR', 'W')], lands(['TR'], [['TR.tf', 'eq', 'W']], 'BL'), { select: 'BL' })
  f('target', 'set this to the weekly', [tf('sel', 'W')], lands(['BR'], [['BR.tf', 'eq', 'W']], 'BR'), { select: 'BR' })
  f('target', 'draw a resistance line here at 120, the opposite of support', [op('drawing.addLevel', dr('sel'), { price: 120, color: null, style: null })], lands(['TL'], [['drawings.SPY', 'len', 1]], 'TL'), { select: 'TL', inventory: ['C1-131'] })
  f('target', 'make the diagonal one weekly', null, askNaming(null, 'Top-left|Top-right|Bottom-left|Bottom-right'), { select: null, turns: [say('make the diagonal one weekly', [tf('TL', 'W')], { approve: false })] })
  f('target', 'the chart diagonally across from this one on weekly', null, guarded(['BR'], 'TL'), { select: 'TL', turns: [say('the chart diagonally across from this one on weekly', [tf('TL', 'W')], { approve: false })] })
  f('target', 'put rsi on the corner opposite here', null, guarded(['TL'], 'BR'), { select: 'BR', inventory: ['C2-004'], turns: [say('put rsi on the corner opposite here', [rsi('BR')], { approve: false })] })

  const s = family(L, 'u10-six', { inv: ['C1-006'], board: 'SIX' })
  s('target', 'the chart in the opposite corner from this one on weekly', [tf('BR', 'W')], lands(['BR'], [['BR.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  s('target', 'the diagonal from this one weekly', null, askNaming('TM', 'Bottom-left|Bottom-right'), { select: 'TM', turns: [say('the diagonal from this one weekly', [tf('TM', 'W')], { approve: false })] })
  s('target', 'add rsi to the one directly above it', [rsi('TL')], lands(['TL'], [['TL.panes', 'delta', 1]], 'BL'), { select: 'BL', inventory: ['C2-004'] })
  s('target', 'put the chart beneath this one on log', [scale('BR', 'log')], lands(['BR'], [['BR.scale', 'eq', 'log']], 'TR'), { select: 'TR', inventory: ['C1-022'] })
  s('target', 'both neighbours of this one on the weekly', [tf('BL', 'W'), tf('BR', 'W')], lands(['BL', 'BR'], [['BL.tf', 'eq', 'W'], ['BR.tf', 'eq', 'W']], 'BM'), { select: 'BM' })
  s('target', 'weekly candles here please', [tf('sel', 'W')], lands(['BM'], [['BM.tf', 'eq', 'W']], 'BM'), { select: 'BM' })
  s('target', 'the opposite corner from the selected chart, weekly', null, guarded(['TL'], 'BR'), { select: 'BR', turns: [say('the opposite corner from the selected chart, weekly', [tf('BR', 'W')], { approve: false })] })

  const t = family(L, 'u10-three', { inv: ['C1-006'], board: 'THREE' })
  t('target', 'the chart at the far end from this one weekly', [tf('R', 'W')], lands(['R'], [['R.tf', 'eq', 'W']], 'L'), { select: 'L' })
  t('target', 'the diagonal chart from here weekly', null, askNaming('M', 'Left|Right|Middle'), { select: 'M', turns: [say('the diagonal chart from here weekly', [tf('M', 'W')], { approve: false })] })
  t('target', 'the one next door to this on the weekly', [tf('M', 'W')], lands(['M'], [['M.tf', 'eq', 'W']], 'R'), { select: 'R' })

  const n = family(L, 'u10-nine', { inv: ['C1-006'], board: 'NINE' })
  n('target', 'weekly on the chart in the opposite corner from this one', [tf('BR', 'W')], lands(['BR'], [['BR.tf', 'eq', 'W']], 'TL'), { select: 'TL' })
  n('target', 'the chart diagonally up and to the left of this one, weekly', [tf('TL', 'W')], lands(['TL'], [['TL.tf', 'eq', 'W']], 'MM'), { select: 'MM' })
  n('target', 'two charts below this one on log', [scale('BR', 'log')], lands(['BR'], [['BR.scale', 'eq', 'log']], 'TR'), { select: 'TR', inventory: ['C1-022'] })
  n('target', 'the chart opposite this one weekly', null, askNaming('MM', 'Top|Bottom|Left|Right'), { select: 'MM', turns: [say('the chart opposite this one weekly', [tf('MM', 'W')], { approve: false })] })
  n('target', 'make it weekly', [tf('sel', 'W')], lands(['MR'], [['MR.tf', 'eq', 'W']], 'MR'), { select: 'MR' })
  n('target', 'the corner diagonal from here on weekly', null, guarded(['TL'], 'BR'), { select: 'BR', turns: [say('the corner diagonal from here on weekly', [tf('BR', 'W')], { approve: false })] })
}
