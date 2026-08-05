import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import { addIndicator, CHART_BUS_EVENTS } from './chartBus'
import { allowedIndicatorNames, resolveIndicatorAdd } from './chartBusIndicators'
import { catalogRows } from '../components/chart/indicatorCatalog'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { isIndicatorEnabled } from '../components/chart/engine/instanceControls'
import { ENGINE_FLIPPED_DEF_IDS } from '../components/chart/engine/flipState'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import useChartIndicatorBus from '../hooks/useChartIndicatorBus'

// ─── 🐛 THE VOICE BUS WAS DEAD, AND IT WAS MEASURED ─────────────────────────
//
// `subscribeAll` had an `onIndicator` branch and NO CALL SITE ANYWHERE in
// `app/src`. The server (`voice_client_action_tools.add_chart_indicator`) answers
// `{"ok": true, "narration": "Adding atr."}` BEFORE the browser evaluates
// anything, so Compass told the user it had added the indicator, `addIndicator()`
// dispatched an event nobody heard, and the chart did not move. On top of that,
// the allow-list it validated against refused `atr` outright.
//
// ⛔ A TEST THAT ASSERTS "THE EVENT WAS EMITTED" PASSES ON THE BROKEN BUILD AND
// PROVES NOTHING. Every case below that matters asserts the CHART SETTINGS moved
// — through the same preference every mounted `StockChart` reads — and the last
// describe asserts a SHIPPED subscriber exists at all, which is the assertion
// that was false at `d2733adc`.

function Bridge() {
  useChartIndicatorBus()
  return null
}

/** Mount the listener and a probe on the same module-global SWR preferences
 *  cache, so what the probe reads is what a mounted chart would read. */
function mountBus(seed) {
  const posts = []
  global.fetch = vi.fn(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => (seed || {}) }
  })
  const view = renderHook(() => usePreferences(), {
    wrapper: ({ children }) => (<><Bridge />{children}</>),
  })
  return { ...view, posts }
}

const settingsOf = (view) => mergeChartSettings(parsePref(view.result.current.prefs.chart_settings, null))

beforeEach(() => { vi.restoreAllMocks() })
afterEach(cleanup)

describe('the add-indicator allow-list is derived, not written down', () => {
  it('is the catalog plus the MA aliases, and nothing invented', () => {
    const { indicators, aliases } = allowedIndicatorNames()
    expect(indicators).toEqual(catalogRows().map(r => r.id.toLowerCase()))
    expect(aliases).toEqual(['avwap', 'ma9', 'ma20', 'ma50', 'ma200', 'ema9', 'ema20', 'ema50'])
  })

  it('carries the eleven the hand-written Set refused — and the list is not trivially short', () => {
    const { indicators } = allowedIndicatorNames()
    // The shipped Set was {vwap, avwap, ma9, ma20, ma50, ma200, ema9, ema20,
    // ema50, rsi, macd, bb}: three real indicators out of fifteen.
    for (const id of ['atr', 'sar', 'ichimoku', 'donchian', 'adx', 'obv', 'mfi',
      'cci', 'williamsr', 'stoch', 'volumeprofile']) {
      expect(indicators, `${id} is still refused`).toContain(id)
    }
    expect(indicators.length).toBeGreaterThanOrEqual(15)
  })

  it('resolves every definition by id — and refuses a word that is not one', () => {
    for (const row of catalogRows()) {
      const { row: hit, reason } = resolveIndicatorAdd(row.id.toLowerCase())
      expect(reason, row.id).toBe('honoured')
      expect(hit.id, row.id).toBe(row.id)
    }
    // ⚠️ BY ID, NOT BY DISPLAY NAME. `addIndicator` normalises to a lower-cased,
    // space-stripped id: `row.name` for `bb` is "Bollinger Bands", which
    // normalises to `bollingerbands`. The SERVER's `_INDICATOR_ALIASES` map is
    // what turns a spoken phrase into an id.
    expect(resolveIndicatorAdd('bollingerbands').reason).toBe('unknown')
  })

  it('⚠️ williamsR and volumeProfile survive the lower-casing — the two a strict id match refuses', () => {
    expect(addIndicator('williamsR')).toBe('williamsr')
    expect(addIndicator('volumeProfile')).toBe('volumeprofile')
    expect(resolveIndicatorAdd('williamsr').row.id).toBe('williamsR')
    expect(resolveIndicatorAdd('volumeprofile').row.id).toBe('volumeProfile')
  })

  it('names the two refusal classes apart — an alias is not the same as a non-word', () => {
    // The eight are legitimate things to SAY; this surface cannot draw them.
    // Collapsing the two would make "add a 9 EMA" and "add asdf" the same event.
    expect(resolveIndicatorAdd('ma9').reason).toBe('alias')
    expect(resolveIndicatorAdd('avwap').reason).toBe('alias')
    expect(resolveIndicatorAdd('asdf').reason).toBe('unknown')
  })
})

