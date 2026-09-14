# 01 — Failure forensics: what broke between 2026-08-30 and 2026-09-13, and why

**Sources, in the order they are trusted:**
1. Railway **environment-wide** log search (`tools/railway_env_logs.py`), 2026-08-30 00:00 → 2026-09-13
   ~16:00 UTC, one search per failure signature, every search gated on a live **known-positive
   control**. Result files: 26,033 `"fetch failed"` lines · 284 `"render failed"` · 122
   `"edit_original HTTP"` · 764 `"house render"` · 6 `"stand-in"` · 178 `"autocomplete failed"` ·
   0 `"job crashed"` · 4,785 `"hot warm hit"`.
2. chart-renderer's own logs, paged (42,769 lines, 2026-09-01 01:54 → 2026-09-13 14:04 UTC).
3. The #chart-flow-requests channel itself, read in the owner's Discord session (only the newest 11
   messages loaded: the window was a background tab and Discord does not page history there).
4. Direct probes of flow-worker and of the bench (`02-baseline.md`).

**Known positives the result was required to contain before any count below was believed:**
`[flow] fetch failed AMD (1): timed out` 2026-09-11 14:45:33 UTC · `AMDL (7)` 14:46:18 ·
`AXTI (30)` 2026-09-08 14:25:53 · `AXTI (1)` 14:36:58. **All four present.**

---

## ⛔ Finding #1 — the logging could not reconstruct most of this, and the first instrument lied

The brief asked for this to be said plainly if true. It is true.

| Gap | Consequence | Measured |
|---|---|---|
| No correlation id; the interaction id, ticker and user are absent from the failure lines | A Discord PATCH failure cannot be tied to the command, symbol or member it hit | 122 `edit_original HTTP` lines, 0 carrying a ticker |
| web writes **no access log** for `/api/discord/interactions`, and Railway keeps HTTP logs only for the live deployment | Interaction volume and acknowledgement latency for the last 14 days are **unrecoverable** — there is no denominator for a success rate | 0 rows for `"HTTP/1.1"`; 0 `httpLogs` rows on any removed deployment |
| Outcomes that reach a member are not logged at all: "Busy, try again", "No bars for X", "Chart failed", the `/flow` apology | An apology is invisible; only the underlying fault sometimes leaves a line | code read, `00-system-map.md` §6 |
| A job killed by a restart leaves **no line** | The most frequent class (C-01) is measurable only by inference | structural |
| `railway logs --since 14d` reads **one deployment**; `web` had 1,077 | The obvious command returns 7 lines and reads as "quiet" | measured |
| The first reconstruction (per-deployment loop) hit Railway's 1,000-requests/hour quota, lost **755 of 1,078** deployments to HTTP 429, printed `rows=0` after each failure — and found **1** `/flow` failure where the environment search finds **19** | A failed read reported as an empty one, then a count 19× too low | loop log in `LEDGER.md` |

Everything below is therefore a floor on what members experienced, not a census.

---

## Incidents (member-visible or member-reachable)

Times ET. "What the member saw" is derived from the code path that line proves ran
(`00-system-map.md` §3, §6), not from a screenshot, except where marked **(seen)**.

### A. `/flow` — 19 failures, every one told "The flow feed is reconnecting"

