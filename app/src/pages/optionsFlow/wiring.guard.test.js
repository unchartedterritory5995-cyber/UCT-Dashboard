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

  it('still discloses the premium cap on multi-day ranges', () => {
    // Production runs FLOW_CSV_CAP_DAYS=2: every range of 2+ days returns the top
    // 50,000 trades BY PREMIUM, not every print. Saying "90d" without saying that
    // implies a completeness the payload does not have.
    expect(CODE.includes('capNoticeFor('),
      'the cap disclosure is gone — multi-day ranges will silently imply completeness' + FIX).toBe(true)
  })

  it('keeps the mode tabs mounted while flow data loads', () => {
    // A bare centered spinner strands the user for the whole load with no way to
    // reach GEX/Dark Pool (which do not need this data) or step back to 1d.
    // Scope STRICTLY to the loading return. A fixed-size window spills into the
    // csvError state right below, which has always had its own tab bar — so a
    // loose slice reads that one's tabs and passes against a file with a bare
    // spinner. (Verified: it did exactly that against clobber 611ad11a.)
    const start = CODE.indexOf('if (csvLoading && !D) return')
    const end = CODE.indexOf('if (csvError', start)
    expect(start !== -1 && end > start, 'could not locate the loading state').toBe(true)
    expect(CODE.slice(start, end).includes('Indexes / ETF'),
      'the loading state dropped its mode tabs — the page becomes a dead end while loading' + FIX).toBe(true)
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
