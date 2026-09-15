# SMOKE 3.5 — the real-Discord smoke, as a script

**Owner: the discord-render programme. Ruling R14, 2026-09-15.**

⛔⛔ **WHY THIS FILE EXISTS.** Until today the "15-command smoke" existed only as a
NUMBER. `docs/discord-render/06-flip-packet.md:51` records *"1 row(s) marked FAIL
(2/15 PASS)"*, and `05-progress.md:405` calls row 3.5 NOT RUN — but **no artifact
anywhere in this repo lists the fifteen rows.** The only enumeration is
`evidence/smoke-2026-09-14/INDEX.md`, which names rows 1, 5, 8 and 9 and lumps the
rest as *"1–7, 10–15 | /chart, /charts, /flow"*.

⭐ **A SCORE AGAINST A LIST NOBODY CAN RE-DERIVE IS NOT A MEASUREMENT.** "2/15" and
"3/15" cannot be compared if the fifteen are not the same fifteen. This is the same
defect class as the hand-typed counts this repo keeps paying for — a number beside a
list that does not exist.

⛔ **UNDEFINED ROWS ARE MARKED UNDEFINED, NOT INVENTED.** Where the prior evidence does
not establish what a row asserted, this file says so and PROPOSES a row. A proposal is
not history: it becomes the row when the owner or the next smoke ratifies it.

---

## The command surface, derived (not remembered)

Read from `api/services/discord_interactions.py`:

| constant | line | command |
|---|---|---|
| `CHART_COMMAND_NAMES` | :333 | `/chart`, `/c` (alias) |
| `SETTINGS_COMMAND` | :334 | `/chartsettings` |
| `MULTI_COMMAND` | :335 | `/charts` |
| `BUZZ_COMMAND` | :338 | `/buzz` |
| `FLOW_COMMAND` | :339 | `/flow` |
| `LAUNCH_COMMAND` | :510 | `/launch` (Entry Point, type 4) |
| `RENDERHEALTH_COMMAND` | :1080 | `/renderhealth` |

**Channel:** `#render-smoke` = `1549129739048853544`, guild `882293203485720596`,
under ADMIN CHAT. Private: bot role `1474903498700230668` allow `[VIEW_CHANNEL]`,
`@everyone` deny `[VIEW_CHANNEL]`. Readers = 5 ADMIN members + the owner via
ADMINISTRATOR. **Organic members exposed: 0.**

⛔ `/chart`, `/charts` and `/flow` are gated by `di.cmd_channel_ok`
(`api/services/discord_interactions.py:373`). `#render-smoke` is allowlisted only
because `CHART_FLOW_CHANNEL_ID` carries TWO ids. If it is ever narrowed back to one,
every one of those rows becomes NOT RUN — refused by the channel gate — and that is
what happened in run 1 on 2026-09-14.

---

## The rows

Status key — **DEFINED**: established from prior evidence. **PROPOSED**: derived from
the spec and the command surface, awaiting ratification. **UNDEFINED**: the prior
record does not say what this row asserted.