| When (ET) | Args | Failure | Root cause (evidence) | Class |
|---|---|---|---|---|
| 09-06 16:35 | AMD 30 | timed out (30 s) | flow-worker compute over web's 30 s budget | C-08 |
| 09-07 01:03 | AUR all | timed out | `days=all` is the most expensive window (bench: up to 20.9 s cold) | C-08 |
| 09-07 23:37 | ORCL 7 | **connection refused** | flow-worker not accepting connections (restart window) | C-08 / C-01 |
| 09-07 23:41, 23:42 | ORCL 7 ×2 | timed out | the member retried twice into the same outage | C-08 |
| 09-08 02:45 | MRNA 1 | timed out | | C-08 |
| 09-08 10:25 · 10:36 · 10:36 · 10:55 · 10:56 · 11:43 · 14:03 | AXTI 30 · CBRS 1 · AXTI 1 · MRNA 7 · AMD 1 · SHOP 63 · SHOP 1 | timed out ×7, **all RTH** | flow-worker loaded at the open; no time budget inside `_compute_ticker_flow` | C-08 |
| 09-08 09:04 | SPCX 1 | flow-worker **500** | `CancelledError: Task cancelled, timeout graceful shutdown exceeded` — flow-worker was being restarted mid-request (flow-worker logs) | C-01 / C-08 |
| 09-10 09:59 · 09:59 · 10:01 · 12:00 | AEHR 1 · AXTI 1 · MRNA 1 · MRNA 30 | timed out ×4, RTH | same | C-08 |
| 09-11 10:45 · 10:46 | AMD 1 · AMDL 7 | timed out ×2, RTH | flow-worker at 14:44–14:47 UTC: `flow-prepare` warms every minute taking 5–10 s and `Massive OI fallback timed out (>60s)` three times; AMDL answered 200 at 14:44:50, AMD never within 30 s | C-08 |
| 09-11 10:45 **(seen)** | two app replies in #chart-flow-requests read "flow feed is reconnecting" | | matches the AMD/AMDL lines to the minute | C-08 |

By cause: **18 timeouts · 1 connection refused** (+ the SPCX 500). **14 of 19 during RTH.** None of them
was a feed reconnect, which is the only thing the member was told.

### B. `/flow` — every ETF answers "no significant options flow", and it is false (systemic)

`run_flow_card_job` asks flow-worker for `source=stocks`. Verified against flow-worker, 30 days:
**SPY 0 vs 182 contracts with `source=etfs` · QQQ 0 vs 136 · SMH 0 vs 83.** Not an error — a confident,
wrong answer to every `/flow` of an index ETF. No log line exists for it (the reply is a normal
text edit). **Class C-14.**

### C. Chart replies lost because Discord closed the interaction — 23 `10015 Unknown Webhook`

The final PATCH to the reply returned `404 {"code": 10015}`: the interaction token no longer accepted
edits, so the member's reply stayed on "thinking…" (slash) or never updated (button).

| Day | Count (all RTH unless noted) | Neighbouring evidence |
|---|---|---|
| 09-03 | 1 | autocomplete failing in the same second (C-05 window) |
| 09-04 11:01 | 3 | renderer `502` for SHOP 60 in the same minute |
| 09-07 14:14 → 14:49 | **10** | renderer `502` for IOT D; `bars warm gate timed out after 30s` ×3 |
| 09-08 10:49 · 12:54–12:55 · 14:56–14:57 | **8** | renderer `502` for XFOR D at 12:54 |
| 09-10 12:00 | 1 | |

**22 of 23 in RTH.** Correlation measured against the renderer's page-load timeouts: **48 % of these
had a renderer `502 Page.goto: Timeout 21000ms` within ±60 s, against 1.3 % of random moments — 37×.**
The same condition that stopped `web` serving `/r/chart` within 21 s stopped it acknowledging Discord
within 3 s. Deploy age at failure was 5–50 minutes in every case, so this is **load, not boot**.
**Class C-02** (with C-11: none of these produced a message to the member).

### D. Every expanded chart lost its controls — 33 `COMPONENT_INVALID_EMOJI` rejections

`edit_original HTTP 400 {"code": 50035, … COMPONENT_INVALID_EMOJI}` on `components.1.components.4` /
`.2` / `2.0`: the collapse button's emoji was ▲ (U+25B2), a text symbol Discord does not accept as a
component emoji, so Discord refused the **whole** component tree. `edit_original` retried without
components, so the member got the chart with **no controls** plus a private "Chart controls are
unavailable on this one — re-run /chart". Fixed in `9d38e5d8e` (09-06 23:18). **Class C-03.**

⛔ **Process finding:** `test_chart_components_reflect_the_image_…` **asserted the invalid ▲**. The
suite pinned the bug it should have caught, and 7 Discord chart tests were red on master from
09-06/07 until this program corrected them (verified on a detached checkout of `f4fc5d1c1`).

### E. Follow-up edits refused — 23 `ATTACHMENT_NOT_FOUND`, both attempts failing

