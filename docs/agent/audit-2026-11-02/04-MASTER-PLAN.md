# Deliverable 4 — Accelerated master development plan

From today's product (a dark, single-page website operator with an unmeasured planner) to the vision in Parts 1–2 of the brief. Organized as **vertical packages** built in parallel by package owners, integrated continuously, released as bundles, and activated for admin as part of "done".

## 1. Principles that replace the current process

1. **Vertical packages, not horizontal layers.** A package = user-visible outcome + the data kinds, capabilities, prompts, tests and activation it needs. One owner builds it end to end. Contracts between sessions are replaced by the registry (already a contract) and by one integrator.
2. **The real-model eval is the gate.** A package is done when its acceptance prompts pass on the real model in the harness, not when its unit rails are green.
3. **Admin activation is part of done.** Flags default off for members; for admin they are turned on when the package passes its gate. Nothing ships invisible.
4. **One integrator, one integration branch with CI, one weekly release train** (plus hotfix). Builders never merge to master.
5. **Pre-authorized envelopes.** The owner approves budgets, model and flag policy per wave, not per PR.

## 2. Workstreams (packages) and dependencies

```
 W0 Foundation (planner + eval + CI)  ──┬──► P1 Executing Operator ──► P3 Scanner & Workflows ──► P5 Coach
                                        ├──► P2 Market Analyst ───────► P4 Research & News ────┘
                                        └──► P6 Whole-site Operator (host) ─────────────────────► P7 Multimodal
                                                                                                 P8 Member rollout
```

