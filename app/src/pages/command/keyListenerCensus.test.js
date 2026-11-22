/**
 * TERM-063 (FB-S2-01) — THE RAW KEY-LISTENER CENSUS, DERIVED BY AST, RATCHETED.
 *
 * "Known it worked": *"An AST-derived census of raw `keydown` listeners outside
 * the registry, railed at a stated ceiling with a control."* This is that rail.
 *
 * ⛔ AN AST, NEVER A GREP. A grep for the event name reports prose, comments and
 * the dispatches in test harnesses (`new KeyboardEvent('keydown', ...)`). Only a
 * parsed call is a listener. Comments are not in the tree, so they are stripped
 * by construction — the first CONTROL below proves it.
 *
 * WHAT IS COUNTED, per file (tests excluded — they dispatch keys, they are not the
 * product; the registry module is excluded — it is the ONE place allowed to call
 * `addEventListener` for a key event):
 *
 *   literal  `x.addEventListener('keydown'|'keyup'|'keypress', ...)` with a static
 *            string (a template literal without expressions counts too).
 *   onprop   `x.onkeydown = ...` / `onkeyup` / `onkeypress` property assignments.
 *   orphan   a static key-event string that is NOT the first argument of an
 *            add/removeEventListener call and NOT the first argument of a
 *            `new *Event(...)` constructor. That is how a DYNAMIC registration
 *            (`for (const ev of ['pointerdown','keydown']) addEventListener(ev, …)`)
 *            or a wrapper hook (`useEventListener('keydown', …)`) shows up, so the
 *            census cannot be dodged by moving the string into a variable.
 *
 * ⛔ OUT OF SCOPE, stated so a reader does not assume otherwise: JSX `onKeyDown`
 * props (element-scoped; they fire only when focus is inside that element) and
 * editor keymaps (TipTap/ProseMirror/CodeMirror, scoped to the editor). Neither
 * is a document- or window-level listener that can steal a key from the page.
 *
 * ⭐ THE RATCHET CAN ONLY SHRINK. A file above its baseline fails by name; a file
 * BELOW its baseline also fails ("lower the baseline in the same commit") so the
 * record never outlives the listener it describes; and the baseline total is
 * held under CEILING, a stated number that is only ever edited downwards.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', '..')
const ROOT = path.join(SRC, '..', '..')
const REGISTRY_FILE = path.join(HERE, 'shortcutRegistry.js')

// ⛔ THE DEV-ONLY STUDY WORKBENCH IS NOT THE PRODUCT (2026-11-21, ruled). app/lab.html is its own vite entry
// (vite.config.lab.mjs, "DEV-ONLY: the Study workbench"); the member app is index.html. The workbench folder is
// DERIVED from lab.html's module script, never typed. ⚠️ BUT THE FOLDER IS NOT THE LINE: the Study pages import
// shared pieces of it (lab/fx, lab/bits, lab/pointers and its stylesheets), so a workbench file is left out of the
// count ONLY when the member app cannot reach it -- reachability is walked from index.html's own entry over every
// relative and `/src/` import (static, dynamic, re-export). A workbench file the product starts importing is counted
// again on that commit, with no edit here.
const APP_DIR = path.join(SRC, '..')
function entryOf(html) {
  const m = fs.readFileSync(path.join(APP_DIR, html), 'utf8').match(/<script[^>]*type="module"[^>]*src="\/([^"]+)"/)
  return m ? path.resolve(APP_DIR, m[1]) : null
}
const LAB_ENTRY = entryOf('lab.html')
const LAB_DIR = LAB_ENTRY ? path.dirname(LAB_ENTRY) : null
const inLab = (abs) => !!LAB_DIR && (abs === LAB_DIR || abs.startsWith(LAB_DIR + path.sep))

/** The module specifiers a parsed file imports (static, dynamic, re-export), as written. */
function importsOf(ast) {
  const out = []
  walk(ast, (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration')
        && n.source && typeof n.source.value === 'string') out.push(n.source.value)
    else if (n.type === 'ImportExpression') {
      const v = staticString(n.source)
      if (v !== undefined) out.push(v)
    }
  })
  return out
}

