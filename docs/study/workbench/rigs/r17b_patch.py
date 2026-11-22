# Round 17b: the MAGNITUDE pass (owner: "you did not make ALL changes to the level and effect and magnitude that my
# feedback mandated"). Idempotent: every sub skips when its replacement is already in place.
import io, os, re
APP = r"C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src"
def P(*a): return os.path.join(APP, *a)
def rd(p): return io.open(p, encoding="utf-8", newline="").read()
def wr(p, s): io.open(p, "w", encoding="utf-8", newline="").write(s)
def nl_of(s): return "\r\n" if "\r\n" in s else "\n"
def sub(path, old, new):
    s = rd(path); nl = nl_of(s); o = old.replace("\n", nl); n = new.replace("\n", nl)
    if n in s and o not in s: return
    assert o in s, f"anchor missing in {os.path.basename(path)}: {old[:80]!r}"
    wr(path, s.replace(o, n, 1))
def append(path, text):
    s = rd(path); nl = nl_of(s); t = text.replace("\n", nl)
    if t[:70] in s: return
    wr(path, s.rstrip(nl) + nl + nl + t + nl)

# A. the mark: the FULL animation in the drill (fast turn, the sway, a breathing gold halo)
p = P("components", "study", "StudyMark3D.jsx")
sub(p, "const SPEED = { idle: 12, live: 7, think: 18,", "const SPEED = { idle: 12, live: 4.5, think: 18,")
sub(p, "mood === 'think' || mood === 'live' ? m.think : ''", "mood === 'live' ? m.live : mood === 'think' ? m.think : ''")
p = P("components", "study", "StudyMark.module.css")
append(p, """/* 'live': the drill's mark, alive on screen: it breathes, bobs and glows while it turns (owner, batch 16: "I want the logo
   to be moving in our animation work that we did") */
.live { animation: liveMove 3.2s ease-in-out infinite; filter: drop-shadow(0 8px 18px rgba(0, 0, 0, .6)) drop-shadow(0 0 28px rgba(220, 187, 94, .55)); }
@keyframes liveMove { 0%, 100% { transform: translateY(0) scale(1) } 35% { transform: translateY(-6%) scale(1.045) } 70% { transform: translateY(2%) scale(.985) } }
@media (prefers-reduced-motion: reduce) { .live { animation: none !important; } }""")

# B. drillLook: the numeric value rides along for the gauges
p = P("pages", "study", "drillLook.js")
sub(p, "  const out = [{ id: 'high', label: 'Off high', value: fmt(offHigh), tone: tone(offHigh) }]\n  if (m20 != null) out.push({ id: 'ma20', label: 'vs 20 MA', value: fmt(m20), tone: tone(m20) })\n  if (m50 != null) out.push({ id: 'ma50', label: 'vs 50 MA', value: fmt(m50), tone: tone(m50) })\n  if (adr != null) out.push({ id: 'adr', label: 'ADR 20', value: `${adr.toFixed(1)}%`, tone: 'flat' })",
       "  const out = [{ id: 'high', label: 'Off high', value: fmt(offHigh), tone: tone(offHigh), num: offHigh }]\n  if (m20 != null) out.push({ id: 'ma20', label: 'vs 20 MA', value: fmt(m20), tone: tone(m20), num: m20 })\n  if (m50 != null) out.push({ id: 'ma50', label: 'vs 50 MA', value: fmt(m50), tone: tone(m50), num: m50 })\n  if (adr != null) out.push({ id: 'adr', label: 'ADR 20', value: `${adr.toFixed(1)}%`, tone: 'flat', num: adr })")
sub(p, "/** @returns {{ id: string, label: string, value: string, tone: 'up'|'down'|'flat' }[]} */", "/** @returns {{ id: string, label: string, value: string, tone: 'up'|'down'|'flat', num: number }[]} */")

