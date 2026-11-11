// app/src/agent/watchlistTarget.js — WHICH Watchlist widget a model plan's watchlist.showList / exportList acts on (pl-exec, watchlist
// group A; Lead 2026-11-09: "with 2+ watchlist widgets and no clear referent, ASK; never guess"). AUDIT #1027 F1: the rule itself is
// the shared which-widget module (whichWidget.js), so this is the model path's screen over it, with its own words for the question:
//   one Watchlist widget the member could switch       → it (nothing to screen)
//   several, and the words name exactly one (its position, the list it shows, its unique linked ticker)
//                                                       → that one (a plan naming another, or none, is aimed there)
//   several, and the words name none (or more than one), or only the one they set aside ("not the left watchlist")
//                                                       → { ask }: nothing runs
import { whichWidget, listSwitchable } from './whichWidget'

const SHOW_ACTIONS = new Set(['watchlist.showList', 'watchlist.exportList'])

/** → null (nothing to screen) | { ops } (aimed at the widget the words name) | { ask: text } (nothing runs). */
export function screenWatchlistWidget({ host, ops, text }) {
  if (!(ops || []).some(o => SHOW_ACTIONS.has(o?.action))) return null
  let raw = []
  try { raw = host?.widgets?.snapshot?.()?.raw || [] } catch { raw = [] }
  const free = raw.filter(w => w.type === 'watchlist' && listSwitchable(w))
  if (free.length < 2) return null
  let out = ops
  for (let i = 0; i < out.length; i++) {
    const o = out[i]
    if (!SHOW_ACTIONS.has(o?.action)) continue
    const r = whichWidget(o.args || {}, host, String(text || ''), { type: 'watchlist', can: listSwitchable })
    if (r?.refuse) return { ask: r.refuse }
    if (r?.ask) {
      const which = r.ask.choices.map(c => `the ${(/\(([^)]+)\)/.exec(c.label) || [])[1] || 'unplaced'} one`).join(' or ')
      return { ask: `You have ${free.length} Watchlist widgets — which one: ${which}? Nothing changed yet.` }
    }
    if (r?.args) out = out.map((x, j) => (j === i ? { ...x, args: r.args } : x))
  }
  return { ops: out }
}
