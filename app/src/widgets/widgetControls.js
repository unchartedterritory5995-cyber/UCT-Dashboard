// What a person can set on a mounted widget that the registry's paramsSchema does not offer: the machine-readable description
// widget.setOption validates, writes and reads back. It sits beside widgets/registry.js, not inside it, because the registry
// is in the Notebook's first-open bytes and only the Agent reads this. Metadata only.
//
//   { key, type: 'enum'|'boolean'|'number'|'day'|'set'|'color'|'action', options|min+max+integer, default, clears,
//     path:    where it lives in `opts` ('filters.cp'); default: key
//     from:    'door' = its choices are the mounted widget's own right now (pages/charts/widgetDoors.js)
//     door:    true = the widget's own writer, not `opts` (its state lives in the widget, or the write is more than one key);
//              Undo goes back through that writer
//     inverse: true = a set whose stored members are the ones turned OFF (a hidden list)
//     shown:   { value: the word on its control } where the two differ (a chip says Calls, opts holds C)
//     inOpts:  true = a door write whose whole result is in `opts`: Undo needs only those opts
//     all:     true = an empty set means every member, and a full one is stored empty
//     words:   the words a person says for it (routing vocabulary), beside its key }
// An `action` is one of the widget's own BUTTONS (Refresh): no value is kept, so there is nothing to read back or undo. It is
// run through the mounted widget's door (`act(key)`, pages/charts/widgetDoors.js) and is done only once that resolves.
// AUDIT #1027: every `action` row carries `effect`: 'read' (re-reads, changes nothing: runs), 'write' or 'destructive'. Only
// 'read' is pressable today — a button that writes has no Undo here, so 'write' / 'destructive' (or no tag) are refused, never
// pressed; agent/widgetActionKeys.test.js fails when a door can press a key that no tagged row lists.
// A `set` takes "+member" / "-member". agent/settingsLiveness.test.js proves a row the same way as a `live` field: an `opts`
// row is read back from opts by the mounted widget, a door row is read and written by its door.
import { WIDGET_REGISTRY } from './registry'

const NEWS_CONTROLS = [
  { key: 'category', type: 'set', options: ['News', 'Macro', 'Options', 'Earnings', 'Price', 'Press Release', 'Filing', 'Other'], path: 'categories', all: true, clears: ['presetId'] },
  { key: 'watchlist', type: 'enum', from: 'door', path: 'watchlistId' },
]

// the words a refresh button is asked for by
const REFRESH_WORDS = ['refresh', 'reload', 'rerun', 'update']

