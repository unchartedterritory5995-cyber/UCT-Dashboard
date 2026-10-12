import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JournalStylesCard from './JournalStylesCard'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

const show = () => render(<MemoryRouter><JournalStylesCard /></MemoryRouter>)

describe('Settings > Journal styles card', () => {
  beforeEach(() => __resetNotebookFlags())

  it('links to the Styles manager while the switch is on', () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    show()
    expect(screen.getByRole('link', { name: 'Open journal styles' })).toHaveAttribute('href', '/journal/notebook?styles=1')
  })

  it('renders nothing while the switch is off', () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    const { container } = show()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the server never said (the dark default)', () => {
    const { container } = show()
    expect(container).toBeEmptyDOMElement()
  })
})
