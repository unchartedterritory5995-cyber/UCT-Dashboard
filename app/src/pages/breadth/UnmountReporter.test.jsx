/**
 * Both halves of the reporter, watched firing.
 *
 * The StrictMode half is the one that would otherwise be a comment nobody has
 * checked: it never runs in production, so if it were wrong the only symptom
 * would be a shared `?date=` link quietly behaving differently in dev than on
 * the site. So it is rendered under a real `<StrictMode>` here, beside a control
 * render that is NOT in StrictMode — a fixture that could not tell the two
 * apart would prove nothing about either.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import UnmountReporter from './UnmountReporter'

const Child = () => <div data-testid="child" />

describe('UnmountReporter', () => {
  it('says nothing while it stays mounted', () => {
    const onUnmount = vi.fn()
    const { getByTestId, rerender } = render(
      <UnmountReporter onUnmount={onUnmount}><Child /></UnmountReporter>)
    rerender(<UnmountReporter onUnmount={onUnmount}><Child /></UnmountReporter>)
    expect(getByTestId('child')).toBeTruthy()
    expect(onUnmount).not.toHaveBeenCalled()
  })

  it('reports the unmount exactly once, whatever removed it', () => {
    const onUnmount = vi.fn()
    const { unmount } = render(
      <UnmountReporter onUnmount={onUnmount}><Child /></UnmountReporter>)
    unmount()
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })

  // The reason it wraps the child instead of sitting beside it: the condition
  // that removed the subtree is not something the reporter has to know.
  it('reports a conditional parent removing the subtree', () => {
    const onUnmount = vi.fn()
    const Page = ({ show }) => (show
      ? <UnmountReporter onUnmount={onUnmount}><Child /></UnmountReporter>
      : <div data-testid="gone" />)
    const { rerender, getByTestId } = render(<Page show />)
    rerender(<Page show={false} />)
    expect(getByTestId('gone')).toBeTruthy()
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })

  /**
   * 🔴 STRICTMODE RUNS setup → cleanup → setup ON ONE INSTANCE. Taken at face
   * value that cleanup is an unmount that never happened, and `pages/Breadth.jsx`
   * would spend a shared link on the first mount in dev.
   */
  it('takes back a report StrictMode made about a mount that did not end', () => {
    const onUnmount = vi.fn()
    const onReattached = vi.fn()
    const { getByTestId } = render(
      <StrictMode>
        <UnmountReporter onUnmount={onUnmount} onReattached={onReattached}>
          <Child />
        </UnmountReporter>
      </StrictMode>)
    expect(getByTestId('child')).toBeTruthy()
    // The report IS made — the reporter cannot know at cleanup time — and then
    // withdrawn by the re-setup of the same instance.
    expect(onUnmount).toHaveBeenCalledTimes(1)
    expect(onReattached, 'the double-invoke was not observed — this fixture '
      + 'proves nothing about StrictMode').toHaveBeenCalledTimes(1)
  })

  it('CONTROL: outside StrictMode nothing is withdrawn', () => {
    const onUnmount = vi.fn()
    const onReattached = vi.fn()
    render(
      <UnmountReporter onUnmount={onUnmount} onReattached={onReattached}>
        <Child />
      </UnmountReporter>)
    expect(onUnmount).not.toHaveBeenCalled()
    expect(onReattached).not.toHaveBeenCalled()
  })

  it('a GENUINE remount is a fresh instance, so nothing is withdrawn', () => {
    // The withdrawal is scoped to the instance that reported. A new mount after
    // a real unmount must leave the report standing, or the link would come
    // back to life on exactly the remount it exists to protect.
    const onUnmount = vi.fn()
    const onReattached = vi.fn()
    const Page = ({ show }) => (show
      ? <UnmountReporter onUnmount={onUnmount} onReattached={onReattached}><Child /></UnmountReporter>
      : null)
    const { rerender } = render(<Page show />)
    rerender(<Page show={false} />)
    rerender(<Page show />)
    expect(onUnmount).toHaveBeenCalledTimes(1)
    expect(onReattached).not.toHaveBeenCalled()
  })
})
