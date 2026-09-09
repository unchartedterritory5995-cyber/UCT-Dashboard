# Lane 6 — does our Pine corpus look like the wild?

**Read-only research, 2026-09-08.** Sources: `origin/master` fixture trees (read via `git show`, never the
stale working tree) and the parallel survey's artefacts in `scratchpad/acq/`. Nothing in the repo was
touched. The acq pipeline was **still running while this was written** — `inventory.json`,
`agg_*.json` and `engine_status.json` all grew during the session (agg_presentation went from 193 to
1,443 scripts between two reads, and `engine_refusal_agg.json` briefly vanished mid-rewrite). Every
ecosystem number below is stamped with the sample size it was computed on; re-derive before quoting.

---

## 0. The true corpus count — it is **137**, not 169

| directory | `.pine` files | other files | what they are |
|---|---|---|---|
| `tests/fixtures/pine/` | **21** | `README.md`, `SOURCES.md` | third-party scripts hand-picked from **GitHub** collections (everget, f13end, casoon, ArunKBhaskar, btankutt…) |
| `tests/fixtures/pine_community/` | **30** | `README.md`, `SOURCES.md` | third-party scripts fetched from **TradingView** by boost rank, 2026-08-25 |
| `tests/fixtures/pine_blind/` | **48** | `INTENTS.json` | **repo-authored** blind screener conditions, one intent each |
| `tests/fixtures/pine_screener/` | **38** | — | **repo-authored** single-condition screener grammar fixtures |
| **total** | **137** | 5 | 142 files |

`git ls-tree -r --name-only origin/master -- tests/fixtures/pine…​ | grep -c '\.pine$'` → **137**, and
there are no `.pine` files anywhere else on `origin/master`.

**What "169" probably counted.** No count of `.pine` files on master reaches 169. The two nearest
arithmetics both land on 168:

- every *file* in the four Pine directories (142) **plus** every file in `tests/fixtures/thinkscript/`
  (26, of which 24 are `.ts` scripts) = **168** — i.e. README/SOURCES/INTENTS counted as scripts and the
  ThinkScript corpus counted as Pine;
- 137 `.pine` on master **plus** the 30 git-tracked `.pine` files in `tests/fixtures/pine_oos/` on the
  **unmerged** `worktree-indicator-ecosystem` branch = **167**.

⚠️ **A count taken from a worktree instead of `origin/master` is wrong in the other direction.** The
`indicator-ecosystem` worktree carries **295** `.pine` files across nine fixture directories —
`pine_oos` (60), `pine_c1` (3), `pine_multiplot` (5), `pine_render_controls` (4) on top of the four that
are on master. None of that is merged. Whatever "169" was, it is not a count of our committed Pine
corpus, and it is not a count of anything reproducible from `origin/master`.

### The finding nobody asked for but that changes the plan: `pine_oos` already exists

`tests/fixtures/pine_oos/` on `worktree-indicator-ecosystem` (frozen `2026-09-07T12:24Z`,
`freeze_id 5df718c2…`) is a **60-script out-of-sample corpus with a MANIFEST that already implements
the licence gate this task asks for**:

- quota **20 high-engagement / 20 mid-engagement / 20 long-tail** — an explicit popularity spread;
- `near_dup_threshold: 0.85`, complexity buckets (`short ≤40`, `medium 41–90`, `long >90`) on
  non-comment lines;
- `sha256_source` **and** `sha256_normalized` per entry;
- a per-entry **`storage` field: `"git"` (30 files) vs `"local-only"` (30 files)**. All 7 entries whose
  header declares CC BY-NC-SA / CC BY-NC are `local-only`, and I verified the two NC files present on
  disk are **untracked** by git. The policy is being enforced, per file, mechanically.

⭐ **The expansion plan below therefore extends `pine_oos`'s conventions rather than inventing new
ones** — `storage: git|local-only` is a better gate than a prose note in a README, and the
`commit_source_allowed` flag in Deliverable B maps onto it one-for-one.

### ⛔⛔ But the two corpora apply **two different licence rules to the same class of file**

Cross-tabulating `pine_oos`'s `storage` against the licence its own manifest recorded:

| | `storage: "git"` | `storage: "local-only"` |
|---|---|---|
| MPL-2.0 declared in header | **27** | 0 |
| MIT declared in header | **3** | 0 |
| CC BY-NC-SA / CC BY-NC | 0 | **7** |
| **licence "not stated"** | **0** | **23** |

`pine_oos` treats *no licence line* as **not committable**. `tests/fixtures/pine_community/` — already on
master — treats *no licence line* as **MPL-2.0 by TradingView Terms of Use §22 and commits it**: 19 of
its 30 files carry no licence line, and all 19 are committed on that reasoning, quoted verbatim in its
`SOURCES.md`.

**Both cannot be the policy.** This is not a detail: **168 of the 370 commit-eligible entries in
Deliverable B are "no licence line"**. Under the master `pine_community` rule they are committable;
under the `pine_oos` rule they are not, and commit-eligible drops from **370 to 202**. Deliverable B is
written to the **master rule** (it is the one that is actually committed and documented) and every such
entry is tagged `licence_detected_raw: "NONE-IN-SOURCE (TV default MPL-2.0)"` so a single query flips
them if the owner picks the stricter reading. **This needs one owner decision before any ingest, and it
is the only blocking question in this plan.**

### One licence defect on master, found while counting

