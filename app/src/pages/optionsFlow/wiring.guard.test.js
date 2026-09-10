/**
 * WIRING GUARD — fails loudly if the Options Flow performance work gets undone.
 *
 * Why this exists: OptionsFlow.jsx is edited through the GitHub web UI, and twice
 * on 2026-07-25 a save from a long-open browser tab landed as a stale-buffer
 * commit that silently reverted this work ("Update OptionsFlow.jsx" — 31/60, then
 * 1606/56, the second one re-inlining the entire compute layer). Neither broke the
 * page, which is exactly the problem: the page just quietly went back to freezing
 * for ~2 seconds on every visit and nobody would have noticed.
 *
 * These assertions are deliberately structural rather than behavioural. They read
 * the source of OptionsFlow.jsx and check the wiring is present. If one fails, the
 * fix is not to edit this file — it is to re-apply the wiring:
 *
 *     python tools/reapply_optionsflow_perf.py --apply
 *
 * If the wiring was removed ON PURPOSE (the worker approach was abandoned), delete
 * this file in the same commit so the intent is explicit and reviewable.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(here, '..', 'OptionsFlow.jsx'), 'utf8')

// Strip comments so a mention in prose can never satisfy (or trip) a check.
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const FIX = '\n\n  ==> re-apply with:  python tools/reapply_optionsflow_perf.py --apply\n'

describe('Options Flow wiring guard', () => {
  it('still imports the compute layer instead of re-declaring it inline', () => {
    expect(CODE.includes('./optionsFlow/flowCompute'), 'flowCompute import is gone' + FIX).toBe(true)
    // The tell-tale of a stale-buffer save: the whole compute layer back inline.
    for (const decl of ['function processFlowData', 'function buildCharts', 'const THEMES_DEF']) {
      expect(new RegExp('^' + decl, 'm').test(CODE),
        `${decl} is declared in OptionsFlow.jsx again — the compute layer was re-inlined` + FIX).toBe(false)
    }
  })

  it('still routes parse + aggregate through the worker client', () => {
    expect(CODE.includes('./optionsFlow/flowWorkerClient'), 'flowWorkerClient import is gone' + FIX).toBe(true)
    for (const fn of ['loadFlow(', 'processFlow(', 'mergeToday(', 'getLoadedKey(', 'getLoadedMeta(']) {
      expect(CODE.includes(fn), `${fn} is no longer called — parse/aggregate is back on the main thread` + FIX).toBe(true)
    }
  })

  it('does not hold the 96k parsed rows in component state', () => {
    // Keeping them costs ~1,027ms of structured clone to get them out of the
    // worker, which is most of the win handed straight back.
    expect(/const \[parsedRows, setParsedRows\] = useState/.test(CODE),
      'parsedRows is back in component state' + FIX).toBe(false)
    expect(/const \[rowCount, setRowCount\] = useState/.test(CODE),
      'rowCount state is missing' + FIX).toBe(true)
  })

  it('still gates the version poll, so alt-tab cannot re-crunch the dataset', () => {
    expect(CODE.includes('shouldFetchVersion('),
      'the focus handler is ungated again — every alt-tab will re-aggregate' + FIX).toBe(true)
  })

  it('still versions the refresh URL, so Cloudflare cannot serve it stale', () => {
    expect(CODE.includes('baseFetchUrl('),
      'baseFetchUrl is gone — with CF caching on, refreshes get the stale edge copy' + FIX).toBe(true)
  })

  it('still fetches the look-ahead calendar weeks concurrently', () => {
    expect(CODE.includes('Promise.all(weeks)'),
      'the calendar weeks are serial again — erSoonSet will race the load and force a second aggregation' + FIX).toBe(true)
  })

  it('still caches the ER set for the session', () => {
    expect(CODE.includes('getErCache()') && CODE.includes('setErCache('),
      'the erSoonSet session cache is gone — every re-entry will aggregate twice' + FIX).toBe(true)
  })
})

/**
 * The CORRECTNESS fixes, which the guard above could not protect.
 *
 * The first three clobbers reverted STRUCTURE (an import vanished, a function got
 * re-inlined) and the assertions above caught that. The fourth reverted BEHAVIOUR
 * — small edits inside otherwise-intact code — and nothing caught it: the page
 * still imported everything, still used the worker, still passed all 74 tests, and
 * had silently gone back to mislabelling GEX expiries and blanking the Leaderboard.
 *
 * So these fixes were moved into flowViewPolicy.js (a module no clobber has ever
 * touched — every commit to the optionsFlow/*.js files is intentional) and
 * OptionsFlow.jsx now only CALLS them. A stale save that drops a call site also
 * drops the import, which is structural, which these assertions can see.
 *
 * If one of these fails, re-apply — do not "fix" it by inlining the logic back.
 */
