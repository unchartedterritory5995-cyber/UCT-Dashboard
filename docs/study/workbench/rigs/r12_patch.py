import io, os, json
L = r'C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src\lab'
def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
def sub(p, pairs):
    s = rd(p)
    for a, b in pairs:
        assert a in s, (os.path.basename(p), a[:70])
        s = s.replace(a, b)
    wr(p, s)

# ── CSS: the craftsmanship pass ──────────────────────────────────────────────
css = rd(os.path.join(L, 'duo.module.css'))
if 'round 12: craftsmanship' not in css:
    css += """
/* ── round 12: craftsmanship (owner: "cheap and sloppy", "the yellow start bar could be better looking") ── */
/* one primary button family: black glass with a gold rim and gold type; the yellow slab is gone */
.lesson .btn.live { background: linear-gradient(180deg, #1c1709 0%, #0f0d06 100%); color: var(--gb); border: 1px solid #a8842c; border-bottom: 1px solid #a8842c; box-shadow: inset 0 1px 0 rgba(255,241,194,.25), 0 8px 24px rgba(0,0,0,.5), 0 0 0 1px rgba(220,187,94,.12), 0 0 24px rgba(220,187,94,.12); text-shadow: 0 1px 0 rgba(0,0,0,.4); }
.lesson .btn.live:hover { box-shadow: inset 0 1px 0 rgba(255,241,194,.35), 0 8px 24px rgba(0,0,0,.5), 0 0 0 1px rgba(220,187,94,.25), 0 0 34px rgba(220,187,94,.22); }
.lesson .btn.live:active { transform: translateY(1px); }
.lesson .btn.red { background: linear-gradient(180deg, #2a1113, #170909); color: #ff9d9d; border: 1px solid #9a2e2e; border-bottom-color: #9a2e2e; box-shadow: inset 0 1px 0 rgba(255,157,157,.2), 0 8px 24px rgba(0,0,0,.5); }
.lesson .btn { border-bottom-width: 1px; transform: none; }
.lesson .startBtn { background: linear-gradient(180deg, #1c1709 0%, #0f0d06 100%); color: var(--gb); border: 1px solid #a8842c; box-shadow: inset 0 1px 0 rgba(255,241,194,.25), 0 10px 28px rgba(0,0,0,.55), 0 0 0 1px rgba(220,187,94,.12), 0 0 26px rgba(220,187,94,.14); animation: none; }
.lesson .startBtn::after { display: none; }
.lesson .startBtn:hover { filter: none; box-shadow: inset 0 1px 0 rgba(255,241,194,.35), 0 10px 28px rgba(0,0,0,.55), 0 0 0 1px rgba(220,187,94,.3), 0 0 40px rgba(220,187,94,.26); }
.lesson .startIcon { background: linear-gradient(180deg, var(--gb), var(--g) 60%, #a8842c); color: #15120a; box-shadow: 0 0 0 1px rgba(255,241,194,.35) inset, 0 2px 8px rgba(0,0,0,.5); }
.lesson .startText b { color: var(--gb); letter-spacing: .14em; }
.lesson .startText small { color: #b9a56a; font-weight: 600; }
.lesson .startKey { color: #8a7a4a; border-color: rgba(220,187,94,.35); }
.lesson .startRed { background: linear-gradient(180deg, #2a1113, #170909); color: #ff9d9d; border-color: #9a2e2e; box-shadow: inset 0 1px 0 rgba(255,157,157,.2), 0 10px 28px rgba(0,0,0,.55), 0 0 26px rgba(223,70,70,.16); }
.lesson .startRed .startIcon { background: linear-gradient(180deg, #ff9d9d, #df4646 60%, #9a2e2e); color: #1a0a0a; } .lesson .startRed .startText b { color: #ff9d9d; } .lesson .startRed .startText small { color: #c98585; } .lesson .startRed .startKey { color: #a06060; border-color: rgba(223,70,70,.4); }
/* explanation lives in a card, not in the bubble (the bubble is two lines) */
.whyCard { border: 1px solid var(--line); border-left: 2px solid var(--g); border-radius: 12px; background: var(--card); padding: 10px 14px; }
.whyCard summary { cursor: pointer; list-style: none; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--gb); font-weight: 800; display: flex; align-items: center; gap: 8px; }
.whyCard summary::-webkit-details-marker { display: none; }
.whyCard summary::after { content: '+'; margin-left: auto; color: var(--mut); font-weight: 400; font-size: 16px; }
.whyCard[open] summary::after { content: '–'; }
.whyCard p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: #d9d4c8; }
.whyCard b { color: var(--ink); }
.stepsCompact { flex: 1; display: flex; justify-content: center; }
.stepsCompact .stepPill { font-size: 11px; }
.gemIcon svg { display: block; }
.liveStrip { display: flex; gap: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); overflow: hidden; }
.liveStrip > div { flex: 1; padding: 9px 12px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--line); min-width: 0; }
.liveStrip > div:last-child { border-right: 0; }
.liveStrip small { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--mut); white-space: nowrap; }
.liveStrip b { font-size: 17px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.liveStrip input { width: 100%; padding: 4px 0; border: 0; border-bottom: 1px solid var(--g); background: none; color: var(--ink); font: inherit; font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.liveStrip input:focus { outline: none; border-bottom-color: var(--gb); }
.liveStrip input::placeholder { color: #5e5a50; font-weight: 500; font-size: 13px; }
@media (max-width: 640px) {
  .lesson { padding: 10px 12px 150px; gap: 10px; }
  .lesson .bubble { font-size: 15px; font-weight: 600; padding: 10px 12px; border-radius: 14px; }
  .lesson .ask { gap: 10px; }
  .lesson .qText { font-size: 14px; } .lesson .qSetup { font-size: 11px; padding: 3px 8px; }
  .lesson .stamp { left: 10px; right: auto; width: 56px; height: 56px; }
  .lesson .stamp svg { width: 36px; height: 36px; }
  .lesson .topbar { gap: 8px; }
  .stepsCompact .stepPill { font-size: 10px; padding: 3px 8px; }
  .liveStrip { flex-wrap: wrap; } .liveStrip > div { flex: 1 1 45%; border-bottom: 1px solid var(--line); }
  .lesson .card { padding: 12px 14px; font-size: 15px; }
  .lesson .startCard { gap: 10px; }
  .lesson .heroWord { font-size: 32px; }
  .lesson .startLead { font-size: 14px; }
  .nudge button { min-width: 44px; }
}
"""
    wr(os.path.join(L, 'duo.module.css'), css)

