---
id: WISDOM-SESSION-18
title: Session 18 — one INGEST night (not two), the entity master was never empty, and EXTRACT is held by a gate nobody had named
status: complete — EXTRACT HELD, $0.00 spent, no Railway write made.
---

# Session 18 — the readiness gate failed, and every reason was a surprise

> **INGEST nights: ONE, HEALTHY** (not two — Tuesday's slot preceded the flip) ·
> **entity master: POPULATED** (32,651) · **tooling: LANDED** · **EXTRACT: HELD**
> **SPEND $0.00.** No Railway variable set this session. Ledger byte-identical.

⭐⭐ **EVERY ONE OF THE THREE THINGS THIS SESSION WAS ASKED TO CONFIRM CAME BACK DIFFERENT, AND
THE EXTRACT GATE FAILED FOR A REASON NO READINESS LIST CONTAINED.**

| asked | answer |
|---|---|
| two INGEST nights, healthy? | **ONE** night. Healthy. Tuesday's 18:47 slot ran **before** the flip |
| entity master empty — seed it? | **POPULATED: 32,651 entities**, seeded 2026-09-07. Nothing to seed |
| light EXTRACT if ready? | **HELD** — and not for any reason on the E-list |

---

## A — What is live

`origin/production` **==** `origin/master` **== `9081799f2`**, so no red gate is holding production
(A2 is moot). Every EXTRACT precondition is already serving:

| commit | on master | on production | what |
|---|---|---|---|
| `c0c950fbb` | YES | YES | the landing merge |
| `7c4202912` | YES | YES | R53 N-pass |
| `193342dc6` | YES | YES | R53 per-night budget in the N-pass loop |
| `6bbf09566` | YES | YES | R53 daily budget default |
| `70163937c` | YES | YES | R52 force never bypasses the spend switch |
| `70a7d8b0f` | YES | YES | R56 volume root |
| `7ea5a05cf` | YES | YES | R57 weekly deletions |
| `4ccf9fc14` | NO → **landed this session** | | session-17 lander fix |

⭐ `4ccf9fc14` doubles as the **control**: a real commit correctly reading NO/NO while the others
read YES/YES.

## B — The INGEST night

**There has been ONE, not two.** `GET /api/admin/wisdom/core/runs?job_id=wisdom_daily_chain`
returns **`count: 1`**, due_key `2026-09-16`. The heartbeat reads `beats: 3`,
`consecutive_failures: 0`.

⭐ **Those two numbers together are the proof, and they only mean something once you know that a
skipped slot writes no run row.** `registry._run_job` returns after `heartbeat.beat(...,
"skipped")` and **before** the `INSERT INTO wisdom_job_runs`. So three weekday slots reached the
job (Mon 09-14, Tue 09-15, Wed 09-16 — `trading_days_only`) and exactly one ran. The flip was
2026-09-16 **02:22 ET**; Tuesday's 18:47 slot was ~32 h earlier, with the master switch off.

**Wednesday 2026-09-16, 18:47:00 → 18:49:57 (177 s), status `ok`** — 7 ok, 0 failed, 0
not_available, 5 skipped:

| # | step | outcome |
|---|---|---|
| 0 | capture | ok — **175.069 s**, and it wrote nothing (see below) |
| 1 | sources | ok, 0.022 s |
| 2 | stt_alias | skipped — runs inside `extract.run_daily` |
| 3 | **extract** | **skipped — `WISDOM_EXTRACT_ENABLED` is off** |
| 4 | evals | ok |
| 5 | retrieval | skipped — `WISDOM_RETRIEVAL_INDEX_ENABLED` off |
| 6 | adapters | ok, 0.394 s |
| 7 | level_alerts | ok |
| 8 | lookalike | ok |
| 9 | rq_v11_001 | skipped — RQ-v11-001 |
| 10 | reconcile_stability | skipped — **"only 0 persisted run(s); need 3"** |
| 11 | publication_floor | ok |

Interval jobs are healthy and confirm session 17's prediction exactly: `wisdom_core_catchup`
→ `{"ran": [], "considered": 3}`, `wisdom_core_watchdog` → `{"checked": 4, "overdue": [],
"paged": []}`, every 300 s, all `ok`, **nothing paged, nothing overdue**.

⚠️ **One thing is unexplained and is recorded rather than smoothed over: `capture` reported `ok`
after 175 seconds and wrote zero rows**, with `WISDOM_CAPTURE_ENABLED` off. A no-op should not
take three minutes. It is not harmful and it is not spend, but nobody has said what it was doing.

## C — The entity master (R60)

**POPULATED.** `GET /api/admin/entity-master/status`: **32,651 entities**, 32,664 aliases, 6,058
delisted, 26,593 active, `ambiguous_count` 0, `last_seed_at` **2026-09-07T03:12:38Z**, `db_path`
`/data/entity_master.db`. **There is nothing to seed, and the seed task does not exist.**

⚰️ Every prior "empty" reading was **local**, and was the conftest sandbox — R42's mechanism one
level up. **Session 9's "every CALL demoted to MENTION by an unresolvable entity master" is a
property of the test harness, not of production**, and the 76.8% recovery figure measures a local
corpus under a local seed.

## D — Tooling landed (R62)

## E — The readiness gate

| # | gate | verdict |
|---|---|---|
| E1 | N-pass, budget, R52, R56 serving on production | ✅ |
| E2 | ledger cap reaches production | ❌ **it does not, and cannot** |
| E3 | entity master POPULATED | ✅ 32,651 |
| E4 | both INGEST nights healthy | ◐ **one night, and it was healthy** |
| E5 | member doors dark | ✅ only `WISDOM_INGEST_ENABLED` exists, on one service |
| E6 | arithmetic | ✅ computed, below |
| — | **a golden-gate receipt in production** | ❌ **`wisdom_eval_runs = 0` — not on anyone's list** |
| — | **anything to extract** | ❌ **`wisdom_sources = 0`** |

**F0: EXTRACT lights nothing.** No Railway variable was set.

## F — Why EXTRACT is held, precisely

Three findings, each independently fatal to the plan, each adversarially verified by an
independent agent instructed to refute it. **Two of my three claims came back refuted on
mechanism while their conclusions survived** — which is the useful outcome, because the reasoning
is what the next session would have inherited.

### F1 — The ledger cap reaches nothing, in either direction

`R59_LEDGER_CAP_USD: 2000.0` edits `data/wisdom/extract/spend-ledger.json`. That file has **no
reader under `api/`** — proven with a control showing the same search form does reach `api/`. And
`api/` is what production runs.

⭐ **Stronger than I claimed:** `cap_usd` in that JSON is **write-only even for the PC-side gate**.
`extract_golden_gate.py` reads only `entries` from it and takes its ceiling from `--max-usd`
(default 40.0), writing `cap_usd` back as a record of what was used. **Editing 100.0 → 2000.0
changes nothing, anywhere.**

The knob that would have to carry a corpus-sized budget is **`WISDOM_EXTRACT_BUDGET_USD`**
(programme total, currently unset at its **120.0** default) — and that name is not in this
session's permitted list, so no session could have set it anyway.

### F2 — The "per-night" budget is not per night. It clamps the programme.

⛔⛔ **A real defect, measured by executing the real module.** `select_within_budget`'s predicate
(`budget.py:271`) compares **cumulative programme spend** — `SUM(cost_usd_actual) FROM
wisdom_batches`, **no date filter** (`budget.py:242-248`) — against `cap = min(programme, night)`
(`batch.py:438`).

Seeded with $75 of night-1 actuals and ten $5 estimates:

```
combined cap 75.0  ->  programme actual to date 75.00  ->  allowed 0 of 10
   "budget stop (all extractor versions): actual $75.00 + pending $0.00 + next $5.00 > cap $75.00"
CONTROL, same DB, cap=None -> 120.0 -> allowed 9 of 10
```

**Night 2 gets zero, while $45 of programme headroom sits unused.** Spend asymptotes toward the
night cap instead of rationing nights. So `R59_NIGHT_BUDGET_USD: 75` would have bought **one**
night and then silently stopped — reporting a clean `budget_stop` every night after.

⚠️ It binds only on the N-pass path (`batch.py:530`: `n <= 1` short-circuits past `night_cap_usd`).
`WISDOM_EXTRACT_PASSES` is unset in production → `DEFAULT_PASSES = 3` → **it binds.**
⛔ **No rail covers it**: `test_wisdom_npass_chain.py:246` pins only the *raise* direction.

### F3 — Production has nothing to extract, and a gate would refuse it anyway

```
production  wisdom_sources 0 · wisdom_segments 0 · wisdom_extract_requests 0 · wisdom_eval_runs 0
            wisdom_review_queue 36     <- non-zero: the reader works (the control)
local store wisdom_sources 63 · wisdom_segments 83 · wisdom_records 826 · wisdom_principles 91
```

**The programme's entire working set is local. Production has never held the corpus.**

⛔ **But "0 segments ⇒ nothing_to_do" is the wrong mechanism**, and inheriting it would mislead:

1. `run_daily` does not read segments — it **writes** them from `wisdom_sources`
   (`batch.py:518` → `segment_pending_sources`). The gating table is **`wisdom_sources`**.
2. **The golden gate is checked first** (`batch.py:519-524`). `golden.gate_status` reads
   `wisdom_eval_runs`, which is **0**, so it returns `accepted: False` and the real status is
   **`blocked_by_gate`**. ⭐ **A golden-gate receipt has to be imported into production before the
   extractor accepts anything — and that appeared on no readiness list, including mine.**
3. **Retry rows are a second input** (`retry_rows`, no join to segments): one `retry` row defeats
   `nothing_to_do` entirely.

$0.00 therefore requires **three empty tables plus the gate**. All four confirmed in production.

> ⛔⛔ **A first "paid night" that costs nothing and writes nothing is indistinguishable, in every
> dashboard, from one that worked.** That is the same well-formed-degraded-answer class as R42's
> demoted CALLs and the vacuous N-pass salt tests. Lighting EXTRACT tonight would have produced a
> clean-looking run, a $0.00 ledger, and no reason to look further.

## E6 — The arithmetic, for when it is real

Measured rate **$0.058671** per segment-pass (mean), **$0.06139** (p90):

| throttle | segments/night at N=3 | $/night mean | $/night p90 | nights for 9,733 |
|---|---|---|---|---|
| 400 (today) | 133 | 23.47 | 24.56 | **73.2** |
| 1,200 (R59) | 400 | 70.41 | 73.67 | **24.3** |

Corpus at N=3 = 29,199 requests ≈ **$1,713** mean. ⭐ **Patrick's $2,000 is the right order** — it
is simply aimed at a file nothing reads. Put it on `WISDOM_EXTRACT_BUDGET_USD`.

## QUESTIONS FOR PATRICK

1. **The night-budget defect (F2) is a spend-semantics decision, so I did not touch it.** Should
   `WISDOM_EXTRACT_DAILY_BUDGET_USD` ration a *night* (date-filter the actuals it compares
   against) or keep clamping the programme? The first is what the name promises; the second is
   what the code does. Either way it needs a rail, because none exists.
2. **The real budget knob is `WISDOM_EXTRACT_BUDGET_USD`** (unset, default 120.0). Naming it in a
   ruling block is the only way a session can set it. ~$1,713 funds the corpus at N=3.
3. **A golden-gate receipt must be imported into production** (`wisdom_eval_runs = 0`) before
   extraction can be accepted at all. Which of the three PC-side gate runs should be imported,
   and by what mechanism? No tooling for this exists.
4. **Nothing reaches production's corpus while `WISDOM_SOURCES_INGEST_ENABLED` and
   `WISDOM_CAPTURE_ENABLED` are off.** That — not EXTRACT — is the next ruling.
5. **`capture` ran 175 s and wrote nothing** with its switch off. Unexplained; not spend.
6. **One INGEST night, not two.** A second (tonight, 18:47 ET) needs no action — it will run.
