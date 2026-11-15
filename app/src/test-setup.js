import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// ⛔ Testing Library's `waitFor`/`findBy` ceiling is SEPARATE from vitest's
// `testTimeout` and is NOT raised by it. It defaults to 1000ms, and on this
// suite that was the single largest source of intermittent red.
//
// Measured 2026-08-30, hunting a flake that had survived two sessions and
// could never be identified — because THERE IS NO SINGLE FLAKY TEST. The
// suite's wall speed varies ~2x with cache state (191-226s warm, 377s right
// after `npm run build` invalidates the transform cache), and on a slow run
// whichever `waitFor` is unluckiest blows its 1000ms budget. Three
// consecutive reproductions killed three DIFFERENT, unrelated tests:
//   BuilderSheet.plots  (a vitest testTimeout kill, fixed in vite.config.js)
//   ImportWizard        ("Unable to find /1 note/i")
//   ArticlesSection     ("Unable to find …March 31, 2026")
// A population, not a defect — which is why re-running always looked green
// and why every attempt to pin "the" flaky test failed.
//
// ⚠️ NOT a licence for slow assertions. An element that never appears still
// fails; it just takes 4s to say so, and only FAILING waits ever pay that.
//
// 4000, not 5000, and the 1000ms of headroom is the whole point: at exactly
// vitest's 5000ms `testTimeout` the two deadlines RACE. Whichever fires first
// writes the failure message, so the same broken wait reports either
// "Unable to find an element with the text: …" (useful — it names what it
// wanted) or "Test timed out in 5000ms" (useless — no subject at all), and
// which one you get depends on scheduling. Landing below testTimeout makes
// the waitFor error deterministic, which is what you actually read at 2am.
// The ceiling still dwarfs the 250ms debounce that motivated it.
configure({ asyncUtilTimeout: 4000 })
import { beforeEach, vi } from 'vitest'
import { cache as swrCache, SWRGlobalState } from 'swr/_internal'
import { __permitRuntimePaneForTests } from './components/chart/engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from './components/chart/engine/runtimeKill'
// ⭐ W5-T2 — as in the app, where the registry imports it: the lower-timeframe gate is
// registered at the door (`lowerTfServing.js`), so a suite that stubs its flag still flips it.
import './components/chart/engine/lowerTfGate.js'
import { __setWarmRetryDelaysForTests } from './utils/warmRetry'
import { __setFirstLiveWidgetForTests } from './pages/journal-2-0/lib/notebookTelemetry'
import { __setTodayLandingForTests } from './pages/journal-2-0/lib/todayHome'
import { __setRsTelemetryOffForTests } from './lib/rsTelemetry'
import { __setBenchmarkTailFetcherForTests } from './components/chart/engine/liveTail'

