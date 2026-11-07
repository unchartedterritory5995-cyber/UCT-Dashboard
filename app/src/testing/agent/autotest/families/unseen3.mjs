// UCT Agent AUTOTEST: UNSEEN batch 3 (2026-11-07), written BEFORE any run of it, for the families pl-exec added: a widget's own
// controls set by name (Options Flow, Theme Tracker, Breadth, Indexes, UCT Terminal, New Highs/Lows, Volume Surge, Market Map,
// News) through widget.setOption / widget.readOptions, and a chart header's Info row and Bar info fields through chart.setSetting
// (header.fields / header.barInfo, "+field" / "-field").
//
// Oracles read what was WRITTEN (the layout's widget opts, the chart settings, any pref a widget's own writer saves), never the
// receipt. The board (boards.mjs WIDGETS) mounts these widgets with no backend: a control whose choices come from the widget's
// own data has none here, so those cases say `needsData` and a refusal there is the fixture, not a defect.
// BROWSER-MOCK-MODEL: the plans are scripted. On a tree without these capabilities the cases report what that tree does.
import { family, op, say, changes, refuses, reads } from './dsl.mjs'

const b = '$list:board'
const set = (widget, key, value) => op('widget.setOption', b, { widget, key, value })
const readOpts = (widget) => op('widget.readOptions', b, { widget })
const hdr = (setting, value) => op('chart.setSetting', '$chart:A', { setting, value })
const wrote = (re) => ['written', 're', re]
const wroteNot = (re) => ['written', 'notRe', re]
const keep = { settleMs: 2500 }
const t1 = (text, ops) => [say(text, ops, keep)]

