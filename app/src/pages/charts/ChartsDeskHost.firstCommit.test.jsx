// ⭐ THE CHARTS WORKSPACE IN THE SHELL'S FIRST COMMIT (chart speed, 2026-11-26).
//
// Measured on production (ecc0bb94, /charts AGL 1D, 20 cold reloads): the chart's own bars request left
// ~1,100 ms after navigation although StockChart's chunk was in at ~690. The gap was React's Suspense REVEAL
// THROTTLE: `lazy()` around an `async` factory hands React a PENDING promise on the first render even when the
// module is already loaded (App.jsx prefetches it at boot), so the boundary commits its fallback, and React
// 19.2 holds the retry's commit until 300 ms after that fallback (react-dom `globalMostRecentFallbackTime + 300`).
// Nothing ran meanwhile: no long task, no request, just a timer. Every request the chart makes waited on it.
//
// What this pins: once the module has loaded, ChartsDeskHost renders the workspace in the SAME commit as the
// shell, and its fallback is never committed. Before the module has loaded, the lazy path is unchanged.
import { render, screen, cleanup } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('./ChartsWorkspace', () => ({
  default: function StubWorkspace() { return <div data-testid="workspace" /> },
}))

afterEach(() => { cleanup(); vi.resetModules() })

const fallbackMounts = { n: 0 }
function Fallback() {
  useEffect(() => { fallbackMounts.n += 1 }, [])
  return <div data-testid="fallback" />
}

async function host() {
  const [{ default: ChartsDeskHost }, importer] = await Promise.all([
    import('./ChartsDeskHost'), import('./chartsWorkspaceImporter')])
  return { ChartsDeskHost, importer }
}

describe('ChartsDeskHost, the workspace module already loaded (the boot prefetch landed)', () => {
  it('renders the workspace in the first commit and never commits the fallback', async () => {
    const { ChartsDeskHost, importer } = await host()
    await importer.importChartsWorkspace()          // App.jsx's boot prefetch, landed
    fallbackMounts.n = 0
    render(<MemoryRouter initialEntries={['/charts']}><ChartsDeskHost fallback={<Fallback />} /></MemoryRouter>)
    // synchronously after the first commit: no microtask, no timer has run
    expect(screen.queryByTestId('workspace')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(fallbackMounts.n).toBe(0)
  })
})

describe('ChartsDeskHost, the module not loaded yet', () => {
  it('shows the fallback, then the workspace once the chunk lands (the lazy path, unchanged)', async () => {
    const { ChartsDeskHost, importer } = await host()
    expect(importer.loadedChartsWorkspace()).toBeNull()
    render(<MemoryRouter initialEntries={['/charts']}><ChartsDeskHost fallback={<Fallback />} /></MemoryRouter>)
    expect(screen.queryByTestId('fallback')).toBeTruthy()
    expect(await screen.findByTestId('workspace', {}, { timeout: 5000 })).toBeTruthy()
    expect(importer.loadedChartsWorkspace()).toBeTruthy()
  })
})