// ── GT (2026-10-02): the runtime pane's per-member gate and starter allowlist ──
// Production is FAIL-CLOSED on both: nothing latched = not permitted, nothing
// graded. The suites that exercise the runtime LANE still turn it on the way they
// always have (`vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')`), so they run
// here as a PERMITTED member with EVERY script graded, and keep measuring the lane
// rather than these two doors. ⛔ The doors themselves are railed with both reset,
// in `components/chart/engine/__tests__/runtimeSwitchOn.test.js`.
beforeEach(() => {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

// ── 2026-10-06: the shared research fetchers re-ask a transient first failure once, after a
// pause (utils/warmRetry.js: a cold pod after a deploy is not a failed read). The suites
// written before that pin ONE attempt per read, so the retry is off here by default.
// ⛔ The retry itself is railed with it ON, through a real panel, in
// `components/research/sections/sectionFetch.warmRetry.test.jsx`.
beforeEach(() => { __setWarmRetryDelaysForTests([]) })

// ── Audit 2026-11-05 (S20): the once-per-browser "first live widget" beacon. The widget suites written before it
// pin "renders from params without a fetch"; the beacon is off here by default and railed ON in
// `pages/journal-2-0/lib/notebookTelemetry.test.js` and `components/notebook/EmptyNamesAsk.test.jsx`.
beforeEach(() => { __setFirstLiveWidgetForTests(false) })

// ── UCT RS split, U7 (2026-11-09): `VITE_RS_SPLIT_ENABLED` picks which `rsLine` definition `nativeRegistry.js`
// REGISTERS at module load (the slim UCT RS Line under '1', today's UCT Relative Strength otherwise). The suite's
// default is OFF, as the build's is: the 60-odd RS files pin today's shape, and a developer's shell env must not flip
// them. The slim definition is railed through its exported raw (`rsSplitSlim.test.js`, `rsSplitMigration.test.js`),
// and the registration under '1' through a stubbed env + `vi.resetModules()` (`rsSplitFlagOn.test.jsx`).
try { delete import.meta.env.VITE_RS_SPLIT_ENABLED } catch { /* a read-only env object: the default is already off */ }

// ── UCT RS split, F2 (2026-11-10): the benchmark tail store (`engine/liveTail.js`) asks for a benchmark's forming bar
// only through a request its HOST registers; the chart door (`engine/serverCompute.js`) registers the browser's on
// import, and it used to disarm itself under `import.meta.env.MODE === 'test'` — a build-flag read that the runtime
// lane's compute closure may not hold (`tools/pine_runtime_closure.mjs`). This is the test host's side of that seam:
// the request is taken away before every test, so a suite that counts `fetch` calls never meets a GET it did not
// arm. A suite that wants the tail arms a counting one with `__setBenchmarkTailFetcherForTests(fn)` itself
// (`liveTail.test.js`, `__tests__/liveTailLane.test.js`). ⚠️ This reaches the module instance imported HERE: a file
// that `vi.resetModules()` and re-imports the chart door gets a fresh, armed store for that test, as the browser does.
beforeEach(() => { __setBenchmarkTailFetcherForTests(null) })

// ── UCT RS (2026-11-07): the six RS counts are ON by default in a build since the server lists them. The chart
// suites written while they were dark mount RS copies under fetch mocks that count calls, so the counts are off here
// by default; the real gate (on by default, `VITE_RS_TELEMETRY_ENABLED=0` the kill switch) is railed in
// `lib/rsTelemetry.test.js`, and a test sink opens it wherever a suite reads the events.
beforeEach(() => { __setRsTelemetryOffForTests(true) })

// ── Audit 2026-11-05 (S15), Notebook simplify Task 5: the Notebook opens on the notes list whatever this switch says;
// it decides only where the 60-second first run's Done lands (the Daily brief when on, today's note when off). The
// suites written before the Daily brief expect today's note, so it is off here; the production value (on) is railed
// in `pages/journal-2-0/tabs/NotebookTab.landing.test.jsx`.
beforeEach(() => { __setTodayLandingForTests(false) })

// ── SWR cache isolation between tests ─────────────────────────────────────
// SWR keeps a module-global cache PLUS concurrent-request (dedupe) markers
// that outlive each test — `dedupingInterval` is wall-clock, so within one
// fast-running file every later mount of an already-fetched key silently
// reuses the previous test's resolved data instead of that test's own
// `global.fetch` mock. Purge both stores before each test so every test's
// fetch mock actually governs what its components see.
beforeEach(() => {
  const state = SWRGlobalState.get(swrCache)
  if (state) {
    // [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] — leave the revalidator
    // registrations alone (they belong to mounted hooks and unregister on
    // unmount); clear the request/mutation bookkeeping.
    const [, MUTATION, FETCH, PRELOAD] = state
    for (const store of [MUTATION, FETCH, PRELOAD]) {
      for (const k of Object.keys(store)) delete store[k]
    }
  }
  for (const k of Array.from(swrCache.keys())) swrCache.delete(k)
})

// ── Browser API shims missing from jsdom ──────────────────────────────────

// window.matchMedia — used by responsive-aware components (ThemeTracker,
// MoversSidebar, etc.) to decide breakpoints. jsdom doesn't ship this.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},        // legacy
      removeListener: () => {},     // legacy
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// EventSource — used by useRealtimePrices SSE hook. jsdom has no built-in.
if (typeof globalThis !== 'undefined' && typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = class EventSource {
    constructor() {
      this.readyState = 0
      this.onopen = null
      this.onmessage = null
      this.onerror = null
    }
    close() { this.readyState = 2 }
    addEventListener() {}
    removeEventListener() {}
  }
}

// IntersectionObserver — some lazy-load components depend on it.
if (typeof globalThis !== 'undefined' && typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

// ResizeObserver — Lightweight Charts and other layout-aware UI use it.
if (typeof globalThis !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ── HTMLCanvasElement.getContext('2d') ────────────────────────────────────
//
// 🔴 THE FLAKE THIS EXISTS TO KILL. jsdom ships NO canvas implementation, so
// `getContext('2d')` returns `null`. ECharts/zrender do not check: `initContext`
// does `this.ctx.dpr = …` and `doClear` does `ctx.clearRect(…)`, both on `null`.
//
// It is a FLAKE rather than a hard failure because those two calls come off a
// requestAnimationFrame loop (`ECharts._onframe` ← `Animation.Eventful.trigger`)
// and off `dispose()`. If the test finishes and tears down before the frame
// fires, nothing throws; if the box is loaded and the frame lands mid-test, the
// throw surfaces as an unhandled error and fails whatever test happened to be
// running. Measured on `Calendar.realModal.test.jsx`: 5/5 red on a busy box,
// then 2/6 red on an idle one, always the same two TypeErrors —
//   `Cannot set properties of null (setting 'dpr')`
//   `Cannot read properties of null (reading 'clearRect')`
// and always attributed to whichever test was in flight, which is what made it
// read as a Calendar bug for two days running. It is neither: it is a MISSING
// BROWSER API, exactly like the four shims above.
//
// ⛔ INSTALLED UNCONDITIONALLY, AND THAT IS A MEASURED DECISION RATHER THAN THE
// LAZY ONE. The four shims above use an `if (!window.matchMedia)` probe because
// those APIs might genuinely be present. The first draft of this one copied that
// idiom — `document.createElement('canvas').getContext('2d')` — and it cost
// **one `Not implemented: HTMLCanvasElement's getContext()` line per test file**,
// measured at exactly 514 for 514 files, because the probe IS the call jsdom
// complains about. Trading 514 lines of real, every-run noise for a
// `canvas`-package install nobody has done is the wrong side of that trade, so
// the precondition is written down instead of tested for:
//
//   ⚠️ IF THE OPTIONAL `canvas` npm PACKAGE IS EVER ADDED, DELETE THIS BLOCK.
//   It would shadow the real implementation with a stub that draws nothing.
//
// Per-file mocks still win regardless: the chart suites assign
// `HTMLCanvasElement.prototype.getContext` in their own `beforeAll`, which runs
// after this module. And after this shim, jsdom's stub is never reached at all —
// which is why the noise count above is a clean zero, not merely lower.
//
// ⚠️ WHY A PROXY AND NOT A LITERAL. A hand-listed stub is a list that goes
// stale: any 2D method it forgot throws "is not a function", which is the same
// class of failure one layer down. Unknown METHODS answer a no-op; assignments
// (`fillStyle`, `dpr`, `lineWidth` …) are stored and read back, because a
// renderer that writes a value and reads it again must not see a function.
// Only the members whose RETURN VALUE is actually consumed are spelled out.
if (typeof HTMLCanvasElement !== 'undefined') {
  {
    const makeCtx2d = (canvas) => {
      const noop = () => {}
      const store = {
        canvas,
        measureText: (t) => ({
          width: String(t ?? '').length * 6,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createConicGradient: () => ({ addColorStop: noop }),
        createPattern: () => null,
        getImageData: (x, y, w = 1, h = 1) => ({
          data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)),
          width: w | 0 || 1, height: h | 0 || 1,
        }),
        createImageData: (w = 1, h = 1) => ({
          data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)),
          width: w | 0 || 1, height: h | 0 || 1,
        }),
        getLineDash: () => [],
        isPointInPath: () => false,
        isPointInStroke: () => false,
        getContextAttributes: () => ({ alpha: true }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }
      return new Proxy(store, {
        get(target, prop) {
          if (prop in target) return target[prop]
          return noop            // an unknown 2D method — never a missing function
        },
        set(target, prop, value) { target[prop] = value; return true },
        has() { return true },
      })
    }

    HTMLCanvasElement.prototype.getContext = function getContext(type) {
      // 2D only. WebGL callers must still see `null` and take their fallback —
      // handing them a fake context would make them render into nothing while
      // believing they had a GPU.
      if (type != null && String(type).toLowerCase() !== '2d') return null
      if (!this.__uctCtx2d) this.__uctCtx2d = makeCtx2d(this)
      return this.__uctCtx2d     // cached per element: zrender compares identity
    }
  }
}

// ── Package mocks ──────────────────────────────────────────────────────────

// Picovoice Porcupine wake-word library — its bundled exports trip the Vite
// module resolver under vitest. Tests don't need a real wake-word engine;
// stub it so any component that imports it can render.
vi.mock('@picovoice/porcupine-web', () => ({
  PorcupineWorker: { create: vi.fn().mockResolvedValue({ start: vi.fn(), stop: vi.fn(), release: vi.fn() }) },
  BuiltInKeyword: { JARVIS: 'jarvis', BUMBLEBEE: 'bumblebee' },
}))
