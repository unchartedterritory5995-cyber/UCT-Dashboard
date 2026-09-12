// GATE-I1 slice 2 — the before/after screenshot harness.
//
// Mounts the REAL AskAiTab (or its pre-fix copy, `?v=before`) against a SEEDED
// payload, so the owner's before/after pair is two photographs of the same
// component rather than a drawing of one. `window.fetch` is replaced outright:
// nothing here can reach /api/research/explain, a model, or any account.
//
// Run:  cd app && npx vite --port 5199
//       http://localhost:5199/tools/i1-shot/index.html?v=before|after
// Or:   python tools/i1_askai_shots.py   (from the repo root — drives both)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { FIXTURE_ANSWER } from './fixture'
import AskAiTabAfter from '../../src/pages/research/tabs/AskAiTab'
import AskAiTabBefore from './AskAiTabBefore'

window.fetch = (url, init) => {
  // Loud on anything unexpected: a harness that silently answers every request
  // could screenshot a state the product never produces.
  if (!String(url).includes('/api/research/explain/')) {
    return Promise.reject(new Error(`i1-shot harness refuses an unseeded request: ${url}`))
  }
  const body = JSON.parse(init.body)
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ...FIXTURE_ANSWER, turn_state: { ...FIXTURE_ANSWER.turn_state, question: body.question } }),
  })
}

const variant = new URLSearchParams(window.location.search).get('v') === 'before' ? 'before' : 'after'
const Tab = variant === 'before' ? AskAiTabBefore : AskAiTabAfter
document.title = `Ask AI — ${variant}`

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="shotFrame">
      <div className="shotLabel">{variant === 'before' ? 'BEFORE — I1 drew its own Sources list' : 'AFTER — Sources composes S8 <Provenance>'}</div>
      <Tab sym="AAPL" />
    </div>
  </StrictMode>,
)
