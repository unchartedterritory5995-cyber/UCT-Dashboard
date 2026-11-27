// THE CHART LIBRARY AS MEMBERS RUN IT, FOR TESTS (2026-11-24).
//
// ⛔ `import ... from 'lightweight-charts'` in a test gets the library's DEVELOPMENT build, and the build-time edits
// (scripts/chartLibraryPatch.mjs, `patchChartLibrary()` in vite.config.js) are applied to the PRODUCTION build only.
// So a test that counts the library's work through the normal import counts a library no member runs: edit 6 alone
// (a `setData` that adds or empties no time point no longer rebuilds the time scale) turns "every call rebuilds" into
// "one call per switch rebuilds". These are the two builds that matter, read from the installed package:
//   shipped   the production build as published
//   patched   the same file through `patchLightweightCharts`, the function the build runs: what members run
// Each is the library's own text evaluated as a function of its one dependency (the file is one import, a body and one
// export), as chartLibraryPatch.behaviour.test.js does.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchLightweightCharts } from '../../scripts/chartLibraryPatch.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB_FILE = path.join(APP, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.production.mjs')

/** jsdom has no 2D context and no layout: a context that answers everything, and a fixed element size. */
export function stubCanvasForChartLibrary(width = 900, height = 500) {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width, height }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return width }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return height }, configurable: true })
}

/** `{ shipped, patched }`: the production build as published, and as the build patches it. */
export async function loadChartLibraryBuilds() {
  const source = readFileSync(LIB_FILE, 'utf8')
  const canvas = await import('fancy-canvas')
  const IMPORT = /import\{([^}]*)\}from"fancy-canvas";/
  const EXPORT = /export\{([^}]*)\};?\s*$/
  const load = (code) => {
    const imported = IMPORT.exec(code)
    const exported = EXPORT.exec(code)
    if (!imported || !exported || code.split(/\bimport\b/).length !== 2 || code.split(/\bexport\b/).length !== 2) {
      throw new Error('the library file is no longer one import, a body and one export; this helper cannot evaluate it')
    }
    const takes = imported[1].split(',').map((x) => x.trim().split(' as ')).map(([from, to]) => `${from}:${to || from}`).join(',')
    const gives = exported[1].split(',').map((x) => x.trim().split(' as ')).map(([local, name]) => `${name || local}:${local}`).join(',')
    const body = code.replace(IMPORT, () => `const{${takes}}=uctCanvas;`).replace(EXPORT, () => `return{${gives}}`)
    return new Function('uctCanvas', `"use strict";${body}`)(canvas)
  }
  return { shipped: load(source), patched: load(patchLightweightCharts(source)) }
}

/**
 * Counts what the library does with a sequence of data calls. `sorts`: time-scale rebuilds, measured (the data layer
 * sorts one `{timeWeight, time, pointData, originalTime}` per time point; those keys are object literals in both
 * builds, never renamed). `full`: calls after which the library's set of time points differs from before, the 5.2.0
 * rule for a FULL update (every series re-set in the model, the time scale's points and tick marks redone), computed
 * from the times each call handed over; on the patched build `sorts` must equal the `setData` part of it.
 */
export function libraryWorkCounter() {
  const realSort = Array.prototype.sort
  let sorts = 0
  const held = new Map()   // series key -> Set of time keys it holds
  const refs = new Map()   // time key -> how many series hold it
  const pad = (n) => String(n).padStart(2, '0')
  const timeKey = (t) => (typeof t === 'object' && t !== null ? `${t.year}-${pad(t.month)}-${pad(t.day)}` : String(t))
  /** Remove series `key`'s times; the times no series holds any more. */
  const drop = (key) => {
    const gone = new Set()
    for (const t of held.get(key) || []) {
      const n = refs.get(t) - 1
      if (n === 0) { refs.delete(t); gone.add(t) } else refs.set(t, n)
    }
    held.delete(key)
    return gone
  }
  /** Give series `key` these times; the times no series held before. */
  const take = (key, times) => {
    const fresh = new Set()
    const set = new Set()
    for (const t of times) {
      const k = timeKey(t)
      if (set.has(k)) continue
      set.add(k)
      const n = refs.get(k) || 0
      if (n === 0) fresh.add(k)
      refs.set(k, n + 1)
    }
    held.set(key, set)
    return fresh
  }
  return {
    /** Run `fn` counting the library's rebuild sorts. */
    counted(fn) {
      Array.prototype.sort = function countedSort(...a) {
        const x = this[0]
        if (x && typeof x === 'object' && 'pointData' in x && 'timeWeight' in x) sorts += 1
        return realSort.apply(this, a)
      }
      try { return fn() } finally { Array.prototype.sort = realSort }
    },
    get sorts() { return sorts },
    /** A setData of `times` on series `key`: true when the set of time points changed (a FULL update). */
    setData(key, times) {
      const gone = drop(key)
      const fresh = take(key, times)
      // a time this series alone held and holds again is in both: no change
      return gone.size !== fresh.size || [...fresh].some((t) => !gone.has(t))
    },
    /** An update of one row at `time` on series `key`: true when it adds a time point no series held. */
    update(key, time) {
      const k = timeKey(time)
      const set = held.get(key) || new Set()
      if (set.has(k)) return false
      set.add(k)
      held.set(key, set)
      const n = refs.get(k) || 0
      refs.set(k, n + 1)
      return n === 0
    },
    remove(key) { return drop(key).size > 0 },
  }
}
