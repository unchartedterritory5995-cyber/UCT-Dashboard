// app/src/hooks/pollingSites.rail.test.js
//
// ─── 🔴 THE RAIL FOR THE OPT-IN HELPER NOBODY OPTED INTO ────────────────────
//
// `useMobileSWR` shipped as an opt-in wrapper with **no rail**, and adoption
// stalled: measured by AST on 2026-08-09, **40 files import it (54 call sites)
// while 72 files hold 97 bare `useSWR(..., { refreshInterval })` sites** — one
// of those 72 being the wrapper itself. The bare form is still the majority, so
// the next engineer copies it, and the helper stays ignored. **The durable fix
// is a rail, not 72 edits.**
//
// ⛔ BUT THE RAIL IS NOT *"EVERYTHING MUST USE THE HELPER"*, AND THE REASON IS
// MEASURED. Three facts were verified against the artifacts before this file
// was written, and two of them contradict the story that motivated it:
//
//   1. 🔴 **THE HEADLINE CLAIM DOES NOT REPRODUCE.** The performance audit said
//      a bare `useSWR` poll costs *"8,640 requests/day/user from a hidden tab"*.
//      It does not. Read in `app/node_modules/swr/dist/index/index.mjs`
//      (swr 2.4.0), the polling effect's `execute()` is guarded by
//      `refreshWhenHidden || getConfig().isVisible()`, and `refreshWhenHidden`
//      carries no default — so a bare `useSWR` has ALWAYS skipped its ticks
//      while the tab is hidden. Asserting "no requests while hidden" here would
//      be `lesson_gate_that_cannot_fail`, so this file does not assert it.
//
//   2. ✅ **THE REAL WIN IS THE MOBILE HALVING** — `useMobileSWR` doubles the
//      interval on a touch client (6 → 3 requests per 60 s, measured on
//      FuturesStrip). That is a genuine saving and the reason to adopt.
//
//   3. ⚠️ **ADOPTION IS NOT FREE, AND NOBODY HAD PRICED IT.** `useMobileSWR`
//      passes `revalidateOnFocus: options.revalidateOnFocus ?? true`, which
//      OVERRIDES the app-global `revalidateOnFocus: false` that `App.jsx`'s
//      `SWR_CONFIG` set during the 2026-07-01 launch hardening *"to cut
//      redundant requests app-wide"*. It also mounts a `visibilitychange`
//      listener and a `useMarketOpen` 60 s `setInterval` per call site. So
//      migrating a desktop-heavy surface trades fewer mobile ticks for more
//      focus revalidations — a two-sided trade, not a pure reduction.
//
// ⇒ **SO THIS RAIL ENFORCES DELIBERATENESS, NOT MIGRATION.** It fails on a NEW
// bare polling site, and it fails on a listed one that has since been migrated
// (an allow-list that only ever grows is a list nobody reads again). What it
// refuses to do is red on all 71 pre-existing sites on day one — a rail people
// disable is worse than no rail — and it refuses to assert a premise (1) that
// measurement did not support.
//
// ⛔ AN AST, NEVER A GREP (`lesson_probe_names_must_be_derived_not_typed`): a
// grep for `refreshInterval` reports comments, prose and this very header. Only
// a parsed `Property` on the third argument of a call bound to `swr`'s default
// export is a polling site.
//
// ⛔ AND THE ALLOW-LIST IS NOT DATE-BOMBED. `lesson_a_half_faked_clock_
// manufactures_false_positives` measured 15 false time bombs per real one; the
// "temporary" is carried by the shrink-or-fail rail below and the dated census,
// never by asserting a clock has passed some day.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`pollingSites.rail: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')

/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true,
})

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      yield* sourceFiles(p)
    } else if (/\.jsx?$/.test(e.name) && !/\.(test|spec)\.jsx?$/.test(e.name)) {
      // ⚠️ TEST FILES ARE OUT OF SCOPE ON PURPOSE. A test's own poll is not a
      // member-facing request, and reddening this rail for a fixture would
      // teach people to delete it. Measured at the census: zero test files hold
      // a bare polling site today, so the exclusion costs nothing.
      yield p
    }
  }
}

