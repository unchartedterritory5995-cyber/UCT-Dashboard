# Round 17 of the daily drill (owner's batch-16 verdicts, 2026-11-04). Every edit asserts its anchor; CRLF-aware.
import io, os, sys
APP = r"C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src"
def P(*a): return os.path.join(APP, *a)
def rd(p): return io.open(p, encoding="utf-8", newline="").read()
def wr(p, s): io.open(p, "w", encoding="utf-8", newline="").write(s)
def nl_of(s): return "\r\n" if "\r\n" in s else "\n"
def sub(path, old, new, count=1):
    s = rd(path); nl = nl_of(s); o = old.replace("\n", nl); n = new.replace("\n", nl)
    if n in s and o not in s: return
    assert s.count(o) >= 1, f"anchor missing in {os.path.basename(path)}: {old[:70]!r}"
    s = s.replace(o, n, count); wr(path, s)
def append(path, text):
    s = rd(path); nl = nl_of(s)
    if text.replace("\n", nl)[:60] in s: return
    wr(path, s.rstrip(nl) + nl + nl + text.replace("\n", nl) + nl)

# 1. the mark: a 'live' mood that visibly turns (7 s a turn) for the drill's bubble and the journey strip
p = P("components", "study", "StudyMark3D.jsx")
sub(p, "const SPEED = { idle: 12, think: 18, happy: 6, oops: 22, fire: 3.2 }   // seconds per turn",
       "const SPEED = { idle: 12, live: 7, think: 18, happy: 6, oops: 22, fire: 3.2 }   // seconds per turn ('live': the drill, visibly turning)")
sub(p, "mood === 'think' ? m.think : ''", "mood === 'think' || mood === 'live' ? m.think : ''")
sub(p, "/** @param {{ mood?: 'idle'|'think'|'happy'|'oops'|'fire'", "/** @param {{ mood?: 'idle'|'live'|'think'|'happy'|'oops'|'fire'")
p = P("components", "study", "StudyMark.jsx")
sub(p, "/** @param {{ mood?: 'idle'|'think'|'happy'|'oops'|'fire'", "/** @param {{ mood?: 'idle'|'live'|'think'|'happy'|'oops'|'fire'")

# 2. the chart: the MEMBER's own look (their chart_settings, as on the Charts tab) + the study gates + the item's averages
p = P("pages", "study", "studyChartLook.js")
append(p, """/**
 * memberSettingsOverride(chartOpts, extras) — round 17 (owner, batch 16: "not our complete and perfect UCT charts
 * that each user has in their settings in their widget in the charts tab?"): NO house look. StockChart merges the
 * member's own global chart_settings underneath, so the drill chart is the member's Charts-tab chart with the study
 * gates on top and the item's own averages / volume choice / engine lines, exactly as studySettingsOverride applies them.
 */
export function memberSettingsOverride(chartOpts, extras = null) {
  const o = chartOpts || {}
  let out = { ...STUDY_GATES }
  if (Array.isArray(o.overlays)) out = { ...out, overlays: o.overlays }
  else if (o.overlays === false) out = { ...out, overlays: CHART_DEFAULTS.overlays.map((ov) => ({ ...ov, enabled: false })) }
  if (o.volume === false) out = mergeSettingsOverride(out, { volume: { visible: false } })
  else if (o.volume === true) out = mergeSettingsOverride(out, { volume: { visible: true } })
  const instances = extras && Array.isArray(extras.instances) ? extras.instances : null
  if (instances && instances.length) out = mergeSettingsOverride(out, { indicatorInstances: instances })
  return out
}""")

# 3. StartButton: disabled + a test id, so it can be the drill's Check / Continue
p = P("lab", "StartCard.jsx")
sub(p, "export function StartButton({ icon = 'play', label, sub, onClick, tone = 'gold', hotkey = true, className = '', ariaLabel = null }) {",
       "export function StartButton({ icon = 'play', label, sub, onClick, tone = 'gold', hotkey = true, className = '', ariaLabel = null, disabled = false, testId = null }) {")
