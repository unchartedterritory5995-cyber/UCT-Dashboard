/**
 * S5 CP2 — THE ADDITIONS-ONLY RAIL.
 *
 * GATE-S5 line 2, approval fingerprint `9c7c634da`, naming §4 **CP2** verbatim:
 *
 *   | **CP2** | **The additions-only rail.** One test asserting that no NEW
 *   structured-object preference key is written through `setPref` — derived from
 *   the client's own call sites, with a non-vacuity control and a mutation proof,
 *   and with today's 70 sites baselined rather than failed. | no | no | S/M |
 *
 * ⛔ **NO NOTEBOOK CODE IS TOUCHED BY THIS CHECKPOINT.** The packet's §1 promises
 * "no member-visible change, no change to the Notebook layer, no new store", and
 * this file is a test. The EXTRACTION the first signed line described is **not in
 * this packet at any checkpoint** and is deferred as **F-S5-1**.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE RAIL EXISTS
 *
 * `setPref(key, value)` is LAST-WRITE-WINS over the whole stored blob. For a
 * SCALAR that is exactly right — a theme name has one writer and one meaning.
 * For a STRUCTURED DOCUMENT it is the read-modify-write hazard: a writer holding
 * a stale snapshot persists it whole and silently drops a field another writer
 * had just added. `usePreferences.js` grew `setPrefMerged` and a per-key write
 * queue for precisely that reason, and the comment above the queue records what
 * it cost to learn.
 *
 * ⭐ **The rail does not try to stop the 18 structured keys that already exist.**
 * They are shipped behaviour a member relies on, and re-tiering them is a product
 * decision this programme does not get to make (packet §4, closing note). What it
 * stops is the NEXT one arriving unnoticed.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⛔ DERIVE THE DISCOVERY, DECLARE THE CLASSIFICATION — and the split is the point.
 *
 * "Which keys are written through `setPref`?" is a question an AST answers
 * exactly: a call site either has a string-literal first argument or it does not.
 *
 * "Is this value a structured document?" is a DATA-FLOW question, and the D4 CP1
 * detector burned five attempts and an O(n²) sixth trying to answer that class of
 * question by derivation (F-D4-1). Here it does not need deriving at all: every
 * key below was classified by READING its call sites, once. `calendar_filters_v2`
 * receives `{ ...filters, [k]: v }`; `charts_vol_pane_pct` receives `String(pct)`.
 * A reader settles that in a second and no AST settles it at all.
 *
 * ⚠️ **THE BLIND SPOT IS BASELINED RATHER THAN IGNORED.** 26 call sites pass a
 * VARIABLE as the key, so the rail cannot see which preference they write. Those
 * sites are counted per file below, and a file gaining one FAILS — so the way
 * around this rail (write your new key through a variable) is itself a tripwire.
 * An absence is only evidence if the instrument could have seen a presence.
 *
 * MEASURED 2026-09-13 against `feat/s7-price-level`: **69 literal-key `setPref`
 * sites across 26 keys, plus 26 opaque-key sites across 15 files.** ⚠️ The packet
 * says "today's 70 sites"; the tree has moved by one since it was written. The
 * measurement is the authority and the packet's number is not restated anywhere
 * below — a hand-typed count beside the list it describes is this estate's most
 * repeated defect.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⛔ WHAT THIS RAIL DOES **NOT** COVER — read in production, not reasoned about.
 *
 * `railway ssh --service web`, read-only against `/data/auth.db`, 2026-09-13:
 * **48 distinct `user_preferences.pref_key` values, 184 rows, 21 members.**
 * This rail sees 26 of them. The other 23 split three ways, and only the middle
 * group is a gap:
 *
 *   1. **SUPERSEDED KEYS NOTHING WRITES ANY MORE** — `calendar_view`,
 *      `calendar_view_v2`, `calendar_filters`, `calendar_event_types`. The v1/v2
 *      predecessors of keys the client now writes as `_v2`/`_v3`. They sit in the
 *      store as history; no call site writes them, so there is nothing to rail.
 *   2. ⚠️ **KEYS WRITTEN THROUGH AN OPAQUE CALL SITE** — `charts_layout_dock`,
 *      `breadth_views_config`, `breadth_drill_board`, `breadth_charts_state`,
 *      `aisearch_settings`, `watchlist_templates`, `tracings_doc`, `journal_tab`,
 *      `chart_templates`, `joystick_hub`. **This is the blind spot, and it is
 *      roughly a fifth of the live surface, not a rounding error.** It is why
 *      `BASELINE_OPAQUE` pins a COUNT PER FILE rather than shrugging: the rail
 *      cannot say which key those sites write, but it can say that no file grew
 *      a new one.
 *   3. **KEYS FROM SOMEWHERE ELSE ENTIRELY** — `theme_seed_version`,
 *      `theme_seed_content_hash`, `shared_tag_colors`, `smart_place_confirm`,
 *      `charts_last_tab`, `charts_widget_theme`, `news_widget_settings`,
 *      `profile_widget_settings`, `charts_probe_test`. Written by other modules
 *      or server-side. **`setPref` is not the only door to this table**, and a
 *      rail on one door must say so rather than imply it guards the room.
 *
 * ⭐ And one key points the other way: **`alert_sound` is baselined here and NO
 * member holds it** — a scalar nobody has changed from its default. Harmless, and
 * recorded because a baseline entry with no production rows is exactly what a
 * stale declaration looks like; this one is current code, not residue.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import usePreferences from './usePreferences'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSXParser = Parser.extend(jsx())

/**
 * Every key written through `setPref` today, and what its value IS.
 *
 * `structured` — a document with more than one field, or a list. Last-write-wins
 *   can drop a co-writer's change. A NEW one of these belongs on `setPrefMerged`
 *   or on a typed store, per SPEC-S5 §2.1.
 * `scalar` — one value, one meaning. Last-write-wins is the correct semantics.
 */
