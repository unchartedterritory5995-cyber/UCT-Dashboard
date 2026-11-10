// app/src/agent/watchlistTarget.js — WHICH Watchlist widget a model plan's watchlist.showList acts on (pl-exec, watchlist group A;
// Lead 2026-11-09: "with 2+ watchlist widgets and no clear referent, ASK; never guess"). The words decide, never the model:
//   one Watchlist widget the member could switch       → it (nothing to screen)
//   several, and the words name exactly one by position ("the left watchlist", "the right watchlist widget")
//                                                       → that one (a plan naming another, or none, is aimed there)
//   several, and the words name none (or more than one) → { ask }: nothing runs
import { positionWord } from './host'

const SHOW_ACTIONS = new Set(['watchlist.showList', 'watchlist.exportList'])
const POS = /\b(top|bottom|upper|lower|left|right|first|second|other)(?:[\s-]+(left|right))?\s+(?:watch ?list|list widget|watch ?list widget|one)\b/gi
// words that set the widget named right after them aside
const NEGATED = /(?:not|except|but|besides|without|other than|instead of)(?:\s+(?:in|on|to|for|the|my|that))*\s*$/i

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
  const excluded = new Set()
  const said0 = String(text || '')
  for (const m of said0.matchAll(POS)) {
    const said = [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase().replace('upper', 'top').replace('lower', 'bottom'))
    const hits = free.filter(w => said.every(p => word(w).split('-').includes(p)))
    // AUDIT #1027: a widget the words EXCLUDE ("not the left watchlist", "anything but / except the right watchlist") is never
    // the one meant — it is set aside, never picked (and nothing is inferred by elimination: the member is asked)
    if (NEGATED.test(said0.slice(Math.max(0, m.index - 24), m.index))) { for (const w of hits) excluded.add(String(w.id)); continue }
    if (hits.length === 1) named.add(String(hits[0].id))
  }
  for (const id of excluded) named.delete(id)
  if (named.size !== 1) {
    const which = free.filter(w => !excluded.has(String(w.id))).map(w => `the ${word(w) || 'unplaced'} one`).join(' or ')
    return { ask: `You have ${free.length} Watchlist widgets — which one: ${which}? Nothing changed yet.` }
  }
  const id = [...named][0]
  return { ops: (ops || []).map(o => (SHOW_ACTIONS.has(o?.action) ? { ...o, args: { ...(o.args || {}), widget: id } } : o)) }
}