sub(p, "    if (!hotkey) return undefined", "    if (!hotkey || disabled) return undefined")
sub(p, "  }, [onClick, hotkey])", "  }, [onClick, hotkey, disabled])")
sub(p, "<button type=\"button\" className={`${d5.startBtn} ${tone === 'red' ? d5.startRed : tone === 'dark' ? d5.startDark : ''} ${className}`} onClick={onClick} aria-label={ariaLabel || undefined}>",
       "<button type=\"button\" className={`${d5.startBtn} ${tone === 'red' ? d5.startRed : tone === 'dark' ? d5.startDark : ''} ${disabled ? d5.startDisabled : ''} ${className}`} onClick={onClick} aria-label={ariaLabel || undefined} disabled={disabled} data-testid={testId || undefined}>")
p = P("lab", "duo.module.css")
append(p, "/* a StartButton that is not ready yet (the drill's Check before an answer is picked) */\n.startDisabled, .startDisabled:hover { filter: grayscale(.7) brightness(.5); animation: none; cursor: default; transform: none; }\n.startDisabled::after { animation: none; }")

# 4. the words: never "the firm" on screen (owner, batch 16) — display-level, bank text untouched
p = P("pages", "study", "drills", "types.js")
sub(p, "export function questionOf(item) {\n  const p = item?.prompt_json || {}\n  return p.q || p.question || p.prompt || p.text || ''\n}",
"""/** The brand on screen is UCT, never "the firm" (owner, 2026-11-04). Display-level: the bank's text is unchanged. */
export function brandWords(text) {
  if (text == null || text === '') return text
  return String(text)
    .replace(/\\bThe firm's\\b/g, "UCT's").replace(/\\bthe firm's\\b/g, "UCT's")
    .replace(/\\bThe firm\\b/g, 'UCT').replace(/\\bthe firm\\b/g, 'UCT')
}

export function questionOf(item) {
  const p = item?.prompt_json || {}
  return brandWords(p.q || p.question || p.prompt || p.text || '')
}""")

# 5. RevealCard: a hideVerdict prop (the takeover carries the verdict) and brand words on the lesson text
p = P("pages", "study", "RevealCard.jsx")
sub(p, "  attemptId = null, reviewer = false, feedback = true, post = studyFetch,\n}) {",
       "  attemptId = null, reviewer = false, feedback = true, post = studyFetch, hideVerdict = false,\n}) {")
sub(p, "      <StudyMark mood={correct ? 'happy' : 'oops'} size={44} className={styles.mark} />\n      <p className={`${styles.verdict} ${correct ? styles.verdictCorrect : styles.verdictWrong}`} role=\"status\" aria-live=\"polite\">",
       "      {!hideVerdict && <StudyMark mood={correct ? 'happy' : 'oops'} size={44} className={styles.mark} />}\n      {!hideVerdict && <p className={`${styles.verdict} ${correct ? styles.verdictCorrect : styles.verdictWrong}`} role=\"status\" aria-live=\"polite\">")
sub(p, "        {!correct && key && <span className={styles.verdictKey}>The answer: {key}</span>}\n      </p>",
       "        {!correct && key && <span className={styles.verdictKey}>The answer: {key}</span>}\n      </p>}")
sub(p, "              <dd className={styles.partText}>{p.text}</dd>", "              <dd className={styles.partText}>{brandWords(p.text)}</dd>")
sub(p, "        lesson && <p className={styles.lesson}>{lesson}</p>", "        lesson && <p className={styles.lesson}>{brandWords(lesson)}</p>")
sub(p, "              {next}\n", "              {brandWords(next)}\n")
s = rd(p); nl = nl_of(s)
sub(p, "import styles from './RevealCard.module.css'", "import { brandWords } from './drills/types'\nimport styles from './RevealCard.module.css'")