# ── Hard V3: short labels on a phone, no reference chips there, compact step pills, correct Kicker wording ──
P = os.path.join(L, 'pieces', 'Piece55HardV3.jsx')
sub(P, [
 ("import { useSample } from '../Lab'\n", "import { useSample } from '../Lab'\nimport { useIsPhone } from '../../hooks/useBreakpoint'\n"),
 ("function Lesson({ onDone }) {\n  const d = useSample('JBI_2023-12-14')\n", "function Lesson({ onDone }) {\n  const d = useSample('JBI_2023-12-14')\n  const phone = useIsPhone()\n"),
 ("    else a.push(...spot(all, n - 1, { label: 'day 1 · the Kicker', id: 'k', color: '#2faf68', halo: step === 'run' }))", "    else a.push(...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', color: '#2faf68', halo: step === 'run' }))"),
 ("text: step === 'enter' && !verdict ? '  THE LINE  ' : `  ENTRY ${money(entry)} · over yesterday's high  `", "text: step === 'enter' && !verdict ? '  THE LINE  ' : (phone ? `  ENTRY ${money(entry)}  ` : `  ENTRY ${money(entry)} · over yesterday's high  `)"),
 ("      if (step === 'enter' && !verdict) { a.push({ id: 'dc'", "      if (step === 'enter' && !verdict && !phone) { a.push({ id: 'dc'"),
 ("text: `  HOUSE STOP ${money(house)} · the Kicker's low  `", "text: phone ? `  HOUSE ${money(house)}  ` : `  HOUSE STOP ${money(house)} · the Kicker's low  `"),
 ("  }, [all, vis, n, red, kick, entry, house, step, verdict, entryPick, stopPick])", "  }, [all, vis, n, red, kick, entry, house, step, verdict, entryPick, stopPick, phone])"),
 ("'It was the Kicker: a real red day, then an open above its body and a strong close.'", "'It was the Kicker: a real red day, then a gap over its close and a strong finish above its high.'"),
 ("<div className={d5.stepRow}>{['Name it', 'Enter it', 'Stop it', 'Run'].map((t, k) => <span key={t} className={`${d5.stepPill} ${STEPS.indexOf(step) > k ? d5.done : STEPS.indexOf(step) === k ? d5.now : ''}`}>{t}</span>)}</div>",
  "<div className={d5.stepsCompact}><span className={`${d5.stepPill} ${d5.now}`}>{STEPS.indexOf(step) + 1} of 4 · {['Name it', 'Enter it', 'Stop it', 'Watch it run'][STEPS.indexOf(step)]}</span></div>"),
 ("        : <div className={`${d5.live} ${d5.four}`}><div><small>Yesterday's high</small><b>{money(red.h)}</b></div><div><small>Entry</small><b>{step === 'enter' && !verdict ? (entryPick != null ? money(entryPick) : 'tap the line') : money(entry)}</b></div><div><small>Your stop</small><b>{stopPick != null ? money(stopPick) : (step === 'stop' ? 'tap it' : '')}</b></div><div><small>House stop</small><b>{(step === 'stop' && verdict) || step === 'run' ? money(house) : ''}</b></div></div>}",
  "        : <div className={d5.liveStrip}><div><small>Yesterday's high</small><b>{money(red.h)}</b></div><div><small>Entry</small><b>{step === 'enter' && !verdict ? (entryPick != null ? money(entryPick) : '—') : money(entry)}</b></div><div><small>Your stop</small><b>{stopPick != null ? money(stopPick) : '—'}</b></div><div><small>House stop</small><b>{(step === 'stop' && verdict) || step === 'run' ? money(house) : '—'}</b></div></div>}"),
 ("height={460} density=\"mini\" defaultBars={60} hideTicker extra={stripped ? HARD : null}", "height={460} phoneHeight={320} density=\"mini\" defaultBars={60} hideTicker extra={stripped ? HARD : null}"),
])
# shorter bubbles in Hard; the long "why" moves to a card
s = rd(P)
old = s[s.find("  const bubble = step === 'name'"):s.find("  return (\n    <div className={`${d5.lesson} ${d5.slideIn}")]
new = """  const bubble = step === 'name' ? (verdict == null ? (stripped ? 'Candles only. What setup, if any, just fired?' : 'Watch: the averages and the volume are about to go.') : verdict === 'ok' ? 'Kicker. Now the buy day.' : 'It was the Kicker. Now the buy day.')
    : step === 'enter' ? (verdict == null ? `Day 1. Yesterday's high was ${money(red.h)}. Tap the line the house buys over.` : verdict === 'ok' ? `Over ${money(entry)}. A stop-buy, one cent above yesterday's high.` : `Not there. The house buys over ${money(entry)}, one cent above yesterday's high.`)
      : step === 'stop' ? (verdict == null ? `You are in over ${money(entry)}. Tap where your stop goes.` : verdict === 'ok' ? `Under the Kicker's low, ${money(house)}.` : `The house stop is ${money(house)}, the Kicker's low. Yours was ${Math.abs(pct(house, stopPick)).toFixed(1)}% off.`)
        : 'Now watch it run, one day at a time. Did your stop hold?'
  const why = step === 'name' ? (verdict ? 'A real red day closes weak near its low. The next day gaps over that close and finishes strong, above the red day\\'s high. Yesterday\\'s sellers are trapped.' : null)
    : step === 'enter' ? (verdict ? 'Why there: the first trade over yesterday\\'s high proves the sellers wrong. How: a stop-buy at that price, so it fills only if price gets there. Never at the open, never at the close.' : 'The dotted lines are yesterday\\'s close and today\\'s open. The dashed line is yesterday\\'s high.')
      : step === 'stop' ? (verdict ? `The stop is the house rule: under the Kicker's low, or ${MAX_STOP_PCT}% under the entry when that low is further away. If the low breaks, the candle failed.` : 'The house rule: under the Kicker\\'s low, or 3.5% under the entry when that low is further away.')
        : 'Each new day arrives on its own. Your stop is the red dashed line, the house stop the green one.'
"""
s = s.replace(old, new)
s = s.replace("""      {step === 'name' ? <div className={`${d5.cards} ${d5.cascade}`}>""", """      {why ? <details className={d5.whyCard} open={!phone || !!verdict}><summary>Why</summary><p>{why}</p></details> : null}
      {step === 'name' ? <div className={`${d5.cards} ${d5.cascade}`}>""")
