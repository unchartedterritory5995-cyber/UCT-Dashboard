// app/src/pages/terminal/panelFit.test.js
//
//     cd app && npx vitest run src/pages/terminal/panelFit.test.js --maxWorkers=2
//
// The one mechanism behind "a table fits a narrow PANEL": the words a width earns (the fold ladder,
// snug, medium), and the shared observer that writes them on a panel body. jsdom lays nothing out,
// so a width is given to an element by defining its `offsetWidth`, and the ResizeObserver is a fake
// the test fires by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLD_STEPS, MEDIUM_MAX, NARROW_MAX, PANEL_FIT_ATTR, PANEL_FIT_TIERS, SNUG_MAX, foldWord, panelFitFor, resetPanelFitForTests, watchPanelFit } from './panelFit'

describe('panelFitFor: the words of a panel width', () => {
  it('the two-panel boards of the common laptops fold nothing by themselves: 592, 555 and 512 are above a step', () => {
    expect(panelFitFor(640)).toBe('snug medium')
    expect(panelFitFor(600)).toBe('snug medium')
    expect(panelFitFor(592)).toBe('snug medium')
    expect(panelFitFor(555)).toBe('fold590 fold570 snug medium')
    expect(panelFitFor(512)).toBe('fold590 fold570 fold550 fold530 snug medium')
    for (const w of [640, 600, 592, 555, 512, 474, 461]) expect([w, panelFitFor(w).split(' ').includes('narrow')]).toEqual([w, false])
  })

  it('THE FOLD LADDER: one word per step the panel is no wider than, widest first', () => {
    expect([...FOLD_STEPS]).toEqual([590, 570, 550, 530, 510, 480])
    expect(foldWord(550)).toBe('fold550')
    for (const step of FOLD_STEPS) {
      expect([step, panelFitFor(step).split(' ').includes(foldWord(step))]).toEqual([step, true])
      expect([step, panelFitFor(step + 1).split(' ').includes(foldWord(step))]).toEqual([step, false])
    }
    expect(panelFitFor(500)).toBe('fold590 fold570 fold550 fold530 fold510 snug medium')
    expect(panelFitFor(591)).toBe('snug medium')
  })

  it('the ladder is in order, every step is above the bottom and under a 592px two-panel board', () => {
    expect([...FOLD_STEPS].sort((x, y) => y - x)).toEqual([...FOLD_STEPS])
    expect(new Set(FOLD_STEPS).size).toBe(FOLD_STEPS.length)
    expect(Math.max(...FOLD_STEPS)).toBeLessThan(592)
    expect(Math.min(...FOLD_STEPS)).toBeGreaterThan(NARROW_MAX)
    // a step under each laptop board: a table measured to fit 592, 555 or 512 can name a step below it
    for (const board of [592, 555, 512]) expect([board, FOLD_STEPS.some((s) => s < board && s >= board - 12)]).toEqual([board, true])
  })

  it('the bottom of the ladder: at 460 and narrower every table folds (narrow), and wrapping still applies', () => {
    expect(NARROW_MAX).toBe(460)
    expect(panelFitFor(NARROW_MAX)).toBe('narrow fold590 fold570 fold550 fold530 fold510 fold480 snug medium')
    expect(panelFitFor(NARROW_MAX + 1)).toBe('fold590 fold570 fold550 fold530 fold510 fold480 snug medium')
    expect(panelFitFor(380)).toBe('narrow fold590 fold570 fold550 fold530 fold510 fold480 snug medium')
    expect(panelFitFor(474).split(' ')).not.toContain('narrow')
  })

  it('snug and medium only let cells wrap; a wide panel earns nothing', () => {
    expect([SNUG_MAX, MEDIUM_MAX]).toEqual([660, 780])
    expect(panelFitFor(601)).toBe('snug medium')
    expect(panelFitFor(SNUG_MAX)).toBe('snug medium')
    expect(panelFitFor(SNUG_MAX + 1)).toBe('medium')
    expect(panelFitFor(700)).toBe('medium')
    expect(panelFitFor(MEDIUM_MAX)).toBe('medium')
    expect(panelFitFor(MEDIUM_MAX + 1)).toBe('')
    expect(panelFitFor(1300)).toBe('')
  })

  it('every word of every answer is one the stylesheets may key on, and every such word is earned somewhere', () => {
    const words = new Set()
    for (let w = 1; w <= 900; w += 1) for (const word of panelFitFor(w).split(' ').filter(Boolean)) words.add(word)
    expect([...words].sort()).toEqual([...PANEL_FIT_TIERS].sort())
    expect([...PANEL_FIT_TIERS]).toEqual(['narrow', 'fold590', 'fold570', 'fold550', 'fold530', 'fold510', 'fold480', 'snug', 'medium'])
  })

  it('a phone SCREEN is narrow and nothing else, whatever the panel measures, as before', () => {
    expect(panelFitFor(390, true)).toBe('narrow')
    expect(panelFitFor(640, true)).toBe('narrow')
    expect(panelFitFor(500, true)).toBe('narrow')
    expect(panelFitFor(640, false)).toBe('snug medium')
  })

  it('a panel that is not laid out gives no answer (null), not "wide"', () => {
    expect(panelFitFor(0)).toBeNull()
    expect(panelFitFor(undefined)).toBeNull()
    expect(panelFitFor(NaN)).toBeNull()
  })
})

