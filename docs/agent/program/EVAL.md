# EVAL.md — real-model evaluation record

## 0. Spending controls (owner mandate 2026-11-02) — status
- Approved: initial evaluation budget **$21 cumulative across all workers and sessions**; additional $0 until approved; production Agent $5/day; shared UCT AI $15/day; Claude Code extra paid usage $0; no automatic increases.
- **No paid call has been made. No paid call may be made until the owner explicitly approves the start**, after the controls below are verified:
  1. dedicated evaluation key/workspace separate from production (owner provisions);
  2. cumulative cross-run ledger with pre-call reservations (BOARD A-03) — the per-run `--max-usd` ceilings alone do not sum across runs;
  3. provider-side hard limit verified (not an alert);
  4. accounting includes retries, cache writes/reads, thinking tokens, second calls;
  5. SDK retries off (`max_retries=0`) and no automatic fallback model.
- Controls audit: `docs/agent/audit-2026-11-02/appendix/H-spending.md` (docs branch, PR #702).
- **Owner decision 2026-11-02 (after the spending report):** APPROVED — free Wave 1 development; the cumulative $21 reservation ledger; eval-key separation across all four tools; fail-closed on unverifiable budget/credentials; stubbed paid research during evals; concurrency/retry/timeout/exhaustion tests; daily spending reports. NOT APPROVED — any paid evaluation call; production credentials for evals; automatic limit increases; extra paid Claude Code usage; production spending-policy changes without review.
- **Proofs required before Phase A can be requested** (BOARD A-03 acceptance): (1) every eval tool uses only `UCT_AGENT_EVAL_API_KEY`; (2) all workers share one durable cumulative ledger; (3) the $21 cap cannot be exceeded via concurrent calls, retries or separate runs under the stated accounting; (4) the dedicated Anthropic workspace spend limit is configured and verified (owner); (5) no paid secondary provider can be called; (6) the production Agent budget (`budget.py`, `limits.py`) is unmodified and never imports the ledger.

## 1. Baselines (free, deterministic)
| date | set | mode | result | source |
|---|---|---|---|---|
| 2026-10-13 | corpus.json (195) / heldout-v1 (146) / adversarial (50) | deterministic layers | ideal-fast 0.695 / 0.41 / 0.125; wrong 0 / 1 / 2 | conversational-intelligence/BASELINE.md |
| 2026-11-02 | quote held-out 1–4 | deterministic resolver | FAIL 0 on all four | status/agent-qa.md |
| 2026-11-02 | discovery.json (31) | fast path / grammar | 0/31 / 5/31 | scores/ |

## 2. Dry-run estimates (free; to be filled by A-02)
| set | mode | model | requests | prompt tokens (est.) | typical $ | worst-case $ |
|---|---|---|---|---|---|---|
| realModelBench.v1.json (81 cases), 2026-11-22 | legacy, routing v2 + reroute table | claude-haiku-4-5 | 93 | ~16.2k/request (1.13M–1.51M total), 62 distinct system prompts | $1.55 cached / $1.67 uncached (1 call each, 350 out) | formula $5.68 (every request 2 calls × full 2,048 out); first calls only at full output $2.84; **hard-capped by `--max-usd 2.50`** |

## 2b. Production live run (Phase 1, owner-approved production use, NOT an eval-key run)
| date | where | turns | model calls | $ (production ledger) | E | C | R | U | X | W | H | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-03 | uctintelligence.com/charts, admin, planner v1 claude-haiku-4-5 | ~55 | 41 | ≈0.64 | 26 | 8 | 5 | 3 | 9 | 1 (substitution, nothing ran) | 0 | LIVE-TESTING-RESULTS-2026-11-03.md; counts approximate per the turn log |

## 3. Paid runs (none yet)
| date | phase | set | model | effort | n | E | C | R | U | X | W | H | task completion | exec gap | calls/turn | cache read % | $ actual | $ reserved | p50 ms | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | | | | | | | |

Cumulative paid evaluation spend: **$0.00** of $21.00 approved.

## 4. Real-model bench v1 (2026-11-22, W1): built free, owner runs the one paid command
The first real-model benchmark since 10-08 (routed 46/57). Every coverage number since then has used a scripted model.
- **Corpus** `app/src/agent/__fixtures__/nlIntent/realModelBench.v1.json`: 81 cases / 93 model turns. The mix is 33 natural single-step requests (41%), 28 multi-step or compound (35%), 12 follow-ups (15%: 10 conversations of 2–3 turns plus 2 answers to a waiting question) and 8 must-ask (10%). It covers ten families: chart, multichart, indicator, authoring, drawing, layout, widget, watchlist, screener and data. Six boards of its own have drawings on and use corpus.json's library. Each turn names its board, its expected outcome (action kinds and target charts, or a question) and its forbidden outcomes: `never` actions (always including every destructive action the request did not ask for), `notOn` charts and `safety`. No phrasing is copied from the visible sets.
- **Production shape**: capture with `AGENT_EVAL_MODE=legacy AGENT_EVAL_ROUTER=v2 AGENT_EVAL_LEGACY_REROUTES=1`. That is today's panel (planner v1, legacy interpreter, routing v2). The replay makes the panel's one `need_groups` reroute from the table. The deterministic fast paths and compound chaining run in the browser before the model, so they are **not** in this measurement: it measures the model on every request.
- **Outcome scoring** (`testing/bench.js`): one outcome per turn, from success, wrong_action, wrong_chart, unnecessary_ask, missed_ask, refusal, unsafe or error. It judges what the plan would do, not its text. Equivalent plans (`alt`), argument sets (`$has`/`$in`) and extra read-only lookups all pass, and `extraOk` lists any allowed extra changes. A free oracle test (`agentRealModelBench.test.js`) proves each expectation scores success when it is met.
- **Latency baseline**: each result row has `model_ms` (the model wall time, over all of its calls), `rounds` and `call_ms`. The scorer prints p50/p95/max per request and per call, and the mean/max rounds.
- **Held-out**: `AGENT_EVAL_FILES=realModelBench.v1.json,<abs path>@sealed` adds AUDIT's sealed subset to the same capture → run → score. A sealed file prints aggregates only.
- Paid command, score command and cost: `C:\w\pl-w1eval-report.md`. Results go in §3.