const OWN = {
  // C3-112 the scan's own Refresh (ScannerResults footer)
  scanner: [{ key: 'refresh', type: 'action', effect: 'read', words: REFRESH_WORDS }],
  // watchlist group C (pl-widget): the ⚙ Watchlist Settings panel's own appearance writer (patchSettings → this widget's
  // opts.settings), and its look templates (C3-103 / C3-104). A colour is #rrggbb. Undo puts the widget's opts back whole.
  watchlist: [
    { key: 'showLogos', type: 'boolean', default: true, door: true, inOpts: true },
    { key: 'tint', type: 'boolean', default: true, door: true, inOpts: true, words: ['flash'] },
    { key: 'canvasColor', type: 'color', door: true, inOpts: true, words: ['background'] },
    { key: 'textColor', type: 'color', door: true, inOpts: true },
    { key: 'gainColor', type: 'color', door: true, inOpts: true },
    { key: 'lossColor', type: 'color', door: true, inOpts: true },
    { key: 'look', type: 'enum', from: 'door', door: true, inOpts: true, words: ['template'] },
  ],
  // C3-208 the ranking's own Refresh (PeriodSortResults footer)
  periodsort: [{ key: 'refresh', type: 'action', effect: 'read', words: REFRESH_WORDS }],
  themes: [
    { key: 'period', type: 'enum', options: ['1d', '1w', '1m', '3m', '1y', 'ytd'], default: '1d', door: true },
    { key: 'sortDir', type: 'enum', options: ['asc', 'desc'], default: 'desc', door: true },
    { key: 'todayBasis', type: 'enum', options: ['close', 'open'], default: 'close' },
    { key: 'openTheme', type: 'enum', from: 'door', door: true },
    { key: 'themeSet', type: 'enum', from: 'door', door: true },
  ],
  breadth: [
    { key: 'view', type: 'enum', options: ['heatmap', 'ratio'], default: 'heatmap' },
    { key: 'reading', type: 'set', from: 'door', path: 'hiddenMetrics', inverse: true },
  ],
  indexes: [{ key: 'index', type: 'set', from: 'door', path: 'hiddenSymbols', inverse: true }],
  calendar: [
    { key: 'day', type: 'day', door: true },
    { key: 'tbdOpen', type: 'boolean', default: false, door: true },
  ],
  // the widget's four single-select chip groups (OptionsFlowWidget.jsx MIN_PREM_OPTS and its three chip rows), AND across groups;
  // `shown` = the words on the chips, `also` = how a person says one (F-16 widened by the owner 2026-11-10: every chip)
  optionsflow: [
    { key: 'minPremium', type: 'enum', options: [0, 250000, 500000, 1000000], shown: { 0: 'All', 250000: '$250K', 500000: '$500K', 1000000: '$1M' }, default: 0, path: 'filters.minPrem',
      also: { 1000000: ['million', '1m'], 500000: ['500k'], 250000: ['250k'], 0: ['premium'] } },
    { key: 'callPut', type: 'enum', options: ['all', 'C', 'P'], shown: { all: 'All', C: 'Calls', P: 'Puts' }, default: 'all', path: 'filters.cp' },
    { key: 'printType', type: 'enum', options: ['all', 'SWEEP', 'BLOCK'], shown: { all: 'Any', SWEEP: 'Sweep', BLOCK: 'Block' }, default: 'all', path: 'filters.type' },
    { key: 'direction', type: 'enum', options: ['all', 'BULL', 'BEAR'], shown: { all: 'All', BULL: 'Bull', BEAR: 'Bear' }, default: 'all', path: 'filters.dir',
      also: { BULL: ['bullish'], BEAR: ['bearish'] } },
  ],
  nhnl: [
    { key: 'universe', type: 'enum', from: 'door', path: 'activeUniverse' },
    { key: 'universes', type: 'set', from: 'door', door: true, inOpts: true },
  ],
  volumescan: [{ key: 'list', type: 'enum', from: 'door', path: 'volActive' }],
  scatter: [
    { key: 'xKey', type: 'enum', from: 'door', default: 'rvol' },
    { key: 'yKey', type: 'enum', from: 'door', default: 'chg_today' },
    { key: 'sizeKey', type: 'enum', from: 'door', default: '' },
    { key: 'labelMode', type: 'enum', options: ['spotlight', 'all', 'off'], default: 'spotlight' },
    { key: 'followList', type: 'boolean', default: false },
    { key: 'universe', type: 'enum', from: 'door', path: 'activeUniverse', clears: ['followList'] },
    { key: 'universes', type: 'set', from: 'door', door: true, inOpts: true },
  ],
  tradeExchangeNews: NEWS_CONTROLS,
  researchLibrary: NEWS_CONTROLS,
}

/** A widget's rows beyond paramsSchema. */
export const ownControls = (type) => OWN[type] || []

/** Everything a person can set on a mounted widget, in one list: the schema's `live` fields, then its own rows. A row of the
 *  same key as a schema field replaces it (a Theme Tracker's period is its own state, not the captured param). */
export function widgetControls(type) {
  const own = ownControls(type)
  return [...(WIDGET_REGISTRY[type]?.paramsSchema || []).filter(f => f.live === true && !own.some(c => c.key === f.key)), ...own]
}
