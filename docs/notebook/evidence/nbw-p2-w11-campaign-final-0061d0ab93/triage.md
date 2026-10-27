# FINAL campaign triage: run w11-campaign-final-0061d0ab93

## Setup
- App root: `nbw-p2-impl` HEAD `0061d0ab93` at the start (run.json `app_tree`). At the end HEAD is `27422ecfd4`, the
  re-walk's evidence commit (10:29, mid-run). It is docs-only: `git diff --name-only 0061d0ab93 27422ecfd4` lists no
  path outside `docs/`. dist is unchanged (mtime 09:13:32, after the 09:12:43 commit), so the served code is the
  0061d0ab93 build throughout.
  The only working-tree change is in `WidgetEmbedView.module.css`, and it is line endings only (`--numstat` and
  `--ignore-all-space` both empty).
- Tool tree: `nbw-p2-campaign` `ca045805ce`. `run_campaign.py` and `seed_members.py` were run from it, with `--app-root`
  set to impl and the clock launcher taken from the tool tree.
- Data dir: `scratchpad\sbx-campaign-final-20261027T094932`. It held 50 CENSUS lines, `SEEDED 50 members in 28.4 s`,
  and the schema boot logged `shared-root writes blocked: 0`. No seed_wrap was used; P20/P37/P38/P41 list clocks seeded natively.
- Ports: 8331 (owned), 8341 (clock), 8311 (schema). The re-walk held 8171.
- `--no-heavy-lock`: the lock was held by another lane, `'brag-shop-full'` pid 21704 (`logs/heavy-lock-status.txt`).
- `--block-outbound`: `run_campaign.py` has no such option. `OwnedSandbox.launcher_args()` always passes it
  (run_campaign.py:799), and the clock boot and seeder get the same proxy env through `outbound_block()`.
  The proof is in the logs: 467 `ProxyError` lines (cftc.gov, earningswhispers.com, and others).
- Hermetic check, live: `logs/auth-me-P49.json` shows W8, W9, W10 and W11 true, `notebook_door_guard: "unknown-only"`
  and the style library true. The 31 `integrity-boot*.md` files read NOT HASHED, with 0 NOT CLEAN. All 11 clock stops
  were `graceful (rc 0)`. Shared-root writes blocked: 0.

## Totals
| | PASS | FAIL | INCONCLUSIVE | EXPECTED-PENDING | total |
|---|---|---|---|---|---|
| runs | 240 | 14 | 19 | 0 | 273 |
| steps | 1513 | 5 | 21 | 0 | 1539 |

The run covered 50 personas. The previous run had 157/83/33 runs and 1302/71/88 steps.

