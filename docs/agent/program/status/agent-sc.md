# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## Released (master / production c3ba71c343, Sprint 1, every Agent flag OFF)
- **#570** `screen.run` + `screen.count`: SC-1 v1.1 §2a, the `Kind.validate` precheck, and the F-4 zero-match fix.
- **#578** `screen.saved` + `saved_id` / `text` sources (SC-1 §2b).
- **#580** (agent-lead) ADR-002 with agent-sc's inventory of legacy-screener callers.
- **#582** discovery eval corpus (31 questions) + `screen.saved` coverage counts every screen.
- **#584** the screener capability answers through the gateway (dark), keyed by `trace.currentTurnId()`, with panelHarness acceptance (F-7 fixed).
- **#592** SC-1 v1.3 §2c, relative volume (docs); MD-1 §4.3 (#591) points to it.
- **#593** SAT-1 kit + run-1 results (owner accepted A/C/D/E as PASS on 8f9e65eda0; B NOT TESTED).
- **#601** F-SAT-3: a screener message typed before the catalog loads waits for it (≤ 3 s) and never falls to the model.

## In flight (Sprint 2, flags-off preparation; order A → B → C, agent-lead approved)
- **A: SAT-1 section B as one command** (branch `agent/sc/sat1-b-runner`, this PR).
  `python -m api.services.uct_agent.scan.sat.section_b` is a DRY RUN by default: it prices the exact requests and sends
  nothing (no key, no data dir, no database opened). `--run --i-have-owner-approval --data-dir <sandbox>` replays the
  real panel's captured requests through `turn.run_turn` with `budget.Meter`: Agent $5 ledger counted, shared $15
  ledger checked (read-only, owner Gate A option 1), 2-call ceiling, and a per-run `--max-usd` (default $1.00).
  Raw records go to `raw.jsonl` before the summary. Requests are captured by `agentScanSat1Requests.test.jsx` (no model).
  Dry run on c3ba71c343: 31 questions to the planner, 14 may reroute, exact worst case $3.0147, estimate ≈ $0.41.
  **Still blocked for `--run`** until agent-lead relays the owner's credential approval.
- **#621 kinds gate in the screener capability** (branch `agent/sc/scan-kinds-gate`, small PR): the gateway path now also needs `config.data_kinds` to list `screen.run` (screens) / `screen.saved` (the saved list). Unlisted, or an older server with no list: the Screener route, exactly as with the flags off, never a refused gateway read. Panel tests: 4 new, mutation-checked.
- **B: SC-2 draft** (NL scanning: parsed-intent layer + ≥ 60-phrasing corpus with follow-up chains). Next.
- **C: model-call reduction** (a deterministic slot parser behind the flags, measured on both corpora). After B.

## Findings (no paid call needed)
- **F-SB-1 (routing, agent-lead's `routing.js`):** 14 of 31 discovery questions are routed WITHOUT the screener group
  (e.g. "RSI over 70" → indicators; "unusual volume in semis" → charts; "small caps … short float" → data). The planner
  cannot screen on its first call for those; it must spend the request's second call on a `need_groups` reroute.
  Reported to agent-lead; the runner measures it rather than assumes it.

## Scope rulings
- Indicator conditions are refused until their own milestone (IC-1 / ADR-004 → SC-1 v1.2, unscheduled).
- `/api/screener/compile` is not used. The direct-parser baseline (0/26 answerable) is not a reason to enable it (owner).
- Relative volume: the screener is canonical (agent-lead ruling with agent-md). `volume.surge` is dropped and `volume_live` is not exposed.
- SC-1's 50-row cap stays; `produce` and measure screens use the Screener's route.

## Blockers
- SAT-1 section B `--run`: an owner-approved development credential (agent-lead is raising it). None will be obtained or reused.

## Handoffs (to / from)
- agent-qa: corpus scorer (theirs). A recorded section-B run is scorable offline from `raw.jsonl` (`candidate.logic`).
- agent-lead: F-SB-1 (routing); the fast-path hook for C will be a written request, never an edit.

## Ready for integration
- `agent/sc/sat1-b-runner` (A).
