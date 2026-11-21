// Morning Wire scrolled sideways by 16px on a phone (340 to 390px wide; panel fit, part 4,
// 2026-11-20). The full-bleed page header pulls itself out by the page's padding; on a phone it reads
// the second pair of variables and falls back to 16px. This page has no padding around the header
// and named only the first pair, so the header ran 16px past each side of the screen.
// jsdom lays nothing out, so this pins the rules; the widths were measured with the private sweep.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()

describe('Morning Wire: the page does not scroll sideways on a phone', () => {
  const css = squash(noComments(read('pages/MorningWire.module.css')))
  const jsx = read('pages/MorningWire.jsx')
  const wrap = /\.pageWrap \{([^}]*)\}/.exec(css)?.[1] || ''

  it('the header is drawn inside the wrapper that has no padding, before the padded page', () => {
    const at = jsx.indexOf('<div className={styles.pageWrap}>')
    expect(at).toBeGreaterThan(0)
    expect(jsx.indexOf('<SurfaceHeader icon="wire" title="Morning Wire" />')).toBeGreaterThan(at)
    expect(jsx.indexOf('<SurfaceHeader icon="wire" title="Morning Wire" />')).toBeLessThan(jsx.indexOf('<div className={styles.page}>', at))
  })

  it('the wrapper names BOTH pairs the header reads, each as no padding', () => {
    for (const name of ['--page-pad-top', '--page-pad-x', '--page-pad-top-m', '--page-pad-x-m']) {
      expect([name, new RegExp(`${name}: 0px;`).test(wrap)]).toEqual([name, true])
    }
    const header = squash(noComments(read('components/PageHeader.module.css')))
    expect(header).toContain('var(--page-pad-top-m, 16px)')
    expect(header).toContain('var(--page-pad-x-m, 16px)')
  })

  it('the cure is the cause: the wrapper does not clip what runs past it', () => {
    expect(wrap).not.toMatch(/overflow(-x)?:\s*(hidden|clip)/)
  })
})
