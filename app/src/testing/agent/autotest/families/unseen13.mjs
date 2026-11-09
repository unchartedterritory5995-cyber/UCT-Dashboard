// UCT Agent AUTOTEST: UNSEEN batch 13, WATCHLIST (2026-11-09), written BEFORE any run and without reading pl-exec's or pl-teach's
// watchlist code (capabilities, planner, guide steps). The Charts watchlist widget and the member's lists: new phrasings of adding,
// removing, moving a ticker between lists, creating / renaming / emptying a list, reading one, opening one in the widget, the
// chart's own ticker ("this one") onto a list, walking and sorting the list view, follow-ups, refusals and a how-to.
// Plans use only the watchlist actions the public set already exercises (watchlist.add / remove / create / rename / clear / show /
// open / step / sortColumn): the batch tests understanding and execution of new words, not new capabilities.
// Fixture lists (boards.mjs LISTS): Momentum NVDA TSLA META AAPL; Swing MSFT; Long Term (empty). WL board: the chart on NVDA,
// the list view on Momentum.
import { family, op, say, changes, refuses, asks, reads, unsupported, clarify, propose } from './dsl.mjs'

const add = (list, symbols) => op('watchlist.add', `$wl:${list}`, { symbols })
const rem = (list, symbols) => op('watchlist.remove', `$wl:${list}`, { symbols })
const wl = (list, how, v) => [`wl.${list}`, how, v]
const lib = '$list:watchlistLibrary'

