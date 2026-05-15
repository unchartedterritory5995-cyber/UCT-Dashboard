import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TraderProfileEditor from './TraderProfileEditor'

describe('TraderProfileEditor', () => {
  it('renders the profile in read mode by default', () => {
    render(<TraderProfileEditor profile="# Test\n\nBody" onSave={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/Test/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })

  it('clicking Edit opens textarea; Save calls onSave with new value', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<TraderProfileEditor profile="# Test" onSave={onSave} onClear={() => {}} />)
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const ta = screen.getByRole('textbox', { name: /profile/i })
    await user.clear(ta)
    await user.type(ta, '# New')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('# New')
  })

  it('Clear button confirms then calls onClear', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('confirm', () => true)
    render(<TraderProfileEditor profile="# Test" onSave={() => {}} onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('no import picker when importSources is absent (per-account mode)', () => {
    render(<TraderProfileEditor profile="# Test" onSave={() => {}} onClear={() => {}} />)
    expect(
      screen.queryByRole('combobox', { name: /import profile from account/i }),
    ).not.toBeInTheDocument()
  })

  it('unified mode: selecting an account and clicking Import calls onImport', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn().mockResolvedValue(undefined)
    render(
      <TraderProfileEditor
        profile=""
        onSave={() => {}}
        onClear={() => {}}
        importSources={[{ id: 'a1', name: 'Default' }, { id: 'a2', name: 'Cash' }]}
        onImport={onImport}
      />,
    )
    const sel = screen.getByRole('combobox', { name: /import profile from account/i })
    await user.selectOptions(sel, 'a2')
    await user.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onImport).toHaveBeenCalledWith('a2')
  })

  it('Import button disabled until an account is chosen', () => {
    render(
      <TraderProfileEditor
        profile=""
        onSave={() => {}}
        onClear={() => {}}
        importSources={[{ id: 'a1', name: 'Default' }]}
        onImport={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled()
  })
})
