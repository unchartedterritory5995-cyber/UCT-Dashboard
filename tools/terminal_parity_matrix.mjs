#!/usr/bin/env node
// MG-7 — THE COEXISTENCE PARITY MATRIX, DERIVED FROM CODE (coexistence.md §3, §5.8).
//
// "No TERMINAL-NEXT surface reaches a member until the §3 matrix names, for every
// CARRY-REQUIRED row, which of carried · replaced · deliberately retired it is."
//
// ⛔ THE ROWS ARE NOT TYPED. `deriveRows()` walks `pages/Calendar.jsx` (the page `/calendar`
// renders today) with acorn and emits one row per capability at the page's own boundary:
//   * every module it imports from its own feature (`./calendar/*`, the earnings modal, the
//     hub section) — a view, a drawer, a data hook;
//   * every persisted preference key it writes (a literal first argument to setPref);
//   * every URL parameter it, or the earnings-modal route hook it uses, reads.
// Then the ADJACENT rows — capabilities that are not inside the page but are bound to the
// `/calendar` PATH or sit beside it — are derived from App.jsx's route table and the files
// that own them, each row carrying the file check that decides it.
//
// ⭐ THE CARRY MECHANISM IS ONE FACT, CHECKED, NOT ASSERTED: the shell's CAL panel imports
// the SAME module App.jsx mounts at `/calendar` (`embedsSameModule`). Everything inside that
// module is therefore carried by construction, *provided* the path-bound pieces are carried
// too — which is what the `routed` and `redirect` facts check. A row is never CARRIED
// because this file says so; it is CARRIED because the fact named in its `by` column holds.
//
// Run as a script it renders the matrix to
// `docs/terminal-research/10-roadmap/coexistence-parity-matrix.md`:
//   node tools/terminal_parity_matrix.mjs           # write the doc
//   node tools/terminal_parity_matrix.mjs --check   # exit 1 if the doc is stale
// `app/src/pages/terminal/parityMatrix.test.js` imports THIS module (one derivation for the
// tool and the rail) and fails if the doc and the derivation disagree, or if any row is GAP
// without a named owner. ⛔ It lives in tools/, not app/src: it is dev tooling, and a module
// under app/src that no page imports is an orphan to reachable.test.js.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// acorn lives in app/node_modules, not at the repo root (the nav_manifest.mjs pattern).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const acorn = appRequire('acorn')
const jsx = appRequire('acorn-jsx')
const Parser = acorn.Parser.extend(jsx())
const parse = (src) => Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

function walk(n, visit) {
  if (!n || typeof n !== 'object') return
  visit(n)
  for (const k of Object.keys(n)) {
    const c = n[k]
    if (Array.isArray(c)) c.forEach((x) => walk(x, visit))
    else if (c && typeof c === 'object') walk(c, visit)
  }
}

/** Is `spec` one of the page's OWN feature modules (not a generic hook/util)? */
const OWN = (spec) => spec.startsWith('./calendar/') || spec.includes('/research/EarningsResearchModal')
  || spec.includes('/hub/sections/calendarSection')

/** GAP rows must be named here, with who closes them. A new uncovered row fails the rail. */
export const KNOWN_GAPS = {
  'adjacent:hub-calendar-mode': 'Joystick hub `calendar` mode is route-bound to `/calendar` (hub/registry.js). '
    + 'A cohort member is redirected to `/terminal/calendar`, so the hub does not resolve its calendar mode there. '
    + 'Needs a `/terminal` mode or route alias in `app/src/hub/**` — OUT OF THIS LANE (brief: STOP and report).',
}

/** The sources the derivation reads, relative to `app/src`. One list for the tool and the rail. */
export const SOURCE_FILES = {
  calendarSrc: 'pages/Calendar.jsx',
  appSrc: 'App.jsx',
  panelsSrc: 'pages/terminal/panels.jsx',
  modalRouteSrc: 'pages/calendar/useEarningsModalRoute.js',
  authGuardSrc: 'components/AuthGuard.jsx',
  doorsSrc: 'pages/dashboard/doors.js',
  routesSrc: 'pages/terminal/TerminalRoutes.jsx',
  gateSrc: 'pages/terminal/terminalGate.js',
}

export const DOC_PATH = 'docs/terminal-research/10-roadmap/coexistence-parity-matrix.md'

