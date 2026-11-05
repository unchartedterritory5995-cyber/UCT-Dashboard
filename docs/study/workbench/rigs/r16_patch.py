import io, re, os
os.chdir(r'C:\Users\pgosz\uct-worktrees\study-hve-overlay\app')
def rd(p): return io.open(p, encoding='utf-8', newline='').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)
def nl_of(s): return '\r\n' if '\r\n' in s else '\n'
def rep(s, old, new, n=1):
    assert s.count(old) == n, (old[:70], s.count(old)); return s.replace(old, new)

# ── DrillPlayer.jsx ──
P = 'src/pages/study/DrillPlayer.jsx'; s = rd(P); nl = nl_of(s); N = lambda t: t.replace("\n", nl)
s = rep(s, "import { comboFeedback, feedbackPrefs, tapFeedback } from './studyFeedback'" + nl,
        "import { comboFeedback, feedbackPrefs, tapFeedback } from './studyFeedback'" + nl + N("""import StudyMark from '../../components/study/StudyMark'
import { Stamp } from '../../lab/bits'
import { spot, rayAt } from '../../lab/pointers'
import { setupName } from './challenges/challengeBank'
import d5 from '../../lab/duo.module.css'
"""))
s = rep(s, "export const SET_SIZE = 10" + nl, "export const SET_SIZE = 10" + nl + N("""
/** The chip over the chart: the skill in the member's words (the workbench's question chip). */
export function skillChip(skillId) {
  const id = String(skillId || '')
  if (!id) return ''
  if (id.startsWith('setup.')) return setupName(id)
  if (id === 'vocab.candle') return 'Candle name'
  if (id === 'vocab.chart') return 'Chart word'
  if (id.startsWith('size.')) return 'Sizing'
  if (id.startsWith('regime.')) return 'Regime'
  return id.split('.').pop().replace(/_/g, ' ')
}
"""))
s = rep(s, "  const reveal = result?.reveal || null" + nl, "  const reveal = result?.reveal || null" + nl + N("""  // THE WORKBENCH LOOK (owner, 2026-11-04: "it looks nothing like the work we did in the local host"): the forward
  // bars run on one at a time after the verdict instead of appearing at once, and a chart item carries the pointer
  // at the candle in question, then the verdict colour and the low-of-day ray on the reveal.
  const forwardCount = phase === 'reveal' && Array.isArray(reveal?.forward_bars) ? reveal.forward_bars.length : 0
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
  }, [chartVisible, chartBars, item?.type, baseLen, phase, result])
"""))
s = rep(s, N("""  const annotations = useMemo(
    () => (chartVisible && mod.annotationsFor ? mod.annotationsFor(state, item, reveal, chartBars) : null),
    [chartVisible, mod, state, item, reveal, chartBars],
  )
"""), N("""  const modAnnotations = useMemo(
    () => (chartVisible && mod.annotationsFor ? mod.annotationsFor(state, item, reveal, chartBars) : null),
    [chartVisible, mod, state, item, reveal, chartBars],
  )
  const annotations = useMemo(() => (modAnnotations || pointer ? [...(modAnnotations || []), ...(pointer || [])] : null), [modAnnotations, pointer])
"""))
s = rep(s, N("""        <h2 className={styles.question} id="study-question">{questionOf(item)}</h2>
        {framing && <p className={styles.framing}>{framing}</p>}
"""), N("""        <div className={d5.ask}>
          <StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : state ? 'think' : 'idle'} size={60} />
          <div className={d5.bubble}><h2 className={styles.question} id="study-question">{questionOf(item)}</h2></div>
        </div>
        {needsChart && skillChip(item.skill_id) ? (
          <div className={d5.qLine}><span className={d5.qSetup}>{skillChip(item.skill_id)}</span>{framing && <span className={d5.qText}>{framing}</span>}</div>
        ) : (framing && <p className={styles.framing}>{framing}</p>)}
"""))
s = rep(s, "              barsOverride={chartBars}" + nl, "              barsOverride={shownBars}" + nl)
s = rep(s, N("""          {chartVisible && Overlay && (
            <Overlay item={item} state={state} setState={setState} locked={locked} reveal={reveal} bars={chartBars} />
          )}
        </div>"""), N("""          {chartVisible && Overlay && (
            <Overlay item={item} state={state} setState={setState} locked={locked} reveal={reveal} bars={chartBars} />
          )}
          {chartVisible && phase === 'reveal' && result && !unscored && <Stamp ok={!!result.correct} />}
        </div>"""))
