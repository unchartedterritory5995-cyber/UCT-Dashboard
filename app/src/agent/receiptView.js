// ── RECEIPT VIEW (live test 2026-10-28: short, natural responses) ─────────────────────────────────────
//
// A receipt is UCT's record of exactly what changed (never model text). The member reads ONE short line: a
// one-line receipt as it is ("Set up four daily charts for SPY, QQQ, NVDA and TSLA in a 2×2 grid…"); several
// lines as ONE sentence ("Done — created your “EMA % Diff” indicator and added it to SPY.", "Done — … (and 2
// more changes).") — the full record one click away (Details), word for word, with its Undo. Pure: derived
// from the receipt's own lines at render time, so stored history, records and Undo are untouched.

import { looksLikeFormula } from './capabilities/indicatorAuthoring'

// a line that reports a finished change starts with one of these (the capabilities' own receipt wording)
const DONE_VERB = /^(?:Added|Set(?: up)?|Removed|Changed|Moved|Resized|Arranged|Grew|Saved|Switched|Made|Copied|Duplicated|Created|Renamed|Applied|Turned|Showed|Showing|Hid|Locked|Unlocked|Opened|Closed|Linked|Unlinked|Restyled|Placed|Put|Gave|Colou?red|Styled|Drew|Deleted|Cleared|Sorted|Reordered|Updated|Replaced|Moved|Raised|Lowered|Enabled|Disabled|Starred|Unstarred|Discarded)\b/
const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
// a receipt line's parenthetical detail ("(1 reused, 3 new)") belongs in Details, not the one-liner
const brief = (s) => String(s || '').replace(/\s*\([^()]*\)\s*$/, '').replace(/[.!]+$/, '').trim()

/** `{ summary, details }` — summary: one sentence; details: the receipt's lines, word for word ('' = none). */
export function receiptView(lines, { isUndo = false } = {}) {
  const ls = (lines || []).map(l => String(l || '').trim()).filter(Boolean)
  if (!ls.length) return { summary: '', details: '' }
  const all = ls.join(' · ')
  if (isUndo) return { summary: all, details: '' }
  const done = (s) => (DONE_VERB.test(s) ? `Done — ${lcFirst(s)}` : s)
  // an indicator the member asked to CREATE: its chart add + its Save are ONE thing to them
  const saved = ls.find(l => /^Saved to your indicators\b/.test(l))
  const added = ls.map(l => /^Added (.+?) (?:on|to) (.+?)(?: — | · |\.$|$)/.exec(l)).find(Boolean)
  if (saved && added && ls.length === 2) {
    // the SAVED name (the chart's label may be a shortened one); one that reads like a formula is never put in chat
    // (the save line leads with the name only when it is one — a description there is never taken for it)
    const lead = /^Saved to your indicators — (.+?) — /.exec(saved)?.[1] || ''
    const nm = (lead && lead.length <= 48 && !/[:;]/.test(lead) ? lead : added[1]).replace(/^[“"]|[”"]$/g, '')
    const name = looksLikeFormula(nm) || nm.length > 48 ? 'your indicator' : `your “${nm}” indicator`
    const pane = /— drawn in its own pane\b/.test(saved) ? ', in its own pane' : ''
    return { summary: `Done — created ${name} and added it to ${added[2].replace(/[.!]+$/, '')}${pane}.`, details: all }
  }
  // ONE line already IS one short sentence ("Added EMA 20 on Left chart (NVDA)") — said as it is, once
  if (ls.length === 1) return { summary: ls[0], details: '' }
  // hotfix 2026-11-03 (live T1: "Done — added 2 Charts (and 2 more changes)." — the tickers only in Details): new charts
  // each given a ticker are said WITH their tickers, when every new chart's ticker is in the receipt
  const addedN = /^Added (a|\d+) Charts?\b/.exec(ls[0])
  const born = ls.slice(1).map(l => /^New chart \d+: (?:Changed|Switched) symbol to ([^\s.]+)\.?$/.exec(l)).filter(Boolean)
  if (addedN && born.length && born.length === (addedN[1] === 'a' ? 1 : Number(addedN[1]))) {
    const rest = ls.slice(1).filter(l => !born.some(m => m.input === l))
    const syms = born.map(m => m[1])
    const names = syms.length === 1 ? syms[0] : `${syms.slice(0, -1).join(', ')} and ${syms[syms.length - 1]}`
    const head = `Done — added ${syms.length === 1 ? 'a chart' : `${syms.length} charts`} for ${names}`
    return { summary: rest.length ? `${head} (and ${rest.length} more change${rest.length === 1 ? '' : 's'}).` : `${head}.`, details: all }
  }
  const more = ls.length - 1
  return { summary: `${done(brief(ls[0]))} (and ${more} more change${more === 1 ? '' : 's'}).`, details: all }
}