/** @param {Record<keyof SOURCE_FILES, string>} src */
export function deriveRows(src) {
  const rows = []
  const facts = deriveFacts(src)

  // ── the page's own modules ──
  const ast = parse(src.calendarSrc)
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const spec = node.source.value
    if (!OWN(spec)) continue
    const names = node.specifiers.map((s) => (s.type === 'ImportDefaultSpecifier' ? s.local.name : s.imported.name))
    // A capability is a COMPONENT (PascalCase) or a DATA/BEHAVIOUR HOOK (`useX`). Pure helpers,
    // constants and the stylesheet ride along inside those and are not member-visible rows.
    for (const name of names.filter((n) => (/^[A-Z][a-z]/.test(n)) || /^use[A-Z]/.test(n))) {
      const isHubSection = spec.includes('/hub/sections/')
      rows.push({
        id: `module:${name}`,
        group: 'Page module',
        capability: `${name} (${spec})`,
        verdict: facts.embedsSameModule ? 'CARRIED' : 'GAP',
        by: isHubSection
          ? 'embedsSameModule — the hub SECTION mounts with the page; the hub MODE is a separate adjacent row'
          : 'embedsSameModule',
      })
    }
  }

  // ── persisted preference keys the page writes ──
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee?.name === 'setPref' && n.arguments[0]?.type === 'Literal') {
      const key = n.arguments[0].value
      if (!rows.some((r) => r.id === `pref:${key}`)) {
        rows.push({ id: `pref:${key}`, group: 'Persisted key', capability: `\`${key}\` (setPref)`,
          verdict: facts.embedsSameModule ? 'CARRIED' : 'GAP', by: 'embedsSameModule — same key, same writer, no rename (MG-4: no shim needed)' })
      }
    }
  })

  // ── URL parameters ──
  const params = new Set()
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression'
      && n.callee.object?.name === 'searchParams' && n.callee.property?.name === 'get'
      && n.arguments[0]?.type === 'Literal') params.add(n.arguments[0].value)
  })
  walk(parse(src.modalRouteSrc), (n) => {
    if (n.type === 'VariableDeclarator' && /_PARAM$/.test(n.id?.name || '') && n.init?.type === 'Literal') {
      params.add(n.init.value)
    }
  })
  for (const p of [...params].sort()) {
    rows.push({ id: `param:${p}`, group: 'URL contract', capability: `\`?${p}=\``,
      verdict: facts.redirectKeepsSearch && facts.routed ? 'CARRIED' : 'GAP',
      by: 'redirectKeepsSearch + routed (ROUTED_PATHS has /terminal/calendar)' })
  }

  // ── adjacent: bound to the /calendar PATH, or beside the page ──
  const adj = (id, capability, kind, ok, by) => rows.push({ id: `adjacent:${id}`, group: 'Adjacent',
    capability, verdict: ok ? kind : 'GAP', by })
  adj('route-calendar', '`/calendar` still answers (bookmarks, nav entry, hub, voice)', 'CARRIED',
    facts.calendarRouteKept, '`<Route path="/calendar">` kept: the page, or a redirect into the shell — never 404')
  adj('free-tier-redirect', 'Free-tier `/calendar?earnings=SYM` -> `/research/SYM` (row E2)', 'CARRIED',
    facts.authGuardExact, 'AuthGuard matches `/calendar` exactly BEFORE the route element renders')
  adj('mystocks', '`/calendar/mystocks` hub (row D1, DEAD/retire-candidate)', 'UNAFFECTED',
    facts.mystocksRoute, 'its own route, untouched')
  adj('render-page', '`/r/calendar` screenshot contract (row D4)', 'UNAFFECTED',
    facts.renderRoute, 'headless route, not inside the shell')
  adj('dashboard-door', 'Zone D "On deck" door key `calendar` -> `/calendar` (row D6)', 'CARRIED',
    facts.dashboardDoor, '`/calendar` link still resolves (redirect for cohort members)')
  adj('hub-calendar-mode', 'Joystick hub `calendar` mode (row D9)', 'CARRIED', false,
    KNOWN_GAPS['adjacent:hub-calendar-mode'])

  return { rows, facts }
}