/** The absolute path a specifier names from `importerAbs`, for the two forms that can reach app/src: relative and
 *  the `/src/` root alias. Bare package names resolve to null. */
function resolveSpec(importerAbs, spec) {
  if (spec.startsWith('./') || spec.startsWith('../')) return path.resolve(path.dirname(importerAbs), spec)
  if (spec.startsWith('/src/')) return path.resolve(APP_DIR, spec.slice(1))
  return null
}

const EXTS = ['', '.js', '.jsx', '.mjs', '.cjs']
/** The parsed file a resolved target names (vite's extension and index resolution), or null. */
function fileFor(target, files) {
  for (const ext of EXTS) if (files.has(target + ext)) return target + ext
  for (const ext of EXTS.slice(1)) if (files.has(path.join(target, 'index' + ext))) return path.join(target, 'index' + ext)
  return null
}

/** Every file reachable from `entry` over `edges` (Map<abs, abs[]>). */
function reachableFrom(entry, edges) {
  const seen = new Set([entry])
  const todo = [entry]
  while (todo.length) for (const next of edges.get(todo.pop()) || []) if (!seen.has(next)) { seen.add(next); todo.push(next) }
  return seen
}

// ⛔ Needles are BUILT, so this file never contains the literal it hunts for.
const KEY_EVENTS = new Set(['key' + 'down', 'key' + 'up', 'key' + 'press'])
const ON_PROPS = new Set([...KEY_EVENTS].map((e) => 'on' + e))
const ADD = 'add' + 'EventListener'
const REMOVE = 'remove' + 'EventListener'

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true,
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

/** The static string value of a node, or undefined. */
function staticString(n) {
  if (!n) return undefined
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return undefined
}

function memberName(n) {
  if (!n || n.type !== 'MemberExpression') return null
  if (!n.computed && n.property.type === 'Identifier') return n.property.name
  return staticString(n.property) ?? null
}

/** Count the three buckets in one source text. Exported shape: {literal, onprop, orphan}. */
function censusOf(src) {
  return countsOf(parse(src))
}

function countsOf(ast) {
  const consumed = new Set()
  let literal = 0
  let onprop = 0
  walk(ast, (n) => {
    if (n.type === 'CallExpression') {
      const name = memberName(n.callee)
      if (name === ADD || name === REMOVE) {
        const a0 = n.arguments[0]
        const v = staticString(a0)
        if (v !== undefined && KEY_EVENTS.has(v)) {
          consumed.add(a0)
          if (name === ADD) literal += 1
        }
      }
    } else if (n.type === 'NewExpression') {
      const ctor = n.callee.type === 'Identifier' ? n.callee.name : memberName(n.callee)
      if (ctor && /Event$/.test(ctor) && n.arguments[0]) consumed.add(n.arguments[0])
    } else if (n.type === 'AssignmentExpression') {
      const name = memberName(n.left)
      if (name && ON_PROPS.has(name)) onprop += 1
    }
  })
  let orphan = 0
  walk(ast, (n) => {
    const v = staticString(n)
    if (v !== undefined && KEY_EVENTS.has(v) && !consumed.has(n)) orphan += 1
  })
  return { literal, onprop, orphan }
}

function productFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue
      productFiles(p, out)
    } else if (/\.(m?jsx?|cjs)$/.test(ent.name) && !/\.(test|spec)\.[mc]?jsx?$/.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

/** The whole census: Map<repo-relative path, {literal, onprop, orphan}> (non-zero only).
 *  Walked once per run and shared by every assertion below. */
let _census = null
function census() {
  if (!_census) _census = walkCensus()
  return _census
}
function walkCensus() {
  const out = new Map()
  const failures = []
  const counts = new Map()          // abs -> {literal, onprop, orphan}, every parsed product file but the registry
  const specs = new Map()           // abs -> the specifiers it imports
  let parsed = 0
  for (const f of productFiles(SRC)) {
    const abs = path.resolve(f)
    let ast
    try { ast = parse(read(f)) } catch (e) { failures.push(`${rel(f)}: ${e.message}`); continue }
    parsed += 1
    specs.set(abs, importsOf(ast))
    if (abs !== path.resolve(REGISTRY_FILE)) counts.set(abs, countsOf(ast))
  }
  const files = new Set(specs.keys())
  const edges = new Map([...specs].map(([abs, list]) => [abs,
    list.map((s) => resolveSpec(abs, s)).filter(Boolean).map((t) => fileFor(t, files)).filter(Boolean)]))
  const reached = reachableFrom(entryOf('index.html'), edges)
  const labFiles = [...files].filter(inLab)
  const labReached = labFiles.filter((f) => reached.has(f))
  for (const [abs, c] of counts) {
    if (inLab(abs) && !reached.has(abs)) continue        // the workbench, where the member app cannot reach it
    if (c.literal || c.onprop || c.orphan) {
      const row = {}
      for (const k of ['literal', 'onprop', 'orphan']) if (c[k]) row[k] = c[k]
      out.set(rel(abs), row)
    }
  }
  return { rows: out, failures, parsed, reachedCount: reached.size, labFiles: labFiles.length,
    labReached: labReached.map(rel) }
}

const total = (rows) => [...rows.values()].reduce((s, r) =>
  s + (r.literal || 0) + (r.onprop || 0) + (r.orphan || 0), 0)

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE BASELINE — raw key listeners OUTSIDE the registry, per file.
// ⚠️ INTERIM, BURN DOWN (2026-11-21, ruled): re-measured ONCE to today's exact per-file counts (151, from 111).
// The rail sat on the known-red list from 11-19 while it grew (164, then 166) and gated nothing; from this commit
// it runs on every app/src PR, so the 152nd raw listener fails, and every migration below must lower its row.
// The dev-only Study workbench is out where the member app cannot reach it (above). Owners of the burn-down: the
// Study games (a registry-backed answer-key hook), charts (patrick-0a) and breadth (their popovers' Escape-to-close:
// a shared overlay-close entry in shortcutRegistry is their design call).
// Measured 2026-09-28 after TERM-063 moved CommandPalette.jsx, usePushToTalkHotkey.js
// and GlobalVideoLayer.jsx onto the registry. It may only SHRINK: migrate a file
// onto `registerShortcuts` and delete (or lower) its row in the same commit.
// `app/src/pages/OptionsFlow.jsx` is partner-owned; it has no raw key listener today.
// ─────────────────────────────────────────────────────────────────────────────
const BASELINE = {
  'app/src/components/FeedbackWidget.jsx': { literal: 1 },
  'app/src/components/IntradayDayPopover.jsx': { literal: 1 },
  'app/src/components/StockChart.jsx': { literal: 3 },
  'app/src/components/TickerPopup.jsx': { literal: 1 },
  'app/src/components/chart/BoardsToolButton.jsx': { literal: 1 },
  'app/src/components/chart/ChartContextMenu.jsx': { literal: 1 },
  'app/src/components/chart/ChartDrawingOverlay.jsx': { literal: 2 },
  'app/src/components/chart/ChartSettingsModal.jsx': { literal: 1 },
  'app/src/components/chart/ChartThemesModal.jsx': { literal: 1 },
  'app/src/components/chart/EarningsMarkerPopover.jsx': { literal: 1 },
  'app/src/components/chart/KeyboardHelpOverlay.jsx': { literal: 1 },
  'app/src/components/chart/PatternSidePanel.jsx': { literal: 1 },
  'app/src/components/chart/SymbolSearch.jsx': { literal: 1 },
  'app/src/components/chart/builder/editor/CodeEditor.jsx': { literal: 1 },
  'app/src/components/chart/engine/serverCompute.js': { literal: 2 },
  'app/src/components/chart/keyboardShortcuts.js': { literal: 1 },
  'app/src/components/chart/neighborFrames.js': { orphan: 1 },
  'app/src/components/chart/pane/ChartTypeMenu.jsx': { literal: 1 },
  'app/src/components/chart/pane/HeaderStatMenu.jsx': { literal: 1 },
  'app/src/components/chart/pane/SymbolActionsMenu.jsx': { literal: 1 },
  'app/src/components/intro/IntroAnimation.jsx': { literal: 1 },
  'app/src/components/mobile/ContextPopover.jsx': { literal: 1 },
  'app/src/components/mobile/Sheet.jsx': { literal: 1 },
  'app/src/components/mobile/useFocusTrap.js': { literal: 1 },
  'app/src/components/research-kit/InfoTip.jsx': { literal: 1 },
  'app/src/components/research/EarningsResearchModal.jsx': { literal: 1 },
  'app/src/components/voice/AgentPicker.jsx': { literal: 1 },
  'app/src/components/voice/AudioPlayerBar.jsx': { literal: 1 },
  'app/src/components/voice/VisionAttachButton.jsx': { literal: 1 },
  'app/src/lib/todayPackClient.js': { orphan: 1 },
  'app/src/pages/Admin.jsx': { literal: 2 },
  'app/src/pages/Calendar.jsx': { literal: 1 },
  'app/src/pages/DarkPool.jsx': { literal: 1 },
  'app/src/pages/Landing.jsx': { literal: 1 },
  'app/src/pages/LiveFlowMassive.jsx': { literal: 1 },
  'app/src/pages/ModelBook.jsx': { literal: 1 },
  'app/src/pages/OptionsFlow_admin.jsx': { literal: 1 },
  'app/src/pages/Settings.jsx': { literal: 1 },
  'app/src/pages/ThemeTrackerPage.jsx': { literal: 2 },
  'app/src/pages/Watchlists.jsx': { literal: 2 },
  'app/src/pages/breadth/BreadthDateNav.jsx': { literal: 1 },
  'app/src/pages/breadth/BreadthSnapshotPopover.jsx': { literal: 1 },
  'app/src/pages/breadth/BreadthViews.jsx': { literal: 1 },
  'app/src/pages/breadth/BreadthViewsCustomizePanel.jsx': { literal: 1 },
  'app/src/pages/breadth/PresetRow.jsx': { literal: 1 },
  'app/src/pages/breadth/drill/BreadthDrillModal.jsx': { literal: 2 },
  'app/src/pages/breadth/drill/BreadthReadingModal.jsx': { literal: 1 },
  'app/src/pages/breadth/drill/scan/ScanFilters.jsx': { literal: 1 },
  'app/src/pages/breadth/drill/scan/ScanGrid.jsx': { literal: 1 },
  'app/src/pages/calendar/CalendarHeader.jsx': { literal: 1 },
  'app/src/pages/calendar/DayDetailDrawer.jsx': { literal: 1 },
  'app/src/pages/charts/ChartsWorkspace.jsx': { literal: 1 },
  'app/src/pages/charts/CompareSymbolsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/LayoutDock.jsx': { literal: 1 },
  'app/src/pages/charts/WidgetHeader.jsx': { literal: 3 },
  'app/src/pages/charts/WorkspaceShotButton.jsx': { literal: 1 },
  'app/src/pages/charts/grid/MultiChartGrid.jsx': { literal: 2 },
  'app/src/pages/charts/placement/GhostPreview.jsx': { literal: 1 },
  'app/src/pages/charts/popout/PopoutWindow.jsx': { literal: 2 },
  'app/src/pages/charts/widgets/BreadthSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/BreadthWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/CalendarTimeline.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/ChartDateNav.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/ChartWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/FundamentalsSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/LeverageInverseControl.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/LibraryRail.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NewsSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NhnlSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NhnlUniverseMenu.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NotebookWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/ScatterWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/TimeframeMenu.jsx': { literal: 1 },
  'app/src/pages/community/components/ProfileCard.jsx': { literal: 1 },
  'app/src/pages/desk/ArticleReader.jsx': { literal: 1 },
  'app/src/pages/desk/VideosSection.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/AddPositionModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/AddTradeModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/ClosePositionModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/ColumnsPicker.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/ConfirmModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/DeleteAllModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/EditPositionModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/GenerateReportModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/ImportCsvModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/ShortcutCheatSheet.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/TradeDrawer.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/accounts/AccountSelector.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/accounts/DeleteAccountModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/accounts/NewAccountModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/calendar/MiniMonthNav.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/notebook/CaptureHost.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/notebook/TableToolbar.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/notebook/UnsentTrashDialog.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/notebook/WidgetPalette.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/notebook/onboarding/NotebookTour.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/options/AddOptionStrategyModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/options/CloseOptionStrategyModal.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/scope/ScopeBar.jsx': { literal: 2 },
  'app/src/pages/journal-2-0/components/trade/TradeDetailPage.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/components/trade/TradeScreenshots.jsx': { literal: 1 },
  'app/src/pages/journal-2-0/lib/blockHandle.js': { literal: 1 },
  'app/src/pages/journal-2-0/lib/calloutNode.js': { literal: 1 },
  'app/src/pages/journal-2-0/lib/codeBlockNode.js': { literal: 1 },
  'app/src/pages/journal-2-0/lib/mathNodes.js': { literal: 1 },
  'app/src/pages/journal-2-0/tabs/NotebookTab.jsx': { literal: 2 },
  'app/src/pages/modelbook/SetupsView.jsx': { literal: 2 },
  'app/src/pages/screener/shell/ColumnDesc.jsx': { literal: 1 },
  'app/src/pages/screener/shell/FilterRail.jsx': { literal: 1 },
  'app/src/pages/screener/shell/ScreenerReviewOverlay.jsx': { literal: 1 },
  'app/src/pages/study/challenges/BlitzChallenge.jsx': { literal: 1 },
  'app/src/pages/study/challenges/BossChallenge.jsx': { literal: 1 },
  'app/src/pages/study/challenges/DailyChartGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/EarningsDeskGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/GreeksLabGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/HardChallenge.jsx': { literal: 1 },
  'app/src/pages/study/challenges/HistoryDetectiveGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/OptionsPayoffGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/OrderTicketGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/SectorRaceGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/SizeItGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/SpotMistakeGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/SurviveGame.jsx': { literal: 2 },
  'app/src/pages/study/challenges/TradeStoryGame.jsx': { literal: 2 },
  'app/src/pages/study/challenges/TrueFalseGame.jsx': { literal: 1 },
  'app/src/pages/study/challenges/WatchlistGame.jsx': { literal: 2 },
  'app/src/pages/study/challenges/WordMatchGame.jsx': { literal: 1 },
  'app/src/pages/study/ui/StartLooks.jsx': { literal: 1 },
  'app/src/pages/study/ui/StudyButton.jsx': { literal: 1 },
  'app/src/pages/theme-tracker/ThemeTrackerSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/watchlist/ColumnPicker.jsx': { literal: 1 },
  'app/src/pages/watchlist/WatchlistSettingsPanel.jsx': { literal: 1 },
}

// ⛔ THE STATED CEILING. Sum of every bucket in BASELINE. Only ever edited DOWN.
const CEILING = 151

// This is the test that runs the whole-tree AST walk first (census() is lazy and shared), so the
// walk's cost lands here: about 5 s alone, and it went past the default 15 s inside a 70-file run.
// Its own ceiling, set for a loaded box; the walk and every assertion are unchanged.
const CENSUS_WALK_TIMEOUT_MS = 120_000

describe('TERM-063 — the census can see (controls)', () => {
  const q = "'"
  const KD = 'key' + 'down'

  it('CONTROL: a comment or prose mention is not a listener; a real call is', () => {
    const inComment = `// window.${ADD}(${q}${KD}${q}, onKey)\n/* document.${ADD}(${q}${KD}${q}, f) */\n`
    const inProse = `const help = ${q}press ${KD} to go${q}\n`
    expect(censusOf(inComment)).toEqual({ literal: 0, onprop: 0, orphan: 0 })
    expect(censusOf(inProse)).toEqual({ literal: 0, onprop: 0, orphan: 0 })
    const real = `window.${ADD}(${q}${KD}${q}, onKey)\nwindow.${REMOVE}(${q}${KD}${q}, onKey)\n`
    expect(censusOf(real)).toEqual({ literal: 1, onprop: 0, orphan: 0 })
    const tpl = `document.${ADD}(\`${KD}\`, onKey, true)\n`
    expect(censusOf(tpl)).toEqual({ literal: 1, onprop: 0, orphan: 0 })
  })

  it('CONTROL: a dynamic registration and a wrapper hook are caught as orphans', () => {
    const dyn = `for (const ev of [${q}pointerdown${q}, ${q}${KD}${q}]) window.${ADD}(ev, f)\n`
    expect(censusOf(dyn)).toEqual({ literal: 0, onprop: 0, orphan: 1 })
    const hook = `useEventListener(window, ${q}${KD}${q}, f)\n`
    expect(censusOf(hook)).toEqual({ literal: 0, onprop: 0, orphan: 1 })
    const prop = `el.on${KD} = (e) => {}\n`
    expect(censusOf(prop)).toEqual({ literal: 0, onprop: 1, orphan: 0 })
  })

  it('CONTROL: dispatching a key event is not listening for one', () => {
    const dispatch = `window.dispatchEvent(new KeyboardEvent(${q}${KD}${q}, { key: 'Escape' }))\n`
      + `w.dispatchEvent(new w.KeyboardEvent(${q}${KD}${q}, {}))\n`
    expect(censusOf(dispatch)).toEqual({ literal: 0, onprop: 0, orphan: 0 })
  })

  it('NON-VACUITY: it walks the whole tree, parses every file, and finds the registry', () => {
    const { failures, parsed } = census()
    expect(failures, 'a file the census cannot parse is a file it cannot see').toEqual([])
    expect(parsed).toBeGreaterThan(1000)
    expect(fs.existsSync(REGISTRY_FILE)).toBe(true)
    // The registry is the owner, so it is excluded — but it DOES register key
    // listeners; if this ever reads 0 the exclusion is hiding nothing and is stale.
    const own = censusOf(read(REGISTRY_FILE))
    expect(own.literal + own.orphan).toBeGreaterThan(0)
  }, CENSUS_WALK_TIMEOUT_MS)
})

describe('TERM-063 — the raw key-listener ratchet', () => {
  it('no file holds MORE raw key listeners than its baseline (new ones go through the registry)', () => {
    const { rows } = census()
    const over = []
    for (const [file, row] of rows) {
      const base = BASELINE[file] || {}
      for (const k of Object.keys(row)) {
        if (row[k] > (base[k] || 0)) over.push(`${file}: ${k} ${row[k]} > baseline ${base[k] || 0}`)
      }
    }
    expect(over, over.length
      ? 'RAW KEY LISTENER ADDED OUTSIDE THE REGISTRY. Declare the binding in '
        + 'app/src/pages/command/shortcutRegistry.js and bind it with registerShortcuts(). '
        + `Current census, for reference:\n${JSON.stringify(Object.fromEntries(rows), null, 1)}`
      : '').toEqual([])
  })

  it('no baseline row is STALE (a migrated listener must leave the baseline in the same commit)', () => {
    const { rows } = census()
    const stale = []
    for (const [file, base] of Object.entries(BASELINE)) {
      const row = rows.get(file) || {}
      for (const k of Object.keys(base)) {
        if ((row[k] || 0) < base[k]) stale.push(`${file}: ${k} ${row[k] || 0} < baseline ${base[k]}`)
      }
    }
    expect(stale, 'the ratchet only shrinks — lower these rows (and CEILING) now').toEqual([])
  })

  it('the baseline sits at or under the stated CEILING, and the CEILING is tight', () => {
    const sum = Object.values(BASELINE).reduce((s, r) =>
      s + (r.literal || 0) + (r.onprop || 0) + (r.orphan || 0), 0)
    expect(sum).toBeLessThanOrEqual(CEILING)
    expect(total(census().rows)).toBe(CEILING)
  })
})

describe('TERM-063 — the dev-only Study workbench is out of the product count', () => {
  it('the workbench folder is derived from lab.html and is not the member app', () => {
    expect(LAB_DIR, 'lab.html names no module script: the exclusion has nothing to derive from').toBeTruthy()
    expect(inLab(entryOf('index.html')), "the member app's own entry sits in the workbench folder").toBe(false)
    const { labFiles, labReached, reachedCount, parsed } = census()
    expect(labFiles, 'non-vacuity: the workbench holds files to leave out').toBeGreaterThan(10)
    expect(labReached.length, 'the walk must leave most of the workbench out, or the exclusion is idle')
      .toBeLessThan(labFiles)
    // the walk is not blind: it reaches most of the product, and the shared workbench pieces the Study pages import
    expect(reachedCount).toBeGreaterThan(parsed / 2)
    expect(labReached.length, 'the Study pages import lab/fx and lab/bits: the walk must see those edges')
      .toBeGreaterThan(0)
  }, CENSUS_WALK_TIMEOUT_MS)

  it('a workbench file the member app reaches is counted like any product file', () => {
    const { rows, labReached } = census()
    for (const f of labReached) {
      const abs = path.resolve(ROOT, f)
      const c = censusOf(read(abs))
      if (c.literal || c.onprop || c.orphan) expect(rows.has(f), `${f} is reachable and uncounted`).toBe(true)
    }
    for (const f of rows.keys()) {
      if (inLab(path.resolve(ROOT, f))) expect(labReached, `${f} is counted but unreachable`).toContain(f)
    }
  }, CENSUS_WALK_TIMEOUT_MS)

  it('CONTROL: the walk follows every import form and only the edges it is given', () => {
    const a = path.join(SRC, 'a.jsx')
    const b = path.join(LAB_DIR, 'b.jsx')
    const c = path.join(LAB_DIR, 'c.jsx')
    expect([...reachableFrom(a, new Map([[a, [b]], [b, []], [c, []]]))].sort()).toEqual([a, b].sort())
    expect(fileFor(path.join(LAB_DIR, 'b'), new Set([b]))).toBe(b)
    expect(fileFor(LAB_DIR, new Set([path.join(LAB_DIR, 'index.js')]))).toBe(path.join(LAB_DIR, 'index.js'))
  })

  it('CONTROL: an import into the workbench from outside it is seen, in each form', () => {
    const importer = path.join(SRC, 'pages', 'study', 'X.jsx')
    const lab = path.relative(path.dirname(importer), path.join(LAB_DIR, 'pieces', 'Y.jsx')).split(path.sep).join('/')
    const specs = importsOf(parse(`import a from '${lab}'\nexport * from '${lab}'\nconst b = () => import('${lab}')\n`
      + "import c from 'react'\n"))
    expect(specs).toEqual([lab, lab, lab, 'react'])
    expect(specs.map((s) => resolveSpec(importer, s)).map((t) => !!t && inLab(t))).toEqual([true, true, true, false])
    expect(inLab(resolveSpec(importer, '/src/lab/main.jsx'))).toBe(true)
  })
})