describe('Options Flow correctness guard', () => {
  it('still imports the view-policy module', () => {
    expect(CODE.includes('./optionsFlow/flowViewPolicy'),
      'flowViewPolicy import is gone — the GEX/Leaderboard/base-mode fixes went with it' + FIX).toBe(true)
  })

  it('still pins the fetch URL across GEX / Dark Pool', () => {
    // Without this, entering GEX from Indexes changes csvFile to the STOCKS url
    // and fires a ~12.4MB download the user never sees — and evicts the index
    // dataset the worker was holding.
    expect(CODE.includes('flowBaseFor('),
      'flowBaseFor is gone — GEX/Dark Pool will refetch the stocks CSV invisibly' + FIX).toBe(true)
    expect(/const _base = dataMode === "index"/.test(CODE),
      'the old unpinned _base expression is back' + FIX).toBe(false)
  })

  it('still labels GEX from the payload rather than live UI state', () => {
    // Click 0DTE then Month and the slower 0DTE reply can land last. Labelling
    // from UI state then shows one expiry's gamma walls under another's name —
    // and those are levels people set stops against.
    expect(CODE.includes('gexPayloadDte('),
      'gexPayloadDte is gone — GEX can display one expiry labelled as another' + FIX).toBe(true)
    expect(CODE.includes('_gexReq'),
      'the GEX request-id guard is gone — a stale reply can overwrite a newer one' + FIX).toBe(true)
    expect(/gexDte==="0dte"\?"0DTE"/.test(CODE),
      'the old inline GEX label ternary (reads live UI state) is back' + FIX).toBe(false)
  })

  it('still guards the Leaderboard still-open overlay', () => {
    // computeStillOpen contributes 0 for any contract with no live quote, so a
    // blind overlay understates premium AND re-ranks on quote coverage; when
    // nothing is priced it renders "0 tickers" with no explanation.
    expect(CODE.includes('applyStillOpenOverlay('),
      'applyStillOpenOverlay is gone — the Leaderboard can blank itself or rank on quote coverage' + FIX).toBe(true)
    expect(CODE.includes('_lbOpenApplied'),
      'the _lbOpenApplied gate is gone — the zero-filter will empty the board' + FIX).toBe(true)
    expect(/if \(lbStillOpenOnly\) allTickers = allTickers\.filter/.test(CODE),
      'the still-open filter is ungated again — an unpriced board renders empty' + FIX).toBe(false)
  })

  it('still refetches when a range chip NARROWS the window', () => {
    // The old rule refetched only when widening, treating a wide payload as a
    // superset. It is not: 2+ day ranges are the top 50,000 BY PREMIUM, so
    // "All" then "1d" sliced ~500 rows out of that day's ~96,000 and labelled
    // it "1 trading day".
    expect(CODE.includes('shouldRefetchRange('),
      'shouldRefetchRange is gone — narrowing a range will render a premium-capped sample as a full day' + FIX).toBe(true)
    expect(/days > fetchDays && fetchDays !== 0/.test(CODE),
      'the old widen-only needsFetch rule is back' + FIX).toBe(false)
  })

  it('still discloses the premium cap on multi-day ranges', () => {
    // Production runs FLOW_CSV_CAP_DAYS=2: every range of 2+ days returns the top
    // 50,000 trades BY PREMIUM, not every print. Saying "90d" without saying that
    // implies a completeness the payload does not have.
    expect(CODE.includes('capNoticeFor('),
      'the cap disclosure is gone — multi-day ranges will silently imply completeness' + FIX).toBe(true)
  })

  it('NEVER replaces the whole section with a loading screen', () => {
    // ⛔ THIS RAIL USED TO PROTECT THE LOADING SCREEN ITSELF. It asserted that
    // `if (csvLoading && !D) return` kept a tab bar, because a bare spinner
    // stranded the user with no way to reach GEX/Dark Pool or step back to 1d.
    // The real fix was not a better spinner — it was not having one: both
    // full-page returns are gone, so the mode toggle, view tabs and ticker
    // search are mounted from the first commit and the section is usable while
    // its data is still in flight. Measured on prod, those two returns owned
    // ~490 ms of the visible wait.
    for (const gate of ['if (csvLoading && !D) return', 'if ((!D || !FD)']) {
      expect(CODE.includes(gate),
        `a full-page loading return is back (${gate}) — the member sees a spinner `
        + 'instead of the section' + FIX).toBe(false)
    }
  })

  // The content gate, located rather than retyped. It has changed shape twice
  // (`&& D && (<>` -> `(D || !tabNeedsD) && (<>`) and each time a literal here
  // went stale and took a real invariant offline with it, so find it by the
  // stable part — the JSX-fragment opener that starts the body — and let the
  // condition vary.
  const contentGateIndex = () => {
    const ret = CODE.indexOf('<div className="of-mroot"')
    const gate = CODE.indexOf('&& (D || !tabNeedsD) && (<>', ret)
    return { ret, gate }
  }

  it('renders the mode toggle without waiting for data', () => {
    // The toggle must sit OUTSIDE the content gate, or "no full-page return"
    // would just mean "a blank page" instead.
    const { ret, gate } = contentGateIndex()
    expect(ret !== -1 && gate > ret, 'could not locate the render').toBe(true)
    expect(CODE.slice(ret, gate).includes('Indexes / ETF'),
      'the mode toggle moved behind the data gate — the page is blank until D' + FIX).toBe(true)
  })

  it('the pending state offers the REAL view tabs, not a placeholder of them', () => {
    // One definition, two call sites. A copy would drift from the real tab bar.
    expect((CODE.match(/\{viewTabsBar\}/g) || []).length,
      'viewTabsBar is not rendered in both the pending and loaded states' + FIX)
      .toBeGreaterThanOrEqual(2)
    expect(CODE.includes('&& !D && !csvError && tabNeedsD && (<>'),
      'the pending state is gone — the data region has no placeholder' + FIX).toBe(true)
  })

  it('the market strip is NOT behind the data gate — it has its own fetch', () => {
    // `marketIndices` comes from fetchMarketData and references neither D nor
    // FD. It sat inside the content gate, so live index prices that had already
    // arrived were withheld until the flow parts landed. One definition, two
    // call sites (pending + loaded) — a second copy would drift.
    expect((CODE.match(/\{marketPulseStrip\}/g) || []).length,
      'marketPulseStrip is not rendered in both the pending and loaded states' + FIX)
      .toBeGreaterThanOrEqual(2)
    const strip = CODE.indexOf('const marketPulseStrip')
    const { gate } = contentGateIndex()
    expect(strip !== -1 && strip < gate,
      'the market strip moved back inside the data gate' + FIX).toBe(true)
  })

  it('tabs that never read the flow dataset do not wait for it', () => {
    // Measured over each tab's own render region: Confluence, Tracker and
    // Watchlist reference `D.` zero times and Watchlist's only FD uses are
    // optional-chained. Sealing them behind `D &&` showed a flow-data
    // placeholder for panels that never needed flow data.
    expect(CODE.includes('const TABS_WITHOUT_D'),
      'the D-independent tab list is gone — every tab waits on D again' + FIX).toBe(true)
    for (const t of ['Confluence', 'Tracker', 'Watchlist']) {
      expect(new RegExp(`TABS_WITHOUT_D = \\[[^\\]]*"${t}"`).test(CODE),
        `${t} no longer renders without D` + FIX).toBe(true)
    }
  })

  it('feature-tab data is demand-driven, not fetched on mount', () => {
    // Every consumer of these three lives on Top Flow / Tracker / Watchlist, so
    // on a default Market Read entry they were a request, a setState and a
    // render for something nobody could see. They now fetch when a consuming
    // tab first opens.
    expect(CODE.includes('const FEATURE_DATA_TABS'),
      'the demand-driven tab list is gone' + FIX).toBe(true)
    for (const t of ['Top Flow', 'Tracker', 'Watchlist']) {
      expect(new RegExp(`FEATURE_DATA_TABS = \\[[^\\]]*"${t}"`).test(CODE),
        `${t} dropped out of FEATURE_DATA_TABS — its panel will render empty` + FIX).toBe(true)
    }
    // The endpoints must not sit in a mount effect (`}, []);`) any more. Find
    // each fetch and read the dep array of the effect that encloses it.
    // ⛔ State the invariant DIRECTLY — "no mount effect fetches these" — rather
    // than "the effect enclosing the first occurrence has deps". Two earlier
    // shapes of this check were wrong for the same reason: they assumed the
    // first textual occurrence was the one that moved. `/api/watchlist/dates`
    // has a SECOND, legitimate call site (a post-save refresh) that is not in
    // an effect at all, and the bare path also appears in the comment above the
    // effect. Enumerate the mount effects and look inside them.
    const mountEffectBodies = []
    for (let i = 0; ; ) {
      const at = CODE.indexOf('useEffect(', i)
      if (at === -1) break
      let depth = 0
      let j = at + 'useEffect'.length
      for (; j < CODE.length; j++) {
        const c = CODE[j]
        if (c === '(') depth++
        else if (c === ')') { depth--; if (depth === 0) break }
      }
      const body = CODE.slice(at, j + 1)
      if (/\}\s*,\s*\[\s*\]\s*\)$/.test(body.trim())) mountEffectBodies.push(body)
      i = j + 1
    }
    // CONTROL: the scanner can see mount effects at all. Without this the loop
    // below passes trivially the day the bracket matcher breaks.
    expect(mountEffectBodies.length,
      'the mount-effect scanner found none — it is not reading this file').toBeGreaterThan(0)

    for (const url of ['/api/live/massive/thresholds', '/api/watchlist/dates', '/api/top-flow/history']) {
      expect(CODE.includes(`fetch("${url}")`), `${url} is gone entirely`).toBe(true)
      const onMount = mountEffectBodies.filter(b => b.includes(url))
      expect(onMount.length,
        `${url} is fetched from a mount effect again — it loads for a tab nobody opened` + FIX).toBe(0)
    }
  })

  it('market data is not held behind a timer — it is first paint now', () => {
    // The 800 ms deferral was right while the strip lived inside `D &&`. It is
    // rendered in the pending branch now, so the timer only delayed the first
    // real data on the page. A stale deferral fails nothing; it is just late.
    expect(/setTimeout\(\s*fetchMarketData/.test(CODE),
      'fetchMarketData is behind a timer again — the strip is first-paint content' + FIX).toBe(false)
  })

  it('the render timeline instrument survives', () => {
    // "renders before TOP 10" is a claim about a run. Without this the next
    // person to ask has to re-instrument the page.
    expect(CODE.includes('window.__flowRenderStats'),
      'the render counter is gone — render-cascade claims become unfalsifiable' + FIX).toBe(true)
  })

  it('3b: the server TOP 10 is gated on an EXACT generation match', () => {
    // The server classified with ITS replica; this browser has its own fetched
    // set. Two classifications can produce two different TOP 10 lists from one
    // tape, silently, in a table members trade on.
    expect(CODE.includes('topPicksUsable('),
      'the generation gate is gone — a served product would be trusted blind' + FIX).toBe(true)
    expect(CODE.includes('reviveTopPickVariant('),
      'served candidates are used raw — daysSince/freshLabel would carry SERVER build time' + FIX).toBe(true)
  })

  it('3b: a declined product still renders TOP 10 from the raw rows', () => {
    // The fallback is permanent, not a migration switch.
    expect(CODE.includes('TOP_PICK_RAW_PARTS'),
      'the raw-row fallback is gone — a generation mismatch would blank TOP 10' + FIX).toBe(true)
    expect(/servedTopPicks \|\| _local/.test(CODE),
      'the local computation is no longer the fallback' + FIX).toBe(true)
  })

  it('3b: the render gate no longer REQUIRES the raw array', () => {
    // `{D && D.all_directional && ...}` would blank the table the moment the
    // part stopped being fetched — the gate has to move with the dependency.
    expect(CODE.includes('{D && (D.all_directional || servedTopPicks) && (()=>{'),
      'the TOP 10 render gate still demands all_directional' + FIX).toBe(true)
  })

  it('3b: the flag defaults OFF and rollback is provable', () => {
    expect(CODE.includes('VITE_FLOW_SERVER_TOPPICKS === "1"'),
      'the 3b flag is gone or no longer opt-in' + FIX).toBe(true)
  })

  it('3b: a failed ETF fetch RESOLVES the generation instead of hanging', () => {
    // null means "still deciding" to the fallback effect. A permanently failed
    // ETF request would hang TOP 10 forever, where today it just falls back to
    // the hardcoded set and renders.
    expect(/catch\(\(\) => \{ if \(!cancelled\) setEtfGeneration\(""\); \}\)/.test(CODE),
      'a failed ETF fetch no longer resolves the generation' + FIX).toBe(true)
  })

  it('3b: nothing in the TOP 10 block reads `.contracts` off a pick', () => {
    // The served product drops that map (67% of the payload). If a renderer
    // ever starts reading it, the SERVED path would silently differ from the
    // LOCAL fallback path — same table, two populations, no error.
    const start = CODE.indexOf('TOP 10 FLOW PICKS')
    expect(start, 'could not locate the TOP 10 block').toBeGreaterThan(-1)
    const block = CODE.slice(start, start + 24000)
    // CONTROL: the slice really is the TOP 10 renderer.
    expect(block.includes('topCDisplayPrem'), 'the slice is not the TOP 10 block').toBe(true)
    const reads = block.match(/\b(?:p|c|m|pick)\.contracts\b/g) || []
    expect(reads,
      'the TOP 10 renderer now reads `.contracts`, which the served product does not carry' + FIX)
      .toEqual([])
  })

  it('FD does not rebuild charts the server already sent', () => {
    // processFlowData returns clean_confirmed AND buildCharts(clean_confirmed).
    // When FD's filters drop nothing, rebuilding recomputes a value already in
    // hand — on the main thread, over every confirmed trade. The length test is
    // what skips it; flowChartsReuse.test.js proves the equivalence it relies on.
    //
    // ⛔ STATED AS THE INVARIANT, NOT RETYPED. This asserted the literal
    // `if (cc.length === D.clean_confirmed.length) return D;` and went red the
    // day the return was wrapped for tracing — the guard broke while the
    // invariant it protects was completely intact. That is the exact failure
    // this file has already paid for once: a retyped literal takes a real
    // invariant offline the moment the code changes shape.
    const test = CODE.indexOf('cc.length === D.clean_confirmed.length')
    expect(test, 'the length short-circuit is gone — buildCharts now reruns on '
      + 'every entry, on the main thread, over every confirmed trade' + FIX)
      .toBeGreaterThan(-1)
    // It must SHORT-CIRCUIT: a return between the test and the rebuild.
    const rebuild = CODE.indexOf('buildCharts(', test)
    const ret = CODE.indexOf('return', test)
    expect(ret).toBeGreaterThan(-1)
    expect(ret, 'the length test no longer returns before buildCharts — it is '
      + 'computed and then discarded, which is the cost it exists to skip' + FIX)
      .toBeLessThan(rebuild === -1 ? Number.MAX_SAFE_INTEGER : rebuild)
  })

  it('CONTROL: the guard can still see this file', () => {
    expect(CODE.length).toBeGreaterThan(100000)
    expect(CODE.includes('TOP 10 FLOW PICKS')).toBe(true)
  })
})

