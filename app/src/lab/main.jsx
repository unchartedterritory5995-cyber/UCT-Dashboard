// DEV-ONLY entry for the Study workbench (lab.html). One piece per page, chosen by ?piece=.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import '../index.css'
import { AuthProvider } from '../context/AuthContext'
import Lab from './Lab'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SWRConfig value={{ revalidateOnFocus: false }}>
        <AuthProvider>
          <Lab />
        </AuthProvider>
      </SWRConfig>
    </BrowserRouter>
  </StrictMode>,
)