s = rep(s, "      <div className={styles.scroll}>{body}</div>" + nl, "      <div className={styles.scroll}><div className={`${d5.lesson} ${styles.lessonIn}`}>{body}</div></div>" + nl)
s = rep(s, "        <div className={styles.bottom}>" + nl, "        <div className={`${styles.bottom} ${phase === 'reveal' && result ? (result.correct ? styles.good : styles.bad) : ''}`}>" + nl)
wr(P, s)

# ── DrillPlayer.module.css ──
P = 'src/pages/study/DrillPlayer.module.css'; c = rd(P); nl = nl_of(c); N = lambda t: t.replace("\n", nl)
c = rep(c, N(""".seg, .segDone, .segCurrent {
  flex: 1 1 0;
  height: 4px;
  border-radius: 2px;
  background: var(--border-accent);
}
.segDone { background: var(--ut-gold); }
.segCurrent { background: var(--ut-gold-glow); box-shadow: inset 0 0 0 1px var(--ut-gold); }"""), N(""".seg, .segDone, .segCurrent {
  flex: 1 1 0;
  height: 10px;
  border-radius: 5px;
  background: #222;
}
.segDone { background: linear-gradient(90deg, #b8942e, var(--ut-gold-bright)); box-shadow: 0 0 10px rgba(220, 187, 94, .35); }
.segCurrent { background: var(--ut-gold); opacity: .35; }"""))
c = rep(c, N(""".question {
  margin: 0 0 var(--space-sm);
  color: var(--text-bright);
  font-size: 16px;
  font-weight: 600;
  line-height: var(--lh-snug);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}"""), N("""/* the question lives in the workbench's bubble beside the mark */
.question {
  margin: 0;
  color: var(--text-bright);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  text-wrap: balance;
}
.lessonIn { padding-bottom: var(--space-md) !important; }"""))
c = rep(c, N(""".chartBox {
  position: relative;
  width: 100%;
  min-height: 240px;
  margin: 0 0 var(--space-lg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-surface);
}"""), N(""".chartBox {
  position: relative;
  width: 100%;
  min-height: 240px;
  margin: 0;
  border: 1px solid #262626;
  border-radius: 12px;
  overflow: hidden;
  background: #0f0f0f;
}"""))
c = rep(c, ".body { margin: 0 0 var(--space-lg); }", ".body { margin: 0; }")
c = rep(c, N(""".primary {
  min-height: 52px;
  min-width: var(--tap-min);
  border: none;
  border-radius: var(--radius-lg);
  background: var(--ut-gold);
  color: #141410;
  font: inherit;
  font-size: var(--text-lg);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
}
.primary:hover { background: var(--ut-gold-bright); }
.primary:disabled { opacity: 0.45; cursor: default; }"""), N("""/* the workbench's footer button: wide, capitals, brushed gold when live, dark when not */
.primary {
  min-height: 52px;
  min-width: var(--tap-min);
  border: 0;
  border-bottom: 4px solid #8a6f22;
  border-radius: 14px;
  background: linear-gradient(180deg, var(--ut-gold-bright), var(--ut-gold));
  color: #111;
  font: inherit;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
}
.primary:hover { filter: brightness(1.06); }
.primary:disabled { background: #262626; border-bottom-color: #1a1a1a; color: #6b665c; cursor: default; opacity: 1; }
.good .bar.bar { background: #0f2a18; }
.bad .bar.bar { background: #2a1113; }
.bad .primary { background: linear-gradient(180deg, #ff6b6b, #c41f2d); border-bottom-color: #6a1016; color: #fff; }"""))
wr(P, c)