describe('the emitter validates SHAPE; the listener validates VOCABULARY', () => {
  // ⛔ THIS SPLIT IS A BUNDLE CONSTRAINT, NOT A STYLE CHOICE. `chartBus.js` is in
  // the eager entry chunk; deriving the vocabulary there put the definition
  // registry in first paint for every free user (+12.98 kB gzip, measured). The
  // bus already worked this way: `openTicker` emits any non-empty symbol.
  it('emits a well-formed token even when no chart can draw it', () => {
    expect(addIndicator('nonsense')).toBe('nonsense')
    expect(addIndicator('bollinger bands')).toBe('bollingerbands')
  })

  it('and refuses something that is not a token at all', () => {
    expect(addIndicator('')).toBe(false)
    expect(addIndicator('   ')).toBe(false)
    expect(addIndicator(null)).toBe(false)
    expect(addIndicator('<script>')).toBe(false)
  })

  it('every catalog id IS a well-formed token — the two halves cannot disagree', () => {
    // If a future definition id contained a character the emitter rejects, the
    // listener could resolve it and the emitter would never let it through.
    for (const row of catalogRows()) {
      expect(addIndicator(row.id), row.id).toBe(row.id.toLowerCase())
    }
  })
})

describe('⭐ and a chart LISTENS — the half that had never existed', () => {
  it('a voice addIndicator turns the indicator ON in the settings every chart reads', async () => {
    const H = mountBus()
    await waitFor(() => expect(H.result.current.loading).toBe(false))
    expect(isIndicatorEnabled(settingsOf(H), 'atr', ENGINE_FLIPPED_DEF_IDS), 'precondition')
      .toBe(false)

    await act(async () => { addIndicator('ATR') })

    await waitFor(() => expect(H.posts).toHaveLength(1))
    const cs = settingsOf(H)
    // ⭐ B5 TASK 9: the mirror is DESTROYED by the allow-list on every read, so
    // the INSTANCE is the whole answer. Read through the ONE reader, which is
    // what every control door already uses.
    expect(isIndicatorEnabled(cs, 'atr', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    expect(cs.indicatorInstances.some(i => i && i.defId === 'atr' && !i.deleted)).toBe(true)
    // …and it was PERSISTED, not just parked in the cache. The persisted STRING
    // is re-read through the real merge, which is where the fold runs.
    expect(H.posts[0].key).toBe('chart_settings')
    const reread = mergeChartSettings(H.posts[0].value)
    expect(isIndicatorEnabled(reread, 'atr', ENGINE_FLIPPED_DEF_IDS),
      'the write did not survive a read-merge round trip').toBe(true)
  })

  it('a FLIPPED definition moves the instance AND the mirror, because it goes through the one writer', async () => {
    const H = mountBus()
    await waitFor(() => expect(H.result.current.loading).toBe(false))

    await act(async () => { addIndicator('rsi') })

    await waitFor(() => expect(H.posts).toHaveLength(1))
    const cs = settingsOf(H)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS), 'the instance').toBe(true)
    expect(cs.indicatorInstances.some(i => i && i.defId === 'rsi' && !i.deleted)).toBe(true)
    // ⭐ B5 TASK 9: the title said "AND the mirror" and the mirror is gone. The
    // writer still sets it in the returned object — harmless, and it is what a
    // grid cell's override lane still reads — but it does not survive a read, so
    // that is what is asserted: the INSTANCE is what a reload gets.
    expect(isIndicatorEnabled(mergeChartSettings(H.posts[0].value), 'rsi', ENGINE_FLIPPED_DEF_IDS),
      'the write did not survive a read-merge round trip').toBe(true)
  })

  it('williamsR reaches the chart by NAME — a case-sensitive lookup would refuse exactly this one', async () => {
    const H = mountBus()
    await waitFor(() => expect(H.result.current.loading).toBe(false))
    await act(async () => { addIndicator('williamsR') })
    await waitFor(() => expect(H.posts).toHaveLength(1))
    expect(isIndicatorEnabled(settingsOf(H), 'williamsR', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
  })

  it('volumeProfile reaches the chart too — it has no definition, so it takes the OTHER lane', async () => {
    // `setIndicatorEnabled` returns its input BY IDENTITY for an id the registry
    // does not know, so routing this through the engine writer would be a silent
    // no-op — the exact bug being fixed, one layer down.
    const H = mountBus()
    await waitFor(() => expect(H.result.current.loading).toBe(false))
    await act(async () => { addIndicator('volumeProfile') })
    await waitFor(() => expect(H.posts).toHaveLength(1))
    expect(settingsOf(H).indicators.volumeProfile.enabled).toBe(true)
  })

  it('an alias the chart cannot honour is REFUSED at the listener — nothing is written at all', async () => {
    const SEED = JSON.stringify({ indicators: { rsi: { enabled: true } } })
    const H = mountBus({ chart_settings: SEED })
    await waitFor(() => expect(H.result.current.loading).toBe(false))

    expect(addIndicator('avwap'), 'a valid thing to say').toBe('avwap')
    await act(async () => { addIndicator('ma9'); addIndicator('ema20') })

    // BY IDENTITY: the stored blob is the same string object it started as.
    expect(H.result.current.prefs.chart_settings).toBe(SEED)
    expect(H.posts, 'a refused alias must not cost a request').toEqual([])
  })

  it('unsubscribes on unmount — a listener per remount is a leak, and it would double every write', async () => {
    const H = mountBus()
    await waitFor(() => expect(H.result.current.loading).toBe(false))
    const removed = []
    const realRemove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'removeEventListener').mockImplementation((n, f, o) => {
      removed.push(n); return realRemove(n, f, o)
    })

    H.unmount()
    expect(removed).toContain(CHART_BUS_EVENTS.ADD_INDICATOR)

    // …and behaviourally: the torn-down listener does not still write.
    const before = H.posts.length
    await act(async () => { addIndicator('ATR') })
    expect(H.posts.length).toBe(before)
  })
})

// ─── THE RAIL THAT WAS RED AT d2733adc ──────────────────────────────────────

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`chartBus rail: could not find the repo root from ${process.cwd()}`)
})()

