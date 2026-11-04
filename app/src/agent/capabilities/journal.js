// ── JOURNAL capabilities (W2-C1): the member's Notebook notes — read, and CREATE through the Notebook's one path ──
//
//   journal.listNotes    a QUERY: the member's recent notes (title, ticker, when) — from the page host's list
//                        (the same GET /api/j2/notes the Notebook reads)
//   journal.createNote   a WRITE: a new note (title, text, optional ticker) through pages/journal-2-0/lib/
//                        noteCreation.createNoteViaApi — the ONE creation path NotebookTab, the Ticker Research
//                        workspace and the voice note use (POST /api/j2/notes). The receipt names the note; Undo
//                        TRASHES it through the editor's own DELETE /api/j2/notes/{id} (it is restorable from
//                        Trash — nothing is destroyed), refused if the note was edited since.
// ⛔ Trades, positions and accounts are NOT written here (personal records, money): there is no capability
// for them, so nothing can be planned — a request to log a trade is declined by the registry itself.
// Offered on /journal only in W2-C1 (W2-C3 adds "add this to my notes" from /charts).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'

const REF = 'notes'
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const LIST_DEFAULT = 10
const LIST_MAX = 25

function snap(host) {
  const src = host?.journal
  if (!src) return null
  const notes = src.notes() || []
  return { ref: REF, label: 'Your notes', notes, count: notes.length, limits: src.limits || { title: 120, text: 4000 } }
}
const when = (iso) => (iso ? String(iso).slice(0, 10) : '')

export const journalKind = {
  name: 'journal',
  boardScoped: false,
  selfDescribing: true,
  persistsInCommit: true,
  list: (host) => { const s = snap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? snap(host) : null),
  stateOf: (s) => ({ count: s.count, create: null, trash: null }),
  patch: (before, after) => (after.create ? { create: after.create } : after.trash ? { trash: after.trash } : null),
  async commit(host, ref, patch) {
    const src = host.journal
    if (patch.create) {
      const made = await src.create(patch.create)
      if (!made?.id) throw new Error('the Notebook did not confirm the new note')
      return { undoData: { noteId: made.id, title: made.title || patch.create.title }, lines: [`Added note “${made.title || patch.create.title}”${patch.create.ticker ? ` (${patch.create.ticker})` : ''} to your Notebook`] }
    }
    if (patch.trash) {
      const ok = await src.trash(patch.trash.noteId)
      if (!ok) throw new Error('the Notebook refused to move that note to Trash')
      return { lines: [`Moved “${patch.trash.title}” to Trash (you can restore it there)`] }
    }
    return false
  },
  // the POST / DELETE answered with the server's own row: that answer is the read-back
  landed: (s, patch) => !!s && (!!patch.create || !!patch.trash),
  undoPatch: (it) => (it.undoData?.noteId ? { trash: { noteId: it.undoData.noteId, title: it.undoData.title } } : null),
  fingerprint: (s) => `notes:${s.count}`,
  // Undo needs only THAT note: still there, as the Agent made it
  fingerprintFor: (host, s, it) => {
    const id = it.undoData?.noteId
    if (!id) return `notes:${s.count}`
    const n = (s.notes || []).find(x => x.id === id)
    return n ? `${id}:${n.updatedAt || ''}` : `${id}:unlisted`
  },
}

