// ⛔⛔ THE CUE A MEMBER GETS WHEN THE DEVICE CANNOT BUZZ — and the rail that keeps ONE
// implementation of it.
//
// The defect these cover: `haptics.warn()` no-ops and returns false wherever `navigator.vibrate`
// is absent, which is EVERY iPhone. §C2's escalation — "this action leads to a surface that asks
// you to commit" — has therefore been silence on iOS for the most destructive actions in the hub
// since it shipped, and silence is indistinguishable from an ordinary fire.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { escalateCue, ESCALATE_CUE_MS } from './escalateCue.js'
import haptics from '../components/mobile/haptics.js'

const HUB = path.dirname(fileURLToPath(import.meta.url))
const CUE_CLASS = 'cue-under-test'

const el = () => {
  const d = document.createElement('div')
  document.body.appendChild(d)
  return d
}

const ESCALATING = { id: 'journal.close', escalate: true }
const ORDINARY = { id: 'scan.chartIt' }

describe('escalateCue — the visual fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })
  afterEach(() => vi.restoreAllMocks())

  it('paints the cue when the device cannot vibrate — the iPhone case', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(false)   // exactly what iOS Safari produces
    const node = el()
    const out = escalateCue(ESCALATING, { el: node, className: CUE_CLASS })

    expect(haptics.warn).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ escalate: true, haptic: false, visual: true })
    expect(node.classList.contains(CUE_CLASS)).toBe(true)
  })

  it('holds it for ESCALATE_CUE_MS and then removes it — a TIMER, never an animation', () => {
    // ⛔ The class must come OFF by JS. `tokens.css` zeroes animation-duration and
    // transition-duration app-wide under prefers-reduced-motion, so a CSS-driven cue would be
    // deleted for exactly the members most likely to depend on it.
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    vi.useFakeTimers()
    try {
      const node = el()
      escalateCue(ESCALATING, { el: node, className: CUE_CLASS })
      expect(node.classList.contains(CUE_CLASS)).toBe(true)
      vi.advanceTimersByTime(ESCALATE_CUE_MS - 1)
      expect(node.classList.contains(CUE_CLASS), 'removed too early').toBe(true)
      vi.advanceTimersByTime(2)
      expect(node.classList.contains(CUE_CLASS), 'never removed — the cue would be permanent').toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // ⭐ THE CONTROL. Without it, a function that painted unconditionally would pass every case
  // above, and Android members would get a flash on top of a working haptic.
  it('does NOT paint when the haptic actually fired', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(true)
    const node = el()
    const out = escalateCue(ESCALATING, { el: node, className: CUE_CLASS })
    expect(out).toMatchObject({ escalate: true, haptic: true, visual: false })
    expect(node.classList.contains(CUE_CLASS)).toBe(false)
  })

  // ⭐ THE SECOND CONTROL. A function that painted for every action would make the escalation
  // meaningless — the cue exists to say THIS ONE IS DIFFERENT.
  it('does NOT paint for an ordinary action, and fires impact() instead of warn()', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    vi.spyOn(haptics, 'impact').mockReturnValue(false)
    const node = el()
    const out = escalateCue(ORDINARY, { el: node, className: CUE_CLASS })
    expect(haptics.impact).toHaveBeenCalledTimes(1)
    expect(haptics.warn).not.toHaveBeenCalled()
    expect(out).toMatchObject({ escalate: false, visual: false })
    expect(node.classList.contains(CUE_CLASS)).toBe(false)
  })

  it('consults the RETURN VALUE rather than sniffing the platform', () => {
    // The same environment, twice, with only the helper's answer changed. A cue that sniffed
    // `navigator.vibrate` itself would behave identically in both and be a second authority over a
    // question `haptics.js` already answers.
    const node = el()
    vi.spyOn(haptics, 'warn').mockReturnValue(true)
    expect(escalateCue(ESCALATING, { el: node, className: CUE_CLASS }).visual).toBe(false)
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    expect(escalateCue(ESCALATING, { el: node, className: CUE_CLASS }).visual).toBe(true)
  })

  it('still paints when the member turned HAPTICS off, and attempts no vibration', () => {
    // ⭐ "I don't want buzzing" is not "I don't want to be told this action commits something".
    vi.spyOn(haptics, 'warn').mockReturnValue(true)
    const node = el()
    const out = escalateCue(ESCALATING, { el: node, className: CUE_CLASS, hapticsEnabled: false })
    expect(haptics.warn).not.toHaveBeenCalled()
    expect(out).toMatchObject({ escalate: true, haptic: false, visual: true })
    expect(node.classList.contains(CUE_CLASS)).toBe(true)
  })

  it('degrades to haptics-only when it is handed no element — never throws', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    expect(() => escalateCue(ESCALATING, {})).not.toThrow()
    expect(escalateCue(ESCALATING, {})).toMatchObject({ visual: false })
    expect(escalateCue(null, {})).toMatchObject({ escalate: false })
  })
})

describe('ONE implementation — the rail', () => {
  // ⛔ COMMENTS STRIPPED FIRST. Both call sites DISCUSS `haptics.warn()` at length in prose, and a
  // scanner that counted those would report copies that do not exist — the defect this repo has
  // paid for six times in one session.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const sources = () => readdirSync(HUB)
    .filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f))
    .map((f) => ({ file: f, src: strip(readFileSync(path.join(HUB, f), 'utf8')) }))

  it('only escalateCue.js calls the escalation haptics — no second copy of the branch', () => {
    const callers = sources().filter((s) => /haptics\.(warn|impact)\s*\(/.test(s.src))
    expect(callers.map((c) => c.file).sort()).toEqual(['escalateCue.js'])
  })

  // ⭐ NON-VACUITY. If the sweep read nothing — wrong directory, a glob that matches no files —
  // the assertion above would pass over an empty set for ever.
  it('the sweep can actually see the hub sources', () => {
    const all = sources()
    expect(all.length).toBeGreaterThan(10)
    expect(all.map((s) => s.file)).toContain('useJoystick.js')
    expect(all.map((s) => s.file)).toContain('HubActionsButton.jsx')
    // …and it can see a real call when there is one: escalateCue.js's own.
    expect(all.find((s) => s.file === 'escalateCue.js').src).toMatch(/haptics\.warn\s*\(/)
  })

  it('both doors call the shared cue', () => {
    const by = Object.fromEntries(sources().map((s) => [s.file, s.src]))
    expect(by['useJoystick.js']).toMatch(/escalateCue\(/)
    expect(by['HubActionsButton.jsx']).toMatch(/escalateCue\(/)
  })
})
