// ── RECEIPT VIEW (live test 2026-10-28: short, natural responses) ─────────────────────────────────────
//
// A receipt is UCT's record of exactly what changed (never model text). The member reads ONE short line: a
// one-line receipt as it is ("Set up four daily charts for SPY, QQQ, NVDA and TSLA in a 2×2 grid…"); several
// lines as ONE sentence ("Done — created your “EMA % Diff” indicator and added it to SPY.", "Done — … (and 2
// more changes).") — the full record one click away (Details), word for word, with its Undo. Pure: derived
// from the receipt's own lines at render time, so stored history, records and Undo are untouched.

import { looksLikeFormula } from './capabilities/indicatorAuthoring'
import { tfLabel } from './capabilities/chart'

// a line that reports a finished change starts with one of these (the capabilities' own receipt wording)
const DONE_VERB = /^(?:Added|Set(?: up)?|Removed|Changed|Moved|Resized|Arranged|Grew|Saved|Switched|Made|Copied|Duplicated|Created|Renamed|Applied|Turned|Showed|Showing|Hid|Locked|Unlocked|Opened|Closed|Linked|Unlinked|Restyled|Placed|Put|Gave|Colou?red|Styled|Drew|Deleted|Cleared|Sorted|Reordered|Updated|Replaced|Moved|Raised|Lowered|Enabled|Disabled|Starred|Unstarred|Discarded)\b/
const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
// a receipt line's parenthetical detail ("(1 reused, 3 new)") belongs in Details, not the one-liner
const brief = (s) => String(s || '').replace(/\s*\([^()]*\)\s*$/, '').replace(/[.!]+$/, '').trim()
// ⭐ W2 (receipts): only a DETAIL parenthetical is dropped from the one-liner — never a chart's name "(SPY · Weekly)" or an
// indicator's inputs "RSI (14)"
const briefer = (s) => String(s || '').replace(/\s*\((?=[^()]*(?:—|,|re-tiled|reused|linked|not linked))[^()]*\)\s*$/, '').replace(/[.!]+$/, '').trim()
// up to this many lines are said in full in the one-liner; a longer receipt says the first and points at Details
const SAY_ALL = 4
const tfWord = (tf) => String(tfLabel(tf) || tf)
// "Daily" → "daily", "5 minutes" → "5-minute", "1 hour" → "1-hour" — a chart's timeframe as an adjective
const tfAdj = (tf) => tfWord(tf).toLowerCase().replace(/^(\d+) minutes?$/, '$1-minute').replace(/^(\d+) hours?$/, '$1-hour')
// a chart named on the receipt ("Chart (SPY)") is said with its timeframe after the change ("Chart (SPY · Weekly)")
function withTimeframes(line, charts) {
  let out = line
  for (const c of charts) {
    if (!c?.label || !c.tf || !out.includes(c.label)) continue
    // a product label ends with its ticker "(SPY)" → "(SPY · Weekly)"; any other label gets both "(SPY · Weekly)"
    const named = /\([^()]+\)$/.test(c.label) ? c.label.replace(/\)$/, ` · ${tfWord(c.tf)})`) : `${c.label} (${c.symbol} · ${tfWord(c.tf)})`
    if (out.includes(named)) continue
    out = out.split(c.label).join(named)
  }
  return out
}

/** `{ summary, details }` — summary: one sentence; details: the receipt's lines, word for word ('' = none). */
// `charts` (W2, optional — set by the runtime on new receipts): [{ label, symbol, tf, isNew }] for every chart the change
// touched, read after it committed. With it, the one-liner names each chart with its symbol AND timeframe; Details stay
// the receipt's lines word for word.
// `name` (W2): this receipt is ONE part of a multi-part request — a line that names no chart is said on its chart.
// `unsaved` (live train 4: a workspace conflict left "Added four new charts…" reading as done): the change is ON SCREEN but
// was NOT saved — the one-liner says so first, never as a finished change; Details keep the record word for word
export function receiptView(lines, opts = {}) {
  const v = receiptViewOf(lines, opts)
  if (!opts.unsaved || !v.summary) return v
  const what = v.summary.replace(/^Done — /, '').replace(/[.]+$/, '')
  return { summary: `On your screen but NOT saved: ${what.charAt(0).toLowerCase()}${what.slice(1)}.`, details: v.details || (lines || []).join(' · ') }
}
function receiptViewOf(lines, { isUndo = false, charts = null, name = false } = {}) {
  const raw = (lines || []).map(l => String(l || '').trim()).filter(Boolean)
  if (!raw.length) return { summary: '', details: '' }
  const all = raw.join(' · ')
  if (isUndo) return { summary: all, details: '' }
  const meta = Array.isArray(charts) ? charts.filter(c => c && typeof c === 'object') : []
  const old = meta.filter(c => !c.isNew)
  const solo = name && old.length === 1 && old[0].label ? old[0] : null
  // a ONE-line receipt already names its one chart as the product does; the timeframe is added where several changes are said together
  const ls = meta.length && (raw.length > 1 || solo) ? raw.map(l => withTimeframes(solo && !l.includes(solo.label) && !l.includes(`(${solo.symbol}`) ? `${solo.label}: ${l}` : l, old)) : raw
  const done = (s) => (DONE_VERB.test(s) ? `Done — ${lcFirst(s)}` : s)
  // an indicator the member asked to CREATE: its chart add + its Save are ONE thing to them
  const saved = raw.find(l => /^Saved to your indicators\b/.test(l))
  const added = raw.map(l => /^Added (.+?) (?:on|to) (.+?)(?: — | · |\.$|$)/.exec(l)).find(Boolean)
  if (saved && added && raw.length === 2) {
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
    const join = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
    // ⭐ W2: each new chart's timeframe too — "added 2 daily charts for NVDA and QQQ", "added charts for NVDA (Daily) and QQQ (Weekly)"
    const tfs = syms.map(s => meta.find(c => c.isNew && c.symbol === s)?.tf || null)
    const oneTf = tfs.every(Boolean) && new Set(tfs).size === 1 ? tfs[0] : null
    const head = oneTf ? `Done — added ${syms.length === 1 ? `a ${tfAdj(oneTf)} chart` : `${syms.length} ${tfAdj(oneTf)} charts`} for ${join(syms)}`
      : tfs.every(Boolean) ? `Done — added ${syms.length === 1 ? 'a chart' : `${syms.length} charts`} for ${join(syms.map((s, i) => `${s} (${tfWord(tfs[i])})`))}`
        : `Done — added ${syms.length === 1 ? 'a chart' : `${syms.length} charts`} for ${join(syms)}`
    if (!rest.length) return { summary: `${head}.`, details: all }
    if (rest.length < SAY_ALL) return { summary: `${head}; ${rest.map(l => lcFirst(briefer(l))).join('; ')}.`, details: all }
    return { summary: `${head} (and ${rest.length} more change${rest.length === 1 ? '' : 's'} — see Details).`, details: all }
  }
  // ⭐ W2: a multi-change receipt says EVERY change (each chart named, with its timeframe) when there are only a few;
  // a longer one says the first and points at Details, which list them all
  if (ls.length <= SAY_ALL) return { summary: `${done(briefer(ls[0]))}; ${ls.slice(1).map(l => lcFirst(briefer(l))).join('; ')}.`, details: all }
  const more = ls.length - 1
  return { summary: `${done(brief(ls[0]))} (and ${more} more change${more === 1 ? '' : 's'} — see Details).`, details: all }
}