# 6. the answer cards: premium (owner: "horrible")
p = P("pages", "study", "drills", "drills.module.css")
s = rd(p); nl = nl_of(s)
start = s.index(".choice {"); end = s.index("}", start) + 1
if "position: relative;" in s[start:end]: new_choice = s[start:end]
new_choice = """.choice {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 64px;
  min-width: var(--tap-min);
  padding: 16px 18px;
  border: 1px solid #2e2a1e;
  border-radius: 16px;
  background: linear-gradient(180deg, #1b1a16, #121212);
  color: var(--text-bright);
  font: inherit;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: .005em;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(255, 255, 255, .04) inset, 0 8px 22px rgba(0, 0, 0, .45);
  transition: transform .1s, border-color .15s, background .15s, box-shadow .15s;
}
.choice::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 16px;
  pointer-events: none;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 241, 194, .05) 50%, transparent 70%);
  opacity: 0;
  transition: opacity .2s;
}
.choice:hover:not(:disabled) { border-color: #7a5f1c; background: linear-gradient(180deg, #211e14, #141414); transform: translateY(-1px); box-shadow: 0 1px 0 rgba(255, 255, 255, .05) inset, 0 12px 28px rgba(0, 0, 0, .5), 0 0 18px rgba(220, 187, 94, .14); }
.choice:hover:not(:disabled)::after { opacity: 1; }
.choice[aria-checked="true"] { border-color: var(--ut-gold); background: linear-gradient(180deg, #2a2410, #161410); box-shadow: 0 0 0 1px var(--ut-gold) inset, 0 0 26px rgba(220, 187, 94, .28), 0 12px 28px rgba(0, 0, 0, .5); }
.choice[aria-checked="true"] .choiceKey { background: linear-gradient(180deg, #fff1c2, #d9b84a 60%, #a8842c); color: #15120a; border-color: transparent; }"""
s = s[:start] + new_choice.replace("\n", nl) + s[end:]
wr(p, s)
# the key, the colours, the cascade
sub(p, ".choiceRight.choiceRight", ".choiceRight.choiceRight, .choiceRight.choiceRight[aria-checked=\"true\"]")
sub(p, ".choiceWrong.choiceWrong", ".choiceWrong.choiceWrong, .choiceWrong.choiceWrong[aria-checked=\"true\"]")
append(p, """/* round 17: the number key as a gold-rimmed tile; the right / wrong card glows its colour */
.choiceKey.choiceKey { width: 32px; height: 32px; border-radius: 9px; border: 1px solid #7a5f1c; background: #15120a; color: var(--ut-gold-bright); font-size: 14px; font-weight: 900; display: grid; place-items: center; flex: none; box-shadow: 0 0 0 1px rgba(255, 241, 194, .08) inset; }
.choiceRight.choiceRight { border-color: #2faf68; background: linear-gradient(180deg, #112a1b, #0f1a13); box-shadow: 0 0 0 1px #2faf68 inset, 0 0 28px rgba(47, 175, 104, .35); }
.choiceRight.choiceRight .choiceKey { background: linear-gradient(180deg, #bff3d3, #2faf68 60%, #1d7a45); color: #06130b; border-color: transparent; }
.choiceWrong.choiceWrong { border-color: #df4646; background: linear-gradient(180deg, #2a1113, #1a0f10); box-shadow: 0 0 0 1px #df4646 inset, 0 0 28px rgba(223, 70, 70, .35); }
.choiceWrong.choiceWrong .choiceKey { background: linear-gradient(180deg, #ffb3b3, #df4646 60%, #9a2e2e); color: #1a0606; border-color: transparent; }
.choices > li, .choicesGrid > li { animation: choiceIn .34s both; }
.choices > li:nth-child(2), .choicesGrid > li:nth-child(2) { animation-delay: 60ms; }
.choices > li:nth-child(3), .choicesGrid > li:nth-child(3) { animation-delay: 120ms; }
.choices > li:nth-child(4), .choicesGrid > li:nth-child(4) { animation-delay: 180ms; }
.choices > li:nth-child(5), .choicesGrid > li:nth-child(5) { animation-delay: 240ms; }
@keyframes choiceIn { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .choices > li, .choicesGrid > li { animation: none; } .choice:hover:not(:disabled) { transform: none; } }""")