describe('compute layer stays worker-safe', () => {
  const COMPUTE = fs.readFileSync(path.join(here, 'flowCompute.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('never reaches for a browser global', () => {
    // A worker has no window/document. Such a reference fails only at runtime,
    // inside the worker, where it is easy to miss.
    for (const bad of ['window.', 'document.', 'localStorage', 'sessionStorage', 'navigator.']) {
      expect(COMPUTE.includes(bad), `flowCompute.js uses ${bad} — it cannot run in the worker`).toBe(false)
    }
    expect(/\bfetch\s*\(/.test(COMPUTE), 'flowCompute.js fetches — it cannot run in the worker').toBe(false)
  })

  it('keeps THEME_LOOKUP self-contained', () => {
    // It is mutable module state. It was once declared here but POPULATED by a
    // loop in OptionsFlow.jsx — which meant the worker imported it empty and
    // silently lost every theme attribution.
    expect(COMPUTE.includes('const THEME_LOOKUP'), 'THEME_LOOKUP moved out of flowCompute').toBe(true)
    expect(COMPUTE.includes('Object.entries(THEMES_DEF)'),
      'THEME_LOOKUP is no longer populated inside flowCompute — the worker will see it EMPTY').toBe(true)
  })
})

describe('prehydration wiring — the server-computed first paint', () => {
  // A module can be perfect, fully tested, and called by nobody. That has
  // happened in this repo often enough to have its own lesson, so the wire
  // itself gets an assertion, not just the module behind it.
  it('still asks the server for the precomputed dataset', () => {
    expect(CODE.includes('./optionsFlow/flowPrehydrate'),
      'flowPrehydrate import is gone — the page is back to waiting on its own '
      + 'processFlowData (measured 1,617-3,433ms) before it shows anything' + FIX).toBe(true)
    expect(CODE.includes('fetchPrehydrate('),
      'fetchPrehydrate is imported but never called — prehydration is dead code' + FIX).toBe(true)
  })

  it('still guards it so it can only ever fill a view the client has not published', () => {
    // ⛔ THE LOAD-BEARING GUARD. The client's own aggregate is the authority
    // for the view it has published; prehydration may only fill one it has
    // NOT. The key is per-VIEW (feed + range + date selection) rather than a
    // once-ever flag, which is what lets a 1d -> 5d switch prehydrate too —
    // but it must appear on BOTH sides of the await, or a slow aggregate can
    // still resolve after the real result and overwrite it.
    const at = CODE.indexOf('fetchPrehydrate(')
    expect(at, 'fetchPrehydrate call not found' + FIX).toBeGreaterThan(-1)
    // ⛔ NAME THE TWO GUARDS, do not count symbols in a character window.
    // This counted >=2 occurrences of `_processedViewKey.current` within
    // [at-400, at+500]. That is a PROXY for "guarded on both sides", and it
    // broke the moment a comment was added above the call — the code was
    // correct and the rail went red, which is the failure that teaches people
    // to delete rails. Assert the two guards themselves instead: each is
    // pinned where it must be, and neither can drift into the other's slot.
    const before = CODE.slice(0, at)
    expect(/_preFired\s*=\s*!silent\s*&&\s*_processedViewKey\.current !== _preViewKey/.test(before),
      'the pre-await guard is gone — the page would ask the server for a view '
      + 'its own aggregate has already published' + FIX).toBe(true)
    const after = CODE.slice(at, at + 1600)
    expect(/_processedViewKey\.current === _preViewKey/.test(after),
      'the post-await guard is gone — a slow aggregate can now resolve AFTER '
      + 'the authoritative client result and overwrite it' + FIX).toBe(true)
    // ...and the client aggregate must actually STAMP the view it published,
    // or the guard above compares against something nothing ever sets.
    // ⛔ `=(?!=)` — an ASSIGNMENT, not a comparison. Written as `\s*=` this
    // matched the `===` in the guard three lines up, so the check was satisfied
    // by the very code it was meant to be independent of. Mutation testing
    // caught it: deleting the stamp left this green.
    expect(/_processedViewKey\.current\s*=(?!=)/.test(CODE),
      'nothing records which view the client aggregate published — the '
      + 'prehydration guard would then never fire' + FIX).toBe(true)
  })

  it('still runs the first aggregate ONCE, gated on something being painted', () => {
    // /api/calendar landed at 8,005ms on a measured load while the tape landed
    // at 31ms; erSoonArr is an effect dependency, so without this the first
    // aggregate runs twice over 107,346 rows to change one badge.
    expect(CODE.includes('firstPassWaitMs({'),
      'firstPassWaitMs is gone — the first aggregate runs twice again' + FIX).toBe(true)
    const at = CODE.indexOf('firstPassWaitMs({')
    const region = CODE.slice(at, at + 320)
    expect(/alreadyPainted:\s*_prehydrated\.current/.test(region),
      'the wait is no longer gated on something being painted — an EMPTY '
      + 'screen would now sit on a spinner waiting for a cosmetic badge' + FIX).toBe(true)
  })

  it('control: these checks read CODE, not prose', () => {
    // Non-vacuity. If comment-stripping ever stopped working, every assertion
    // above could be satisfied by a mention in a comment and this whole
    // describe would be theatre.
    expect(CODE.includes('PREHYDRATE: render the numbers')).toBe(false)
    expect(SRC.includes('PREHYDRATE: render the numbers')).toBe(true)
  })
})

describe('stale-copy skip — the ORDER is the optimisation', () => {
  it('decides before the parse, not after', () => {
    // ⛔ THIS ASSERTION IS ABOUT SEQUENCE, and sequence is the entire value.
    // Deciding staleness AFTER loadFlow is what the code did for months: the
    // mismatch was detected, handled correctly, and cost a full parse plus a
    // full processFlowData on rows that were immediately replaced. Moving the
    // check below the parse would leave every test green and quietly restore
    // ~6s of wasted CPU per stale load.
    const decide = CODE.indexOf('shouldSkipStaleParse({')
    const parse = CODE.indexOf('await loadFlow(')
    expect(decide, 'shouldSkipStaleParse is not called' + FIX).toBeGreaterThan(-1)
    expect(parse, 'loadFlow call not found' + FIX).toBeGreaterThan(-1)
    expect(decide,
      'the staleness check moved BELOW the parse — it still works, but it no '
      + 'longer saves anything, which is the only reason it exists' + FIX)
      .toBeLessThan(parse)
  })

  it('still bumps the nonce, or the skip drops the load on the floor', () => {
    // Skipping the parse without triggering the corrective refetch would leave
    // the page with no rows and nothing on the way.
    const at = CODE.indexOf('shouldSkipStaleParse({')
    const region = CODE.slice(at, at + 700)
    expect(/setBaseNonce\(/.test(region),
      'the stale skip does not trigger a refetch — the page would sit empty' + FIX).toBe(true)
  })
})

// ⛔ THE RAIL THIS SECTION EXISTS FOR. Removing `erSoonArr` from the Search
// fetch effect and re-applying `er` as a render overlay are ONE change: do the
// first without the second and every `er` flag in the Search deep dive silently
// goes false, with the whole suite still green (it was — 421/421 — which is why
// this file gained a section rather than a comment).
//
// The invariant is stated directly, and the effect is LOCATED rather than
// pinned to a line or a retyped literal: a previous guard in this file retyped
// a gate's source text, the gate changed shape, and a real invariant went
// offline while reading green.
describe('Search deep dive: the er overlay and the fetch lifecycle are one change', () => {
  /** The Search fetch effect's dependency array, found from its own fetch call. */
  function searchEffectDeps() {
    const at = CODE.indexOf('/api/flow/ticker/${')
    if (at < 0) return null
    const close = CODE.indexOf('}, [', at)
    if (close < 0) return null
    const end = CODE.indexOf(']', close)
    return CODE.slice(close + 4, end)
  }

  it('CONTROL: the probe can actually read a dependency array', () => {
    // Without this, every assertion below would pass on a probe that returns
    // null because the effect moved or the anchor stopped matching.
    const deps = searchEffectDeps()
    expect(deps, 'could not locate the Search fetch effect' + FIX).not.toBe(null)
    expect(deps).toContain('selectedTicker')
    expect(deps).toContain('dataMode')
  })

  it('CONTROL: a dep array elsewhere in the file DOES still carry erSoonArr', () => {
    // Proves the name is greppable in a dep array at all — so the assertion
    // below is about the Search effect specifically, not about `erSoonArr`
    // having quietly disappeared from the whole component.
    expect(/\}, \[[^\]]*erSoonArr[^\]]*\]/.test(CODE),
      'no dep array anywhere carries erSoonArr — this control is vacuous, and '
      + 'the assertion below proves nothing' + FIX).toBe(true)
  })

  it('the Search fetch does NOT depend on erSoonArr', () => {
    // erSoonArr lands from /api/calendar ~1s after a search. While it was a
    // dependency, that landing re-ran the effect: re-fetching and re-deriving
    // ~20 MB of tape to change one boolean field.
    expect(searchEffectDeps()).not.toContain('erSoonArr')
  })

  it('...because `er` is re-applied as a render overlay instead', () => {
    // The other half. Dropping the dep alone loses the member's earnings flags.
    expect(CODE.includes('applyErOverlay('),
      'the Search fetch stopped depending on erSoonArr and NOTHING re-applies '
      + 'the earnings set — every `er` flag in the deep dive is now false' + FIX)
      .toBe(true)
    expect(CODE.includes('const searchUncapped'),
      'the overlay memo is gone' + FIX).toBe(true)
  })

  it('both transports derive with NO earnings set, so they agree', () => {
    // A served product is computed with erSoon=null (that is what makes it
    // user-independent and cacheable). If the legacy fallback still baked the
    // set in, the two paths would disagree the moment the overlay applied.
    expect(/computeCsv\(text,\s*null\)/.test(CODE),
      'the legacy tape path bakes an earnings set into its derivation, so it '
      + 'disagrees with the served product once the overlay runs' + FIX).toBe(true)
  })

  it('a declined product falls back to the tape rather than rendering nothing', () => {
    const at = CODE.indexOf('fetchSearchProduct(')
    expect(at, 'the server Search product is not wired' + FIX).toBeGreaterThan(-1)
    const region = CODE.slice(at, at + 400)
    expect(/_legacyTape\(\)/.test(region),
      'nothing falls back when the product declines — a busy or cold server '
      + 'would leave Search empty' + FIX).toBe(true)
  })

  it('the flag is read the same build-time way as its three siblings', () => {
    expect(CODE.includes('VITE_FLOW_SERVER_SEARCH === "1"'),
      'the Search product flag is not a build-time env read' + FIX).toBe(true)
  })
})


