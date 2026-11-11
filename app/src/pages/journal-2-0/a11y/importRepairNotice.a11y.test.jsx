// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/importRepairNotice.a11y.test.jsx
//
// Plan F Task 10: the one-time import-repair notice (components/notebook/ImportRepairNotice.jsx)
// through 8A's axe harness. The tab's own rails never show it (their fetch answers no notice), so
// it gets a recipe of its own, read after its heading and both buttons are proved to be there.
import { describe } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import ImportRepairNotice from '../components/notebook/ImportRepairNotice'

describe('the import-repair notice', () => {
  axeSurface('import-repair-notice', async () => {
    const { container } = render(
      <main>
        <ImportRepairNotice lossNotes={3} onRecover={() => {}} onDismiss={() => {}} />
      </main>,
    )
    screen.getByRole('region', { name: 'Some imported notes are missing pictures' })
    screen.getByRole('button', { name: 'Re-import to recover' })
    screen.getByRole('button', { name: 'Dismiss' })
    return { root: container }
  })
})
