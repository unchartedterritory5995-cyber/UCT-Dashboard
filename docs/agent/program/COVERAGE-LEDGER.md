# Charts Agent coverage ledger

Development coverage, kept apart from what members can do today. Regenerate with `node src/testing/agent/autotest/ledger.mjs` (from `app/`); the command and inputs are below.

- **D (development):** agent/pl/r8-multistep 805073d32e (contains ship-5 ef35f8e26e); walkthroughs from agent/pl/teach-ship-5-runner eddf82a426's teach document
- **P (production tree):** origin/master 6c7d0dc157 (2026-11-09), with only the autotest harness files added
- **R (real model, real production browser):** not measured. It needs a bounded paid run that the owner and AUDIT agree to.

**Method.** Scripted model (BROWSER-MOCK-MODEL) in a local headless browser on the agent harness with fixture data, plus the `src/agent` vitest suite of the same tree, counted by `recount.mjs`. An execution row counts when every test its inventory evidence cites passed, or when every browser request naming the row passed (one failure takes it out). Refusals, how-to and unsupported requests never count as execution. Walkthrough rows are the VERIFIED rows of that tree's own `CHARTS_TEACH_STATUS.md`: the recount cannot re-prove a walkthrough. A request names every row of its family, so browser counts are an upper bound.

| Family (area) | In scope | Exec D | Exec P | P0 rows | P0 D | P0 P | Walkthrough D | Walkthrough P | R |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Symbol | 5 | 3 | 3 | 3 | 3 | 3 | 2 | 4 | not measured |
| Timeframe | 6 | 3 | 3 | 2 | 1 | 1 | 5 | 5 | not measured |
| Chart type | 5 | 1 | 1 | 1 | 1 | 1 | 1 | 3 | not measured |
| Session | 2 | 2 | 2 | 1 | 1 | 1 | 2 | 2 | not measured |
| Scale | 5 | 1 | 1 | 1 | 0 | 0 | 3 | 4 | not measured |
| View | 3 | 2 | 2 | 3 | 2 | 2 | 3 | 3 | not measured |
| Go to date | 4 | 2 | 2 | 0 | 0 | 0 | 1 | 3 | not measured |
| Compare | 8 | 1 | 1 | 1 | 1 | 1 | 2 | 6 | not measured |
| Replay | 9 | 4 | 4 | 2 | 2 | 2 | 4 | 6 | not measured |
| Settings | 32 | 5 | 5 | 0 | 0 | 0 | 24 | 23 | not measured |
| Themes | 12 | 1 | 1 | 2 | 0 | 0 | 8 | 8 | not measured |
| Templates | 7 | 7 | 7 | 1 | 1 | 1 | 3 | 3 | not measured |
| Volume | 6 | 2 | 2 | 0 | 0 | 0 | 5 | 5 | not measured |
| Panes | 5 | 2 | 2 | 0 | 0 | 0 | 2 | 4 | not measured |
| Legend | 16 | 6 | 6 | 2 | 2 | 2 | 11 | 12 | not measured |
| Measure | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 3 | not measured |
| Share | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 1 | not measured |
| Alerts | 27 | 17 | 17 | 8 | 7 | 7 | 15 | 19 | not measured |
| Right-click | 6 | 1 | 1 | 0 | 0 | 0 | 2 | 2 | not measured |
| Settings door | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Drawing | 38 | 27 | 27 | 7 | 6 | 6 | 17 | 25 | not measured |
| Boards | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | not measured |
| Keyboard | 5 | 2 | 2 | 1 | 1 | 1 | 0 | 2 | not measured |
| Picker | 3 | 1 | 1 | 0 | 0 | 0 | 3 | 2 | not measured |
| Add | 10 | 3 | 3 | 3 | 3 | 3 | 5 | 6 | not measured |
| Remove | 4 | 3 | 3 | 2 | 2 | 2 | 2 | 3 | not measured |
| Visibility | 4 | 4 | 4 | 2 | 2 | 2 | 3 | 4 | not measured |
| Read | 2 | 1 | 1 | 0 | 0 | 0 | 1 | 2 | not measured |
| Inputs | 6 | 2 | 2 | 2 | 2 | 2 | 1 | 4 | not measured |
| Style | 6 | 3 | 3 | 2 | 2 | 2 | 0 | 5 | not measured |
| Placement | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 2 | not measured |
| Undo | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Copy | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | not measured |
| Create | 9 | 5 | 5 | 2 | 2 | 2 | 2 | 5 | not measured |
| Builder | 12 | 1 | 1 | 0 | 0 | 0 | 0 | 7 | not measured |
| Import | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | not measured |
| Image | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Saved | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | not measured |
| Board | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 5 | not measured |
| Link | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | not measured |
| Float | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Popout | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Widget tabs | 4 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| Chart tabs | 5 | 4 | 4 | 0 | 0 | 0 | 4 | 3 | not measured |
| Layout Dock | 17 | 7 | 7 | 2 | 1 | 1 | 12 | 8 | not measured |
| Multi Chart | 21 | 3 | 3 | 0 | 0 | 0 | 14 | 19 | not measured |
| Watchlist | 40 | 17 | 17 | 10 | 10 | 10 | 12 | 17 | not measured |
| Scanner | 14 | 6 | 6 | 3 | 3 | 3 | 2 | 5 | not measured |
| Volume Surge | 6 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | not measured |
| News | 5 | 1 | 1 | 1 | 1 | 1 | 3 | 3 | not measured |
| TE News | 10 | 0 | 0 | 0 | 0 | 0 | 3 | 2 | not measured |
| Calendar | 9 | 1 | 1 | 2 | 0 | 0 | 2 | 5 | not measured |
| Breadth | 7 | 1 | 1 | 1 | 1 | 1 | 2 | 4 | not measured |
| Options Flow | 5 | 1 | 1 | 0 | 0 | 0 | 2 | 4 | not measured |
| Fundamentals | 3 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | not measured |
| Profile | 2 | 2 | 2 | 0 | 0 | 0 | 1 | 1 | not measured |
| Indexes | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Market Context | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| NH/NL | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 3 | not measured |
| H/L Pulse | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | not measured |
| Market Map | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| AI Search | 5 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Notebook | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | not measured |
| Period Sort | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Company dock | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | not measured |
| Workspace | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| **Total** | 484 | 170 | 170 | 74 | 64 | 64 | 208 | 281 | not measured |