`400 {"code": 50035, "errors": {"attachments": {"0": ATTACHMENT_NOT_FOUND}}}` on the first attempt and
again on the component-stripped retry. 09-02 08:34 ×2 · 09-03 22:57 ×3 · 09-04 15:03 ×4 · 09-06 10:53,
23:31 · 09-07 00:36, 13:31, 15:56 ×3 · 09-08 13:53, 13:54, 17:49, 20:31 · 09-09 21:56 · (08-29, 09-01).
**0 % correlation with renderer 502s** (random: 1.3 %) — a deterministic payload fault, not load.

Root cause: **not fully determinable from these logs**, because the line names no ticker and no
request. The only code path that sends attachment ids without the file bytes is the context-line
follow-up (`keep_attachments` from the first edit's response); a component click or a later edit that
replaced the attachment between the two PATCHes would make those ids stale. Best hypothesis with that
evidence; the architecture removes the path either way (OI-04: fold the context line into the image
PATCH), and 3.5's real-Discord smoke tests the hypothesis directly. What the member saw: the chart
without its context line (if the follow-up failed) or no chart (if the image PATCH itself failed —
not distinguishable here). **Class C-04.**

### F. Ticker autocomplete dead for six days — 178 failures

`ticker autocomplete failed '<q>': 'Query' object has no attribute 'strip'`, first 08-31 10:38 ET,
last 09-06 14:47 ET. `fetch_ticker_choices` called the `ticker_search` **route function** in-process
without its `type` argument, so FastAPI's `Query()` default arrived as an object; the exception was
swallowed to `[]` and every `/chart` and `/flow` ticker field showed "no options match". Fixed in
`7d85bed1e`. The test's fake used the same two-argument signature as the broken call, so it could not
catch it. **Class C-05.**

### G. House renders that drew nothing — 258 blank bodies, 84 near-empty

`house render body BLANK` ×258 (08-30 → 09-02, then ~0 after `e80b0b00f`) and `house render drew 0/1
bar(s) … discarding` ×84. Each costs the 15 s + 25 s retry ladder before the stand-in. Most were the
warm cycle, not members (the member-facing ones end in a stand-in line, section H). **Class C-06.**

### H. Stand-ins delivered — 3, one healed

09-01 15:39 OSCR 60m ×2 (heal **gave up** after 45 s and 120 s — both members kept the simplified
chart) · 09-08 21:16 WDC D (healed). A stand-in draws SMA 10/20/50 on a 6-month window with no ext
chip and no earnings markers and **is not labelled**. In the closed-market bench it fired on 6 of 126
runs (4.8 %) with no member load. **Class C-06 / S8.**

### I. Renderer failures, by status — 238 × 422, 142 × 502, 34 × 404 (web side)

- `422 selector not found: #chart-export` — the page was not being served: a `web` deploy swap
  (web deployed 1,077 times in the window; the median pod lived 8.4 minutes). **C-01.**
- `502 render failed: TimeoutError: Page.goto: Timeout 21000ms exceeded` — `web` too slow to serve
  `/r/chart` within 21 s. All 142 on the renderer side are this one exception. **C-02.**
- 454 `ready predicate timed out` on the renderer (screenshot taken anyway, judged by web).
- Exactly **1** `chromium launched` in 12 days: the browser has never been recycled.

### J. The warm cycle ran over its budget 4,785 times

`hot warm hit its 20s budget after 20–26s — N chart(s) deferred`, essentially every minute of every
day. The renderer served ~3,300 renders a day, most of them warming, through the same 8 slots members
use. **Class C-09.**

### K. Silent paths with no line at all

- Jobs killed by a `web` restart (≈77 a day): no trace by construction. **C-01.**
- `run_chart_job`'s crash path edits nothing: **0** `job crashed` lines in the window — not observed,
  and still a silent path in code (railed in 2.1a). **C-11.**
- The render token in renderer logs: Playwright's call log prints the full navigation URL, token
  included, on every `Page.goto` timeout (142 times). **C-13.**

---

## Failure classes

Each class gets a fix in Phase 2 and a regression test before it is closed (`05-progress.md`).

| Class | Name | Evidence (this doc) | Closed by (03) | Regression test (status) |
|---|---|---|---|---|
| **C-01** | A `web` restart kills in-flight replies and blanks the page the renderer screenshots | 1,077 deploys, median 8.4 min; 238 × 422; SPCX 09-08 flow-worker restart | 2.1 durable jobs + resume · 2.3 swap-signature retry | `test_C01_resume_*` (2.1, mutation-proved) |
| **C-02** | `web` saturation → Discord acks miss 3 s and page loads miss 21 s | 23 × 10015 (22 RTH), 37× co-occurrence with 142 × 502 | 2.1 off-loop ack + dedicated workers · 2.3 background renderer lane | `test_v2_chart_is_offered_and_deferred_without_a_background_task` (2.1b, mutation-proved) · load test 3.1 |
| **C-03** | Discord rejects the whole component tree (invalid emoji, duplicate id, >100 chars) | 33 × COMPONENT_INVALID_EMOJI | 2.6 pre-flight validation | components test forbids U+25B2 (2.1a, mutation-proved) · validator rail (2.6) |
| **C-04** | A follow-up edit re-declares attachments Discord no longer has | 23 double-failed ATTACHMENT_NOT_FOUND, 0 % load correlation | 2.6 / OI-04 context folded into the image PATCH | 2.6 (pending) · real-Discord 3.5 |
| **C-05** | A FastAPI route function called in-process leaks a `Query()` default | 178 autocomplete failures, 6 days | 2.4 service functions only + import rail | autocomplete fake bound to the real signature (2.1a, mutation-proved) |
| **C-06** | A render that drew nothing costs 40 s of retries, then an unlabelled stand-in | 258 blank + 84 near-empty; 3 stand-ins, 2 never healed; 4.8 % in bench | 2.3 renderer pool + hard timeout · 2.7 labelled stand-in | 2.3 / 2.7 (pending) |
| **C-07** | Data or wall-clock shown as current when it is not | footer wall clock, header live quote: 27 of 85 closed-market cases differ run-to-run | 2.4 freshness envelope, vintage stamp, STALE badge | 2.4 / determinism 3.3 (pending) |
| **C-08** | `/flow` failures misreported, and no time budget | 19 failures: 18 timeouts + 1 refused, all "reconnecting"; 9/11 flow-worker OI fallback >60 s | 2.1a per-class contract · 2.4 10 s budget + labelled cached card | `test_C08_*` (2.1a, mutation-proved) |
| **C-09** | The warm cycle competes with members for the renderer | 4,785 over-budget cycles; ~3,300 renders/day | 2.1 background lane · 2.3 renderer background slots | 2.3 (pending) |
| **C-10** | Cold bars storms hold the bars gate for 30 s | 42 `warm gate timed out` (per-deployment pass) | 2.4 per-hop timeouts + jitter | 2.4 (pending) |
| **C-11** | A delivery failure or crash ends with nothing said | 23 × 10015 + 23 × ATT finals produced no member message; crash path edits nothing | 2.1 runtime terminal-state guarantee | `test_C11_*` (2.1, mutation-proved) |
| **C-12** | Failures cannot be tied to a command, symbol, member or request | Finding #1 | 2.2 correlation ids, structured events, jobs table | 2.2 built (`2509cc0de`, merged `6d779dd47`): `test_discord_render_observe.py` · `test_discord_render_health_command.py` · `test_discord_render_health_endpoint.py` — 18 mutations red |
| **C-13** | A credential in logs | 142 renderer call logs with the render token | 2.3 renderer log hygiene · OI-13 rotation | 2.3 (pending) |
| **C-14** | `/flow` queries the wrong partition: ETFs report no flow | SPY 0 / 182, QQQ 0 / 136, SMH 0 / 83 | 2.4 resolver picks the partition (OI-16) | 2.4a built (`0e331168a`), V2 path: `test_the_flow_partition_follows_flow_ingestions_classifier_then_the_etf_list` · `test_the_v2_flow_handler_passes_the_resolved_partition` · `test_the_flow_job_reads_the_partition_it_is_given_and_defaults_to_stocks`. Production class table: SPY/QQQ/SMH/IWM/SPX/NDX → `etfs`, NVDA/AAPL → `stocks` |

**Where the gaps are, stated once:** the member-facing split of the 764 house-render problems, the
denominator for every rate, the command/ticker behind each Discord PATCH failure, and the count of
restart-killed jobs are not recoverable from what was logged. V2's jobs table (2.1) and structured
events (2.2) exist so the next fortnight's version of this document is a query.
