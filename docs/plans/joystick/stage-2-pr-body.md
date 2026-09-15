# stage 2 — member preview

**MEMBER IMPACT:** The joystick corner control is now on for every member (it was admin-only). Hide it from the corner menu or in Settings → Joystick. Double-tap on Home now opens Morning Wire; tap opens your last section.

⚠️ **One sentence the original ruling did not have, added because it is member-visible:** on the Home fan, **Wire moves to the outer ring and Journal moves to the inner ring**. No bubble is added or removed.

⛔ **Merged by Patrick — member-facing rollout is the owner's decision.**

---

## 1 · The ladder is renumbered, and the retired rung is deleted

`ROLLOUT_STAGE = 2` (`app/src/hub/rolloutStage.js:49`), `unsetDefault` → `stage >= 2` (`:86`).

| stage | unset preference resolves to | framing | name |
|---|---|---|---|
| 1 | `isAdmin` | preview | admin preview |
| **2** | **`true` for every authenticated user** | preview | **member preview** |
| 3 | `true` for every authenticated user | removed | general availability |

⛔ **This was not a one-line change, and the trap is worth stating.** The code's old ladder had stage 2 = *opt-in* (card visible, default still OFF) and stage 3 = *unset resolves ON*. Setting `ROLLOUT_STAGE = 2` against that source would have shipped the **retired opt-in rung** — hub still OFF for every member — under a member-impact paragraph promising the opposite. So `ROLLOUT_STAGE`, `STAGE_NAMES`, `unsetDefault()`, the `STAGE_TABLE` row **and its `ROW_DIGESTS` entry**, plus `rolloutStages.test.js`'s pinned-stage assertion, all move together.

⭐ **`cardVisible` did NOT move, and that looks like an omission until you check.** It is already `isAdmin || everChose || stage >= 2`: under the old ladder stage 2 was where members first needed the card, under the new one it is where they first need the **opt-out**. Different reason, same threshold.

