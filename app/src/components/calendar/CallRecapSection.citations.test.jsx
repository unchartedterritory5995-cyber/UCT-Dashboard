// app/src/components/calendar/CallRecapSection.citations.test.jsx
//
// TERM-044 / FB-A6-02 — every KEY POINT the server could anchor cites the
// transcript passage it came from; one it could not anchor says so; a recap
// written before anchors existed renders exactly as it always did.
//
// The anchored recap is RECORDED, not hand-typed: `__fixtures__/
// callRecapAnchored.json` is `call_recap_grounded.finish_from_message`'s real
// output for a recorded model response against the DIS transcript excerpt,
// and `tests/test_call_recap_bullet_anchors.py` fails if the two drift.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CallRecapSection from './CallRecapSection'
import { normalizeCallRecap } from '../research/callRecap'
import recorded from './__fixtures__/callRecapAnchored.json'

afterEach(cleanup)

const ANCHORED = recorded.recap

function keyPoints() {
  const label = screen.getByText('KEY POINTS')
  return label.nextElementSibling
}

describe('an anchored recap — each point cites its passage', () => {
  it('renders every bullet with the text the server stored, unchanged', () => {
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const items = within(keyPoints()).getAllByRole('listitem')
    expect(items).toHaveLength(ANCHORED.bullets.length)
    items.forEach((li, i) => expect(li).toHaveTextContent(ANCHORED.bullets[i]))
  })

  it('a verified point shows a closed citation toggle; the passage is not on screen yet', () => {
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const first = within(keyPoints()).getAllByRole('listitem')[0]
    const toggle = within(first).getByTestId('cited-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cited-passage')).toBeNull()
  })

  it('clicking the toggle reveals the exact transcript passage and who said it', async () => {
    const user = userEvent.setup()
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const first = within(keyPoints()).getAllByRole('listitem')[0]
    await user.click(within(first).getByTestId('cited-toggle'))
    const anchor = ANCHORED.bullet_anchors[0]
    expect(within(first).getByTestId('cited-passage').textContent).toBe(anchor.text)
    expect(within(first).getByTestId('cited-panel'))
      .toHaveTextContent(`From the call transcript · ${anchor.speaker}`)
    expect(within(first).getByTestId('cited-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('a second click closes it again', async () => {
    const user = userEvent.setup()
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const first = within(keyPoints()).getAllByRole('listitem')[0]
    await user.click(within(first).getByTestId('cited-toggle'))
    await user.click(within(first).getByTestId('cited-toggle'))
    expect(within(first).queryByTestId('cited-passage')).toBeNull()
  })

  it('"Show in full transcript" jumps to the cited turn when the surface can', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<CallRecapSection recap={ANCHORED} audio={null} onJumpToSegment={onJump} />)
    const first = within(keyPoints()).getAllByRole('listitem')[0]
    await user.click(within(first).getByTestId('cited-toggle'))
    await user.click(within(first).getByRole('button', { name: 'Show in full transcript' }))
    expect(onJump).toHaveBeenCalledWith(ANCHORED.bullet_anchors[0].segment)
  })

  it('a surface with no transcript to jump to still shows the passage, with no dead button', async () => {
    const user = userEvent.setup()
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const first = within(keyPoints()).getAllByRole('listitem')[0]
    await user.click(within(first).getByTestId('cited-toggle'))
    expect(within(first).getByTestId('cited-passage')).toBeTruthy()
    expect(within(first).queryByRole('button', { name: 'Show in full transcript' })).toBeNull()
  })

  it('a point whose passage could not be verified renders NO citation — it says so instead', () => {
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    const items = within(keyPoints()).getAllByRole('listitem')
    ANCHORED.bullet_anchors.forEach((a, i) => {
      if (a) {
        expect(within(items[i]).getByTestId('cited-toggle')).toBeTruthy()
        expect(within(items[i]).queryByText('citation unavailable')).toBeNull()
      } else {
        expect(within(items[i]).queryByTestId('cited-toggle')).toBeNull()
        expect(within(items[i]).getByText('citation unavailable')).toBeTruthy()
      }
    })
    // Non-vacuity: the recording has both kinds.
    expect(ANCHORED.bullet_anchors.filter(Boolean).length).toBeGreaterThan(0)
    expect(ANCHORED.bullet_anchors.filter((a) => !a).length).toBeGreaterThan(0)
  })

  it('the hallucinated point cites nothing — its invented words appear in no passage', async () => {
    const user = userEvent.setup()
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    for (const toggle of screen.getAllByTestId('cited-toggle')) await user.click(toggle)
    const passages = screen.getAllByTestId('cited-passage').map((p) => p.textContent)
    expect(passages).toHaveLength(ANCHORED.bullet_anchors.filter(Boolean).length)
    expect(passages.some((p) => p.includes('40%'))).toBe(false)
  })

  it('a keyword filter keeps each surviving point with ITS OWN citation', async () => {
    const user = userEvent.setup()
    render(<CallRecapSection recap={ANCHORED} audio={null} />)
    await user.type(screen.getByLabelText('Search recap'), 'reiterated')
    const items = within(keyPoints()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    await user.click(within(items[0]).getByTestId('cited-toggle'))
    const idx = ANCHORED.bullets.findIndex((b) => b.includes('reiterated'))
    expect(within(items[0]).getByTestId('cited-passage').textContent)
      .toBe(ANCHORED.bullet_anchors[idx].text)
  })
})