Inputs: D = `D`; P = `P`.

**Notes.**

- Sets run on each tree: public (246 requests) and selection public (223), BROWSER-MOCK-MODEL, plus vitest src/agent. P: public 244/245 (1 not run in this mode), selection 216/223, vitest 9010 passed / 0 failed / 6 skipped. D: public 243/245, selection 218/223, vitest 9059 passed / 4 failed / 6 skipped (agentAcceptanceP2, agentConversationP2, agentWorkingStatus, agentWorkspaceComposeP3: the multi-step partial-failure wording and a new-layout compose; triaged to pl-exec).
- Grading version: autotest harness ece71ef8ee (with the AUDIT-accepted definitions pre-warm 32d268ce7e; before AUDIT's repaint gaps a and b, which landed after these runs in 75ab84884d / 56b4fb4817). Both columns were graded by the same harness version.
- Walkthrough states differ in vocabulary between the trees: P's teach document has VERIFIED / IMPLEMENTED-UNVERIFIED / MISSING / BLOCKED; teach-ship-5's has VERIFIED / ASSIGNED-NOT-REACHED / NO WALKTHROUGH / ROUTED-BROWSER FAILED / NO ASSIGNED WALKTHROUGH. Only VERIFIED is compared here.
- Execution rows are counted from the same inventory documents in each tree (CHARTS_EXECUTION_STATUS.md, CHARTS_COVERAGE_MATRIX.md); a request names every row of its family, so the browser part is an upper bound.
