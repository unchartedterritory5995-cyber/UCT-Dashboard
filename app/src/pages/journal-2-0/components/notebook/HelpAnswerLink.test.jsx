// S14 (audit 2026-11-05, "answers in context"): each feature's "?" opens ITS Quick Answer. The rail holds every
// "?" in the Notebook to an answer that exists (Support.jsx FAQS is the one source), and the link to the address
// Support.jsx answers (`#answer-<id>`, railed in Support.notebook.test.jsx).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import HelpAnswerLink from './HelpAnswerLink'
import { FAQS } from '../../../Support'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (f.endsWith('.jsx') && !f.includes('.test.')) out.push(p)
  }
  return out
}

describe('HelpAnswerLink', () => {
  it('is a link named for what it answers, to that answer, in a NEW TAB so the feature is never left (review minor 11)', () => {
    render(<MemoryRouter><HelpAnswerLink faqId="notebook-import" topic="importing notes" /></MemoryRouter>)
    const a = screen.getByRole('link', { name: 'Help: importing notes (opens in a new tab)' })
    expect(a).toHaveAttribute('href', '/support#answer-notebook-import')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a.getAttribute('rel')).toMatch(/noopener/)
  })

  it('outside a router it is the same link', () => {
    render(<HelpAnswerLink faqId="notebook-ask" topic="Ask" />)
    expect(screen.getByRole('link', { name: 'Help: Ask (opens in a new tab)' })).toHaveAttribute('href', '/support#answer-notebook-ask')
  })

  it('every "?" in the Notebook names a Quick Answer that exists', () => {
    const ids = new Set(FAQS.map((f) => f.id))
    const used = []
    for (const file of walk(DIR)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/<HelpAnswerLink[^>]*faqId="([^"]+)"/g)) used.push([file, m[1]])
    }
    // non-vacuity: Ask, Import and Export carry one each
    expect(used.map(([, id]) => id).sort()).toEqual(expect.arrayContaining(['notebook-ask', 'notebook-export-formats', 'notebook-import']))
    for (const [file, id] of used) expect(ids.has(id), `${file}: ${id}`).toBe(true)
  })
})
