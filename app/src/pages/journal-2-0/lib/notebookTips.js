// S13 (audit 2026-11-05): surface the Notebook's hidden gems AT THE MOMENT OF NEED. A one-time tip appears the first
// time a member does the thing the gem is about, and never again.
//
//   ticker  the first `$TICKER` a member writes -> the hover card (price, averages, earnings, your history);
//   chart   the first chart a member inserts   -> drawing a plan that the Setups board then tracks.
//
// ⛔ ONCE, PER ACCOUNT. Seen tips are recorded in ONE preference key, `notebook_tips` = {v:1, seen:[ids]}, through
// `setPrefMerged` (the same per-account preference store the get-started checklist uses), so a tip seen on the phone
// never shows on the desktop. A tip is recorded the moment it SHOWS, so a reload, a second tab or a dismissal never
// brings it back. Its row in `api/routers/auth.py` `_PREFERENCE_KEYS` is required (an unlisted key answers 400).
// ⛔ A TIP NAMES ONLY A DOOR THAT IS THERE. The ticker tip needs the hover card (Notebook widgets W1); the chart tip
// needs the chart plan AND the Setups board. With a gate off, the tip is never shown and never recorded.
// ⛔ PURE AND SMALL: no React. It runs on the editor's update path (NotebookTipSlot.jsx), which is the typing path.
import { parsePref } from '../../../hooks/usePreferences'
import { findTickerRanges } from './tickerChip'
import { widgetsWaveOn } from './notebookWidgetsFlags'
import { chartPlanEnabled } from './widgetEmbedCore'
import { setupsBoardEnabled } from './setupsBoardLink'

export const TIPS_PREF = 'notebook_tips'
// Audit 2026-11-05 S16/S20 (Tier 3a fix round 1): the 60-second first run's marks and the once-per-ACCOUNT "first live
// widget" mark ride the same preference, so the server's schema (auth.py NOTEBOOK_TIP_IDS) knows them too. Hyphenated:
// the server rail reads these ids as [a-z0-9-]+.
export const TIP_IDS = Object.freeze({ ticker: 'ticker', chart: 'chart', firstRun: 'first-run', firstRunSkipped: 'first-run-skipped', firstRunBuilt: 'first-run-built', firstRunInline: 'first-run-inline', firstLiveWidget: 'first-live-widget' })

/** The words, verbatim from the audit's spec (S13). `touch`: the member has no hover (a phone or tablet). */
export const TIP_COPY = Object.freeze({
  ticker: (touch) => `${touch ? 'Tap' : 'Hover'} a ticker to see price, averages, earnings and your history.`,
  chart: () => 'Draw entry, stop and target to track it on your Setups board.',
  dismiss: 'Got it',
  label: 'Tip',
})

/** The ids recorded as seen, as a Set. Tolerates the server's TEXT or an object. */
export function seenTips(raw) {
  const v = parsePref(raw, null)
  const seen = v && typeof v === 'object' && Array.isArray(v.seen) ? v.seen : []
  return new Set(seen.filter((s) => typeof s === 'string' && s))
}

/** `current` with `id` recorded, or undefined when it already is (an undefined from a setPrefMerged updater
 *  abandons the write). */
export function withTipSeen(current, id) {
  const have = seenTips(current)
  if (have.has(id)) return undefined
  const base = parsePref(current, null)
  return { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}), v: 1, seen: [...have, id] }
}

/** Whether a tip's door is there for this member right now. */
export function tipAvailable(id) {
  if (id === TIP_IDS.ticker) return widgetsWaveOn(1)
  if (id === TIP_IDS.chart) return chartPlanEnabled() && setupsBoardEnabled()
  return false
}

/** The member has just WRITTEN a `$TICKER`: a whole symbol of 2+ letters, closed by the boundary they just typed
 *  (the space or punctuation right after it, with the caret after that). Typing "$N" -- the first letter -- is not a
 *  ticker yet (Tier 2 review minor 8). A note opened with tickers in it, or a caret parked elsewhere, is not writing.
 *  The block is read with each inline atom (a mention, an inline image) as ONE character, the same count ProseMirror's
 *  `parentOffset` uses, so an atom earlier in the line never shifts the match. */
export function wroteTicker(state) {
  const sel = state?.selection
  if (!sel || !sel.empty) return false
  const $head = sel.$head
  const block = $head.parent
  if (!block?.isTextblock || block.type.spec.code) return false
  const at = $head.parentOffset
  const text = block.textBetween(0, block.content.size, undefined, '￼')
  if (at < 1 || /[\w$]/.test(text[at - 1] || '')) return false            // the last key was the boundary
  return findTickerRanges(text).some((r) => r.symbol.length >= 2 && at === r.to + 1)
}

/** The transaction INSERTED a chart block (a `widgetEmbed` whose widget is `chart`). */
export function insertedChart(tr) {
  for (const step of tr?.steps || []) {
    const content = step?.slice?.content
    if (!content || !content.size) continue
    let found = false
    content.descendants((node) => {
      if (found) return false
      if (node.type?.name === 'widgetEmbed' && node.attrs?.widgetId === 'chart') found = true
      return !found
    })
    if (found) return true
  }
  return false
}

const countWidgets = (doc) => {
  let n = 0
  doc?.descendants?.((node) => { if (node.type?.name === 'widgetEmbed') n += 1 })
  return n
}

/** S20 trust incidents (Tier 3a fix round 1, review I4): the transaction is an UNDO (prosemirror-history's meta,
 *  `{redo: false}`) after which the note holds MORE widgets than before it -- so a widget the member deleted was
 *  brought back. An undo of a widget's settings change, of a move, or of an insert keeps or lowers the count, and a
 *  redo is never one. */
export function restoredWidgetByUndo(tr) {
  const meta = tr?.getMeta?.('history$')
  if (!meta || meta.redo !== false || !tr.docChanged) return false
  return countWidgets(tr.doc) > countWidgets(tr.before)
}

/** Which tip (if any) this editor update earns: the chart tip on a chart insert, the ticker tip on a written ticker. */
export function tipFor(tr, state) {
  if (insertedChart(tr)) return TIP_IDS.chart
  if (tr?.docChanged && wroteTicker(state)) return TIP_IDS.ticker
  return null
}
