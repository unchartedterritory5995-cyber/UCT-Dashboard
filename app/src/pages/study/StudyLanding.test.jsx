/**
 * StudyLanding rails (docs/study/landing_redesign.md): the hero draws one
 * candle per Method station with the recommended one carrying the marker,
 * the decks name every track with its mastered count, taps open the track's
 * first unit, and the badges shelf reads the profile's badges.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import StudyLanding from './StudyLanding'
import { candles, trackShare, TAGLINE } from './studyLandingChart'

const unit = (id, skills) => ({ id, title: `Unit ${id}`, skills })
const curricula = [
  { id: 'method', title: 'The UCT Method', tracks: [
    { id: 'REG', title: 'Regime', units: [unit('R1', ['a']), unit('R2', ['b'])] },
    { id: 'SCN', title: 'Scan', units: [unit('S1', ['c'])] },
    { id: 'SET', title: 'Setup', units: [unit('T1', ['d'])] },
  ] },
  { id: 'foundations', title: 'UCT Foundations', tracks: [
    { id: 'F1', title: 'Market basics', units: [unit('F1.01', ['e'])] },
    { id: 'F2', title: 'Chart reading', units: [] },
  ] },
]
// a = mastered, b = untouched, c = started, d/e untouched
const byId = { a: { skill_id: 'a', mastery: 90, reps: 10 }, c: { skill_id: 'c', mastery: 30, reps: 2 } }

describe('StudyLanding', () => {
  it('draws one candle per station, scaled by mastered share, with the marker on the recommended station', () => {
    const cs = candles(curricula[0].tracks, byId, 'REG')
    expect(cs.map((c) => c.title)).toEqual(['Regime', 'Scan', 'Setup'])
    expect(cs[0].share).toBe(0.5)
    expect(cs[0].state).toBe('started')
    expect(cs[1].state).toBe('open')                      // started skill, no unit mastered
    expect(cs[0].top).toBeLessThan(cs[1].top)             // taller body = more mastered
    expect(cs[0].wickTop).toBeLessThan(cs[1].wickTop)     // taller wick = a bigger station (2 units vs 1)
    expect(cs[0].wickTop).toBeLessThanOrEqual(cs[0].top)  // the body never leaves its wick
    expect(cs[0].recommended).toBe(true)
    expect(trackShare(curricula[1].tracks[1], byId)).toBe(0)
  })

  it('renders the hero, the decks with mastered counts, and the empty badges line', () => {
    render(<StudyLanding curricula={curricula} byId={byId} badges={[]} />)
    expect(screen.getByRole('heading', { name: 'Your trail is a chart.' })).toBeTruthy()
    expect(screen.getByText(TAGLINE)).toBeTruthy()
    const stations = screen.getByRole('list', { name: 'The UCT Method stations' })
    // the recommended station is the first one started but not mastered: Scan (skill c, 2 reps)
    expect(within(stations).getByRole('button', { name: 'Regime, 1 of 2 mastered' })).toBeTruthy()
    expect(within(stations).getByRole('button', { name: 'Scan, 0 of 1 mastered, recommended' })).toBeTruthy()
    const found = screen.getByRole('list', { name: 'Foundations tracks' })
    expect(within(found).getByRole('button', { name: 'Chart reading, 0 of 0 mastered' })).toBeTruthy()
    expect(screen.getByText('Your first badge comes with your first set.')).toBeTruthy()
    expect(screen.getByRole('figure', { name: 'Your trail, drawn as a chart' })).toBeTruthy()
  })

  it('a station tile and a chart hotspot open the track\'s first unit; an empty track opens the curriculum', () => {
    const onOpenUnit = vi.fn()
    const onOpenTrail = vi.fn()
    render(<StudyLanding curricula={curricula} byId={byId} badges={[]} onOpenUnit={onOpenUnit} onOpenTrail={onOpenTrail} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan, 0 of 1 mastered, recommended' }))
    expect(onOpenUnit).toHaveBeenCalledWith('S1', 'method')
    fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }))
    expect(onOpenUnit).toHaveBeenCalledWith('T1', 'method')
    fireEvent.click(screen.getByRole('button', { name: 'Chart reading, 0 of 0 mastered' }))
    expect(onOpenTrail).toHaveBeenCalledWith('foundations')
  })

  it('lists earned badges by name', () => {
    render(<StudyLanding curricula={curricula} byId={byId} badges={[{ badge_id: 'first_set', earned_at: '2026-10-20T13:00:00Z' }]} />)
    expect(screen.getByText('first set')).toBeTruthy()
    expect(screen.queryByText('Your first badge comes with your first set.')).toBeNull()
  })
})
