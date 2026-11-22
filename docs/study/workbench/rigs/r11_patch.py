import io, os, json, glob
L = r'C:\Users\pgosz\uct-worktrees\study-hve-overlay\app\src\lab'
# piece 52 = the logo lab on the 3D logo (same showcase)
s = io.open(os.path.join(L, 'pieces', 'Piece46LogoLab.jsx'), encoding='utf-8').read()
s = s.replace('export default function Piece46LogoLab()', 'export default function Piece52LogoLab3D()').replace('Round 10, piece 1: THE LOGO replaces the character', 'Round 11, piece 1: THE LOGO IN REAL 3D (extruded geometry, lit sides)').replace('The logo · 3D, slow spin, throb, bounce', 'The logo · real 3D · slow spin, throb, bounce')
io.open(os.path.join(L, 'pieces', 'Piece52LogoLab3D.jsx'), 'w', encoding='utf-8', newline='\n').write(s)
# Lab.jsx map
P = os.path.join(L, 'Lab.jsx'); s = io.open(P, encoding='utf-8', newline='').read(); nl = '\r\n' if '\r\n' in s else '\n'
imp = "import Piece51TrapV2 from './pieces/Piece51TrapV2'"; assert imp in s
names = ['52LogoLab3D', '53BlitzV3', '54BossV3', '55HardV3', '56DrawItV3', '57TrapV3']
if 'Piece52LogoLab3D' not in s:
    s = s.replace(imp, imp + nl + nl.join(f"import Piece{x} from './pieces/Piece{x}'" for x in names))
    m = "const PIECES = {" + nl; assert m in s
    s = s.replace(m, m + nl.join(f"  {x[:2]}: Piece{x}," for x in names) + nl)
    io.open(P, 'w', encoding='utf-8', newline='').write(s)
# CSS: style pass + new bits
P = os.path.join(L, 'duo.module.css'); s = io.open(P, encoding='utf-8').read()
if 'round 11: the style pass' not in s:
    s += """
/* ── round 11: the style pass (the app's typeface, a tighter scale) and the new bits ──── */
.lesson { font-family: var(--font-sans, 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif); letter-spacing: .005em; }
.lesson .heroWord { font-size: 46px; letter-spacing: -.02em; }
.lesson .bubble { font-size: 18px; font-weight: 600; line-height: 1.35; padding: 13px 16px; }
.lesson .card { font-size: 16px; font-weight: 600; padding: 14px 16px; }
.lesson .startLead { font-size: 15px; color: #d9d4c8; }
.lesson .gem { min-width: 128px; } .lesson .gemIn b { font-size: 26px; } .lesson .gemIn { padding: 12px 14px 10px; }
.lesson .startBtn { padding: 12px 16px 12px 12px; } .lesson .startIcon { width: 40px; height: 40px; } .lesson .startText b { font-size: 15px; letter-spacing: .12em; }
.lesson .eyebrowG { font-size: 11px; letter-spacing: .2em; }
.lesson .btn { font-size: 15px; letter-spacing: .1em; }
.qLine { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 2px 2px 0; }
.qSetup { font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--gb); font-weight: 800; background: #1a1708; border: 1px solid #3a3115; border-radius: 999px; padding: 4px 10px; }
.qText { font-size: 15px; color: #e6e1d6; font-weight: 500; }
.whyLine { margin: 0; font-size: 14px; color: #d9d4c8; padding: 10px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
.runLog { width: 100%; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; text-align: left; }
.runLog > div { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; font-size: 13px; padding: 6px 10px; border-radius: 8px; background: var(--card); }
.runLog small { color: var(--mut); } .runOk b { color: #8fe3b1; } .runBad b { color: #ff9d9d; }
.stepRow { flex: 1; display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.stepPill { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; color: var(--mut); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; }
.stepPill.now { color: var(--gb); border-color: var(--g); background: #1a1708; } .stepPill.done { color: #8fe3b1; border-color: #1d7a45; }
.riskTag { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--mut); padding: 0 8px; } .riskTag b { color: var(--gb); }
.nudge button { font-size: 16px; min-width: 52px; user-select: none; touch-action: none; }
.ruleList { display: flex; flex-direction: column; gap: 4px; width: 100%; margin-top: 4px; }
.ruleList > span { display: grid; grid-template-columns: 18px 1fr; gap: 2px 8px; font-size: 12px; align-items: baseline; }
.ruleList > span small { grid-column: 2; color: var(--mut); font-size: 11px; }
.ruleOk b { color: #8fe3b1; } .ruleBad b { color: #ff9d9d; }
@media (max-width: 640px) { .lesson .heroWord { font-size: 36px; } .lesson .bubble { font-size: 16px; } .runLog { max-height: 160px; } }
"""
    io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
