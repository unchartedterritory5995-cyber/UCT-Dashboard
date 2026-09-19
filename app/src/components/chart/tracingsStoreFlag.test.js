// S5 CP4 — the flag defaults OFF, and this pins the LITERAL, not just the
// behavior, so the default cannot be changed and this test "fixed" to match
// (mirrors the convention `test_the_default_in_source_is_ON_and_cannot_be_
// flipped_unnoticed` uses for HUB_PREVIEW_ENABLED).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/chart/tracingsStoreFlag.js'),
  'utf8',
)

describe('TRACINGS_STORE_ENABLED defaults OFF', () => {
  it('the exported literal is false', () => {
    expect(SRC).toMatch(/export const TRACINGS_STORE_ENABLED\s*=\s*false\b/)
  })

  it('CONTROL: the assertion can see a real flip', () => {
    const flipped = SRC.replace('TRACINGS_STORE_ENABLED = false', 'TRACINGS_STORE_ENABLED = true')
    expect(flipped).not.toMatch(/export const TRACINGS_STORE_ENABLED\s*=\s*false\b/)
  })
})
