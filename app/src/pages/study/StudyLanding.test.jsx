/**
 * StudyLanding rails (docs/study/landing_redesign.md): the hero draws one
 * candle per Method station with the recommended one carrying the marker,
 * the decks name every track with its mastered count, taps open the track's
 * first unit, and the badges shelf reads the profile's badges.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import StudyLanding from './StudyLanding'
import { candles, trackShare } from './studyLandingChart'

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

  it("the home: a level from the member's own XP with its tier, the streak, and today as the one big button", () => {
    const onStartToday = vi.fn()
    const today = { session_id: 's', items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }], answered_item_ids: ['i1'] }
    render(<StudyLanding curricula={curricula} byId={byId} badges={[]} profile={{ xp: 3240, streak: 4, streak_best: 9 }} today={today} onStartToday={onStartToday} />)
    expect(screen.getByRole('heading', { name: 'Level 7' })).toBeTruthy()                 // 1 + 3240 // 500
    expect(screen.getByTestId('study-tier')).toHaveTextContent('Silver')
    expect(screen.getByText('260 XP')).toBeTruthy()                                         // 500 - 3240 % 500
    expect(screen.getByTestId('study-streak')).toHaveTextContent('4day streakbest 9')
    fireEvent.click(screen.getByTestId('study-start-today'))
    expect(onStartToday).toHaveBeenCalled()
    expect(screen.getByTestId('study-start-today')).toHaveTextContent('Continue · 2 left')
  })

  it('the course path names every station with its mastered count, the recommended one marked', () => {
    render(<StudyLanding curricula={curricula} byId={byId} badges={[]} />)
    const stations = screen.getByRole('list', { name: 'The UCT Method stations' })
    // the recommended station is the first one started but not mastered: Scan (skill c, 2 reps)
    expect(within(stations).getByRole('button', { name: 'Regime, 1 of 2 mastered' })).toBeTruthy()
    expect(within(stations).getByRole('button', { name: 'Scan, 0 of 1 mastered, recommended' })).toBeTruthy()
    expect(within(stations).getByText('Start here')).toBeTruthy()
    const found = screen.getByRole('list', { name: 'Foundations tracks' })
    expect(within(found).getByRole('button', { name: 'Chart reading, 0 of 0 mastered' })).toBeTruthy()
    expect(screen.getByText('Your first trophy comes with your first set.')).toBeTruthy()
  })

  it("a station opens the track's first unit; an empty track opens the curriculum; a game card opens its game", () => {
    const onOpenUnit = vi.fn()
    const onOpenTrail = vi.fn()
    const onOpenChallenge = vi.fn()
    render(<StudyLanding curricula={curricula} byId={byId} badges={[]} onOpenUnit={onOpenUnit} onOpenTrail={onOpenTrail} onOpenChallenge={onOpenChallenge} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan, 0 of 1 mastered, recommended' }))
    expect(onOpenUnit).toHaveBeenCalledWith('S1', 'method')
    fireEvent.click(screen.getByTestId('station-SET'))
    expect(onOpenUnit).toHaveBeenCalledWith('T1', 'method')
    fireEvent.click(screen.getByRole('button', { name: 'Chart reading, 0 of 0 mastered' }))
    expect(onOpenTrail).toHaveBeenCalledWith('foundations')
    fireEvent.click(screen.getByTestId('game-hard'))
    expect(onOpenChallenge).toHaveBeenCalledWith('hard')
  })

  it('the trophy shelf: the earned lit, every other trophy locked with how to earn it', () => {
    render(<StudyLanding curricula={curricula} byId={byId} badges={[{ badge_id: 'first_set', earned_at: '2026-10-20T13:00:00Z' }]} />)
    expect(screen.getByTestId('trophy-first_set')).toHaveAttribute('data-earned', '1')
    // the rest of the catalog sits locked, with how to earn each
    expect(screen.getByTestId('trophy-streak_7')).toHaveAttribute('data-earned', '0')
    expect(screen.getByTestId('trophy-streak_7')).toHaveTextContent('Study seven days in a row')
    expect(screen.queryByText('Your first trophy comes with your first set.')).toBeNull()
  })
})
