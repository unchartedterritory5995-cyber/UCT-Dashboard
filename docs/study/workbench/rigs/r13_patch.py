import io, os, json, re
L = r'C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src\lab'
def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
def sub(p, pairs, must=True):
    s = rd(p)
    for a, b in pairs:
        if a not in s:
            if must: raise AssertionError((os.path.basename(p), a[:70]))
            continue
        s = s.replace(a, b)
    wr(p, s)

# ── bank.js: a signed-out sandbox is named, never "no chart items" ──
P = os.path.join(L, 'bank.js')
sub(P, [
 ("""async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}""",
 """export class SignedOut extends Error { constructor() { super('signed out'); this.name = 'SignedOut' } }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
  if (r.status === 401 || r.status === 403) throw new SignedOut()
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}
/** Sign the sandbox in from the lab page itself (the owner's browser session lapses; the lab has no login screen). */
export async function signIn(email, password) {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) })
  return r.ok
}"""),
 ("""  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch(() => null)))
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'spot'""",
 """  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch((e) => (e instanceof SignedOut ? e : null))))
  if (sets.some((x) => x instanceof SignedOut)) throw new SignedOut()
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'spot'"""),
 ("""  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch(() => null)))
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'recall'""",
 """  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch((e) => (e instanceof SignedOut ? e : null))))
  if (sets.some((x) => x instanceof SignedOut)) throw new SignedOut()
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'recall'"""),
])

# ── SandboxSignIn card (shared) ──
wr(os.path.join(L, 'SandboxSignIn.jsx'), """// The lab runs on its own origin and the sandbox session lapses; the owner saw "the bank returned no chart items"
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
    <StartCard tone="dark" eyebrow="Sandbox" title="Signed out" lead="The local sandbox session has lapsed, so the bank cannot be read. Sign in with the local test account and the piece continues."
      button={<StartButton icon="lock" label="Sign in" sub={bad ? 'that did not work, try again' : 'the local sandbox account'} onClick={go} hotkey={false} />}>
      <div className={d5.signForm}>
        <input className={d5.priceIn} type="email" placeholder="email" value={email} autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
        <input className={d5.priceIn} type="password" placeholder="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
      </div>
    </StartCard>
  )
}
""")
css = rd(os.path.join(L, 'duo.module.css'))
if '.signForm' not in css:
    css += """
.signForm { display: grid; gap: 8px; width: 100%; max-width: 360px; }
.signForm .priceIn { font-size: 15px; font-weight: 600; }
/* round 13: chart tags that stay out of the way (owner: "labels get in the way ... further away ... a different design") */
"""
    wr(os.path.join(L, 'duo.module.css'), css)

