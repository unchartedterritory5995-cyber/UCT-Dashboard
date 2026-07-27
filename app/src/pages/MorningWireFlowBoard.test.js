/**
 * Guards the "Notable Options Flow" board's CSS contract.
 *
 * The board's markup is injected as raw HTML by the engine (morning-wire
 * flow_publish.render_board_html), so its class names are LITERAL — they never go
 * through the CSS-Modules hasher. Two silent failure modes follow from that, and both
 * shipped a visibly broken table before:
 *
 *  1. A bare `.rd-order-bar` inside :not() gets compiled to a hashed local class, so the
 *     exclusion never matches anything in the real DOM. It looks correct in the source.
 *  2. Without the exclusion, the generic `> span { position: relative }` rule out-specifies
 *     `.rd-order-stripe { position: absolute }` (0,2,1 vs 0,2,0). The two decoration spans
 *     then become real grid items, taking columns 1-2 and shoving every value two columns
 *     right — Side and Premium wrapped onto a second line under the wrong headers.
 *
 * These are source assertions on purpose: they are cheap, and neither defect is visible
 * in a jsdom render (jsdom does not do grid layout or cascade resolution).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest runs with cwd at the `app` root
const CSS_PATH = resolve(process.cwd(), 'src/pages/MorningWire.module.css')
if (!existsSync(CSS_PATH)) throw new Error(`stylesheet not found at ${CSS_PATH}`)
const css = readFileSync(CSS_PATH, 'utf8')

const DECORATIONS = ['rd-order-bar', 'rd-order-stripe']

describe('Notable Options Flow board CSS', () => {
  it('has the rules under test (fixture guard)', () => {
    expect(css).toContain('.rd-flowboard-row')
    expect(css).toMatch(/\.rd-order-stripe\)?\s*\{[^}]*position:\s*absolute/)
    expect(css).toMatch(/\.rd-order-bar\)?\s*\{[^}]*position:\s*absolute/)
  })

  it('excludes the decoration spans from every `> span` rule that sets position', () => {
    // any rule targeting the row's direct span children AND setting `position`
    const spanRules = [...css.matchAll(/^[^\n{]*\.rd-flowboard-row[^\n{]*>\s*span[^\n{]*\{[^}]*\}/gms)]
      .map((m) => m[0])
      .filter((rule) => /position\s*:/.test(rule))

    expect(spanRules.length).toBeGreaterThan(0)
    for (const rule of spanRules) {
      for (const cls of DECORATIONS) {
        expect(rule, `\`> span\` position rule must exclude .${cls}:\n${rule}`)
          .toMatch(new RegExp(`:not\\(\\.${cls}\\)`))
      }
    }
  })

  it('keeps the :not() arguments global so CSS Modules cannot hash them', () => {
    // every :not(.rd-*) must sit inside a :global( ... ) wrapper
    for (const m of css.matchAll(/:not\(\.(rd-[a-z-]+)\)/g)) {
      const before = css.slice(0, m.index)
      const lastGlobal = before.lastIndexOf(':global(')
      expect(lastGlobal, `:not(.${m[1]}) is not inside :global() — it will be hashed`)
        .toBeGreaterThan(-1)
      // we are one level deep immediately after `:global(`; track parens from there
      const since = before.slice(lastGlobal + ':global('.length)
      const depth = 1 + (since.match(/\(/g) || []).length - (since.match(/\)/g) || []).length
      expect(depth, `:not(.${m[1]}) escaped its :global() wrapper — it will be hashed`)
        .toBeGreaterThanOrEqual(1)
    }
  })

  it('sizes the columns responsively off the board, not the viewport', () => {
    // the board declares itself a query container and the narrow tier keys off it, so a
    // sidebar-narrowed content column collapses the table the same way a phone does
    expect(css).toMatch(/\.rd-flowboard\)\s*\{[^}]*container-name:\s*flowboard/s)
    expect(css).toContain('@container flowboard')
    // shared template on header + rows, with shrinkable tracks so nothing can overflow
    expect(css).toMatch(/\.rd-flowboard-headrow\),?\s*\n?[^{]*\.rd-flowboard-row\)\s*\{[^}]*grid-template-columns:[^;]*minmax/s)
  })
})
