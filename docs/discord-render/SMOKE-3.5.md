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

Status key — **DEFINED**: established from prior evidence. **RATIFIED**: derived from
the spec and the command surface, and ratified as a row by **R16, 2026-09-15**.

⭐ **THE SMOKE IS FOURTEEN ROWS.** R16 struck the fifteenth: the prior record never
established one, and the "15" was approximate. **Every score from B2 onward is x/14.**
A score of x/15 is from before this ruling and is not comparable.

| # | Command | Status | Assertion | Wire evidence |
|---|---|---|---|---|
| 1 | `/chart ticker:NVDA` | **DEFINED** | Fresh chart, controls row `D · W · 60m · 5m · ⚙`, **and NO BADGE OF ANY KIND** | `path=/r/chart status=200 … prio=interactive ready=True bytes=…`; message shows `(edited)` |
| 2 | `/chart` on a STALE symbol | **RATIFIED** | The STALE badge renders and `?stale=` carries the SENTENCE (04-visual-spec §2, §2b) | renderer URL contains `stale=` |
| 3 | `/chart` where the renderer is unavailable | **RATIFIED** | The **stand-in** renders and later HEALS to a real chart (04-visual-spec §3) | a stand-in edit followed by a heal edit |
| 4 | `/chart` footer | **RATIFIED** | The footer is stamped via `badge.stamp(content, footer)` (04-visual-spec §4, §4b) | footer text present on the delivered message |
| 5 | `/flow ticker:SPY days:30` | **DEFINED** | **Real contracts, not "no significant options flow"** — the C-14 ETF partition (`discord_render.symbols.flow_source` → `etfs`) | a card with contracts; `source=etfs` on the flow-worker read |
| 6 | `/flow` on an equity underlying | **RATIFIED** | `source=stocks` partition, the pre-V2 default | flow-worker read carries `source=stocks` |
| 7 | `/flow` degraded card | **RATIFIED** | 04-visual-spec §5's degraded card renders rather than silence | a degraded card, never an empty reply |
| 8 | `/buzz` (bare) | **DEFINED** | Ephemeral board reply, **ack inside 3 s** | ephemeral reply; **flags on the DEFER, not the follow-up** |
| 9 | `/renderhealth` | **DEFINED** | Ephemeral; names the flag state AND the running commit | the reply quotes `DISCORD_RENDER_V2_ENABLED` and `Commit <sha>` |
| 10 | `/chart NVDA AMD AVGO` (multi-chart) | **RATIFIED**, command name **CORRECTED 2026-09-17** | Multi-chart delivery through `run_multi_chart_job`; type 5 defer | `background.add_task(run_multi_chart_job …)` path; one message, N charts |
| 11 | a chart CONTROL-ROW button (`D`/`W`/`60m`/`5m`) | **RATIFIED** | The button re-renders in place (type 12 deferred update) | `{"type": 12}` at `routers/discord_interactions.py:403` |
| 12 | the `⚙` control | **RATIFIED**, assertion **CORRECTED 2026-09-17** | The gear EXPANDS the in-message control surface in place (all five timeframes · pan/MAs/volume/Dark Pools · the one `⚙ Zoom · Indicators · Style` select · a `🔼` collapse). It does **not** open `/chartsettings` | the same message, edited, now carrying four component rows |
| 13 | `/chart` in a NON-allowlisted channel | **RATIFIED** | Refused with a nudge naming the **member-facing** channel (`1546563720702853280`), never the smoke channel | `_channel_nudge()` |
| 14 | rate-limit refusal | **RATIFIED** | `di.throttle_message(...)` — an honest named refusal, never silence | ephemeral throttle sentence |

---

## ⛔⛔ Two rows named a surface the product does not have (2026-09-17)

**Both were RATIFIED from the spec rather than from the command surface, and both were
wrong in the same direction: the row described an EARLIER product.** Neither is a defect
in the bot; the defect was in this file.

### Row 10 — `/charts` is RETIRED, and the multi-chart path is alive

Typing `/charts` in `#render-smoke` offers `/chartsettings`, `/chart`, `/renderhealth`,
`/c` and two other apps' `/channels` — **no `/charts`**. That is deliberate, and
`build_commands` (`api/services/discord_interactions.py:1094`, the ONE registration
authority) says so at the line that omits it:

> `# /charts is retired: /chart NVDA AMD AVGO is the same thing through one door. Its`
> `# handler stays for a deploy cycle so a client holding the older command set does not`
> `# get an error.`

