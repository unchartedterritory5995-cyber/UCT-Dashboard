// Notebook widgets O4: on the touch tier (820 and 390 px) the embed toolbar (‹, ⋯, More), which is always
// shown there with 44 px controls, was drawn as an overlay over the top-left of a /calendar embed and
// covered the calendar's day header (the date and its day navigation).
//
// The fix follows D1 (WidgetEmbedView.snapshotToolbar.test.jsx): on the touch tier the calendar frame's
// toolbar is a row in flow ABOVE the body, so the header starts below it. At 1200 px with a mouse nothing
// moves: the toolbar keeps the hover-reveal overlay it has always had there.
//
// jsdom performs no layout, so the promise is pinned where it is made: the DOM order (toolbar first, the
// header inside the body after it) and the stylesheet (a touch-tier rule takes the calendar frame's toolbar
// out of absolute positioning; no unconditional rule does, so the desktop overlay is unchanged).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
// The calendar body: its day header is the first thing it draws, top-left.
vi.mock('./CalendarEmbed', () => ({
  default: ({ attrs }) => <div data-testid="calendar-day-header">Earnings for {attrs.params.date}</div>,
}))

import WidgetEmbedView from './WidgetEmbedView'
import { widgetEmbedNode } from '../../lib/notebookWidgets'
import { etTodayIso } from '../../lib/widgetEmbedCore'
import { buildCalendarCapture, calendarCaptureSettings } from '../../../charts/widgets/captures/calendarCapture'

const css = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css'), 'utf8',
).replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** Top-level rules and @media blocks, in source order: {selector, body, media|null}. */
function rules(src) {
  const out = []
  let i = 0
  const top = (s, media) => {
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m
    while ((m = re.exec(s))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], media })
  }
  while (i < src.length) {
    const at = src.indexOf('@media', i)
    if (at < 0) { top(src.slice(i), null); break }
    top(src.slice(i, at), null)
    const open = src.indexOf('{', at)
    let depth = 1
    let j = open + 1
    while (depth && j < src.length) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1 }
    top(src.slice(open + 1, j - 1), src.slice(at + 6, open).trim())
    i = j
  }
  return out
}
const CAL = /^\.frame\[data-widget-embed-view=['"]calendar['"]\] \.toolbar$/
// The touch tier is an OR: a narrow window with a mouse (where the toolbar is also always shown) OR a
// device with no hover. A media query LIST: two comma-separated members, not one "and" condition.
const mediaList = (media) => String(media || '').split(',').map((m) => m.trim().replace(/\s+/g, ' '))
const TOUCH_TIER = (media) => {
  const list = mediaList(media)
  return list.length === 2 && list.includes('(max-width: 1024px)') && list.includes('(hover: none)')
}

const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-1' } }, on() {}, off() {} })

let RealIO
beforeAll(() => {
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO })
beforeEach(() => {
  __resetNotebookFlags()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => { __resetNotebookFlags(); vi.unstubAllGlobals() })

describe('a /calendar embed keeps its day header clear of the embed toolbar on the touch tier', () => {
  it('the toolbar comes BEFORE the body as a sibling, and the day header is drawn in the body', async () => {
    const payload = buildCalendarCapture({ date: etTodayIso() }, {
      econStars: 3, selectedSym: null, tbdOpen: false, settings: calendarCaptureSettings(null, 'dark'),
    })
    const { attrs } = widgetEmbedNode('calendar', payload)
    const { container } = render(<WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={vi.fn()} />)
    const header = await screen.findByTestId('calendar-day-header')
    const frame = container.querySelector('[data-widget-embed-view="calendar"]')
    const bar = screen.getByRole('toolbar', { name: 'Chart tools' })
    const body = container.querySelector('[data-widget-embed-body]')
    expect(bar.parentElement).toBe(frame)
    expect(body.parentElement).toBe(frame)
    expect(bar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(body.contains(header)).toBe(true)
    expect(bar.textContent).not.toContain(header.textContent)
  })

  it('a touch-tier rule takes the calendar frame\'s toolbar out of absolute positioning', () => {
    const all = rules(css)
    const base = all.find((r) => r.selector === '.toolbar' && r.media === null)
    expect(base).toBeTruthy()                                   // non-vacuity: the overlay rule is still there
    expect(base.body).toMatch(/position:\s*absolute/)
    const cal = all.filter((r) => CAL.test(r.selector))
    const touch = cal.find((r) => TOUCH_TIER(r.media))
    expect(touch, 'no touch-tier rule for the calendar frame toolbar').toBeTruthy()
    expect(mediaList(touch.media)).toHaveLength(2)              // an OR list, never an "and"
    expect(touch.body).toMatch(/position:\s*static/)
  })

  it('the 1200 px layout is unchanged: no rule outside the touch tier moves the calendar toolbar', () => {
    const all = rules(css)
    for (const r of all.filter((x) => CAL.test(x.selector))) {
      expect(TOUCH_TIER(r.media), `calendar toolbar rule outside the touch tier: ${r.media || '(no media)'}`).toBe(true)
    }
    // ...and nothing later on the touch tier puts a toolbar back to absolute/fixed, chart draw mode aside.
    const at = all.findIndex((r) => CAL.test(r.selector))
    expect(at).toBeGreaterThan(-1)
    for (const r of all.slice(at + 1).filter((x) => /\.toolbar\b/.test(x.selector))) {
      if (/position:\s*(absolute|fixed)/.test(r.body)) expect(r.selector).toMatch(/^\.annotating \.toolbar$/)
    }
  })
})