/**
 * Every bare-`useSWR` POLLING site in one source, as `{line, interval}`.
 *
 * A site counts only when the callee binds to the DEFAULT export of `'swr'` and
 * the third argument is an object literal carrying a `refreshInterval` key.
 * That is deliberately narrow: `useSWR(key, fetcher)` is not a poll, and an
 * options object passed by variable cannot be read here without guessing.
 */
export function bareSwrPollSites(source) {
  const tree = parse(source)
  const bare = new Set()
  walk(tree, (n) => {
    if (n.type !== 'ImportDeclaration' || n.source.value !== 'swr') return
    for (const s of n.specifiers) {
      if (s.type === 'ImportDefaultSpecifier') bare.add(s.local.name)
    }
  })
  if (!bare.size) return []

  const out = []
  walk(tree, (n) => {
    if (n.type !== 'CallExpression') return
    if (n.callee.type !== 'Identifier' || !bare.has(n.callee.name)) return
    const opts = n.arguments[2]
    if (!opts || opts.type !== 'ObjectExpression') return
    for (const p of opts.properties) {
      const isInterval = p.type === 'Property' && !p.computed
        && ((p.key.type === 'Identifier' && p.key.name === 'refreshInterval')
          || (p.key.type === 'Literal' && p.key.value === 'refreshInterval'))
      if (!isInterval) continue
      out.push({
        line: source.slice(0, n.start).split('\n').length,
        interval: source.slice(p.value.start, p.value.end).replace(/\s+/g, ' '),
      })
    }
  })
  return out
}

/**
 * ⭐ THE WRAPPER EXEMPTS ITSELF BY DERIVATION, NOT BY A TYPED PATH.
 *
 * `useMobileSWR` is a bare-`useSWR` polling site — it is the one that owns the
 * interval doubling. Hard-coding its path here would be a second authority on
 * where it lives; instead every `import … from '…/useMobileSWR'` edge in the
 * tree is resolved and the resolved files are exempt. A move renames the
 * exemption for free, and TWO of them would fail the assertion below.
 */
