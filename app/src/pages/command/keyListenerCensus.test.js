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
  const ast = parse(src)
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
  let parsed = 0
  for (const f of productFiles(SRC)) {
    if (path.resolve(f) === path.resolve(REGISTRY_FILE)) continue
    let c
    try { c = censusOf(read(f)) } catch (e) { failures.push(`${rel(f)}: ${e.message}`); continue }
    parsed += 1
    if (c.literal || c.onprop || c.orphan) {
      const row = {}
      for (const k of ['literal', 'onprop', 'orphan']) if (c[k]) row[k] = c[k]
      out.set(rel(f), row)
    }
  }
  return { rows: out, failures, parsed }
}

const total = (rows) => [...rows.values()].reduce((s, r) =>
  s + (r.literal || 0) + (r.onprop || 0) + (r.orphan || 0), 0)

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE BASELINE — raw key listeners OUTSIDE the registry, per file.
// Measured 2026-09-28 after TERM-063 moved CommandPalette.jsx, usePushToTalkHotkey.js
// and GlobalVideoLayer.jsx onto the registry. It may only SHRINK: migrate a file
// onto `registerShortcuts` and delete (or lower) its row in the same commit.
// `app/src/pages/OptionsFlow.jsx` is partner-owned; it has no raw key listener today.
// ─────────────────────────────────────────────────────────────────────────────
const BASELINE = {
  'app/src/components/IntradayDayPopover.jsx': { literal: 1 },
  'app/src/components/StockChart.jsx': { literal: 2 },
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
  'app/src/components/chart/keyboardShortcuts.js': { literal: 1 },
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
  'app/src/pages/breadth/BreadthViews.jsx': { literal: 1 },
  'app/src/pages/breadth/BreadthViewsCustomizePanel.jsx': { literal: 1 },
  'app/src/pages/breadth/CustomizePanel.jsx': { literal: 1 },
  'app/src/pages/breadth/PresetRow.jsx': { literal: 1 },
  'app/src/pages/breadth/drill/BreadthDrillModal.jsx': { literal: 1 },
  'app/src/pages/calendar/CalendarHeader.jsx': { literal: 1 },
  'app/src/pages/calendar/DayDetailDrawer.jsx': { literal: 1 },
  'app/src/pages/charts/ChartsWorkspace.jsx': { literal: 1 },
  'app/src/pages/charts/CompareSymbolsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/LayoutDock.jsx': { literal: 1 },
  'app/src/pages/charts/WidgetHeader.jsx': { literal: 2 },
  'app/src/pages/charts/grid/MultiChartGrid.jsx': { literal: 2 },
  'app/src/pages/charts/placement/GhostPreview.jsx': { literal: 1 },
  'app/src/pages/charts/popout/PopoutWindow.jsx': { literal: 2 },
  'app/src/pages/charts/widgets/BreadthSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/BreadthWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/ChartDateNav.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/ChartWidget.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/FundamentalsSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/LeverageInverseControl.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NewsSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NhnlSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/charts/widgets/NhnlUniverseMenu.jsx': { literal: 1 },
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
  'app/src/pages/theme-tracker/ThemeTrackerSettingsPanel.jsx': { literal: 1 },
  'app/src/pages/watchlist/WatchlistSettingsPanel.jsx': { literal: 1 },
}

// ⛔ THE STATED CEILING. Sum of every bucket in BASELINE. Only ever edited DOWN.
const CEILING = 111

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
  })
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
