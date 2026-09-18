---
id: S2-F-S2-1
title: Ctrl/Cmd+Shift+F must not write to a member's flag list — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-14
---

# F-S2-1 — the platform accelerator chord stops flagging tickers

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  72cda4cda
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** CP1 may not be merged until a line is
> signed naming it. ⚠️ **This is the one packet in the current set that a member can
> FEEL** — a chord that used to flag a ticker stops flagging it. `COMPLETION_AUDIT.md`
> §3.4f says so in those words: *"it wants a line of its own rather than riding along."*

---

## 1 · Why this was opened now

| gate | reading |
|---|---|
| Phase 0 §0.7 queue | **F-S2-1 — READY** |
| `RESUME.md` §6 | *"baselined is correct; tightening the guards is member-visible and waits for **OI-06**, with its own PR then"* |
| OI-06 | **answered 2026-09-14** from production telemetry (29 users) |

Its stated precondition is met, and the queue gate the session was given says open it only
if §0.7 marked it READY. It did.

⛔ **S4 CP2 is also marked READY and was NOT opened** — the session's instructions exclude
it explicitly.

---

## 2 · The defect, as measured

Five surfaces claim `Shift+F` (flag the ticker) and they did not agree on which modifiers
they answer. Measured on `feb7ba1f8`:

| surface | guard before | answered Ctrl/Cmd+Shift+F? |
|---|---|---|
| `components/chart/pane/ChartPane.jsx` | `!repeat && !ctrl && !alt && !meta` | no ✅ |
| `components/TickerPopup.jsx` | `!repeat` | ⛔ **yes** |
| `pages/ThemeTrackerPage.jsx` | `!repeat` | ⛔ **yes** |
| `pages/Watchlists.jsx` | `!repeat && selectedSym` — a STATE guard, not a modifier one | ⛔ **yes** |

⭐ **A member reaching for the platform accelerator chord got a silent write to their flag
list on three screens and nothing on the chart.** That is HY-35's recorded class — *"one
chord flagged a ticker in two widgets at once"* — in the form the 2026-08-28 ownership fix
did not cover.

⚠️ **One row of that table could not be reproduced.** It also listed
`pages/charts/grid/GridChartCell.jsx` with the tight guard; measured today, that file
contains **no `shiftKey` test at all**. It is recorded here rather than silently dropped:
the roster to trust is the one `chordCollision.test.js` derives from source, not the table.

---

## 3 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | the three guards gain `&& !e.ctrlKey && !e.altKey && !e.metaKey` (ChartPane's shape), `LOOSE_MODIFIER_BASELINE` empties in the same change, and three caller-level test files assert the behaviour | measured: **none** (§4) | **S** |

**Files:** `components/TickerPopup.jsx` · `pages/ThemeTrackerPage.jsx` ·
`pages/Watchlists.jsx` · `pages/command/chordCollision.test.js` · plus
`TickerPopup.flagkey.test.jsx`, `ThemeTrackerPage.flagkey.test.jsx` and four cases appended
to `Watchlists.flagkey.test.jsx`.

⛔ **No new chord, no new surface, no change to what bare `Shift+F` does.** The only
behaviour that changes is what happens when a member also holds Ctrl, Cmd or Alt.

---

## 4 · ⛔ Watch-coverage classification — MEASURED after the commit

| field | value |
|---|---|
| base | `origin/master` |
| reachable | 156 modules in flow-worker's closure |
| watched | 24 |
| changed | 11 |
| **verdict** | **OK** — stranded: `[]` |

Every file is under `app/src/**`. Nothing under `api/**`, so no marker bump and no
flow-worker redeploy.

⚠️ **The classification must be run AFTER the commit.** `changed_files` reads the diff
against `origin/master`, not the working tree — an uncommitted change reports `changed=4`
and looks like a clean answer about work that has not been measured at all.

---

## 5 · ⭐⭐ THE EVIDENCE — and the shape rail stays GREEN under the mutation