# C. DrillPlayer: taller chart, the facts TABLE with gauges beside the chart, the big mark
p = P("pages", "study", "DrillPlayer.jsx")
sub(p, "export const CHART_HEIGHT = 240", "export const CHART_HEIGHT = 380")
sub(p, "<StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : 'live'} size={88} />",
       "<StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : 'live'} size={112} />")
old_stats = """            {stats.length > 0 && (
              <dl className={styles.stats} aria-label="Chart facts" data-testid="chart-stats">
                {stats.map((st) => (
                  <div key={st.id} className={`${styles.stat} ${styles[`stat_${st.tone}`] || ''}`}>
                    <dt>{st.label}</dt><dd>{st.value}</dd>
                  </div>
                ))}
              </dl>
            )}
"""
sub(p, old_stats, "")
sub(p, """        <div
          className={`${styles.chartBox} ${needsChart ? '' : styles.chartHidden}`}""",
       """        <div className={`${styles.chartRow} ${needsChart && stats.length > 0 ? styles.chartRowFacts : ''}`}>
        <div
          className={`${styles.chartBox} ${needsChart ? '' : styles.chartHidden}`}""")
sub(p, """        </div>
        <div className={styles.body}>
          <mod.Body item={item} state={state} setState={setState} locked={locked} reveal={reveal} />""",
       """        </div>
        {needsChart && stats.length > 0 && (
          <div className={styles.facts} data-testid="chart-stats">
            <div className={styles.factsHead}>The read on this chart</div>
            <table className={styles.factsTable}>
              <tbody>
                {stats.map((st) => (
                  <tr key={st.id} className={styles[`row_${st.tone}`] || ''}>
                    <th scope="row">{st.label}</th>
                    <td className={styles.factVal}>{st.value}</td>
                    <td className={styles.gauge}><span className={styles.gaugeBar} style={{ width: `${Math.min(100, (Math.abs(st.num || 0) / 30) * 100)}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
        <div className={styles.body}>
          <mod.Body item={item} state={state} setState={setState} locked={locked} reveal={reveal} />""")

p = P("pages", "study", "DrillPlayer.module.css")
sub(p, """.scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-lg);
  position: relative;
}""", """.scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-lg);
  position: relative;
  background: radial-gradient(90% 60% at 50% 0%, rgba(58, 49, 21, .35) 0%, rgba(11, 11, 11, 0) 60%), var(--bg);
}""")
sub(p, """.question {
  margin: 0;
  color: #f7f3e8;
  font-size: 22px;
  font-weight: 800;""", """.question {
  margin: 0;
  color: #f7f3e8;
  font-size: 27px;
  font-weight: 900;""")
sub(p, ".ask.ask { gap: 18px; align-items: center; margin-bottom: 4px; }", ".ask.ask { gap: 22px; align-items: center; margin: 4px 0 10px; }")
sub(p, ".bubble.bubble { flex: 1 1 auto; min-width: 0; padding: 16px 20px;", ".bubble.bubble { flex: 1 1 auto; min-width: 0; padding: 20px 26px;")
append(p, """/* round 17b: the chart beside the facts TABLE on a wide screen, stacked on a phone */
.chartRow { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
@media (min-width: 1025px) { .chartRowFacts { grid-template-columns: minmax(0, 1fr) 268px; } }
.facts { border: 1px solid #3a3115; border-radius: 16px; background: linear-gradient(180deg, #171409, #0f0f0f); box-shadow: 0 10px 30px rgba(0, 0, 0, .45); padding: 14px 16px 12px; }
.factsHead { font-size: 11px; font-weight: 900; letter-spacing: .2em; text-transform: uppercase; color: var(--ut-gold-bright); margin-bottom: 8px; }
.factsTable { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.factsTable th { text-align: left; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #9a958a; padding: 9px 8px 9px 0; border-top: 1px solid #262626; white-space: nowrap; }
.factsTable tr:first-child th, .factsTable tr:first-child td { border-top: 0; }
.factsTable td { padding: 9px 0 9px 8px; border-top: 1px solid #262626; }
.factVal { font-size: 19px; font-weight: 900; color: #e6e1d6; text-align: right; white-space: nowrap; }
.row_up .factVal { color: #4ad98a; } .row_down .factVal { color: #ff6b6b; }
.gauge { width: 38%; }
.gaugeBar { display: block; height: 10px; border-radius: 999px; background: linear-gradient(90deg, #b8942e, #fff1c2); box-shadow: 0 0 12px rgba(220, 187, 94, .4); transition: width .6s cubic-bezier(.2, .9, .3, 1); }
.row_up .gaugeBar { background: linear-gradient(90deg, #1d7a45, #8fe3b1); box-shadow: 0 0 12px rgba(47, 175, 104, .45); }
.row_down .gaugeBar { background: linear-gradient(90deg, #9a2e2e, #ffb3b3); box-shadow: 0 0 12px rgba(223, 70, 70, .45); }
.primaryBtn.primaryBtn { max-width: 600px; padding: 16px 22px 16px 16px; }
@media (max-width: 640px) { .question { font-size: 21px; } .factVal { font-size: 17px; } }""")

