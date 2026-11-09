// UCT Agent AUTOTEST: UNSEEN batch 14, TICKER ANCHORS (2026-11-09), written BEFORE any run, in pl-auto's own words (not AUDIT's
// probe-18 wording, which pl-auto has not read), sampling the five probe-18 FAMILIES the Program Lead named:
//   G1  a ticker-named anchor ("under / right of the <TICKER> chart"), including when the ticker chart is the click, and a ticker
//       that names several charts (ask)
//   G2  relations from an absolutely named corner chart ("right of the top-left one", "below the top-right corner chart")
//   G3  exclusion by ticker inside a line ("everything in this row except <TICKER>"); a plan that includes the excluded chart must
//       be ASKED (nothing lands), never proposed or applied
//   G4  a ticker target plus "the one to its right", where "its" is the ticker chart, not the click
//   G5  negatives: "this one ..., the <TICKER> chart <relation> is fine" acts on the click only
// Plan kinds as in unseen10-12: honest (plan already right), adversary (plan guessed the click: landing on the intended chart or
// asking passes, landing on the click fails), ask (nothing may land and the Agent asks).
// Boards: FOUR TL SPY / TR QQQ / BL NVDA / BR TSLA; THREE L SPY / M QQQ / R NVDA; SIX TL SPY TM QQQ TR NVDA / BL TSLA BM SPY BR QQQ
// (SPY and QQQ name two charts on SIX, NVDA and TSLA one); NINE repeats SPY / QQQ / NVDA / TSLA (SPY names TL, MM and BR).
import { family, op, say } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })

const lands = (roles, expect, click) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click } })
const guarded = (roles, click) => ({ outcome: 'guarded', target: { intended: roles, click, guarded: true } })
const ask = (click, says = '\\?') => ({ outcome: 'guarded', says, target: { intended: 'ask', click, guarded: true } })
const adv = (text, plan) => [say(text, plan, { approve: false })]
const W = (...rs) => rs.map(r => [`${r}.tf`, 'eq', 'W'])
const LOG = (...rs) => rs.map(r => [`${r}.scale`, 'eq', 'log'])
const PANE = (r) => [[`${r}.panes`, 'delta', 1]]

