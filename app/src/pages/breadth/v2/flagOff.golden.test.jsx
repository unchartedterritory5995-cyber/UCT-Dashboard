// app/src/pages/breadth/v2/flagOff.golden.test.jsx
//
// V2-1 ACCEPTANCE: with `VITE_BREADTH_CHARTS_V2_ENABLED` unset, Data Charts renders
// EXACTLY what it rendered before V2 existed. Not "looks the same", not "the tests still
// pass" — the same DOM, byte for byte, against a golden recorded on this tree.
//
// ⛔ THE GOLDEN IS GENERATED ONCE, with WRITE_V2_GOLDEN=1. Regenerating it to turn a red
// run green deletes the only evidence that V2 was invisible — the same rule as
// `heatmapRegistry.golden.test.js`, and the same reason.
//
// ⚠️ Two things are normalised before comparison, and ONLY two, because a normaliser that
// erases too much is a golden that cannot fail: React's generated ids (`useId` and UIcon's per-render
// gradient counter, both position-dependent and neither a product fact) and ISO dates (the window is built on TODAY,
// so an un-normalised golden would rot at the next midnight and be regenerated out of
// existence within a day).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import BreadthCharts from '../../BreadthCharts'
import { todayET, shiftISO } from '../sessionDates'

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="echart" />,
}))

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'flagOff.golden.html')

const isoDaysAgo = n => shiftISO(todayET(), -n)
const ROWS = Array.from({ length: 30 }, (_, i) => ({
  date: isoDaysAgo(29 - i),
  breadth_score: 60 + i,
  pct_above_50sma: 45 + i,
  uct_exposure: 50 + i,
  sp500_close: 6800 + i * 10,
}))

/** Volatile-but-not-product bits out; everything else stays. */
function normalise(html) {
  return html
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
    .replace(/(\b(?:id|for|aria-controls|aria-labelledby|aria-describedby|name)=")[^"]*(")/g, '$1<ID>$2')
    .replace(/url\(#[^)]*\)/g, 'url(#<ID>)')   // UIcon's gradient id counts UP per render
    .replace(/«[^»]*»/g, '<ID>')
}

async function renderDataCharts() {
  const { container } = render(<BreadthCharts />)
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
  return normalise(container.innerHTML)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    if (String(url).includes('/api/breadth-monitor')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
    }
    if (String(url).includes('/api/auth/preferences')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('flag off, V2 is invisible', () => {
  it('renders the golden DOM exactly', async () => {
    const html = await renderDataCharts()
    if (process.env.WRITE_V2_GOLDEN === '1') fs.writeFileSync(GOLDEN, html + '\n')
    expect(html).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })

  it('renders the same DOM when the flag is explicitly OFF as when it is unset', async () => {
    // ⛔ `'0'` is a STRING and therefore truthy. A `if (import.meta.env.X)` gate would
    // read a deliberate off as an on, which is the polarity bug this pins.
    vi.stubEnv('VITE_BREADTH_CHARTS_V2_ENABLED', '0')
    expect(await renderDataCharts()).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })
})

describe('the golden could actually fail', () => {
  it('flag ON renders something DIFFERENT — so the comparison is not vacuous', async () => {
    vi.stubEnv('VITE_BREADTH_CHARTS_V2_ENABLED', '1')
    const { container } = render(<BreadthCharts />)
    await waitFor(() => expect(screen.getByTestId('breadth-charts-v2')).toBeInTheDocument())
    const html = normalise(container.innerHTML)
    expect(html).not.toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
    // …and V1 is genuinely gone, not merely accompanied.
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('would notice a one-character change to the V1 DOM', async () => {
    const html = await renderDataCharts()
    expect(html.replace('<div', '<div ')).not.toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })

  it('the golden holds real markup, so the normaliser has not erased the page', () => {
    const g = fs.readFileSync(GOLDEN, 'utf8')
    expect(g.length, 'a near-empty golden matches almost anything').toBeGreaterThan(2000)
    expect(g).toContain('data-testid="echart"')
    // The normaliser must not have flattened the whole document into placeholders.
    expect(g.split('<DATE>').length - 1).toBeLessThan(g.length / 50)
  })
})