export function unseen3(L) {
  // ── Options Flow ────────────────────────────────────────────────────────────────────────────────────────────────────
  const f = family(L, 'u3-optionsflow', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  const flow = (text, ops, re, extra = {}) => f(extra.kind || 'phrasing', text, null, changes(['A'], [wrote(re)], { undo: true, ...extra.o }), { turns: t1(text, ops), ...extra.x })
  flow('only show puts in the options flow', [set('w-flow', 'callPut', 'P')], 'cp\\W+P\\W')
  flow('options flow: calls only', [set('w-flow', 'callPut', 'C')], 'cp\\W+C\\W')
  flow('just sweeps in the flow widget', [set('w-flow', 'printType', 'SWEEP')], 'SWEEP')
  flow('show me only bearish flow', [set('w-flow', 'direction', 'BEAR')], 'BEAR')
  flow('options flow minimum premium one million', [set('w-flow', 'minPremium', 1000000)], 'minPrem\\W+1000000', { kind: 'params' })
  f('combo', 'flow widget: calls only and only sweeps', null, changes(['A'], [wrote('cp\\W+C\\W'), wrote('SWEEP')], { undo: true }), { turns: t1('flow widget: calls only and only sweeps', [set('w-flow', 'callPut', 'C'), set('w-flow', 'printType', 'SWEEP')]) })
  f('invalid', 'set the options flow minimum premium to 5 dollars', null, refuses({ expect: [wroteNot('minPrem\\W+5\\W')] }), { turns: t1('set the options flow minimum premium to 5 dollars', [set('w-flow', 'minPremium', 5)]) })
  flow('lead the options flow with the biggest prints', [set('w-flow', 'lead', 'biggest')], 'biggest', { kind: 'params', x: { inventory: ['C3-165'] } })
  f('followup', [say('only puts in the options flow', [set('w-flow', 'callPut', 'P')], keep), say('ok put the flow back to calls and puts', [set('w-flow', 'callPut', 'all')], keep)], null, changes(['A'], [wroteNot('cp\\W+P\\W')]))
  f('phrasing', 'what can I change on the options flow widget', null, reads(), { turns: [say('what can I change on the options flow widget', [readOpts('w-flow')])] })

  // ── Theme Tracker ────────────────────────────────────────────────────────────────────────────────────────────────────
  const t = family(L, 'u3-themes', { inv: ['C3-169'], board: 'WIDGETS', select: null })
  t('phrasing', 'theme tracker over the past week', null, changes(['A'], [wrote('1w')], { undo: true }), { turns: t1('theme tracker over the past week', [set('w-themes', 'period', '1w')]) })
  t('params', 'themes year to date', null, changes(['A'], [wrote('ytd')], { undo: true }), { turns: t1('themes year to date', [set('w-themes', 'period', 'ytd')]) })
  t('phrasing', 'sort the theme tracker worst first', null, changes(['A'], [wrote('asc')], { undo: true }), { inventory: ['C3-170'], turns: t1('sort the theme tracker worst first', [set('w-themes', 'sortDir', 'asc')]) })
  t('params', 'measure themes from the open today', null, changes(['A'], [wrote('todayBasis\\W+open')], { undo: true }), { inventory: ['C3-171'], turns: t1('measure themes from the open today', [set('w-themes', 'todayBasis', 'open')]) })
  t('invalid', 'theme tracker over two weeks', null, refuses({ expect: [wroteNot('2w')] }), { turns: t1('theme tracker over two weeks', [set('w-themes', 'period', '2w')]) })
  t('phrasing', 'which periods does the theme tracker have', null, reads({ says: 'ytd|1w|week' }), { turns: [say('which periods does the theme tracker have', [readOpts('w-themes')])] })

  // ── Breadth, Indexes, UCT Terminal, New Highs/Lows, Volume Surge ────────────────────────────────────────────────────────
  const w = family(L, 'u3-widgets', { inv: ['C3-159'], board: 'WIDGETS', select: null })
  w('phrasing', 'breadth widget as ratios', null, changes(['A'], [wrote('ratio')], { undo: true }), { turns: t1('breadth widget as ratios', [set('w-breadth', 'view', 'ratio')]) })
  w('followup', [say('breadth as ratios', [set('w-breadth', 'view', 'ratio')], keep), say('back to the heatmap on breadth', [set('w-breadth', 'view', 'heatmap')], keep)], null, changes(['A'], [wroteNot('view\\W+ratio')]))
  w('invalid', 'make the breadth widget a pie chart', null, refuses({ expect: [wroteNot('pie')] }), { turns: t1('make the breadth widget a pie chart', [set('w-breadth', 'view', 'pie')]) })
  w('phrasing', 'hide QQQ in the indexes widget', null, changes(['A'], [wrote('hiddenSymbols[^\\]]*QQQ')], { undo: true }), { inventory: ['C3-183'], needsData: true, turns: t1('hide QQQ in the indexes widget', [set('w-idx', 'index', '-QQQ')]) })
  w('invalid', 'add ZZQX to the indexes widget', null, refuses(), { inventory: ['C3-183'], turns: t1('add ZZQX to the indexes widget', [set('w-idx', 'index', '+ZZQX')]) })
  w('phrasing', 'open the TBD section in the terminal', null, changes(['A'], [wrote('tbdOpen\\W+true')], { undo: true }), { inventory: ['C3-152'], turns: t1('open the TBD section in the terminal', [set('w-term', 'tbdOpen', true)]) })
  w('phrasing', 'what can I set on the UCT terminal', null, reads(), { inventory: ['C3-152'], turns: [say('what can I set on the UCT terminal', [readOpts('w-term')])] })
  w('phrasing', 'new highs lows on the nasdaq', null, changes(['A'], [wrote('[Nn]asdaq')], { undo: true }), { inventory: ['C3-188'], needsData: true, turns: t1('new highs lows on the nasdaq', [set('w-nhnl', 'universe', 'Nasdaq')]) })
  w('phrasing', 'turn off the logos in volume surge', null, changes(['A'], [wrote('showLogos\\W+false')], { undo: true }), { inventory: ['C3-190'], turns: t1('turn off the logos in volume surge', [set('w-vol', 'showLogos', false)]) })
  w('phrasing', 'what lists does volume surge have', null, reads(), { inventory: ['C3-190'], turns: [say('what lists does volume surge have', [readOpts('w-vol')])] })

  // ── Market Map ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const m = family(L, 'u3-marketmap', { inv: ['C3-195'], board: 'WIDGETS', select: null })
  m('phrasing', 'label every dot on the market map', null, changes(['A'], [wrote('labelMode\\W+all')], { undo: true }), { turns: t1('label every dot on the market map', [set('w-map', 'labelMode', 'all')]) })
  m('phrasing', 'no labels on the market map', null, changes(['A'], [wrote('labelMode\\W+off')], { undo: true }), { turns: t1('no labels on the market map', [set('w-map', 'labelMode', 'off')]) })
  m('params', 'make the market map follow my list', null, changes(['A'], [wrote('followList\\W+true')], { undo: true }), { inventory: ['C3-194'], turns: t1('make the market map follow my list', [set('w-map', 'followList', true)]) })
  m('params', 'put today\'s change on the market map x axis', null, changes(['A'], [wrote('xKey\\W+chg_today')], { undo: true }), { inventory: ['C3-193'], needsData: true, turns: t1('put today\'s change on the market map x axis', [set('w-map', 'xKey', 'chg_today')]) })

  // ── News ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const n = family(L, 'u3-news', { inv: ['C3-139'], board: 'WIDGETS', select: null })
  n('phrasing', 'hide macro headlines in the news widget', null, changes(['A'], [wrote('categories')], { undo: true }), { turns: t1('hide macro headlines in the news widget', [set('w-news', 'category', '-Macro')]) })
  n('phrasing', 'news widget: earnings only', null, changes(['A'], [wrote('Earnings')], { undo: true }), { turns: t1('news widget: earnings only', [set('w-news', 'category', '+Earnings')]) })
  n('invalid', 'show crypto news in the news widget', null, refuses(), { turns: t1('show crypto news in the news widget', [set('w-news', 'category', '+Crypto')]) })

  // ── a chart header's Info row and Bar info ────────────────────────────────────────────────────────────────────────────
  const h = family(L, 'u3-header', { inv: ['C1-066'], board: 'WIDGETS', select: 'A' })
  const fields = (re) => wrote(`fields[^\\]]*${re}`)
  const fieldsNot = (re) => wroteNot(`fields[^\\]]*${re}`)
  h('phrasing', 'add the sector to this chart\'s info row', null, changes(['A'], [fields('sector')], { undo: true }), { turns: t1('add the sector to this chart\'s info row', [hdr('header.fields', '+Sector')]) })
  h('params', 'show RVOL in the header', null, changes(['A'], [fields('rvol')], { undo: true }), { turns: t1('show RVOL in the header', [hdr('header.fields', '+RVOL')]) })
  h('phrasing', 'take the UCT rating out of the info row', null, changes(['A'], [wrote('fields'), fieldsNot('rating')], { undo: true }), { turns: t1('take the UCT rating out of the info row', [hdr('header.fields', '-UCT Rating')]) })
  h('combo', 'put sector and industry in the info row', null, changes(['A'], [fields('sector'), fields('industry')], { undo: true }), { turns: t1('put sector and industry in the info row', [hdr('header.fields', '+Sector'), hdr('header.fields', '+Industry')]) })
  h('invalid', 'add shoe size to the info row', null, refuses({ expect: [wroteNot('[Ss]hoe')] }), { turns: t1('add shoe size to the info row', [hdr('header.fields', '+Shoe Size')]) })
  h('phrasing', 'drop the date from the bar info', null, changes(['A'], [wrote('barInfo'), wroteNot('barInfo[^\\]]*date')], { undo: true }), { inventory: ['C1-065'], turns: t1('drop the date from the bar info', [hdr('header.barInfo', '-Date')]) })
  h('phrasing', 'no net change in the bar info', null, changes(['A'], [wrote('barInfo'), wroteNot('barInfo[^\\]]*"change\\\\?"')], { undo: true }), { inventory: ['C1-065'], turns: t1('no net change in the bar info', [hdr('header.barInfo', '-Net Chg')]) })
  h('followup', [say('take % change out of the bar info', [hdr('header.barInfo', '-% Chg')], keep), say('actually put the % change back', [hdr('header.barInfo', '+% Chg')], keep)], null, changes(['A'], [wrote('changePct')]), { inventory: ['C1-064'] })
  h('invalid', 'add the bid price to the bar info', null, refuses({ expect: [wroteNot('[Bb]id')] }), { inventory: ['C1-065'], turns: t1('add the bid price to the bar info', [hdr('header.barInfo', '+Bid')]) })
}
