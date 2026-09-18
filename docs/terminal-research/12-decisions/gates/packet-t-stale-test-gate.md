---
id: PACKET-T
title: A stale ThemeTracker test — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-15
---

# PACKET T — the stale test

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  5179b2890
SCOPE APPROVED:   T-CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** (`PACKET-T`, non-collision proved: 0 hits in either
> worktree). One checkpoint: **T-CP1**.
>
> ⚰️ **THIS PACKET USED TO CARRY TWO CHECKPOINTS AND WAS THEREFORE UNSIGNABLE.**
> `sign_gate.py` refuses a file with more than one unsigned `APPROVED AT SHA:` line
> (*"refusing to guess which"*), and one block cannot hold two signatures. D3 CP2 moved to
> `d3-cp2-build-record.md` with its own block. **One checkpoint, one block** — found by
> dry-running `sign_all.py`, not by reading it.

---

## 1 · T — the test was STALE, not failing

| | |
|---|---|
| test | `app/src/pages/ThemeTrackerPage.chartmount.test.jsx` |
| before | **2 failed / 1 passed** |
| after | **3 passed** |
| decision | **REWRITE** |

**Why rewrite and not delete, in one sentence:** the behaviour the test asserts — select a
holding, `ChartPane` mounts with that symbol and the current timeframe, `stored=null`,
retargeting enabled — is **intact at HEAD**; only its PRECONDITION was removed.

| | commit | what |
|---|---|---|
| introduced | **`3fe7b63e3`** (2026-07-14) | *"single-open accordion (first theme open by default)"* — added `firstThemeTicker`, which auto-opened the first theme |
| test landed | **`7adfdda2b`** (2026-08-05) | its harness comment says the page *"auto-opens the FIRST theme on load"* |
| removed | **`453ecc3ec`** (2026-09-05) | *"feat(theme-sets): rebuilt editor"*, +253/−115 — `openTheme` now starts `null`; `toggleTheme()` (`ThemeTrackerPage.jsx:907`) is the observable equivalent |

⛔ **The removed feature was NOT restored and the test was NOT muted.** The repair is one
click — expand the theme — with the removing commit named in the file.

### Mutation, restored by EDIT

| mutation | diff | result |
|---|---|---|
| hardcode what `ChartPane` receives | `sym={selectedSym} tf={chartPeriod}` → `sym={'HARDCODED'} tf={'W'}` at `ThemeTrackerPage.jsx:1507` | ⛔ **1 failed / 2 passed** — *"selecting a holding mounts ChartPane with that symbol and the current timeframe"* |
| restored | `git diff --numstat` **empty** — byte-identical | ✅ **3 passed** |

---

---

## 3 · Files, and the one-unit-one-commit proof

`app/src/pages/ThemeTrackerPage.chartmount.test.jsx` — commit **`7041a04a8`**, disjoint
from every other unit's file set (intersections printed in the session report).

---

## 4 · Drafted ledger row — NOT written

```
| 78 | `7041a04a8` | 2026-09-14 | S-TEST | 1 | Packet T: ThemeTracker chartmount test was STALE (asserted an auto-open removed by 453ecc3ec), rewritten against toggleTheme; 2 failed/1 passed -> 3 passed
```

## 5 · Drafted RESUME delta — NOT applied

> ⛔ **A test that fails because its feature was deliberately removed is STALE, not a
> regression.** Resolve it by rewrite-or-delete with a finding naming the removing commit —
> never by restoring the feature, never by muting. ⚰️ 2026-09-14:
> `ThemeTrackerPage.chartmount.test.jsx` asserted an auto-open added by `3fe7b63e3` and
> removed by `453ecc3ec`; the assertions were still valid and only the precondition had gone.
