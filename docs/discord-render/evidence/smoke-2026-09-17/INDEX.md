# SMOKE 3.5 — run of 2026-09-17, `#render-smoke`

**Scored against `docs/discord-render/SMOKE-3.5.md` (14 rows, R16).** Commit live for the
whole run: **`d9455a6d64a5`**, read in-product from `/renderhealth`, not inferred from a
push. Pod booted `2026-09-17T12:22:35Z` (derived: `uptime_s` 202 at `12:25:57Z`).

⚠️ **Discord renders timestamps in the CLIENT's timezone, and this box is CT.** Every
message time below is written `CT (ET)`. Getting this wrong once already made a 7:30 read
as 9:04 in a 0.55-scale screenshot.

| # | Row | Verdict | Evidence identity |
|---|---|---|---|
| 1 | `/chart ticker:NVDA` | **PASS** | 7:32a (08:32 ET) · `NVDA · Daily` · footer `Earnings Wed Nov 18 (in 62d)` · `(edited)` · controls `D · W · 60m · 5m · ⚙` · **no badge of any kind** |
| 2 | STALE badge | **NOT RUNNABLE** | unreachable by construction — pre-V2 path emits no `?stale=`; see SMOKE-3.5 §"Rows 2, 3 and 7" |
| 3 | stand-in + heal | **INCONCLUSIVE-BY-CONSTRUCTION** | R32; V2 dark |
| 4 | footer | **PASS** | the same 7:32a message — the footer line is present and freshly computed: `in 62d` today against `in 64d` on the 9/15 message two days older |
| 5 | `/flow ticker:SPY days:30` | pending | 10:00 ET window (R17) |
| 6 | `/flow` equity underlying | pending | 10:00 ET window |
| 7 | degraded flow card | **INCONCLUSIVE-BY-CONSTRUCTION** | §5's card is the V2 failure contract; V2 dark |
| 8 | `/buzz` (bare) | **PASS** | 7:39a (08:39 ET) · ephemeral (*Only you can see this*) · *"No mentions counted yet for **since the open**, counted through 8:37a."* · **fired ~3 s after a 4-ticker `/chart`** (see the caveat below) |
| 9 | `/renderhealth` | **PASS** | 7:40a (08:40 ET) · ephemeral · *"Render V2 is **off** (`DISCORD_RENDER_V2_ENABLED` unset) and has never run on this volume, so there is no job history yet. Renderer: not probed yet. Commit `d9455a6d64a5`."* — names the flag state AND the commit |
| 10 | multi-chart | **PASS** | 7:30a (08:30 ET) · `/chart NVDA AMD AVGO` → ONE message, `NVDA · AMD · AVGO · Daily`, three charts, controls `D · W · 60m · 15m · 5m` (five timeframes, **no ⚙**) · type-5 defer seen as *"UCT Intelligence is thinking…"* first |
| 11 | control-row button | **PASS** | the 7:32a message, `W` clicked → SAME message edited in place: header `NVDA · Daily` → `NVDA · Weekly`, image → `NVDA, 1W`, `W` now primary, footer preserved, expanded controls preserved |
| 12 | the `⚙` control | **PASS** (assertion corrected) | the 7:32a message → four component rows in place: `D W 60m 15m 5m` · `◀ Earlier · Later ▶ (disabled) · MAs: House · Volume off · 🌊 Dark Pools` · `🔼` · select `⚙ Zoom Auto · None · Candles` |
| 13 | non-allowlisted channel | **PASS** | fired in `#alert-test` (`1483290485627031603`) 7:39a · ephemeral · *"Please use #📈\|chart-flow-requests for chart & flow requests."* — the **member-facing** channel as a live mention, **never `#render-smoke`** |
| 14 | rate-limit refusal | **PASS** | 7:38a (08:38 ET) · ephemeral · verbatim: *"Slow down: up to 12 charts per minute per member. Try again in 20s."* |

**Score so far: 9 PASS · 2 pending (clock-gated) · 3 not-runnable/inconclusive by
construction · 0 FAIL · 0 unexplained NOT RUN.**

---

## How row 14 was driven, and the one thing it did NOT establish

`DISCORD_CHART_USER_RATE` is **not set** on `web` (read as a single filtered line, value
never printed), so the default `12/60` applies. The budget is charged **per chart**, and a
multi-ticker `/chart` charges one per ticker before dispatch, so:

    /chart NVDA AMD AVGO AAPL     4    accepted, delivered 7:37a
    /chart MSFT META GOOGL AMZN   8    accepted, delivered 7:37a
    /chart TSLA NFLX CRM ORCL    12    accepted, delivered 7:38a
    /chart IBM                   13 -> REFUSED, ephemeral, 0 renders

⛔ **A PRIOR ATTEMPT WITH COMPONENT BUTTONS DID NOT TRIP IT, AND THAT IS NOT EVIDENCE THE
LIMITER IGNORES BUTTONS.** Five rapid clicks on the multi-chart timeframe row (3 charts
each = 15 charge units, inside ~8 s) produced no refusal. The message's own state went
`W → 60m → … → D`, i.e. it ended on the LAST click, so the fifth click was accepted — but
only three distinct renders were ever observed landing. The likeliest reading is that the
Discord client coalesced or dropped the intermediate clicks, so fewer than 12 units were
ever charged. **From the browser side these two explanations are indistinguishable**, and
the honest form of this line is: *the limiter was not reached by five clicks; whether all
five reached the backend was not measured.* It is settleable from `web`'s access log
(count `POST /api/discord/interactions` in that window) and nowhere else.