describe('watchPanelFit: one shared observer writes data-fit on each panel body', () => {
  let made
  let realRO
  let realMatchMedia
  let phone

  const body = (width) => {
    const el = document.createElement('div')
    let w = width
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => w })
    el.setWidth = (next) => { w = next }
    return el
  }
  const fire = (...els) => made[0].cb(els.map((target) => ({ target })))

  beforeEach(() => {
    made = []
    phone = false
    realRO = globalThis.ResizeObserver
    realMatchMedia = window.matchMedia
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.observed = new Set(); made.push(this) }
      observe(el) { this.observed.add(el) }
      unobserve(el) { this.observed.delete(el) }
      disconnect() { this.observed.clear() }
    }
    window.matchMedia = vi.fn((q) => ({ matches: phone && q === '(max-width: 640px)', media: q, addEventListener() {}, removeEventListener() {} }))
    resetPanelFitForTests()
  })

  afterEach(() => {
    resetPanelFitForTests()
    globalThis.ResizeObserver = realRO
    window.matchMedia = realMatchMedia
  })

  it('marks the body at once, before any observer callback, so the first paint is right', () => {
    const el = body(520)
    watchPanelFit(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('fold590 fold570 fold550 fold530 snug medium')
  })

  it('a wide panel carries no attribute at all', () => {
    const el = body(1300)
    watchPanelFit(el)
    expect(el.hasAttribute(PANEL_FIT_ATTR)).toBe(false)
  })

  it('follows the panel as its width changes: wide, medium, snug, down the ladder and back', () => {
    const el = body(1300)
    watchPanelFit(el)
    el.setWidth(700); fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('medium')
    el.setWidth(640); fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('snug medium')
    el.setWidth(555); fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('fold590 fold570 snug medium')
    el.setWidth(420); fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('narrow fold590 fold570 fold550 fold530 fold510 fold480 snug medium')
    el.setWidth(900); fire(el)
    expect(el.hasAttribute(PANEL_FIT_ATTR)).toBe(false)
  })

  it('ONE observer serves every panel on the board', () => {
    const a = body(592)
    const b = body(700)
    const c = body(1300)
    watchPanelFit(a); watchPanelFit(b); watchPanelFit(c)
    expect(made).toHaveLength(1)
    expect([...made[0].observed]).toEqual([a, b, c])
    expect([a, b, c].map((el) => el.getAttribute(PANEL_FIT_ATTR))).toEqual(['snug medium', 'medium', null])
  })

  it('a hidden panel (width 0, a phone keeps the unfocused ones mounted) keeps what it had', () => {
    phone = true
    const el = body(390)
    watchPanelFit(el)
    el.setWidth(0); fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('narrow')
    const never = body(0)
    watchPanelFit(never)
    expect(never.hasAttribute(PANEL_FIT_ATTR)).toBe(false)
    never.setWidth(390); fire(never)
    expect(never.getAttribute(PANEL_FIT_ATTR)).toBe('narrow')
  })

  it('on a phone screen every laid-out panel is narrow and nothing else, whatever it measures', () => {
    phone = true
    const el = body(640)
    watchPanelFit(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('narrow')
    phone = false
    fire(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('snug medium')
  })

  it('does not rewrite an attribute that is already right (no needless style pass)', () => {
    const el = body(500)
    watchPanelFit(el)
    const set = vi.spyOn(el, 'setAttribute')
    fire(el); fire(el)
    expect(set).not.toHaveBeenCalled()
  })

  it('the cleanup stops watching and takes the mark off', () => {
    const el = body(500)
    const stop = watchPanelFit(el)
    stop()
    expect(made[0].observed.has(el)).toBe(false)
    expect(el.hasAttribute(PANEL_FIT_ATTR)).toBe(false)
  })

  it('no element: nothing to watch, and a cleanup that is safe to call', () => {
    expect(() => watchPanelFit(null)()).not.toThrow()
    expect(made).toHaveLength(0)
  })

  it('without a ResizeObserver the body is still marked once', () => {
    globalThis.ResizeObserver = undefined
    resetPanelFitForTests()
    const el = body(500)
    const stop = watchPanelFit(el)
    expect(el.getAttribute(PANEL_FIT_ATTR)).toBe('fold590 fold570 fold550 fold530 fold510 snug medium')
    expect(() => stop()).not.toThrow()
  })
})
