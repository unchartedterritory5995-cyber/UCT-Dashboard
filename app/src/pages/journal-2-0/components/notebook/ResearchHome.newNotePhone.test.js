// @vitest-environment node
// P0.17: the phone Folders drawer button lives in NotebookTab's header, not in Home's top row.
// Adding the New-note control to that row must not make it overflow the phone width.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
const css = readFileSync(new URL('./ResearchHome.module.css', import.meta.url), 'utf8')
describe('P0.17 — phone header row', () => {
  it('the home header wraps on phone instead of overflowing', () => {
    const phone = css.split('@media (max-width: 640px)').slice(1).join('')
    expect(/\.homeHeader\s*\{[^}]*flex-wrap:\s*wrap/.test(phone)).toBe(true)
  })
})