wr(P, s)

# ── Draw-it V3: two-line bubble + why card, short chips on a phone, strip row, no volume on a phone ──
P = os.path.join(L, 'pieces', 'Piece56DrawItV3.jsx')
sub(P, [
 ("import { useSample } from '../Lab'\n", "import { useSample } from '../Lab'\nimport { useIsPhone } from '../../hooks/useBreakpoint'\n"),
 ("  const d = useSample()\n  const [myPrice, setMyPrice] = useState(null)", "  const d = useSample()\n  const phone = useIsPhone()\n  const [myPrice, setMyPrice] = useState(null)"),
 ("  const extra = useMemo(() => ({ ...QUIET, annotationsEditable: tool && state === 'ask', onAnnotationsChange: onChange, showDrawingTools: false }), [onChange, state, tool])",
  "  const extra = useMemo(() => ({ ...QUIET, ...(phone ? { showVolume: false } : {}), annotationsEditable: tool && state === 'ask', onAnnotationsChange: onChange, showDrawingTools: false }), [onChange, state, tool, phone])"),
 ("    const a = [...spot(all, n - 1, { label: 'day 1 · the Kicker', id: 'k', gap: 7, halo: state !== 'ask' })]", "    const a = [...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', gap: 7, halo: state !== 'ask' })]"),
 ("text: `  ENTRY ${money(entry)} · one cent over yesterday's high  `", "text: phone ? `  ENTRY ${money(entry)}  ` : `  ENTRY ${money(entry)} · one cent over yesterday's high  `"),
 ("text: `  YOUR STOP ${money(myPrice)}  `", "text: phone ? `  STOP ${money(myPrice)}  ` : `  YOUR STOP ${money(myPrice)}  `"),
 ("text: `  HOUSE STOP ${money(house)} · the Kicker's low  `", "text: phone ? `  HOUSE ${money(house)}  ` : `  HOUSE STOP ${money(house)} · the Kicker's low  `"),
 ("  }, [all, vis, n, state, house, red, myPrice, entry])", "  }, [all, vis, n, state, house, red, myPrice, entry, phone])"),
 ("{state === 'ask' ? `The green line is the entry: ${money(entry)}, one cent over yesterday's high. Why there: yesterday's sellers finished in charge, and the first trade over their high proves them wrong. How: a stop-buy at that price, so it fills only if price gets there. Now place your stop. Tap the chart where it goes.` :",
  "{state === 'ask' ? `The green line is the entry, ${money(entry)}. Now place your stop: tap the chart where it goes.` :"),
 ("height={560} phoneHeight={380} density=\"mini\" defaultBars={48}", "height={560} phoneHeight={300} density=\"mini\" defaultBars={48}"),
 ("""        <div className={d5.stopRow}>
          <div className={d5.live}>
            <div><small>Entry · stop-buy</small><b>{money(entry)}</b></div>
            <div><small>Your stop</small><input className={d5.priceIn} type="number" step="0.01" min="0" placeholder="tap the chart or type" value={myPrice ?? ''} onChange={(e) => setMyPrice(e.target.value === '' ? null : r2(Number(e.target.value)))} /></div>
          </div>
          <div className={d5.nudge}>""",
  """        <div className={d5.stopRow}>
          <div className={d5.liveStrip}>
            <div><small>Entry · stop-buy</small><b>{money(entry)}</b></div>
            <div><small>Your stop</small><input type="number" step="0.01" min="0" placeholder="tap the chart or type" value={myPrice ?? ''} onChange={(e) => setMyPrice(e.target.value === '' ? null : r2(Number(e.target.value)))} /></div>
            {risk != null ? <div><small>Risk</small><b>{risk.toFixed(1)}%</b></div> : null}
          </div>
          <div className={d5.nudge}>"""),
 ("""            {risk != null ? <span className={d5.riskTag}>risk <b>{risk.toFixed(1)}%</b></span> : null}
""", ""),
 ("""        <div className={`${d5.live} ${d5.four}`}>
          <div><small>Entry</small><b>{money(entry)}</b></div>
          <div><small>Your stop</small><b>{money(myPrice)}</b></div>
          <div><small>House stop</small><b>{money(house)}</b></div>
          <div><small>Risk at yours</small><b>{risk.toFixed(1)}%</b></div>
        </div>""",
  """        <div className={d5.liveStrip}>
          <div><small>Entry</small><b>{money(entry)}</b></div>
          <div><small>Your stop</small><b>{money(myPrice)}</b></div>
          <div><small>House stop</small><b>{money(house)}</b></div>
          <div><small>Risk at yours</small><b>{risk.toFixed(1)}%</b></div>
        </div>"""),
 ("""      {state === 'ask' ? <div className={d5.howRow}>""", """      <details className={d5.whyCard} open={!phone}><summary>Why this entry</summary><p><b>Where:</b> one cent over yesterday's high. <b>Why:</b> yesterday's sellers finished in charge, and the first trade over their high proves them wrong. <b>How:</b> a stop-buy at that price, so it fills only if price gets there. Never at the open, never at the close.</p></details>
      {state === 'ask' ? <div className={d5.howRow}>"""),
])

