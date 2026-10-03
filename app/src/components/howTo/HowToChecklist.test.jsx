import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AuthContext } from '../../context/AuthContext'
import HowToChecklist from './HowToChecklist'
import {
  HOW_TO_CHECKLISTS, HOW_TO_STATUSES, HOW_TO_DRAFT, HOW_TO_APPROVED,
  approvedChecklist, DEPTH_HOW_TO_SURFACES,
} from './howToChecklists'
import { RESEARCH_DEPTH_KEYS } from '../../pages/research/depth/researchDepthFlags'
import DepthTab from '../../pages/research/depth/DepthTab'

// FT-046: the mechanism ships; the copy waits for the owner's voice.

const APPROVED = {
  'x.surface': {
    title: 'X: how to trade with this', status: HOW_TO_APPROVED,
    approved_by: 'owner', approved_on: '2026-10-03', steps: ['one', 'two'],
  },
}

function withAuth(value, ui) {
  return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>)
}

describe('the registry', () => {
  test('every entry has a known status, a title and string steps', () => {
    for (const [k, e] of Object.entries(HOW_TO_CHECKLISTS)) {
      expect(HOW_TO_STATUSES, k).toContain(e.status)
      expect(typeof e.title, k).toBe('string')
      expect(e.steps.length, k).toBeGreaterThan(0)
      for (const s of e.steps) expect(typeof s, k).toBe('string')
    }
  })

  test('⛔ nothing ships approved: the copy has not had the owner\'s voice sign-off', () => {
    // When the owner approves an entry, this list is where it is recorded on purpose.
    const approved = Object.entries(HOW_TO_CHECKLISTS).filter(([, e]) => e.status !== HOW_TO_DRAFT).map(([k]) => k)
    expect(approved).toEqual([])
  })

  test('every Depth checklist names a real Depth panel key', () => {
    for (const k of Object.keys(DEPTH_HOW_TO_SURFACES)) expect(RESEARCH_DEPTH_KEYS).toContain(k)
  })
})

describe('approvedChecklist', () => {
  test('a draft is never returned', () => {
    for (const k of Object.keys(HOW_TO_CHECKLISTS)) expect(approvedChecklist(k)).toBeNull()
  })
  test('approved needs approved_by and an ISO approved_on', () => {
    expect(approvedChecklist('x.surface', APPROVED)).toEqual({ title: 'X: how to trade with this', steps: ['one', 'two'] })
    expect(approvedChecklist('x.surface', { 'x.surface': { ...APPROVED['x.surface'], approved_by: '' } })).toBeNull()
    expect(approvedChecklist('x.surface', { 'x.surface': { ...APPROVED['x.surface'], approved_on: 'soon' } })).toBeNull()
    expect(approvedChecklist('x.surface', { 'x.surface': { ...APPROVED['x.surface'], steps: [] } })).toBeNull()
  })
  test('an unknown surface is null', () => {
    expect(approvedChecklist('nope', APPROVED)).toBeNull()
  })
})

describe('HowToChecklist', () => {
  test('flag OFF: an approved entry renders nothing', () => {
    const { container } = withAuth({}, <HowToChecklist surface="x.surface" registry={APPROVED} />)
    expect(container.innerHTML).toBe('')
  })

  test('flag ON + DRAFT: renders nothing (the shipped state)', () => {
    const { container } = withAuth({ howToChecklistsEnabled: true }, <HowToChecklist surface="screener.stocks" />)
    expect(container.innerHTML).toBe('')
  })

  test('flag ON + APPROVED: a numbered list of the steps', () => {
    withAuth({ howToChecklistsEnabled: true }, <HowToChecklist surface="x.surface" registry={APPROVED} />)
    const box = screen.getByTestId('how-to-checklist')
    expect(box).toHaveAttribute('data-surface', 'x.surface')
    expect(box.querySelector('ol')).not.toBeNull()
    expect([...box.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two'])
  })

  test('only literal true is on', () => {
    const { container } = withAuth({ howToChecklistsEnabled: 'true' }, <HowToChecklist surface="x.surface" registry={APPROVED} />)
    expect(container.innerHTML).toBe('')
  })

  test('no AuthProvider reads as OFF, never throws', () => {
    const { container } = render(<HowToChecklist surface="x.surface" registry={APPROVED} />)
    expect(container.innerHTML).toBe('')
  })
})

test('Research > Depth with the flag ON shows no checklist while every entry is a draft', () => {
  withAuth({ howToChecklistsEnabled: true }, <DepthTab sym="" flags={{}} />)
  expect(screen.queryByTestId('how-to-checklist')).toBeNull()
})
