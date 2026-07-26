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