# the pulsing border off everywhere
for f in glob.glob(os.path.join(L, 'pieces', 'Piece*.jsx')):
    t = io.open(f, encoding='utf-8').read()
    if 's.pulse' in t:
        t2 = t
        for frag in ["${state === 'ask' && pick == null ? s.pulse : ''}", "${state === 'ask' && myPrice == null ? s.pulse : ''}", "${isTap && !tap && state === 'ask' ? s.pulse : ''}", "${!result && playing ? s.pulse : ''}", "${state === 'ask' && pick == null && !picked ? s.pulse : ''}"]:
            t2 = t2.replace(frag, '')
        if t2 != t:
            io.open(f, 'w', encoding='utf-8', newline='\n').write(t2); print('pulse removed:', os.path.basename(f))
        else:
            print('pulse still in:', os.path.basename(f))
# pieces.json batch 11
W = r'C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\walkthrough\pieces.json'
p = json.load(open(W, encoding='utf-8')); U = 'http://127.0.0.1:5232/lab.html?piece='
new = [
 {"id": "b11-logo", "batch": 11, "title": "1 · The logo in real 3D", "url": U + "52", "what": "Your compass mark is now real geometry (four ring arcs, two spikes, two points, the split candle and wicks) extruded with lit side faces, so it is a solid object from every angle, including sideways. Slow spin, throb, bounce; moods only change tempo and glow.", "judge": "Score the side view first. Then the proportions of the mark versus the real logo, the speed, the glow."},
 {"id": "b11-blitz", "batch": 11, "title": "2 · Blitz V3: fed by the bank, the real typeface", "url": U + "53", "what": "Every chart is an approved item from your Study bank (seven setups, pooled, shuffled), with the bank's own question (does the named setup fire on the last bar?) scored on the server. The workbench now loads the app's typeface (it never did before), and the type scale is tighter. Tutorial and practice kept.", "judge": "Style first: size, font, spacing, the intro card. Then: is a Yes/No on a named setup the right Blitz question, or do you want 'name the setup'?"},
 {"id": "b11-boss", "batch": 11, "title": "3 · Boss V3: ten bank charts", "url": U + "54", "what": "Ten different approved charts each run, scored on the server, the follow-through from the item's own forward bars, slower. The bar, the beating heart, the stamp, the crack, the medallion and the chest stay.", "judge": "What graphics still feel flat? Name the screen."},
 {"id": "b11-hard", "batch": 11, "title": "4 · Hard mode V3: name it, enter it, stop it", "url": U + "55", "what": "One chart, three steps: name the setup with candles only; then DAY 1: yesterday's high is drawn with its close and today's open, tap the line you buy over; then tap where the stop goes, graded against the house rule; then the next days arrive slowly, one every third of a second. Three for three = the fourth crown.", "judge": "Is this the interactive buy-day lesson you meant? Are the words for why/where/how right?"},
 {"id": "b11-draw", "batch": 11, "title": "5 · Draw it V3: the entry explained, a bigger quiet chart", "url": U + "56", "what": "The entry line is drawn from the start with why (sellers beaten over their high), where (one cent over yesterday's high) and how (a stop-buy). No pulsing border. The chart is taller and quiet (no toolbar, legend or range bar), 48 bigger candles. Stop: tap to place, tap again to move, HOLD an arrow to slide it, or type it; the ray tool is a toggle.", "judge": "Is placing and adjusting the stop easy enough now? Is the chart sized right?"},
 {"id": "b11-trap", "batch": 11, "title": "6 · Spot the trap V3: gold candles and rule cards", "url": U + "57", "what": "The three choosable candles are painted gold on the chart with a big letter; nothing pulses. Tap near one. On Check every candidate shows its rule card: a real red day before it (size), opens above the red body, closes strong, each ticked or crossed from the bars.", "judge": "Do the rule cards teach it the way you would? Which rules are missing?"},
]
p = [x for x in p if x.get('batch') != 11] + new
io.open(W, 'w', encoding='utf-8', newline='\n').write(json.dumps(p, ensure_ascii=False, indent=1) + '\n')
print('Lab map, CSS, batch 11 done;', len(p), 'pieces')
