// The game registry (docs/study/GAMES.md): every game the Study home lists is the game its own file declares, opens in
// the challenge sheet, and lands in the right deck. The registry keeps a copy of each GAME meta so the home can list a
// game without loading its code; these tests are what stop that copy drifting from the file.
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChallengeSheet from './ChallengeSheet'
import { CHALLENGES, CHALLENGE_KINDS, GAME_LIST } from './registry'
import StudyLanding from '../StudyLanding'

const quiet = () => new Promise(() => {})       // a fetch that never answers: the game sits on its start or loading screen

describe('the game registry', () => {
  it('each listed game matches the GAME its own file exports', async () => {
    for (const { load, ...meta } of GAME_LIST) {
      const mod = await load()
      expect(mod.GAME, meta.kind).toEqual(meta)
      expect(typeof mod.default, meta.kind).toBe('function')
    }
  })

  it('every kind is unique, opens from a link, and names a deck, a plate and an accent', () => {
    const kinds = CHALLENGES.map((c) => c.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const g of GAME_LIST) {
      expect(CHALLENGE_KINDS.has(g.kind)).toBe(true)
      expect(['chart', 'skill']).toContain(g.group)
      expect(['amber', 'red', 'gold', 'green']).toContain(g.accent)
      expect(g.plate && g.title && g.sub && g.icon).toBeTruthy()
    }
  })

  it.each(GAME_LIST.map((g) => [g.kind]))('the %s sheet loads its game body', async (kind) => {
    render(<ChallengeSheet kind={kind} open onClose={vi.fn()} fetcher={vi.fn(quiet)} />)
    expect(screen.getByTestId(`challenge-${kind}`)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading the game.')).toBeNull())
  })

  it('the Study home lists the chart games under Challenges and the rest under Skill games', () => {
    render(<StudyLanding curricula={[]} byId={{}} badges={[]} onOpenChallenge={vi.fn()} />)
    const decks = { chart: screen.getByRole('list', { name: 'Challenges' }), skill: screen.getByRole('list', { name: 'Skill games' }) }
    for (const g of GAME_LIST) {
      const card = within(decks[g.group]).getByTestId(`game-${g.kind}`)
      expect(card).toHaveTextContent(g.plate)
      expect(within(decks[g.group === 'chart' ? 'skill' : 'chart']).queryByTestId(`game-${g.kind}`)).toBeNull()
    }
  })
})
