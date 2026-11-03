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
| | | | | | | |

## 2b. Production live run (Phase 1, owner-approved production use, NOT an eval-key run)
| date | where | turns | model calls | $ (production ledger) | E | C | R | U | X | W | H | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-03 | uctintelligence.com/charts, admin, planner v1 claude-haiku-4-5 | ~55 | 41 | ≈0.64 | 26 | 8 | 5 | 3 | 9 | 1 (substitution, nothing ran) | 0 | LIVE-TESTING-RESULTS-2026-11-03.md; counts approximate per the turn log |

## 3. Paid runs (none yet)
| date | phase | set | model | effort | n | E | C | R | U | X | W | H | task completion | exec gap | calls/turn | cache read % | $ actual | $ reserved | p50 ms | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | | | | | | | |

Cumulative paid evaluation spend: **$0.00** of $21.00 approved.