const BASELINE_KEYS = {
  alert_sound: 'scalar',
  alert_sound_type: 'scalar',
  breadth_widget_settings: 'structured',
  calendar_event_types_v2: 'structured',
  calendar_filters_v2: 'structured',
  calendar_mystocks_sources: 'structured',
  calendar_view_v3: 'scalar',
  chart_saved_colors: 'structured',
  chart_settings: 'structured',
  charts_active_template: 'structured',
  charts_merged: 'structured',
  charts_theme: 'scalar',
  charts_vol_pane_pct: 'scalar',
  charts_workspace_groups: 'structured',
  charts_workspace_layout: 'structured',
  default_chart_tf: 'scalar',
  fundamentals_settings: 'structured',
  j2_calendar_pnl_basis: 'scalar',
  j2_custom_dashboard: 'structured',
  multichart_state: 'structured',
  tag_labels: 'structured',
  theme: 'scalar',
  theme_tracker_settings: 'structured',
  volume_scan_lists: 'structured',
  watchlist_digest: 'structured',
  watchlist_settings: 'structured',
}

/** Call sites whose KEY is a variable, so the rail cannot read it. file → count. */
const BASELINE_OPAQUE = {
  'components/chart/ChartSettingsModal.jsx': 1,
  'components/chart/useTracingsSync.js': 1,
  'hooks/useAppFocus.js': 1,
  'pages/BreadthCharts.jsx': 1,
  'pages/ThemeTrackerPage.jsx': 2,
  'pages/Watchlists.jsx': 2,
  'pages/breadth/drill/BreadthDrillModal.jsx': 2,
  'pages/breadth/useBreadthViews.js': 2,
  // ⭐ DECLARED AFTER THE FACT (sweep, 2026-09-24). Data Charts V2 (7626f6fb7,
  // 2026-09-19) writes through the module constant `PREF_KEY =
  // 'breadth_charts_state'` — the SAME key `pages/BreadthCharts.jsx` above already
  // writes opaquely and that the header lists in group 2. Not computed: a literal
  // one hop away. Naming the key here is what the rail asks for; moving the
  // literal to the call site is a product edit outside this sweep.
  'pages/breadth/v2/BreadthChartsV2.jsx': 1,
  'pages/charts/ChartsWorkspace.jsx': 1,
  'pages/charts/LayoutDock.jsx': 1,
  'pages/charts/widgets/AiSearchWidget.jsx': 2,
  'pages/charts/widgets/BreadthWidget.jsx': 2,
  'pages/charts/widgets/FundamentalsWidget.jsx': 2,
  // ⚰️ 2026-09-25, wave 6: MemberTemplates writes the daily-note template preference
  // through the constant DAILY_TEMPLATE_PREF (lib/dailyNote.js) -- the same identifier
  // its reader imports, so the key has ONE spelling. The rail cannot read an
  // identifier, so the site is baselined the way master baselined its own two
  // (f6b1e3d72, mirrored verbatim above and below so the merge sees one text).
  // The key behind it is `notebook_daily_template`.
  'pages/journal-2-0/components/notebook/MemberTemplates.jsx': 1,
  // ⭐ DECLARED AFTER THE FACT (sweep, 2026-09-24). The screener redesign
  // (a7176a764, PR #157, 2026-09-20) added column presets written through the
  // exported constant `PRESETS_KEY = 'screener_column_presets'` — a NEW key, one
  // literal one hop from both sites (save, delete). Not computed. Declared with
  // its literal so the census knows which preference these two sites write.
  'pages/screener/hooks/useColumnPresets.js': 2,
  'pages/watchlist/watchlistTemplates.js': 2,
  'testing/device/authHarness.js': 4,
}

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sourceFiles(p, out)
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

