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
//   iaCatalog the indicator-alert catalog the page's simulated alert route serves (acceptance/lib.mjs open)
//   setup     a page script that goes through the app's own modules and routes, after the board has loaded
//   prelude   a MEMBER'S ACT, with real CDP input on the app's own control, for state that exists only after an act:
//             an AI Search answer on /charts lives only in the widget's session (no store holds one to load), so the
//             member asks, and the widget's own request is answered on its own route.
//
// An unknown given name is an error, never a silent plain board. Test-only (dev harness): never bundled.
//
// Two kinds, named so: a given via STORE/ROUTE SEED (widgets, prefs, routes, query, setup) and a given via REAL-INPUT PRELUDE.

// a saved definition the authoring rails already use (tests/fixtures/authoring/batch2_definitions.json `styled_markers`)
import AUTHORING from '../../../../../tests/fixtures/authoring/batch2_definitions.json' with { type: 'json' }
const SAVED_DEF = AUTHORING.styled_markers

const chart = (id, color, x, y, w, h, opts = {}) => ({ id, type: 'chart', color, x, y, w, h, opts: { tf: 'D', ...opts } })
const watch = (extra = {}) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: {}, ...extra })

// The indicator-alert catalog in the server's own entry shape (api/services/alert_user_series.py entries, the acceptance runner's
// IA_CATALOG): { indicator, label, conditions, default_threshold, plots: [{ value, label, conditions, default_threshold, inputs,
// instance_label, output_type? }] }. The form opens on catalog[0] (IndicatorAlertPopover seeds it), so the entry listed FIRST is
// the indicator the form shows.
const LEVEL = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true }, { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true }]
const RSI = { indicator: 'rsi', label: 'RSI', conditions: LEVEL, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: LEVEL, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] }
const macdPlot = (value, label) => ({ value, label, conditions: LEVEL, default_threshold: 0, inputs: { fast: 12, slow: 26, signal: 9 }, instance_label: 'MACD (12, 26, 9)' })
const MACD = { indicator: 'macd', label: 'MACD', conditions: LEVEL, default_threshold: 0, plots: [macdPlot('macd', 'MACD line'), macdPlot('macd.signal', 'Signal line'), macdPlot('macd.hist', 'Histogram')] }
// a member's own yes/no formula (the saved definition above), served as the store serves a user entry: its plot's output_type
// derived as `condition` (alert_trigger_policy.output_type_of), no default threshold
const SIGNAL = { indicator: SAVED_DEF.id, label: SAVED_DEF.meta.name, source: 'user', conditions: LEVEL, default_threshold: null, plots: [{ value: `${SAVED_DEF.id}.buy`, label: SAVED_DEF.meta.shortName, conditions: LEVEL, default_threshold: null, inputs: {}, instance_label: SAVED_DEF.meta.name, output_type: 'condition' }] }

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
  // One of the member's own saved indicators (the library's "Your indicators" tab shows only when there is one). A ROUTE SEED: the
  // definitions list the chart installs from (hooks/useUserDefinitions.js, GET /api/user-definitions) answers with one row in the
  // store's own shape, { definitions: [{ def_id, version, rev, definition }] } (the fetcher refuses anything else). The harness's
  // ?defs=1 in-page store is not used: the runner's live relay takes every /api/user-definitions call before it
  savedIndicator: {
    about: 'one saved indicator of the member’s own, on the definitions list route the chart installs from (a route seed)',
    routes: () => [{ match: '^GET /api/user-definitions([?]|$)', body: { definitions: [{ def_id: SAVED_DEF.id, version: SAVED_DEF.version, rev: 1, definition: SAVED_DEF }] } }],
  },
  // The indicator-alert form open on an indicator with several lines (MACD), so its Plot list shows. A ROUTE SEED: the alert
  // catalog route (served by the harness's own simulated /api/indicator-alerts/catalog, from `iaCatalog`) lists MACD first
  alertFormMultiLine: {
    about: 'the alert catalog lists MACD (three lines) first, so the indicator-alert form opens on it (a route seed)',
    iaCatalog: [MACD, RSI],
  },
  // The form open on a yes/no signal (a member's own condition formula), so its trigger policy ("Alert when") shows
  alertFormSignal: {
    about: 'the alert catalog lists one of the member’s own yes/no formulas first, so the form opens on a signal (a route seed)',
    iaCatalog: [SIGNAL, RSI],
  },
  // An indicator alert on the chart's symbol that cannot fire: it names an indicator the catalog no longer offers (the popover's
  // own rule: catalogReady && !byAddress.has(a.indicator)). Created through the app's alert route (simulated in the page)
  blockedAlert: {
    about: 'an indicator alert on SPY whose indicator the catalog no longer offers, created on the alerts route (a route seed)',
    iaCatalog: [RSI],
    setup: `(async () => { const r = await fetch('/api/indicator-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sym: 'SPY', indicator: 'retired_osc', condition: 'above', threshold: 1, tf: 'D' }) }); return r.ok ? 'blockedAlert: created' : 'blockedAlert: refused ' + r.status })()`,
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
    if (d.iaCatalog) { if (g.iaCatalog && g.iaCatalog !== d.iaCatalog) throw new Error(`given "${n}" sets an alert catalog another given already set`); g.iaCatalog = d.iaCatalog }
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
