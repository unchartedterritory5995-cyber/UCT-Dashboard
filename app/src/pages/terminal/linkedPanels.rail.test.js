// app/src/pages/terminal/linkedPanels.rail.test.js
//
// ─── LINKED PANELS (2026-10-09): EVERY LIST'S TICKER GOES THROUGH THE ONE PUBLISHER ──────────
//
//     cd app && npx vitest run src/pages/terminal/linkedPanels.rail.test.js --maxWorkers=2
//
// A ticker activated in a list row (click, keyboard, or its number typed + Enter) is published to
// the list's group by ONE path: `$SYM` -> the shell's `publishSymbol` (TerminalShell.jsx) ->
// `rowLinkPlan` (boardModel.js). A list reaches it through `PanelSymbol` / `PanelTicker`
// (`usePanelRun`) or, for the shell's command panels, `onRun('$SYM', { keepFunction: true })`.
//
// The POPULATION is derived from the source, never typed: every module under app/src that
// publishes NUMBERED `$SYM` rows (`usePanelSymbolRows`, or `usePanelRows` / `onRows` over a
// `$${…}` row). Such a list must also let a CLICK publish, through the same path, or a typed
// row number and a click would do two different things (INS, RSL and BRKO did until today:
// the number loaded the name, the click opened DES beside).
//
// The audit table at the bottom records, per code, what a row click did before this change and
// what it does now, and checks the file still carries the wire the "after" column names.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(process.cwd(), 'src')
const rel = (f) => relative(SRC, f).split(sep).join('/')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__fixtures__') continue
    const f = join(dir, name)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(f)
  }
  return out
}
const FILES = walk(SRC).map((f) => ({ path: rel(f), text: readFileSync(f, 'utf8') }))
const byPath = new Map(FILES.map((f) => [f.path, f.text]))

// The shell and the hook module define the wire; they are not lists.
const WIRE_MODULES = new Set(['components/terminal/terminalPanel.js', 'pages/terminal/TerminalShell.jsx'])