| # | Command | Status | Assertion | Wire evidence |
|---|---|---|---|---|
| 1 | `/chart ticker:NVDA` | **DEFINED** | Fresh chart, controls row `D · W · 60m · 5m · ⚙`, **and NO BADGE OF ANY KIND** | `path=/r/chart status=200 … prio=interactive ready=True bytes=…`; message shows `(edited)` |
| 2 | `/chart` on a STALE symbol | **PROPOSED** | The STALE badge renders and `?stale=` carries the SENTENCE (04-visual-spec §2, §2b) | renderer URL contains `stale=` |
| 3 | `/chart` where the renderer is unavailable | **PROPOSED** | The **stand-in** renders and later HEALS to a real chart (04-visual-spec §3) | a stand-in edit followed by a heal edit |
| 4 | `/chart` footer | **PROPOSED** | The footer is stamped via `badge.stamp(content, footer)` (04-visual-spec §4, §4b) | footer text present on the delivered message |
| 5 | `/flow ticker:SPY days:30` | **DEFINED** | **Real contracts, not "no significant options flow"** — the C-14 ETF partition (`discord_render.symbols.flow_source` → `etfs`) | a card with contracts; `source=etfs` on the flow-worker read |
| 6 | `/flow` on an equity underlying | **PROPOSED** | `source=stocks` partition, the pre-V2 default | flow-worker read carries `source=stocks` |
| 7 | `/flow` degraded card | **PROPOSED** | 04-visual-spec §5's degraded card renders rather than silence | a degraded card, never an empty reply |
| 8 | `/buzz` (bare) | **DEFINED** | Ephemeral board reply, **ack inside 3 s** | ephemeral reply; **flags on the DEFER, not the follow-up** |
| 9 | `/renderhealth` | **DEFINED** | Ephemeral; names the flag state AND the running commit | the reply quotes `DISCORD_RENDER_V2_ENABLED` and `Commit <sha>` |
| 10 | `/charts` (multi-chart) | **PROPOSED** | Multi-chart delivery through `run_multi_chart_job`; type 5 defer | `background.add_task(run_multi_chart_job …)` path; one message, N charts |
| 11 | a chart CONTROL-ROW button (`D`/`W`/`60m`/`5m`) | **PROPOSED** | The button re-renders in place (type 12 deferred update) | `{"type": 12}` at `routers/discord_interactions.py:403` |
| 12 | the `⚙` control | **PROPOSED** | `/chartsettings` surface opens | — |
| 13 | `/chart` in a NON-allowlisted channel | **PROPOSED** | Refused with a nudge naming the **member-facing** channel (`1546563720702853280`), never the smoke channel | `_channel_nudge()` |
| 14 | rate-limit refusal | **PROPOSED** | `di.throttle_message(...)` — an honest named refusal, never silence | ephemeral throttle sentence |
| 15 | — | **UNDEFINED** | The prior record does not establish a fifteenth row. | — |

---

## Known-conditional rows — read these before scoring

⛔ **ROW 8 IS CONDITIONAL ON AN EMPTY BOARD AND A FREE POOL.** On 2026-09-15 it PASSED
(*"No mentions counted yet for since the open, counted through 8:58a"*). That is **not**
evidence that OI-36 is unnecessary. Until OI-36 merges, master still
`await run_in_threadpool(build_board_text)`s BEFORE the type-4 reply, and the branch's
own measurement is **1.05 ms with the pool free vs 2,001 ms with it exhausted**, against
a 3 s deadline. A fast invocation cannot prove the absence of a race. To exercise the
real condition, drive a long `/chart` first and fire `/buzz` inside its render window.

⛔⛔ **ROW 5's "THE FLOW FEED IS RECONNECTING" IS NOT A STATEMENT ABOUT THE FEED.** It is
the catch-all sentence for EVERY non-ok read on the pre-V2 path. From
`api/routers/discord_interactions.py:205-208`, verbatim: *"before it, every non-ok read
said 'the flow feed is reconnecting' — a 30 s timeout on 2026-09-11, a flow-worker
restart on 2026-09-08, and every other cause alike."* The real cause is only
distinguished when `fail_fn` is wired, which is the V2 failure contract — and V2 is
DARK. So a row-5 refusal is **INCONCLUSIVE by construction** today. The cause is
recoverable only from web's `[flow] fetch failed …` warning line or flow-worker's access
log via the `cid` query parameter, and **both age out of Railway's retained window**.
Capture them during the run or not at all.

⚠️ **PRE-MARKET.** Row 5 was run at 08:10 ET on 2026-09-15 and 2026-09-14 and refused
both times. Pre-market is a plausible benign explanation and is NOT established. The
named missing observation: the same row at ~10:00 ET on a weekday, with the web log line
captured inside the retention window.

⚠️ **A COLD POD CHANGES ROW 1's TIMING.** On 2026-09-15 row 1 delivered in ~35–45 s on a
pod that had booted three minutes earlier; the 2026-09-14 run measured `ms=2881`. Record
the pod's age with the row or the number means nothing.

---

## Scoring

Report **x/15 with every row's status**, and count `UNDEFINED` and `PROPOSED` rows
separately from PASS/FAIL. A run that skips a row records **NOT RUN with the reason** —
never silence.

⚰️ `06-flip-packet.md:51`'s "2/15 PASS" is **historical-undefined**: it was scored
against a list that was never written down. It is kept as history and must not be
compared against any score produced from this file.