# 7. EndCard: the score and the XP count up; a bigger ring; confetti from 8 of 10
p = P("pages", "study", "EndCard.jsx")
sub(p, "import { useEffect, useRef, useState } from 'react'", "import { useEffect, useRef, useState } from 'react'\nimport { useCountUp } from '../../lab/fx'")
sub(p, "export const RING_SIZE = 96", "export const RING_SIZE = 128")
sub(p, "export const RING_STROKE = 6", "export const RING_STROKE = 8")
sub(p, "  const [filled, setFilled] = useState(false)", "  const [filled, setFilled] = useState(false)\n  const shownCorrect = useCountUp(correct, true, 90)\n  const shownXp = useCountUp(Math.round(xp), true, 24)\n  const big = total > 0 && correct >= Math.ceil(total * 0.8)")
sub(p, "      {perfect && <Confetti />}", "      {big && <Confetti n={perfect ? 110 : 60} />}")
sub(p, "<StudyMark mood={perfect ? 'fire' : 'happy'} size={56} className={styles.ringMark} />", "<StudyMark mood={perfect ? 'fire' : 'happy'} size={56} />")
sub(p, "<div className={styles.ringMark}><StudyMark mood={perfect ? 'fire' : 'happy'} size={56} /></div>", "<div className={styles.ringMark}><StudyMark mood={perfect ? 'fire' : 'happy'} size={76} /></div>")
sub(p, "data-testid=\"end-score\">{correct} of {total}</p>", "data-testid=\"end-score\" data-final={`${correct} of ${total}`}>{shownCorrect} of {total}</p>")
sub(p, "<b className={styles.xpMain}>+{Math.round(xp)}</b>", "<b className={styles.xpMain} data-final={`+${Math.round(xp)}`}>+{shownXp}</b>")

# 8. DrillPlayer: the bubble, the stats strip, the journey, the member chart, the pointer, no run-on, the takeover, the button
p = P("pages", "study", "DrillPlayer.jsx")
sub(p, "import { Stamp } from '../../lab/bits'\n", "")
sub(p, "import { spot, rayAt } from '../../lab/pointers'", "import { spot, rayAt, arrowAt } from '../../lab/pointers'\nimport { StartButton } from '../../lab/StartCard'\nimport JourneyStrip from './JourneyStrip'\nimport RevealTakeover from './RevealTakeover'\nimport { barStats } from './drillLook'\nimport { memberSettingsOverride } from './studyChartLook'")
# the member's own chart look replaces the house look
sub(p, "  const houseSettings = useHouseChart(fetcher)\n", "")
sub(p, "    () => studySettingsOverride(chartOpts, houseSettings, { instances: slingshotInstances(chartItem) }),\n    [chartOpts, houseSettings, chartItem],",
       "    () => memberSettingsOverride(chartOpts, { instances: slingshotInstances(chartItem) }),\n    [chartOpts, chartItem],")
# no run-on: the forward bars land at once; the pointer gets a halo and an arrow
old_run = """  const forwardCount = phase === 'reveal' && Array.isArray(reveal?.forward_bars) ? reveal.forward_bars.length : 0
  const baseLen = Math.max(0, (chartBars?.length || 0) - forwardCount)
  const [run, setRun] = useState({ id: null, k: 0 })
  useEffect(() => {
    if (phase !== 'reveal' || !forwardCount || !item) return undefined
    let k = 0
    const t = setInterval(() => { k += 1; setRun({ id: item.id, k }); if (k >= forwardCount) clearInterval(t) }, 160)
    return () => clearInterval(t)
  }, [phase, forwardCount, item])
  const runK = run.id === item?.id ? run.k : 0
  const shownBars = useMemo(() => (forwardCount && chartBars ? chartBars.slice(0, baseLen + runK) : chartBars), [chartBars, forwardCount, baseLen, runK])
  const pointer = useMemo(() => {
    if (!chartVisible || !chartBars?.length || item?.type !== 'spot' || baseLen < 2) return null
    const i = baseLen - 1
    if (phase === 'reveal' && result) {
      return [...spot(chartBars, i, { label: result.correct ? 'you were right' : 'the answer', id: 'pt', color: result.correct ? '#2faf68' : '#df4646', halo: false }), ...rayAt(chartBars[i], 'l', { id: 'ptl', label: '' })]
    }
    return spot(chartBars, i, { label: 'this candle', id: 'pt', halo: false })
  }, [chartVisible, chartBars, item?.type, baseLen, phase, result])"""
