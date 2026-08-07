import '@testing-library/jest-dom'
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

// Canvas 2D context — jsdom has none, so `getContext('2d')` returns null and
// any real ECharts/zrender render dies on `clearRect of null`.
//
// The reason this is UNCONDITIONAL matters. Several chart-engine tests assign
// `HTMLCanvasElement.prototype.getContext` at MODULE scope and never restore
// it, so a file that runs later in the same vitest worker inherits a foreign
// context whose lifetime already ended. That is what made
// Calendar.realModal's enrichment test fail only in the full run and pass 3/3
// alone — a scheduling-dependent flake, not a timing one.
//
// setupFiles runs per test FILE, so assigning here hands every file a clean
// default and undoes any pollution the previous file left behind. Files that
// install their own fake still do so afterwards and still win inside their own
// file, so nothing they assert changes.
const _stubCtx2d = () => {
  const noop = () => {}
  return {
    canvas: null,
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop,
    arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    save: noop, restore: noop, scale: noop, rotate: noop, translate: noop,
    transform: noop, setTransform: noop, resetTransform: noop,
    drawImage: noop, putImageData: noop, setLineDash: noop, getLineDash: () => [],
    fillText: noop, strokeText: noop,
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    isPointInPath: () => false, isPointInStroke: () => false,
  }
}
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    return type === '2d' ? _stubCtx2d() : null
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
