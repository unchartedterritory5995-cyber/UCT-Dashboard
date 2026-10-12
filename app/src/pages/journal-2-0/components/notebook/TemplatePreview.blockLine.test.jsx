import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import TemplatePreview from './TemplatePreview'

// Notebook P1 round 2 (review I1 + I2): TemplatePreview is in the Notebook's FIRST-OPEN closure and is shared
// by "Your templates" and the community gallery. It must render exactly what it rendered before P1: a
// widgetEmbed in a template's body draws nothing, and never a "block from a newer version" line. The lazy
// journal-styles picker names its own blocks (it swaps them for a line of text before handing the body over:
// styles/KindSection.test.jsx).
const BODY = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
  { type: 'widgetEmbed', attrs: { widgetId: 'news', params: { symbol: 'NVDA' } } },
  { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA', tf: 'D' } } },
  { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
] }

describe('TemplatePreview widgetEmbed (switch off, member templates, the gallery)', () => {
  it('draws nothing for a widget, and says nothing about versions', () => {
    render(<TemplatePreview open onClose={() => {}} title="T" body={BODY} onUse={() => {}} />)
    expect(screen.getByText('Before.')).toBeTruthy()
    expect(screen.getByText('After.')).toBeTruthy()
    const body = document.querySelector('[data-template-preview-body]')
    expect([...body.children].length).toBe(2)            // the two paragraphs, nothing for the two widgets
    expect(document.body.textContent).not.toMatch(/newer version|Chart|News/)
  })

  it('a template preview still says "Use this template"; a caller may name its own action', () => {
    const { unmount } = render(<TemplatePreview open onClose={() => {}} title="T" body={BODY} onUse={() => {}} />)
    expect(screen.getByRole('button', { name: 'Use this template' })).toBeTruthy()
    unmount()
    render(<TemplatePreview open onClose={() => {}} title="T" body={BODY} onUse={() => {}} useLabel="Use this style" />)
    expect(screen.getByRole('button', { name: 'Use this style' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this template' })).toBeNull()
  })

  it('the block catalog and any widget handling stay out of this file (it rides the first open)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'TemplatePreview.jsx'), 'utf8')
    expect(src).not.toMatch(/journalBlocks|blockLabel|widgetEmbed|previewLine/)
  })
})