/** Does this module publish numbered rows that LOAD a name (`$SYM`)? */
function publishesLoadRows(text) {
  if (/usePanelSymbolRows\(/.test(text)) return true
  const rows = /usePanelRows\(|onRows\?\.\(/.test(text)
  return rows && /`\$\$\{/.test(text)
}

/** Does a CLICK in this module reach the one publisher? */
function clickPublishes(text) {
  return /<PanelSymbol\b|<PanelTicker\b|usePanelRun\(\)|keepFunction:\s*true/.test(text)
}

/** Ways a list row used to bypass the publisher: open DES / GP beside instead of loading. */
const BYPASSES = [
  { name: 'PanelCommand `${sym} DES` on a row ticker', re: /PanelCommand\s+[^>]*cmd=\{`\$\{[^}]*\.(?:sym|ticker|symbol)\} DES`\}/ },
  { name: 'open(`${sym} DES`) on a row ticker', re: /\bopen\(`\$\{sym\} DES`\)/ },
  { name: 'onRun(`${r.sym} GP`, { next: true }) on a row', re: /onRun\?\.\(`\$\{r\.sym\} GP`,\s*\{\s*next:\s*true\s*\}\)/ },
]

const POPULATION = FILES.filter((f) => !WIRE_MODULES.has(f.path) && publishesLoadRows(f.text))

describe('every list that publishes `$SYM` rows lets a click publish the same way', () => {
  it('the population is derived and non-vacuous (it finds lists we know are lists)', () => {
    const paths = POPULATION.map((f) => f.path)
    // eslint-disable-next-line no-console
    console.log(`[linked-panels rail] ${paths.length} list modules:\n  ${paths.join('\n  ')}`)
    for (const known of ['pages/terminal/panels/MoversPanel.jsx', 'components/tiles/CatalystTable.jsx', 'pages/UCT20.jsx',
      'pages/terminal/panels/RrgPanel.jsx', 'pages/terminal/panels/InsiderPanel.jsx']) {
      expect(paths).toContain(known)
    }
    // a command-row panel (rows are `NVDA CN`, not `$NVDA`) is not a load list
    expect(paths).not.toContain('pages/terminal/panels/MovePanel.jsx')
  })

  it.each(POPULATION.map((f) => [f.path, f.text]))('%s: a row click reaches the publisher', (path, text) => {
    expect(clickPublishes(text), `${path} publishes $SYM rows but no click reaches PanelSymbol / PanelTicker / onRun keepFunction`).toBe(true)
  })

  it('CONTROL: the predicates can fail', () => {
    expect(publishesLoadRows("usePanelRows(rows.map((r) => `${r.sym} GP`))")).toBe(false)
    expect(publishesLoadRows('usePanelSymbolRows(syms, "x")')).toBe(true)
    expect(clickPublishes('<PanelCommand cmd={`${r.sym} DES`} />')).toBe(false)
    expect(clickPublishes('<PanelSymbol sym={r.sym} />')).toBe(true)
    expect(BYPASSES[0].re.test('<PanelCommand cmd={`${x.sym} DES`} label="x">')).toBe(true)
    expect(BYPASSES[2].re.test('onRun?.(`${r.sym} GP`, { next: true })')).toBe(true)
  })
})

describe('no list row bypasses the publisher anywhere in app/src', () => {
  it.each(BYPASSES.map((b) => [b.name, b.re]))('%s: none left', (name, re) => {
    const hits = FILES.filter((f) => re.test(f.text)).map((f) => f.path)
    expect(hits, `${name} found in: ${hits.join(', ')}`).toEqual([])
  })
})

// ── The audit (2026-10-09). before: what a row-ticker click did. a = loads into the linked
// group · b = opens DES/GP beside · c = navigates away · d = re-points only itself ·
// e = nothing / a modal. after: always a, through `wire`, unless `kept` says why not. ──────────
const AUDIT = [
  { code: 'MOST', file: 'pages/terminal/panels/MoversPanel.jsx', before: 'a', wire: 'keepFunction: true' },
  { code: 'IMOV', file: 'pages/terminal/panels/ImovPanel.jsx', before: 'a', wire: 'keepFunction: true' },
  { code: 'ALRT', file: 'pages/terminal/panels/AlertsPanel.jsx', before: 'a (d when unlinked)', wire: 'keepFunction: true' },
  { code: 'MON', file: 'pages/terminal/panels/WatchlistPanel.jsx', before: 'a', wire: 'keepFunction: true' },
  { code: 'RRG', file: 'pages/terminal/panels/RrgPanel.jsx', before: 'b (SYM GP beside)', wire: 'keepFunction: true' },
  { code: 'REL', file: 'pages/terminal/panels/RelPanel.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'CORR', file: 'pages/terminal/panels/CorrPanel.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'PEER', file: 'pages/terminal/panels/PeerPanel.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'ETF', file: 'pages/terminal/panels/EtfPanel.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'BRKO', file: 'pages/terminal/panels/BreakoutPanel.jsx', before: 'b (DES beside)', wire: '<PanelSymbol' },
  { code: 'INS', file: 'pages/terminal/panels/InsiderPanel.jsx', before: 'b (DES beside)', wire: '<PanelSymbol' },
  { code: 'RSL', file: 'pages/terminal/panels/RsLeadersPanel.jsx', before: 'b (DES beside)', wire: '<PanelSymbol' },
  { code: 'NEWS', file: 'pages/terminal/panels/NewsPanel.jsx', before: 'b (DES beside)', wire: '<PanelSymbol' },
  { code: 'SCAT', file: 'pages/terminal/panels/ScatterPanel.jsx', before: 'b (DES beside)', wire: 'usePanelRun()' },
  { code: 'CHK', file: 'pages/terminal/panels/CheckPanel.jsx', before: 'b (analogs: DES beside)', wire: '<PanelSymbol' },
  { code: 'CN', file: 'pages/research/tabs/MyNewsList.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'FEED', file: 'pages/research/tabs/FilingsFeedTab.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'OSCR', file: 'pages/screener/options/OptionsScreener.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'STRS', file: 'pages/optionsAnalytics/StrategyScreensPanel.jsx', before: 'a (more-rows: e)', wire: '<PanelSymbol' },
  { code: 'TIDE', file: 'pages/optionsAnalytics/MarketTidePanel.jsx', before: 'e (plain text)', wire: '<PanelSymbol' },
  { code: 'WIRE', file: 'components/tiles/CatalystTable.jsx', before: 'a', wire: '<PanelTicker' },
  { code: 'U20', file: 'pages/UCT20.jsx', before: 'a', wire: '<PanelTicker' },
  { code: 'FREC', file: 'pages/FlowScoreboard.jsx', before: 'a', wire: '<PanelTicker' },
  { code: 'CATH', file: 'pages/CatalystsHistory.jsx', before: 'a', wire: '<PanelTicker' },
  { code: 'RISK', file: 'pages/PortfolioHeat.jsx', before: 'a', wire: '<PanelSymbol' },
  { code: 'SCR', file: 'pages/screener/shell/VirtualResults.jsx', before: 'e (chart modal)', wire: '<PanelTicker' },
  { code: 'SCR', file: 'pages/screener/shell/ResultCards.jsx', before: 'e (chart modal)', wire: '<PanelTicker' },
]

describe('the audit table: every audited list carries the publisher wire it names', () => {
  it.each(AUDIT.map((r) => [r.code, r.file, r.before, r.wire]))('%s (%s): before %s, after a via %s', (code, file, _before, wire) => {
    const text = byPath.get(file)
    expect(text, `${file} not found`).toBeTruthy()
    expect(text.includes(wire), `${code}: ${file} lost its ${wire} wire`).toBe(true)
    expect(clickPublishes(text)).toBe(true)
  })
})
