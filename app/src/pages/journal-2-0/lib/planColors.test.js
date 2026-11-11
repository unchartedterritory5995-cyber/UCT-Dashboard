// VIS-5 (audit 2026-11-05, issue 20): one colour language for a plan -- entry gold, stop --loss, target --gain --
// and every surface that draws or lists one reads it from lib/planColors.js. The fallbacks ARE tokens.css's
// :root values (read, never restated); every call site is checked to use the one authority.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ROLE_FALLBACK, PLAN_ROLE_TOKEN, PLAN_ROLE_VAR, colorPlanAnnotations, planRoleColor } from './planColors'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')

describe('the plan colours ARE the tokens', () => {
  const tokens = read('styles/tokens.css')
  const at = tokens.search(/^:root\s*\{/m)
  const root = tokens.slice(at, tokens.indexOf('}', at))
  it.each(Object.entries(PLAN_ROLE_TOKEN))('%s is %s, and its fallback is that token\'s :root value', (role, token) => {
    const m = root.match(new RegExp(String.raw`${token}:\s*(#[0-9a-fA-F]{6})`))
    expect(m, `${token} in tokens.css :root`).toBeTruthy()
    expect(PLAN_ROLE_FALLBACK[role].toLowerCase()).toBe(m[1].toLowerCase())
    expect(PLAN_ROLE_VAR[role]).toBe(`var(${token})`)
  })

  it('entry gold, stop loss, target gain -- and a line with no plan role has no plan colour', () => {
    expect(PLAN_ROLE_TOKEN).toEqual({ entry: '--ut-gold', stop: '--loss', target: '--gain' })
    expect(planRoleColor('custom')).toBeNull()
    expect(planRoleColor(undefined)).toBeNull()
  })

  it('reads the LIVE token off <html> (a theme moves it), else the fallback', () => {
    document.documentElement.style.setProperty('--loss', '#123456')
    expect(planRoleColor('stop')).toBe('#123456')
    document.documentElement.style.removeProperty('--loss')
    expect(planRoleColor('stop')).toBe(PLAN_ROLE_FALLBACK.stop)
  })

  it('colours role-tagged annotations; leaves the rest, and the array, alone when none has a role', () => {
    const plain = [{ id: 'a', type: 'horizontal', color: '#fff' }]
    expect(colorPlanAnnotations(plain)).toBe(plain)
    const out = colorPlanAnnotations([...plain, { id: 's', role: 'stop', color: '#dcbb5e' }, { id: 't', role: 'target' }])
    expect(out.map((a) => a.color)).toEqual(['#fff', PLAN_ROLE_FALLBACK.stop, PLAN_ROLE_FALLBACK.target])
  })
})

describe('every surface that draws or lists a plan uses the one authority', () => {
  it.each([
    'pages/journal-2-0/components/notebook/ChartEmbed.jsx',
    'pages/journal-2-0/components/notebook/ChartPlanPanel.jsx',
    'pages/journal-2-0/components/notebook/BoardCard.jsx',
    'pages/journal-2-0/components/trade/TradeBeforeAfter.jsx',
    'pages/journal-2-0/lib/tradeCanvas.js',
  ])('%s imports lib/planColors and keeps no hand-written plan colour', (file) => {
    const src = read(file)
    expect(src).toMatch(/from '[./]*(lib\/)?planColors'/)
    expect(src).not.toMatch(/(entry|stop|target):\s*'#[0-9a-fA-F]{6}'/)
    expect(src).not.toMatch(/id: '(entry|stop|target)', label: '[A-Za-z]+', color: '#/)
  })
})
