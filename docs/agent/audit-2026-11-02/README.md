# UCT Agent — independent audit and accelerated development plan (2026-11-02)

Independent, read-only audit of UCT Agent against `origin/master` `cfc35a3b3f`, with a plan to deliver the full assistant vision substantially faster. No production code, flags, deployments or services were changed; no paid model or market-data calls were made.

| # | Document | What it answers |
|---|---|---|
| 1 | [Executive diagnosis](01-EXECUTIVE-DIAGNOSIS.md) | what is built, why it felt slow, the real bottlenecks, is the architecture sound, what to change now |
| 2 | [Verified capability inventory](02-CAPABILITY-INVENTORY.md) | every capability and every unexposed website function, classified A–E with evidence |
| 3 | [Architecture assessment](03-ARCHITECTURE-ASSESSMENT.md) | preserve / extend / simplify / replace, with the planner and host designs |
| 4 | [Accelerated master plan](04-MASTER-PLAN.md) | packages, dependencies, scenarios, cost and performance targets, release train |
| 5 | [First development wave](05-WAVE-1.md) | the exact first package, acceptance prompts, definition of done, decisions needed |
| 6 | [Multi-agent execution plan](06-MULTI-AGENT-EXECUTION.md) | how to organize Claude Code sessions, worktrees, persistence and cost |
| 7 | [Scorecard and evaluation framework](07-SCORECARD-AND-EVAL.md) | baseline, outcome classes, categories, nightly mechanics, expected gains per package |
| 8 | [Decision memo](08-DECISION-MEMO.md) | the recommendation, stop/continue, build first, owner decisions |

Appendices (raw audit evidence with `file:line` citations and the commands used):

- [A — Capability registry inventory](appendix/A-capabilities.md)
- [B — Natural-language pipeline trace and evaluation status](appendix/B-nl-pipeline.md)
- [C — Website coverage matrix (94 rows)](appendix/C-coverage-matrix.md)
- [D — Development-process measurements](appendix/D-process.md)
- [E — Security, cost and model audit](appendix/E-security-cost.md)
- [F — Indicators, News, research, roadmap state](appendix/F-integrations-roadmap.md)
- [G — Claude Code orchestration features (from official docs)](appendix/G-orchestration.md)

Unverified in this audit (access denied or out of scope): production values of the `UCT_AGENT_*` flags and model id (Railway read denied); whether `#692`'s pending QA verdict ran; real latency, cache hit rate and cost (no paid calls); which members hold Create/Manage Indicator entitlements; nothing was executed in a browser.