# D. the journey: a big numbered trail with a glowing fill and a bigger walker
p = P("pages", "study", "JourneyStrip.jsx")
sub(p, """            <li key={s.i} className={`${styles.stop} ${styles[s.state]}`} aria-hidden="true" />""",
       """            <li key={s.i} className={`${styles.stop} ${styles[s.state]}`} aria-hidden="true">{s.i + 1}</li>""")
sub(p, "<div className={styles.walkerIn}><StudyMark mood=\"live\" size={34} /></div>", "<div className={styles.walkerIn}><StudyMark mood=\"live\" size={46} /></div>")
p = P("pages", "study", "JourneyStrip.module.css")
append(p, """/* round 17b: the journey as a BIG numbered trail */
.wrap { height: 44px; padding-right: 28px; }
.track { height: 14px; box-shadow: 0 1px 0 rgba(255, 255, 255, .06) inset, 0 0 0 1px #2a2a2a, 0 4px 14px rgba(0, 0, 0, .5) inset; }
.fill { background: linear-gradient(90deg, #8a6f22 0%, #d9b84a 40%, #fff1c2 50%, #d9b84a 60%, #8a6f22 100%); background-size: 200% 100%; animation: flow 2.2s linear infinite; box-shadow: 0 0 18px rgba(220, 187, 94, .55); }
@keyframes flow { from { background-position: 200% 0 } to { background-position: 0 0 } }
.stops { padding: 0; }
.stop { width: 18px; height: 18px; font-size: 9px; font-weight: 900; color: #6a6659; display: grid; place-items: center; background: #1a1a1a; box-shadow: 0 0 0 2px #0f0f0f, 0 0 0 1px #2e2e2e; }
.stop:first-child { visibility: visible; }
.hit { color: #15120a; background: linear-gradient(180deg, #fff1c2, #d9b84a); box-shadow: 0 0 0 2px #0f0f0f, 0 0 12px rgba(220, 187, 94, .7); }
.miss { color: #fff; background: linear-gradient(180deg, #ff9d9d, #df4646); box-shadow: 0 0 0 2px #0f0f0f, 0 0 12px rgba(223, 70, 70, .6); }
.now { color: #15120a; background: #d9b84a; }
.walker { filter: drop-shadow(0 6px 14px rgba(0, 0, 0, .7)) drop-shadow(0 0 16px rgba(220, 187, 94, .5)); }
@media (prefers-reduced-motion: reduce) { .fill { animation: none; } }""")