## Every non-PASS, classified (raw ids: out/defects.jsonl)
| raw | what | class | evidence |
|---|---|---|---|
| 010 | P48.a.01, 6 runs FAIL on the `GET /api/auth/me -> 401` finding | TOOLING (residue of T-8/T-18): the 401 is the logged-out answer, by design, and is not exempted on the `open` step | step P48_a_01.json; every P48 check PASSes |
| 012 | P50.a.06, 2 runs FAIL on `POST /widget-definitions -> 409` | TOOLING: the cap refusal is the expected answer, and the step's check PASSes with `You have 100 widgets. Archive one in My tools to make room.`. The step lacks `expect_status: [409]` | P50/820-pointer/steps/P50_a_06.json |
| 003-008 | P35.b.03/b.05 at 390-keyboard (the 6th run): HTTP 429 `{"code":"rate","message":"Too many previews at once. Try again in a minute."}` | TOOLING (pacing) / product BY DESIGN (`PREVIEW_MINE_RATE` 10/minute, CLAUDE.md single-process list). The other 5 runs PASS | P35/390-keyboard/steps/P35_b_03.json |
| 009 | P45.a.01 at 390-keyboard: admin sign-in HTTP 429 | TOOLING (T-14 residue): the 6th sign-in inside the 5/minute per-address limit. The other 5 runs PASS | P45/390-keyboard/steps/P45_a_01.json |
| 011 | P49.a.04 at 390 p/k: "no zero" flags `… all accounts. 0 trades.` | BY DESIGN (the count is spec'd) + TOOLING (T-4 residue: the sr-only live region is still read at 390). **PD-2 is FIXED**: the phone bar now reads `Daily P&L bars · No closed trades in this range. Widen the ra…`, not `$0.00` | P49/390-pointer/shots/P49_a_04.png |
| 001, 002 | P12.b.05 and P23.a.05 at 390-POINTER: axe target-size "partially obscured" (2.5 px) | BY DESIGN, D-W11-005 class (scroll artifact under the sticky summary). TOOLING residue: the T-17 suppression covers keyboard runs only (`why: "... not focused, keyboard run"`), so the same artifact on pointer runs is still filed | step files |
| P30.a.06 x6, P33.a.01 x6, P42.a.01 x6 | not reachable / not scripted | BY DESIGN (ledger) | inconclusive reasons in results.jsonl |
| P39.a.01 | in-flight 409 not forced: `4 presses with one key all answered 200 (1 made, 3 replayed)` | BY DESIGN (CAMPAIGN-W11: not scriptable) | |
| P39.a.05, P50.b.02 | `listing_moved`, engine `too_long` | BY DESIGN (CAMPAIGN-W11) | |

**Product defects open: 0.** PD-1 (Login contrast and tap targets), PD-2 (`$0.00` phone bar) and PD-3 (Toast Dismiss
23 px) did not recur: there are no Login axe or tap findings, and no tap findings anywhere.

## First real proof of the tooling fixes
- **T-2 tour.** `first-run tour: dismissed through 'Skip tour'` (R.tour_dismissed) was recorded for P22, P34, P36, P40
  and P44, at 1200-pointer, which is each persona's first run. Later runs no longer meet the tour, because the
  preference is recorded. All their steps PASS.
- **T-13 Use.** P37 a/b/c and P38 a/b `w11_use` PASS at all 5 instants, including the binding embeds. P39.a.02-a.04
  (Use, unkeyed, key reused) PASS. a.01 and a.05 are INCONCLUSIVE by design.
- **T-15 Fast 3G.** P50.a.03 PASS with `note_first_paint` 29,885 ms on the 400 kbps / 300 ms throttle. That is just
  under the old 30 s wait; record it as a perf data point. P50.a.04-a.06 then PASS.
- **T-18 stranger pages.** P48.a.03 (`/api/j2/shared/<token>` 200) and a.04 (`/api/j2/published/<slug>` 200) PASS in
  6/6 runs. `nothing private reaches the public page (text, attributes, payload) -> {}` holds: the private sibling
  `Campaign P48 private plan zq7` / `Private body zq7 never shared.` / tag `zq7-private` never appears. The library
  answers 401 to a stranger.
- **T-19 outbound.** NOT literally "no yfinance lines": the logs hold 2,386 lines naming yfinance. Every one is a
  failure, and none is a response from Yahoo.
  - Counts: 661 `TypeError("'NoneType' object is not subscriptable")`, 80 `pooled call failed (ConnectionError)`,
    plus timeouts.
  - 0 `HTTP Error nnn`, 0 `Unauthorized`, 0 `Invalid Crumb`. The previous run had Yahoo 401/404 responses.
  - So yfinance still tries, and is black-holed. 41 of the lines are only the boot fingerprint's `yfinance_tz_fix=on`.
- **T-20.** 11/11 clock boots stopped `graceful (rc 0)`.
- **I-2, suppressed findings (5, all D-W11-005 target-size, all 390 keyboard):** P04.a.05, P12.b.05, P23.a.05,
  P30.a.05 and P30.a.06. Each carries `why: "D-W11-005: under the builder's sticky summary bar, not focused, keyboard run"`.
  Targets: `button[aria-label="Net P&L. Change measures"]` (x4) and `._filterItem_odb41_318 > ._chip_odb41_175[type="button"]`.

## F-DEF-1 retests (all PASS)
| check | where | result |
|---|---|---|
| D-W11-001 toggle | P01 a.02/a.05 at 1200/820/390, P01 c.03 light, **P14.a.09, P46.a.02, P46.a.18** | PASS in all runs. The P14/P46 measures now resolve (T-3 fixed) |
| D-W11-002 Folder select | P01, P04 at 820/390 | PASS |
| D-W11-003 title input | P01, P04 at 820/390 | PASS |
| D-W11-004 FeedbackWidget | P01, P04 at 820/390 | PASS (w and h) |
| D-W11-007 dimmed preview, cue, phone bar | P25 a.05/a.06 at 1200/820/390 | PASS (60 + 6 checks) |
| P25.b.05 axe while loading | 6 runs | PASS |
| P25.b.06 retry over a kept result (R50b) | 6 runs | **PASS** (48 checks; T-7 fixed). Fetch paused = 2 in all 6 |
| D-W11-005 | 390 | recurs as the scroll artifact: suppressed on keyboard runs, filed on 2 pointer runs (see above) |

## Totals of findings
- Console errors 0, page errors 0, overflow 0, tap findings 0, keyboard findings 0.
- Failed requests on page events: 32.
  - 12 are `503 /preview`, injected by P25.b.06 itself and no longer filed.
  - 12 are `404 /routines/days`, which P46 expects.
  - 6 are `401 /auth/me` (P48, filed).
  - 2 are `409 /widget-definitions` (P50 cap, filed).
- Axe serious: 2 filed and 5 suppressed. Axe critical: 0.

## Lock holder
In all 42 server logs there are 0 lines of `database is locked`, `table is locked`, `SQLITE_BUSY` or `OperationalError`,
so the holder was not seen. R1 did not reproduce.