describe('the bus has a SHIPPED subscriber, AND something shipped mounts it', () => {
  /** ⚠️ COMMENTS OUT FIRST, AND IT IS LOAD-BEARING — MEASURED.
   *
   *  Both modules involved EXPLAIN in prose that `subscribeAll` had no call site,
   *  and `GlobalVoiceLayer.jsx` carries a six-line note directly above the mount.
   *  Without this, `// useChartIndicatorBus()` still matches and the rail reports
   *  a mounted listener for a commented-out one — the mutation that does exactly
   *  that SURVIVED the first run of this gauntlet. */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  /** Every non-test module under `app/src` whose LIVE CODE matches a shape. */
  const matching = (re) => {
    const out = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.jsx?$/.test(e.name)) continue
        if (e.name.includes('.test.') || p.includes(`${path.sep}__tests__${path.sep}`)) continue
        if (re.test(stripComments(fs.readFileSync(p, 'utf8')))) {
          out.push(path.relative(ROOT, p).split(path.sep).join('/'))
        }
      }
    }
    walk(path.join(ROOT, 'app', 'src'))
    return out.sort()
  }

  it('the probe reads CODE, not prose — proven both ways before anything below is believed', () => {
    const LIVE = 'function X() {\n  useChartIndicatorBus()\n}'
    const DEAD = 'function X() {\n  // useChartIndicatorBus()\n}'
    const BLOCK = '/* mounted via useChartIndicatorBus() somewhere else */'
    const RE = /useChartIndicatorBus\(\)/
    expect(RE.test(stripComments(LIVE)), 'the probe cannot see a real call').toBe(true)
    expect(RE.test(stripComments(DEAD)), 'a commented-out mount reads as mounted').toBe(false)
    expect(RE.test(stripComments(BLOCK)), 'a block comment reads as mounted').toBe(false)
    // …and a URL in a string must survive the stripper, or every file goes blank.
    expect(stripComments("const u = 'https://x.dev/a'")).toContain('https://x.dev/a')
  })

  /** Defining is not calling. Derived from the EXPORT, never a hardcoded path —
   *  the two bus modules were one module an hour ago, and a path list would have
   *  silently started reporting the definition as a subscriber.
   *
   *  ⚠️ TWO SEPARATE PREDICATES, and the difference is load-bearing:
   *  `useChartIndicatorBus.js` DEFINES the hook (so it is not a mounter) and
   *  CALLS `subscribeIndicatorAdds` (so it IS the subscriber). One shared
   *  predicate excluded it from both and reported the bus as dead. */
  const defines = (f, re) => re.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))

  const subscribers = () => matching(/subscribeIndicatorAdds\(\s*\(|subscribeAll\(\s*\{/)
    .filter(f => !defines(f, /export function (subscribeIndicatorAdds|subscribeAll)\b/))
  const mounters = () => matching(/useChartIndicatorBus\(\)/)
    .filter(f => !defines(f, /export default function useChartIndicatorBus\b/))

  it('⭐ something in the shipped tree actually SUBSCRIBES — at d2733adc nothing did', () => {
    // ONE OF THE TWO GATES THAT FAIL ON TODAY'S CODE. `subscribeAll` had zero
    // call sites in `app/src`, so `addIndicator()` emitted into the void while
    // `voice_client_action_tools.add_chart_indicator` had already answered
    // `{"ok": true, "narration": "Adding <x>."}`.
    expect(subscribers(),
      'nothing in the shipped tree subscribes to the chart bus. `addIndicator()` emits an event ' +
      'nobody hears, and the server has ALREADY told the user "Adding <x>." — so the assistant ' +
      'reports success and the chart does not move.',
    ).toEqual(['app/src/hooks/useChartIndicatorBus.js'])
  })

  // ⛔ THE RAIL THAT KEEPS THE BUNDLE FIX. Deriving the vocabulary inside
  // `chartBus.js` is the obvious, tidy-looking edit, it passes every behavioural
  // case in this file, and it silently moves the definition registry out of a
  // lazy chunk into the EAGER entry chunk: +12.98 kB gzip on first paint for
  // every free user, who can use neither voice nor charts. Measured A/B, two
  // builds from one tree, one variable. A `manualChunks` entry cannot undo it —
  // a static import from an eager module is eager by definition.
  it('⛔ chartBus.js imports NOTHING from the chart module graph — it is in the eager entry chunk', () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'app/src/utils/chartBus.js'), 'utf8'))
    const chartImports = [...src.matchAll(/^\s*import[^;\n]*from\s+['"]([^'"]+)['"]/gm)]
      .map(m => m[1])
      .filter(spec => /components\/chart|engine\//.test(spec))
    expect(chartImports,
      'chartBus.js reaches into the chart module graph. It is reachable from the EAGER entry chunk ' +
      '(useRealtimeSession <- CompassTodayTile/CompassAssistButton), so this drags nativeRegistry into ' +
      'first paint for every free user. Put it in chartBusIndicators.js, which only the lazy paid-only ' +
      'voice chunk imports.',
    ).toEqual([])
    // …and the probe can see such an import when there IS one.
    expect([...`import { catalogRows } from '../components/chart/indicatorCatalog'`
      .matchAll(/^\s*import[^;\n]*from\s+['"]([^'"]+)['"]/gm)]
      .map(m => m[1]).filter(s => /components\/chart|engine\//.test(s)),
    ).toEqual(['../components/chart/indicatorCatalog'])
  })

  it('⭐ …and something shipped MOUNTS it — a hook nobody calls is exactly as dead as the bus was', () => {
    // THE SECOND HALF, AND THE ONE A WELL-TESTED MODULE CANNOT FAKE. Every other
    // case in this file passes against a subscriber that is never mounted.
    //
    // EXACTLY ONE mount: sixteen grid cells each subscribing would be sixteen
    // writers racing on one preference for one spoken sentence. A second mount
    // has to be argued for HERE.
    expect(mounters(),
      'the chart-bus listener is defined and never mounted (or mounted twice). One mount, in the ' +
      'paid-only voice layer, which is exactly where the emitter can fire.',
    ).toEqual(['app/src/components/voice/GlobalVoiceLayer.jsx'])
  })
})
