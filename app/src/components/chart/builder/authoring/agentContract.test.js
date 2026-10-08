// OVERNIGHT H — the UCT Agent ⇄ UCT Intelligence delegation contract (indicator side).
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { indicatorRequestProblem, delegateIndicatorRequest } from './agentContract'

describe('agentContract — typed, closed, opens a dock and never saves', () => {
  it('validates each action closed (unknown fields refused, never ignored)', () => {
    expect(indicatorRequestProblem({ action: 'create', prompt: 'Make every inside daily candle black' })).toBeNull()
    expect(indicatorRequestProblem({ action: 'modify', defId: 'u_0123456789ab', prompt: 'make it 50' })).toBeNull()
    expect(indicatorRequestProblem({ action: 'create', prompt: 'x', tree: { type: 'num', value: 1 } })).toMatch(/does not take tree/)
    expect(indicatorRequestProblem({ action: 'create', prompt: '  ' })).toMatch(/Say what/)
    expect(indicatorRequestProblem({ action: 'modify', defId: 'rsi', prompt: 'x' })).toMatch(/not one of your saved/)
    expect(indicatorRequestProblem({ action: 'delete', prompt: 'x' })).toMatch(/not an indicator action/)
    expect(indicatorRequestProblem({ action: 'import', dialect: 'mql', source: 'x' })).toMatch(/not an import language/)
  })

  it('create / modify map onto openCreateIndicator with the member\'s words PREFILLED; no tree crosses', () => {
    const api = { openCreateIndicator: vi.fn(() => true) }
    expect(delegateIndicatorRequest({ action: 'create', prompt: ' Inside days black ' }, api)).toEqual({ status: 'opened' })
    expect(api.openCreateIndicator).toHaveBeenLastCalledWith({ prompt: 'Inside days black' })
    expect(delegateIndicatorRequest({ action: 'modify', defId: 'u_0123456789ab', prompt: 'make it 50' }, api)).toEqual({ status: 'opened' })
    expect(api.openCreateIndicator).toHaveBeenLastCalledWith({ defId: 'u_0123456789ab', prompt: 'make it 50' })
    api.openCreateIndicator.mockReturnValueOnce(false)
    expect(delegateIndicatorRequest({ action: 'modify', defId: 'u_0123456789ab', prompt: 'x' }, api).status).toBe('refused')
  })

  it('import is refused BY NAME (the import box cannot carry a script yet — it would be dropped)', () => {
    const api = { openFormulaBuilder: vi.fn(() => true) }
    const r = delegateIndicatorRequest({ action: 'import', dialect: 'pine', source: '//@version=5' }, api)
    expect(r).toMatchObject({ status: 'refused' })
    expect(r.reason).toMatch(/not wired yet/)
    expect(api.openFormulaBuilder).not.toHaveBeenCalled()
  })

  it('the seam: ChartToolbar carries the prompt into the panel, which PREFILLS and never auto-sends', () => {
    const root = path.resolve(globalThis.process.cwd(), 'src/components/chart')
    const toolbar = fs.readFileSync(path.join(root, 'ChartToolbar.jsx'), 'utf8')
    const panel = fs.readFileSync(path.join(root, 'builder/studio/CreateIndicatorPanel.jsx'), 'utf8')
    expect(toolbar).toMatch(/setCreateSeed\(opts && typeof opts\.prompt === 'string'/)
    expect(toolbar).toMatch(/initialPrompt=\{createSeed\}/)
    expect(panel).toMatch(/useState\(\(\) => \(typeof initialPrompt === 'string' \? initialPrompt : ''\)\)/)
    expect(toolbar).toContain('delegateIndicator(req) { return delegateIndicatorRequest(req, this) }')
    // the Agent itself still owns no indicator capability (its own README rule)
    const agentDir = path.resolve(globalThis.process.cwd(), 'src/agent/capabilities')
    const names = fs.readdirSync(agentDir).join(' ')
    expect(names).not.toMatch(/indicator/)
  })
})
