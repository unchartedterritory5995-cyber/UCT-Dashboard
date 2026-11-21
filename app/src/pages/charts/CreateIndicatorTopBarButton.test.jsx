// app/src/pages/charts/CreateIndicatorTopBarButton.test.jsx
//
// The top bar's door to Create Indicator: who sees it, what it is to a screen reader, and that a parent
// which renders again does not render it again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let mockAuth = {}
// (the component reads the account once per render, so the number of reads IS its number of renders)
let mockAuthReads = 0
vi.mock('../../context/AuthContext', () => ({ useAuth: () => { mockAuthReads += 1; return mockAuth } }))

const { default: CreateIndicatorTopBarButton, CREATE_INDICATOR_TOP_BAR_LABEL, CREATE_INDICATOR_TOP_BAR_HINT } = await import('./CreateIndicatorTopBarButton')
const { CREATE_INDICATOR_COHORT, CREATE_INDICATOR_FLAG_KEY } = await import('../../components/chart/builder/studio/createIndicatorFlag')

const MEMBER = { id: 7, role: 'user' }
const ADMIN = { id: 1, role: 'admin' }
const door = () => screen.queryByRole('button', { name: CREATE_INDICATOR_TOP_BAR_LABEL })

beforeEach(() => { mockAuth = {}; mockAuthReads = 0; try { window.localStorage.clear() } catch { /* no storage */ } })
afterEach(() => cleanup())

describe('the top bar door to Create Indicator', () => {
  it('a member released to Create Indicator sees a real, named button', () => {
    mockAuth = { user: MEMBER, cohorts: [CREATE_INDICATOR_COHORT] }
    render(<CreateIndicatorTopBarButton className="soft" onOpen={() => {}} />)
    const b = door()
    expect(b).not.toBeNull()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')                       // never a submit inside some form
    expect(b.className).toBe('soft')                                     // the top bar's own style, handed in
    expect(b.getAttribute('title')).toBe(CREATE_INDICATOR_TOP_BAR_HINT)
    expect(b.getAttribute('data-guide')).toBe('workspace.createIndicator')
    expect(b.textContent).toBe(CREATE_INDICATOR_TOP_BAR_LABEL)           // the icon adds no words to the name
  })

  it('an account that may not use Create Indicator sees NO control at all (never a dead button)', () => {
    for (const auth of [{ user: MEMBER, cohorts: [] }, { user: MEMBER, cohorts: ['something-else'] }, { user: MEMBER }, { user: null, cohorts: null }, {}, null]) {
      mockAuth = auth
      const { container, unmount } = render(<CreateIndicatorTopBarButton className="soft" onOpen={() => {}} />)
      expect(container.innerHTML, JSON.stringify(auth)).toBe('')
      unmount()
    }
  })

  it('an admin sees it through the same release, and a member can never grant it to themselves in the browser', () => {
    mockAuth = { user: ADMIN, cohorts: [CREATE_INDICATOR_COHORT] }
    const first = render(<CreateIndicatorTopBarButton onOpen={() => {}} />)
    expect(door()).not.toBeNull()
    first.unmount()
    // this browser's review flag is an ADMIN's key only
    window.localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
    mockAuth = { user: MEMBER, cohorts: [] }
    render(<CreateIndicatorTopBarButton onOpen={() => {}} />)
    expect(door()).toBeNull()
  })

  it('a press calls the handler once, by pointer and by keyboard', async () => {
    mockAuth = { user: MEMBER, cohorts: [CREATE_INDICATOR_COHORT] }
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<CreateIndicatorTopBarButton onOpen={onOpen} />)
    await user.click(door())
    expect(onOpen).toHaveBeenCalledTimes(1)
    door().focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  it('a parent that renders again with the same props does not render the button again', () => {
    mockAuth = { user: MEMBER, cohorts: [CREATE_INDICATOR_COHORT] }
    const onOpen = () => {}
    const Parent = ({ tick }) => <div data-tick={tick}><CreateIndicatorTopBarButton className="soft" onOpen={onOpen} /></div>
    const { rerender, container } = render(<Parent tick={0} />)
    expect(mockAuthReads).toBe(1)
    for (let i = 1; i <= 5; i += 1) rerender(<Parent tick={i} />)      // what a chart switch would look like, if the parent rendered
    expect(container.firstChild.getAttribute('data-tick')).toBe('5')    // (the parent really did render five more times)
    expect(mockAuthReads).toBe(1)
    expect(door()).not.toBeNull()
    // CONTROL: a prop that really changes does render it again, so the count above can move
    rerender(<div data-tick="6"><CreateIndicatorTopBarButton className="other" onOpen={onOpen} /></div>)
    expect(mockAuthReads).toBe(2)
  })
})