let registered = false
export function registerJournalCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(journalKind)
  registerContextProvider({
    key: 'journal',
    build: (host, refFor) => {
      const s = snap(host)
      if (!s) return undefined
      return [{ ref: refFor('journal', REF), label: 'Your Notebook (list recent notes; create a note here)', notes: s.count, recent: s.notes.slice(0, 12).map(n => `${n.title || '(untitled)'}${n.ticker ? ` [${n.ticker}]` : ''}`) }]
    },
  })

  registerCapability({
    name: 'journal.listNotes',
    surfaces: ['journal'],
    target: 'journal', query: true,
    summary: 'List the member\'s recent Notebook notes (title, ticker, last updated). Use it for "list my notes", "what notes do I have on NVDA?".',
    hints: 'target = the ref of the notes entry; symbol = a ticker to filter by, else null; limit = how many (null = 10, at most 25).',
    args: { type: 'object', properties: { symbol: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } }, required: ['symbol', 'limit'], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower }) => {
      if (/^(list|show)( me)? my (recent |latest )?notes[?.!]?$/.test(lower) || /^what notes do i have[?.!]?$/.test(lower)) return { symbol: null, limit: null }
      const m = /^(?:list|show)(?: me)? my notes (?:on|for|about) \$?([a-z][a-z0-9.-]{0,9})[?.!]?$/.exec(lower)
      return m ? { symbol: upper(m[1]), limit: null } : null
    },
    answer(s, { symbol, limit }) {
      if (!s) return 'Your Notebook is not available here.'
      const sym = symbol ? upper(symbol) : null
      const n = Math.min(Math.max(Number(limit) || LIST_DEFAULT, 1), LIST_MAX)
      const rows = s.notes.filter(x => !sym || x.ticker === sym).slice(0, n)
      if (!rows.length) return sym ? `You have no notes on ${sym} among your recent notes.` : 'You have no notes yet.'
      return {
        text: `${sym ? `Your notes on ${sym}` : 'Your recent notes'} (${rows.length}${s.count > rows.length ? ` of ${s.count} loaded` : ''}):\n` + rows.map(x => `• ${x.title || '(untitled)'}${x.ticker && !sym ? ` [${x.ticker}]` : ''}${x.updatedAt ? ` — ${when(x.updatedAt)}` : ''}`).join('\n'),
        link: { href: '/journal/notebook', label: 'Open Notebook' },
      }
    },
  })

  registerCapability({
    name: 'journal.createNote',
    surfaces: ['journal'],
    target: 'journal',
    createsResource: true,
    summary: 'Create a new note in the member\'s Notebook with a title and text (optionally tied to a ticker) — exactly as "+ New note" does. Use it for "add a note: …", "write down that …". Undo moves it to Trash.',
    hints: 'target = the ref of the notes entry. title: a short title (the member\'s words, or a sensible one from the text); text: the note body, the member\'s words — never invent facts; symbol: the ticker the note is about, else null.',
    args: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, symbol: { type: ['string', 'null'] } }, required: ['title', 'text', 'symbol'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw }) => {
      const m = /^(?:add|create|write|make|save) (?:a )?(?:new )?note(?: to my notebook| in my notebook| in my journal)?(?: about \$?([A-Za-z][A-Za-z0-9.-]{0,9}))?\s*[:—-]\s*(.+)$/i.exec(String(raw).trim())
      if (!m || !m[2].trim()) return null
      const text = m[2].trim()
      const sym = m[1] ? upper(m[1]) : null
      return { title: text.length > 60 ? `${text.slice(0, 57).trim()}…` : text, text, symbol: sym && TICKER.test(sym) ? sym : null, __explicit: true }
    },
    check(st, { title, text, symbol }, env) {
      const lim = env?.target?.limits || { title: 120, text: 4000 }
      if (!String(text || '').trim()) return 'What should the note say?'
      if (!String(title || '').trim()) return 'The note needs a title.'
      if (String(title).length > lim.title) return `Keep the title under ${lim.title} characters.`
      if (String(text).length > lim.text) return `That note is too long for one note (${lim.text} characters at most).`
      if (symbol != null && symbol !== '' && !TICKER.test(upper(symbol))) return `“${symbol}” doesn't look like a ticker.`
      if (st.create) return 'One note at a time.'
      return null
    },
    apply: (st, { title, text, symbol }) => ({ ...st, create: { title: String(title).trim(), text: String(text).trim(), ticker: symbol ? upper(symbol) : null } }),
    describe: (b, a) => (a.create ? `Added note “${a.create.title}”${a.create.ticker ? ` (${a.create.ticker})` : ''} to your Notebook` : null),
  })
}