The mutation reverts all three guards to their loose form **and** restores the baseline,
which is exactly what a regression would look like if someone "fixed" the rail instead of
the code.

| suite | under the mutation | restored |
|---|---|---|
| `pages/command/chordCollision.test.js` (**derives guards from SOURCE**) | ⛔ **8 passed — GREEN** | 8 passed |
| `components/TickerPopup.flagkey.test.jsx` | **4 failed**, 1 passed | 5 passed |
| `pages/ThemeTrackerPage.flagkey.test.jsx` | **4 failed**, 1 passed | 5 passed |
| `pages/Watchlists.flagkey.test.jsx` | **4 failed**, 4 passed | 8 passed |
| **total** | **12 failed / 14 passed** | **26 passed** |

⛔⛔ **THE SOURCE RAIL CANNOT SEE THIS REGRESSION, AND THAT IS THE POINT.** It reads text
and compares it to a baseline; move both together and it is satisfied. **Only the
caller-level cases fail.** This is the session's *behaviour over shape* rule with a
measurement behind it rather than an assertion.

⭐ **Every one of the 14 that stayed green under the mutation is a positive control.** A
file that only proved the accelerator is ignored would pass just as well against a handler
that had stopped working altogether — which is the mute this whole finding is about, one
level down. Each surface carries `bare Shift+F still flags` beside its refusals, and the
CapsLock case asserts **both halves in one test** so the refusal is provably about the
modifier and not about the letter's case.

⛔ **Restored by EDIT, never `git checkout`** (`feedback_mutation_check_never_git_checkout`).

### The baseline is kept, not deleted

`LOOSE_MODIFIER_BASELINE` is now `[]` and stays in the file. Both directions still run
against it: a NEW loose surface fails by name, and an **empty** baseline is what makes that
failure mean *"a defect was introduced"* rather than *"the list drifted"*.

---

## 6 · ⚠️ A pre-existing red found on the way, and it is not this packet's

`app/src/pages/ThemeTrackerPage.chartmount.test.jsx` is **RED on this branch**: 2 failed,
1 passed. Its harness comment says the page *"auto-opens the FIRST theme on load"*; it does
not — the theme row renders and the holding does not.

⛔ **Provenance, not `git status`:** reverting this packet's guard change by EDIT leaves
those two failures **identical**, so the red is not inherited from this work.

⚰️ **ATTRIBUTION CORRECTED 2026-09-14.** This first named **`0b7570df4`** — which is only
the *last commit to touch the page*. `git log -S"firstThemeTicker"` names the commit that
actually removed the auto-open the harness depends on: **`453ecc3ec`** (2026-09-05,
*"feat(theme-sets): rebuilt editor — watchlist-style, in-widget, optimistic"*, +253/-115
on that file). The behaviour was introduced by `3fe7b63e3` (2026-07-14) and is absent at
HEAD; the test landed `7adfdda2b` (2026-08-05), a month before the removal.
⭐ **Last-to-touch is a guess; the pickaxe is a measurement.**

**Not fixed here.** This packet's own ThemeTrackerPage cases expand the theme first and are
green; the diagnosis is written into that file so whoever owns the page has the answer
without re-deriving it.

---

## 7 · Drafted ledger row — NOT written

```
| 72 | <CP1 commit> | 2026-09-14 | S2 / behaviour | 7 | F-S2-1: Ctrl/Cmd/Alt+Shift+F stops writing to the flag list on three surfaces; baseline emptied; 12 caller-level cases mutation-proved where the source rail stays green
```

## 8 · Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**:

> ⛔ **A rail that derives a guard set from SOURCE and compares it to a baseline cannot see
> a regression that moves both.** ⚰️ 2026-09-14: reverting all three F-S2-1 guards while
> restoring `LOOSE_MODIFIER_BASELINE` left `chordCollision.test.js` **green**; only the
> caller-level cases went red. A shape rail finds the defect once; a behaviour rail is what
> keeps it fixed. Ship both, and mutation-prove the behaviour one.
