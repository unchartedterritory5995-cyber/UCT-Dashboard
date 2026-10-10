// X-17 (U-COPY-01) — the Settings billing card never claims a free tier (D-010 / TERM-081).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import PlanAccess, { planAccessState } from './PlanAccess'
import { FREE_PAGES, UPGRADE_PATH } from '../../constants/freePages'

afterEach(() => cleanup())

const card = () => screen.getByTestId('settings-plan-access')

describe('PlanAccess: the honest state for a non-Pro account', () => {
  it('the premise: there are no free pages, and a non-paid member is sent to the upgrade screen', () => {
    expect(FREE_PAGES).toEqual([])
    expect(UPGRADE_PATH).toBe('/subscribe')
  })

  it('a trial member is told the days left, that there is no free tier, and can subscribe', () => {
    const onSubscribe = vi.fn()
    render(<PlanAccess user={{ role: 'member' }} plan="free" trial={{ active: true, days_left: 3 }} onSubscribe={onSubscribe} />)
    expect(card().dataset.state).toBe('trial')
    expect(card()).toHaveTextContent('Full-access trial')
    expect(card()).toHaveTextContent('3 days left')
    expect(card()).toHaveTextContent('no free tier')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Pro ($200/mo)' }))
    expect(onSubscribe).toHaveBeenCalledTimes(1)
  })

  it('one day left reads in the singular', () => {
    render(<PlanAccess plan="free" trial={{ active: true, days_left: 1 }} />)
    expect(card()).toHaveTextContent('1 day left')
  })

  it('admin, premium and lifetime are named for what they are, with no upgrade pitch', () => {
    for (const [props, state, title] of [
      [{ user: { role: 'admin' }, plan: 'free' }, 'admin', 'Admin access'],
      [{ plan: 'premium' }, 'premium', 'Premium plan'],
      [{ plan: 'lifetime' }, 'lifetime', 'Lifetime plan'],
    ]) {
      render(<PlanAccess {...props} />)
      expect(card().dataset.state).toBe(state)
      expect(card()).toHaveTextContent(title)
      expect(screen.queryByRole('button')).toBeNull()
      cleanup()
    }
  })

  it('no access at all still says the paid-only truth, never "Free Plan"', () => {
    render(<PlanAccess user={{ role: 'member' }} plan="free" trial={null} />)
    expect(card().dataset.state).toBe('none')
    expect(card()).toHaveTextContent('No active plan')
    expect(card()).toHaveTextContent('no free tier')
  })

  it('no state claims a free plan or lists pages "you have"', () => {
    for (const props of [
      { plan: 'free', trial: { active: true, days_left: 5 } }, { user: { role: 'admin' } },
      { plan: 'premium' }, { plan: 'lifetime' }, { plan: 'free' },
    ]) {
      render(<PlanAccess {...props} />)
      expect(card().textContent).not.toMatch(/free plan/i)
      expect(card().textContent).not.toMatch(/you have/i)
      cleanup()
    }
  })

  it('the state precedence: an active trial wins, then the plan, then the admin role', () => {
    expect(planAccessState({ user: { role: 'admin' }, plan: 'lifetime', trial: { active: true } })).toBe('trial')
    expect(planAccessState({ user: { role: 'admin' }, plan: 'premium' })).toBe('premium')
    expect(planAccessState({ user: { role: 'admin' }, plan: 'free' })).toBe('admin')
    expect(planAccessState({})).toBe('none')
  })

  it('Settings.jsx renders PlanAccess for the non-Pro branch and no longer prints "Free Plan"', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/Settings.jsx'), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(src).toMatch(/<PlanAccess user=\{user\} plan=\{plan\} trial=\{trial\}/)
    expect(src).not.toMatch(/Free Plan/)
  })
})
