// A test board that behaves like the Charts workspace where it matters to the
// Agent: the product's own planPlacement places each add, ids are minted per add,
// a new widget joins link group A by default (pickWidgetColor's rule), the color
// dot can unlink a widget ('N' → its own `N:<id>` symbol key, as WidgetHost
// does), and charts read their symbol from their link group.
import { planPlacement } from '../../pages/charts/placement/place'
import { buildWidgetSource } from '../host'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

export function makeBoard(widgets, groupSyms = { A: 'AAPL' }, { failAddAt = null } = {}) {
  const state = { widgets: widgets.map(w => ({ color: 'A', opts: {}, ...w })), groupSyms: { ...groupSyms } }
  let n = 0
  let adds = 0
  const keyOf = (w) => (w.color === 'N' ? `N:${w.id}` : w.color)
  const widgetOps = {
    layout: () => state,
    add: (type, slot = null) => {
      adds += 1
      if (failAddAt && adds === failAddAt) return                  // a write that never lands
      // handleAddWidget's rule: an exact slot is honoured only when it is in-bounds
      // and overlaps nothing; otherwise the normal placement decides.
      const free = slot && slot.x >= 0 && slot.y >= 0 && slot.x + slot.w <= 24 && slot.y + slot.h <= 20
        && !state.widgets.some(w => w.x < slot.x + slot.w && slot.x < w.x + w.w && w.y < slot.y + slot.h && slot.y < w.y + w.h)
      const place = free ? { x: slot.x, y: slot.y, w: slot.w, h: slot.h } : planPlacement(state.widgets, type).place
      state.widgets = [...state.widgets, { id: `w-${type}-${++n}`, type, color: 'A', opts: {}, ...place }]
    },
    remove: (id) => { state.widgets = state.widgets.filter(w => w.id !== id) },
    color: (id, color) => { state.widgets = state.widgets.map(w => (w.id === id ? { ...w, color } : w)) },
    cancelPending: () => {},
  }
  const visible = () => state.widgets
  const readChart = (id) => {
    const w = state.widgets.find(x => x.id === id && x.type === 'chart')
    if (!w) return null
    const pos = null
    return {
      ref: id, label: `Chart ${id}`, position: pos,
      symbol: state.groupSyms[keyOf(w)] || 'SPY', tf: w.opts.tf || 'D',
      stored: w.opts.settings ?? null, cs: mergeChartSettings(w.opts.settings || null),
      linkedCount: 0,
    }
  }
  const host = {
    widgets: buildWidgetSource({ widgetOps, getWidgets: visible }),
    charts: {
      list: () => state.widgets.filter(w => w.type === 'chart').map(w => readChart(w.id)),
      read: (ref) => readChart(ref),
      commit: (ref, patch) => {
        const w = state.widgets.find(x => x.id === ref)
        if (!w) return false
        const opts = { ...w.opts }
        if ('settings' in patch) opts.settings = patch.settings
        if ('tf' in patch) opts.tf = patch.tf
        state.widgets = state.widgets.map(x => (x.id === ref ? { ...x, opts } : x))
        if (patch.symbol) state.groupSyms = { ...state.groupSyms, [keyOf(w)]: patch.symbol }
        return true
      },
    },
    otherWidgets: () => [],
  }
  return { host, state, widgetOps }
}
