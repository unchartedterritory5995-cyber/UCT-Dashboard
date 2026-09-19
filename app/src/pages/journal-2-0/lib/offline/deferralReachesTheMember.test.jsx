/**
 * ⛔⛔ THE DEFERRAL MUST REACH THE MEMBER — asserted by RENDERED TEXT.
 *
 * The standing rule (CLAUDE.md, owner ruling 2026-09-09): *"User-facing feedback
 * is asserted by rendered DOM text after the triggering action settles, never by
 * state alone."* It was written after two toast defects in this repo where every
 * structural assertion stayed green and **the only broken part was the half that
 * talks to the member** — once a wrong prop name (`message` where the component
 * reads `msg`), once a toast owned by the element its own action unmounts.
 *
 * ⚰️ `doorDefersWhileUnsent.test.js` asserts the door RETURNS
 * `STILL_SYNCING_MESSAGE`, and asserts things about that string. It renders
 * nothing. So nothing proved a member ever sees it — and on 2026-09-19 the rig
 * reported *"no deferral sentence on screen"* on four of five cells, which was
 * briefly taken as evidence the guard might be deferring silently.
 *
 * ⭐ It was the RIG: the product clears the toast at 2200 ms and the rig slept
 * 5000 ms before looking. But the rail gap was real, and this file closes it —
 * the sentence is now proved to reach the DOM, independently of any rig.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { useJournalToast, JournalToast } from '../useJournalToast'
import { STILL_SYNCING_MESSAGE } from './noteHasUnsentWork'

afterEach(cleanup)

/** The exact shape every capture widget uses: hook + toast, one element. */
function WidgetLike({ send }) {
  const [journalMsg, setJournalMsg] = useJournalToast()
  return (
    <div>
      <button type="button" onClick={async () => { setJournalMsg(await send()) }}>
        Send to Journal
      </button>
      <JournalToast msg={journalMsg} />
    </div>
  )
}

describe('the door guard\'s deferral reaches the member', () => {
  it('⭐ the deferral SENTENCE is rendered to the DOM, not merely returned', async () => {
    const send = vi.fn(async () => STILL_SYNCING_MESSAGE)
    render(<WidgetLike send={send} />)

    await act(async () => { screen.getByRole('button').click() })

    // ⛔ getByText, not a state assertion. This is the whole point of the file.
    expect(screen.getByText(STILL_SYNCING_MESSAGE)).toBeTruthy()
  })

  it('⛔ NON-VACUITY — the same harness shows NOTHING when the door does not defer', async () => {
    // Without this, a component that rendered the sentence unconditionally would
    // pass the test above and prove nothing.
    const send = vi.fn(async () => null)
    render(<WidgetLike send={send} />)

    await act(async () => { screen.getByRole('button').click() })

    expect(screen.queryByText(STILL_SYNCING_MESSAGE)).toBeNull()
  })

  it('the toast host OUTLIVES the click that fills it', async () => {
    // ⚰️ The 2026-09-09 defect: a toast owned by the branch its own action
    // unmounts rendered for ZERO frames. The host must still be in the document
    // after the action settles.
    const send = vi.fn(async () => STILL_SYNCING_MESSAGE)
    const { container } = render(<WidgetLike send={send} />)
    await act(async () => { screen.getByRole('button').click() })
    expect(container.isConnected).toBe(true)
    expect(screen.getByText(STILL_SYNCING_MESSAGE)).toBeTruthy()
  })

  it('⛔ the sentence is not empty — an empty toast is an invisible toast', () => {
    expect(STILL_SYNCING_MESSAGE.trim().length).toBeGreaterThan(10)
  })
})
