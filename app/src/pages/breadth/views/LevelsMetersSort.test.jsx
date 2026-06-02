// app/src/pages/breadth/views/LevelsMetersSort.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EqualizerView from './EqualizerView'
import MetersView from './MetersView'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null,
  getFmt: () => key, getTier: () => 'g1' })
const metrics = [mk('a'), mk('b'), mk('c')]
const currentRow = { date: 'd' }
const normalize = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

describe('Levels + Meters sort', () => {
  it('Levels value sort orders columns by value desc', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ sort: 'value' }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    // label text appears twice per column (value + name); take unique order of first occurrence
    const order = labels.filter((v, i) => labels.indexOf(v) === i)
    expect(order).toEqual(['b', 'c', 'a'])
  })

  it('Meters value sort orders rows by value desc', () => {
    render(<MetersView currentRow={currentRow} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ sort: 'value' }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    const order = labels.filter((v, i) => labels.indexOf(v) === i)
    expect(order).toEqual(['b', 'c', 'a'])
  })
})
