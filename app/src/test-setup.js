import '@testing-library/jest-dom'
import { vi } from 'vitest'

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

// ── Package mocks ──────────────────────────────────────────────────────────

// Picovoice Porcupine wake-word library — its bundled exports trip the Vite
// module resolver under vitest. Tests don't need a real wake-word engine;
// stub it so any component that imports it can render.
vi.mock('@picovoice/porcupine-web', () => ({
  PorcupineWorker: { create: vi.fn().mockResolvedValue({ start: vi.fn(), stop: vi.fn(), release: vi.fn() }) },
  BuiltInKeyword: { JARVIS: 'jarvis', BUMBLEBEE: 'bumblebee' },
}))
