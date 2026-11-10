// ⭐ GIVENS REGISTRY — the starting state a teaching case DECLARES, and the one place each declared given is built.
//
// A case says what it needs: `given: ["aiAnswer"]` on the case itself (a hand-written cases file, such as a held-out set), or,
// for the GENERATED inventory cases (cases.inventory.json is rewritten by agentGuideInventory), by id in caseGivens.json.
// given.mjs merges these into the state it already derives by rule, and teach.mjs builds them. Nothing pokes the DOM: every
// given is built from something the app itself reads or writes. A build can use these parts:
//
//   widgets   the board's widgets (the board pref the workspace reads on load: charts_workspace_layout)
//   prefs     any other preference the app reads on load
//   routes    fixture routes the app's OWN requests are answered on (lib.mjs matches "METHOD /path" before the harness)
//   query     harness query flags (agentHarness.jsx reads them on load)
//   setup     a page script that goes through the app's own modules and routes, after the board has loaded
//   prelude   a MEMBER'S ACT, with real CDP input on the app's own control, for state that exists only after an act:
//             an AI Search answer on /charts lives only in the widget's session (no store holds one to load), so the
//             member asks, and the widget's own request is answered on its own route.
//
// An unknown given name is an error, never a silent plain board. Test-only (dev harness): never bundled.

const chart = (id, color, x, y, w, h, opts = {}) => ({ id, type: 'chart', color, x, y, w, h, opts: { tf: 'D', ...opts } })
const watch = (extra = {}) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: {}, ...extra })

// pages/charts/widgets/AiSearchWidget.jsx: the streaming route refused → `tryStream` returns null → the single-shot route, whose
// body `applyFinal` reads as { answer, citations, related_questions }
const AI_QUESTION = 'What is a pullback?'
const AI_ANSWER = { answer: 'A pullback is a short move against the trend before it resumes. (Teaching fixture, not a real answer.)', citations: [], related_questions: [] }

