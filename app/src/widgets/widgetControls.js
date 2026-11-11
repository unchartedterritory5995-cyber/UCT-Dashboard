// What a person can set on a mounted widget that the registry's paramsSchema does not offer: the machine-readable description
// widget.setOption validates, writes and reads back. It sits beside widgets/registry.js, not inside it, because the registry
// is in the Notebook's first-open bytes and only the Agent reads this. Metadata only.
//
//   { key, type: 'enum'|'boolean'|'number'|'day'|'set', options|min+max+integer, default, clears,
//     path:    where it lives in `opts` ('filters.cp'); default: key
//     from:    'door' = its choices are the mounted widget's own right now (pages/charts/widgetDoors.js)
//     door:    true = the widget's own writer, not `opts` (its state lives in the widget, or the write is more than one key);
//              Undo goes back through that writer
//     inverse: true = a set whose stored members are the ones turned OFF (a hidden list)
//     inOpts:  true = a door write whose whole result is in `opts`: Undo needs only those opts
//     all:     true = an empty set means every member, and a full one is stored empty }
// A `set` takes "+member" / "-member". agent/settingsLiveness.test.js proves a row the same way as a `live` field: an `opts`
// row is read back from opts by the mounted widget, a door row is read and written by its door.
import { WIDGET_REGISTRY } from './registry'

const NEWS_CONTROLS = [
  { key: 'category', type: 'set', options: ['News', 'Macro', 'Options', 'Earnings', 'Price', 'Press Release', 'Filing', 'Other'], path: 'categories', all: true, clears: ['presetId'] },
  { key: 'watchlist', type: 'enum', from: 'door', path: 'watchlistId' },
]

const OWN = {
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
  optionsflow: [
    { key: 'minPremium', type: 'enum', options: [0, 250000, 500000, 1000000], default: 0, path: 'filters.minPrem' },
    { key: 'callPut', type: 'enum', options: ['all', 'C', 'P'], default: 'all', path: 'filters.cp' },
    { key: 'printType', type: 'enum', options: ['all', 'SWEEP', 'BLOCK'], default: 'all', path: 'filters.type' },
    { key: 'direction', type: 'enum', options: ['all', 'BULL', 'BEAR'], default: 'all', path: 'filters.dir' },
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