# ── Blitz + Boss use the card on a signed-out sandbox ──
for name in ('Piece53BlitzV3.jsx', 'Piece54BossV3.jsx'):
    P = os.path.join(L, 'pieces', name); s = rd(P)
    if 'SandboxSignIn' not in s:
        s = s.replace("import StartCard, { StartButton } from '../StartCard'\n", "import StartCard, { StartButton } from '../StartCard'\nimport SandboxSignIn from '../SandboxSignIn'\n")
    if name == 'Piece53BlitzV3.jsx':
        s = s.replace("  const [pool, setPool] = useState(null)\n", "  const [pool, setPool] = useState(null)\n  const [signedOut, setSignedOut] = useState(false)\n  const [reload, setReload] = useState(0)\n")
        s = s.replace("""    Promise.all([fetchSpotPool(), fetchRecallPool()]).then(([sp, rc]) => on && setPool(buildQuestions(sp, rc))).catch(() => on && setPool([]))
    return () => { on = false }
  }, [])""", """    setSignedOut(false)
    Promise.all([fetchSpotPool(), fetchRecallPool()]).then(([sp, rc]) => on && setPool(buildQuestions(sp, rc))).catch((e) => { if (!on) return; if (e?.name === 'SignedOut') setSignedOut(true); setPool([]) })
    return () => { on = false }
  }, [reload])""")
        s = s.replace("  if (phase === 'tutorial') return", "  if (signedOut) return <div className={d5.lesson}><SandboxSignIn onDone={() => { setPool(null); setReload((r) => r + 1) }} /></div>\n  if (phase === 'tutorial') return")
        s = s.replace("'The bank returned no chart items. Is the sandbox signed in?'", "'The bank returned no chart items.'")
    else:
        s = s.replace("  const [pool, setPool] = useState(null)\n", "  const [pool, setPool] = useState(null)\n  const [signedOut, setSignedOut] = useState(false)\n  const [reload, setReload] = useState(0)\n")
        s = s.replace("""  useEffect(() => { let on = true; fetchSpotPool().then((p) => on && setPool(p)).catch(() => on && setPool([])); return () => { on = false } }, [])""",
                      """  useEffect(() => { let on = true; setSignedOut(false); fetchSpotPool().then((p) => on && setPool(p)).catch((e) => { if (!on) return; if (e?.name === 'SignedOut') setSignedOut(true); setPool([]) }); return () => { on = false } }, [reload])""")
        s = s.replace("  if (phase === 'intro') {\n    return (\n      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />",
                      "  if (signedOut) return <div className={d5.lesson}><SandboxSignIn onDone={() => { setPool(null); setReload((r) => r + 1) }} /></div>\n  if (phase === 'intro') {\n    return (\n      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />")
        # the button must never be dead: it says why
        s = s.replace("""button={<StartButton tone="red" icon="medal" label="Face the boss" sub="ten charts · one heart · +150 XP" onClick={() => pool?.length && start()} />}""",
                      """button={<StartButton tone="red" icon="medal" label={pool == null ? 'Loading the bank' : pool.length ? 'Face the boss' : 'No charts came back'} sub={pool == null ? 'a second or two' : pool.length ? 'ten charts · one heart · +150 XP' : 'reload the page; if it stays empty, sign in to the sandbox'} onClick={() => pool?.length && start()} />}""")
    wr(P, s)

# ── pointers.js: a quieter TAG and a pointer with more distance ──
P = os.path.join(L, 'pointers.js'); s = rd(P)
if 'export function tag(' not in s:
    s += """
/** A quiet tag for a level line (round 13, owner: "the labels get in the way ... further away ... a different design"):
 *  small caps on a near-black plate with a hairline in the line's colour, sitting at the LEFT edge of the window so
 *  the candles stay clear. `t` is the time to anchor at (the first visible bar). */
export function tag(t, price, text, color, id, { size = 11 } = {}) {
  return { id, type: 'text', points: [{ time: t, price }], text: ` ${text.toUpperCase()} `, color, fontSize: size, bgEnabled: true, bgColor: 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true }
}
"""
# the pointer: a longer gap, a smaller quieter chip (dark plate, coloured text) further from the candle
s = s.replace("export function spot(bars, i, { label = 'this candle', color = '#dcbb5e', id = 'spot', gap = 7, halo = true, locked = true, chip = true } = {}) {",
              "export function spot(bars, i, { label = 'this candle', color = '#dcbb5e', id = 'spot', gap = 11, halo = true, locked = true, chip = true } = {}) {")
s = s.replace("""    const at = bars[Math.max(0, i - gap - Math.max(3, Math.ceil(label.length / 3)))]
    const lift = Math.max(b.h - b.l, Math.abs(b.c) * 0.012) * 0.46
    out.push({ id: `${id}-chip`, type: 'text', points: [{ time: at.t, price: price + lift }], text: `  ${label.toUpperCase()}  `, color: '#111111', fontSize: 13, bgEnabled: true, bgColor: color, locked })""",
"""    const at = bars[Math.max(0, i - gap - Math.max(3, Math.ceil(label.length / 3)))]
    const lift = Math.max(b.h - b.l, Math.abs(b.c) * 0.012) * 0.5
    out.push({ id: `${id}-chip`, type: 'text', points: [{ time: at.t, price: price + lift }], text: ` ${label.toUpperCase()} `, color, fontSize: 11, bgEnabled: true, bgColor: 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked })""")
s = s.replace("  const out = [{ id: `${id}-arrow`, type: 'arrow', points: [{ time: from.t, price }, { time: to.t, price }], color, lineWidth: 3, arrowSize: 20, locked }]\n  if (chip && label) {",
              "  const out = [{ id: `${id}-arrow`, type: 'arrow', points: [{ time: from.t, price }, { time: bars[Math.max(0, i - 2)].t, price }], color, lineWidth: 2, arrowSize: 14, locked }]\n  if (chip && label) {")
