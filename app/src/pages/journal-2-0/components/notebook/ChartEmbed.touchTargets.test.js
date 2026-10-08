// Wave 14 playbook fixes, item 3 -- a Notebook chart block's finger targets clear `--tap-min`
// on the WHOLE touch tier (phone 390 AND tablet 820), with tokens only.
//
// `ChartEmbed.jsx` renders StockChart at `density="mini"`, where the only buttons StockChart
// draws are the A/L/% scale chips (`.scaleToggleBtn`, 9px type) and the legend's fold buttons
// (`.chipMore` 20px, `.studyMore` 14px), plus the back-to-latest arrow (`.toPresentBtn`, 26px)
// a live or peek-to-now embed shows once scrolled back. 13I-2 recorded the gap and fixed it only for
// TradeBeforeAfter (by HIDING the chrome); the Notebook's own embed kept it. The floor is
// scoped to the embed's `data-notebook-chart-embed` figure so no other chart surface moves.
//
// ⛔ Same family as `styles/tapFloor.test.js` and `FolderSidebar.renameTagTouchTier.test.js`,
// and why it is not just the first: that app-wide rail checks a RELATIONSHIP (phone and tablet
// agree), which a floor missing at both widths satisfies. This pins the ABSOLUTE floor.
//
// ⛔ THE BUTTON SET IS DERIVED, NOT TYPED: every `<button className=...>` class StockChart.jsx
// renders is read from the source. A new chrome button added tomorrow fails here until the
// embed covers it or it is shown to be unreachable from an embed (`goLivePill` renders only under
// `showGoLive`, `rangeBtn` only without `showRangeSelector: false` -- both asserted, not assumed).
//
// ⛔ A STRUCTURAL RAIL. jsdom lays nothing out; passing here is necessary, not sufficient.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const STOCK_CSS = stripComments(read('components/StockChart.module.css'))
const CHIP_CSS = stripComments(read('components/chart/legend/IndicatorChip.module.css'))
const STOCK_JSX = read('components/StockChart.jsx')
const EMBED_JSX = read('pages/journal-2-0/components/notebook/ChartEmbed.jsx')
const SCOPE = ':global([data-notebook-chart-embed])'
const PHONE = 390
const TABLET = 820
const DESKTOP = 1200

