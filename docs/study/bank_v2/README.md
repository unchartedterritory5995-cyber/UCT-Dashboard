# Bank v2: setup examples from the deep, institutional history

Owner, 2026-11-06: *"lets use a variety of diverse and liquid and institutionally traded stocks and setups going back
deep in time that we have access to."* This folder holds what the pipeline below produced and the caches that make it
re-runnable without asking any vendor again.

## The pipeline

| step | script (`scripts/study/bank_v2/`) | what it does |
|---|---|---|
| 1 | `scan_history.py` | Every session since 1995 in the bars database (2,789 stocks), the owner's calibrated finders for the seven Hard-mode setups, each instance with its context (market condition from SPY against its 50 and 200-day, distance from the 52-week high, strength against SPY), its outcome (the culmination before a close breaks the signal candle, within 60 sessions), the other setups firing on the same bar, and its point-in-time liquidity rank (50-day median dollar volume ranked across every stock that session). Writes the atlas (`.jsonl.gz`, kept outside the repo). |
| 1b | `enrich_meta.py` | Fills the sector, industry and fund type the scan could not read, from Yahoo's company profile, cached in `yahoo_profiles.json`. |
| 2 | `choose.py` | Per setup, a spread-out set from the top 1,000 stocks by dollar volume: era quotas over six eras, at most two charts per stock (never two in one era), the least-used sector first among the best-scored candidates. Also lists the failed examples (not drafted: the owner's ruling below) and the co-fire ("both count?") charts. |
| 3 | `draft_pass.py` | The last pass's drafting rules unchanged (earnings days, the 200-day and 4% gap for Gap Support, score floors, the HVE's 5% up day), plus: one chart per date per setup, no ETFs, and each pick's window checked against Yahoo's closes today (`second_source.py`). Appends a `deep_pass1` block to `docs/study/setups/setup_examples.json`; every example carries its context and outcome fields. |
| 4 | `scripts/study/fill_setup_facts.py` then `scripts/study/gen_setup_examples.py` | The existing generators: Gap Support's facts from the chart's own bars, then the `spot.setups` drafts. |
| 5 | `scripts/study/import_bank.py --only spot.setups` (on the pod) | Loads the drafts for the owner's review screen. Nothing goes live until he approves it. |

`atlas_report.py` writes `ATLAS.md`, the plain-English report of step 1 per setup.

## What the data is, measured

- **The deep daily history is Yahoo's.** Old windows matched Yahoo's split-adjusted closes to the cent, so the history
  follows each company through its ticker changes (a 2004 chart filed under BB is the series Yahoo files under BB; the
  stock then traded as RIMM). `second_source.py` therefore confirms a window still matches Yahoo today; it is not an
  independent vendor. An independent leg was tried and could not run on 2026-11-06 (the local FMP and Massive keys are
  refused, Alpha Vantage's free tier is 25 calls a day, Stooq answers scripts with a browser check).
- **Survivorship.** Stocks that delisted are not in the bars database, so the oldest eras lean toward the survivors.
- **Liquidity is point in time.** A stock's rank is computed against every stock trading that session, so a 1997 chart
  in the top 1,000 was institutionally traded in 1997, not just today.

## Files here

- `ATLAS.md`: the per-setup report of the deep scan.
- `yahoo_profiles.json`: sector, industry, fund type and name per stock, from Yahoo's profile (step 1b).
- `second_source.json`: each drafted window's comparison with Yahoo's closes (step 3).

## Chart IQ question families (owner 2026-11-06: "cycle of price action, use the chart IQ")

| step | script | what it does |
|---|---|---|
| A | `scan_chartiq.py` | Chart IQ's own readers (`api/services/chart_iq/engine/v44_read.py`) over every stock's full history: the cycle of price action (`cycle_events`) and the named bar events (`candle_events`). Kept only in the top 1,000 stocks by dollar volume that day, at most two per stock per event per era, each with a 20-session confirmation, context, culmination and liquidity rank. A cycle stage is kept only when Chart IQ names the same stage reading the member's own window (the 300 bars up to the day). |
| B | `gen_chartiq.py` | Two segments of chart questions, held examples only, spread over eras and sectors, one per date, two per stock at most: `cycle.price_action` (skill `read.cycle`, six stages, the chart drawn with the 10 and 20-day EMA the stages are measured on) and `chart.events` (skill `read.events`, seventeen named events). Each event is re-read on the member's window and no distractor fired on that bar. |

Chart IQ's own Kicker and Oops reversal are not in `chart.events`: the owner ruled his own definitions of both, and the
setup bank teaches those. Drawing questions (which line is the support, mark the base) wait on product work: the Study
chart cannot yet draw labelled lines inside a question, and the `levels` item type is not served to members.

## Pass totals (2026-11-06)

| setup | deep_pass1 | deep_pass2 | deep-history total |
|---|---:|---:|---:|
| Oops Reversal | 25 | 600 | 625 |
| Launchpad | 25 | 600 | 625 |
| Slingshot | 25 | 155 | 180 |
| Gap Support | 25 | 43 | 68 |
| Kicker | 12 | 1 | 13 |
| High Volume Edge | 25 | 0 | 25 |

Under the owner's rules only the Oops Reversal and the Launchpad reach 600; the others hold every qualifying chart in the
2,789 stocks of the bars database. A fired-then-failed set (the setup fired, then failed the finder's test) was drafted
to bring Slingshot and Gap Support to 600 and REMOVED on his ruling, verbatim: "I do not want to fire the failed events"
(2026-11-06, owner_verdicts.jsonl). choose.py still lists the failed charts for analysis; nothing drafts them. Every
window in every pass is checked against Yahoo, which also drops an old ticker whose company trades under another symbol
now (SQ 2024 next to XYZ).
