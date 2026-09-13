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

**Manifest `docs/plans/joystick/gate-runs/2026-09-13T15-55-29.md`.** Run on a box verified clear first (`foreign-shard=0, freeGB=12.7`).

```
tree    640dcd8d166e404545dad420b3ee4a52efdc664c  (start) -> same (end)
files   1318 on disk — RECONCILES with the summed shard total
totals  8 failed / 19,439 passed / 19,456
```

Baseline (`258c5609d`) has **7**; observed **8**; **NEW = 1**, and it is not this branch's:

| NEW failure | verdict |
|---|---|
| `components/screener/reachable.test.js > …nothing committed is connected to nothing` | ❌ **not attributable — R-29**, S4's `focusDivergence.js` orphan |

⭐ **Classified by DIRECTION, not by memory.** The branch diff touches neither `focusDivergence.js` nor `reachable.test.js`; the module already exists at the merge base `d6ac61816`; and the rail was **run at that base** in a detached worktree and failed **identically**, on a tree containing none of this branch's changes. R-29 stays in `requests.md`, owned by S4.

**Zero attributable NEW.**

## 6 · Rollback

**`HUB_PREVIEW_ENABLED=false` in Railway on `web`. No redeploy.** Read per request in `api/routers/auth.py::_access_payload`, so it takes effect on each member's next authenticated request. ⚠️ An already-open page keeps its hub until its next `/api/auth/me` — in practice a reload or route change, not a background poll.

⛔ That kills the hub for everyone regardless of stage; it does not revert the stage. To revert the *stage*, revert this merge and let `web` rebuild (~2–3 min).

## 7 · Post-merge verification

Full procedure: **`docs/plans/joystick/stage-2-verification.md`**, executed unattended after merge.

1. Railway `web` SUCCESS on a SHA containing the merge; `/api/health` 200 with fresh uptime.
2. Code-level proof of the stage-2 exposure rule via the merged tests (already in the gate above).
3. Live iPhone 15 Pro, smoke-login link: hub visible for an account with no stored preference.
4. **Kill-switch demonstration on the device** — `HUB_PREVIEW_ENABLED=false` → hub gone on the next authenticated request; `true` → hub returns. Screenshots and timestamps both ways.
5. Chip hint reads "Preview — more coming"; coach mark appears once; Hide → reload restores; Settings toggle round-trips; edge tab restores.
6. Results written into `closure.md` box 5's evidence slot.
7. Member announcement drafted as ready-to-post text.
