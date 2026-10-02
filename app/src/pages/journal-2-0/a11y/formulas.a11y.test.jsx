// app/src/pages/journal-2-0/a11y/formulas.a11y.test.jsx
//
// Wave 11, lane 11B: formula and rollup properties through 8A's axe harness (the ONE way a
// Notebook rail asks axe-core; frozen exclusions, ruling D-A5). The existing table and editor
// recipes run with NOTEBOOK_FORMULAS_ENABLED off, so they never render these components --
// hence their own recipes here rather than a `coveredBy` entry that would be untrue. Each
// recipe proves the state it is about rendered before axe runs, so an empty screen can never
// pass as a clean one.
import { describe, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeSurface } from './surface'
import FormulaEditor from '../components/notebook/FormulaEditor'
import RollupEditor from '../components/notebook/RollupEditor'
import NotesTableView from '../components/notebook/NotesTableView'

const DEFS = [
  { id: 'e1', name: 'Entry', type: 'number', source: 'user_set' },
  { id: 's1', name: 'Stop', type: 'number', source: 'user_set' },
  { id: 'x1', name: 'Exit', type: 'number', source: 'user_set' },
  { id: 'r1', name: 'R', type: 'formula', source: 'user_set', computed: true,
    config: { expression: '({@x1} - {@e1}) / ({@e1} - {@s1})' } },
  { id: 'wr', name: 'Win rate', type: 'rollup', source: 'user_set', computed: true, config: {} },
]

const NOTES = [
  { id: 'n1', title: 'Plan A', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {},
    computed: { r1: { value: 2.5, kind: 'formula', name: 'R' },
      wr: { value: 66.6667, aggregate: 'win_rate', kind: 'rollup', name: 'Win rate', setSize: 3, usedSize: 3 } } },
  { id: 'n2', title: 'Plan B', updatedAt: '2026-09-02T00:00:00Z', propertiesJson: {},
    computed: { r1: { value: null, reason: 'Division by zero', kind: 'formula', name: 'R' },
      wr: { value: 50, aggregate: 'win_rate', kind: 'rollup', name: 'Win rate', setSize: 1500, usedSize: 1000, capped: true } } },
]

function FormulaHarness() {
  const [text, setText] = useState('({@x1} - {@e1}) / ({@e1} - {@s1})')
  return <FormulaEditor value={text} onChange={setText} defs={DEFS} previewProps={{ e1: 100, s1: 95, x1: 110 }} />
}

function RollupHarness() {
  const [cfg, setCfg] = useState({ source: 'backlinks', aggregate: 'avg', propertyId: 'r1' })
  return <RollupEditor value={cfg} onChange={setCfg} defs={DEFS} savedViews={[]} selfId="wr" />
}

function tableProps() {
  return {
    notes: NOTES, propertyDefs: DEFS, sort: 'updated', onSortChange: vi.fn(), propertySort: null,
    onPropertySortChange: vi.fn(), onQuickFilter: vi.fn(), onOpenNote: vi.fn(),
    propertyFilter: null, onComputedFilter: vi.fn(),
  }
}

describe('lane 11B surfaces', () => {
  axeSurface('formula-editor', async () => {
    render(<FormulaHarness />)
    screen.getByRole('textbox', { name: 'Formula' })
    screen.getByRole('group', { name: 'Insert a property' })
  })

  axeSurface('rollup-editor', async () => {
    render(<RollupHarness />)
    screen.getByLabelText('Summarise')
    screen.getByLabelText('Calculate')
  })

  axeSurface('table-computed-columns', async () => {
    render(<NotesTableView {...tableProps()} />)
    screen.getByRole('button', { name: /^R/ })
    screen.getByText('2.5')
    screen.getByRole('button', { name: 'Filter R' })
  })

  axeSurface('computed-filter-dialog', async () => {
    const user = userEvent.setup()
    render(<NotesTableView {...tableProps()} />)
    await user.click(screen.getByRole('button', { name: 'Filter R' }))
    const dialog = screen.getByRole('dialog', { name: 'Filter R' })
    within(dialog).getAllByRole('button').length
  })
})