// ⛔⛔ TICKER_DB / CONV ARE INTERACTION-ONLY AND ARRIVE AFTER FIRST PAINT.
// Sixteen call sites did `D.TICKER_DB.find(...)` / `FD.TICKER_DB.find(...)` and
// only TWO checked the array existed. Once the key stops arriving in the
// bootstrap, every unguarded one is a TypeError the member triggers by clicking
// — and NO first-paint test can catch it, because first paint never touches
// these keys. That is exactly why this rail is source-level: the defect lives on
// a path a render test does not walk.
describe('interaction-only keys: no unguarded member access', () => {
  /** Direct `.find(`/`.filter(`/`.map(` on the raw key, i.e. no presence check. */
  const UNGUARDED = /\b(?:D|FD)\.TICKER_DB\.(?:find|filter|map|forEach|some|reduce|sort)\(/g

  it('CONTROL: the probe can see the pattern it hunts', () => {
    // Prove the regex matches the shape it is meant to catch, so a green result
    // below cannot be "the probe matches nothing at all".
    expect('const tk = D.TICKER_DB.find(x=>x)'.match(UNGUARDED)).not.toBe(null)
    UNGUARDED.lastIndex = 0
  })

  it('every TICKER_DB consumer goes through the guarded accessor', () => {
    const hits = CODE.match(UNGUARDED) || []
    expect(hits,
      'an unguarded TICKER_DB member call is back. Once the key is deferred this '
      + 'throws the moment a member clicks a sector or ticker, and no first-paint '
      + 'test can see it. Use the `tickerDb` accessor.' + FIX).toEqual([])
  })

  it('the guarded accessor exists and falls back to a FROZEN shared empty', () => {
    expect(CODE.includes('const tickerDb ='),
      'the guarded accessor is gone' + FIX).toBe(true)
    expect(/EMPTY_ROWS\s*=\s*Object\.freeze\(\[\]\)/.test(CODE),
      'the fallback is not a frozen shared constant — a per-call [] can be '
      + 'mutated by one consumer and read as real, empty data by another' + FIX)
      .toBe(true)
  })

  it('the post-paint fetch is wired, version-keyed, and asks for both keys', () => {
    expect(CODE.includes('INTERACTION_PARTS'),
      'nothing fetches the interaction keys after paint' + FIX).toBe(true)
    // ⛔ Version-keyed, not a one-shot boolean: a one-shot ref would never
    // refetch after a version roll replaced D, stranding the page without its
    // interaction data for the life of the mount.
    expect(CODE.includes('_interactionAskedFor'),
      'the post-paint fetch is no longer keyed on the data version' + FIX).toBe(true)
  })
})


// ⛔⛔ THE GUARD THAT SILENTLY DISABLED THE WHOLE SLICE.
// The post-paint fetch is keyed on the data version so it does not re-ask for a
// version it already has. Initialised to `null`, that ref compared EQUAL to
// `dataVersionRef.current` (still null before /api/flow/version answers) on the
// very first run — so it returned before fetching, permanently, and nothing
// reset it. Verified on production: first paint dropped to bootstrap +
// TOP_PICKS exactly as designed and the deferred request NEVER fired. Every
// test was green; only loading the real page found it.
describe('the post-paint fetch cannot be disabled by its own guard', () => {
  it('the version ref is seeded with a sentinel, never null/undefined', () => {
    const m = /_interactionAskedFor\s*=\s*useRef\(([^)]*)\)/.exec(CODE)
    expect(m, 'the post-paint fetch lost its version ref' + FIX).not.toBe(null)
    const seed = m[1].trim()
    expect(['null', 'undefined', ''],
      'the version ref is seeded with a value a real version can EQUAL, so the '
      + '"already asked" guard returns before the first fetch and the deferred '
      + 'payload never loads' + FIX).not.toContain(seed)
  })

  it('CONTROL: the sentinel is a value no version can equal', () => {
    // A string seed would also pass the check above while still colliding with
    // a string version, so pin the construct rather than merely "not null".
    expect(/ASKED_NONE\s*=\s*Symbol\(/.test(CODE),
      'the sentinel is no longer a Symbol — a primitive seed can collide with a '
      + 'real version value' + FIX).toBe(true)
  })
})
