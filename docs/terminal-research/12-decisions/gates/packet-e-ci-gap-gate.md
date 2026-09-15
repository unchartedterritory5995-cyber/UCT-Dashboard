---
id: PACKET-E
title: 99% of this repository's tests run on no automated path — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-15
---

# PACKET E — the CI gap

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs CI.
> **Non-collision:** `PACKET-E` appears nowhere in either worktree; no gate document
> mentions a CI checkpoint (control: the same search finds `PACKET-B`, `PACKET-D`,
> `PACKET-V`).

⛔ **ZERO PRODUCT CODE.** One workflow file. It changes no member-facing behaviour and,
by construction, blocks nothing.

---

## 1 · E.1 — what CI actually is

Provider: **GitHub Actions**, determinable, 7 workflows.

| workflow | trigger | runs |
|---|---|---|
| `master-deploy-gate.yml` | push to master/main | pytest on **3 named files** |
| `vite-build-args.yml` | push, paths `Dockerfile.web` | pytest on **2 named files** |
| `wisdom-rails.yml` | push + PR | pytest on **2 named files** |
| `optionsflow-guard.yml` | push, paths `OptionsFlow.jsx` | `npx vitest run src/pages/optionsFlow/` |
| `flow-worker-deploy-coverage.yml` | push/PR, paths `api/**` | the watch-coverage classifier |
| `joystick-device.yml` | manual | BrowserStack **Automate** — unfunded, takes its skip branch |
| `ocr-linux-cert.yml` | manual + narrow push | OCR cert |

### ⛔ The number

| suite | test files | run by any workflow | **run by NOTHING** |
|---|---|---|---|
| vitest | **1,353** | 22 (`src/pages/optionsFlow/`, paths-scoped) | **1,331** |
| pytest | **1,429** | 6 (named one by one) | **1,423** |
| **total** | **2,782** | **28** | **2,754 — 99.0%** |

**Positive control:** `chordCollision.test.js` — the rail that found F-S2-1 — appears in
**0** workflows, as E.1 of 2026-09-14 established.

⭐ **Every "green" this programme has reported was one laptop, once, at a moment somebody
chose to type the command.** That is not an accusation about the tests; it is the size of
the thing standing behind them.

---

## 2 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `.github/workflows/full-suite-report.yml` — full vitest + full pytest, **report-only**, on push to `feat/s7-price-level` and PR to `master` | none | **S** |
| **CP2** | `.github/workflows/full-suite-report.yml` — a `publish` job that writes each run's machine-readable result onto an orphan `ci-results` branch, so a result can be READ without an account | none | **S** |
| **CP3** | *(NOT BUILT)* promote to a required check, once the criterion below is met | — | — |

### ⛔ It is report-only, and that is load-bearing

`continue-on-error: true` at job level; **not** added to any branch-protection rule; does
not touch the Layer-0 pre-push guard; never runs on master.

**A brand-new job that can block a merge, on a suite nobody has ever seen run in CI,
converts an unknown number of pre-existing failures into a merge-queue outage on its first
morning.** The repo's own history says so: `gate_shards.py` exists because a gate that
cannot distinguish an environment failure from a code failure gets muted.

> **CP3's PROMOTION CRITERION, stated so it can be checked:** ≥1 **GREEN** run and ≥1 **RED** run
> recorded in the ledger. A gate nobody has seen fail is not a gate
> (`lesson_gate_that_cannot_fail`); a gate nobody has seen pass is worse. Promotion is a
> separate unit with its own approval line.

### ⚰️ CP2 MEANT TWO DIFFERENT THINGS, AND THE SIGNING MANIFEST IS WHERE THAT BITES

**This table declared `CP2` = *promote to a required check* while commit `e767a7aab` shipped
under the title *"E CP2 — publish CI results into the repo"*.** Two different checkpoints,
one id, one packet's roster.

⛔ **A signature names a CHECKPOINT, never a packet** — that sentence is the first thing
`tools/sign_manifest.txt` says about itself. An ambiguous id is therefore not a cosmetic
problem: a manifest row reading `packet-e | CP2 | <hash>` would be a signature over a name
with two referents, and nothing downstream could say which one the owner approved.

**Resolved by renumbering the UNBUILT one**, which is the side that costs nothing: the
promotion checkpoint has no commit, no ledger row and no artifact pointing at it, so moving
it to **CP3** contradicts nothing. Renumbering the BUILT one was rejected — its id is
already fixed in an immutable pushed commit message and in the CI run's display title, so
the packet would permanently disagree with the record. ⭐ **When two names collide, renumber
the side that nothing has bound yet.**

### Two traps the workflow encodes

- **A run without a totals line is not a run.** Both jobs pipe through `tee`, so the step's
  exit code is `tee`'s; each asserts the totals line explicitly afterwards.
- **`vitest -t` is a regex and an empty filter exits 0** — a false PASS. No filter is used.
- `cancel-in-progress: false` — a cancelled run leaves a hole that reads exactly like a
  green one.

---

## 3 · E.3 — known-red at landing, and why the inventory is INCOMPLETE

| test | finding | why |
|---|---|---|
| `ThemeTrackerPage.chartmount.test.jsx` | **PACKET-T** | stale; **green once Packet T lands** (already fixed on this branch) |
| `components/screener/reachable.test.js` | **R-29** + **F-S1-2** | by design — names `focusDivergence.js` (S4 CP1) and `surfaces/manifest.js` (S1 CP1), both deliberately unmounted |

⛔⛔ **THE LIST IS NOT A FULL INVENTORY, AND SAYING SO IS THE POINT.** It was derived from
**scoped** local runs, because **this box cannot run either suite whole**: `pytest tests/`
has reached **18 GB** and been OOM-killed here (`--collect-only` alone reached **6.6 GB**),
and a concurrent full run once swept a worktree's `node_modules` and destroyed its `.git`
file. Running them to satisfy this section would break a ⛔⛔ rule in `CLAUDE.md` and risk
the repository.

⭐ **So the first CI run is the first complete measurement this repository has ever had**,
and its output IS the inventory. It is copied into the workflow header, with a finding id
per row, before anyone argues about promotion.

---

## 4 · Drafted ledger row — NOT written

```
| 77 | <CP1 commit> | 2026-09-15 | CI | 1 | Packet E CP1: full vitest+pytest as a REPORT-ONLY workflow. CI ran 28 of 2,782 test files; 2,754 (99.0%) ran on no automated path. Promotion needs >=1 green and >=1 red in the ledger.
```

## 5 · Drafted RESUME delta — NOT applied

> ⛔ **"The suite is green" has meant one laptop, once.** Measured 2026-09-15: CI ran
> **28 of 2,782** test files; **2,754 (99.0%)** ran on no automated path, including
> `chordCollision.test.js`, the rail that found F-S2-1.
> `.github/workflows/full-suite-report.yml` runs both suites **report-only**; it becomes a
> gate only after ≥1 green and ≥1 red run are in the ledger. ⛔ Do not promote it early: a
> blocking gate over an unmeasured suite is a merge-queue outage, not a safety net.
