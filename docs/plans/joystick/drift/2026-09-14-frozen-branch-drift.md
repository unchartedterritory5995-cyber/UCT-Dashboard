# W1 · Frozen-branch drift audit — `launch/stage-2-member-preview` vs master

**Method: read-only.** Nothing was checked out, rebased, merged, stashed, or created to
produce this. `git show` / `git diff` / `git merge-base` / `git log` / `git merge-tree
--write-tree` (in-memory, mutates nothing) only. The frozen branch was not modified.

## Control block

| | |
|---|---|
| master, resolved at audit time | `7707b224194161e24dd40b5a8da2d54df29012ac` (`7707b2241`) |
| master committed | 2026-09-14 16:30:05 -0500 |
| frozen branch | `2ae7e98aa11b5f859a26b9bd4830b850ad22662c` (`2ae7e98aa`) |
| frozen committed | 2026-09-13 17:31:55 -0500 |
| merge-base | `4fb4f9daf914d63c1720386700bc3c4e56599ef3` (`4fb4f9daf`) |
| merge-base committed | 2026-09-13 17:27:26 -0500 |
| **master advance since base** | **352 commits** |
| frozen ahead of base | 3 commits |

Base one-line: `4fb4f9daf LAYER 0: the 502 rule made mechanical — tools/pre_push_guard.py + pre-push hook`

⭐ **The merge-base is the master commit that was merged INTO the branch**, confirmed from the
merge commit's own parents:

```
2ae7e98aa  (merge commit)
├─ 640dcd8d1   fix(joystick): the stage-2 exposure rails — and two defects the stage change exposed
└─ 4fb4f9daf   master at 2026-09-13 17:27
```

The branch's three commits are `e60545210` (stage 2 — ladder renumbered, preview emptied) →
`640dcd8d1` (rails + two defects) → `2ae7e98aa` (merge of master).

⚠️ **352 commits in ~23 hours is the drift surface, and it is large.** It is also almost
entirely irrelevant to this branch, which is the finding — see below.

## The 26 paths

`git diff --name-status 4fb4f9daf..2ae7e98aa` → 26 files (4 added, 22 modified). Master-side
status is `git diff --name-status 4fb4f9daf..7707b2241 -- <path>`.

| # | path | branch | master side | class |
|---|---|---|---|---|
| 1 | `CLAUDE.md` | M | **M (+166/-5)** | **MOVED** |
| 2 | `app/package.json` | M | untouched | CLEAN |
| 3 | `app/scripts/run-hub-rails.mjs` | A | untouched | CLEAN |
| 4 | `app/src/hub/HubRoot.test.jsx` | M | untouched | CLEAN |
| 5 | `app/src/hub/exposureGate.test.js` | M | untouched | CLEAN |
| 6 | `app/src/hub/fanResolutionParity.test.js` | M | untouched | CLEAN |
| 7 | `app/src/hub/homeFanCalendar.test.jsx` | M | untouched | CLEAN |
| 8 | `app/src/hub/hubGlobCoverage.test.js` | A | untouched | CLEAN |
| 9 | `app/src/hub/hubWiring.test.jsx` | M | untouched | CLEAN |
| 10 | `app/src/hub/registry.js` | M | untouched | CLEAN |
| 11 | `app/src/hub/rolloutStage.js` | M | untouched | CLEAN |
| 12 | `app/src/hub/rolloutStages.test.js` | M | untouched | CLEAN |
| 13 | `app/src/hub/runActionsHaveHandlers.test.js` | M | untouched | CLEAN |
| 14 | `app/src/hub/sections/catalystsSection.test.jsx` | M | untouched | CLEAN |
| 15 | `app/src/hub/stageLadderAgreement.test.js` | A | untouched | CLEAN |
| 16 | `app/src/hub/symbolContext.test.jsx` | M | untouched | CLEAN |
| 17 | `app/src/hub/useHubSettings.js` | M | untouched | CLEAN |
| 18 | `app/src/hub/useHubSettings.test.jsx` | M | untouched | CLEAN |
| 19 | `app/src/pages/settings/JoystickSettingsCard.jsx` | M | untouched | CLEAN |
| 20 | `app/src/pages/settings/JoystickSettingsCard.test.jsx` | M | untouched | CLEAN |
| 21 | `app/src/pages/settings/joystickSettingsControls.test.jsx` | M | untouched | CLEAN |
| 22 | `app/vitest.hubGlob.js` | A | untouched | CLEAN |
| 23 | `docs/plans/joystick/closure.md` | M | untouched | CLEAN |
| 24 | `docs/plans/joystick/glass-acceptance-steps.md` | M | untouched | CLEAN |
| 25 | `docs/plans/joystick/rollout.md` | M | **M (+8/-5)** | **MOVED** |
| 26 | `docs/plans/joystick/surface-matrix.md` | M | untouched | CLEAN |