# ── Trap V3: the owner's Kicker rules (gap over the red day's close, close above its high), chips at mid-price, phone chrome ──
P = os.path.join(L, 'pieces', 'Piece57TrapV3.jsx')
s = rd(P)
old = s[s.find("function rules(bars, i) {"):s.find("const GOLD = '#dcbb5e'")]
new = """function rules(bars, i) {
  const b = bars[i], r = bars[i - 1], rr = bars[i - 2]
  const redChg = pct(rr.c, r.c)
  const closePos = (b.c - b.l) / ((b.h - b.l) || 1)
  return [
    { k: 'red', label: 'A real red day before it', value: `${redChg.toFixed(1)}%, closed ${Math.round(((r.c - r.l) / ((r.h - r.l) || 1)) * 100)}% up its range`, ok: r.c < r.o && Math.abs(redChg) >= 1, rule: 'red, down 1% or more, weak close' },
    { k: 'gap', label: "Gaps over the red day's close", value: `open ${b.o.toFixed(2)} vs close ${r.c.toFixed(2)}`, ok: b.o > r.c, rule: 'the open clears yesterday\\'s close' },
    { k: 'close', label: "Closes strong, above the red day's high", value: `close ${b.c.toFixed(2)} vs high ${r.h.toFixed(2)}, ${Math.round(closePos * 100)}% up its range`, ok: b.c > b.o && b.c > r.h && closePos >= 0.5, rule: 'green, above yesterday\\'s high, upper half' },
  ]
}
function findTraps(bars, n, view) {
  const out = []
  for (let i = n - 2; i >= Math.max(2, n - view) && out.length < 2; i--) {
    const [red, gap, close] = rules(bars, i)
    const r = bars[i - 1]
    if (!(r.c < r.o) || !gap.ok) continue
    if (!red.ok && close.ok && !out.some((x) => x.kind === 'baby')) out.push({ i, kind: 'baby', why: 'The red day before it was too small. Not a real red day.' })
    else if (red.ok && !close.ok && !out.some((x) => x.kind === 'weak')) out.push({ i, kind: 'weak', why: 'It gapped over the red close but did not finish strong above its high.' })
  }
  return out
}
"""
s = s.replace(old, new)
s = s.replace("""      const b = all[c.i], first = Math.max(0, n - view), at = c.i - 3 >= first + 4 ? all[c.i - 3] : all[Math.min(all.length - 1, c.i + 2)]
      const sel = pick === c.i
      const real = c.kind === 'real'
      const color = state === 'ask' ? (sel ? '#fff1c2' : GOLD) : real ? '#2faf68' : '#df4646'
      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: b.h + (b.h - b.l) * 0.6 }], text: `  ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED DAY' : 'WEAK CLOSE'}  `, color: '#111', fontSize: sel ? 16 : 14, bgEnabled: true, bgColor: color, locked: true })""",
"""      const b = all[c.i], first = Math.max(0, n - view), left = c.i - 4 >= first + 3, at = left ? all[c.i - 4] : all[Math.min(all.length - 1, c.i + 2)]
      const sel = pick === c.i
      const real = c.kind === 'real'
      const color = state === 'ask' ? (sel ? '#fff1c2' : GOLD) : real ? '#2faf68' : '#df4646'
      // the chip sits beside the candle at its mid price (never above it, so it can never leave the range)
      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: (b.o + b.c) / 2 + (b.h - b.l) * 0.18 }], text: `  ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED' : 'WEAK CLOSE'}  `, color: '#111', fontSize: sel ? 15 : 13, bgEnabled: true, bgColor: color, locked: true })""")