export function unseen14(L) {
  // ── G1: ticker-named anchors ──
  const g1 = family(L, 'u14-g1', { inv: ['C1-006'] })
  g1('target', 'weekly on the chart to the right of the SPY chart', [tf('TR', 'W')], lands(['TR'], W('TR'), 'BR'), { board: 'FOUR', select: 'BR' })
  g1('target', 'put rsi on the chart under the QQQ chart', null, guarded(['BR'], 'BL'), { board: 'FOUR', select: 'BL', inventory: ['C2-004'], turns: adv('put rsi on the chart under the QQQ chart', [rsi('BL')]) })
  g1('target', 'log on the chart below the SPY chart', [scale('BL', 'log')], lands(['BL'], LOG('BL'), 'TL'), { board: 'FOUR', select: 'TL', inventory: ['C1-022'] })
  g1('target', 'the chart left of the NVDA chart, weekly', null, guarded(['M'], 'L'), { board: 'THREE', select: 'L', turns: adv('the chart left of the NVDA chart, weekly', [tf('L', 'W')]) })
  g1('target', 'weekly on the chart beside the QQQ chart', null, ask('M', 'Left|Right'), { board: 'THREE', select: 'M', turns: adv('weekly on the chart beside the QQQ chart', [tf('M', 'W')]) })
  g1('target', 'weekly on the chart under the SPY chart', null, ask('TL'), { board: 'NINE', select: 'TL', turns: adv('weekly on the chart under the SPY chart', [tf('ML', 'W')]) })

  // ── G2: relations from an absolutely named corner ──
  const g2 = family(L, 'u14-g2', { inv: ['C1-006'] })
  g2('target', 'the chart to the right of the top-left one, weekly', [tf('TR', 'W')], lands(['TR'], W('TR'), 'BR'), { board: 'FOUR', select: 'BR' })
  g2('target', 'put rsi on the chart above the bottom-right chart', null, guarded(['TR'], 'TL'), { board: 'FOUR', select: 'TL', inventory: ['C2-004'], turns: adv('put rsi on the chart above the bottom-right chart', [rsi('TL')]) })
  g2('target', 'log on the chart to the right of the bottom-left chart', [scale('BM', 'log')], lands(['BM'], LOG('BM'), 'TM'), { board: 'SIX', select: 'TM', inventory: ['C1-022'] })
  g2('target', 'weekly on the chart below the top-right corner chart', null, guarded(['MR'], 'MM'), { board: 'NINE', select: 'MM', turns: adv('weekly on the chart below the top-right corner chart', [tf('MM', 'W')]) })
  g2('target', 'the chart one step in diagonally from the top-left corner, log', [scale('MM', 'log')], lands(['MM'], LOG('MM'), 'BL'), { board: 'NINE', select: 'BL', inventory: ['C1-022'] })

  // ── G3: exclusion by ticker inside a line ──
  const g3 = family(L, 'u14-g3', { inv: ['C1-006'] })
  g3('target', 'weekly on everything in this row except TSLA', [tf('BM', 'W'), tf('BR', 'W')], lands(['BM', 'BR'], W('BM', 'BR'), 'BL'), { board: 'SIX', select: 'BL' })
  g3('target', 'weekly on everything in this row except NVDA', null, ask('TL'), { board: 'SIX', select: 'TL', turns: adv('weekly on everything in this row except NVDA', [tf('TL', 'W'), tf('TM', 'W'), tf('TR', 'W')]) })
  g3('target', 'log scale on all of these except QQQ', null, ask('R'), { board: 'THREE', select: 'R', inventory: ['C1-022'], turns: adv('log scale on all of these except QQQ', [scale('L', 'log'), scale('M', 'log'), scale('R', 'log')]) })
  g3('target', 'weekly on every chart in the top row except QQQ', [tf('TL', 'W')], lands(['TL'], W('TL'), 'BR'), { board: 'FOUR', select: 'BR' })
  g3('target', 'log on this row except the TSLA one', null, ask('ML'), { board: 'NINE', select: 'ML', inventory: ['C1-022'], turns: adv('log on this row except the TSLA one', [scale('ML', 'log'), scale('MM', 'log'), scale('MR', 'log')]) })

  // ── G4: a ticker target and "the one to its right" ──
  const g4 = family(L, 'u14-g4', { inv: ['C1-006'] })
  g4('target', 'make the SPY chart weekly and the one to its right too', [tf('TL', 'W'), tf('TR', 'W')], lands(['TL', 'TR'], W('TL', 'TR'), 'BR'), { board: 'FOUR', select: 'BR' })
  g4('target', 'log on the SPY chart and the one to its right', null, guarded(['L', 'M'], 'R'), { board: 'THREE', select: 'R', inventory: ['C1-022'], turns: adv('log on the SPY chart and the one to its right', [scale('L', 'log'), scale('R', 'log')]) })
  g4('target', 'weekly on the TSLA chart and on the one to its right', [tf('BL', 'W'), tf('BM', 'W')], lands(['BL', 'BM'], W('BL', 'BM'), 'TR'), { board: 'SIX', select: 'TR' })

  // ── G5: negatives, the click only ──
  const g5 = family(L, 'u14-g5', { inv: ['C1-006'] })
  g5('target', 'weekly on this one, the SPY chart next to it is fine', [tf('sel', 'W')], lands(['TR'], W('TR'), 'TR'), { board: 'FOUR', select: 'TR' })
  g5('target', 'log on this one; the TSLA chart beside it is fine', [scale('sel', 'log')], lands(['BM'], LOG('BM'), 'BM'), { board: 'SIX', select: 'BM', inventory: ['C1-022'] })
  g5('target', 'add rsi here, the NVDA chart to its right is fine as it is', [rsi('sel')], lands(['M'], PANE('M'), 'M'), { board: 'THREE', select: 'M', inventory: ['C2-004'] })
  g5('target', 'weekly on this chart, the QQQ chart to the right of it is fine', [tf('sel', 'W')], lands(['MM'], W('MM'), 'MM'), { board: 'NINE', select: 'MM' })
}
