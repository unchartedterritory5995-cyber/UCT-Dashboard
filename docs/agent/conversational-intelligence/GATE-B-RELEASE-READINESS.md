# Gate B — release-readiness report (2026-10-13, 16:26 ET)

**Verdict: READY FOR AUTHORIZATION.** Nothing has been pushed, merged or deployed. No paid inference has been run.

## Candidate
- **Branch:** `release/agent-gate-b` (C:/w/aconv). Push its **head** (the last code commit is `a54180de5d`; only this report follows it).
- **Base:** cut from current master **`2d4c93293c`** (= production). It is a **fast-forward** (verified 16:26 ET).
- **Contents:** 11 commits plus this report, Gate B only. No Gate C file is in it; Gate C lives on `feat/agent-conv-gate-c` and is a separate release.

| Commit | What |
|---|---|
| `ff6b59a1bc` | Layer-A evaluation harness, held-out v1, Gate A design and vocabulary proposals (docs + tests) |
| `68040b8b0f` | $5/day Agent spend ledger (worst-case reservations), shared-$15 stop, 2 calls per request, rate limits, `GET /api/agent/budget` |
| `495a4c2883` | Safety: "open swing" / "remove momentum" never picked instantly; unknown tickers suggested, never substituted |
| `568db968b4` | Normaliser, soft trading vocabulary, live-name and typo-aware routing; held-out v2 |
| `40f0c80a94` | Panel test: refusals with instant commands still working |
| `20cb7a31eb` / `8375047acd` | Gate B report |
| `844a6abea7` | "Shared $15, never site-wide" wording; budget options; delayed-settlement tests |
| `2da5130e99` | **Option D recorded**; paid-AI paths follow-up |
| `f47b97e0f2` | Research cost is **opt-in** on `web_search` (no other caller's result changes shape) |
| `a54180de5d` | Ledger: flow-worker strand classified |

## Budget policy (Option D, owner 2026-10-13)
- **Two separate budgets:**
  - UCT Agent **$5/day** (`UCT_AGENT_BUDGET_USD`, atomic reservations, fails closed);
  - the shared **$15/day** (catalyst ledger, unchanged).
- **Combined potential maximum across their covered features: $20/day.** Neither budget is site-wide.
- The Agent stops at either cap and never writes to the shared ledger.
- No other allocation changes. Member access is unchanged (admin-only).

## Evidence
| Check | Result |
|---|---|
| Agent frontend suite (`src/agent`) on the release branch | **1,203 passed**, 0 failed |
| Backend: every test file touching the Agent, Perplexity, cost guards, daily counters, the AI-door census or the cost log (100 files) | **3,084 passed, 6 failed.** All 6 (5 × `test_definition_concierge`, 1 × `test_notebook_earnings_prep`) **fail identically on pristine master `2d4c93293c`**, so they are pre-existing and unrelated. |
| `test_ai_search_briefings::test_pass_budget_stops_the_sweep_without_stamping` | Fails on pristine master too: pre-existing |
| Spend and limit tests (`test_uct_agent_spend_limits.py`, 27) | **27 passed**: 40-thread concurrency gives exactly $5; restart in a second process; missing usage / timeouts at worst case; provider error released; crash keeps counting; settle after midnight; idempotent settle; fails closed; shared-$15 stop; call ceiling; forged reroute; research skip; rate windows; in-flight lease; opt-in research cost |
| Wrong actions (layer A, all 5 sets) | **0** |
| Flow-worker coverage gate | Flags `api/services/perplexity_search.py`. **Classified NOT EXERCISED** in the ledger: opt-in keyword, default byte-identical; **no marker bump** |
| Latency benchmark | within budget |
| Real-model smoke | **not run** (no paid inference authorised) |

## What changes in production on deploy
- **Admin-only:** the Agent's model path is now capped at **$5/day** and the shared-$15 stop applies.
  - Before this, production had **no Agent dollar cap** (`UCT_AGENT_COST_CAP_DAILY` was unset).
  - Refusals are one sentence; instant commands are unaffected.
- **Rate limits:** 20/min and 300/h per member, 120/min globally, 1 in flight. These apply to model requests only.
- **New tables:** four in `uct_agent.db` on the web volume (`agent_spend`, `agent_requests`, `agent_rate_events`, `agent_inflight`), created automatically and additive. No migration, **no environment change**.
- **Instant path:**
  - ambiguous names now go to the model (one call) instead of being guessed;
  - unknown-ticker refusals may suggest a near ticker;
  - routing sends the model fewer wrong action sets (fewer reroutes).

## Release steps (when authorised)
1. `git fetch`; confirm `origin/master` is still `2d4c93293c` (else re-cut the candidate and re-run the checks).
2. In a Railway-linked worktree: run `python tools/pre_push_guard.py` **on its own** (not piped). It has not been run yet, because it needs the Railway link.
3. `git push origin <release/agent-gate-b head sha>:refs/heads/master`.
4. Run the master deploy gate, then the promote-production workflow. Check **`promoted: yes`**, not only "success".
5. **⚠ Deploy freeze: Wednesday 09:00–11:00 ET** (tomorrow, 2026-10-14). Release outside it, or with your explicit override.
6. **Verify:**
   - `GET /api/agent/budget` (admin) shows a $5 cap, $0 committed, and the shared cap $15;
   - one instant command and one model request in the admin panel (one paid call, only with your approval);
   - an Agent turn's ledger row (tokens / category / outcome).
7. **Rollback:** revert the commits through guard → gate → promote. Railway rollbacks don't hold here. The new tables are inert once the code is reverted.

## Known limitations (also in GATE-B.md)
- The $15 is not site-wide. About 80 other paid AI paths and two unauthenticated ones are a separate follow-up (FOLLOWUP-PAID-AI-PATHS.md).
- Reservations are deliberately large, so the Agent stops a few cents before $5.
- Rate limits fail open on a store error; the dollar cap fails closed.