export function unseen13(L) {
  // ── the member's lists (board ONE: a chart on SPY and the watchlist widget) ───────────────────────────────────────────
  const l = family(L, 'u13-lists', { inv: ['C3-076', 'C3-079'], board: 'ONE', select: null })
  l('phrasing', 'throw META and AMD on the Swing list', [add('Swing', ['META', 'AMD'])], { outcome: 'change', expect: [wl('Swing', 'has', 'META'), wl('Swing', 'has', 'AMD'), wl('Swing', 'len', 3)], undo: true })
  l('phrasing', 'drop AAPL from my momentum names', [rem('Momentum', ['AAPL'])], { outcome: 'change', expect: [wl('Momentum', 'lacks', 'AAPL'), wl('Momentum', 'len', 3)], undo: true })
  l('params', 'put COIN in Long Term', [add('Long Term', ['COIN'])], { outcome: 'change', expect: [wl('Long Term', 'has', 'COIN'), wl('Long Term', 'len', 1)], undo: true })
  l('multistep', 'move MSFT from Swing over to Momentum', [rem('Swing', ['MSFT']), add('Momentum', ['MSFT'])], { outcome: 'change', expect: [wl('Momentum', 'has', 'MSFT'), wl('Momentum', 'len', 5), wl('Swing', 'len', 0)], undo: true })
  l('followup', [say('add AMD to Momentum', [add('Momentum', ['AMD'])]), say('actually, take it back out', [rem('Momentum', ['AMD'])])], null, { outcome: 'change', expect: [wl('Momentum', 'lacks', 'AMD'), wl('Momentum', 'len', 4)] })
  l('invalid', 'pull SNOW off the Swing list', [rem('Swing', ['SNOW'])], refuses({ expect: [wl('Swing', 'len', 1)] }))
  l('invalid', 'add AMD to my Earnings list', [], asks(), { turns: [say('add AMD to my Earnings list', clarify('You do not have a list called Earnings. Which list?', ['Momentum', 'Swing', 'Long Term']))] })
  l('unsupported', 'sync my watchlists with my brokerage account', [], refuses(), { turns: [say('sync my watchlists with my brokerage account', unsupported('I cannot reach a brokerage account.'))] })

  // the chart's own ticker ("this one", "the chart's ticker") onto a list: the symbol comes from the clicked chart
  const t = family(L, 'u13-this', { inv: ['C3-076'], board: 'ONE', select: 'A' })
  t('target', 'add this one to my Swing list', [add('Swing', ['$sym:sel'])], { outcome: 'change', expect: [wl('Swing', 'has', 'SPY'), wl('Swing', 'len', 2)], undo: true })
  t('target', 'stick the chart\'s ticker on Momentum', [add('Momentum', ['$sym:sel'])], { outcome: 'change', expect: [wl('Momentum', 'has', 'SPY'), wl('Momentum', 'len', 5)], undo: true })

  // create / rename / empty: shown first, applied on confirm
  const c = family(L, 'u13-manage', { inv: ['C3-070', 'C3-080'], board: 'ONE', select: null })
  c('phrasing', 'make me a fresh list named Breakouts', null, { outcome: 'change', expect: [wl('Breakouts', 'len', 0)], confirm: true }, { inventory: ['C3-070'], turns: [say('make me a fresh list named Breakouts', propose([op('watchlist.create', lib, { name: 'Breakouts', as: null })]))] })
  c('phrasing', 'from now on call the Swing list Swing Trades', null, { outcome: 'change', expect: [['wl.Swing Trades', 'exists']], confirm: true }, { inventory: ['C3-073'], turns: [say('from now on call the Swing list Swing Trades', propose([op('watchlist.rename', '$wl:Swing', { name: 'Swing Trades' })]))] })
  c('phrasing', 'wipe everything off Swing', null, { outcome: 'change', expect: [wl('Swing', 'len', 0)], confirm: true }, { turns: [say('wipe everything off Swing', propose([op('watchlist.clear', '$wl:Swing', {})]))] })

  // reading a list, and opening one in the widget
  const r = family(L, 'u13-read', { inv: ['C3-063'], board: 'ONE', select: null })
  r('phrasing', 'remind me which tickers are on Momentum', [op('watchlist.show', '$wl:Momentum', { as: null })], reads({ says: 'META' }))
  r('phrasing', 'pull up Momentum in the watchlist panel', [op('watchlist.open', '$list:board', { list: '$wl:Momentum' })], { outcome: 'change', expect: [['faces.watchlist', 're', 'META']], receipt: true })

  // ── the list view on the WL board: walking it loads the chart; sorting it changes the widget ───────────────────────────
  const v = family(L, 'u13-view', { inv: ['C3-068', 'C3-069', 'C3-082'], board: 'WL', select: null })
  v('phrasing', 'go to the next ticker on this list', [op('watchlist.step', '$view', { direction: 'next', by: null })], changes(['A'], [['A.sym', 'eq', 'TSLA']]))
  v('params', 'jump three names down the watchlist', [op('watchlist.step', '$view', { direction: 'next', by: 3 })], changes(['A'], [['A.sym', 'eq', 'AAPL']]))
  v('phrasing', 'put the list in reverse alphabetical order', [op('watchlist.sortColumn', '$view', { column: 'Symbol', direction: 'desc' })], { outcome: 'change', expect: [['faces.watchlist', 'changed']] })
  v('followup', [say('next name on the list', [op('watchlist.step', '$view', { direction: 'next', by: null })]), say('and one more', [op('watchlist.step', '$view', { direction: 'next', by: null })])], null, changes(['A'], [['A.sym', 'eq', 'META']]))

  // ── how-to: shown, never done ─────────────────────────────────────────────────────────────────────────────────────────
  const h = family(L, 'u13-howto', { inv: ['C3-070'], board: 'GAP', select: null })
  h('howto', 'walk me through setting up a watchlist from scratch', [op('guide.show', '$list:guide', { feature: 'watchlistCreate', detail: null })],
    { outcome: 'walkthrough', guide: { steps: [{ target: 'workspace.widgets', text: 'Widgets', act: 'click' }], partial: true } },
    { browserOnly: true, unverifiable: ['only the first ring and click: the rest of the create flow is the guide suite\'s'] })
}