s = s.replace("  const extra = useMemo(() => ({ ...QUIET, ...(highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : {}) }), [highlight])",
              "  const extra = useMemo(() => ({ ...QUIET, ...(phone ? { showVolume: false } : {}), ...(highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : {}) }), [highlight, phone])")
s = s.replace("`${cands.length} gold candles. Each opened above a red day. Only one is a Kicker. Tap the real one.`", "`${cands.length} gold candles, each a gap up after a red day. Only one is a Kicker. Tap it.`")
s = s.replace("'That is the Kicker. Read why the others fail.'", "'That is the Kicker. The cards say why the others fail.'").replace("'That one fails a rule. The Kicker is the green one. Read why.'", "'That one fails a rule. The Kicker is the green one.'")
wr(P, s)

# ── Boss V3: the lesson text into a why card; UIcon gems ──
P = os.path.join(L, 'pieces', 'Piece54BossV3.jsx')
sub(P, [
 ("      {state !== 'ask' && why ? <p className={d5.whyLine}>{why}</p> : null}", "      {state !== 'ask' && why ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{why}</p></details> : null}"),
])
# ── gems: glyph characters -> the app's icons (UIcon), no emoji anywhere ──
for name in ('Piece53BlitzV3.jsx', 'Piece54BossV3.jsx', 'Piece55HardV3.jsx'):
    P = os.path.join(L, 'pieces', name); s = rd(P)
    if "import UIcon from" not in s:
        s = s.replace("import Logo from '../Logo'\n", "import Logo from '../Logo'\nimport UIcon from '../../components/ui/UIcon'\n")
    s = s.replace("<span className={d5.gemIcon}>◆</span>", "<span className={d5.gemIcon}><UIcon name=\"star\" size={20} /></span>")
    s = s.replace("<span className={d5.gemIcon}>⚡</span>", "<span className={d5.gemIcon}><UIcon name=\"bolt\" size={20} /></span>")
    s = s.replace("<span className={d5.gemIcon}>×</span>", "<span className={d5.gemIcon}><UIcon name=\"sparkle\" size={20} /></span>")
    s = s.replace("<span className={d5.gemIcon}>▣</span>", "<span className={d5.gemIcon}><UIcon name=\"save\" size={20} /></span>")
    s = s.replace("<span className={d5.gemIcon}>♛</span>", "<span className={d5.gemIcon}><UIcon name=\"star\" size={20} gold /></span>")
    wr(P, s)