# ── drills.module.css: the answer cards ──
P = 'src/pages/study/drills/drills.module.css'; c = rd(P); nl = nl_of(c); N = lambda t: t.replace("\n", nl)
i = c.find('.choice {'); j = c.find('.choice:hover')
assert i > 0 and j > i
c = c[:i] + N("""/* the workbench's answer cards: a numbered key chip, a thick bottom edge, gold when picked, green / red after the verdict */
.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  min-width: var(--tap-min);
  padding: 14px 18px;
  border: 1px solid #262626;
  border-bottom-width: 4px;
  border-radius: 14px;
  background: #141414;
  color: var(--text-bright);
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: transform .08s, border-color .12s, background .12s;
}
""") + c[j:]
c = rep(c, ".choice:hover { background: var(--bg-hover); }", N(""".choice:hover:not(:disabled) { transform: translateY(-2px); border-color: #3a3a3a; }
.choice:active:not(:disabled) { border-bottom-width: 1px; transform: translateY(3px); }"""))
c = rep(c, N(""".choice[aria-checked="true"] {
  border-color: var(--ut-gold);
  background: var(--ut-gold-dim);
  color: var(--text-bright);
}
.choice:disabled { cursor: default; opacity: 0.85; }
.choiceKey {
  flex: 0 0 auto;
  width: 20px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}"""), N(""".choice[aria-checked="true"] {
  border-color: var(--ut-gold);
  background: #1a1708;
  color: var(--ut-gold-bright);
  box-shadow: 0 0 0 1px var(--ut-gold) inset;
}
.choice[aria-checked="true"] .choiceKey { border-color: var(--ut-gold); color: var(--ut-gold-bright); }
.choice:disabled { cursor: default; }
.choiceRight.choiceRight { border-color: #2faf68; background: #0f2a18; color: #8fe3b1; box-shadow: none; }
.choiceWrong.choiceWrong { border-color: #df4646; background: #2a1113; color: #ff9d9d; box-shadow: none; }
.choiceKey {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: inline-grid;
  place-items: center;
  border: 1px solid #333;
  border-radius: 7px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}"""))
wr(P, c)

# ── ChoiceList: the right / wrong colours after the verdict ──
P = 'src/pages/study/drills/ChoiceList.jsx'; s = rd(P); nl = nl_of(s); N = lambda t: t.replace("\n", nl)
s = rep(s, "import styles from './drills.module.css'" + nl, "import styles from './drills.module.css'" + nl + "import { answerWord } from '../revealCardHelpers'" + nl)
s = rep(s, "export default function ChoiceList({ choices, value, onChange, disabled = false, label = 'Choices', showKeys = true }) {",
        N("""/** After the verdict: the bank's answer and, when the pick missed, the pick, so the cards can show green and red. */
export function revealLabels(reveal, state) {
  if (!reveal) return {}
  const right = answerWord(reveal) || null
  const pick = state?.choice ?? null
  return { rightLabel: right, wrongLabel: right != null && pick != null && pick !== right ? pick : null }
}

export default function ChoiceList({ choices, value, onChange, disabled = false, label = 'Choices', showKeys = true, rightLabel = null, wrongLabel = null }) {"""))
s = rep(s, "              className={styles.choice}" + nl, "              className={`${styles.choice} ${rightLabel != null && choice === rightLabel ? styles.choiceRight : ''} ${wrongLabel != null && choice === wrongLabel ? styles.choiceWrong : ''}`}" + nl)
wr(P, s)
for f in ('SpotDrill.jsx', 'RecallDrill.jsx', 'RegimeDrill.jsx', 'ScenarioDrill.jsx', 'CallDrill.jsx'):
    P = 'src/pages/study/drills/' + f; s = rd(P); nl = nl_of(s)
    s = s.replace("import ChoiceList from './ChoiceList'", "import ChoiceList, { revealLabels } from './ChoiceList'")
    s = re.sub(r"export function Body\(\{ item, state, setState, locked \}\)", "export function Body({ item, state, setState, locked, reveal })", s)
    s = s.replace("<ChoiceList" + nl, "<ChoiceList {...revealLabels(reveal, state)}" + nl)
    assert 'revealLabels(reveal, state)' in s and 'locked, reveal' in s, f
    wr(P, s)

# ── EndCard.module.css: the art row and the hero score ──
P = 'src/pages/study/EndCard.module.css'; c = rd(P); nl = nl_of(c); N = lambda t: t.replace("\n", nl)
c = c.rstrip(nl) + nl + N("""
/* the workbench end card: the ring and the mark side by side with the medal and chest on a perfect set */
.artRow { display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap; }
.ringWrap { position: relative; }
.ringMark { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.score.score { margin: 0; }
""")
wr(P, c)

# ── RevealCard.module.css: the card in the workbench's lesson-card frame ──
P = 'src/pages/study/RevealCard.module.css'; c = rd(P); nl = nl_of(c); N = lambda t: t.replace("\n", nl)
c = rep(c, N(""".card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg) var(--space-sm);
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  max-height: 45vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}"""), N(""".card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg) var(--space-sm);
  border-top: 1px solid var(--border);
  border-left: 3px solid var(--ut-gold);
  background: linear-gradient(180deg, #171717, #0f0f0f);
  max-height: 45vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}"""))
c = rep(c, N(""".verdict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  line-height: var(--lh-tight);
}"""), N(""".verdict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.01em;
  line-height: var(--lh-tight);
}"""))
wr(P, c)
print('round 16 patch applied')