| Package | User-visible outcome | Reuses | New code (est.) | Depends on |
|---|---|---|---|---|
| **W0 Foundation** | (invisible, but short) Sonnet 5.5 tool-use planner with full catalog; nightly real-model eval; CI on `agent/int`; Agent suite out of the serial gate | `turn.py`, `agent_live_batch.py`, eval sets, sealed sets | ~1,500 lines | owner: budget, model, CI change |
| **P1 Executing Operator** | multi-step requests run end to end on `/charts`: "find X, put the best five on a list, open four charts, add my indicators, save the layout"; time-anchored drawings; dated close; indicator alerts; remaining chart settings; widget options; replay | all 121 capabilities, `compose.js`, drawings writers, `useIndicatorAlerts`, registry param schemas | ~3,500 | W0 |
| **P2 Market Analyst** | quote/bars/fundamentals/earnings/company-news/themes answers with freshness; index/commodity/crypto kinds; comparisons; "how has X behaved after…" via event study | 13 gateway kinds (11 unused), `event_study.py`, MD-1 | ~3,000 | W0 (flags DATA on) |
| **P3 Scanner & Workflows** | conversational screening with refinement ("now exclude under $10", "only tech", "sort by 3-month"), results flow into watchlists/charts; saved-screen and standing-alert management; IC-1 indicator conditions where the owner permits | SC-1/SC-2, `scanIntent.js` (28/31 in-sample), screener routes, F-16 isolation | ~2,500 | P1, W0 (SCAN on) |
| **P4 Research & News** | "why is NVDA down", "compare AMD vs NVDA guidance", headline follow-ups; facts/interpretation/unknowns separated; citations with timestamps | Perplexity `_web_search`, News ask (#692), fundamentals/earnings/news kinds | ~2,500 | P2 |
| **P6 Whole-site Operator** | the Agent on every page: screener, journal (notes; trades read-only), breadth, calendar, morning wire, model book, setup library, portfolio heat, terminal bridge; guide on each page | app-level provider, page adapters, 89 terminal function codes | ~3,000 | W0 (independent of P1–P4) |
| **P5 Personal Assistant & Coach** | remembered preferences (indicators, timeframes, lists, risk rules) with consent; setup review; position-size math; journal-based trade review; repeatable workflows ("my morning routine") | preference store (new), journal routes, P1/P3 | ~3,000 | P1, P3, P6 |
| **P7 Multimodal** | screenshot → "what indicator is this / recreate this layout / analyze this setup"; import indicator definitions from images via the Indicators image door | Sonnet 5.5 vision, `getSnapshotBlob`, Indicators image import | ~1,500 | P1, P2 |
| **P8 Member rollout** | paid members get the Agent with per-member caps, licensing wording, disclosure, cost model | budgets, `require_paid`, Massive display-only class | ~1,000 + ops | all gates green on a real-member cohort |

Not in scope of any package (keep the owner's rulings): proprietary UCT ratings/scores never reach the model (F-16), flow-worker untouched, no new market-data pipeline, Indicators engine not duplicated, #516 on hold.

## 3. Per-package specification (summary; Deliverable 5 has P1 in full)

### W0 Foundation
- Scope: tool-use loop in `run_turn` (App. 3 §3), deferred-tool catalog from the manifest, per-step sanitize/approval, streaming on; retire routing cap and NL-1; eval runner wired to the 57-case benchmark + sealed sets + #662's 150-turn list; nightly `claude -p` run writing `docs/agent/program/EVAL.md`; `agent-ci.yml` on push to `agent/**` running the Agent suites; gate reduced to a 3-minute contract smoke.
- Acceptance: ≥ 80 % correct-executed-or-clarified on the 57-case benchmark; 0 confidently-wrong on held-out quote sets; p50 single-step latency ≤ 4 s; cost ≤ $0.03/single-step turn.
- Risks: model behavior change on existing rails (expect ~50 wording pins to move); tool-search misses (mitigate with the 12 always-loaded domain tools).

### P2 Market Analyst
- Scope: wire fundamentals, earnings, news.company, themes to capabilities; add index/commodity/crypto kinds (dedicated kinds, never ticker guesses); dated close and ranges on bars.daily; comparisons; event-study capability (value-free to model, full table to member); freshness wording per MD-1.
- Acceptance prompts: "what's NVDA at", "AAPL close last Friday", "oil price" (dedicated kind or honest decline), "compare AMD and NVDA's last two quarters", "how has NVDA behaved after earnings gaps of 5 %+", "what changed in TSLA's fundamentals this year".
- Risks: Massive display-only license wording; vendor cost per kind (budgeted per turn by the gateway).

### P3 Scanner & Workflows
- Scope: `scanIntent.js` behind `spec.validate` with a held-out zero-false-resolve bar; refinement as conversation state (`lastScreen` persisted server-side per conversation); results → watchlist/charts composition (exists) exercised by the loop; standing alerts; saved-screen management; IC-1 conditions if authorized.
- Acceptance: the owner's chain (strong stocks → volume filter → drop under $10 → top five → watchlist → open charts → indicators → save layout) completes with one approval card.
- Risks: F-16 refusals must offer public alternatives; scan-per-turn cap (1) must rise to the loop's needs under budget.

### P4 Research & News
- Scope: RS-1 service: compose gateway kinds + web search + headline context; envelope with `facts[]`, `interpretation[]`, `unknown[]`, `sources[]` (url, timestamp); never a price or metric the gateway did not return; News ask flag on.
- Acceptance: "why is NVDA down today", "what's driving semis", "catalysts next week for X", "is this move sector-wide" with citations and a dated freshness line.
- Risks: Perplexity disclosure (ROADMAP Stage 7); hallucinated numbers (hard rule: numbers come only from envelopes).

### P6 Whole-site Operator
- Scope: `AgentProvider`, page adapters, `surfaces` on capabilities, guide targets per page, terminal bridge (`terminal.run` for the deterministic grammar), journal notes writer, read capabilities for the other pages.
- Acceptance: on `/screener`, `/journal`, `/breadth`, `/calendar`: open the panel, ask a page-relevant question and perform one page-native write (where a writer exists).
- Risks: touching Charts/Journal/Terminal ownership; mobile host deferred.

### P5 Coach, P7 Multimodal, P8 Rollout — specified after Wave 2 (depend on measured behavior of W0–P4).

## 4. Scenarios

Assumptions: one GitHub account; builders are Claude Code sessions on this machine (and optionally cloud sessions); the owner reviews a decision packet twice a week; standing eval budget authorized.

| | Aggressive | Conservative |
|---|---|---|
| Builders in parallel | 3 builders + 1 integrator + eval runner | 2 builders + 1 integrator |
| Wave 1 (W0 + P1 + P2 start) | 2 weeks → multi-step execution live for admin | 4 weeks |
| Wave 2 (P2 done, P3, P4, P6) | +3 weeks (week 5) | +5 weeks (week 9) |
| Wave 3 (P5, P7) | +3 weeks (week 8) | +4 weeks (week 13) |
| Wave 4 (P8 member rollout) | week 9–10, after a 2-week admin soak | week 15–16 |
| Risk profile | more integration conflicts; needs CI on `agent/int` from day 1 and a strict integrator | slower, fewer conflicts; the eval loop still mandatory |

What these dates rest on: measured throughput of ~21 agent commits/day and 130 PRs in 24 days shows the sessions can produce far more code than the product absorbed. The constraint was never typing speed. If the five immediate changes in Deliverable 1 §5 are not made, neither scenario holds and the program continues at its current pace (one dark RC every ~10 days).

What could make even the conservative case slip: an owner decision backlog (budget, flags, model, CI change, ownership walls) left unanswered for more than a few days; a planner upgrade that fails its eval and needs a second design round (budget one extra week); machine contention (199 worktrees, shared node_modules) — prune to the active set before Wave 1.

## 5. Performance and cost targets (Part 7)

| Metric | Today (measured/est.) | Target after W0 | Target at rollout |
|---|---|---|---|
| Fast-path share of turns | unmeasured (fast path claims 41 % of ideal-fast held-out) | ≥ 35 % of admin turns at 0 model calls | ≥ 40 % |
| Single-step turn p50 / p95 | "8–10 s observed" (attributed to research), model time unmeasured | ≤ 4 s / ≤ 8 s | same |
| Multi-step (≤ 5 steps) p50 | n/a | ≤ 12 s with streamed per-step receipts | same |
| Cost per single-step turn | ≈ $0.03 (Haiku 4.5, ~24k tokens, cache unlikely) | ≤ $0.02 (Sonnet 5.5 cached) / ≤ $0.003 (Haiku 5.5 classification) | same |
| Cost per multi-step turn | n/a | ≤ $0.10 | same |
| Daily caps | $5 Agent, $15 shared, 300 req/member | unchanged for admin | per-member $0.50/day default, plan-tiered |
| Model routing | one model | Haiku 5.5: intent class + simple single-action turns; Sonnet 5.5: multi-step, research, analysis; Opus 5.5 (already used by `/converse`) stays for indicator authoring | same |
| Prompt caching | ephemeral blocks on a 4,096-min model, hit rate unmeasured | static catalog + system first, volatile last; `cache_read_input_tokens` reported in telemetry | ≥ 70 % cache read share |
| Research | 1 Perplexity call/turn | ≤ 2 web calls/turn, cached 15 min per query | same |
| Eval cost | $0 (never run) | ~$5–10 per nightly run (150–300 turns) | same |

Rule that does not change: correctness is never traded for a saved model call; a deterministic layer may only act when its precision on the held-out set is 100 % for that phrasing class.

## 6. Release strategy (Part 6.4)

```
builder branch (worktree)  ─PR─►  agent/int (CI: Agent suites + contract smoke + eval smoke on 20 prompts)
                                      │  integrator merges daily; regenerates golden; runs full suites once/day
                                      ▼
                            weekly RC: agent/int → master PR (master gate: contract smoke ≤3 min + existing rails)
                                      │  promote → prod smoke (admin: 10 scripted prompts) → flags ON for admin
                                      ▼
                            rollback = revert PR + flags OFF (both prepared in the RC description)
```
- Other workstreams (Indicators, News) keep their own trains; the integrator holds the Agent RC while another RC is in the gate (`guard-misses-master-gate-runs` rule).
- No direct-to-master commits for the Agent (true since 10-13; keep it).
- The master gate loses the 16-minute Agent vitest step; the Agent suites run on every Agent PR instead, where they belong. This is a change to a repo-wide workflow and needs owner approval.
