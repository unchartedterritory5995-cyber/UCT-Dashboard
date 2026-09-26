## Master red sweep — 84 of master's failing tests fixed at the cause, test-only

**Branch:** `fix/master-red-sweep` (cut from master `451aed688`). Merges clean, no rebase (zero file overlap with master's later commits).

### What this is
Master carried 84 failing vitest cases (the set that was NEW on the pine merge, PR #184, and confirmed red on pinned master `877dd173c`). Every one was a **test or harness artifact** — mocks that stubbed half a module's contract, a renamed door, a deletion a commit message claimed but never made, undeclared routes, a harness using raw `fetch` where the rail demands `jsonFetcher`, and two first-paint suites that read the wall clock and only pass inside market hours. Each fix carries its reason in the file and was mutation-proved (revert the layer → red → restore from captured bytes, sha256 verified).

**Product files touched (four, all deliberate, all explained in their commits):** `FilterBand.jsx` + `FilterBand.module.css` deleted (completing #178's stated deletion), one dead prop removed from `FilterRail.jsx`, two route rows declared in `surfaces/manifest.js`. Everything else is tests, `app/src/testing/`, and docs.

### Evidence
- **Gate B** (`docs/plans/joystick/gate-runs/2026-09-24T18-04-13.*`): VALID, 1,722 files reconcile, **0 of the 84 targeted cases still red**.
- Second wave (three lanes, test-only) classified every remaining red on the branch; **gate C** (`…/2026-09-24T18-59-50.*`): VALID, 24 red cases in 17 files, **0 NEW vs gate B, 16 more fixed**.
- The 24 still red are classified, not hidden: 17 need the licence-withheld `pine_oos` corpus (every count reconciles exactly to the absent files), 4 are one member-facing product bug reported separately (`pine.js:8048` fractional window), 1 is a product-contract question (BuilderSheet document identity, left red on purpose), 1 is `rule12Paths` firing on this branch's shape (green on master), 1 is `pollingSites.rail` awaiting per-site rulings.
- The master deploy gate's own steps (secret scan, scoped pytest rails, hygiene) run green locally on this branch.

### New test infrastructure
- `app/src/testing/pinnedWallClock.js` (+ its own rail): pins the wall clock for a render harness by SHIFTING it (a frozen clock hangs the polling harness); used by the two daily first-paint suites, each with a by-name rail that the pin is load-bearing and a new after-the-bell case asserting the product's deferral.

### Record
`docs/resume/RESUME-2026-09-24-pine-and-red-sweep.md` §3–§4 carries every commit, measurement and open ruling.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Dsh5JPAt3Wd8QBMocDRB1