# E. the cards: bigger, richer, a gold coin for the key, a gold fill when picked
p = P("pages", "study", "drills", "drills.module.css")
append(p, """/* round 17b: bigger cards, a gold coin for the key, a gold fill when picked */
.choice.choice { min-height: 74px; padding: 18px 22px; font-size: 20px; font-weight: 700; gap: 16px; border-radius: 18px; }
.choice .choiceKey.choiceKey { width: 40px; height: 40px; border-radius: 50%; font-size: 15px; background: linear-gradient(180deg, #fff1c2, #d9b84a 55%, #a8842c); color: #15120a; border-color: transparent; box-shadow: 0 2px 0 rgba(0, 0, 0, .35), 0 0 14px rgba(220, 187, 94, .3); }
.choice.choice[aria-checked="true"] { background: linear-gradient(180deg, #3a3014, #1c1810); color: #fff6dc; transform: translateY(-1px) scale(1.01); }
.choice.choice:hover:not(:disabled) { transform: translateY(-2px); }
.choiceLabel.choiceLabel { flex: 1 1 auto; min-width: 0; }
@media (max-width: 640px) { .choice.choice { min-height: 66px; padding: 15px 18px; font-size: 18px; } .choice .choiceKey.choiceKey { width: 36px; height: 36px; } }""")

# F. the pill when it is not ready: gold, dimmed, never grey
p = P("lab", "duo.module.css")
sub(p, ".startDisabled, .startDisabled:hover { filter: grayscale(.7) brightness(.5); animation: none; cursor: default; transform: none; }",
       ".startDisabled, .startDisabled:hover { opacity: .45; animation: none; cursor: default; transform: none; filter: none; }")

# G. the takeover: a stamp that SLAMS in across the screen, a bigger word, bigger lesson type
p = P("pages", "study", "RevealTakeover.jsx")
sub(p, """      {correct && <Confetti n={70} />}
      <div className={styles.panel}>""", """      {correct && <Confetti n={90} />}
      <div className={styles.slam} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="120" height="120" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {correct ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
        </svg>
      </div>
      <div className={styles.panel}>""")
sub(p, "<StudyMark mood={correct ? 'happy' : 'oops'} size={120} />", "<StudyMark mood={correct ? 'happy' : 'oops'} size={140} />")
p = P("pages", "study", "RevealTakeover.module.css")
append(p, """/* round 17b: the stamp slams across the screen first, then the card settles under it */
.slam { position: absolute; left: 50%; top: 38%; z-index: 3; width: 220px; height: 220px; margin: -110px 0 0 -110px; border-radius: 50%; display: grid; place-items: center; border: 10px solid currentColor; color: #4ad98a; background: rgba(11, 11, 11, .55); box-shadow: 0 0 60px rgba(47, 175, 104, .55); pointer-events: none; animation: slam .55s cubic-bezier(.2, 1.3, .3, 1) both, slamOut .5s ease-in 1.1s forwards; }
.bad .slam { color: #ff6b6b; box-shadow: 0 0 60px rgba(223, 70, 70, .55); }
@keyframes slam { from { transform: scale(3.2) rotate(-18deg); opacity: 0 } 55% { transform: scale(.92) rotate(4deg); opacity: 1 } to { transform: scale(1) rotate(0); opacity: 1 } }
@keyframes slamOut { to { transform: scale(1.3); opacity: 0 } }
.panel { animation-delay: .35s; gap: 14px; }
.art { width: 160px; height: 160px; }
.hero { font-size: 64px; }
.answerWord { font-size: 26px; }
.lesson.lesson [class*="partLabel"] { font-size: 13px; letter-spacing: .22em; color: #e9cd77; }
.lesson.lesson [class*="partText"] { font-size: 17px; line-height: 1.5; }
.lesson.lesson [class*="lesson"] { font-size: 17px; line-height: 1.5; }
@media (prefers-reduced-motion: reduce) { .slam { animation: none; opacity: 0; } }
@media (max-width: 640px) { .hero { font-size: 46px; } .art { width: 128px; height: 128px; } .slam { width: 170px; height: 170px; margin: -85px 0 0 -85px; } }""")
print("round 17b applied")
