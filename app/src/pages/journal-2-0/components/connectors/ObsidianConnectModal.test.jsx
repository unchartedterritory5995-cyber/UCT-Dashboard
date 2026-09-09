import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import ObsidianConnectModal from './ObsidianConnectModal'

describe('ObsidianConnectModal', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call mintConnectCode on open — only the explicit Generate click fires it', async () => {
    const mintConnectCode = vi.fn()
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />)
    await screen.findByRole('dialog')
    await new Promise((r) => setTimeout(r, 10))
    expect(mintConnectCode).not.toHaveBeenCalled()
  })

  it('is honest about what leaves the machine: markdown text yes, vault attachments no, never written back', async () => {
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={vi.fn()} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/markdown text of your notes/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/does not upload attachments or images/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/nothing is ever written back/i)).toBeInTheDocument()
  })

  it('Generate code stays disabled until the consent checkbox is checked, and fires no request until then', async () => {
    const mintConnectCode = vi.fn()
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    const generateBtn = within(dialog).getByRole('button', { name: /generate code/i })
    expect(generateBtn).toBeDisabled()
    fireEvent.click(generateBtn)
    await new Promise((r) => setTimeout(r, 10))
    expect(mintConnectCode).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(generateBtn).not.toBeDisabled()
  })

  it('puts the freshly minted code on the clipboard without a second click', async () => {
    // The only thing a member does next with this code is paste it into
    // Obsidian, so requiring a separate "Copy" press was UCT-created
    // friction. Minting happens inside the button's own click handler, so
    // the Clipboard API still has the user gesture it requires.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const mintConnectCode = vi.fn().mockResolvedValue({
      connectCode: 'CERT-CODE-123', expiresInSeconds: 900 })

    render(<ObsidianConnectModal open providerLabel="Obsidian"
      mintConnectCode={mintConnectCode} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /generate code/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('CERT-CODE-123'))
    expect(await screen.findByText(/copied to your clipboard/i)).toBeInTheDocument()
  })

  it('still shows the code when the clipboard is unavailable', async () => {
    // Best-effort only: a denied clipboard must never cost the member the
    // code itself, nor the explicit Copy fallback.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const mintConnectCode = vi.fn().mockResolvedValue({
      connectCode: 'CERT-CODE-456', expiresInSeconds: 900 })

    render(<ObsidianConnectModal open providerLabel="Obsidian"
      mintConnectCode={mintConnectCode} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /generate code/i }))

    expect(await screen.findByText('CERT-CODE-456')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy connect code/i })).toBeInTheDocument()
  })

  it('checking consent then Generate code mints once, via the "obsidian" provider key, and shows the code exactly once', async () => {
    const mintConnectCode = vi.fn().mockResolvedValue({ connectCode: 'CODE-XYZ-789', expiresInSeconds: 900 })
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))

    expect(await screen.findByTestId('obsidian-connect-code')).toHaveTextContent('CODE-XYZ-789')
    expect(mintConnectCode).toHaveBeenCalledTimes(1)
    expect(mintConnectCode).toHaveBeenCalledWith('obsidian')
    expect(screen.getByText(/expires in 15 minutes/i)).toBeInTheDocument()
    // Phase 1 controls are gone — the code fully replaces the consent form.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('re-rendering with the same open modal never re-mints or clears the shown code', async () => {
    const mintConnectCode = vi.fn().mockResolvedValue({ connectCode: 'STABLE-CODE-1', expiresInSeconds: 900 })
    const { rerender } = render(
      <ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))
    await screen.findByTestId('obsidian-connect-code')
    expect(mintConnectCode).toHaveBeenCalledTimes(1)

    rerender(
      <ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />
    )

    expect(screen.getByTestId('obsidian-connect-code')).toHaveTextContent('STABLE-CODE-1')
    expect(mintConnectCode).toHaveBeenCalledTimes(1)
  })

  it('closing and reopening starts a fresh phase 1 — a prior code never leaks into a new open', async () => {
    const mintConnectCode = vi.fn().mockResolvedValue({ connectCode: 'ONE-TIME-CODE', expiresInSeconds: 900 })
    const { rerender } = render(
      <ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))
    await screen.findByTestId('obsidian-connect-code')

    rerender(
      <ObsidianConnectModal open={false} providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />
    )
    rerender(
      <ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />
    )

    expect(screen.queryByTestId('obsidian-connect-code')).not.toBeInTheDocument()
    expect(await screen.findByRole('checkbox')).not.toBeChecked()
  })

  it('copy button writes the exact code to the clipboard', async () => {
    const mintConnectCode = vi.fn().mockResolvedValue({ connectCode: 'COPY-ME-42', expiresInSeconds: 900 })
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))
    await screen.findByTestId('obsidian-connect-code')

    fireEvent.click(screen.getByRole('button', { name: /copy connect code/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('COPY-ME-42')
    })
    expect(await screen.findByText(/^copied$/i)).toBeInTheDocument()
  })

  it('a mint failure renders the error detail inline and stays in phase 1 (no fake code shown)', async () => {
    const mintConnectCode = vi.fn().mockRejectedValue({ detail: 'Obsidian is not configured on this server.' })
    render(<ObsidianConnectModal open providerLabel="Obsidian" mintConnectCode={mintConnectCode} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))

    expect(await screen.findByText('Obsidian is not configured on this server.')).toBeInTheDocument()
    expect(screen.queryByTestId('obsidian-connect-code')).not.toBeInTheDocument()
  })
})