function resolveWrapperModules(files) {
  const found = new Set()
  const tryResolve = (base) => {
    for (const cand of [base, `${base}.js`, `${base}.jsx`,
      path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
    }
    return null
  }
  for (const abs of files) {
    let tree
    try { tree = parse(read(abs)) } catch { continue }
    walk(tree, (n) => {
      if (n.type !== 'ImportDeclaration') return
      const spec = n.source.value
      if (typeof spec !== 'string' || !/useMobileSWR$/.test(spec)) return
      const base = spec.startsWith('.')
        ? path.resolve(path.dirname(abs), spec)
        : path.join(SRC, spec.replace(/^@\//, '').replace(/^\/src\//, ''))
      const hit = tryResolve(base)
      if (hit) found.add(path.resolve(hit))
    })
  }
  return found
}

// ─── THE CENSUS, AS IT STOOD ON 2026-08-09 ──────────────────────────────────
//
// ⭐ ONE DATE AND ONE REASON, NOT 71 COPIES OF THE SAME SENTENCE. Every entry
// below is here for the SAME fact — it predates the helper, and fact (3) in the
// header means migrating it is a trade somebody has to price rather than a
// free win. Seventy-one hand-written copies of that sentence would be a rubber
// stamp; what makes this list not one is that it is **self-cleaning in both
// directions**: a site that appears fails, and a site that leaves fails too.
//
// ⛔ DO NOT ADD A ROW TO MAKE A NEW POLL PASS. The point of the failure is the
// decision: `useMobileSWR` if the surface is one a phone renders (it halves the
// tick there), bare `useSWR` if you want the app-global `revalidateOnFocus:
// false` to keep applying — and then this row, with your reason on the line.
const CENSUS_DATE = '2026-08-09'
const BARE_POLL_SITES = {
  'app/src/components/AlertBell.jsx': 2,
  'app/src/components/NavBar.jsx': 3,
  'app/src/components/RsBadge.jsx': 1,
  'app/src/components/StockChart.jsx': 2,
  'app/src/components/admin/AiSearchInsightsPanel.jsx': 2,
  'app/src/components/admin/CatalystRulesPanel.jsx': 1,
  'app/src/components/admin/CommunityReportsPanel.jsx': 1,
  'app/src/components/admin/TwitterAccountsPanel.jsx': 2,
  // ⭐ THE ONE ROW THAT IS NOT HERE FOR THE 2026-08-09 REASON. Everything above
  // predates the helper; this site was ADDED after the census and is here
  // because the decision went the other way, measured:
  //   • it is a JOB-STATUS poll, not a steady-state background tick. The
  //     interval is `polling ? pollMs : 0` flipped off `data.status ===
  //     'running'`, and it stops itself the moment the receipt lands.
  //     `useMobileSWR` DOUBLING it would slow the "Running…" a member is
  //     actively waiting on — a cost on the touch client, not the saving the
  //     wrapper is taken for;
  //   • the wrapper would also mount a `useMarketOpen` 60s interval and a
  //     visibilitychange listener per panel, for a poll that lives seconds and
  //     has nothing to do with market hours;
  //   • the call site already sets `revalidateOnFocus: false` by hand, so the
  //     app-global half of the trade is the one worth keeping.
  // ⚠️ AND THE NUMERIC FORM IS LOAD-BEARING, NOT AN OVERSIGHT: SWR reads a
  // FUNCTION-form `refreshInterval` once in its mount effect, so a poll that
  // has to start from a cold key never starts. `EvidenceTab.test.jsx`'s "polls
  // while running" case measures the tick actually firing (>= 2 GETs), which is
  // what makes this a measured decision rather than a row that silences a red.
  'app/src/components/chart/builder/EvidenceTab.jsx': 1,
  'app/src/components/mobile/MoreSheet.jsx': 2,
  'app/src/components/research/sections/SetupSection.jsx': 1,
  'app/src/components/tiles/CompassTodayTile.jsx': 1,
  'app/src/components/tiles/FlowScoreboardTile.jsx': 1,
  'app/src/components/tiles/IntradayPulse.jsx': 1,
  'app/src/components/tiles/MorningWireIndexes.jsx': 1,
  'app/src/components/tiles/UCT20Backtest.jsx': 1,
  'app/src/hooks/useAnalystIntel.js': 1,
  'app/src/hooks/useCallRecap.js': 1,
  'app/src/hooks/useCatalysts.js': 1,
  'app/src/hooks/useEarningsAudio.js': 1,
  'app/src/hooks/useEarningsTable.js': 1,
  'app/src/hooks/useExpectedMove.js': 1,
  'app/src/hooks/useFilings.js': 1,
  'app/src/hooks/useFundamentals.js': 1,
  'app/src/hooks/useIndicatorAlerts.js': 1,
  'app/src/hooks/useLiveBreadth.js': 1,
  'app/src/hooks/useOwnership.js': 1,
  'app/src/hooks/usePatternDetections.js': 1,
  'app/src/hooks/useSectorRead.js': 1,
  'app/src/hooks/useSeen.js': 1,
  'app/src/hooks/useSentiment.js': 1,
  'app/src/hooks/useTickerTags.js': 1,
  'app/src/hooks/useTranscript.js': 1,
  'app/src/hooks/useUserTickerSet.js': 1,
  'app/src/hooks/useWatchlistAlerts.js': 1,
  'app/src/hooks/useWatchlistMeta.js': 1,
  'app/src/hooks/useWatchlistPerformance.js': 1,
  'app/src/hooks/useWatchlistThemes.js': 1,
  'app/src/pages/Breadth.jsx': 2,
  'app/src/pages/FlowScoreboard.jsx': 1,
  'app/src/pages/ModelBook.jsx': 3,
  'app/src/pages/MorningWire.jsx': 1,
  'app/src/pages/Patterns.jsx': 1,
  'app/src/pages/UCT20.jsx': 4,
  'app/src/pages/Watchlists.jsx': 3,
  'app/src/pages/admin/PatternAdmin.jsx': 1,
  'app/src/pages/calendar/MyStocksHub.jsx': 1,
  'app/src/pages/calendar/useCalendarData.js': 5,
  'app/src/pages/charts/widgets/AlertsWidget.jsx': 1,
  'app/src/pages/charts/widgets/CalendarWidget.jsx': 3,
  'app/src/pages/community/ChatView.jsx': 1,
  'app/src/pages/community/components/CardRenderer.jsx': 1,
  'app/src/pages/community/components/MentionInbox.jsx': 1,
  'app/src/pages/community/hooks/useCommunity.js': 5,
  'app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx': 1,
  'app/src/pages/journal-2-0/components/BrokerReviewNudge.jsx': 1,
  'app/src/pages/journal-2-0/components/SyncFreshnessChip.jsx': 1,
  'app/src/pages/journal-2-0/components/accounts/GoalProgress.jsx': 1,
  'app/src/pages/journal-2-0/hooks/useBrokerWarming.js': 1,
  'app/src/pages/journal-2-0/hooks/useCompassOverview.js': 1,
  'app/src/pages/journal-2-0/hooks/useInterventions.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2CoachChat.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2CommunityPositions.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2CommunityTraders.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2CommunityTrades.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2DisciplineState.js': 1,
  'app/src/pages/journal-2-0/hooks/useJ2Nudges.js': 1,
  'app/src/pages/journal-2-0/hooks/useProfileSuggestions.js': 1,
  'app/src/pages/journal-2-0/hooks/useReviewedTradeIds.js': 1,
}

function census() {
  const files = [...sourceFiles(SRC)]
  const wrappers = resolveWrapperModules(files)
  const found = {}
  // ⛔ A FILE THIS RAIL CANNOT PARSE IS A HOLE IN ITS OWN CENSUS, NOT A CLEAN
  // FILE. Swallowing the error would count an unreadable source as "no polling
  // sites" — `bars_prewarm._warm_one`'s `except: pass`, in JavaScript. It is
  // reported by name instead. (Measured: it fires for real. A concurrent agent
  // saving a file mid-scan made this rail red once with a *stale entry*
  // message, which described the wrong problem entirely.)
  const unparseable = []
  for (const abs of files) {
    if (wrappers.has(path.resolve(abs))) continue
    let sites
    try {
      sites = bareSwrPollSites(read(abs))
    } catch (e) {
      unparseable.push(`${key(abs)}: ${e.message}`)
      continue
    }
    if (sites.length) found[key(abs)] = sites.length
  }
  return { found, wrappers, unparseable }
}

// Both census tests walk the entire source tree with an AST parse and land at
// 4.5-5.2s — straddling vitest's 5000ms default, so they flip red at random
// under a loaded pool. That is a SLOW test, not a starved one (maxWorkers is
// already throttled in vite.config.js for the starved kind), so the timeout is
// raised to match what the work actually costs rather than the rail being
// weakened. A rail that fails at random is one you learn to ignore.
describe('polling sites — the opt-in helper gets a rail', () => {
  it('the wrapper exempts itself by RESOLUTION, and there is exactly one of it', () => {
    const { wrappers } = census()
    expect(wrappers.size, 'no import of `useMobileSWR` resolved — the exemption '
      + 'below is inert and the wrapper would count as its own violation').toBe(1)
    expect(key([...wrappers][0])).toBe('app/src/hooks/useMobileSWR.js')
  }, 30_000)

  it('no NEW bare polling site, and no allow-listed one that has since moved', () => {
    const { found, unparseable } = census()

    expect(unparseable, 'this rail could not parse a source file, so its census '
      + 'has a hole in it — an unreadable file is not a clean one').toEqual([])

    const appeared = Object.entries(found)
      .filter(([f, n]) => (BARE_POLL_SITES[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} (listed ${BARE_POLL_SITES[f] ?? 0})`)
    expect(appeared, [
      `A bare \`useSWR(..., { refreshInterval })\` site appeared that the ${CENSUS_DATE}`,
      'census did not hold. That is a decision, not a lint nit:',
      '  • `useMobileSWR` HALVES the tick on a touch client — take it if a phone renders this;',
      '  • bare `useSWR` keeps the app-global `revalidateOnFocus: false` from App.jsx —',
      '    the wrapper overrides that to `true`, which is MORE requests on desktop focus,',
      '    plus a visibilitychange listener and a 60s useMarketOpen timer per call site.',
      'Pick one, then add the row below with your reason. Do NOT add a row to silence this.',
    ].join('\n')).toEqual([])

    const stale = Object.entries(BARE_POLL_SITES)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: listed ${n}, found ${found[f] ?? 0}`)
    expect(stale, 'An allow-listed bare polling site is gone or reduced — good, and '
      + 'the list must say so. An allow-list that only ever grows is a list nobody '
      + 'reads again. Lower the count or delete the row.').toEqual([])
  }, 30_000)

  it('the ADOPTION TRADE is pinned, so nobody re-pitches migration as a pure win', () => {
    // ⚠️ THIS PINS A TRADE, IT DOES NOT ASSERT A WIN. Two files disagree about
    // `revalidateOnFocus` and neither says so: `App.jsx` turned it OFF app-wide
    // on 2026-07-01 "to cut redundant requests", and `useMobileSWR` turns it
    // back ON for all 54 of its call sites. That is the cost side of adopting
    // the helper, and it is the reason this file's other rail enforces a
    // DECISION rather than a migration. If either side moves, this fails and
    // whoever moved it gets to restate the trade.
    const wrapper = parse(read(path.join(SRC, 'hooks', 'useMobileSWR.js')))
    let wrapperDefault = null
    walk(wrapper, (n) => {
      if (n.type !== 'Property' || n.computed) return
      if (!(n.key.type === 'Identifier' && n.key.name === 'revalidateOnFocus')) return
      if (n.value.type === 'LogicalExpression' && n.value.operator === '??'
        && n.value.right.type === 'Literal') wrapperDefault = n.value.right.value
    })
    expect(wrapperDefault,
      '`useMobileSWR` no longer defaults `revalidateOnFocus` with `??` — the '
      + 'override this rail exists to keep visible has moved').toBe(true)

    const app = parse(read(path.join(SRC, 'App.jsx')))
    let globalFocus = null
    walk(app, (n) => {
      if (n.type !== 'VariableDeclarator') return
      if (!(n.id.type === 'Identifier' && n.id.name === 'SWR_CONFIG')) return
      if (!n.init || n.init.type !== 'ObjectExpression') return
      for (const p of n.init.properties) {
        if (p.type === 'Property' && !p.computed && p.key.type === 'Identifier'
          && p.key.name === 'revalidateOnFocus' && p.value.type === 'Literal') {
          globalFocus = p.value.value
        }
      }
    })
    expect(globalFocus,
      "App.jsx's SWR_CONFIG no longer states `revalidateOnFocus` — the global "
      + 'half of this trade is gone and the wrapper is no longer overriding '
      + 'anything').toBe(false)
    expect(wrapperDefault).not.toBe(globalFocus)
  })

  it('CONTROL — the scanner SEES a planted poll and IGNORES what is not one', () => {
    // ⛔ A NEGATIVE FIXTURE MUST TRIP THE RAW SCAN. Phase C Task 1 measured the
    // failure this prevents: a fixture written in a shape the scanner
    // structurally could not match left the scan asserting nothing while
    // staying green.
    const planted = "import useSWR from 'swr'\n"
      + "export default () => useSWR('/api/x', f, { refreshInterval: 30_000 })\n"
    expect(bareSwrPollSites(planted)).toHaveLength(1)
    expect(bareSwrPollSites(planted)[0].interval).toBe('30_000')

    // renamed default import — still `swr`, still a poll
    const renamed = "import poll from 'swr'\n"
      + "export default () => poll('/api/x', f, { refreshInterval: 5 })\n"
    expect(bareSwrPollSites(renamed)).toHaveLength(1)

    // the helper's own call site is NOT a bare `useSWR` site
    const viaHelper = "import useMobileSWR from '../hooks/useMobileSWR'\n"
      + "export default () => useMobileSWR('/api/x', f, { refreshInterval: 30_000 })\n"
    expect(bareSwrPollSites(viaHelper)).toEqual([])

    // a non-polling `useSWR` is not a site
    const noPoll = "import useSWR from 'swr'\n"
      + "export default () => useSWR('/api/x', f, { revalidateOnMount: true })\n"
    expect(bareSwrPollSites(noPoll)).toEqual([])
    expect(bareSwrPollSites("import useSWR from 'swr'\nexport default () => useSWR('/api/x', f)\n"))
      .toEqual([])

    // prose mentioning the option is not a site — the whole reason this is an AST
    const prose = "// refreshInterval: 30_000 would poll here\n"
      + "const s = 'refreshInterval'\n"
    expect(bareSwrPollSites(prose)).toEqual([])
  })
})
