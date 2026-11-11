# How the cov branches join the ship-2 lineage for release (plan only; not executed)

> LOCAL / SIMULATED. Written 2026-11-09. Nothing here has been run yet.

## Where things stand
- **The release lineage:** `teach-ship-2` (#989, `a5c429a1f2`) → `ship-3` (`eefd04347b`) → `ship-4` (`7b6a76b57a`) → `ship-5` (`5554da43c4`).
  - It carries master `de373f4b20`, the lifecycle rails (`agentGuideLifecycleRails.test.jsx`) and the notebook-bytes fix.
  - `teach-ship-2b` (`044f82ef65`) is ship-2 plus the desktop-selection stand-down. It is #989's follow-up and is not yet in ship-3.
- **The coverage lineage:** `teach-cov-1` → `cov-2` → `cov-3` → `cov-4` → `cov-4-wl`.
  - It was cut from the OLD ship-5 (`eddf82a426`), before the restack.
  - So it has neither master `25f049554f`/`de373f4b20`, nor the lifecycle rails, nor the byte fix, nor ship-2b.

## Plan
Merge commits only, no rebase, and conflicts resolved by keeping both sides, as the restack was done.

1. **Fold ship-2b into the release lineage first.**
   - Merge `teach-ship-2b` into `teach-ship-3`, then carry it forward: ship-3 → ship-4 → ship-5.
   - Desktop selection then reaches every later slice.
   - Expected conflicts: none (ship-2b touches `guideStore.js` and `GuideOverlay.jsx` only, plus its own test).
2. **Join the coverage lineage at its root.**
   - Merge the new `teach-ship-5` into `teach-cov-1`, then carry it forward: cov-1 → cov-2 → cov-3 → cov-4 → cov-4-wl, each slice merging the one below.
   - Each cov branch then stacks on the release lineage, so its PR diff against the slice below holds only its own commits.
3. **Expected conflicts, and how to resolve each:**

   | File | Why both sides changed it | Resolution |
   |---|---|---|
   | `app/src/agent/useAgent.js` | ship-2's `endForNewRequest()` in `send()`; cov-4-wl's page-walk ask, answer and landing hooks | Keep both. They sit in different places: send's head, the fast path, chooseTarget, and the mount effect. |
   | `app/src/pages/command/shortcutRegistry.js` | ship-2's shortened `why`s (byte fix) | Take ship-2's. The cov lineage never touched the registry after the old ship-2. |
   | `app/src/agent/guide/GuideOverlay.jsx`, `guideStore.js` | ship-2b's `SELECTED_DRAWING`; cov-3's `absent` rule (Version history) | Keep both. Different functions. |
   | `app/src/agent/contract/manifest.golden.json`, `api/.../section_b_requests.json` | master's exec ship-1 changes; the cov lineage's `control` and `watchlistPage` | **Regenerate with their own tools** (`UPDATE_AGENT_GOLDEN=1`, `UPDATE_SAT1_REQUESTS=1`). Never hand-merged. pytest for the golden readers is owed. |
   | `docs/agent/CHARTS_TEACH_STATUS.md`, `app/src/testing/agent/guide/cases.inventory.json` | each cov branch regenerated them | Take the later cov branch's. Regenerate at the end from one fresh runner pass. |
   | `docs/agent/program/PR-teach-*.md` | each branch's own doc | No conflict expected; each lives on its own branch. |

4. **After each merge:** targeted vitest (guide, lifecycle rails, release rails, goldens) at BelowNormal.
5. **After the last merge (cov-4-wl):**
   - one locked full suite on `cov-4-wl`, with `src/pages/command` and pl-exec's 9 paths;
   - one notebook-bytes measurement against master (the delta must stay ≤ 0);
   - one fresh full runner pass and a regenerated status.
6. **Report:** every new head, with its suite line and byte delta.

## Why this order
- ship-2b goes in first so desktop selection reaches every slice above #989.
- Joining at cov-1 rather than at cov-4-wl keeps each cov PR reviewable on its own.
- Merges rather than rebases keep the AUDIT-reviewed commit ids unchanged.