wr(P, s)

# ── Draw-it: tags at the left edge, nothing on the candles ──
P = os.path.join(L, 'pieces', 'Piece56DrawItV3.jsx')
sub(P, [
 ("import { spot, pct } from '../pointers'", "import { spot, pct, tag } from '../pointers'"),
 ("""    const a = [...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', gap: 7, halo: state !== 'ask' })]
    const t0 = vis[Math.max(0, n - 22)].t
    a.push({ id: 'e', type: 'hray', points: [{ time: t0, price: entry }], color: '#2faf68', lineWidth: 2, lineStyle: 'solid', locked: true })
    a.push({ id: 'e-chip', type: 'text', points: [{ time: t0, price: entry }], text: phone ? `  ENTRY ${money(entry)}  ` : `  ENTRY ${money(entry)} · one cent over yesterday's high  `, color: '#ffffff', fontSize: 12, bgEnabled: true, bgColor: '#2faf68', locked: true })
    if (myPrice != null) {
      const t1 = vis[Math.max(0, n - 16)].t
      a.push({ id: 'mine', type: 'hray', points: [{ time: t1, price: myPrice }], color: '#ff6b6b', lineWidth: 2.5, lineStyle: 'dashed' })
      a.push({ id: 'mine-chip', type: 'text', points: [{ time: t1, price: myPrice }], text: phone ? `  STOP ${money(myPrice)}  ` : `  YOUR STOP ${money(myPrice)}  `, color: '#ffffff', fontSize: 12, bgEnabled: true, bgColor: '#df4646', locked: true })
    }
    if (state !== 'ask' && house != null) {
      const t2 = all[Math.min(all.length - 1, n + 1)].t   // to the right of the Kicker, over the days that follow
      a.push({ id: 'house', type: 'hray', points: [{ time: t2, price: house }], color: '#dcbb5e', lineWidth: 2, lineStyle: 'solid', locked: true })
      a.push({ id: 'house-chip', type: 'text', points: [{ time: t2, price: house }], text: phone ? `  HOUSE ${money(house)}  ` : `  HOUSE STOP ${money(house)} · the Kicker's low  `, color: '#111', fontSize: 12, bgEnabled: true, bgColor: '#dcbb5e', locked: true })
    }
    return a""",
 """    const a = [...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', gap: phone ? 9 : 13, halo: state !== 'ask' })]
    // every level line runs from the LEFT edge of the window and carries its tag there, clear of the candles
    const edge = all[Math.max(0, all.length - (phone ? 42 : 62))].t
    a.push({ id: 'e', type: 'hray', points: [{ time: edge, price: entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: 'solid', locked: true })
    a.push(tag(edge, entry, `entry ${money(entry)}`, '#2faf68', 'e-tag'))
    if (myPrice != null) {
      a.push({ id: 'mine', type: 'hray', points: [{ time: edge, price: myPrice }], color: '#ff6b6b', lineWidth: 1.5, lineStyle: 'dashed' })
      a.push(tag(edge, myPrice, `your stop ${money(myPrice)}`, '#ff6b6b', 'mine-tag'))
    }
    if (state !== 'ask' && house != null) {
      a.push({ id: 'house', type: 'hray', points: [{ time: edge, price: house }], color: '#dcbb5e', lineWidth: 1.5, lineStyle: 'solid', locked: true })
      a.push(tag(edge, house, `house stop ${money(house)}`, '#dcbb5e', 'house-tag'))
    }
    return a"""),
 ("height={560} phoneHeight={300} density=\"mini\" defaultBars={48}", "height={560} phoneHeight={300} density=\"mini\" defaultBars={62}"),
])

