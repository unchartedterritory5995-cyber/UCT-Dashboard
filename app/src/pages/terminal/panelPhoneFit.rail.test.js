// app/src/pages/terminal/panelPhoneFit.rail.test.js
//
// ─── THE FIVE TABLES THAT WERE WIDER THAN A PHONE STAY FITTED ───
//
//     cd app && npx vitest run src/pages/terminal/panelPhoneFit.rail.test.js --maxWorkers=2
//
// 2026-11-18: a 390px sweep of 27 Terminal panels in a real browser (sample data, local preview)
// found five whose table was wider than the screen and scrolled sideways: PERF (63px over), CONFL
// (79), ACCUM (116), CEOS (23) and MOST (165). Each was fitted with phone-only rules; desktop and
// tablet are unchanged.
//
// jsdom computes no layout, so this reads SOURCE (like panelPhoneLayout.rail.test.js): it holds the
// two helpers' rules and each panel's use of them. The rendered widths are measured by the sweep.
//
// The lesson the rule text pins: `overflow-wrap: anywhere` (the desktop `.wrapCell` rule) lets the
// browser squeeze a column to a few letters, which at phone width split "government" and "$640.0M"
// in the middle. The phone helpers use `break-word`, which breaks between words and does not shrink
// the column below its longest word.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const PANELS = path.join(process.cwd(), 'src', 'pages', 'terminal', 'panels')
const read = (name) => fs.readFileSync(path.join(PANELS, name), 'utf8').replace(/\r\n/g, '\n')

/** The bodies of every `@media (max-width: 640px) { … }` block in a stylesheet, joined. */
function phoneBlocks(css) {
  const out = []
  const open = '@media (max-width: 640px)'
  let at = css.indexOf(open)
  while (at !== -1) {
    const start = css.indexOf('{', at)
    let depth = 0
    let i = start
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    out.push(css.slice(start + 1, i))
    at = css.indexOf(open, i)
  }
  return out.join('\n')
}

/** One rule's declarations inside a block of CSS, by a selector it lists. */
function ruleFor(block, selector) {
  const re = new RegExp(`(?:^|[},])[^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`, 'm')
  return (block.match(re) || [])[1] || ''
}

describe('the shared phone helpers (marketPanels.module.css)', () => {
  const css = read('marketPanels.module.css')
  const phone = phoneBlocks(css)
  const outside = css.replace(/@media \(max-width: 640px\)[\s\S]*?\n\}\n/g, '')

  it('phoneWrap lets a cell, or one span in a cell, take a second line, breaking between words', () => {
    const rule = ruleFor(phone, '.table td.phoneWrap')
    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).toMatch(/overflow-wrap:\s*break-word/)
    expect(phone).toContain('.table td span.phoneWrap')
  })

  it('phoneTight gives back the wrap cell floor and never breaks inside a word', () => {
    const rule = ruleFor(phone, '.table td.phoneTight')
    expect(rule).toMatch(/min-width:\s*0/)
    expect(rule).toMatch(/overflow-wrap:\s*break-word/)
    expect(rule).not.toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('both are phone-only: no rule for them outside the phone query, so desktop rows keep one line', () => {
    expect(outside).not.toMatch(/\.phoneWrap\b[^{]*\{/)
    expect(outside).not.toMatch(/\.phoneTight\b[^{]*\{/)
  })

  it('the helpers come after the desktop wrap cell rule, so they win at equal specificity', () => {
    expect(css.lastIndexOf('.table td.phoneTight')).toBeGreaterThan(css.indexOf('.table td.wrapCell'))
  })
})

describe('each fitted panel still opts in', () => {
  const uses = (src, cls) => (src.match(new RegExp(`styles\\.${cls}\\b`, 'g')) || []).length

  it.each([
    ['PerformancePanel.jsx', { phoneTight: 2, phoneWrap: 2 }],
    ['ConfluencePanel.jsx', { phoneTight: 2, phoneWrap: 4 }],
    ['RepeatContractsPanel.jsx', { phoneTight: 2, phoneWrap: 2 }],
    ['CallThemesPanel.jsx', { phoneTight: 4, phoneWrap: 2 }],
  ])('%s', (file, want) => {
    const src = read(file)
    for (const [cls, n] of Object.entries(want)) expect([file, cls, uses(src, cls)]).toEqual([file, cls, n])
  })

  it('every phoneTight cell is a wrap cell (the helper only loosens a cell that already wraps)', () => {
    for (const file of ['PerformancePanel.jsx', 'ConfluencePanel.jsx', 'RepeatContractsPanel.jsx', 'CallThemesPanel.jsx']) {
      for (const line of read(file).split('\n').filter((l) => l.includes('styles.phoneTight'))) {
        expect([file, line.includes('styles.wrapCell')]).toEqual([file, true])
      }
    }
  })
})

describe('MOST on a phone (moversPanel.module.css)', () => {
  const css = read('moversPanel.module.css')
  const phone = phoneBlocks(css)
  const jsx = read('MoversPanel.jsx')

  it('the share count steps aside on a phone, header and cell together, and Vol x avg stays', () => {
    expect(ruleFor(phone, '.phoneHide')).toMatch(/display:\s*none/)
    expect(jsx).toMatch(/key: 'volume',[^}]*phoneHide: true/)
    expect(jsx).not.toMatch(/key: 'volVsAvg',[^}]*phoneHide/)
    expect(jsx).toContain('className={c.phoneHide ? styles.phoneHide : undefined}')
    expect(jsx).toContain('<td className={styles.phoneHide}>{formatCompactTerminal(r.volume)}</td>')
  })

  it('the Why label may take two lines and the gapper tag drops under the symbol', () => {
    expect(ruleFor(phone, '.table td.whyCell')).toMatch(/white-space:\s*normal/)
    expect(ruleFor(phone, '.asideTag')).toMatch(/display:\s*block/)
    expect(jsx).toContain('styles.asideTag')
    expect((jsx.match(/styles\.whyCell/g) || []).length).toBe(2)
  })

  it('none of it applies off a phone', () => {
    const outside = css.replace(/@media \(max-width: 640px\)[\s\S]*?\n\}\n?/g, '')
    for (const cls of ['.phoneHide', '.whyCell', '.asideTag']) expect([cls, outside.includes(cls)]).toEqual([cls, false])
  })
})
