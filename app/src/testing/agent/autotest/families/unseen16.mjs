// UCT Agent AUTOTEST: UNSEEN batch 16, NEGATED ANCHOR (2026-11-09), written BEFORE any run, in pl-auto's own words (AUDIT's
// regression probe was not seen): an imperative that NEGATES the clicked chart ("leave this alone", "keep this one as is",
// "don't touch this chart", "don't change it", "not this one") plus a relation target ("the one under it"), in both clause orders,
// with "this one / this chart / it" variants, on TWO / FOUR / SIX / NINE. The click must never be changed; a plan that names the
// click (adversary) must not be applied or proposed. Controls: a STATIVE remark about OTHER charts ("the one under it is fine",
// "already is") is not a negation of the click, which must be acted on (never refused, never asked).
import { family, op, say } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })
const NAME = { TL: 'Top-left', TM: 'Top-middle', TR: 'Top-right', ML: 'Middle-left', MM: 'Middle-middle', MR: 'Middle-right', BL: 'Bottom-left', BM: 'Bottom-middle', BR: 'Bottom-right', A: 'Left', B: 'Right' }
const noProposalOf = (roles) => `meant[^.]*\\b(${roles.map(r => NAME[r]).join('|')}) chart`

const lands = (roles, expect, click) => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click } })
// the click is negated: landing on it, or proposing it, fails; landing on the intended chart or asking passes
const notClick = (roles, click) => ({ outcome: 'guarded', saysNot: noProposalOf([click]), target: { intended: roles, click, guarded: true } })
const adv = (text, plan) => [say(text, plan, { approve: false })]
const W = (...rs) => rs.map(r => [`${r}.tf`, 'eq', 'W'])
const LOG = (...rs) => rs.map(r => [`${r}.scale`, 'eq', 'log'])
const PANE = (r) => [[`${r}.panes`, 'delta', 1]]

export function unseen16(L) {
  // ── the click negated, a relation names the target (adversary: the plan changes the click) ──
  const n = family(L, 'u16-neg', { inv: ['C1-006'] })
  n('target', 'leave this alone and change the one under it to weekly', null, notClick(['BL'], 'TL'), { board: 'FOUR', select: 'TL', turns: adv('leave this alone and change the one under it to weekly', [tf('TL', 'W')]) })
  n('target', 'don\'t touch this chart, put the one to its left on log', null, notClick(['TL'], 'TR'), { board: 'FOUR', select: 'TR', inventory: ['C1-022'], turns: adv('don\'t touch this chart, put the one to its left on log', [scale('TR', 'log')]) })
  n('target', 'not this one, the one next to it on the right: weekly', null, notClick(['TR'], 'TM'), { board: 'SIX', select: 'TM', turns: adv('not this one, the one next to it on the right: weekly', [tf('TM', 'W')]) })
  n('target', 'don\'t change this chart; make the one to its right log', null, notClick(['BM'], 'BL'), { board: 'SIX', select: 'BL', inventory: ['C1-022'], turns: adv('don\'t change this chart; make the one to its right log', [scale('BL', 'log')]) })
  n('target', 'leave this as it is and switch the chart below it to weekly', null, notClick(['BM'], 'MM'), { board: 'NINE', select: 'MM', turns: adv('leave this as it is and switch the chart below it to weekly', [tf('MM', 'W')]) })
  n('target', 'don\'t touch it, weekly on the one below it', null, notClick(['MR'], 'TR'), { board: 'NINE', select: 'TR', turns: adv('don\'t touch it, weekly on the one below it', [tf('TR', 'W')]) })
  n('target', 'leave this alone, weekly on the other one', null, notClick(['B'], 'A'), { board: 'TWO', select: 'A', turns: adv('leave this alone, weekly on the other one', [tf('A', 'W')]) })
  n('target', 'not this chart, the one beside it, log', null, notClick(['B'], 'A'), { board: 'TWO', select: 'A', inventory: ['C1-022'], turns: adv('not this chart, the one beside it, log', [scale('A', 'log')]) })
  n('target', 'keep it as is, add rsi to the chart above it', null, notClick(['TL'], 'BL'), { board: 'FOUR', select: 'BL', inventory: ['C2-004'], turns: adv('keep it as is, add rsi to the chart above it', [rsi('BL')]) })
  n('target', 'don\'t change this, weekly on the one below', null, notClick(['BR'], 'TR'), { board: 'SIX', select: 'TR', turns: adv('don\'t change this, weekly on the one below', [tf('TR', 'W')]) })

  // ── the same, target clause first (honest plans: the right chart, nothing on the click) ──
  const r = family(L, 'u16-order', { inv: ['C1-006'] })
  r('target', 'make the one under this weekly, but leave this one alone', [tf('BL', 'W')], lands(['BL'], W('BL'), 'TL'), { board: 'FOUR', select: 'TL' })
  r('target', 'put the chart above this on log and keep this one as is', [scale('TR', 'log')], lands(['TR'], LOG('TR'), 'BR'), { board: 'FOUR', select: 'BR', inventory: ['C1-022'] })
  r('target', 'weekly on the one above it, don\'t change this one', [tf('TM', 'W')], lands(['TM'], W('TM'), 'BM'), { board: 'SIX', select: 'BM' })
  r('target', 'the chart to the left of this one on log, keep this one untouched', [scale('ML', 'log')], lands(['ML'], LOG('ML'), 'MM'), { board: 'NINE', select: 'MM', inventory: ['C1-022'] })
  r('target', 'change the other chart to log and don\'t touch this one', [scale('A', 'log')], lands(['A'], LOG('A'), 'B'), { board: 'TWO', select: 'B', inventory: ['C1-022'] })

  // ── controls: a stative remark about OTHER charts; act on the click ──
  const c = family(L, 'u16-control', { inv: ['C1-006'] })
  c('target', 'weekly on this one; the one under it is fine', [tf('sel', 'W')], lands(['TR'], W('TR'), 'TR'), { board: 'FOUR', select: 'TR' })
  c('target', 'log on this chart, the ones beside it already are', [scale('sel', 'log')], lands(['TM'], LOG('TM'), 'TM'), { board: 'SIX', select: 'TM', inventory: ['C1-022'] })
  c('target', 'add rsi to this one, the chart above it already has one', [rsi('sel')], lands(['MM'], PANE('MM'), 'MM'), { board: 'NINE', select: 'MM', inventory: ['C2-004'] })
  c('target', 'weekly on this chart, the other one already is', [tf('sel', 'W')], lands(['B'], W('B'), 'B'), { board: 'TWO', select: 'B' })
  c('target', 'make this one log; the one to its right is fine as it is', [scale('sel', 'log')], lands(['BL'], LOG('BL'), 'BL'), { board: 'NINE', select: 'BL', inventory: ['C1-022'] })
}
