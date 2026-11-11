// ── UCT Agent PAGE HOSTS (W2-C1): what each page lets the Agent read and write, through the page's own hooks ──
//
// A page host is the page's binding for the registry's target kinds, exactly as host.js is the Charts
// workspace's. It is built ONCE by the page (usePageAgentHosts.js keeps the page's live values behind
// refs) and handed to AgentProvider; capability modules reach it through their kind.
//
//   /screener  host.screenerPage   read: the screen on the page (its name, matches, the rows shown),
//                                        the member's saved screens and UCT's starters
//                                  write: open a saved / starter screen ON THE PAGE through the page's own
//                                         `applyScreen` door (FocusScreener / ScannerShell → useScreenSpec.applySpec)
//   /breadth   host.breadthPage    read only: what the sheet shows (tab, window, top date, rows, columns)
//   /calendar  host.calendarPage   read only: the loaded week (days, entries by session) and the view
//   /journal   host.journal        read: the member's recent notes; write: CREATE a note through the
//                                        Notebook's one creation path (lib/noteCreation.createNoteViaApi — the
//                                        same POST /api/j2/notes NotebookWidget and NotebookTab make); Undo
//                                        TRASHES that note through the editor's own DELETE /api/j2/notes/{id}
//                                        (restorable from Trash). Trades and positions: not written here.
//
// Every host carries `surface` (the registry filters on it, and the fast path claims no phrase of a
// capability not offered on it), `location()` (app.open says where the member is) and `navigate`.
// ⛔ No DOM, no page internals: a page passes functions; a host never reaches into React state.

import { createNoteViaApi } from '../../pages/journal-2-0/lib/noteCreation'

const fn = (f, fallback) => (typeof f === 'function' ? f : () => fallback)
const str = (v) => (v == null ? '' : String(v))

/** The shared frame of every page host. */
export function buildPageHost({ surface, location, navigate = null, ...rest }) {
  if (!surface) throw new Error('page host needs a surface')
  return {
    surface,
    location: fn(location, `/${surface}`),
    ...(navigate ? { navigate } : {}),
    ...rest,
  }
}

// ── /screener ──
const ROWS_SHOWN = 25
export function buildScreenerPageHost({ read, saved, applyScreen, refreshSaved, location, navigate }) {
  const readPage = fn(read, {})
  const readSaved = fn(saved, { saved: [], starters: [] })
  const applyFn = typeof applyScreen === 'function' ? applyScreen : null
  const refreshFn = fn(refreshSaved, undefined)
  return buildPageHost({
    surface: 'screener', location, navigate,
    screenerPage: {
      // the screen ON THE PAGE now: name, how many matched, the first rows (tickers only — never figures)
      snapshot() {
        const p = readPage() || {}
        const rows = Array.isArray(p.rows) ? p.rows : []
        const current = p.current && typeof p.current === 'object' ? { id: str(p.current.id), name: str(p.current.name), kind: str(p.current.kind || '') } : null
        return {
          current,
          total: Number.isFinite(Number(p.total)) && p.total !== null ? Number(p.total) : null,
          rows: rows.slice(0, ROWS_SHOWN).map(r => ({ ticker: str(r?.ticker).toUpperCase(), name: str(r?.name || r?.company || '') })),
          rowCount: rows.length,
          filters: Array.isArray(p.filters) ? p.filters.map(str) : Object.keys(p.filters || {}),
          loading: p.loading === true,
          edited: p.edited === true,
        }
      },
      saved() {
        const lib = readSaved() || {}
        const one = (s, kind) => ({ id: str(s?.id), name: str(s?.name), kind, spec: s?.spec || null })
        return {
          saved: (lib.saved || []).map(s => one(s, 'saved')),
          starters: (lib.starters || []).map(s => one(s, 'starter')),
        }
      },
      // the page's own door (what the Screen menu / Pinned chips call); null = this layout offers none
      apply: applyFn ? (item) => applyFn(item.spec || { filters: [] }, item) : null,
      refreshSaved: () => refreshFn(),
    },
  })
}