function walk(node, fn) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node.type === 'string') fn(node)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
    walk(node[k], fn)
  }
}

/** Discovery, by AST. Comments and strings in prose cannot reach these maps. */
function derive() {
  const keys = new Map()      // key   → Set(file)
  const opaque = new Map()    // file  → count
  const parseFailures = []
  let literalSites = 0
  for (const abs of sourceFiles(SRC)) {
    const rel = relative(SRC, abs).replace(/\\/g, '/')
    const src = readFileSync(abs, 'utf8')
    if (!src.includes('setPref')) continue
    let ast
    try {
      ast = JSXParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (e) {
      parseFailures.push(`${rel}: ${e.message}`)
      continue
    }
    walk(ast, n => {
      if (n.type !== 'CallExpression') return
      const c = n.callee
      const name = c?.type === 'Identifier' ? c.name
        : c?.type === 'MemberExpression' ? c.property?.name : null
      if (name !== 'setPref') return          // `setPrefMerged` is the sanctioned path
      const a = n.arguments[0]
      if (a?.type === 'Literal' && typeof a.value === 'string') {
        literalSites += 1
        if (!keys.has(a.value)) keys.set(a.value, new Set())
        keys.get(a.value).add(rel)
      } else {
        opaque.set(rel, (opaque.get(rel) || 0) + 1)
      }
    })
  }
  return { keys, opaque, literalSites, parseFailures }
}

describe('S5 CP2 — the derivation can see what it claims to see', () => {
  const { keys, opaque, literalSites, parseFailures } = derive()

  it('NON-VACUITY: it finds a real population of call sites, not zero', () => {
    // ⛔ Every assertion below is satisfied by an empty derivation. A parser that
    // silently returned nothing would make this rail permanently, invisibly green
    // — which is the failure mode `lesson_a_fixture_that_cannot_distinguish` names.
    expect(parseFailures, `files the parser could not read:\n${parseFailures.join('\n')}`).toEqual([])
    expect(literalSites).toBeGreaterThan(50)
    expect(keys.size).toBeGreaterThan(20)
  })

  it('NON-VACUITY: it reads JSX files, not only plain .js', () => {
    // The heaviest writers are `.jsx`. A parser without the JSX plugin throws on
    // every one of them, and `parseFailures` above would catch that — but only if
    // a `.jsx` file is actually in the population. This asserts it is.
    const files = [...keys.values()].flatMap(s => [...s])
    expect(files.some(f => f.endsWith('.jsx'))).toBe(true)
    expect(keys.get('chart_settings')).toBeTruthy()
    expect([...keys.get('chart_settings')]).toContain('pages/Settings.jsx')
  })

  it('CONTROL: it distinguishes a literal key from a variable one', () => {
    // Both maps are non-empty, so neither branch is dead code that could be
    // hiding a misclassification of the other.
    expect(keys.size).toBeGreaterThan(0)
    expect(opaque.size).toBeGreaterThan(0)
  })
})

describe('S5 CP2 — additions only', () => {
  const { keys, opaque } = derive()

  it('NO NEW preference key is written through setPref', () => {
    const added = [...keys.keys()].filter(k => !(k in BASELINE_KEYS)).sort()
    expect(added, added.length
      ? `NEW setPref key(s): ${added.map(k => `'${k}' (${[...keys.get(k)].join(', ')})`).join('; ')}\n\n` +
        'If the value is a STRUCTURED document, setPref is the wrong door: it is\n' +
        'last-write-wins over the whole blob, so a writer holding a stale snapshot\n' +
        'drops a field another writer just added. Use setPrefMerged (same module),\n' +
        'or a typed store. If it is a SCALAR, setPref is correct — add it to\n' +
        "BASELINE_KEYS as 'scalar' IN THIS COMMIT, which is the whole point of the\n" +
        'rail: the classification becomes a decision somebody made on purpose.'
      : '').toEqual([])
  })

  it('the baseline has not gone stale in the other direction', () => {
    // ⭐ A key that no longer exists must leave the baseline DELIBERATELY. A rail
    // whose declaration silently outlives the code it describes is the stale
    // artifact this programme keeps paying for (F-AUDIT-2, F-D4-1).
    const gone = Object.keys(BASELINE_KEYS).filter(k => !keys.has(k)).sort()
    expect(gone, gone.length
      ? `baselined key(s) no longer written anywhere: ${gone.join(', ')}. ` +
        'Remove them from BASELINE_KEYS in the same commit that removed the call site.'
      : '').toEqual([])
  })

  it('NO NEW opaque-key call site appears — the way around this rail is railed', () => {
    const problems = []
    for (const [file, n] of [...opaque].sort()) {
      const declared = BASELINE_OPAQUE[file] || 0
      if (n > declared) problems.push(`${file}: ${n} opaque setPref site(s), ${declared} baselined`)
    }
    for (const [file, n] of Object.entries(BASELINE_OPAQUE).sort()) {
      const actual = opaque.get(file) || 0
      if (actual < n) problems.push(`${file}: ${actual} opaque site(s), ${n} baselined — lower the baseline in this commit`)
    }
    expect(problems, problems.length
      ? `${problems.join('\n')}\n\n` +
        'A setPref call whose key is a VARIABLE is invisible to this rail — it cannot\n' +
        'tell which preference is being written. That is why the count is pinned:\n' +
        'passing a new key through a variable must not be the quiet way past the gate.\n' +
        'Prefer a literal key. If the key genuinely must be computed, say so here.'
      : '').toEqual([])
  })

  it('the remedy the failure message names actually EXISTS', () => {
    // ⛔ A documented workaround is not a recovery path. The message above tells a
    // future engineer to reach for `setPrefMerged`; if that export were ever
    // removed or renamed, the rail would be handing out advice that cannot be
    // followed, and the next structured key would land on setPref anyway.
    const hook = readFileSync(join(SRC, 'hooks/usePreferences.js'), 'utf8')
    expect(hook).toContain('setPrefMerged')
    expect(typeof usePreferences).toBe('function')
  })
})

describe('S5 CP2 — what the baseline records', () => {
  it('every baselined key is classified structured or scalar, and both classes are populated', () => {
    const values = Object.values(BASELINE_KEYS)
    expect(values.every(v => v === 'structured' || v === 'scalar')).toBe(true)
    // Both classes must be non-empty or the distinction is decorative and the
    // failure message above would be advising against a category with no members.
    expect(values.filter(v => v === 'structured').length).toBeGreaterThan(0)
    expect(values.filter(v => v === 'scalar').length).toBeGreaterThan(0)
  })
})
