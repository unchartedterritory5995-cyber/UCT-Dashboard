# Write Pine here like you write it on TradingView: full-parity plan + mockup

Owner goal (2026-11-02): someone fluent in Pine on TradingView can paste or write any open-source
indicator on our platform, and it runs and draws the same. Same language, same results, built
into our charts, screener, alerts and scans.

Sources for every number below: `docs/pine/COVERAGE-MAP.md` (census of 679 open-source scripts
through the real member door), `docs/pine/PHASE3-RUNTIME-PLAN.md` (runtime-lane measurements),
and today's runs (`_resume-2026-11-01/runs/`).

---

## 1. Where we stand (measured, not estimated)

| measure | value |
|---|---|
| Scripts that transfer fully through the production door | 185-211 of 679 (27-31%), depending on date measured |
| Same, with the dark runtime lane switched on | about 216-250 of 679 |
| Transfer AND have a TradingView capture that MATCHes | 34 of 679 (5%) |
| Strategies (`strategy()` scripts) that transfer fully | 0 of 70 |
| Vendor captures (graded against TradingView) | 336 |
| Engine accuracy on what it DOES draw | refuse-by-name policy; 6 releases today, every wrong value found was caught pre-production |

**The gap is coverage and evidence, not correctness.** What we draw is exact or refused by name.

## 2. The one architectural decision that makes "any script" possible

Today there are two ways a script runs:

1. **Host lane (translator).** Pine is translated into our columnar formula program. Fast, safe,
   cached, and it feeds alerts/scans/backtests on the server. But every Pine construct needs a
   hand-built translation, so coverage grows one shape at a time.
2. **Runtime lane (interpreter).** A bytecode VM in a Web Worker that executes Pine bar by bar,
   like TradingView does: `var`, `:=`, `if/for/while/switch`, UDF call frames, tuples, arrays,
   UDTs, history rings, 23 named limits, kill list, allowlist, per-member stage. It is built and
   DARK.

**Decision: the runtime lane becomes the general interpreter for anything the host lane cannot
translate.** The host lane stays the fast path for what it already handles. This is how "if you
know Pine you can build here" becomes true: the interpreter runs Pine's semantics, so new
language features are implemented once, not once per shape.

What that requires that does not exist yet:
- **Server-side execution of the same interpreter** (Node worker in the pod, or a sandboxed
  service) so alerts, scans and the screener run runtime-lane scripts too, not only the chart.
  Without this a runtime-lane script draws but cannot alert or screen.
- **One semantic spec, two hosts** (browser + server) proven identical by the same rails.

## 3. Member experience mockup

### 3.1 The Pine editor (Builder, Pine tab)

```
+----------------------------------------------------------------------------------+
| Builder  [Formula] [ PINE ] [Studio]                       v6  [Save] [Add chart] |
+---------------------------------------------+------------------------------------+
| //@version=6                                 | LIVE PREVIEW  AAPL  1D             |
| indicator("RSI Swing", overlay=true)         |   ~~~ chart with your plots ~~~    |
| len = input.int(14, "Length")                |   labels / lines / boxes drawn     |
| r = ta.rsi(close, len)                       |                                    |
| var label lb = na                            | STATUS                             |
| if ta.crossover(r, 70)                       |  [OK] Runs on: chart, alerts,      |
|     lb := label.new(bar_index, high, "OB")   |       screener, scans              |
| plot(r, color = r > 70 ? color.red : na)     |  [OK] Engine: host (fast path)     |
|                                              |  [i]  Verified vs TradingView: yes |
|                                              |       (capture RDDT 1D, MATCH)     |
| ^ line 6: ok                                 |                                    |
+---------------------------------------------+------------------------------------+
| PROBLEMS (0)   CONSOLE   REFERENCE   PORT FROM TRADINGVIEW                        |
+----------------------------------------------------------------------------------+
```

### 3.2 When something is not supported yet (never a silent wrong value)

```
| STATUS                                                                          |
|  [!] 1 line is not supported yet, so its value is withheld (not guessed):       |
|      line 14  request.security("SPY", "60", close)                              |
|      Why: other-symbol intraday data is not available yet.                      |
|      What still works: the other 3 plots and all labels.                        |
|      [Tell us you need this]  -> feeds the support-loop priority list           |
|  [i] Everything that IS drawn is computed the way TradingView computes it.      |
```

### 3.3 Paste-from-TradingView flow

```
 1. Paste source (or a TradingView script URL for open-source scripts)
 2. We show:  "Runs fully"  |  "Runs, 2 values withheld (why)"  |  "Not yet: needs X"
 3. One click: Add to chart  |  Use in screener  |  Create alert
 4. If anything is withheld: "Doesn't match TradingView?" report button (support loop, live)
```

