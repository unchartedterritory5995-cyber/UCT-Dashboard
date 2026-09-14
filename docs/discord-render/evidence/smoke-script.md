# 3.5 — the real-Discord smoke, as an ordered script

**Purpose:** the only manual step is typing. Everything else — the corr_ids, the log lines, the
delivered artifacts, the screenshots — is captured from the bot side against each step below.

⛔ **PRIVATE TEST CHANNEL ONLY.** Not `#chart-flow-requests`. **Organic members exposed: 0**, and
that number is stated on every report this evidence feeds.

⛔ **RUN ORDER MATTERS.** Steps 1–3 establish that the healthy path works before anything is broken;
a degraded-state step that runs first cannot tell "the badge is right" from "everything is broken".

⚠️ **The flag state each step assumes is named.** Steps 1–9 run with `DISCORD_RENDER_V2_ENABLED`
**absent** (the pre-V2 path, which is what members are on today) — they are the CONTROL, and without
them the V2 steps have nothing to be compared against. Steps 10+ assume the admin-only canary flip,
which is gated on `flip_preconditions.py` printing `ALL MET`.

---

## What is captured for every step, automatically

| Artifact | Where it comes from |
|---|---|
| `corr_id` | the `drender` event stream, or `/renderhealth`'s recent-failures line |
| the delivered message | screenshot, **plus** its text read back so a badge can be asserted rather than eyeballed |
| per-hop timings | 2.2's structured events (`ack_ms`, `final_ms`) |
| the durable row | `/data/discord_render_jobs.db`, keyed on `corr_id` |
| renderer state | `GET /health` on chart-renderer, before and after |

⛔ **A screenshot alone is not evidence of the badge copy.** An image label is invisible to a screen
reader and to anyone with images off — which is the same member C-06 failed — so each step that
expects a label asserts the **message text**, and the screenshot is corroboration.

---

## The script

| # | Type this | Expect | Proves |
|---|---|---|---|
| 1 | `/chart ticker:NVDA` | a house chart, **once**, with controls; no label of any kind | the healthy path, and that a healthy chart carries **no** badge (a badge on every chart is furniture) |
| 2 | `/chart ticker:NVDA` again, within the TTL | the same chart, faster | the cache is serving — compare `final_ms` against step 1 |
| 3 | `/chart ticker:NVDA tf:5` | an intraday chart | the timeframe path and the intraday freshness rule (AGE during RTH, SESSION otherwise) |
| 4 | `/chart ticker:ZZQQX` | an ephemeral refusal naming the symbol, ≤3 suggestions, **no** "thinking…" that never resolves | D-04 / S6, and that a refusal is an ACK not a deferred job |
| 5 | `/flow ticker:SPY days:30` | real contracts, **not** "no significant options flow" | **C-14** — the ETF partition. This is the one step that is a member-visible correctness fix |
| 6 | `/flow ticker:NVDA days:1` | a card, or an honest "no significant options flow" | the quiet-session answer is an ANSWER, not a failure |
| 7 | `/charts ticker:NVDA ticker2:AMD` | a multi-chart image | the multi path, and that every attachment id names a part in the same request |
| 8 | `/buzz` | the board, **ephemeral** (only you see it) | the on-demand board is ephemeral and throttled; the scheduled one is not |
| 9 | `/renderhealth` | the health text: queue, renderer, windows, failures, alerts | the admin read path works **before** the flip, which is the point of it |
| 10 | *(canary flip)* `/chart ticker:NVDA` | identical to step 1 | V2 changes the envelope, not the chart |
| 11 | `/chart ticker:NVDA` with the renderer stopped | a **stand-in** chart whose MESSAGE says `⚠ simplified chart — …` | **C-06**, the half that a counter cannot see |
| 12 | `/chart ticker:NVDA` on a closed market with stale bars | the chart plus the vintage sentence in the footer, and the badge drawn **in the image** | **C-07** end to end, including the producer |
| 13 | click **Retry** on a failed reply | a fresh job with a NEW corr_id | the control path and the durable row |
| 14 | click a timeframe control | the chart is REPLACED, not duplicated, and the controls survive | **C-03**/**C-04**: the component tree is accepted and no id goes stale |
| 15 | `/chart` while the renderer breaker is open | a named failure message with its class and `id`, within the deadline | **C-11** and S3 — never silence |

---

## The four badge states, and how to reach each deliberately

| State | How | The member must see |
|---|---|---|
| **fresh** | step 1, market open or closed with current bars | **nothing at all** — no `as_of`, no "checked", no id |
| **cached** | step 2 | the chart, and `served from a slower backup source` only if it came from a backup, not merely from cache |
| **STALE** | step 12 | `⚠ data as of <date>` in the message **and** stamped in the image |
| **DEGRADED / stand-in** | step 11 | `⚠ simplified chart — <class>` in the **message content** |

⛔ **The fresh row is the one most likely to be skipped and the most important.** Three of the four
states are about saying something; the fourth is about saying **nothing**, and a badge that shows
when nothing is wrong is not there on the day it matters.

---

## Phone width

Every screenshot is re-read at ~390 px. ⛔ **A chart attachment is scaled by its HEIGHT when a
client fits a portrait image into a landscape box** — the `/buzz` board was 262 px wide with 4 px
type for exactly this reason. Check the chart is legible and the message text is not truncated
before the badge clause, which is the clause that must never be the casualty.

---

## What "done" means

Every row above has a screenshot, a `corr_id`, and — where a badge is expected — the message text
asserted, not eyeballed. A row that could not be reached is recorded as **NOT RUN with the reason**,
never quietly dropped: the whole value of this step is that it is the only evidence in the programme
that is not about a rig.
