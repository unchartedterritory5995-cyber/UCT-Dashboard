import { render, screen } from '@testing-library/react'
import StickyActionBar from './StickyActionBar'

test('renders its children (e.g. the submit CTA)', () => {
  render(
    <StickyActionBar>
      <button>Save</button>
      <button>Cancel</button>
    </StickyActionBar>,
  )
  expect(screen.getByText('Save')).toBeInTheDocument()
  expect(screen.getByText('Cancel')).toBeInTheDocument()
})