**24 CLEAN · 2 MOVED · 0 CONFLICT.**

⭐ **Every one of the 21 `app/**` code and test files is untouched by master.** Across 352
commits, master did not go near this branch's code at all.

## Authoritative merge verdict

`git merge-tree --write-tree 7707b2241 2ae7e98aa` → **exit 0**, result tree
`aa9fbff5b9599eec3dbb952d1603b6d302034e34`. **No conflicts.** This is an in-memory
three-way merge; it computed the real answer without touching the working tree.

### MOVED path 1 — `docs/plans/joystick/rollout.md`

Both sides edited this file. They do not overlap.

**Branch side** (`@@ -18`, `@@ -37`, `@@ -58`, `@@ -69`) — the stage-2 status language and the
resolved-(a)/(b) block:

```
-> launch sequence is authorized; the rollout is at **stage 1**; and LAUNCHED is defined by the six
+> launch sequence is authorized; the rollout is at **stage 2 on this branch, stage 1 on master until
+> Patrick merges it**; and LAUNCHED is defined by the six
...
-### 2. ⛔⛔ TWO THINGS THIS RULING COLLIDES WITH IN THE CODE. READ BEFORE ESTIMATING STAGE 2.
+### 2. ⛔⛔ TWO THINGS THIS RULING COLLIDED WITH IN THE CODE — ✅ BOTH RESOLVED 2026-09-13
```

**Master side** (`@@ -51`, `@@ -107`, `@@ -109`, `@@ -112`) — the gate-citation correction:

```
-| **2** *(built, **GATED**, unmerged — `640dcd8d1`)* | **`true` for every authenticated user** | preview | **Member preview** |
+| **2** *(built, **GATED**, unmerged — `2ae7e98aa`)* | **`true` for every authenticated user** | preview | **Member preview** |
...
-> `gate-runs/2026-09-13T15-55-29.md`; tree hash identical at both ends, **1318 files reconciling**,
-> **8 failed / 19,439 passed / 19,456**.
+> `gate-runs/2026-09-13T17-57-36.md`; tree hash identical at both ends, **1325 files reconciling**,
+> **8 failed / 19,489 passed / 19,506**.
```

⛔ **Master's edit lands INSIDE the stage table that `stageLadderAgreement.test.js` parses at
runtime.** That is the one place drift could have bitten. It did not — proved below, not assumed.

**Merged content carries both sides** (read out of tree `aa9fbff5b`):

| probe | count |
|---|---|
| master's corrected gate SHA `2ae7e98aa` | 2 |
| master's corrected manifest `17-57-36` | 1 |
| master's corrected totals `19,506` | 1 |
| branch's `stage 2 on this branch` language | 1 |
| branch's `BOTH RESOLVED 2026-09-13` block | 1 |
| stale `1318 files` figure | **0** |

### MOVED path 2 — `CLAUDE.md`

Master +166/-5, including this session's own second-sighting entry. Merged content carries both:
master's `SECOND SIGHTING` block (1) and the branch's `A SCOPED RUN IS NOT A GATE` section (1).

## Coupled-set verdict: **INTACT**

The five that move together or not at all — `ROLLOUT_STAGE`, `STAGE_NAMES`, the `unsetDefault`
threshold, the ladder `STAGE_TABLE` row, and that row's `ROW_DIGESTS` entry — live in two files.
Both are **byte-identical between the merge base and master**, so master has not touched any of
them. Proved by blob identity, not by name-status:

```
IDENTICAL  app/src/hub/rolloutStage.js
IDENTICAL  app/src/hub/exposureGate.test.js
IDENTICAL  app/src/hub/registry.js
IDENTICAL  app/src/hub/useHubSettings.js
IDENTICAL  app/src/pages/settings/JoystickSettingsCard.jsx
```

