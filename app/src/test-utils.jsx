/**
 * Shared test utilities for component tests.
 *
 * Provides renderWithProviders — wraps the render call with AuthProvider,
 * VoiceProvider, and MemoryRouter so components that consume those
 * contexts can render without throwing.
 */
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { VoiceProvider } from './context/VoiceContext'

export function renderWithProviders(ui, { route = '/', ...renderOptions } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <VoiceProvider>
          {ui}
        </VoiceProvider>
      </AuthProvider>
    </MemoryRouter>,
    renderOptions,
  )
}

// Re-export everything from testing-library so test files can import both
// from one place: `import { renderWithProviders, screen } from '../test-utils'`
export * from '@testing-library/react'
