// UCT Agent AUTOTEST: UNSEEN batch 18, DATA WIDGETS + WATCHLIST (2026-11-10), written BEFORE any run and before pl-widget's
// agent/pl/exec-widget-actions lands, in pl-auto's own words (pl-widget's held-out phrasings were not used; only op names and
// argument shapes were read, so a plan can be scripted at all):
//   widget.setOption   an `action` row (Scanner / Period Sort `refresh` = "run"); the Scanner back to its picker (scan = picker);
//                      Watchlist appearance rows (showLogos, tint, canvasColor / textColor / gainColor / lossColor as #rrggbb),
//                      a saved look applied (look), saved or deleted (looks = create:<name> / delete:<name>), Flagged's name
//                      (flaggedName)
//   watchlist.arrangeColumns  { column, before, after, width } on a list view ($view:<list name>)
//   watchlist.showList        { widget, source: mine|prebuilt|community|flagged|picker, name }
//   watchlist.exportList      { widget, format: clipboard|csv|xlsx }
// Boards (boards.mjs): DATA one Scanner (IPOs) + one Period Sort + one Watchlist (Momentum); DATA2 two Scanners (IPOs, Top Gainers
// 30D) + two Watchlists (Momentum, Swing); DATAF the Watchlist on Flagged. A saved look "Paper" exists.
// Oracles read what was WRITTEN (prefs incl. the layout's widget opts and watchlist_templates), the watchlist column config as
// saved (wlCols), the scan fetches the harness answered (scanGets, by route), and the widget's face; never the receipt.
// Two widgets of a kind and no name = ASK: the plan guesses one (adversary), and a question with nothing changed is the pass.
// BROWSER-MOCK-MODEL: plans are scripted. On a tree without these capabilities the cases report what that tree does.
import { family, op, say, changes, refuses, asks } from './dsl.mjs'

const b = '$list:board'
const set = (widget, key, value) => op('widget.setOption', b, { widget, key, value })
const show = (widget, source, name = null) => op('watchlist.showList', b, { widget, source, name })
const out = (widget, format) => op('watchlist.exportList', b, { widget, format })
const arrange = (list, column, { before = null, after = null, width = null } = {}) => op('watchlist.arrangeColumns', `$view:${list}`, { column, before, after, width })
const wrote = (re) => ['written', 're', re]
const wroteNot = (re) => ['written', 'notRe', re]
const keep = { settleMs: 2500 }
const t1 = (text, ops) => [say(text, ops, keep)]
const adv = (text, ops) => [say(text, ops, { approve: false, ...keep })]
const fetched = (route) => [`scanGets.byRoute./api/scans/${route}`, 'changed']
const notFetched = (route) => [`scanGets.byRoute./api/scans/${route}`, 'same']
const cols = (re) => ['wlCols', 're', re]
const ORDER = (...k) => `"order":\\[${k.map(x => `"${x}"`).join(',')}\\]`