For the record, the values the branch carries and master does not (from
`git diff origin/master launch/stage-2-member-preview -- app/src/hub/rolloutStage.js`):
`ROLLOUT_STAGE` `1`→`2`; `STAGE_NAMES` `admin only / settings card visible, default OFF (opt-in) /
unset resolves ON` → `admin preview / member preview / general availability`; `unsetDefault`
`return stage >= 3` → `return stage >= 2`. `cardVisible` is `stage >= 2` on **both** sides —
unchanged, as designed.

## Rails verdict: **INTACT**

**`stageLadderAgreement.test.js`** — parses `rollout.md` at runtime
(`readFileSync(REPO/docs/plans/joystick/rollout.md)`, regex at `:59`). Master edited a row of
that very table. The exact regex was run against the merged content, with a control:

```
MERGED (master+branch): rungs=[1,2,3] names={"1":"Admin preview","2":"Member preview","3":"General availability"}
BRANCH only:            rungs=[1,2,3] names={"1":"Admin preview","2":"Member preview","3":"General availability"}
CONTROL (rung 2 row corrupted): rungs=[1,3]   <- proves the parser can return the other answer
```

Identical on both. Master's SHA swap sits inside a `[^|\n]*` cell and does not disturb the row
shape.

**`hubGlobCoverage.test.js`** — derives every test importing `hub/rolloutStage` and fails if one
falls outside the subset. In the merged tree that derivation yields **5** files, all covered:

```
app/src/hub/exposureGate.test.js                          <- src/hub/**/*.test.{js,jsx}
app/src/hub/rolloutStages.test.js                         <- src/hub/**/*.test.{js,jsx}
app/src/hub/stageLadderAgreement.test.js                  <- src/hub/**/*.test.{js,jsx}
app/src/pages/settings/JoystickSettingsCard.test.jsx      <- explicitly listed
app/src/pages/settings/joystickSettingsControls.test.jsx  <- explicitly listed
```

**Master added no new `rolloutStage` importer.**

⚠️ **Instrument correction, recorded because it nearly produced a false CLEAN.** The first
derivation this audit ran used `^\s*import\s…\brolloutStage` and returned only the 2 settings
files, silently missing all 3 inside `src/hub`. A coverage check that misses the files most
likely to break reports a property of itself. Caught by a control that asserted the three known
`src/hub` importers must appear; the looser matcher (`from\s+['"][^'"]*rolloutStage`) finds all 5.

**`app/vitest.hubGlob.js`** — every declared target still resolves in the merged tree:
`JoystickSettingsCard.test.jsx` ✅ · `joystickSettingsControls.test.jsx` ✅ ·
`joystickTraceControls.test.jsx` ✅ · `styles/themeIslands.test.js` ✅ · `styles/tapFloor.test.js` ✅.
`src/hub/**/*.test.{js,jsx}` resolves to **84** files; with the 5 explicit entries that is the
documented **89**, comfortably above `run-hub-rails.mjs`'s `MIN_FILES = 60` floor (`:29`). No
glob matches nothing.

## Bottom line

> ### **DRIFT-FREE.**
>
> Does gate `2026-09-13T17-57-36` still describe the merge result? **Yes, for the code it
> measured.** Master advanced 352 commits and touched **zero** of this branch's 21 `app/**`
> files; the coupled set is byte-identical to the merge base; the merge is conflict-free by
> in-memory three-way merge; and all three new rails still resolve and still parse against the
> merged content, each verified with a control.

### Two qualifications, stated rather than folded in

1. ⚠️ **"DRIFT-FREE" is a statement about THIS branch's 26 paths, not about the suite.** Master
   moved 352 commits elsewhere in `app/src`, and the gate's verdict is *relative to a baseline*.
   Whether the **baseline of 7** still holds on today's master is a different question and is not
   answered here — it is W4's. If the baseline has moved, the `NEW = 1` arithmetic changes even
   though nothing about this branch did.
2. ⚠️ **Two doc statements become false at the moment of merge**, in the merged text: the stage
   table's `*(built, **GATED**, unmerged — 2ae7e98aa)*` and the branch's `stage 2 on this branch,
   stage 1 on master until Patrick merges it`. Both are correct today. Neither is drift and
   neither blocks; they are a post-merge docs follow-up, noted so the first post-merge commit can
   carry them alongside the R-29 baseline entry.
