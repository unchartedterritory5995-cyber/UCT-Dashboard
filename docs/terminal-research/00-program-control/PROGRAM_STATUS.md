# PROGRAM STATUS

**Program day:** 1 (Day 1a in progress — orientation + internal discovery; Day 1b external research awaits the owner's proceed instruction)
**Stage:** Phase Zero — research and planning. No implementation.
**Last updated:** 2026-09-02 08:00 UTC (session 1)
**Deadline health:** GREEN — Step Zero, program control, capability probe, coverage map, and Wave 1 dispatch completed within the first session; no blockers.

## Checkpoint (Document A format)

### Progress
Step Zero verified (worktree, branch, start SHA `9c3df14b9`, charter byte-identical). Program-control layer created (14 control files, contracts, evidence-index script). Capability probe run (10 concurrent tasks measured; four model classes; web/browser/shell tools confirmed). Coverage map of ~105 roles in 8 groups built and converted into waves. Protection rail R0 PASS on all three checks with baselines recorded. Wave 1 COMPLETE: all 17 internal and licensing reports returned and accepted (one with gaps). Orchestrator-only reads of Railway variables (names + flag values) and two admin health endpoints recorded. Internal synthesis dispatched: E-02 data-use classifier, F-03a system map + capability ledger + tech debt, F-03b provider ledger. Orientation memo delivered; awaiting the owner's proceed instruction for external research.

### Important discoveries
* The ecosystem is larger than the seed facts state: the PC runs ~36 UCT scheduled tasks (seed facts list ~10); the dashboard references at least 17 external providers by env name (Finnhub, FRED, Alpha Vantage, TheFly, Perplexity, OpenAI, twitterapi.io, Reddit beyond the seeded FMP/Massive/Finviz/Schwab/yfinance/Anthropic).
* The dashboard already has a customizable widget workspace (`/charts`, react-grid-layout) and four charting libraries; the workspace question (Part XXI) has real code to evaluate.
* The Discord bot repository is not under git.
* An unauthenticated GET of `/api/calendar/week` returns the SPA shell — the API shape needs mapping before any coexistence assumption.
* Production `/calendar` under the owner's saved filters shows "0 reporting · 145 hidden": the surface is heavily personalized; smoke assertions must not depend on roster content.

### Decisions forming
Seven of nine Tier-1 critical-path questions moved to 🟡 on Wave 1 evidence. D-001 (desk first) proceeds provisionally. D-002 raised: licensing exposure of member-facing vendor data (Massive tier, FMP DDLA); proceeding on desk-first with member-facing raw vendor displays classified Restricted-pending-contract. Emerging direction (not yet a decision): Terminal-Next as a route inside the existing shell reusing the `/charts` panel layer, the entitlement seat in `entitlements.py`, and the existing AI platform; the moat is decision provenance and first-party narrative rather than data volume.

### Critical unknowns
CP-01..CP-08, CP-10 (Tier 1) — see `CRITICAL_PATH.md`. Licensing (CP-03) is owner-input-bound.

### Blockers
None for internal work. External research awaits approval. Owner inputs batch 1 now OI-01..OI-16 (OI-03 sharpened; OI-12 paywall model; OI-13 branch protection; OI-14 catalyst model; OI-15 #tsdr consent; OI-16 where the bot runs); defaults in force.

### Findings for a normal operations session (outside program scope)
* Four PC-scheduled jobs failing silently: flow-corpus archive empty since 2026-08-09; breadth-live monitor 'could not check' 52 runs since 2026-08-10 (D-14).
* Catalyst cost guard mis-prices Sonnet 5 (D-12); five clause-vs-code licensing collisions (E-04); local-backend recipes run against live `C:\data` (D-04); several real-time endpoints reported unauthenticated (E-03, verification pending).

### Agent allocation
Wave 1: 17 internal/licensing tasks. Next: on approval, Wave 1b external landscape (28 tasks in three batches).

### Protection rail
PASS (R0, Day 1a) — see `protection-rail.md`.

### Deadline health
GREEN.

## Next actions
1. As batch-1 tasks return: QC each (ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD), log in `AGENT_REGISTRY.md` §5, dispatch batch 2.
2. Deliver the orientation memo (`13-executive-synthesis/orientation-memo.md`) and stop the turn.
3. On the owner's proceed instruction: dispatch Wave 1b; start F-03a/F-03b internal synthesis as Wave 1 files land; first owner-input batch already filed.