describe('a malformed anchor is no anchor', () => {
  it.each([
    ['start after end', { segment: 2, start: 50, end: 10, speaker: 'x', text: 'y' }],
    ['no text', { segment: 2, start: 0, end: 10, speaker: 'x', text: '' }],
    ['non-integer segment', { segment: '2', start: 0, end: 10, speaker: 'x', text: 'y' }],
    ['not an object', 'segment 2'],
  ])('%s -> uncited', (_label, bad) => {
    const recap = { headline: 'h', bullets: ['A point.'], bullet_anchors: [bad] }
    expect(normalizeCallRecap(recap).bullet_anchors).toEqual([null])
    render(<CallRecapSection recap={recap} audio={null} />)
    expect(screen.queryByTestId('cited-toggle')).toBeNull()
    expect(screen.getByText('citation unavailable')).toBeTruthy()
  })

  it('an empty bullet is dropped WITH its anchor, never shifting a citation onto its neighbour', () => {
    const a = { segment: 1, start: 0, end: 5, speaker: 'CEO', text: 'Hello' }
    const out = normalizeCallRecap({ headline: 'h', bullets: ['', 'Kept.'], bullet_anchors: [a, null] })
    expect(out.bullets).toEqual(['Kept.'])
    expect(out.bullet_anchors).toEqual([null])
  })
})

describe('a legacy recap (no anchors) renders exactly as it always did', () => {
  const LEGACY = {
    headline: 'Strong Q1 beat on all metrics',
    sentiment: 'positive',
    bullets: ['Revenue grew 22% YoY', 'Guidance raised by $0.10 EPS', 'Margins expanded 150bps'],
  }

  it('the KEY POINTS list is plain <li> text — the pre-TERM-044 markup, byte for byte', () => {
    render(<CallRecapSection recap={LEGACY} audio={null} />)
    expect(keyPoints().innerHTML).toBe(LEGACY.bullets.map((b) => `<li>${b}</li>`).join(''))
  })

  it('shows no citation toggle and no "citation unavailable" note anywhere', () => {
    render(<CallRecapSection recap={LEGACY} audio={null} />)
    expect(screen.queryByTestId('cited-toggle')).toBeNull()
    expect(screen.queryByTestId('cited-present')).toBeNull()
    expect(screen.queryByTestId('cited-unavailable')).toBeNull()
    expect(screen.queryByText('citation unavailable')).toBeNull()
  })

  it('the normalizer marks it legacy (null), distinct from "anchored, none verified" ([])', () => {
    expect(normalizeCallRecap(LEGACY).bullet_anchors).toBeNull()
    expect(normalizeCallRecap({ ...LEGACY, bullet_anchors: [null, null, null] }).bullet_anchors)
      .toEqual([null, null, null])
  })
})
