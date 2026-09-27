import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportGuide from './ExportGuide'
import { R18_TOOLS } from '../../../lib/importer/census'

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

  // Wave 10 (R-18): the guide renders the import census, so every tool on the
  // ruling's list has a tab a member can open -- named, not counted.
  it('offers a tab for every tool on the R-18 list, in its order', () => {
    render(<ExportGuide />)
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim())).toEqual(R18_TOOLS)
  })

  it('gives Google Keep its Takeout path and says the trash is skipped', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Google Keep' }))
    expect(screen.getByText(/takeout\.google\.com/)).toBeInTheDocument()
    expect(screen.getByText(/trash — we skip those and tell you how many/)).toBeInTheDocument()
  })

  it('names the exact Word export for OneNote, and what Word does not carry', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'OneNote' }))
    expect(screen.getByText(/File → Export → choose Page or Section → Word Document \(\*\.docx\)/)).toBeInTheDocument()
    expect(screen.getByText(/attached files and links between OneNote pages don't survive/)).toBeInTheDocument()
  })

  it('is collapsed by default — no platform detail shown until one is picked', () => {
    render(<ExportGuide />)
    expect(screen.queryByText(/Settings/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/right-click/i)).not.toBeInTheDocument()
  })
})
