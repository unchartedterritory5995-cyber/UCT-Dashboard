/**
 * NO EMOJI IN THE CHROME — the rail that keeps Options Flow looking like the app.
 *
 * CLAUDE.md: "`UIcon` is the single source of truth for all UI iconography …
 * Do NOT use generic/system emoji as decorative icons." Every sibling page
 * followed that. OptionsFlow.jsx did not: on 2026-08-29 it carried 99 rendered
 * emoji across 25 distinct glyphs and used UIcon exactly ZERO times, which is
 * most of why the page read as "other" beside the rest of the dashboard.
 *
 * ⛔ WITHOUT THIS TEST THE FIX DOES NOT HOLD. Nothing about a system emoji
 * fails a build, a type check, or a render test — it just looks wrong, on
 * someone else's machine, in a colour the surface did not choose. A conversion
 * with no rail is a conversion that gets undone by the next hurried edit and
 * nobody notices until the page has drifted back.
 *
 * If a NEW glyph is genuinely needed, the answer is a new entry in UIcon's
 * registry (that is what `camera` was), not an emoji here.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(here, '..', 'OptionsFlow.jsx')
const SRC = fs.readFileSync(FILE, 'utf8')

// Pictographic ranges only. Deliberately NOT matching geometric marks
// (▲ ▼ ● ◆ U+25xx) or typographic arrows — those are legitimate text, and the
// price-level rows use them as a consistent family.
const PICTO = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}]/u

/** Lines that are pure comment — prose may mention an emoji it replaced. */
const isComment = (l) => {
  const t = l.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')
}

const offenders = SRC.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => !isComment(line) && PICTO.test(line))

describe('Options Flow renders no system emoji', () => {
  it('has none left in rendered code', () => {
    const report = offenders
      .map(({ n, line }) => `  OptionsFlow.jsx:${n}  ${line.trim().slice(0, 100)}`)
      .join('\n')
    expect(offenders.map(o => o.n),
      'these lines render a system emoji. Use <FlowIcon name="…"/> — see '
      + 'optionsFlow/FlowIcon.jsx for the mapping, and add a glyph to '
      + 'components/ui/UIcon.jsx if the registry has none:\n' + report).toEqual([])
  })

  it('control: the detector actually finds one', () => {
    // ⛔ Non-vacuity. If PICTO stopped matching, the assertion above would pass
    // for the wrong reason — forever, and silently, which is exactly how the
    // page got to 99 in the first place.
    expect(PICTO.test('const label = "⚡ Fetch"')).toBe(true)
    expect(PICTO.test('setStatus("\u{1F4F8} Copied")')).toBe(true)
  })

  it('control: it does NOT flag the geometric marks that are real text', () => {
    // The price-level rows use ▲ ▼ ● ◆ as a consistent typographic family.
    // Flagging those would push someone to "fix" correct code — a rail that
    // cries wolf gets muted, and then it protects nothing.
    for (const mark of ['▲', '▼', '●', '◆', '→', '—']) {
      expect(PICTO.test(`dir:"${mark}"`)).toBe(false)
    }
  })

  it('uses the icon system it was supposed to use all along', () => {
    // The other half of the claim: not just "no emoji" but "icons instead".
    // A page that simply deleted its emoji would pass the first test.
    expect(SRC).toContain('optionsFlow/FlowIcon')
    expect((SRC.match(/<FlowIcon /g) || []).length).toBeGreaterThan(60)
  })
})