// pages/journal-2-0/hooks/useJ2Notes.js: the list is { notes, total } (summaries); one note is { note } with its TipTap body
const NOTE = { id: 'n-teach', title: 'Teaching note', folderId: null, tags: [], created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z' }
const NOTE_BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A note to edit.' }] }] }

export const GIVENS = {
  // an answer in the AI Search widget, so the controls under each answer (Save, Copy) and the top bar's Send to Journal show
  aiAnswer: {
    about: 'an AI Search widget on the board with one answer in it (asked by the member, answered on the widget’s own route)',
    widgets: [chart('w-chart-a', 'A', 0, 0, 10, 20), { id: 'w-ai', type: 'aisearch', color: 'A', x: 10, y: 0, w: 8, h: 20, opts: {} }, watch()],
    routes: () => [
      { match: '^POST /api/ai-search/stream', status: 500, body: { error: 'teaching fixture: no stream' } },
      { match: '^POST /api/ai-search$', body: AI_ANSWER },
    ],
    async prelude({ b, sleep }) {
      const at = await b.evaluate(`(() => {
        const w = document.querySelector('[data-widget-type="aisearch"]')
        const f = w && [...w.querySelectorAll('textarea, input')].find(e => e.type !== 'hidden' && e.getBoundingClientRect().width > 20)
        if (!f) return null
        const r = f.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      if (!at) return 'aiAnswer: no ask box in the AI Search widget'
      await b.click(at.x, at.y); await sleep(200)
      await b.type(AI_QUESTION); await b.key('Enter')
      const ok = await b.waitFor(`!!document.querySelector('[data-widget-type="aisearch"] [title="Copy answer text"]')`, { timeout: 15000 }).catch(() => false)
      return ok ? 'aiAnswer: asked, answered' : 'aiAnswer: asked, no answer shown'
    },
  },
  // one of the member's notes open in the Notebook widget (the widget keeps the open note in its own opts.noteId)
  noteOpen: {
    about: 'a Notebook widget on the board with one note open in it (opts.noteId, the note served on the Journal’s own routes)',
    widgets: [chart('w-chart-a', 'A', 0, 0, 10, 20), { id: 'w-note', type: 'notebook', color: 'A', x: 10, y: 0, w: 8, h: 20, opts: { noteId: NOTE.id } }, watch()],
    routes: () => [
      { match: '^GET /api/j2/notes/' + NOTE.id + '$', body: { note: { ...NOTE, bodyJson: NOTE_BODY } } },
      { match: '^GET /api/j2/notes([?]|$)', body: { notes: [NOTE], total: 1 } },
      { match: '^GET /api/j2/note-folders$', body: { folders: [] } },
    ],
  },
  // Replay running on the board. The cutoff is session state in ChartsWorkspace (replayCutoff: no pref, no route holds it), so
  // the member starts it the way the product offers: Tools ▾ → Replay Mode → a date → Start replay (ReplayPanel's own controls)
  replayRunning: {
    about: 'Replay Mode running on the board (started by the member from Tools ▾ → Replay Mode, a date 60 days back)',
    async prelude({ b, sleep }) {
      const box = (sel) => b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
      const press = async (sel, wait = 600) => { const at = await box(sel); if (!at) return false; await b.click(at.x, at.y); await sleep(wait); return true }
      if (!(await press('[data-guide="workspace.tools"]'))) return 'replayRunning: no Tools menu'
      if (!(await press('[data-guide="workspace.tools.replay"]'))) return 'replayRunning: no Replay Mode item'
      // a date input takes its parts as typed digit KEYS (not inserted text), in the browser's own order (headless Chrome, en-US:
      // month, day, year), from its first part: the press lands on the field's left edge
      const field = await b.evaluate(`(() => { const e = document.querySelector('[data-guide="replay.panel"] input[type="date"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 } })()`)
      if (!field) return 'replayRunning: no date field'
      await b.click(field.x, field.y); await sleep(200)
      const d = new Date(Date.now() - 60 * 86400000)
      for (const ch of String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + d.getFullYear()) {
        for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: ch, code: 'Digit' + ch, text: type === 'keyDown' ? ch : undefined, windowsVirtualKeyCode: 48 + Number(ch) })
      }
      await sleep(300)
      const filled = await b.evaluate(`document.querySelector('[data-guide="replay.panel"] input[type="date"]')?.value || ''`)
      if (!filled) return 'replayRunning: the date did not take'
      if (!(await press('[data-guide="replay.start"]', 900))) return 'replayRunning: no Start replay'
      const closed = await b.evaluate(`!document.querySelector('[data-guide="replay.panel"]')`)
      return closed ? `replayRunning: started (to ${filled})` : 'replayRunning: Start replay left the panel open'
    },
  },
}

/** The given names a case declares: on the case itself and, by id, in caseGivens.json (deduplicated, in order). */
export function declaredGivens(c, byId = {}) {
  const own = Array.isArray(c?.given) ? c.given : []
  const listed = Array.isArray(byId?.[c?.id]) ? byId[c.id] : []
  return [...new Set([...own, ...listed])]
}

/** Merge declared givens into the given object `g` built by rule (given.mjs). A declared board REPLACES the rule's board. */
export function applyGivens(g, names) {
  if (!names.length) return g
  const routes = []
  const setups = []
  for (const n of names) {
    const d = GIVENS[n]
    if (!d) throw new Error(`unknown given "${n}" (givens.mjs knows: ${Object.keys(GIVENS).join(', ')})`)
    if (d.widgets) { if (g.widgets && g.widgets !== d.widgets) throw new Error(`given "${n}" sets a board another given already set`); g.widgets = d.widgets }
    if (d.prefs) g.prefs = { ...(g.prefs || {}), ...d.prefs }
    if (d.routes) routes.push(...d.routes())
    if (d.query) g.extraQuery = [...(g.extraQuery || []), d.query]
    if (d.setup) setups.push(d.setup)
  }
  g.declared = names
  if (routes.length) g.declaredRoutes = routes
  if (setups.length) g.declaredSetups = setups
  return g
}

/** Run the declared givens' member acts, in order; each says what it did (recorded on the case). */
export async function runPreludes(names, ctx) {
  const said = []
  for (const n of names) if (GIVENS[n]?.prelude) said.push(await GIVENS[n].prelude(ctx))
  return said
}
