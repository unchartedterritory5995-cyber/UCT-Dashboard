// app/src/components/voice/FloatingOrb.chartShellSlot.test.js
//
// F5 fix round 1 (review Critical, second instance, and Important): on the phone chart the
// orb cluster is CSS-hidden (`html[data-mobile-chart-shell] .orbCluster { display: none }`),
// but the "Meet Compass" card lives in Layout's first-run slot, not in the cluster -- so it
// said "Tap the compass button" with no button on screen, and its height landed on top of a
// chart that sizes itself with calc(). Under the chart-shell attribute the slot takes no
// height at all.
//
// ⛔ Structural: jsdom applies no stylesheet. The measured heights are in the fix-round-1
// section of the lane report (a real Chromium at 390 and 1200 px). Both names this rail
// checks are READ from their owners -- the attribute from hub/hubViewport.js (CHART_SHELL_ATTR,
// what MobileChartsApp stamps), the slot's from Layout.jsx -- never typed here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHART_SHELL_ATTR } from '../../hub/hubViewport'

const SRC = join(process.cwd(), 'src')
const CSS = readFileSync(join(SRC, 'components', 'voice', 'FloatingOrb.module.css'), 'utf8')
const LAYOUT = readFileSync(join(SRC, 'components', 'Layout.jsx'), 'utf8')
const APP = readFileSync(join(SRC, 'pages', 'charts', 'mobile', 'MobileChartsApp.jsx'), 'utf8')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))

/** Top-level rules as `{ media, selector, body }` (media null = unconditional). */
function rules(css) {
  const text = stripComments(css)
  const out = []
  const walk = (s, media) => {
    let i = 0
    while (i < s.length) {
      const open = s.indexOf('{', i)
      if (open < 0) return
      const head = s.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < s.length && depth) {
        if (s[j] === '{') depth += 1
        else if (s[j] === '}') depth -= 1
        j += 1
      }
      const body = s.slice(open + 1, j - 1)
      if (head.startsWith('@media')) walk(body, head)
      else if (!head.startsWith('@')) {
        for (const sel of head.split(',').map((x) => x.trim()).filter(Boolean)) out.push({ media, selector: sel, body })
      }
      i = j
    }
  }
  walk(text, null)
  return out
}

const slotAttr = (() => {
  const m = /<div ref=\{registerFirstRunSlot\} (data-[a-z-]+)=""/.exec(LAYOUT)
  return m && m[1]
})()
const hides = (r) => /display\s*:\s*none/.test(r.body)
const all = rules(CSS)

describe('under the chart shell, the first-run slot takes no height (FloatingOrb.module.css)', () => {
  it('non-vacuity: both names are read from their owners, and the chart app stamps that attribute', () => {
    expect(CHART_SHELL_ATTR).toBe('data-mobile-chart-shell')
    expect(APP).toContain(`'${CHART_SHELL_ATTR}'`)
    expect(slotAttr, 'Layout.jsx renders the first-run slot with a data attribute').toBeTruthy()
  })

  it('non-vacuity: the orb cluster IS hidden under the chart shell (the state the slot must follow)', () => {
    const cluster = all.filter((r) => r.selector.includes(`html[${CHART_SHELL_ATTR}]`) && r.selector.includes('.orbCluster') && hides(r))
    expect(cluster.length).toBeGreaterThanOrEqual(1)
  })

  it('an UNCONDITIONAL rule hides the slot under the chart-shell attribute', () => {
    const want = `:global(html[${CHART_SHELL_ATTR}] [${slotAttr}])`
    const hit = all.filter((r) => r.selector === want && r.media === null && hides(r))
    expect(hit.map((r) => r.selector), `${want} { display: none } outside any @media`).toEqual([want])
  })

  it('every @media that hides the cluster under the chart shell is covered by it (unconditional ⊇ any query)', () => {
    const clusterMedia = all.filter((r) => r.selector.includes(`html[${CHART_SHELL_ATTR}]`)
      && r.selector.includes('.orbCluster') && hides(r)).map((r) => r.media)
    const slotMedia = all.filter((r) => r.selector.includes(`[${slotAttr}]`) && hides(r)).map((r) => r.media)
    for (const m of clusterMedia) expect(slotMedia.includes(null) || slotMedia.includes(m), String(m)).toBe(true)
  })
})
