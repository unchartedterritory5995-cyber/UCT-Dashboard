import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DesktopBridgeSync from './DesktopBridgeSync'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

beforeEach(() => { delete window.uctDesktop })
afterEach(() => { cleanup(); delete window.uctDesktop; vi.useRealTimers() })

describe('DesktopBridgeSync', () => {
  it('renders nothing and does not throw with no bridge', () => {
    const { container } = render(<DesktopBridgeSync />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing with a bridge missing every method', async () => {
    window.uctDesktop = { bridgeVersion: 1, capabilities: ['before-quit', 'window-state'] }
    const { container } = render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(container.firstChild).toBeNull()
  })
})

describe('the mount in App.jsx', () => {
  const app = readFileSync(path.join(HERE, '..', 'App.jsx'), 'utf8')

  it('only renders in the desktop app, and never lands in the first-load bundle', () => {
    expect(app).toMatch(/const DesktopBridgeSync = plainLazy\(\(\) => import\('\.\/components\/DesktopBridgeSync'\)\.catch\(/)
    expect(app).toMatch(/\{isDesktopApp\(\) && <Suspense fallback=\{null\}><DesktopBridgeSync \/><\/Suspense>\}/)
    expect(app).not.toMatch(/^import DesktopBridgeSync/m)
  })

  it('reads no shared context: the leaf holds nothing of Layout or App', () => {
    const src = readFileSync(path.join(HERE, 'DesktopBridgeSync.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/useAuth\(\)/)
    expect(code).not.toMatch(/usePreferences\(\)/)
    expect(code).not.toMatch(/useContext\(/)
  })
})