## Row 8's condition — closer than 2026-09-15, still not a proof

`/buzz` was fired **~3 s after** `/chart SNOW DDOG NET PLTR`, i.e. inside a four-chart
render window, and still replied ephemerally inside the deadline. That is materially
stronger than the 2026-09-15 run (fired cold) — the branch's own measurement is 1.05 ms
with the pool free vs **2,001 ms with it exhausted**, against a 3 s deadline, and four
charts is exactly the shape that exhausts a four-slot valve. ⛔ But **pool occupancy at
that instant was inferred, not measured**: the client cannot see the valve. Until OI-36
merges, row 8 remains conditional, and this run narrows the condition rather than
closing it. The board was also EMPTY ("No mentions counted yet"), so the cheap path was
taken through `build_board_text` either way.

## What the run found that was not a row

1. **`/charts` is retired from registration** — SMOKE-3.5 row 10 named a command Discord
   does not offer. Corrected in that file; the multi-chart PATH is alive and passes.
2. **The gear expands the controls in place; it does not open `/chartsettings`.**
   Corrected in that file.
3. **Rows 2, 3 and 7 assert V2 contracts on a pod where V2 is dark** — named as
   NOT RUNNABLE / INCONCLUSIVE **by construction**, never as failures.
4. **OI-47 is still live**: `d14_monitor`'s HTTP probe records `stall_record: null,
   token_slots: null` on every poll, against a volume that demonstrably holds both.
5. **The pod restarted at 12:22:35Z with no commit change** (`/renderhealth` reports the
   same `d9455a6d64a5` that merged yesterday). A restart without a deploy is worth one
   line in the record; it is not explained here.

---

## Update — 09:09–09:16 ET: row 6 PASS, and "pre-market" is no longer a live hypothesis

| # | Row | Verdict | Evidence identity |
|---|---|---|---|
| 5 | `/flow SPY days:30` | **NOT RUNNABLE** (was: pending) | 8:09a CT (09:09 ET) · refused · and the cause was captured: `[flow] fetch failed SPY (30): timed out`. Separately, the row asserts the **`etfs`** partition, which only the V2 handler selects — see `ROW5-FLOW-CAUSE.md`. |
| 6 | `/flow NVDA days:30` | **PASS** | 8:15a CT (09:15 ET) · a real flow card: `UCT Intelligence · NVDA Flow`, `$1213.80 · last 30 trading days · 8/5/2026-9/16/2026 · 30 active days`, ~16 contract rows with premium, volume, OI trend and BULL/BEAR/UNCLEAR/MIXED, `246 contracts`, and a `View chart` button. **No `[flow]` warning line** — only failures log, so silence here IS the success. |

**Running score: 10 PASS · 0 FAIL · 4 not-runnable/inconclusive by construction (2, 3, 5, 7).**

### ⭐ The controlled pair killed the pre-market hypothesis

SMOKE-3.5 offered *"pre-market is a plausible benign explanation and is NOT established"* for row
5's refusals on 09-14 and 09-15. **Same pod, same commit, same six minutes, same pre-market
session:**

- `/flow SPY days:30` at 09:09 ET → **timed out** after 30 s.
- `/flow NVDA days:30` at 09:15 ET → **a full card with 246 contracts.**

A pre-market feed that answers an equity read in seconds is not a feed that is "reconnecting". ⛔
**What this does NOT establish is the cause of the SPY failure.** Both reads used the same
`stocks` partition on the same hop, so the difference is the symbol, not the session — an ETF's
flow in the equities partition could be an empty scan, an enormous one, or a slow one, and nothing
captured here distinguishes those. **The hypothesis that died is "pre-market"; no hypothesis has
replaced it.**

### ⚠️ A member-visible autocomplete failure, observed live and unattributed

Building the second command, `/flow`'s **`days` autocomplete answered "Loading options failed"** —
twice, on the empty query, at ~09:16 and ~09:18 ET. The SAME empty query had loaded the full
list (Today / 7 days / 30 days / 3 months / 6 months / All) seven minutes earlier at 09:09, and
typing `30` made it answer immediately. Both `ticker` and `days` are `autocomplete: True`
(`build_flow_command`, `discord_interactions.py:437`), so an autocomplete round trip must finish
inside Discord's window or the member sees exactly that string.

⛔ **NOT ATTRIBUTED, and the log cannot attribute it**: the app logs no autocomplete interaction on
either path, so its silence distinguishes nothing. Recorded because it is a **member-visible
degradation of the ack path on a pod that had already timed out a flow read** — the same C-02
surface, seen from the product rather than from an instrument.

⚠️ And worth noting beside it: `[discord-chart] warmed N hot chart(s)` fires **every single
minute** (13:10:03, 13:11:04, 13:12:05, 13:13:13, 13:14:08 …), 3–5 charts a cycle, forever. At
boot it overran its own 20 s budget twice. It is not a boot-only job; it is a standing consumer of
the same valve and loop that `/flow`, `/chart` and every autocomplete need.