`build_charts_command()` still EXISTS and is never registered — so a reader who greps for
the payload finds one and concludes the command ships. The live door is
`api/routers/discord_interactions.py:562`: `/chart` with more than one ticker →
`len(reqs) > 1` → `background.add_task(di.run_multi_chart_job, …)` → `{"type": 5}`.
**The row's ASSERTION was right and only its command text was stale**; it is corrected
above rather than struck.

⭐ Note what the row would have scored as if this file had been followed literally: NOT
RUN, "command not found" — a NOT-RUN against a working feature, which is the most
expensive kind of wrong row.

### Row 12 — the gear expands the controls; it does not open `/chartsettings`

Owner ruling, 2026-08-26 (recorded at `chart_components`,
`api/services/discord_interactions.py:749`): a chart in a busy channel is the image plus
ONE row, and *"the gear opens the full surface for the member who wants it, and the
open/closed state rides in the ids so it survives every click."* The expanded state is
`exp=1` in the component id; `🔼` closes it again. `/chartsettings` is a separate slash
command for per-member DEFAULTS and is reached from the picker, never from this button.

---

## ⛔ Rows 2, 3, 5 and 7 cannot be run while V2 is dark — this is a property of the pod, not of the run

All three assert a **V2 renderer** contract, and `DISCORD_RENDER_V2_ENABLED` is unset on
`web` (confirmed in-product by `/renderhealth` on 2026-09-17: *"Render V2 is off
(`DISCORD_RENDER_V2_ENABLED` unset)"*).

- **Row 2 (STALE badge).** The badge is composed by `discord_render/badge.py` from a
  `freshness.Envelope`, and the URL parameter is emitted by `discord_chart_house.py:270`
  — whose own docstring is the measurement: *"**THE PRE-V2 PATH PASSES NEITHER KEY**, so
  it leaves with `None` before the import, and its URL is unchanged down to the byte.
  `discord_chart_prefs.render_options` returns no `stale` and no `as_of`."* There is no
  ticker, and no market condition, that makes the pre-V2 path emit `?stale=`.
  ⇒ **NOT RUNNABLE — UNREACHABLE BY CONSTRUCTION.** Never score it as FAIL, and never
  score it as PASS on the strength of a chart that simply had no badge: *absence of a
  badge here is absence of the mechanism, not evidence of freshness.*
- **Row 3 (stand-in + heal).** Same family; R32 already recorded it as
  INCONCLUSIVE-BY-CONSTRUCTION.
- **Row 5 (the ETF partition).** ⛔⛔ **ADDED 2026-09-17, and it was hiding inside the row's own
  sentence.** The row names `discord_render.symbols.flow_source` → `etfs` as the mechanism. That
  function is called from **one** place — `commands.py:578`, the V2 handler. The pre-V2 dispatch
  (`routers/discord_interactions.py:499`) calls `run_flow_card_job` with **no `source` argument at
  all**, so the signature default `source: str = "stocks"` applies and `/flow SPY` asks
  flow-worker for SPY in the **stocks** partition. Even a perfectly healthy read cannot satisfy
  this row today. ⇒ **NOT RUNNABLE.** Scoring it PASS on a card that merely rendered would score
  the wrong assertion; scoring it FAIL would blame the run for the flag.
  ⭐ **Row 6 is unaffected and is the one flow row that CAN pass** — `stocks` is the pre-V2
  default, so an equity underlying is exactly what this path is built to read.
- **Row 7 (degraded flow card).** 04-visual-spec §5's card is the V2 failure contract.
  The pre-V2 path has exactly one sentence for every non-ok read — *"the flow feed is
  reconnecting"* — which satisfies "never silence" and says nothing about §5.
  ⇒ INCONCLUSIVE-BY-CONSTRUCTION unless the 10:00 ET run shows §5's shape.

⭐ **These three are the same class as OI-45 and OI-47 one level up:** the behaviour is
built, tested and mutation-covered, and the door to it is shut in production. A smoke
that scores them as failures would be blaming the run for the flag.

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

Report **x/14 with every row's status**, and count RATIFIED rows exactly as
DEFINED ones — R16 makes them rows, not proposals. A run that skips a row records **NOT RUN with the reason** —
never silence.

⚰️ `06-flip-packet.md:51`'s "2/15 PASS" is **historical-undefined**: it was scored
against a list that was never written down, and against a denominator (15) that R16 has
since struck. It is kept as history and must not be compared against any x/14 score
produced from this file.