# ── batch 12 in the shell (same six pieces, rebuilt) ──
W = r'C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\walkthrough\pieces.json'
p = json.load(open(W, encoding='utf-8')); U = 'http://127.0.0.1:5232/lab.html?piece='
new = [
 {"id": "b12-logo", "batch": 12, "title": "1 · The logo, pass 2", "url": U + "52", "what": "Same real 3D, rendered better: thicker body, a bright bevel along the lit edges, a metallic sheen that slides as it turns, a faint floor reflection. It now draws at 30 frames a second and stops when off screen, which helps your PC.", "judge": "Score the quality. Say what a 100 would still need: lighting, colour, speed, size."},
 {"id": "b12-blitz", "batch": 12, "title": "2 · Blitz, pass 5: the craftsmanship round", "url": U + "53", "what": "The yellow bar is gone: every primary button is now black glass with a gold rim and gold type. Icons are the app's own icon set, no glyphs. Tighter phone layout: shorter bubbles, smaller stamps on the left so they never cover the price axis, nothing hidden under the bottom bar.", "judge": "Does it still feel AI-coded? Name the first thing that does."},
 {"id": "b12-boss", "batch": 12, "title": "3 · Boss, pass 4: lighter and faster", "url": U + "54", "what": "The bank fetch is a quarter of the size so the Boss starts in about a second on a normal connection; the lesson after Check is a collapsible card instead of a wall of text; the stamp sits on the left.", "judge": "Is it still stuck or slow? Where exactly?"},
 {"id": "b12-hard", "batch": 12, "title": "4 · Hard mode, pass 4: taps that work on a phone", "url": U + "55", "what": "A real phone tap now lands (the chart ignored touches before; measured and fixed in the chart itself). Two-line bubbles with a Why card under the chart; short labels on a phone so nothing is cut off; one step pill instead of four; the number strip in one row.", "judge": "Tap the line and the stop on your phone. Did both land where you tapped?"},
 {"id": "b12-draw", "batch": 12, "title": "5 · Draw it, pass 4: tidy", "url": U + "56", "what": "Phone taps land. The bubble is two lines and the entry's why/where/how sits in a Why card under the chart. The entry, stop and house labels are short on a phone and never cut off. The number strip is one row with the stop input and the risk inside it. Shorter chart on a phone so the controls sit above the fold.", "judge": "Cheap and sloppy still? Point at the exact element."},
 {"id": "b12-trap", "batch": 12, "title": "6 · Spot the trap, pass 4: your rules, corrected", "url": U + "57", "what": "The rule cards now test YOUR Kicker rules: a real red day that closed weak; a gap over the red day's close (not its body top, which wrongly failed the real Kicker before); a strong close above the red day's high. The letter chips sit beside each gold candle at its mid price so they never clip. Phone taps land; no volume pane on a phone.", "judge": "Are the three rules exactly how you would teach it? Add or reword any."},
]
p = [x for x in p if x.get('batch') != 12] + new
io.open(W, 'w', encoding='utf-8', newline='\n').write(json.dumps(p, ensure_ascii=False, indent=1) + '\n')
print('round 12 patch applied;', len(p), 'pieces')
