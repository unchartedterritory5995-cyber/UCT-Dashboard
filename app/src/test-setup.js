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
// fails; it just takes 5s to say so, and only FAILING waits ever pay that.
configure({ asyncUtilTimeout: 5000 })
import { beforeEach, vi } from 'vitest'
import { cache as swrCache, SWRGlobalState } from 'swr/_internal'

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
