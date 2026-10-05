import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// `?section=depth&panel=<flag key>` (the /terminal EVTS / FTD / … "Full page" link) lands on
// that panel: it renders FIRST, highlighted, and is scrolled to. Panels are stubbed so this is
// a unit test of the container's ordering, not of each panel's fetch.
vi.mock('./EarningsReactionPanel', () => ({ default: () => <div>earnings-reaction</div> }))
vi.mock('./EventsPanel', () => ({ default: () => <div>events</div> }))
vi.mock('./BrokerEstimatesPanel', () => ({ default: () => <div>broker-estimates</div> }))
vi.mock('./FtdPanel', () => ({ default: () => <div>ftd</div> }))
vi.mock('./MentionSeriesPanel', () => ({ default: () => <div>mentions</div> }))
vi.mock('./FilingSearchPanel', () => ({ default: () => <div>filing-search</div> }))
vi.mock('./NewsDeskPanel', () => ({ default: () => null }))
vi.mock('./CallReplayPanel', () => ({ default: () => null }))
vi.mock('../../../components/howTo/HowToChecklist', () => ({ default: () => null }))

import DepthTab, { DEPTH_PANELS } from './DepthTab'
import { RESEARCH_DEPTH_KEYS } from './researchDepthFlags'

const ALL_ON = Object.fromEntries(RESEARCH_DEPTH_KEYS.map((k) => [k, true]))
const order = () => [...document.querySelectorAll('[data-depth-panel]')].map((n) => n.getAttribute('data-depth-panel'))

describe('DepthTab -- focus a panel from ?panel=', () => {
  it('anchors exactly the published Depth keys (one vocabulary with the flags)', () => {
    expect(DEPTH_PANELS.map(([k]) => k).sort()).toEqual([...RESEARCH_DEPTH_KEYS].sort())
  })

  it('without focus, keeps the original order and highlights nothing', () => {
    render(<DepthTab sym="NVDA" flags={ALL_ON} />)
    expect(order()).toEqual(DEPTH_PANELS.map(([k]) => k))
    expect(document.querySelector('[data-focused]')).toBe(null)
  })

  it('a focused panel leads, is highlighted, and is scrolled to', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    render(<DepthTab sym="NVDA" flags={ALL_ON} focus="ftd_dataset_enabled" />)
    expect(order()[0]).toBe('ftd_dataset_enabled')
    expect(order()).toHaveLength(DEPTH_PANELS.length)   // nothing dropped or duplicated
    expect(screen.getByText('ftd').closest('[data-depth-panel]')).toHaveAttribute('data-focused', 'true')
    expect(spy).toHaveBeenCalledTimes(1)
    delete Element.prototype.scrollIntoView
  })

  it('a focus whose panel is OFF (or unknown) changes nothing -- it never shows a dark panel', () => {
    render(<DepthTab sym="NVDA" flags={{ events_timeline_enabled: true }} focus="ftd_dataset_enabled" />)
    expect(order()).toEqual(['events_timeline_enabled'])
    expect(screen.queryByText('ftd')).not.toBeInTheDocument()
    expect(document.querySelector('[data-focused]')).toBe(null)
  })
})
