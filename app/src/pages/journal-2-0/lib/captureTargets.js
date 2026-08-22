// ─── WHERE A CAPTURE CAN GO ──────────────────────────────────────────────────
//
// Every widget already knows how to produce a capture; what was hardcoded was
// the DESTINATION. `sendCaptureToJournal` had exactly one route baked in
// (last-active note → inbox), so "send this to a NEW entry" or "copy a link to
// this view" meant a new hand-rolled flow per widget — the same drift that
// produced six hand-rolled capture doors.
//
// One registry, so a destination added here is available from every widget's
// door at once, and a widget added later gets every destination for free.
//
// A target is: { id, label, hint, run(attrs, ctx) -> toast line }.
//   attrs = the built widgetEmbed attrs (params already normalized/frozen)
//   ctx   = { widgetId, label }  — `label` names the capture in toasts
//
// ⛔ Targets return the TOAST LINE and never render anything: the caller owns
// its toast surface (hosts differ — header chip, workspace-level, page-level).

import { chartsLinkUrl } from '../../../lib/chartDeepLink'

const LAST_NOTE_KEY = 'uct.jw.lastNote'
const LAST_NOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The last-active note, or null when there isn't a FRESH one. A note last
 *  opened days ago is not "the note I'm working in" — appending there
 *  silently buries the capture (panel finding). */
export function freshLastNote() {
  let last = null
  try { last = JSON.parse(localStorage.getItem(LAST_NOTE_KEY) || 'null') } catch { /* private mode */ }
  if (last?.ts && Date.now() - last.ts > LAST_NOTE_MAX_AGE_MS) return null
  return last?.id ? last : null
}

async function appendToNote(noteId, attrs) {
  const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attrs }),
  })
  return res.ok
}

async function pushToInbox(widgetId, attrs) {
  const res = await fetch('/api/j2/inbox', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      widgetId, params: attrs.params,
      searchText: attrs.searchText, capturedAt: attrs.capturedAt,
      // Capture-time drawings ride the row — the tray's place() would
      // otherwise re-seed from the LIVE store at placement time, putting
      // Tuesday's drawings under a "captured Monday" stamp (review finding).
      annotations: attrs.annotations,
    }),
  })
  return res.ok
}

export const CAPTURE_TARGETS = {
  // The default route, unchanged in behavior: the note you're working in,
  // falling back to the inbox when there isn't a fresh one (or it's gone).
  note: {
    id: 'note',
    label: 'Current note',
    hint: 'Append to the note you have open (or the inbox)',
    run: async (attrs, { widgetId, label }) => {
      const last = freshLastNote()
      if (last && await appendToNote(last.id, attrs)) {
        // Name the destination — "your last note" was unverifiable.
        return last.title ? `${label} sent to “${last.title}”` : `${label} sent to your most recent note`
      }
      // 404 = the note was deleted since — fall through to the inbox.
      return await pushToInbox(widgetId, attrs)
        ? `${label} captured → Notebook inbox`
        : 'Capture failed — try again'
    },
  },

  // Start a fresh entry FROM what you're looking at, instead of hunting for
  // a note first. The embed is the note's first block.
  newNote: {
    id: 'newNote',
    label: 'New entry',
    hint: 'Start a new notebook entry containing this',
    run: async (attrs, { label }) => {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: label,
          bodyJson: { type: 'doc', content: [{ type: 'widgetEmbed', attrs }, { type: 'paragraph' }] },
        }),
      })
      if (!res.ok) return 'Capture failed — try again'
      const note = (await res.json().catch(() => ({})))?.note
      // Make the new entry the capture target too, so the next capture from
      // any widget lands in the entry the user just started.
      if (note?.id) {
        try {
          localStorage.setItem(LAST_NOTE_KEY, JSON.stringify({
            id: note.id, ts: Date.now(), title: (note.title || '').trim() || null,
          }))
        } catch { /* private mode */ }
      }
      return `New entry started — “${label}”`
    },
  },

  // Bank it without choosing a home yet (the hotkey's landing zone).
  inbox: {
    id: 'inbox',
    label: 'Notebook inbox',
    hint: 'Bank it for later, without picking an entry',
    run: async (attrs, { widgetId, label }) =>
      (await pushToInbox(widgetId, attrs)
        ? `${label} captured → Notebook inbox`
        : 'Capture failed — try again'),
  },

  // Not a capture at all: a link that re-opens this VIEW on the charts page.
  // Lives in the same registry because from a widget's point of view it
  // answers the same question — "send this somewhere".
  copyChartLink: {
    id: 'copyChartLink',
    label: 'Copy chart link',
    hint: 'Copy a link that opens this on the Charts page',
    appliesTo: (widgetId, attrs) => widgetId === 'chart' && !!attrs?.params?.symbol,
    run: async (attrs) => {
      const url = chartsLinkUrl({ symbol: attrs.params.symbol, tf: attrs.params.tf })
      try {
        await navigator.clipboard.writeText(url)
        return 'Chart link copied'
      } catch {
        return 'Could not copy — clipboard blocked'
      }
    },
  },
}

/** Targets available for a given capture, in menu order. */
export function targetsFor(widgetId, attrs) {
  return Object.values(CAPTURE_TARGETS).filter(
    (t) => typeof t.appliesTo !== 'function' || t.appliesTo(widgetId, attrs),
  )
}
