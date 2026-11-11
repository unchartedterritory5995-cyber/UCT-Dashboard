// The lab runs on its own origin and the sandbox session lapses; the owner saw "the bank returned no chart items"
// (batch 12) when the real cause was a signed-out session. This card names it and signs in from the page.
import { useState } from 'react'
import StartCard, { StartButton } from './StartCard'
import { signIn } from './bank'
import d5 from './duo.module.css'

export default function SandboxSignIn({ onDone }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [bad, setBad] = useState(false)
  const go = async () => { setBad(false); const ok = await signIn(email.trim(), pw); if (ok) onDone?.(); else setBad(true) }
  return (
    <StartCard tone="dark" eyebrow="Sandbox" title="Signed out" lead="The local sandbox session has lapsed, so the bank cannot be read. One click signs it back in; the piece then continues."
      button={<StartButton icon="lock" label="Sign the sandbox in" sub="one click, nothing to type" onClick={() => { window.location.href = `http://127.0.0.1:8793/signin?back=${encodeURIComponent(window.location.href)}` }} hotkey={false} />}>
      <details className={d5.whyCard}><summary>Or type the local account</summary>
      <div className={d5.signForm}>
        <input className={d5.priceIn} type="email" placeholder="email" value={email} autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
        <input className={d5.priceIn} type="password" placeholder="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        <button type="button" className={d5.wayBtn} onClick={go}>{bad ? 'that did not work, try again' : 'sign in'}</button>
      </div></details>
    </StartCard>
  )
}