**New rail — `app/src/hub/stageLadderAgreement.test.js`.** The ladder is described in three places (the comment above the constant, `rollout.md`'s table, and the resolver). This **parses all three** and fails if any two disagree on the rung count or a rung's meaning; it also asserts the resolver *behaves* as the words promise, and that `PREVIEW_MODES` is empty at stage ≥ 2. **Mutation-proved four ways**, each restored byte-identical:

| mutation | result |
|---|---|
| rename `STAGE_NAMES[2]` | agreement case red |
| `unsetDefault` back to `>= 3` | 2 behaviour cases red |
| a mode put back into `PREVIEW_MODES` | empty-set case red |
| rename stage 2 in `rollout.md` | agreement case red |

## 2 · `flow` and `home` leave `PREVIEW_MODES` — the set is now empty

**`flow` — measured no-op.** Its declared fan already *is* `[Voice, Home]`, and `JSON.stringify(fanFor(flow)) === JSON.stringify(flow.fan)`. Not one bubble changes; only the chip stops saying "Preview — more coming". ✅ `validateRegistry` accepts a two-action inner ring ending in Home with no amendment — the ring rules are max-only (`> OUTER_MAX`, `> INNER_MAX`), there is no minimum, and `validateRegistry()` returns **0 problems**.

**`home` — not a no-op, and the registry's own comment was wrong about it.** It said *"eight bubbles instead of seven"*. **Both numbers are wrong and nobody had run it:** declared and projected are **nine actions each**. What changes is the ring of exactly two:

```
home.wire     inner -> OUTER
home.journal  outer -> INNER
```

This adopts the fan §C3:957 declares (*"Outer: Scan · Chart · Breadth · Wire · Flow. Inner: Journal · Notebook · Calendar · Voice"*) and is precisely what the projection's own ⚠️ note predicted. ⭐ **`home.calendar` survives** — it is in both fans; the door is not lost.

⛔ **The ruling's own list of Home's fan matched neither source** — it gave four outer actions and omitted Calendar, where both the registry and the preview carry five outer with Calendar inner. Its tie-breaker was "ship the registry's version", which is what this does; shipping the literal list would have **removed the Calendar door**.

**Artifacts regenerated in the same commit**, byte-equality rail (`hub/surfaceMatrixIsCurrent.test.js`) green. The diff is exactly two lines: `home` and `flow` gain **LEFT PREVIEW**. Glass sheet unchanged at **107 steps**.

The set and its rails are **kept, empty** — a future mode may need them, and deleting the machinery would mean rebuilding the projection, `validatePreview` and the ring checks from scratch the day one does.

## 3 · Two defects found by the stage change

**(a) Two authorities on "is a stored `null` a choice?"**

| file | test | verdict for `null` |
|---|---|---|
| `app/src/hub/useHubSettings.js` (was) | `explicitEnabled === undefined` | a CHOICE → `!!null` → hub **OFF** |
| `app/src/pages/settings/JoystickSettingsCard.jsx:60` | `typeof storedEnabled === 'boolean'` | **not** a choice → "never chose" → card shown |

At stage 1 both answers looked identical (no card, no hub) and nothing could tell them apart. **At member preview the member is handed the card *as* someone who never chose, and finds the toggle OFF while every other never-chose member has it ON.** One definition now — the card's, because that is the one the recovery path depends on: `app/src/hub/useHubSettings.js:179`.

Found by the new toggle-state assertion, not by reading: at stage ≥ 2 card *presence* stops discriminating, so the fifth-state cases moved to asserting the toggle's checked state, where `{"enabled":null}` and `{"enabled":false}` must land on **opposite** values or the distinction has collapsed.

**(b) At stage 2 the settings card rendered for a signed-out visitor.**

`cardVisible` answers a *rollout* question and at stage ≥ 2 says yes to everyone — including a visitor with no session, for whom `isAdmin` is false and `everChose` is false but `stage >= 2` is true regardless. At stage 1 the absence of a user hid the card **by accident**; widening the rollout removed that accident. Fixed at `app/src/pages/settings/JoystickSettingsCard.jsx:26,74`.

⭐ **Defence in depth, not the boundary.** `App.jsx` nests the Settings route inside `AuthGuard` (`:508` wrapping `:525`), so no signed-out visitor reaches this component in the running app — which is exactly why the gap was invisible until a test rendered the component directly. Both settings test files now carry a signed-out negative control.

⛔ **The kill switch is deliberately NOT restated in the settings tests.** `HUB_PREVIEW_ENABLED=false` is read at `hub/useHubActive.js:56` and removes the *hub*; this card does not consult it. It is already railed five ways in `hub/hubKillSwitch.test.jsx`, including that it outranks a stored `enabled:true`. A second copy would be a guard repeated, which is a guard unproved.

## 4 · The test subset that missed all of this is now an artifact with a rail

⚰️ **"The hub rails" was a phrase, not an artifact** — it meant whatever `src/hub` someone happened to type. The first stage-2 run got **84 files / 1118 tests, all green**, and was reported as verified while **nine** tests under `src/pages/settings/` were red. Only the six-shard gate could see them.

- `app/vitest.hubGlob.js` — the list, including `src/pages/settings/*` and the two `src/styles` rails
- `app/scripts/run-hub-rails.mjs` — `npm run test:hub`
- `app/src/hub/hubGlobCoverage.test.js` — **derives** every test importing `hub/rolloutStage` and fails if one is outside the subset

⚰️ Three instrument bugs caught on their first runs, all recorded in the files: the matcher escaped `{}` before expanding `{js,jsx}` (matched nothing); the derivation demanded a `hub/` prefix and missed the three files inside `src/hub`; and **vitest's positional arguments are filename FILTERS, not globs** — passing globs straight to `vitest run` matched nothing, ran 5 files and exited 0. The runner now expands to concrete paths and refuses below a file-count floor.

**Subset now: 89 files / 1166 tests**, 1 failed — `styles/tapFloor.test.js`, a named baseline entry.

## 5 · The gate

**Manifest `docs/plans/joystick/gate-runs/2026-09-13T17-57-36.md`.** Run on a box verified clear first — pre-flight reading, not something the manifest attests: `foreign-shard=0, freeGB=13.7`.

```
tree    2ae7e98aa11b5f859a26b9bd4830b850ad22662c  (start) -> same (end)
files   1325 on disk — RECONCILES with the summed shard total
totals  8 failed / 19,489 passed / 19,506
```

Baseline (`258c5609d`) has **7**; observed **8**; **NEW = 1**, and it is not this branch's:

| NEW failure | verdict |
|---|---|
| `components/screener/reachable.test.js > …nothing committed is connected to nothing` | ❌ **not attributable — R-29**, S4's `focusDivergence.js` orphan |

⭐ **Classified by DIRECTION, not by memory.** The branch diff touches neither `focusDivergence.js` nor `reachable.test.js`; the module already exists at the merge base `d6ac61816`; the rail was **run at that base** in a detached worktree and failed **identically**; and after master was merged in it was re-proved against `origin/master` itself, where `focusDivergence.js` has **zero real importers** — its only non-test mention sits inside a **comment** in `HubContext.jsx`. R-29 stays in `requests.md`, owned by S4.

**Zero attributable NEW.**

### ⛔ THAT BASELINE HAS BEEN SUPERSEDED, AND THE POST-MERGE GATE USES A DIFFERENT ONE

The `7` above is faithful: it is the count in **this branch's own** `gate-baseline.json`, whose
self-describing `sha` field reads `258c5609d`. ⚠️ That field is the baseline's **identity label**,
not the provenance of the blob the gate read — `258c5609d` is an ancestor of both master and this
branch, and the file *at that commit* holds ten entries. Quoting the number without this sentence
invites a reader to check the sha and find a different count.

**Master moved on 2026-09-14.** Its baseline is now `sha: 1216958ed`, measured from
`gate-runs/2026-09-14T17-48-27.md`, holding **10** — and it records `258c5609d` under
`superseded_baselines`. The three entries master has that this branch's file does not:

| added 2026-09-14 | status |
|---|---|
| `components/screener/reachable.test.js` | **R-29**, S4's orphan — the same NEW this gate classified as not-attributable, now banked on master |
| `lib/presentation/presentationSingleFormatter.test.js` | ⚠️ **`provisional: true`** — five alone-runs were INCONCLUSIVE; it failed once on a verified-clear box and passed twice under a live six-shard gate, so it is an intermittent sitting on its own 15 s timeout boundary, **not** a load artefact (`gate-runs/2026-09-14T21-39-settling-runs.md`) |
| `surfaces/manifest.test.js` | settled and banked by static proof |

⛔ **So the branch gate's `7 → 8, NEW = 1` and the post-merge gate's arithmetic are measured
against different yardsticks, and neither is wrong.** The post-merge run compares against **10**. A
reader who carries `7` forward will read `reachable.test.js` as a fresh regression when master has
already banked it.

## 6 · Rollback

**`HUB_PREVIEW_ENABLED=false` in Railway on `web`. No redeploy.** Read per request in `api/routers/auth.py::_access_payload`, so it takes effect on each member's next authenticated request. ⚠️ An already-open page keeps its hub until its next `/api/auth/me` — in practice a reload or route change, not a background poll.

⛔ That kills the hub for everyone regardless of stage; it does not revert the stage. To revert the *stage*, revert this merge and let `web` rebuild (~2–3 min).

## 7 · Post-merge verification

Full procedure: **`docs/plans/joystick/stage-2-verification.md`**, executed unattended after merge.

0. **`python tools/smoke_reset.py`** — the account starts as a control: `joystick_hub` unset, no notes/flags/positions. Owner ruling 2026-09-13.
1. Railway `web` SUCCESS on a SHA containing the merge; `/api/health` 200 with fresh uptime.
2. Code-level proof of the stage-2 exposure rule via the merged tests (already in the gate above).
3. Live iPhone 15 Pro, smoke-login link: hub visible for an account with **no stored preference** — true only because step 0 made it so.
4. **Kill-switch demonstration on the device** — `HUB_PREVIEW_ENABLED=false` → hub gone on the next authenticated request; `true` → hub returns. Screenshots and timestamps both ways.
5. ⛔ **Chip hint reads each mode's REAL tap hint — NOT "Preview — more coming".** Stage 2 empties `PREVIEW_MODES`, so that string appears nowhere; the `(preview)` suffix on the Settings label (`JoystickSettingsCard.jsx:139`) is what carries the preview framing. Coach mark appears once; Hide → reload restores; Settings toggle round-trips; edge tab restores.
6. Results written into `closure.md` box 5's evidence slot — **from this run only.** The stage-1 dry run recorded the opposite chip string, correctly for stage 1; copying it forward would put a stage-1 reading in a stage-2 record.
7. Member announcement drafted as ready-to-post text.
8. **`python tools/smoke_reset.py`** again — the run is not finished until it exits 0.
9. The first post-merge docs/tool commit adds R-29 to `gate-baseline.json` (*orphan at `origin/master`; S4-owned; not attributable to any hub branch; passes when S4 records its AWAITING_A_DECISION entry*), and removes it the moment `reachable.test.js` is green on master again.


## 8 · The files this PR changes — 26, derived AFTER the commit

```
git diff --name-only origin/master...launch/stage-2-member-preview
    CLAUDE.md
    app/package.json
    app/scripts/run-hub-rails.mjs
    app/src/hub/HubRoot.test.jsx
    app/src/hub/exposureGate.test.js
    app/src/hub/fanResolutionParity.test.js
    app/src/hub/homeFanCalendar.test.jsx
    app/src/hub/hubGlobCoverage.test.js
    app/src/hub/hubWiring.test.jsx
    app/src/hub/registry.js
    app/src/hub/rolloutStage.js
    app/src/hub/rolloutStages.test.js
    app/src/hub/runActionsHaveHandlers.test.js
    app/src/hub/sections/catalystsSection.test.jsx
    app/src/hub/stageLadderAgreement.test.js
    app/src/hub/symbolContext.test.jsx
    app/src/hub/useHubSettings.js
    app/src/hub/useHubSettings.test.jsx
    app/src/pages/settings/JoystickSettingsCard.jsx
    app/src/pages/settings/JoystickSettingsCard.test.jsx
    app/src/pages/settings/joystickSettingsControls.test.jsx
    app/vitest.hubGlob.js
    docs/plans/joystick/closure.md
    docs/plans/joystick/glass-acceptance-steps.md
    docs/plans/joystick/rollout.md
    docs/plans/joystick/surface-matrix.md
```

⚰️ **Three-dot, and derived after the commit, for two reasons this programme has paid for.**
A two-dot diff against a moving master reports master's changes as this branch's; and a list built
*before* the commit cannot see untracked files, which is how a sibling PR body reported **8** files
when the change set held **11**. Both are silent errors that make a PR body read as complete.

⚠️ **Four of these overlap what master changed since the merge base** — `CLAUDE.md`, `closure.md`,
`glass-acceptance-steps.md`, `rollout.md`. Git auto-merges all four; `merge-tree --write-tree`
returns **exit 0, 0 conflicts**. Being **575 commits behind** master is not drift: no rebase is
required and `2ae7e98aa` is **not** rewritten.

## 9 · ⛔⛔ THE GATE ABOVE MEASURED A BRANCH. THE GATE OF RECORD RUNS ON THE MERGE COMMIT.

Owner ruling, 2026-09-15, written into `stage-2-verification.md` §2. Everything in §5 re-asserts
this branch. **None of it is the gate for this merge**, and the difference is not pedantry: a branch
gate measures a tree nobody will ever deploy. What ships is the **merge commit**.

Run after merge, before anything in `rollout.md` §3 b–f starts:

```
git fetch origin master
python tools/gate_box_sampler.py --check        # VERDICT=CLEAR before you start
python scripts/gate_shards.py --shards 6        # ON THE MERGE COMMIT, tree clean
```

Four conditions, all required; any one missing and the run is not a gate:

1. **`VERDICT=` is the arbiter, never `$?`.** `VERDICT=NO_NEW_FAILURES exit=0` is the only pass.
   ⚰️ The task wrapper has misreported this twice, in **both** directions — a runner that executed
   nothing said 0, and a run printing its own `GATE EXIT: 1` said 0.
2. **Against baseline 10** (`1216958ed`), `#9` still `provisional: true`.
   ⛔ `VERDICT=DID_NOT_RECONCILE exit=3` is **not** a pass with a caveat.
3. **Sampler CLEAR for the whole run**, wrapped not bracketed.
   `INCONCLUSIVE-CONTENDED` / `-UNOBSERVED` ⇒ void, and it **waits**. Never retried into load.
4. **File reconciliation.** `test_files_on_disk − waived == summed files`.

⭐ **The mechanical half is already pre-flighted.** `harness/2026-09-15-stage2-merge-preflight.md`
built this merge locally and measured it: artifacts byte-identical after the three-way merge
(`51ce69db2aa297fed8aa4e139bea4c8a`), and `npm run test:hub` at **89 files / 1166 tests with only
`tapFloor` failing**, which is §2's own documented PASS. ⛔ That is a *tree*, not the *commit*.

⛔ **A NEW failure here is not automatically the hub's.** Classify by direction first: a failure the
**base** also has is master's — add it to the baseline citing the base hash. One only the merge has
blocks. Re-run a load-sensitive name **alone** before classifying it.