export function unseen18(L) {
  // ── a widget's own Refresh button ──
  const a = family(L, 'u18-refresh', { inv: ['C3-112'], board: 'DATA', select: null })
  a('phrasing', 'rerun the scanner', null, changes(null, [fetched('ipo-1y')], { says: 'Refresh|rerun|ran' }), { turns: t1('rerun the scanner', [set('w-scan', 'refresh', 'run')]) })
  a('phrasing', 'pull fresh results into the IPO scan', null, changes(null, [fetched('ipo-1y')]), { turns: t1('pull fresh results into the IPO scan', [set('w-scan', 'refresh', 'run')]) })
  a('phrasing', 'refresh the period sort', null, changes(null, [['scanGets.period', 'changed']]), { inventory: ['C3-208'], turns: t1('refresh the period sort', [set('w-psort', 'refresh', 'run')]) })
  a('phrasing', 'update the custom period ranking', null, changes(null, [['scanGets.period', 'changed']]), { inventory: ['C3-208'], turns: t1('update the custom period ranking', [set('w-psort', 'refresh', 'run')]) })
  a('target', 'leave the scanner alone and refresh the period sort', null, changes(null, [['scanGets.period', 'changed'], notFetched('ipo-1y')]), { inventory: ['C3-208'], turns: t1('leave the scanner alone and refresh the period sort', [set('w-psort', 'refresh', 'run')]) })
  a('target', 'don\'t touch the period sort, just reload the scanner', null, changes(null, [fetched('ipo-1y'), ['scanGets.period', 'same']]), { turns: adv('don\'t touch the period sort, just reload the scanner', [set('w-psort', 'refresh', 'run')]) })
  a('invalid', 'refresh the scanner every 5 seconds', null, refuses(), { turns: t1('refresh the scanner every 5 seconds', [set('w-scan', 'refresh', 5)]) })
  a('phrasing', 'take the scanner back to the list of scans', null, changes(null, [wrote('scanKey\\W+null')], { undo: true }), { inventory: ['C3-108'], turns: t1('take the scanner back to the list of scans', [set('w-scan', 'scan', 'picker')]) })
  a('target', 'refresh the top gainers scanner', null, changes(null, [fetched('top-gainers-30d'), notFetched('ipo-1y')]), { board: 'DATA2', turns: t1('refresh the top gainers scanner', [set('w-scan2', 'refresh', 'run')]) })
  a('target', 'refresh the scanner', null, asks(), { board: 'DATA2', turns: adv('refresh the scanner', [set('w-scan', 'refresh', 'run')]) })

  // ── the Watchlist's look: appearance rows ──
  const c = family(L, 'u18-look', { inv: ['C3-103'], board: 'DATA', select: null })
  c('phrasing', 'no company logos on my watchlist', null, changes(null, [wrote('showLogos\\W+false')], { undo: true }), { turns: t1('no company logos on my watchlist', [set('w-watch', 'showLogos', false)]) })
  c('phrasing', 'stop the watchlist rows flashing on every tick', null, changes(null, [wrote('tint\\w*\\W+false')], { undo: true }), { turns: t1('stop the watchlist rows flashing on every tick', [set('w-watch', 'tint', false)]) })
  c('params', 'watchlist background to pure black', null, changes(null, [wrote('#000000')], { undo: true }), { turns: t1('watchlist background to pure black', [set('w-watch', 'canvasColor', '#000000')]) })
  c('params', 'make the watchlist text a light grey, #cccccc', null, changes(null, [wrote('#cccccc')], { undo: true }), { turns: t1('make the watchlist text a light grey, #cccccc', [set('w-watch', 'textColor', '#ccc')]) })
  c('combo', 'green for up names and red for down names on the watchlist', null, changes(null, [wrote('#00c853'), wrote('#d50000')], { undo: true }), { turns: t1('green for up names and red for down names on the watchlist', [set('w-watch', 'gainColor', '#00c853'), set('w-watch', 'lossColor', '#d50000')]) })
  c('invalid', 'make the watchlist background kind of warm', null, refuses({ expect: [wroteNot('canvasColor|"bg"')] }), { turns: t1('make the watchlist background kind of warm', [set('w-watch', 'canvasColor', 'warm')]) })
  c('target', 'make the watchlist background black', null, asks({ expect: [wroteNot('#000000')] }), { board: 'DATA2', turns: adv('make the watchlist background black', [set('w-watch', 'canvasColor', '#000000')]) })
  c('target', 'on the Swing watchlist, hide the logos', null, changes(null, [wrote('showLogos\\W+false')], { undo: true }), { board: 'DATA2', turns: t1('on the Swing watchlist, hide the logos', [set('w-watch2', 'showLogos', false)]) })

  // ── saved looks ──
  const k = family(L, 'u18-looks', { inv: ['C3-104'], board: 'DATA', select: null })
  k('phrasing', 'keep this watchlist styling as a look named Desk Dark', null, changes(null, [wrote('Desk Dark')]), { turns: t1('keep this watchlist styling as a look named Desk Dark', [set('w-watch', 'looks', 'create:Desk Dark')]) })
  k('phrasing', 'put the Paper look on my watchlist', null, changes(null, [wrote('1f2328')], { undo: true }), { turns: t1('put the Paper look on my watchlist', [set('w-watch', 'look', 'Paper')]) })
  k('phrasing', 'remove the Paper look from my saved looks', null, changes(null, [wrote('watchlist_templates\\W+\\[\\]')]), { turns: t1('remove the Paper look from my saved looks', [set('w-watch', 'looks', 'delete:Paper')]) })
  k('invalid', 'use my Sunset look on the watchlist', null, refuses({ expect: [wroteNot('Sunset')] }), { turns: t1('use my Sunset look on the watchlist', [set('w-watch', 'look', 'Sunset')]) })

  // ── Flagged's name ──
  const f = family(L, 'u18-flagged', { inv: ['C3-074'], board: 'DATAF', select: null })
  f('phrasing', 'rename flagged to Top Ideas', null, changes(null, [['faces.watchlist', 're', 'Top Ideas']], { undo: true }), { turns: t1('rename flagged to Top Ideas', [set('w-watch', 'flaggedName', 'Top Ideas')]) })
  f('phrasing', 'call my flagged list Shortlist instead', null, changes(null, [['faces.watchlist', 're', 'Shortlist']]), { turns: t1('call my flagged list Shortlist instead', [set('w-watch', 'flaggedName', 'Shortlist')]) })
  f('invalid', 'rename flagged to Movers', null, refuses({ expect: [['faces.watchlist', 'notRe', 'Movers']] }), { board: 'DATA', turns: t1('rename flagged to Movers', [set('w-watch', 'flaggedName', 'Movers')]) })

  // ── watchlist columns: move, width ──
  const o = family(L, 'u18-cols', { inv: ['C3-085'], board: 'DATA', select: null })
  o('phrasing', 'put % change right before price on my watchlist', null, changes(null, [cols(ORDER('flag', 'sym', 'chg', 'price', 'vol'))], { undo: true }), { turns: t1('put % change right before price on my watchlist', [arrange('Momentum', '% change', { before: 'price' })]) })
  o('phrasing', 'move volume to the end of the watchlist columns', null, changes(null, [cols(ORDER('flag', 'sym', 'price', 'chg', 'vol'))], { undo: true }), { turns: t1('move volume to the end of the watchlist columns', [arrange('Momentum', 'volume', { after: '% change' })]) })
  o('params', 'widen the symbol column to 150 px', null, changes(null, [cols('"sym":150')], { undo: true }), { inventory: ['C3-086'], turns: t1('widen the symbol column to 150 px', [arrange('Momentum', 'symbol', { width: 150 })]) })
  o('params', 'make the price column 70 wide', null, changes(null, [cols('"price":70')], { undo: true }), { inventory: ['C3-086'], turns: t1('make the price column 70 wide', [arrange('Momentum', 'price', { width: 70 })]) })
  o('invalid', 'make the price column 1 pixel wide', null, refuses({ expect: [['wlCols', 'notRe', '"price":1[,}]']] }), { inventory: ['C3-086'], turns: t1('make the price column 1 pixel wide', [arrange('Momentum', 'price', { width: 1 })]) })
  o('target', 'on the Swing list, move volume right after symbol', null, changes(null, [cols(ORDER('flag', 'sym', 'vol', 'price', 'chg'))], { undo: true }), { board: 'DATA2', turns: t1('on the Swing list, move volume right after symbol', [arrange('Swing', 'volume', { after: 'symbol' })]) })
  o('target', 'move the volume column after the symbol', null, asks(), { board: 'DATA2', turns: adv('move the volume column after the symbol', [arrange('Momentum', 'volume', { after: 'symbol' })]) })

  // ── which list a Watchlist widget shows; copy / export ──
  const w = family(L, 'u18-show', { inv: ['C3-065'], board: 'DATA', select: null })
  w('phrasing', 'switch my watchlist widget to the Swing list', null, changes(null, [wrote('watchKey\\W+user:s1')], { undo: true }), { inventory: ['C3-068'], turns: t1('switch my watchlist widget to the Swing list', [show('w-watch', 'mine', 'Swing')]) })
  w('phrasing', 'show my flagged names in the watchlist', null, changes(null, [wrote('watchKey\\W+flagged')], { undo: true }), { turns: t1('show my flagged names in the watchlist', [show('w-watch', 'flagged')]) })
  w('phrasing', 'back to the list chooser on the watchlist widget', null, changes(null, [wrote('watchKey\\W+null')], { undo: true }), { inventory: ['C3-067'], turns: t1('back to the list chooser on the watchlist widget', [show('w-watch', 'picker')]) })
  w('invalid', 'open my Dividend list in the watchlist', null, refuses({ expect: [wroteNot('Dividend')] }), { turns: t1('open my Dividend list in the watchlist', [show('w-watch', 'mine', 'Dividend')]) })
  w('target', 'put Long Term on the Swing watchlist widget', null, changes(null, [wrote('watchKey\\W+user:l1')], { undo: true }), { board: 'DATA2', turns: t1('put Long Term on the Swing watchlist widget', [show('w-watch2', 'mine', 'Long Term')]) })
  w('target', 'show the Long Term list in the watchlist', null, asks({ expect: [wroteNot('user:l1')] }), { board: 'DATA2', turns: adv('show the Long Term list in the watchlist', [show('w-watch', 'mine', 'Long Term')]) })
  const x = family(L, 'u18-export', { inv: ['C3-095'], board: 'DATA', select: null, unverifiable: ['a copy or a download leaves nothing on the board: the receipt and its words are the check'] })
  x('phrasing', 'download this watchlist as a csv', null, changes(null, [], { says: 'CSV' }), { turns: t1('download this watchlist as a csv', [out('w-watch', 'csv')]) })
  x('phrasing', 'copy the tickers on my watchlist so I can paste them', null, changes(null, [], { says: 'Cop|clipboard' }), { inventory: ['C3-094'], turns: t1('copy the tickers on my watchlist so I can paste them', [out('w-watch', 'clipboard')]) })
  x('target', 'export my watchlist to csv', null, asks(), { board: 'DATA2', turns: adv('export my watchlist to csv', [out('w-watch', 'csv')]) })
  x('target', 'export the Swing watchlist as a csv file', null, changes(null, [], { says: 'CSV[^.]*Swing|Swing[^.]*CSV' }), { board: 'DATA2', turns: t1('export the Swing watchlist as a csv file', [out('w-watch2', 'csv')]) })
}
