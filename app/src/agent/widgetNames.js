// ── The names a person calls a widget ON THIS BOARD by, for routing and for the widgetControls section ──
// Execution family W (pl-exec): a request that names a widget on the board ("the theme tracker", "the options flow", "the
// market map") is about that widget, so its one-control action (widget.setOption, routing group boardEdit) is in front of the
// model on the FIRST call, with that widget's controls — not only after a need_groups reroute. The names are the registry's
// own labels (header, Widgets menu, tab), so there is no phrase list here. A label that is a chart-surface word ("Volume", the
// Volume Surge tab) is not a widget's name: those words already mean the chart. Pure: the caller passes the board's types.
import { WIDGET_REGISTRY } from '../widgets/registry'
import { widgetControls } from '../widgets/widgetControls'

export const normName = (s) => ` ${String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
// one word or the next: "theme tracker" ↔ "themes", "new highs / lows" ↔ "new highs lows", a trailing plural either way
const forms = (label) => {
  const base = normName(label).trim()
  if (!base) return []
  const out = new Set([base])
  out.add(base.endsWith('s') ? base.slice(0, -1) : `${base}s`)
  return [...out].filter(x => x.length >= 3)
}
const MEMO = new Map()
/** A type's names: its labels, each with its singular/plural, less any that name the chart surface (`surfaceWord`). */
export function widgetNamesOf(type, surfaceWord = () => false) {
  if (MEMO.has(type)) return MEMO.get(type)
  const labels = Object.values(WIDGET_REGISTRY[type]?.labels || {})
  const names = [...new Set(labels.flatMap(forms))].filter(n => !surfaceWord(n))
  MEMO.set(type, names)
  return names
}
/** The types on the board, with controls, that the message names. */
export function namedWidgetTypes(message, types, surfaceWord) {
  const text = normName(message)
  return [...new Set(types)].filter(t => widgetControls(t).length && widgetNamesOf(t, surfaceWord).some(n => text.includes(` ${n} `)))
}
