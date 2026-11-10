// app/src/agent/watchlistTarget.js — WHICH Watchlist widget a model plan's watchlist.showList acts on (pl-exec, watchlist group A;
// Lead 2026-11-09: "with 2+ watchlist widgets and no clear referent, ASK; never guess"). The words decide, never the model:
//   one Watchlist widget the member could switch       → it (nothing to screen)
//   several, and the words name exactly one by position ("the left watchlist", "the right watchlist widget")
//                                                       → that one (a plan naming another, or none, is aimed there)
//   several, and the words name none (or more than one) → { ask }: nothing runs
import { positionWord } from './host'

const SHOW_ACTIONS = new Set(['watchlist.showList', 'watchlist.exportList'])
const POS = /\b(top|bottom|upper|lower|left|right|first|second|other)(?:[\s-]+(left|right))?\s+(?:watch ?list|list widget|watch ?list widget|one)\b/gi

/** → null (nothing to screen) | { ops } (aimed at the widget the words name) | { ask: text } (nothing runs). */
export function screenWatchlistWidget({ host, ops, text }) {
  const shows = (ops || []).filter(o => SHOW_ACTIONS.has(o?.action))
  if (!shows.length) return null
  let raw = []
  try { raw = host?.widgets?.snapshot?.()?.raw || [] } catch { raw = [] }
  const lists = raw.filter(w => w.type === 'watchlist')
  const free = lists.filter(w => !w.opts?.source && !w.opts?.listSub)
  if (free.length < 2) return null
  const word = (w) => { try { return positionWord(w, lists) || '' } catch { return '' } }
  const named = new Set()
  for (const m of String(text || '').matchAll(POS)) {
    const said = [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase().replace('upper', 'top').replace('lower', 'bottom'))
    const hits = free.filter(w => said.every(p => word(w).split('-').includes(p)))
    if (hits.length === 1) named.add(String(hits[0].id))
  }
  if (named.size !== 1) {
    const which = free.map(w => `the ${word(w) || 'unplaced'} one`).join(' or ')
    return { ask: `You have ${free.length} Watchlist widgets — which one: ${which}? Nothing changed yet.` }
  }
  const id = [...named][0]
  return { ops: (ops || []).map(o => (SHOW_ACTIONS.has(o?.action) ? { ...o, args: { ...(o.args || {}), widget: id } } : o)) }
}