// ── /breadth ──
export function buildBreadthPageHost({ read, location, navigate }) {
  const readPage = fn(read, {})
  return buildPageHost({
    surface: 'breadth', location, navigate,
    breadthPage: {
      snapshot() {
        const p = readPage() || {}
        return {
          tab: str(p.tab || 'breadth'),
          days: Number.isFinite(Number(p.days)) ? Number(p.days) : null,
          topDate: p.topDate ? str(p.topDate) : null,
          rowCount: Number.isFinite(Number(p.rowCount)) ? Number(p.rowCount) : 0,
          columns: Array.isArray(p.columns) ? p.columns.map(str) : [],
          live: p.live === true,
          loading: p.loading === true,
        }
      },
    },
  })
}

// ── /calendar ──
const SESSIONS = ['bmo', 'amc', 'tbd']
export function buildCalendarPageHost({ read, location, navigate }) {
  const readPage = fn(read, {})
  return buildPageHost({
    surface: 'calendar', location, navigate,
    calendarPage: {
      snapshot() {
        const p = readPage() || {}
        const data = p.data || {}
        const days = {}
        for (const [ds, d] of Object.entries(data.days || {})) {
          if (!d || typeof d !== 'object') continue
          days[ds] = {
            label: str(d.label || ds),
            ...Object.fromEntries(SESSIONS.map(k => [k, (d[k] || []).map(e => str(e?.sym).toUpperCase()).filter(Boolean)])),
            econ: (d.econ || []).map(e => str(e?.title || e?.event || e?.name || '')).filter(Boolean),
          }
        }
        return {
          weekStart: data.week_start ? str(data.week_start) : null,
          weekEnd: data.week_end ? str(data.week_end) : null,
          weekLabel: p.weekLabel ? str(p.weekLabel) : null,
          view: str(p.view || 'week'),
          days,
          loading: p.loading === true,
        }
      },
    },
  })
}

// ── /journal ──
const NOTE_TITLE_MAX = 120
const NOTE_TEXT_MAX = 4000
/** The Notebook's native body: a TipTap doc with one paragraph per line (hub/voiceNote.js's shape). */
export function noteBody(text) {
  const lines = str(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  return { type: 'doc', content: (lines.length ? lines : ['']).map(t => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })) }
}
export function buildJournalPageHost({ notes, refresh, location, navigate, request = (u, o) => fetch(u, { credentials: 'include', ...o }), create = createNoteViaApi }) {
  const readNotes = fn(notes, [])
  const refreshFn = fn(refresh, undefined)
  return buildPageHost({
    surface: 'journal', location, navigate,
    journal: {
      notes() {
        return (readNotes() || []).map(n => ({
          id: str(n?.id), title: str(n?.title || ''), ticker: n?.ticker ? str(n.ticker).toUpperCase() : null,
          updatedAt: str(n?.updatedAt || n?.updated_at || ''), folderId: n?.folderId ? str(n.folderId) : null,
        })).filter(n => n.id)
      },
      limits: { title: NOTE_TITLE_MAX, text: NOTE_TEXT_MAX },
      // the Notebook's ONE creation path (noteCreation.createNoteViaApi) → the created note (id, title)
      async create({ title, text, ticker = null }) {
        const created = await create({ title: str(title).slice(0, NOTE_TITLE_MAX), bodyJson: noteBody(str(text).slice(0, NOTE_TEXT_MAX)), ticker: ticker || undefined })
        await Promise.resolve(refreshFn()).catch(() => {})
        return created ? { id: str(created.id), title: str(created.title ?? title) } : null
      },
      // Undo: the editor's own delete — the note goes to Trash (restorable there), nothing is destroyed
      async trash(id) {
        const r = await request(`/api/j2/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
        await Promise.resolve(refreshFn()).catch(() => {})
        return !!r?.ok
      },
      refresh: () => refreshFn(),
    },
  })
}