/** The facts every verdict above is computed from. Each is a check over source text. */
export function deriveFacts(src) {
  const calendarImport = (s) => {
    const m = s.match(/const Calendar = lazyPage\('\/calendar', \(\) => import\('([^']+)'\)\)/)
    return m ? m[1].replace(/^\.\/pages\//, '') : null
  }
  const panelImport = (s) => {
    const m = s.match(/Calendar: \(\) => import\('([^']+)'\)/)
    return m ? m[1].replace(/^\.\.\//, '') : null
  }
  const appCal = calendarImport(src.appSrc)
  const panelCal = panelImport(src.panelsSrc)
  return {
    // App.jsx mounts './pages/Calendar' at /calendar; panels.jsx imports '../Calendar' from
    // pages/terminal — both resolve to pages/Calendar(.jsx).
    embedsSameModule: !!appCal && appCal === panelCal,
    routed: /ROUTED_PATHS = \[[^\]]*'\/terminal\/calendar'/.test(src.modalRouteSrc)
      && /ROUTED_PATHS = \[[^\]]*'\/terminal'/.test(src.modalRouteSrc),
    redirectKeepsSearch: /calendarIntoShell\(search, hash\)/.test(src.routesSrc || '')
      && /`\$\{TERMINAL_CALENDAR_PATH\}\$\{search \|\| ''\}\$\{hash \|\| ''\}`/.test(src.gateSrc || ''),
    calendarRouteKept: /<Route path="\/calendar" element=\{<CalendarRoute><Calendar \/><\/CalendarRoute>\}/.test(src.appSrc),
    authGuardExact: /location\.pathname === '\/calendar' && !isPaid/.test(src.authGuardSrc),
    mystocksRoute: /<Route path="\/calendar\/mystocks"/.test(src.appSrc),
    renderRoute: /<Route path="\/r\/calendar"/.test(src.appSrc),
    dashboardDoor: /key: 'calendar',[^}]*to: '\/calendar'/.test(src.doorsSrc),
  }
}

export function renderMarkdown({ rows, facts }) {
  const count = (v) => rows.filter((r) => r.verdict === v).length
  const lines = [
    '# Coexistence parity matrix — `/calendar` (TERMINAL-CURRENT) carried into the UCT Terminal shell',
    '',
    '> ⛔ **GENERATED. Do not hand-edit.** `node tools/terminal_parity_matrix.mjs` writes it, and',
    '> DERIVES every row from `app/src/pages/Calendar.jsx`',
    '> (imports, `setPref` keys, URL params) and from the route table. `parityMatrix.test.js` fails when',
    '> this file and the derivation disagree, or when a row is GAP without a named owner (MG-7).',
    '',
    `**Rows: ${rows.length} · CARRIED ${count('CARRIED')} · UNAFFECTED ${count('UNAFFECTED')} · GAP ${count('GAP')}.**`,
    '',
    'Vocabulary (coexistence.md §3.1, inward): **CARRIED** = a member can do this inside the shell, so the',
    'old page is not needed for it. **UNAFFECTED** = not part of the `/calendar` page; the shell changes',
    'nothing about it. **GAP** = a member must leave the shell for it; each GAP names who closes it.',
    '',
    '## The facts every verdict is computed from',
    '',
    '| fact | holds |',
    '|---|---|',
    ...Object.entries(facts).map(([k, v]) => `| \`${k}\` | ${v ? 'yes' : '**NO**'} |`),
    '',
    '## The matrix',
    '',
    '| # | group | capability | verdict | by |',
    '|---|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.group} | ${r.capability} | **${r.verdict}** | ${r.by} |`),
    '',
    '## What this matrix is not',
    '',
    '* It is not coexistence.md §3.4. That is the programme\'s hand-curated ledger of the same surface;',
    '  this is its code-derived complement, at the page\'s import boundary. Rows inside an embedded module',
    '  (MacroBand inside WeekView, the modal\'s sections C2–C11) are carried transitively by the same import.',
    '* Server-side rows (enrichment warm cadence E5/E7, iCal D7, alerts D8, `/r/calendar-week.png` D5) do not',
    '  depend on which client route renders the page, so the shell neither carries nor breaks them.',
    '',
  ]
  return lines.join('\n')
}

/** Read every source the derivation needs, relative to `app/src`. */
export function loadSources(repo = REPO) {
  const src = path.join(repo, 'app', 'src')
  return Object.fromEntries(Object.entries(SOURCE_FILES)
    .map(([k, rel]) => [k, readFileSync(path.join(src, rel), 'utf8')]))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  const derived = deriveRows(loadSources())
  const md = renderMarkdown(derived)
  const out = path.join(REPO, DOC_PATH)
  if (process.argv.includes('--check')) {
    let cur = ''
    try { cur = readFileSync(out, 'utf8').split('\r\n').join('\n') } catch { /* missing */ }
    if (cur !== md) {
      console.error(`STALE: ${DOC_PATH} -- run node tools/terminal_parity_matrix.mjs`)
      process.exit(1)
    }
    console.log('parity matrix: up to date')
  } else {
    writeFileSync(out, md)
    const n = (v) => derived.rows.filter((r) => r.verdict === v).length
    console.log(`wrote ${DOC_PATH}: ${derived.rows.length} rows, CARRIED ${n('CARRIED')}, `
      + `UNAFFECTED ${n('UNAFFECTED')}, GAP ${n('GAP')}`)
  }
}