# ── Hard: no strip transition (owner: "pick one or the other"); tags at the edge ──
P = os.path.join(L, 'pieces', 'Piece55HardV3.jsx')
sub(P, [
 ("import { spot, rayAt, pct } from '../pointers'", "import { spot, rayAt, pct, tag } from '../pointers'"),
 ("  const [stripped, setStripped] = useState(false)\n  const [veil, setVeil] = useState(false)\n", ""),
 ("""  useEffect(() => {
    if (!d) return undefined
    const a = setTimeout(() => setVeil(true), 900), b = setTimeout(() => setStripped(true), 1350), c = setTimeout(() => setVeil(false), 2000)
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c) }
  }, [d])
""", ""),
 ("(verdict == null ? (stripped ? 'Candles only. What setup, if any, just fired?' : 'Watch: the averages and the volume are about to go.')", "(verdict == null ? 'Candles only. What setup, if any, just fired?'"),
 ("""        {veil ? <><div className={d5.veil} /><div className={d5.stripNote}>candles only</div></> : null}
""", ""),
 ("extra={stripped ? HARD : null}", "extra={HARD}"),
])
s = rd(P)
old = s[s.find("    if (step !== 'name') {"):s.find("    if (step === 'run') a.push(...rayAt(")]
new = """    if (step !== 'name') {
      const edge = all[Math.max(0, all.length - (phone ? 42 : 60))].t
      a.push({ id: 'e', type: 'hray', points: [{ time: edge, price: entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: step === 'enter' && !verdict ? 'dashed' : 'solid' })
      a.push(tag(edge, entry, step === 'enter' && !verdict ? 'the line' : `entry ${money(entry)}`, '#2faf68', 'e-tag'))
      if (step === 'enter' && !verdict && !phone) {
        a.push({ id: 'dc', type: 'hray', points: [{ time: edge, price: red.c }], color: '#9a958a', lineWidth: 1, lineStyle: 'dotted' }); a.push(tag(edge, red.c, "yesterday's close", '#9a958a', 'dc-tag'))
        a.push({ id: 'ko', type: 'hray', points: [{ time: edge, price: kick.o }], color: '#9a958a', lineWidth: 1, lineStyle: 'dotted' }); a.push(tag(edge, kick.o, "today's open", '#9a958a', 'ko-tag'))
      }
      if (step === 'enter' && entryPick != null) a.push({ id: 'ep', type: 'hray', points: [{ time: all[Math.max(0, n - 10)].t, price: entryPick }], color: verdict === 'ok' ? '#2faf68' : '#dcbb5e', lineWidth: 2, lineStyle: 'dashed' })
      if ((step === 'stop' || step === 'run') && stopPick != null) { a.push({ id: 'sp', type: 'hray', points: [{ time: edge, price: stopPick }], color: '#ff6b6b', lineWidth: 1.5, lineStyle: 'dashed' }); a.push(tag(edge, stopPick, `your stop ${money(stopPick)}`, '#ff6b6b', 'sp-tag')) }
      if ((step === 'stop' && verdict) || step === 'run') { a.push({ id: 'hs', type: 'hray', points: [{ time: edge, price: house }], color: '#dcbb5e', lineWidth: 1.5 }); a.push(tag(edge, house, `house stop ${money(house)}`, '#dcbb5e', 'hs-tag')) }
    }
"""
s = s.replace(old, new)
# the dotted-line pair overlaps the tag of THE LINE when prices are close: keep but the tags carry distinct text already
wr(P, s)
# lint hygiene: the strip CSS stays (unused is fine); `useEffect` still used for keys

# ── Trap -> Spot the Kicker ──
P = os.path.join(L, 'pieces', 'Piece57TrapV3.jsx')
sub(P, [
 ("`${cands.length} gold candles, each a gap up after a red day. Only one is a Kicker. Tap it.`", "`Spot the Kicker. ${cands.length} gold candles each gapped up after a red day; only one is the real thing. Tap it.`"),
 ("<span className={s.tapHint}>tap a gold candle</span>", "<span className={s.tapHint}>spot the Kicker</span>"),
])
s = rd(P)
s = s.replace("      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: (b.o + b.c) / 2 + (b.h - b.l) * 0.18 }], text: `  ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED' : 'WEAK CLOSE'}  `, color: '#111', fontSize: sel ? 15 : 13, bgEnabled: true, bgColor: color, locked: true })",
              "      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: (b.o + b.c) / 2 + (b.h - b.l) * 0.18 }], text: ` ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED' : 'WEAK CLOSE'} `, color: sel || state !== 'ask' ? '#111' : color, fontSize: sel ? 14 : 12, bgEnabled: true, bgColor: sel || state !== 'ask' ? color : 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true })")