new_run = """  // Round 17 (owner, batch 16): the forward bars land at once (the run-on was "UGLY"), and the pointer is the full
  // workbench pointer: a halo on the candle, an arrow into it, the label; green or red with the low-of-day ray on the reveal.
  const forwardCount = phase === 'reveal' && Array.isArray(reveal?.forward_bars) ? reveal.forward_bars.length : 0
  const baseLen = Math.max(0, (chartBars?.length || 0) - forwardCount)
  const shownBars = chartBars
  const pointer = useMemo(() => {
    if (!chartVisible || !chartBars?.length || item?.type !== 'spot' || baseLen < 2) return null
    const i = baseLen - 1
    if (phase === 'reveal' && result) {
      const color = result.correct ? '#2faf68' : '#df4646'
      return [...spot(chartBars, i, { label: result.correct ? 'you were right' : 'the answer', id: 'pt', color, halo: true }), ...arrowAt(chartBars, i, { id: 'pta', color }), ...rayAt(chartBars[i], 'l', { id: 'ptl', label: '' })]
    }
    return [...spot(chartBars, i, { label: 'this candle', id: 'pt', halo: true }), ...arrowAt(chartBars, i, { id: 'pta' })]
  }, [chartVisible, chartBars, item?.type, baseLen, phase, result])
  // the facts a trader reads before answering, from the bars in hand (the question's own window, not the forward bars)
  const stats = useMemo(() => (needsChart && chartBars?.length ? barStats(chartBars.slice(0, baseLen || chartBars.length)) : []), [needsChart, chartBars, baseLen])"""
sub(p, old_run, new_run)
# the ask row: a bigger, visibly turning mark and a stronger question; the stats strip instead of the framing line
sub(p, """        <div className={d5.ask}>
          <StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : state ? 'think' : 'idle'} size={60} />
          <div className={d5.bubble}><h2 className={styles.question} id="study-question">{questionOf(item)}</h2></div>
        </div>
        {needsChart && skillChip(item.skill_id) ? (
          <div className={d5.qLine}><span className={d5.qSetup}>{skillChip(item.skill_id)}</span>{framing && <span className={d5.qText}>{framing}</span>}</div>
        ) : (framing && <p className={styles.framing}>{framing}</p>)}""",
"""        <div className={`${d5.ask} ${styles.ask}`}>
          <StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : 'live'} size={88} />
          <div className={`${d5.bubble} ${styles.bubble}`}><h2 className={styles.question} id="study-question">{questionOf(item)}</h2></div>
        </div>
        {needsChart ? (
          <div className={styles.qLine}>
            {skillChip(item.skill_id) && <span className={d5.qSetup}>{skillChip(item.skill_id)}</span>}
            {stats.length > 0 && (
              <dl className={styles.stats} aria-label="Chart facts" data-testid="chart-stats">
                {stats.map((st) => (
                  <div key={st.id} className={`${styles.stat} ${styles[`stat_${st.tone}`] || ''}`}>
                    <dt>{st.label}</dt><dd>{st.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (framing && <p className={styles.framing}>{framing}</p>)}""")
# no stamp over the chart: the takeover carries it
sub(p, "          {chartVisible && phase === 'reveal' && result && !unscored && <Stamp ok={!!result.correct} />}\n", "")
# the journey strip
sub(p, "        <ProgressStrip index={s.index} total={s.items.length || SET_SIZE} results={s.results} items={s.items} />",
       "        <JourneyStrip index={s.index} total={s.items.length || SET_SIZE} results={s.results} items={s.items} />")
