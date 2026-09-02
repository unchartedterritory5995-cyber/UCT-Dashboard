import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportGuide from './ExportGuide'

describe('ExportGuide', () => {
  it('gives a real click-path for Notion, not a vague pointer', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /notion/i }))
    // The value is the SPECIFIC path. A guide that says "export your notes"
    // helps nobody — the member is already trying to do that.
    expect(screen.getByText(/Settings/i)).toBeInTheDocument()
    expect(screen.getByText(/Markdown/i)).toBeInTheDocument()
  })

  it('warns where Notion will bite them', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /notion/i }))
    // Notion mails the export as a link and splits large workspaces into
    // multiple zips — a member who imports only the first silently loses
    // notes and blames us.
    expect(screen.getByText(/email|multiple|parts?/i)).toBeInTheDocument()
  })

  it('gives a real click-path for Evernote, including the desktop-only + per-notebook gotcha', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /evernote/i }))
    expect(screen.getByText(/right-click/i)).toBeInTheDocument()
    expect(screen.getAllByText(/enex/i).length).toBeGreaterThan(0)
    // Evernote exports one notebook at a time — many notebooks, many files.
    // "notebook" appears both in the click-path and in the gotcha, on purpose.
    expect(screen.getAllByText(/notebook/i).length).toBeGreaterThanOrEqual(2)
  })

  it('tells the Obsidian member there is no export step at all — the genuinely good news', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /obsidian/i }))
    expect(screen.getByText(/no export step/i)).toBeInTheDocument()
    expect(screen.getAllByText(/folder/i).length).toBeGreaterThan(0)
  })

  it('covers all three platforms we name on the empty state', () => {
    render(<ExportGuide />)
    for (const p of [/notion/i, /obsidian/i, /evernote/i]) {
      expect(screen.getByRole('button', { name: p })).toBeInTheDocument()
    }
  })

  it('is collapsed by default — no platform detail shown until one is picked', () => {
    render(<ExportGuide />)
    expect(screen.queryByText(/Settings/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/right-click/i)).not.toBeInTheDocument()
  })
})
