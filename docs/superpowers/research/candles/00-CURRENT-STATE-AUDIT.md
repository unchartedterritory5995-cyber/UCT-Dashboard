# Current-state audit — screener CANDLE column
Measured 2026-08-24 against `C:\data\screener.db` (build 2026-08-24 02:07, 3,714 rows).

## The single source of truth
`api/services/screener/candles.py::single_candle(bars)` — called once per ticker from
`snapshot_builder.py:444` inside a `_step()` seam guard. Result columns land in
`screener_rows` via `snapshot_db.COLUMNS` (which ALTER-adds new columns automatically —
migration is free).

## Vocabulary today: 7 labels
hammer · shooting-star · doji · marubozu · bullish-engulfing · bearish-engulfing · spinning-top
(plus `"none"`, rendered as `—` by `columnDefs.js:125`).

## MEASURED DISTRIBUTION (3,714 rows)
| label | rows | share |
|---|---:|---:|
| **none → `—`** | **1,620** | **43.6%** |
| spinning-top | 611 | 16.5% |
| doji | 459 | 12.4% |
| bearish-engulfing | 263 | 7.1% |
| hammer | 233 | 6.3% |
| marubozu | 230 | 6.2% |
| shooting-star | 193 | 5.2% |
| bullish-engulfing | 105 | 2.8% |

## DEFECT 1 — the fall-through gap is 100% of the dashes
Decomposition of the 1,620 `none` rows:
- body_pct NULL (the honest zero-range refusal): **0**
- body_pct present, i.e. a real measurable bar with no name: **1,620 (100%)**

Body-fraction bands of the unnamed rows: 0.30–0.35 → 121 · 0.35–0.50 → 600 ·
0.50–0.65 → 484 · 0.65–0.85 → 415. Nothing below 0.30, nothing above 0.85 —
exactly the interval the if/elif chain leaves unassigned. Direction split 866 up / 754 down.

⭐ The cause is structural, not a threshold to tune: after `hammer/shooting-star/doji/marubozu`,
the chain tests engulfing and then `elif body_pct < 0.3 → spinning-top`. A bar with
body_pct in [0.30, 0.85] that is not engulfing reaches no branch and keeps `ctype = "none"`.
An **ordinary directional bar — the most common bar in the market — has no name in the library.**

## DEFECT 2 — the served build predates its own fix (and the description is forward-dated)
`candles.py` commit `57b06f457` ("a bar with no range has no shape") landed **2026-08-24 06:42**.
The served snapshot was built **2026-08-24 02:07** — 4h35m EARLIER. The build therefore ran the
pre-fix classifier.

Verified by control: the harness runs master's `single_candle` over bars pulled from `bars.db`
for all 3,707 rows and reproduces the persisted distribution EXACTLY on every label, with a
single delta of **78 rows** that master refuses (`none`) and the served DB publishes as `doji`.
Nothing else differs. That is the fix, and only the fix.

Consequently `columnDefs.js:126` ("Roughly 80 names a night… most of them because they did not
trade") is NOT wrong — it is describing a state that first reaches a build TONIGHT. 78 ≈ 80.
What it still fails to explain is the other 1,619 dashes, which are 95.4% of what a member sees.

⭐ Baseline to design against is the POST-fix distribution, not the served one:

| | served 08-24 02:07 | post-fix (tonight) |
|---|---:|---:|
| dash (`none`) | 1,620 (43.6%) | **1,697 (45.8%)** |
| ├ vocabulary gap | 1,620 | 1,619 |
| └ honest zero-range refusal | 0 | 78 |
| doji | 459 | 381 |

The dash rate RISES before the build fixes it — correctly, since those 78 were confident
indecision labels on bars that mostly never traded.

## DEFECT 3 — no trend context anywhere
`single_candle` never looks further back than `bars[-2]` for shape (only `_atr` walks the window).
Consequences:
- **hammer (233 rows)** and **hanging man** are the same geometry; the split is 100% prior trend.
  Every hammer printed after an advance is mislabeled — the column cannot tell.
- **shooting-star (193 rows)** vs **inverted hammer** — same problem, mirrored.
- 426 rows/night carry a label whose correctness is unverifiable from the row itself.

## DEFECT 4 — engulfing is geometry-only and tie-permissive
`o <= pbody_lo and c >= pbody_hi` uses non-strict inequalities (an exact tie engulfs), does not
require the prior bar to be the opposite colour, and does not require the prior body to be
non-trivial — so a doji followed by any wide bar reads as an engulfing.

## DEFECT 5 — measured context is computed and then discarded
`wide_bar` / `narrow_bar` are computed for every bar and **never influence the label**.
On the 1,620 unnamed rows alone: 76 are wide bars, 170 are narrow bars.
`multi_candle` context already sitting unused on those same unnamed rows:
higher_lows_run 1,018 · tight_consolidation 879 · consecutive_up 986 · consecutive_down 614 ·
nr7 289 · inside_bar_run 259.
⭐ **The data needed to name these bars honestly is already in the row.** Only the vocabulary is missing.

## DEFECT 6 — zero multi-bar patterns beyond engulfing
No morning/evening star, no harami, no piercing/dark-cloud, no three-bar family, no continuation
family. `multi_candle` computes compression statistics but emits no named structure.

## Naming collision to avoid
`candle_score` ALREADY EXISTS and is **not** a candle field — it is the 0–110 *setup* score from
`setup_score.py`, surfaced as the "Setup Score" filter. A new candle-strength field must NOT be
called `candle_score`.

## Existing test coverage
`tests/test_screener_candles.py` — 5 tests, 44 lines (hammer, doji, inside-bar/NR7, consecutive-up, empty).
`tests/test_screener_candles_accuracy.py` — 107 lines.
Fixture dirs exist for doji / marubozu / shooting_star / bullish_engulfing / bearish_engulfing.

## Consumers that must move together
- `api/services/screener/filters.py:349` — the `candle_type` enum filter (7 options, hardcoded).
- `api/services/screener/snapshot_db.py:81` — column list + `idx_sr_candle_type` index.
- `app/src/pages/screener/columnDefs.js:125` — display formatter + description.
- `app/src/pages/screener/columnDescCoverage.test.js` — every column needs a description.
- `api/services/screener/identities.py` — nightly refusal rail already asserts on the fractions.
- `api/services/screener/pattern_join.py` — also references candle_type.