`tests/fixtures/pine/12-ichimoku-clouds.pine` **is committed and its own header declares
`Attribution-NonCommercial-NoDerivatives 4.0 International (CC BY-NC-ND 4.0)`.** The policy written in
`tests/fixtures/pine_community/README.md` — that non-commercial scripts are skipped and not committed —
was applied to the *community* corpus (LuxAlgo's S/R was skipped for exactly this reason) but was never
applied backwards to the GitHub-sourced corpus, whose `SOURCES.md` records the licence in plain sight.
It is one file, and NoDerivatives is the strictest of the family. Flagging, not fixing — this is a
read-only lane, and it is an owner call of the same shape the READMEs already record.

---

## 1. Every corpus script, mapped

Two category columns, deliberately. **`category`** is what the artefact *is*: for `pine_blind/` and
`pine_screener/` that is `screener/scanner`, because each of those files is a single screener condition
authored by this repo, not a published indicator. **`subject / shape`** is what it is *about*. Read both;
the gap verdict changes depending on which one you use, and hiding that choice would cook the result.

| # | file | dir | category | subject / shape | Pine | decl | lines | drawing objs | arrays | loops | req.security | UDT | presentation primitives |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `01-stoch-rsi-screener.pine` | `pine` | screener/scanner | momentum · 40-symbol request.security screener, label table | v5 | `indicator` | 214 | yes | — | 1 | 40 | — | `hline`×3 `plot`×2 `fill`×1 `label.new`×1 `label.delete`×1 `alert`×1 |
| 2 | `02-ict-retracement-to-order-block-screener.pine` | `pine` | screener/scanner | market structure · ICT order block, screener table | v5 | `indicator` | 474 | yes | 2 | 4 | 1 | — | `plotshape`×6 `plot`×4 `line.new`×2 `line.delete`×2 `table.new`×1 `table.cell`×1 |
| 3 | `03-rsi-directional-momentum-scanner.pine` | `pine` | screener/scanner | momentum · scanner table | v6 | `indicator` | 783 | yes | 3 | 8 | 1 | — | `plot`×10 `plotshape`×10 `hline`×5 `barcolor`×5 `bgcolor`×4 `table.cell`×3 … |
| 4 | `04-superguppy-supertrend-screener.pine` | `pine` | screener/scanner | trend · Guppy MMA + SuperTrend, alertconditions | v4 | `study` | 568 | yes | — | 1 | 40 | — | `plotshape`×20 `label.new`×2 `label.delete`×2 `alertcondition`×2 `barcolor`×1 |
| 5 | `05-mtf-structure-bias.pine` | `pine` | market structure / smart-money | MTF · 4x request.security structure bias | v6 | `indicator` | 133 | yes | — | — | 3 | — | `table.cell`×21 `hline`×3 `alertcondition`×2 `plot`×1 `table.new`×1 |
| 6 | `06-adx-advanced.pine` | `pine` | trend | ADX/DI + 4 alertconditions | v6 | `indicator` | 210 | — | — | — | — | — | `plot`×8 `plotshape`×4 `alertcondition`×4 `hline`×3 `fill`×2 |
| 7 | `07-rsi.pine` | `pine` | momentum | RSI with band fills | v3 | `study` | 97 | — | — | — | — | — | `hline`×5 `fill`×3 `plot`×1 |
| 8 | `08-stochastic-v4.pine` | `pine` | momentum | v4 stochastic, bare sma/stoch | v4 | `study` | 58 | — | — | — | — | — | `hline`×5 `fill`×4 `plot`×3 `plotshape`×2 `bgcolor`×1 |
| 9 | `09-on-balance-volume.pine` | `pine` | volume | OBV + smoothing MA | v3 | `study` | 31 | — | — | — | — | — | `plot`×2 `plotshape`×2 `fill`×1 |
| 10 | `10-supertrend.pine` | `pine` | trend | ATR trailing stop, flip markers | v6 | `indicator` | 79 | — | — | — | — | — | `plotshape`×4 `plot`×3 `alertcondition`×3 `fill`×2 |
| 11 | `11-donchian-channel.pine` | `pine` | volatility | Donchian bands + fill | v3 | `study` | 58 | — | — | — | — | — | `plot`×3 `alertcondition`×2 `fill`×1 `bgcolor`×1 |
| 12 | `12-ichimoku-clouds.pine` | `pine` | trend | Ichimoku cloud — CC BY-NC-ND 4.0 IN SOURCE | v3 | `study` | 141 | — | — | 1 | 6 | — | `plot`×19 `plotshape`×2 `fill`×2 `alertcondition`×2 |
| 13 | `13-average-true-range.pine` | `pine` | volatility | ATR in 4 unit modes, 6 alertconditions | v3 | `study` | 109 | — | — | — | — | — | `alertcondition`×6 `plot`×2 `bgcolor`×1 |
| 14 | `14-bollinger-bands-fixed-timeframe.pine` | `pine` | volatility | fixed-TF Bollinger + %B | v1 | `study` | 59 | — | — | 1 | — | — | `plot`×3 `plotshape`×2 `alertcondition`×2 `fill`×1 |
| 15 | `15-anchored-vwap.pine` | `pine` | volume | anchored VWAP + sigma bands + table | v6 | `indicator` | 221 | yes | — | 1 | — | — | `table.cell`×10 `plot`×5 `plotshape`×3 `alertcondition`×3 `fill`×2 `table.new`×1 |
| 16 | `16-smacd.pine` | `pine` | momentum | MACD variant, columns | v3 | `study` | 34 | — | — | — | — | — | `plot`×1 |
| 17 | `17-simple-moving-average.pine` | `pine` | trend | 9-line SMA overlay | v3 | `study` | 10 | — | — | — | — | — | `plot`×1 |
| 18 | `18-normalized-average-true-range.pine` | `pine` | volatility | NATR, 11 lines | v3 | `study` | 11 | — | — | — | — | — | `plot`×1 |
| 19 | `19-strategy-supertrend-atr.pine` | `pine` | trend | strategy() — the corpus's ONLY strategy | v3 | `strategy` | 146 | — | — | — | — | — | `plot`×3 `bgcolor`×1 |
| 20 | `20-smc-toolkit-udt.pine` | `pine` | market structure / smart-money | UDT + arrays + box/line/label — 1 of only 2 UDT files | v6 | `indicator` | 476 | yes | 10 | 15 | — | 3 | `alertcondition`×6 `label.new`×4 `box.new`×4 `line.new`×2 |
| 21 | `21-volume-profile-plus.pine` | `pine` | order flow | volume profile, float arrays, box/line/label | v6 | `indicator` | 269 | yes | 4 | 9 | — | — | `label.new`×3 `line.new`×3 `box.new`×2 `alertcondition`×1 |
| 22 | `breakout-donchian-breakout-volume.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 24 | — | — | — | — | — | `plot`×1 |
| 23 | `breakout-fifty-two-week-high-proximity.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 23 | — | — | — | — | — | `plot`×1 |
| 24 | `breakout-flat-base-pivot-breakout.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 22 | — | — | — | — | — | `plot`×1 |
| 25 | `breakout-gap-up-holding.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 20 | — | — | — | — | — | `plot`×1 |
| 26 | `breakout-squeeze-release-breakout.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 26 | — | — | — | — | — | `plot`×1 |
| 27 | `breakout-tight-consolidation-range.pine` | `pine_blind` | screener/scanner | momentum (breakout) | v6 | `indicator` | 26 | — | — | — | 2 | — | `plot`×1 |
| 28 | `candles-bullish-engulfing-pullback.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 18 | — | — | — | — | — | `plot`×1 |
| 29 | `candles-doji-at-extension.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 18 | — | — | — | — | — | `plot`×1 |
| 30 | `candles-hammer-at-support.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 20 | — | — | — | — | — | `plot`×1 |
| 31 | `candles-key-reversal-bar.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 16 | — | — | — | — | — | `plot`×1 |
| 32 | `candles-red-to-green-day.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 18 | — | — | — | — | — | `plot`×1 |
| 33 | `candles-strong-closing-range.pine` | `pine_blind` | screener/scanner | candlestick patterns | v6 | `indicator` | 21 | — | — | — | — | — | `plot`×1 |
| 34 | `meanrev-atr-stretch-below-ema.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 22 | — | — | — | — | — | `plot`×1 |
| 35 | `meanrev-bollinger-lower-band-tag.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 21 | — | — | — | — | — | `plot`×1 |
| 36 | `meanrev-consecutive-down-closes-exhaustion.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 23 | — | — | 1 | — | — | `plot`×1 |
| 37 | `meanrev-rsi-oversold-uptrend-pullback.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 19 | — | — | — | — | — | `plot`×1 |
| 38 | `meanrev-stochastic-deep-oversold-cross.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 20 | — | — | — | — | — | `plot`×1 |
| 39 | `meanrev-zscore-multi-oscillator-washout.pine` | `pine_blind` | screener/scanner | momentum (mean reversion) | v6 | `indicator` | 22 | — | — | — | 1 | — | `plot`×1 |
| 40 | `momentum-adx-trend-strength.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 16 | — | — | — | — | — | `plot`×1 |
| 41 | `momentum-ma-stack-alignment.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 20 | — | — | — | — | — | `plot`×1 |
| 42 | `momentum-momentum-acceleration.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 18 | — | — | — | — | — | `plot`×1 |
| 43 | `momentum-new-52w-high-breakout.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 16 | — | — | — | — | — | `plot`×1 |
| 44 | `momentum-rising-ma-trend-template.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 17 | — | — | — | — | — | `plot`×1 |
| 45 | `momentum-rs-leaders-vs-spy.pine` | `pine_blind` | screener/scanner | momentum | v6 | `indicator` | 21 | — | — | — | 1 | — | `plot`×1 |
| 46 | `multifactor-exhaustion-fade-short.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 19 | — | — | — | — | — | `plot`×1 |
| 47 | `multifactor-gap-up-continuation-hold.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 18 | — | — | — | — | — | `plot`×1 |
| 48 | `multifactor-pocket-pivot-accumulation.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 19 | — | — | — | — | — | `plot`×1 |
| 49 | `multifactor-rsi-pullback-in-uptrend.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 23 | — | — | — | — | — | `plot`×1 |
| 50 | `multifactor-squeeze-breakout-relative-strength.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 25 | — | — | — | 1 | — | `plot`×1 |
| 51 | `multifactor-weekly-trend-daily-macd-trigger.pine` | `pine_blind` | screener/scanner | other (multi-factor composite) | v6 | `indicator` | 20 | — | — | — | 3 | — | `plot`×1 |
| 52 | `recency-breakout-hold-since-trigger.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 13 | — | — | — | — | — | `plot`×1 |
| 53 | `recency-fresh-golden-cross.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 16 | — | — | — | — | — | `plot`×1 |
| 54 | `recency-macd-turn-recent.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 12 | — | — | — | — | — | `plot`×1 |
| 55 | `recency-pullback-down-streak.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 12 | — | — | — | — | — | `plot`×1 |
| 56 | `recency-rsi-reclaim-recent.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 13 | — | — | — | — | — | `plot`×1 |
| 57 | `recency-stalled-under-high.pine` | `pine_blind` | screener/scanner | other (bars-since / recency) | v6 | `indicator` | 13 | — | — | — | — | — | `plot`×1 |
| 58 | `volatility-atr-expansion-breakout.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 28 | — | — | — | — | — | `plot`×1 |
| 59 | `volatility-bb-kc-squeeze-fire.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 26 | — | — | — | — | — | `plot`×1 |
| 60 | `volatility-hv-percentile-crush.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 25 | — | — | — | — | — | `plot`×1 |
| 61 | `volatility-inside-bar-continuation.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 28 | — | — | — | — | — | `plot`×1 |
| 62 | `volatility-nr7-coil-uptrend.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 27 | — | — | — | — | — | `plot`×1 |
| 63 | `volatility-range-contraction-base.pine` | `pine_blind` | screener/scanner | volatility | v6 | `indicator` | 30 | — | — | — | 1 | — | `plot`×1 |
| 64 | `volume-capitulation-volume-reversal.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 25 | — | — | — | — | — | `plot`×1 |
| 65 | `volume-dollar-volume-money-flow.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 28 | — | — | 1 | — | — | `plot`×1 |
| 66 | `volume-obv-accumulation-divergence.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 22 | — | — | — | — | — | `plot`×1 |
| 67 | `volume-pocket-pivot-up-volume.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 24 | — | — | 1 | — | — | `plot`×1 |
| 68 | `volume-rvol-breakout-thrust.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 25 | — | — | — | — | — | `plot`×1 |
| 69 | `volume-volume-dry-up-tight-base.pine` | `pine_blind` | screener/scanner | volume | v6 | `indicator` | 29 | — | — | — | — | — | `plot`×1 |
| 70 | `01-squeeze-momentum-lazybear.pine` | `pine_community` | momentum | LazyBear SQZMOM | v1 | `study` | 41 | — | — | — | — | — | `plot`×2 |
| 71 | `02-wavetrend-oscillator-lazybear.pine` | `pine_community` | momentum | WaveTrend | v1 | `study` | 33 | — | — | — | — | — | `plot`×8 |
| 72 | `03-cm-williams-vix-fix.pine` | `pine_community` | volatility | Williams Vix Fix | v1 | `study` | 28 | — | — | — | — | — | `plot`×4 |
| 73 | `04-ut-bot-alerts.pine` | `pine_community` | volatility | ATR trailing stop | v4 | `study` | 42 | — | — | — | 1 | — | `plotshape`×2 `barcolor`×2 `alertcondition`×2 |
| 74 | `05-chandelier-exit.pine` | `pine_community` | volatility | ATR exit — GPL-3.0 | v6 | `indicator` | 58 | — | — | 1 | — | — | `plotshape`×4 `plot`×3 `alertcondition`×3 `fill`×2 |
| 75 | `06-qqe-mod.pine` | `pine_community` | momentum | QQE MOD | v6 | `indicator` | 95 | — | — | — | — | — | `plot`×4 `alertcondition`×2 `hline`×1 |
| 76 | `07-hull-suite.pine` | `pine_community` | trend | HMA/THMA/EHMA band + MTF security | v4 | `study` | 52 | — | — | 3 | 1 | — | `plot`×2 `alertcondition`×2 `fill`×1 `barcolor`×1 |
| 77 | `08-smoothed-heiken-ashi-candles.pine` | `pine_community` | trend | HA transform, plotcandle | v2 | `study` | 22 | — | — | — | — | — | `plotcandle`×1 |
| 78 | `09-obv-oscillator-lazybear.pine` | `pine_community` | volume | OBV oscillator | v1 | `study` | 16 | — | — | — | — | — | `plot`×2 `hline`×1 |
| 79 | `10-ehlers-instantaneous-trend-lazybear.pine` | `pine_community` | trend | Ehlers ITrend | v1 | `study` | 22 | — | — | — | — | — | `plot`×3 `fill`×2 `barcolor`×1 |
| 80 | `11-52-week-high-low.pine` | `pine_community` | support/resistance | 52w high/low levels | v3 | `study` | 16 | — | — | — | 4 | — | `plot`×2 |
| 81 | `12-vcp-tightness-score.pine` | `pine_community` | volatility | VCP tightness | v5 | `indicator` | 53 | — | — | — | — | — | `hline`×3 `plot`×1 |
| 82 | `13-relative-strength-vs-benchmark-spy.pine` | `pine_community` | breadth | RS vs SPY, request.security | v5 | `indicator` | 33 | — | — | — | 1 | — | `plot`×2 `alertcondition`×2 `bgcolor`×1 |
| 83 | `14-earnings-gap-ups.pine` | `pine_community` | other | event/earnings gap + volume, labels | v6 | `indicator` | 114 | yes | 1 | 1 | — | 1 | `label.new`×6 `line.new`×4 `box.new`×1 |
| 84 | `15-inside-bar.pine` | `pine_community` | candlestick patterns | inside bar — GNU 2.0 | v4 | `study` | 30 | — | — | — | — | — | `plotshape`×2 `barcolor`×2 `alertcondition`×1 |
| 85 | `16-nr4-nr7.pine` | `pine_community` | volatility | narrow-range bars | v2 | `study` | 12 | — | — | — | — | — | `plotshape`×2 `barcolor`×2 |
| 86 | `17-pocket-pivot-breakout.pine` | `pine_community` | volume | pocket pivot | v6 | `indicator` | 35 | — | 1 | 2 | — | — | `alertcondition`×2 `plotshape`×1 `barcolor`×1 |
| 87 | `18-minervini-trend-template.pine` | `pine_community` | trend | trend template, table | v5 | `indicator` | 126 | yes | — | — | — | — | `table.cell`×4 `plot`×2 `table.new`×1 |
| 88 | `19-cm-macd-ult-mtf.pine` | `pine_community` | multi-timeframe dashboard | v1 security() MACD | v1 | `study` | 54 | — | — | — | 3 | — | `plot`×4 `hline`×1 |
| 89 | `20-cm-ultimate-ma-mtf.pine` | `pine_community` | multi-timeframe dashboard | v1 security() MA | v1 | `study` | 61 | — | — | — | 2 | — | `plot`×3 |
| 90 | `21-ma-cross-alert-mtf-chartart.pine` | `pine_community` | multi-timeframe dashboard | v1 MA cross MTF | v1 | `study` | 81 | — | — | — | 1 | — | `plot`×3 `plotshape`×2 `fill`×1 `bgcolor`×1 `barcolor`×1 |
| 91 | `22-daily-weekly-monthly-highs-lows.pine` | `pine_community` | support/resistance | D/W/M levels, lines, max_lines_count | v5 | `indicator` | 137 | yes | 4 | 2 | 3 | — | `plot`×6 `line.new`×2 `line.delete`×2 |
| 92 | `23-higher-timeframe-ema.pine` | `pine_community` | multi-timeframe dashboard | HTF EMA, 18 lines | v6 | `indicator` | 18 | — | — | — | 2 | — | `plot`×1 |
| 93 | `24-multi-timeframe-rsi.pine` | `pine_community` | multi-timeframe dashboard | v1 MTF RSI | v1 | `study` | 29 | — | — | — | 7 | — | `plot`×8 |
| 94 | `25-spy-expected-move-by-vix.pine` | `pine_community` | volatility | VIX-implied expected move, ticker.new | v6 | `indicator` | 172 | — | — | 1 | 2 | — | `plot`×21 `fill`×10 |
| 95 | `26-spy-to-es-qqq-to-nq.pine` | `pine_community` | other | cross-symbol price mapping | v5 | `indicator` | 117 | yes | — | 2 | 3 | — | `plot`×23 `table.cell`×2 `table.new`×1 |
| 96 | `27-support-resistance-channels.pine` | `pine_community` | support/resistance | boxes + arrays, LonesomeTheBlue | v6 | `indicator` | 193 | yes | 6 | 15 | — | — | `plotshape`×4 `plot`×2 `alertcondition`×2 `box.new`×1 `box.delete`×1 |
| 97 | `28-support-resistance-dynamic-v2.pine` | `pine_community` | support/resistance | dynamic S/R, lines + arrays | v5 | `indicator` | 153 | yes | 6 | 9 | — | — | `alertcondition`×3 `plotshape`×2 `label.new`×1 `line.new`×1 `label.delete`×1 `line.delete`×1 … |
| 98 | `29-zigzag-plus-plus.pine` | `pine_community` | market structure / smart-money | zigzag, lines + labels | v5 | `indicator` | 87 | yes | — | — | — | — | `alertcondition`×7 `label.new`×2 `line.new`×2 `plotarrow`×1 `bgcolor`×1 `label.delete`×1 … |
| 99 | `30-pivot-points-high-low-mtf.pine` | `pine_community` | support/resistance | pivots, max_lines_count=500 | v5 | `indicator` | 62 | yes | 1 | — | 1 | — | `line.new`×6 `label.new`×2 |
| 100 | `01-oversold-in-uptrend.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 101 | `02-volume-surge-up-day.pine` | `pine_screener` | screener/scanner | volume | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 102 | `03-near-52w-high.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 103 | `04-bollinger-breakout.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 104 | `05-bollinger-squeeze.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 105 | `06-macd-histogram-positive.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 106 | `07-macd-cross-up.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 107 | `08-adx-trending.pine` | `pine_screener` | screener/scanner | trend | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 108 | `09-true-range-expansion.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 109 | `10-atr-percent.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 110 | `11-ema-stack.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 111 | `12-inside-day.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 112 | `13-gap-up-held.pine` | `pine_screener` | screener/scanner | candlestick patterns | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 113 | `14-twenty-day-high-on-volume.pine` | `pine_screener` | screener/scanner | volume | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 114 | `15-higher-lows-run.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 115 | `16-pullback-in-uptrend.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 116 | `17-above-vwap.pine` | `pine_screener` | screener/scanner | volume | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 117 | `18-stochastic-oversold.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 118 | `19-williams-oversold.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 119 | `20-rate-of-change.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 120 | `21-momentum-positive.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 121 | `22-price-crosses-ma.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 122 | `23-pivot-high-recent.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 123 | `24-with-member-inputs.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 6 | — | — | — | — | — | `plot`×1 |
| 124 | `25-with-a-user-function.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 5 | — | — | — | — | — | `plot`×1 |
| 125 | `26-multi-line-conditions.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 6 | — | — | — | — | — | `plot`×1 |
| 126 | `27-alertcondition-only.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 5 | — | — | — | — | — | `alertcondition`×1 |
| 127 | `28-distance-from-52w-low.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 128 | `29-body-versus-range.pine` | `pine_screener` | screener/scanner | candlestick patterns | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 129 | `30-typical-price-above-ma.pine` | `pine_screener` | screener/scanner | trend / support-resistance | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 130 | `31-cci-oversold.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 131 | `32-money-flow-oversold.pine` | `pine_screener` | screener/scanner | momentum | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 132 | `33-obv-rising.pine` | `pine_screener` | screener/scanner | volume | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 133 | `34-bars-since-signal.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 134 | `35-log-return-20d.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 135 | `36-squared-deviation.pine` | `pine_screener` | screener/scanner | volatility | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 136 | `37-weekday-above-ma.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 4 | — | — | — | — | — | `plot`×1 |
| 137 | `38-switch-smoothing-choice.pine` | `pine_screener` | screener/scanner | language mechanics | v6 | `indicator` | 8 | — | — | — | — | — | `plot`×1 |

---

## 2. Side-by-side — category mix

**Ecosystem denominators.** `catalog.json` holds **6,156** scripts: **4,898 open-source (access 1)**,
932 protected (access 2), 326 invite-only (access 3). All ecosystem percentages below are over the
**4,898 open-source** ones, since those are the only ones we could ever ingest.

⛔ **The catalogue is a stratified sample, not a census.** It was built from **169 search queries**
capped at **50 results each**; **119 of the 167 queries that produced a hit returned exactly 50**, i.e. they saturated. So the
catalogue's category mix is partly an artefact of how many queries were written per theme (**20** SMC/ICT-adjacent
queries × 50 slots each vs one `breadth thrust` query that returned 14). The uncapped queries are the
informative ones — they measure real scarcity: `cup and handle` 5, `statistics table` 3, `gartley` 9,
`half trend` 6, `change of character` 6, `wedge pattern` 11, `k means` 11, `relative strength
comparison` 11, `triangle pattern` 13, `flag pattern` 13, `breadth thrust` 14. Two independent
classifications are given so the design artefact is visible: **query-stratum** (the search term that
actually retrieved the script) and **title-only** (regex over the title, 9.9% unclassifiable).

| category | OURS (artifact view) | OURS (subject view) | ecosystem, query-stratum | ecosystem, title-only | verdict | plan adds |
|---|---|---|---|---|---|---|
| trend | 9 (6.6%) | 18 (13.1%) | 631 (12.9%) | 426 (8.7%) | in line | 66 |
| momentum | 6 (4.4%) | 33 (24.1%) | 596 (12.2%) | 501 (10.2%) | **under** ×2.8 | 52 |
| volatility | 10 (7.3%) | 22 (16.1%) | 536 (10.9%) | 433 (8.8%) | in line | 49 |
| volume | 4 (2.9%) | 14 (10.2%) | 384 (7.8%) | 385 (7.9%) | **under** ×2.7 | 40 |
| breadth | 1 (0.7%) | 1 (0.7%) | 202 (4.1%) | 162 (3.3%) | **under** ×5.7 | 16 |
| market structure / smart-money | 3 (2.2%) | 3 (2.2%) | 572 (11.7%) | 562 (11.5%) | **under** ×5.3 | 78 |
| order flow | 1 (0.7%) | 1 (0.7%) | 261 (5.3%) | 216 (4.4%) | **under** ×7.3 | 34 |
| candlestick patterns | 1 (0.7%) | 9 (6.6%) | 235 (4.8%) | 342 (7.0%) | **under** ×6.6 | 24 |
| harmonic patterns | 0 (0.0%) | 0 (0.0%) | 200 (4.1%) | 224 (4.6%) | **ABSENT** from our corpus | 22 |
| support/resistance | 5 (3.6%) | 5 (3.6%) | 331 (6.8%) | 456 (9.3%) | in line | 60 |
| session tools | 0 (0.0%) | 0 (0.0%) | 249 (5.1%) | 187 (3.8%) | **ABSENT** from our corpus | 18 |
| multi-timeframe dashboard | 5 (3.6%) | 5 (3.6%) | 199 (4.1%) | 222 (4.5%) | in line | 30 |
| machine-learning-styled | 0 (0.0%) | 0 (0.0%) | 145 (3.0%) | 120 (2.4%) | **ABSENT** from our corpus | 14 |
| visual decoration | 0 (0.0%) | 0 (0.0%) | 157 (3.2%) | 45 (0.9%) | **ABSENT** from our corpus | 10 |
| screener/scanner | 90 (65.7%) | 4 (2.9%) | 89 (1.8%) | 131 (2.7%) | **over** ×36.2 | 12 |
| other | 2 (1.5%) | 22 (16.1%) | 111 (2.3%) | 486 (9.9%) | in line | 12 |

---

## 3. Side-by-side — Pine version mix

Ecosystem side = the **1,425** downloaded scripts whose source was parsed for a `//@version` line.
⚠️ `catalog.json`'s `version` field is **not** the Pine version — it is TradingView's publication
revision counter (`"1"` ×3,077, `"2"` ×1,075 …). I verified this by joining it against the parsed
`pine_version` of the downloaded sources: revision `"1"` maps to Pine v4, v5 and v6 alike. The one real
signal in it is **`version == "-1"` (262 scripts), which maps almost perfectly to "no `//@version`
line"** — i.e. a legacy v1 script.

| Pine version | OURS | share | downloaded ecosystem sample | share | verdict |
|---|---|---|---|---|---|
| v1 (no `//@version`) | 10 | 7.3% | 158 | 11.1% | **under** ×1.5 |
| v2 | 2 | 1.5% | 29 | 2.0% | in line |
| v3 | 10 | 7.3% | 56 | 3.9% | **over** ×1.9 |
| v4 | 5 | 3.6% | 240 | 16.8% | **under** ×4.6 |
| v5 | 10 | 7.3% | 545 | 38.2% | **under** ×5.2 |
| v6 | 100 | 73.0% | 397 | 27.9% | **over** ×2.6 |

**Declarations.** Ours: `indicator()` 110, `study()` 26, **`strategy()` 1**. Ecosystem catalogue:
`study` 5,665 (92.0%), **`strategy` 482 (7.8%)**, `library` 9. Downloaded sample: `indicator` 925,
`study` 440, `strategy` 78 (5.4%). We have **one** strategy fixture against an ecosystem that is 6–8%
strategies, and **zero** libraries against 8.6% of downloaded sources that `import` one.

---

## 4. Side-by-side — primitive mix

Ecosystem side = `agg_presentation.json` at **n_scripts = 1,443** (its own header; it read 193 earlier
in the same session — the pipeline is live). Our side = the same regex census run over the 137
committed files.

| primitive | ecosystem: % of scripts | ecosystem: call sites | OURS: % of scripts | OURS: call sites |
|---|---|---|---|---|
| `plot` | 62.2% | 4,898 | **90.5%** | 263 |
| `label.new` | 41.5% | 2,852 | **5.8%** | 21 |
| `line.new` | 41.2% | 3,405 | **6.6%** | 23 |
| `fill` | 31.3% | 1,225 | 11.7% | 36 |
| `plotshape` | 28.1% | 1,739 | 13.1% | 74 |
| `box.new` | 25.1% | 1,274 | **2.9%** | 8 |
| `line.delete` | 20.4% | 1,637 | 2.9% | 6 |
| `label.delete` | 19.1% | 1,343 | 2.9% | 5 |
| `table.new` | 17.6% | 307 | 4.4% | 7 |
| `barcolor` | 16.3% | 315 | 6.6% | 16 |
| `table.cell` | 13.9% | 2,285 | 4.4% | 41 |
| `box.delete` | 11.8% | 553 | 0.7% | 1 |
| `bgcolor` | 10.0% | 277 | 5.8% | 11 |
| `hline` | 10.0% | 388 | 7.3% | 30 |
| `plotcandle` | 7.8% | 144 | 0.7% | 1 |
| `plotchar` | 7.1% | 422 | **0** | 0 |
| `linefill.new` | 6.2% | 204 | **0** | 0 |
| `chart.point.from_index` | 4.1% | 397 | **0** | 0 |
| `polyline.new` | 3.8% | 153 | **0** | 0 |
| `table.merge_cells` | 3.0% | 129 | **0** | 0 |
| mutators (`line.set_*`, `box.set_*`, `label.set_*`) | 2–8% each, **~4,500 call sites in total** | | one file, one call (`label.set_text`) | 1 |

`alertcondition` is the one place we are *over*: 16.1% of our files against 28.1% of the catalogue's
6,156 — in line. Everything in the drawing family is 4×–17× under. **The entire mutator surface — the
`line.set_xy2` / `box.set_right` / `label.set_x` idiom that redraws an object each bar, ~4,500 call sites
in the wild — is represented in our corpus by a single `label.set_text`.**

---

## 5. The finding, plainly

> ### Our corpus does not look like the wild. It is a portrait of the screener door, in Pine v6, drawn with `plot()`.

Three numbers carry it.

1. **86 of 137 files (62.8%) are repo-authored screener conditions** (`pine_blind` 48 +
   `pine_screener` 38), and 4 more of the third-party files are screeners, so **90 of 137 (65.7%) of the
   corpus is screener-shaped** — against **1.8%** of the surveyed ecosystem (query-stratum) or 2.7%
   (title-only). Only **51 files (37.2%) are third-party published Pine at all**, and only **30 of those
   came from TradingView**; the other 21 are GitHub files, a different population with a different
   licence profile.
2. **Drawing objects: 11.7% of ours vs 59.7% of the wild.** Sixteen files touch `label`/`line`/`box`/
   `table`; **zero** touch `polyline`, `linefill`, `chart.point` or `table.merge_cells`. UDTs:
   **2 files (1.5%) vs 18.3%**. `method`: **1 vs 9.7%**. Arrays: **7.3% vs 43.2%**. Loops: 15.3% vs
   47.3%.
3. **Pine v6 is 73.0% of our corpus and 27.9% of the wild**, because 86 of our files were written by
   this repo last month. Median file length: **ours 21 lines, the wild 158** — our p75 (41 lines) sits
   below the ecosystem's p25 (74).

And the translator's own verdict says the same thing from the other side. The committed snapshot
`pineCorpus.json` records **14 of 21 `pine/` scripts translating (66.7%)**. The survey ran the same
translator over the downloaded wild: **247 of 770 (32.1%)**. Our corpus is roughly **twice as easy** as
the population it is supposed to represent, so **every headline number computed on it is optimistic by
about a factor of two**, and the corpus cannot currently move when the drawing-object work lands,
because it barely contains any.

Nothing here says the corpus is bad at its job. `pine_screener` and `pine_blind` are a *screener
grammar* regression net and they are dense and useful as one. The claim being refuted is only that they
are a sample of the ecosystem.

---

## 6. The popularity dimension

Only **30 of 137 files (21.9%)** were selected by boosts at all — the `pine_community/` bucket.
`pine/` came from GitHub (no boost exists), `pine_blind` and `pine_screener` were authored here. So the
popularity question can only be asked of 30 files, and for those the answer is: **no, the distribution
does not resemble the catalogue's — it is a portrait of the top of the site.**

| population | n | p10 | p25 | median | p75 | p90 | max |
|---|---|---|---|---|---|---|---|
| ecosystem, all open-source scripts in the catalogue | 4,898 | 77 | 247 | **773** | 2,335 | 5,582 | 165,046 |
| the survey's downloaded sample | 1,425 | 2,220 | 2,819 | **4,279** | 6,839 | 11,531 | 165,046 |
| OUR `pine_community/` 30 (the only boost-selected files we have) | 30 | 626 | 1,602 | **13,501** | 28,594 | 65,068 | 115,429 |

**Our community-30 median is 13,501 boosts against an ecosystem median of 773 — 17.5×.** Our p10 (626)
is roughly the ecosystem's *median*. Nine of the 30 sit at or above **25,000** boosts — a band that holds
**38 of 4,898 open-source scripts (0.78%)** site-wide.

⚠️ **The survey's own downloaded sample inherits the same bias** (median 4,279 — **its 10th percentile,
2,220, sits just below the ecosystem's 75th, 2,335**). So "the ecosystem" as
measured by `inventory.json`/`agg_*.json` is *the popular ecosystem*. Anything that expands the corpus
only from what is already downloaded will re-commit this bias, which is why Deliverable B reserves
**20% of every category quota (107 of 537) for scripts below the 773-boost median** — and those can only
come from the catalogue, not from the download set.

The bias is not automatically wrong: boosts correlate with what a member is likely to paste into our
box. But it is a *product* choice that has to be made deliberately, and right now the corpus makes it by
accident, in one bucket, with no long tail at all.

---

## 7. Difficulty spread

| dimension | OURS (n=137) | ecosystem sample (n=1,425) | ratio |
|---|---|---|---|
| any drawing object (label/line/box/polyline/table/linefill) | 16 (11.7%) | 851 (59.7%) | **5.1× under** |
| `table.new` | 6 (4.4%) | 253 (17.8%) | **4.1× under** |
| `polyline.new` | 0 (0.0%) | 55 (3.9%) | **∞ — zero in our corpus** |
| arrays / matrix / map | 10 (7.3%) | 616 (43.2%) | **5.9× under** |
| `for`/`while` loops | 21 (15.3%) | 674 (47.3%) | **3.1× under** |
| `request.security` | 25 (18.2%) | 324 (22.7%) | in line (1.2×) |
| user-defined types (`type`) | 2 (1.5%) | 261 (18.3%) | **12.5× under** |
| `method` | 1 (0.7%) | 138 (9.7%) | **13.3× under** |
| `switch` | 7 (5.1%) | 358 (25.1%) | **4.9× under** |
| library `import` | 1 (0.7%) | 122 (8.6%) | **11.7× under** |

Read the last column as "how much harder the wild is on this axis". Three entries matter most:

- **UDTs and `method`.** 18.3% of downloaded wild sources declare a `type`; 9.7% define a `method`. We
  have exactly **two** `type` files — `pine/20-smc-toolkit-udt.pine` (3 types) and
  `pine_community/14-earnings-gap-ups.pine` (1 type, and the corpus's only 3 `method` definitions, over an
  `array<gap>`) — and **one** library `import` (`pine_community/29-zigzag-plus-plus.pine`). `feat:udt_types` shows 660 call sites over 264 scripts in `agg_computation.json` —
  this is a mainstream v5/v6 idiom, not an exotic one.
- **The object-pool idiom.** The wild allocates typed arrays *of drawing objects*: `array.new_line` 145
  scripts / 421 sites, `array.new_box` 110/286, `array.new_label` 79/190, `array.new_float` 248/1,027,
  plus `matrix.new` and `map.new` in the tail. Our 10 array files use plain float arrays. The
  "allocate → push → loop → delete oldest" pattern that dominates every S/R, order-block and zigzag
  script in the wild is present in our corpus in **two** files.
- **`request.security` is the one axis where we are already fine**: 18.2% of ours vs 22.7% of the wild
  (and `request.security_lower_tf` 3.7%, `request.earnings`/`dividends`/`splits` 0.3% each — all four
  absent from our corpus, but they are genuinely rare).

Refusal histogram from the survey's run over the wild, for context on where the difficulty actually
bites: `pine:no-output` 16.7%, `pine:character` 15.8%, `pine:state` 7.3%, `pine:tuple` 6.2%,
`pine:function` 5.8%, `pine:module` 5.4%, `pine:reassign` 4.9%, `pine:declaration-strategy` 3.9%. Our
corpus's own refusals (from `pineCorpus.json`) are `pine:state` 3, `pine:function` 3, `pine:request` 2,
`pine:builtin` 2, `pine:plot-offset` 2 — **it never once produces the two largest refusal classes in the
wild**, because it contains almost nothing that draws.

---

## 8. Deliverable B — the expansion plan

`scratchpad/research/corpus_expansion_plan.json` — **537 entries**, all
`access == 1` (open-source) in `catalog.json`, zero duplicates, zero overlap with the 30 scripts already
in `pine_community/` (deduped on TradingView page id, which is the catalogue's `imageUrl` field — the
`/script/<id>-slug/` token in our own `SOURCES.md`).

### Licence split — the number that governs everything else

| | count | share |
|---|---|---|
| **`commit_source_allowed: true`** — source may be committed | **370** | 68.9% |
| **reference-only** | **167** | 31.1% |
| … because the header declares a **non-commercial** licence (CC BY-NC-SA / CC BY-NC) | 34 | 6.3% |
| … because the licence **cannot be established without fetching** the source | 133 | 24.8% |

Of the 370 commit-eligible: **196 declare MPL-2.0** in their own header, **168
carry no licence line** and are therefore MPL-2.0 by TradingView Terms of Use §22 (the exact rule
`pine_community/SOURCES.md` already quotes), 3 CC BY-SA, 1 MIT, 1 GPL-3.0, 1 GPL. ⛔ **If the owner
adopts `pine_oos`'s stricter reading instead — no licence line means no commit — commit-eligible falls
from 370 to 202 and reference-only rises to 335.** See §0; this is the one decision that has to be made
before step 1 of the ingest. The GPL entries are
the same owner call already recorded for `tests/fixtures/pine/` (6 GPL-3.0 files) and
`pine_community/05` + `/15`; they are flagged in `licence_status` so the call is visible rather than
inherited silently.

⛔ **No non-commercially-licensed source is proposed for commit.** The 34 CC BY-NC-SA entries are in the
plan *as behaviour observations only* — fetch, translate, record the verdict in a manifest, do not write
the `.pine` into the repo. This is exactly the `storage: "local-only"` mechanism `pine_oos/MANIFEST.json`
already uses, and it is why those 34 are in the plan at all: **22.3% of the downloaded ecosystem is
CC BY-NC-SA (321 of 1,425 with a readable licence, plus 1 CC BY-NC)**, so a corpus that silently omits
them is a corpus that has never measured a quarter of the wild. The published claim of "215 of the first
800" is consistent with the live number.

Every one of the 133 unknown-licence entries is
`commit_source_allowed: false` **until its header has been read**. Most will turn out MPL-2.0 or
no-licence-line and become committable; the plan does not assume that.

### Category balance — against the ecosystem, not against us

Quotas were set from the ecosystem mix (§2), **not** from ours. Actual counts match target for every
category. The plan adds the four categories our corpus has **zero** of — harmonic patterns 22, session
tools 18, machine-learning-styled 14, visual decoration 10 — and deliberately under-weights
`screener/scanner` to 12, because we already have 90.

### Difficulty spread

| difficulty tier | count | share of the 537 |
|---|---|---|
| T1 easy · plot-only | 38 | 7.1% |
| T2 plot family + fill/shape/alert/security | 86 | 16.0% |
| T3 drawing objects (label/line/box/table) | 87 | 16.2% |
| T4 arrays + loops (+ drawings) | 120 | 22.3% |
| T5 UDT / method / matrix / map / library import | 73 | 13.6% |
| unmeasured — source not yet fetched | 133 | 24.8% |

Among the 404 entries whose
source is already on disk and inventoried, the measured spread is T1 9.4% / T2 21.3% / T3 21.5% /
T4 29.7% / T5 18.1% — i.e. **69% of them use drawing objects, arrays or UDTs**, matching the wild
(59.7% / 43.2% / 18.3%) rather than our current 11.7% / 7.3% / 1.5%. The 133 unmeasured entries are the
long-tail and gap-filling picks; their tier is unknown until fetch, and the plan says so.

### Version and declaration spread

| Pine version | count |
|---|---|
| v5 | 136 |
| unknown — source not yet fetched | 128 |
| v4 | 102 |
| v6 | 100 |
| v1 (no //@version line) | 35 |
| v3 | 16 |
| v2 | 15 |
| v1 (inferred: catalog revision -1) | 5 |

`strategy()` **47 entries** — up from one in the whole current corpus, and roughly the ecosystem's 6–8%.
`study()` 266 / `indicator()` 224 keeps the legacy v1–v4 dialects in the net instead of letting the
corpus drift to v6-only.

### Popularity spread

`popularity_stratum`: **430 popular / 107 long tail** (below the 773-boost ecosystem median). Plan
boosts: p10 668, p25 1,969, median 4,050, p75 7,256, p90 13,931, min 400, max 81,234 — still
popularity-weighted (that is a defensible product choice) but no longer *only* the top of the site.
**332 distinct authors, hard cap 7 scripts per author**, so no single publisher's house style —
LuxAlgo's, AlgoAlpha's, ChartPrime's — can dominate the measurement.

### Attribution convention — unchanged

Each entry carries `scriptIdPart`, `title`, `author`, `url_guess`, `agreeCount`, `category`,
`pine_version_if_known`, `why_selected`, `licence_status`, `commit_source_allowed`, plus
`licence_detected_raw`, `difficulty_tier`, `declaration`, `source_endpoint`, `already_downloaded`,
`local_source` and `popularity_stratum`. `url_guess` is built as
`https://www.tradingview.com/script/<imageUrl>-<title-slug>/` — TradingView's own page-URL shape,
verified against all 30 URLs in `pine_community/SOURCES.md`. Byte-exact source comes from
`source_endpoint` (`pine-facade…/get/PUB%3B<id>/last`), which is the path `pine_community/README.md`
already documents.

The file naming and `SOURCES.md` convention stays exactly as it is: `<NN>-<kebab-title>.pine`,
byte-for-byte as served, CRLF/LF preserved, one `SOURCES.md` entry per file carrying **exact URL ·
author · boosts on the fetch date · licence line quoted verbatim (or "TV-default MPL-2.0") · Pine
version + declaration + line count · TV revision · one-line description**.

---

## 9. Ingestion steps a later session would run

⭐ **The fetch tooling already exists — in `scratchpad/acq/`: `tvfetch.py`, `inventory.py`, `snap.py`,
`report.py`, `engine_run.mjs`, `probe_blockers.mjs`. DO NOT re-implement it, and this lane did not run
it.** `scratchpad/acq/sources/` held **3,783** files when this was written and was still growing;
**404 of the 537 plan entries are already downloaded** (`already_downloaded: true`, with `local_source` naming the file), so the
network step only covers the remaining **133**.

1. **Decide the destination and the gate first.** Adopt `pine_oos`'s `MANIFEST.json` shape —
   per-entry `storage: "git" | "local-only"` — as the *mechanism* for the licence policy, and make the
   ingest script set `storage` from the licence it read out of the header, never from a human note. A
   prose rule in a README cannot fail; a field a test asserts on can.
2. **Fetch only what is missing.** 133 entries where `already_downloaded: false`, via
   `source_endpoint`, using the existing `tvfetch.py`. Record `scriptAccess` in the response per file;
   anything that does not answer open-access is dropped, not guessed at.
3. **Read the licence out of every header, including the 404 already on disk.** `inventory.py` already
   emits a `license` field. Gate: `CC-BY-NC*` → `storage: local-only`, `commit_source_allowed: false`;
   no licence line → `TV-default MPL-2.0`; anything unrecognised → `local-only` and a name in the report,
   never a default. Then re-check the plan's 133 unknowns and update their flag from measurement.
4. **De-duplicate before writing anything.** Dedupe on TradingView page id *and* on
   `sha256_normalized` (comment-stripped) against all 137 committed files **and** against `pine_oos` —
   `pine_oos` is 60 scripts from the same site and the overlap is not zero.
5. **Write the fixtures and the attribution in one commit per bucket**, `<NN>-<kebab-title>.pine`
   byte-for-byte, with the `SOURCES.md` entry generated from the fetch record rather than typed.
   Non-commercial entries get a `SOURCES.md` row and **no file** — the row is the record that the script
   was measured and deliberately not committed.
6. **Snapshot the translator's verdict per file** with the existing `engine_run.mjs`, and store it the
   way `pineCorpus.json` already stores it (translates / outputs / usable / refusals) so the corpus
   becomes a movable number rather than a pile of inputs.
7. **Re-run §2/§3/§4 of this audit against the enlarged corpus** and check the mix actually moved. The
   gate on this whole exercise is not "500 files landed" — it is *"drawing-object prevalence in our
   corpus is within a factor of 1.5 of the wild's 59.7%, and UDT prevalence within 1.5 of 18.3%"*. If
   those two ratios have not moved, the ingest achieved nothing that matters.

⚠️ Two traps this lane hit, recorded so the next session does not: the acq JSONs are **live** and were
rewritten mid-read (n_scripts 193 → 1,443 in one file, another briefly deleted) — snapshot before
computing; and `C:\Users\Patrick\uct-dashboard`'s working tree **has no `tests/fixtures/pine*` at
all** (it sits on another engineer's branch), so every corpus fact must come from
`git show origin/master:<path>`.

---

## Appendix — provenance of every number

| number | source | n |
|---|---|---|
| corpus counts, versions, primitives, features | `git show origin/master:<path>`, regex census over the 137 files | 137 |
| corpus boosts, licences, URLs | `pine_community/SOURCES.md`, `pine/SOURCES.md`, per-file header grep | 30 / 21 |
| corpus translate rate | committed `app/src/components/chart/engine/ast/__fixtures__/pineCorpus.json` | 21 |
| ecosystem population, access, kind, boosts, `extra.stats` | `acq/catalog.json` | 6,156 / 4,898 open-source |
| ecosystem licences, Pine versions, features, line lengths | `acq/inventory.json` (joined to catalogue) | 1,425 |
| ecosystem presentation primitives | `acq/agg_presentation.json` | 1,443 |
| ecosystem computation features | `acq/agg_computation.json` | 1,443 |
| translator verdict on the wild | `acq/engine_status.json` | 770 |
| refusal histogram | `acq/engine_refusal_agg.json` (read at n=467, file rewritten during the session) | 467 |
| `pine_oos` manifest, `storage` gate, NC handling | `.claude/worktrees/indicator-ecosystem/tests/fixtures/pine_oos/MANIFEST.json` (**unmerged branch**) | 60 |