/** Bodies of the @media blocks that APPLY at `width` (the tapFloor.test.js helper). */
function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/** Does a rule scoped to the embed attribute pin `prop` of `.cls` to the `--tap-min` TOKEN? */
function pinned(block, cls, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const hit = sels.split(',').some((s) => s.trim() === `${SCOPE} .${cls}`)
    if (!hit) continue
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*var\\(--tap-min\\)\\s*(?:;|$)`)
    if (re.test(decls.trim())) return true
  }
  return false
}

/** Every class StockChart.jsx puts on a <button>, as `styles.x` / `chipStyles.x`. The
 *  className expression is read brace-balanced (a template literal holds `${...}`). */
function stockChartButtonClasses() {
  const out = new Set()
  // `<button` + whitespace: a JSX tag, never prose such as "`<button>`s" in a comment.
  for (const m of STOCK_JSX.matchAll(/<button\s/g)) {
    const at = STOCK_JSX.indexOf('className={', m.index)
    const close = STOCK_JSX.indexOf('</button>', m.index)
    if (at < 0 || (close >= 0 && at > close)) continue
    let depth = 0
    let i = at + 'className='.length
    for (; i < STOCK_JSX.length; i += 1) {
      if (STOCK_JSX[i] === '{') depth += 1
      else if (STOCK_JSX[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    const expr = STOCK_JSX.slice(at, i + 1)
    for (const c of expr.matchAll(/\b(styles|chipStyles)\.([A-Za-z][A-Za-z0-9_]*)/g)) out.add(`${c[1]}.${c[2]}`)
  }
  return [...out].sort()
}

const cssFor = (ref) => (ref.startsWith('chipStyles.') ? CHIP_CSS : STOCK_CSS)
const classOf = (ref) => ref.split('.')[1]
// Active-state modifiers are not separate targets: `.scaleToggleActive` rides `.scaleToggleBtn`.
const MODIFIER = /Active$/
// Rendered only behind a StockChart prop ChartEmbed keeps off -- each with the pattern the embed
// source must (or must not) match for that to stay true (asserted in its own case).
const NOT_IN_EMBED = {
  'styles.goLivePill': { why: 'renders only under showGoLive, which the embed never passes', absent: /\bshowGoLive\b/ },
  'styles.rangeBtn': { why: 'the embed passes showRangeSelector: false', present: /showRangeSelector:\s*false/ },
}

describe('a Notebook chart block clears --tap-min on phone AND tablet (wave 14, item 3)', () => {
  const targets = stockChartButtonClasses().filter((r) => !MODIFIER.test(r) && !NOT_IN_EMBED[r])

  it('⛔ NON-VACUITY -- the derivation finds StockChart\'s buttons, including the four this fixes', () => {
    expect(targets).toEqual(expect.arrayContaining(['styles.scaleToggleBtn', 'chipStyles.chipMore', 'styles.studyMore', 'styles.toPresentBtn']))
    for (const ref of Object.keys(NOT_IN_EMBED)) expect(stockChartButtonClasses()).toContain(ref)   // exclusions are real
  })

  it('the embed actually carries the scoping attribute (the wire, not just the stylesheet)', () => {
    expect(EMBED_JSX).toMatch(/role="figure"[^>]*data-notebook-chart-embed=""/)
  })

  it('every button an embed can show is pinned to the token, min-width AND min-height, at 390 and 820', () => {
    const misses = []
    for (const ref of targets) {
      for (const w of [PHONE, TABLET]) {
        const block = mediaBodiesAt(cssFor(ref), w)
        for (const prop of ['min-width', 'min-height']) {
          if (!pinned(block, classOf(ref), prop)) misses.push(`${ref} ${prop} @${w}px`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('desktop is untouched -- the floor lives only in the touch tier', () => {
    for (const ref of targets) {
      expect(pinned(mediaBodiesAt(cssFor(ref), DESKTOP), classOf(ref), 'min-height')).toBe(false)
    }
  })

  it('the excluded buttons really are unreachable from an embed', () => {
    for (const [ref, rule] of Object.entries(NOT_IN_EMBED)) {
      if (rule.absent) expect(EMBED_JSX, `${ref}: ${rule.why}`).not.toMatch(rule.absent)
      if (rule.present) expect(EMBED_JSX, `${ref}: ${rule.why}`).toMatch(rule.present)
    }
  })

  it('tokens only: the embed-scoped rules declare no literal colour or pixel size', () => {
    const scoped = [STOCK_CSS, CHIP_CSS]
      .flatMap((css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
      .filter(([, sels]) => sels.includes(SCOPE))
    expect(scoped.length).toBeGreaterThanOrEqual(4)
    for (const [, sels, decls] of scoped) {
      expect(decls, sels).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b\d+px\b/)
    }
  })

  it('⭐ CONTROL -- a phone-only floor does NOT satisfy the tablet width', () => {
    const phoneOnly = `@media (max-width: 640px) { ${SCOPE} .chipMore { min-width: var(--tap-min); min-height: var(--tap-min); } }`
    expect(pinned(mediaBodiesAt(phoneOnly, PHONE), 'chipMore', 'min-height')).toBe(true)
    expect(pinned(mediaBodiesAt(phoneOnly, TABLET), 'chipMore', 'min-height')).toBe(false)
  })

  it('⭐ CONTROL -- an UNSCOPED or literal-px floor does not count as the embed fix', () => {
    const unscoped = '@media (max-width: 1024px) { .chipMore { min-height: var(--tap-min); } }'
    const literal = `@media (max-width: 1024px) { ${SCOPE} .chipMore { min-height: 44px; } }`
    expect(pinned(mediaBodiesAt(unscoped, TABLET), 'chipMore', 'min-height')).toBe(false)
    expect(pinned(mediaBodiesAt(literal, TABLET), 'chipMore', 'min-height')).toBe(false)
  })
})
