import io, os, json
L = r'C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src\lab'
def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
def sub(p, pairs):
    s = rd(p)
    for a, b in pairs:
        if a in s: s = s.replace(a, b)
        elif b not in s: raise AssertionError((os.path.basename(p), a[:70]))
    wr(p, s)
def splice(p, start_marker, end_marker, new):
    s = rd(p); i = s.find(start_marker); j = s.find(end_marker, i)
    assert i > 0 and j > i, (os.path.basename(p), start_marker[:50])
    wr(p, s[:i] + new + s[j:])

# ── Draw-it: tags at the left edge ──
P = os.path.join(L, 'pieces', 'Piece56DrawItV3.jsx')
sub(P, [("import { spot, pct } from '../pointers'", "import { spot, pct, tag } from '../pointers'")])
splice(P, "    const a = [...spot(all, n - 1, { label: phone ? 'day 1'", "    return a\n  }, [all, vis, n, state, house, red, myPrice, entry, phone])",
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
""")
sub(P, [("height={560} phoneHeight={300} density=\"mini\" defaultBars={48}", "height={560} phoneHeight={300} density=\"mini\" defaultBars={62}")])

# ── Hard: no strip transition; tags at the edge ──
P = os.path.join(L, 'pieces', 'Piece55HardV3.jsx')
s = rd(P)
s = s.replace("import { spot, rayAt, pct } from '../pointers'", "import { spot, rayAt, pct, tag } from '../pointers'")
s = s.replace("  const [stripped, setStripped] = useState(false)\n  const [veil, setVeil] = useState(false)\n", "")
i = s.find("  useEffect(() => {\n    if (!d) return undefined\n    const a = setTimeout(() => setVeil(true)")
if i > 0:
    j = s.find("  }, [d])\n", i) + len("  }, [d])\n")
    s = s[:i] + s[j:]
s = s.replace("(verdict == null ? (stripped ? 'Candles only. What setup, if any, just fired?' : 'Watch: the averages and the volume are about to go.')", "(verdict == null ? 'Candles only. What setup, if any, just fired?'")
s = s.replace("        {veil ? <><div className={d5.veil} /><div className={d5.stripNote}>candles only</div></> : null}\n", "")
s = s.replace("extra={stripped ? HARD : null}", "extra={HARD}")
i = s.find("    if (step !== 'name') {"); j = s.find("    if (step === 'run') a.push(...rayAt(")
assert i > 0 and j > i
s = s[:i] + """    if (step !== 'name') {
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
""" + s[j:]
wr(P, s)

# ── Spot the Kicker ──
P = os.path.join(L, 'pieces', 'Piece57TrapV3.jsx')
sub(P, [
 ("`${cands.length} gold candles, each a gap up after a red day. Only one is a Kicker. Tap it.`", "`Spot the Kicker. ${cands.length} gold candles each gapped up after a red day; only one is the real thing. Tap it.`"),
 ("<span className={s.tapHint}>tap a gold candle</span>", "<span className={s.tapHint}>spot the Kicker</span>"),
 ("      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: (b.o + b.c) / 2 + (b.h - b.l) * 0.18 }], text: `  ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED' : 'WEAK CLOSE'}  `, color: '#111', fontSize: sel ? 15 : 13, bgEnabled: true, bgColor: color, locked: true })",
  "      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: (b.o + b.c) / 2 + (b.h - b.l) * 0.18 }], text: ` ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED' : 'WEAK CLOSE'} `, color: sel || state !== 'ask' ? '#111' : color, fontSize: sel ? 14 : 12, bgEnabled: true, bgColor: sel || state !== 'ask' ? color : 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true })"),
])

# ── Logo smoother ──
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
print('round 13b patch applied')