# the bottom: the takeover on a verdict; the gold Check pill otherwise
old_bottom = """      {!s.finished && s.status === 'ready' && item && (
        <div className={`${styles.bottom} ${phase === 'reveal' && result ? (result.correct ? styles.good : styles.bad) : ''}`}>
          {phase === 'reveal' && result && (
            <RevealCard correct={!!result.correct} reveal={reveal} item={item} profile={profile}
              attemptId={result.attempt_id ?? null} reviewer={reviewer} />
          )}
          <StickyActionBar className={styles.bar}>
            <button
              type="button"
              className={styles.primary}
              onClick={primary}
              disabled={phase === 'checking' || (phase === 'answer' && !answerable)}
              data-testid="primary-action"
            >
              {label}
            </button>
          </StickyActionBar>
        </div>
      )}"""
new_bottom = """      {!s.finished && s.status === 'ready' && item && phase === 'reveal' && result && !unscored && (
        <RevealTakeover correct={!!result.correct} reveal={reveal} item={item} profile={profile}
          attemptId={result.attempt_id ?? null} reviewer={reviewer} onContinue={primary} label={label} />
      )}
      {!s.finished && s.status === 'ready' && item && !(phase === 'reveal' && result && !unscored) && (
        <div className={styles.bottom}>
          {phase === 'reveal' && result && (
            <RevealCard correct={!!result.correct} reveal={reveal} item={item} profile={profile}
              attemptId={result.attempt_id ?? null} reviewer={reviewer} />
          )}
          <StickyActionBar className={styles.bar}>
            <StartButton
              icon={label === 'Check' ? 'check' : 'play'}
              label={label}
              onClick={primary}
              hotkey={false}
              disabled={phase === 'checking' || (phase === 'answer' && !answerable)}
              ariaLabel={label}
              testId="primary-action"
              className={styles.primaryBtn}
            />
          </StickyActionBar>
        </div>
      )}"""
sub(p, old_bottom, new_bottom)
# imports no longer used
s = rd(p)
for dead in ("import useHouseChart from './useHouseChart'\n", "import useHouseChart from './useHouseChart'\r\n"):
    s = s.replace(dead, "")
s = s.replace("import { studySettingsOverride }", "import { studySettingsOverride as _unusedStudySettingsOverride }") if "studySettingsOverride(" not in s.replace("memberSettingsOverride(", "") else s
wr(p, s)

# the stylesheet: the ask row, the stats strip, the pill in the bar
p = P("pages", "study", "DrillPlayer.module.css")
sub(p, """.question {
  margin: 0;
  color: var(--text-bright);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  text-wrap: balance;
}""", """.question {
  margin: 0;
  color: #f7f3e8;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -.01em;
  line-height: 1.28;
  text-wrap: balance;
  text-shadow: 0 2px 12px rgba(0, 0, 0, .5);
}
.ask.ask { gap: 18px; align-items: center; margin-bottom: 4px; }
.bubble.bubble { flex: 1 1 auto; min-width: 0; padding: 16px 20px; border-color: #5a4a1c; background: linear-gradient(180deg, #1f1a09, #141210); box-shadow: 0 10px 30px rgba(0, 0, 0, .5), 0 0 0 1px rgba(220, 187, 94, .08) inset; }
/* the setup chip beside the chart facts (round 17: the facts replace the framing line) */
.qLine { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 10px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.stat { display: flex; align-items: baseline; gap: 8px; padding: 6px 12px; border: 1px solid #262626; border-radius: 10px; background: linear-gradient(180deg, #161616, #0f0f0f); font-variant-numeric: tabular-nums; }
.stat dt { margin: 0; font-size: 10px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; color: #9a958a; }
.stat dd { margin: 0; font-size: 15px; font-weight: 800; color: #e6e1d6; }
.stat_up dd { color: #4ad98a; }
.stat_down dd { color: #ff6b6b; }
.primaryBtn.primaryBtn { margin: 0 auto; max-width: 520px; }
@media (max-width: 640px) {
  .question { font-size: 19px; }
  .ask.ask { gap: 12px; }
  .stat { padding: 5px 10px; } .stat dd { font-size: 14px; }
}""")

print("round 17 patch applied")
