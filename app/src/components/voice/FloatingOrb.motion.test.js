// The voice orb sits on every page. Its idle breath animated box-shadow, which cannot run on the
// compositor, with `infinite`: the page repainted every frame forever (~115 paints a second with 12
// chart widgets popped, 2026-11-10). The idle breath is now finite. The listening / thinking /
// responding pulses stay endless on purpose: they run only while the member is using voice.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from 'vitest'

const css = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/voice/FloatingOrb.module.css'), 'utf8')
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')

function body(selector) {
  const re = new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm')
  const m = clean.match(re)
  return m ? m[2] : null
}

test('the idle orb breathes a finite number of times, never forever', () => {
  const orb = body('.orb')
  expect(orb).not.toBeNull()
  const anim = orb.match(/animation\s*:\s*([^;]+);/)
  expect(anim, 'the orb still has an arrival breath').not.toBeNull()
  expect(anim[1]).toMatch(/idleBreath/)
  expect(anim[1]).not.toMatch(/infinite/)
  expect(anim[1]).toMatch(/\b[1-9]\b/) // an explicit, small iteration count
})

test('the idle state does not reintroduce an endless animation', () => {
  const idle = body('.idle')
  expect(idle === null || !/infinite/.test(idle)).toBe(true)
})

// Each of these runs only while the member is actively using voice (or training it), so an endless
// pulse there costs frames only while it is the thing on screen. Anything else that pulses forever
// would cost every page, all day.
const ACTIVE_STATES = ['.listening', '.thinking', '.responding', '.training']

test('only the active voice states may pulse endlessly', () => {
  const endless = [...clean.matchAll(/([^{}]+)\{[^{}]*animation[^;{}]*infinite[^{}]*\}/g)].map((m) => m[1].trim())
  expect(endless.length).toBeGreaterThan(0) // the scan can see an endless animation at all
  for (const sel of endless) expect(ACTIVE_STATES).toContain(sel)
})