wr(P, s)

# ── Logo: smoother (60 fps when visible, finer arcs, no seams, gentler rhythms) ──
P = os.path.join(L, 'Logo.jsx')
sub(P, [
 ("function arc(cx, cy, r, a0, a1, n = 34)", "function arc(cx, cy, r, a0, a1, n = 72)"),
 ("      if (!visible || now - last < 32) return", "      if (!visible || now - last < 15) return"),
 ("      if (!bevel) { ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(0.5, W / 520); ctx.stroke() }", "      if (!bevel && !cap) { ctx.strokeStyle = fill; ctx.lineWidth = 0.6; ctx.lineJoin = 'round'; ctx.stroke() }   // a hairline in the face's own colour closes the seams between faces"),
 ("const SPEED = { idle: 9, think: 15, happy: 5, oops: 20, fire: 2.6 }", "const SPEED = { idle: 12, think: 18, happy: 6, oops: 22, fire: 3.2 }"),
])
css = rd(os.path.join(L, 'duo.module.css'))
if 'round 13: gentler rhythms' not in css:
    css += """
/* round 13: gentler rhythms for the logo (owner: smoother movement) */
.lesson .coinWrap, .coinWrap { animation-duration: 4.2s; animation-timing-function: cubic-bezier(.45,0,.55,1); }
.coinBob { animation-duration: 3.4s; animation-timing-function: cubic-bezier(.45,0,.55,1); }
@keyframes throb { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.035) } }
@keyframes bob2 { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4%) } }
"""
    wr(os.path.join(L, 'duo.module.css'), css)

# ── batch 13 ──
W = r'C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\walkthrough\pieces.json'
p = json.load(open(W, encoding='utf-8')); U = 'http://127.0.0.1:5232/lab.html?piece='
new = [
 {"id": "b13-logo", "batch": 13, "title": "1 · The logo, pass 3: smoother", "url": U + "52", "what": "Finer curves on the ring, no seams between faces, a full 60 frames a second while on screen, slower turn, a gentler throb and bounce with eased timing.", "judge": "Smoother now? What still catches your eye: shape, edges, or movement?"},
 {"id": "b13-blitz", "batch": 13, "title": "2 · Blitz: the empty-bank message, fixed", "url": U + "53", "what": "\"No chart items\" meant the local sandbox had signed you out (the lab has no login screen). Now the piece says so and lets you sign in right there with the local test account; the bank loads after.", "judge": "Sign in if asked, then play. Does the mix of questions work for you?"},
 {"id": "b13-boss", "batch": 13, "title": "3 · Boss: a button that always answers", "url": U + "54", "what": "\"Face the boss\" did nothing because the bank had not loaded (signed out). The button now says \"Loading the bank\", then \"Face the boss\", or tells you to sign in; the sign-in card appears when the sandbox is signed out.", "judge": "Does it start now? How does the run feel on your PC?"},
 {"id": "b13-hard", "batch": 13, "title": "4 · Hard mode: candles only from the first frame", "url": U + "55", "what": "The strip transition is gone: the chart is candles-only from the start. Level labels are now quiet tags at the left edge of the chart, clear of the candles; the pointer arrow sits further from the candle.", "judge": "Is candles-only from the start the one you wanted? Are the tags out of the way now?"},
 {"id": "b13-draw", "batch": 13, "title": "5 · Draw it: labels out of the way", "url": U + "56", "what": "A new label design: small caps on a near-black plate with a hairline in the line's colour, anchored at the far left edge of the window, so the entry, your stop and the house stop never sit on the candles. The pointer arrow is further from the Kicker. More bars in view.", "judge": "Further away enough? Is this the label design you had in mind, or describe the one you do?"},
 {"id": "b13-kicker", "batch": 13, "title": "6 · Spot the Kicker", "url": U + "57", "what": "Renamed as you said. Three gold candles each gapped up after a red day; one is the real Kicker; the rule cards show your three rules per candle after Check. The letter chips are quiet tags now.", "judge": "Do the three rules read the way you teach it?"},
]
p = [x for x in p if x.get('batch') != 13] + new
io.open(W, 'w', encoding='utf-8', newline='\n').write(json.dumps(p, ensure_ascii=False, indent=1) + '\n')
print('round 13 patch applied')