### 3.4 What a Pine-fluent author gets that TradingView does not
- The same script powers **chart + screener column + scan + alert** with no rewrite.
- Every withheld value is **named and explained** in plain English.
- Version history and engine-upgrade notices (live since #673/#675).

## 4. Build plan: capability waves (ordered by scripts unblocked per COVERAGE-MAP 3.1/6)

Each wave ships through the same gate that worked today: build -> independent review ->
full tests on the merged tip -> C18 audit + census + harness vs production -> merge -> verify
live. Upper/firm = scripts unblocked on the 679 sample (upper counts scripts whose known walls
are all closed; firm counts only fully peeled scripts).

| wave | scope | unblocks (upper / firm) | size | depends on |
|---|---|---|---|---|
| W0 | **Measurement refresh**: re-run census + rank walls on today's master (engine 4); per-wall script lists | - | hours | - |
| W1 | **Names and robustness**: remaining missing built-ins (`ta.cmf`, `ta.obv`, calendar fields, `timeframe.*`, `fixnan`, `barstate.isnew`, `line.get_price`...), role-order maps, `input.time/enum`, translator timeouts | +40 / +24 | days to 2 wks | W0 |
| W2 | **Arm the runtime lane** (owner decision via checklist PHASE3 s4): admins -> allowlist -> cohort -> all | about +30 now | days | owner GO |
| W3 | **Drawing-object completeness**: conditional create/update/delete, per-bar labels, table cell text, drawings in loops/arrays, `polyline`, `linefill`, `chart.point` | +119 / +64 | 3-6 wks | - |
| W4 | **Runtime lane finished**: history/series semantics, block grammar, drawing from the run, builtins over state, input kinds, `varip` | +170 / +48 (PHASE3 s0) | 1-2 months | W2 |
| W5 | **Server-side interpreter** so runtime-lane scripts alert/scan/screen | enables W4 scripts everywhere | 3-6 wks | W4 |
| W6 | **Collections, UDTs, methods, enums, generics, `for...in`** | +30 / +11 | 3-6 wks | W4 |
| W7 | **`request.*`**: higher TF with lookahead/gaps semantics, other symbols beyond benchmark roster, lower-TF arrays; data contracts | +41 / +19 | 1-2 months | data |
| W8 | **Libraries (`import`)**: resolve published open libraries, module translation, versioning | +59 / +19 | 1-2 months | W4, W6 |
| W9 | **Strategy tester**: broker emulator, `strategy.*`, trade markers, tester report | +70 / +28 | quarter+ | W4 |
| E | **Evidence engine (runs alongside everything)**: automated TradingView capture from the owner's dedicated Chrome rig, auto-grade vs our output, capture queue burn-down | turns "attaches" into "MATCH" | continuous | owner rig |

Cumulative, if all land: about 100% door acceptance on the sample (upper), 60% firm; parity
rises only as captures land (W-E). Honest limits (COVERAGE-MAP s7): no fundamentals/economic/tick
data, closed/invite-only scripts, vendor-internal behaviours that can only be fitted capture by
capture, realtime/`varip` needs live witnesses.

## 5. What "today" can actually deliver

Realistic same-day outcome (machine rule: one heavy job at a time, maxWorkers=2):
1. **W0 measurement** on current master: fresh ranked wall list (about 1 hour of locked compute).
2. **W1 started**: 3-4 parallel build agents on independent built-in / input-kind items, each
   with rails + mutation proof; the first batch reviewed and shipped today if clean.
3. **W2 arming prep**: the PHASE3 s4 checklist evaluated against today's master, with a GO/NO-GO
   packet for the owner (arming itself is the owner's call).
4. **Editor mockup -> spec**: the status panel (3.1/3.2) wired to the existing refusal reasons
   (they already exist per output; this is mostly UI).

Not same-day, and why: W3-W9 are weeks to months of engine work, and each capability is only
"done" when TradingView captures prove it MATCHes. Skipping that proof is how wrong numbers ship;
today's six releases each had a real bug caught by it.

## 6. Owner decisions this plan needs
1. GO to arm the runtime lane (W2), stage by stage.
2. Server-side interpreter hosting choice (W5): in the web pod (simplest) vs a separate service
   (isolation; recommended for member-supplied code).
3. Data contracts for W7 (other-symbol intraday, more timeframes).
4. Capture time on the dedicated Chrome rig for the evidence engine (E).
5. Whether strategies (W9) are in scope this quarter.
