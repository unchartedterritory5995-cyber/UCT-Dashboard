# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## Integrated (agent/int)
- **#570** `screen.run` + `screen.count`: SC-1 v1.1 §2a, the `Kind.validate` precheck, and the F-4 zero-match fix.
- **#578** `screen.saved` + `saved_id` / `text` sources (SC-1 §2b).
- **#580** (agent-lead) ADR-002 with agent-sc's inventory of legacy-screener callers.
- **#582** discovery eval corpus (31 questions) + `screen.saved` coverage counts every screen.
- **#584** the screener capability answers through the gateway (dark), keyed by `trace.currentTurnId()`, with panelHarness acceptance (F-7 fixed).
- **#592** SC-1 v1.3 §2c, relative volume (docs); MD-1 §4.3 (#591) points to it.

## In flight
- **#593 SAT-1 kit + run-1 results** (branch `agent/sc/sat1`, agent-lead gating). Owner ACCEPTED A/C/D/E as PASS on 8f9e65eda0; B is NOT TESTED (no approved credential).
- **F-SAT-3 fix** (branch `agent/sc/fastpath-init`, this PR; carries #593, so merge #593 first): a screener message typed before the field catalog or saved list loads takes the fast path and waits for them, bounded at 3 s. A failed load is a local answer, never a model call. After init, behaviour is unchanged. Test: `agentScanInit.test.jsx` (8).
- (from #593) `scan/sat/seed.py` (a synthetic sandbox universe; measured expected answers) + `contracts/SC-1-SAT-1.md` (exact instructions). Also the singular/plural wording in the coverage notes (server and client).
- **SAT-1 section B:** blocked until an explicitly approved development credential exists. None will be obtained or reused.
- **Next: PR 3**, discovery planning per SC-1 §2c (`rvol_live` / `vol_ratio`, canonical; no relative-volume calculator).

## Scope rulings
- Indicator conditions are refused until their own milestone (IC-1 / ADR-004 → SC-1 v1.2, unscheduled).
- `/api/screener/compile` is not used. The direct-parser baseline (0/26 answerable) is not a reason to enable it (owner).
- Relative volume: the screener is canonical (agent-lead ruling with agent-md). `volume.surge` is dropped and `volume_live` is not exposed.
- SC-1's 50-row cap stays; `produce` and measure screens use the Screener's route.

## Blockers
- SAT-1 section B: needs an approved development API credential from the owner.

## Handoffs (to / from)
- agent-qa: corpus scorer (theirs); the no-model fast-path baseline is next.
- agent-md: MD-1 §4.3 (#591) points to SC-1 §2c (#592).

## Ready for integration
- #593 (SAT-1 kit + results).
- `agent/sc/fastpath-init` (F-SAT-3), after #593.
