// drawingsPeek is the small, read-only half of drawingsStore that the Notebook uses, so the store
// (a 10.9 KB shared chunk) stays off Notebook first open. It must give the store's own answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DRAWINGS_STORAGE_KEY, __resetLiveDrawingsPeek, peekDrawings } from './drawingsPeek'

const line = (id, price) => ({ id, type: 'hline', points: [{ time: 1700000000, price }] })

beforeEach(() => { localStorage.clear(); __resetLiveDrawingsPeek(); vi.resetModules() })
afterEach(() => { localStorage.clear(); __resetLiveDrawingsPeek() })

describe('peekDrawings without the store loaded', () => {
  it('reads saved drawings from storage, normalized, as a deep copy', () => {
    localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify({ NVDA: [line('a', 100)] }))
    const got = peekDrawings('NVDA')
    expect(got.map((d) => d.id)).toEqual(['a'])
    got[0].id = 'mutated'
    expect(peekDrawings('NVDA')[0].id).toBe('a') // a copy, never the stored object
  })

  it('answers [] for no symbol, nothing saved, or unreadable storage', () => {
    expect(peekDrawings('')).toEqual([])
    expect(peekDrawings('AAPL')).toEqual([])
    localStorage.setItem(DRAWINGS_STORAGE_KEY, '{not json')
    expect(peekDrawings('AAPL')).toEqual([])
  })

  it('gives exactly the store\'s answer for saved drawings', async () => {
    localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify({ NVDA: [line('a', 100), line('b', 101)] }))
    const fromPeek = peekDrawings('NVDA')
    const store = await import('./drawingsStore')
    expect(store.peekDrawings('NVDA')).toEqual(fromPeek)
  })
})

describe('once the store has loaded, its live state wins', () => {
  it('an in-memory edit that storage does not have yet is what the peek returns', async () => {
    const store = await import('./drawingsStore')
    const peek = await import('./drawingsPeek') // the same module instance the store registered on
    const id = store.addDrawing('TSLA', line('live', 200)) // the store assigns its own id
    localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify({ TSLA: [line('stale', 1)] })) // storage lags
    expect(peek.peekDrawings('TSLA').map((d) => d.id)).toEqual([id])
  })
})

describe('one storage key, and the Notebook never imports the whole store', () => {
  const SRC = path.resolve(globalThis.process.cwd(), 'src')
  it('drawingsStore takes its key from drawingsPeek, never a second copy', () => {
    const store = fs.readFileSync(path.join(SRC, 'components/chart/drawingsStore.js'), 'utf8')
    expect(store).toContain("from './drawingsPeek'")
    expect(store).toMatch(/const STORAGE_KEY = DRAWINGS_STORAGE_KEY/)
    const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') // comments may name it
    expect(code).not.toMatch(/['"]uct-chart-drawings['"]/)
  })

  it('no Notebook / Journal file imports drawingsStore (it would go back on first open)', () => {
    const offenders = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) {
          if (/from\s+['"][^'"]*components\/chart\/drawingsStore['"]/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(SRC, full))
        }
      }
    }
    walk(path.join(SRC, 'pages/journal-2-0'))
    expect(offenders).toEqual([])
  })
})
