// Notebook widgets fix F4 (D2, browser walk 2026-10-21): `/calendar` for TODAY toasted "UCT Terminal day
// added." and then rendered "[calendar: 2026-10-21] snapshot image not captured yet" at every width
// (1200-2-calendar.png, 820-2-calendar.png, 390-2-calendar.png).
//
// The cause: resolveEmbedRender's G-063 gate puts a same-day calendar capture on the "captured before the
// outcome" side and wants an archive image, and the archive pass only runs for a LIVE decision, so the
// image never came. Both doors build the node with ONE builder (calendarCapture.js), so the /charts Send to
// Journal capture of the same day did exactly the same. The fix: a capture with no archive yet, viewed on
// the ET day it was captured, renders live (the view the member captured) and the self-archive freezes it.
//
// Rails here: (1) the slash-inserted node and the Send to Journal node are the same node and both resolve
// live today; (2) the rendered embed mounts the calendar body and the placeholder sentence is absent;
// (3) the self-archive fires for it; (4) the gate's fail-safe is unchanged a day later and with an image.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
// The calendar body: stands in for the real widget's rows (CalendarEmbed mounts the /charts widget).
vi.mock('./CalendarEmbed', () => ({
  default: ({ attrs }) => <div data-testid="calendar-embed-rows">NVDA reports before the open on {attrs.params.date}</div>,
}))

import WidgetEmbedView from './WidgetEmbedView'
import { widgetEmbedNode, CAPTURE_KINDS } from '../../lib/notebookWidgets'
import { buildCapture } from '../../lib/sendToJournal'
import { resolveEmbedRender, etTodayIso, etDayOf } from '../../lib/widgetEmbedCore'
import { buildCalendarCapture, calendarCaptureSettings } from '../../../charts/widgets/captures/calendarCapture'
import { kickSnapshotWarm } from '../../lib/embedArchive'

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
  kickSnapshotWarm.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => { __resetNotebookFlags(); vi.unstubAllGlobals() })

/** Today's capture, built the way the slash insert builds it (slashCapture's payload -> widgetEmbedNode). */
function slashNode(day) {
  const payload = buildCalendarCapture({ date: day }, {
    econStars: 3, selectedSym: null, tbdOpen: false, settings: calendarCaptureSettings(null, 'dark'),
  })
  expect(CAPTURE_KINDS.some((k) => k.id === 'calendar')).toBe(true)
  return widgetEmbedNode('calendar', payload)
}
/** The same day, built the way /charts Send to Journal builds it (CalendarWidget -> sendCaptureToJournal). */
function sendNodeAttrs(day) {
  return buildCapture('calendar', buildCalendarCapture({ date: day }, {
    econStars: 3, selectedSym: null, tbdOpen: false, settings: calendarCaptureSettings(null, 'dark'),
  }))
}
const strip = ({ embedId, capturedAt, ...rest }) => rest

describe('a /calendar capture of today renders the day, not the placeholder', () => {
  it('the slash node and the Send to Journal node are the same node, and both resolve live today', () => {
    const today = etTodayIso()
    const slash = slashNode(today).attrs
    const sent = sendNodeAttrs(today)
    expect(strip(slash)).toEqual(strip(sent))                     // Task 16: inserted node == Send-to-Journal node
    expect(etDayOf(slash.capturedAt)).toBe(today)
    for (const attrs of [slash, sent]) {
      expect(resolveEmbedRender(attrs)).toEqual({ kind: 'live', reason: 'captured-today-archiving' })
    }
  })

  it('the embed mounts the calendar rows and never shows the placeholder sentence', async () => {
    const { attrs } = slashNode(etTodayIso())
    const { container } = render(
      <WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />,
    )
    const rows = await screen.findByTestId('calendar-embed-rows')
    expect(rows.textContent).toContain(`NVDA reports before the open on ${etTodayIso()}`)
    expect(container.textContent).not.toContain('snapshot image not captured yet')
    expect(container.textContent).not.toMatch(/\[calendar: \d{4}-\d{2}-\d{2}\]/)
  })

  it('the self-archive runs for it, so the day is frozen into an image while it is still today', async () => {
    const { attrs } = slashNode(etTodayIso())
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('calendar-embed-rows')
    await waitFor(() => expect(kickSnapshotWarm).toHaveBeenCalled())
  })
})

describe('the G-063 fail-safe is unchanged', () => {
  it('a day later with no archive, the same node is a placeholder again (never later truth)', () => {
    const { attrs } = slashNode('2026-10-21')
    const captured = { ...attrs, capturedAt: '2026-10-21T14:00:00Z' }
    expect(resolveEmbedRender(captured, { today: '2026-10-21' }).kind).toBe('live')
    expect(resolveEmbedRender(captured, { today: '2026-10-22' }))
      .toEqual({ kind: 'placeholder', reason: 'captured-before-outcome' })
  })

  it('once archived, the image wins on the same day and every day after', () => {
    const { attrs } = slashNode('2026-10-21')
    const archived = { ...attrs, capturedAt: '2026-10-21T14:00:00Z', fallback: { url: '/a.png', w: 1, h: 1 } }
    for (const today of ['2026-10-21', '2026-10-30']) {
      expect(resolveEmbedRender(archived, { today })).toEqual({ kind: 'image', reason: 'captured-before-outcome' })
    }
  })

  it('a capture of a FUTURE day viewed on its capture day shows the expectation; later, never the result', () => {
    const attrs = { ...slashNode('2026-10-23').attrs, capturedAt: '2026-10-21T14:00:00Z' }
    expect(resolveEmbedRender(attrs, { today: '2026-10-21' }).kind).toBe('live')
    expect(resolveEmbedRender(attrs, { today: '2026-10-24' }).kind).toBe('placeholder')
  })
})
