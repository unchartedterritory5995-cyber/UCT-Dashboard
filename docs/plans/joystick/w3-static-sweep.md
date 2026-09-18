# W3 — the static defect sweep

> **PRESENT / ABSENT, per defect class, derived from source.** Every row is a measurement with its
> control, taken on `design/bar-and-strong-cut`. Run lean per `resource-manifest.md` §3.

---

## ⛔⛔ READ THIS BEFORE THE TABLE, OR THE TABLE WILL LIE TO YOU

**The owner used the hub on his phone and said *"Wow tons of bugs … too glitchy and not smooth."*
This sweep finds almost nothing. Those two facts are not in tension, and the reason is the whole
point of this section.**

A static sweep can only see defect classes that leave a trace in the source: an undefined token, a
dead class, a wire that goes nowhere, a cap exceeded, a contract drifted. **It is structurally
blind to everything the owner actually reported** — whether a flick registers, whether a scrub
tracks a thumb, whether the fan opens smoothly on a real GPU under real memory pressure, whether
the thing *feels* like a $5 project.

> ### ⭐ ZERO PRESENT ROWS HERE IS NOT AN ALL-CLEAR. It is "the cheap classes are clean, so the
> expensive investigation has nowhere cheap left to hide."

⛔ **Anyone quoting this table as evidence the hub is fine is misusing it**, and the direction of
that error is the dangerous one — it would close the investigation the owner opened. The dynamic
half needs a device, and **R9 stands: a screen mirror never judges flick, hold or scrub** (measured
floor 260–427 ms per gesture on a Live session, against a `FLICK_MS` of 120 — the transport cannot
resolve the thing being measured).

---

## 1 · The table

| # | defect class | verdict | how it was measured |
|---|---|---|---|
| 1 | a `var(--x)` used in the hub that is defined nowhere | **ABSENT** (0 app-wide) | ⚠️ **was PRESENT at 2 sites** — `--color-border` in `JoystickSettingsCard.jsx`, invisible dividers. Fixed; rail widened to scan JS |
| 2 | `styles.X` used where `.X` is not in the module | **ABSENT** (0 of 54) | a missing one renders `class="undefined"` — no styling at all |
| 3 | a CSS class defined and never referenced | **ABSENT** (0 of 54) | 54 defined, 54 used, exact match |
| 4 | a transition animating a LAYOUT property | **ABSENT** (0) | swept `width/height/top/left/right/bottom/margin/padding/font-size` in transition lists — design bar M6 |
| 5 | `backdrop-filter` on an element that animates | **ABSENT** (0) | the 3 that animate `transform` carry none; all 5 filtered elements are static |
| 6 | a literal / drifted timing curve | **ABSENT** | ⚠️ **was PRESENT** — two curves 0.16 overshoot and 20 ms apart. Tokenised, count pinned at two |
| 7 | a `kind:'run'` action reaching a member with no handler | **ABSENT** | `runActionsHaveHandlers.test.js` |
| 8 | the DRAWN fan and the RESOLVED fan disagreeing | **ABSENT** | `fanResolutionParity.test.js` — ⚠️ this was live in production since Increment 2; fixed and now also proved to be a subsequence |
| 9 | a sub-44px touch target in the hub | **ABSENT** | `styles/tapFloor.test.js` — see §2 for the one red, which is not the hub's |
| 10 | a themed token unpinned in a theme island | **ABSENT** | `styles/themeIslands.test.js`, required set derived from `tokens.css` |
| 11 | a hub module built and wired to nothing | **ABSENT** | `components/screener/reachable.test.js` — ⭐ it caught `hubSmoothness.js` in exactly this state and the module was wired before it was committed |
| 12 | a ring cap exceeded on the PROJECTION | **ABSENT** | `homeFanCalendar.test.jsx`, now every mode on **both** surfaces — `validateRegistry` reads `mode.fan` and has never once checked a projection |
| 13 | a callback's arity drifting from its call site | **ABSENT** | `hub/contractArity.test.js`, read from the calling file |
| 14 | an undeclared endpoint the hub can write | **ABSENT** | `hub/writePaths.test.js` |
| 15 | the generated surface artifacts stale | **ABSENT** | `surfaceMatrixIsCurrent.test.js`, regenerated in-commit |

**Zero PRESENT rows attributable to the hub.** Two rows were PRESENT and were fixed on this
branch (1 and 6); both are now railed so they cannot return silently.

---

## 2 · PRESENT, and NOT the hub's to fix

Recorded so nobody re-files them, and so nobody reads a red suite as this branch's.

| what | owner | provenance |
|---|---|---|
| `tapFloor.test.js` red on `journal-2-0/components/notebook/CaptureDialog.module.css` — a finger target declared at ≤640px but not ≤1024px, so tablet is left short | **Notebook** (rule 12 forbids this branch editing that tree) | the file is **byte-identical to `origin/master`** here, and this branch touches nothing under `journal-2-0` |
| `reachable.test.js` red on `lib/context/focusDivergence.js` | **S4** (filed as R-29) | pre-existing on master |
| `reachable.test.js` red on `surfaces/manifest.js` | unassigned — **newer than the R-29 note**, which names only `focusDivergence.js` | pre-existing on master |

⛔ Provenance was established with `git show origin/master:<file>` and a hash comparison, never
`git status` — the rule this repo wrote after four rails were nearly mis-filed to the wrong owners.

---

## 3 · What every ABSENT above actually rests on

Each measurement in §1 ran its control **first**, per the owner's standing probe rule. The ones
worth naming, because each has a way of passing for the wrong reason:

- **Comments stripped before any literal hunt**, with a control proving the scan finds a planted
  literal **and refuses one that appears only in a comment.** A stylesheet's prose quotes its own
  declarations — this repo has six recorded instances of an instrument reporting a property of its
  own commentary.
- **The token scan was shown returning the OTHER answer on a known case**: `origin/master`'s copy
  of `JoystickSettingsCard.jsx` → `['--color-border']`, this branch's → none.
- **The reachability sweep judges what is COMMITTED**, so an untracked file is exempt. `hubSmoothness.js`
  was invisible to it until committed — the observation "it didn't flag my file" was about tracking
  state, not about reachability, and reading it the other way would have shipped an unwired module.
- **`--poolOptions.forks.singleFork` does not exist in vitest 4.0.18** and errors out. The lean runs
  use `--pool=forks --no-file-parallelism --maxWorkers=1`. Never invent a flag — a run that dies at
  argument parsing reports no totals and, wrapped, can read as a pass.

---

## 4 · What is still owed, and needs a device or a memory window

| | needs |
|---|---|
| does a flick register at all, and at what rate | **a real finger.** R9; a Live mirror's 260–427 ms floor cannot resolve `FLICK_MS` |
| does the scrub track the thumb | a real finger |
| M1–M4 (dropped frames, input→paint, open/close, return) | `hubSmoothness.js` is built, wired and mutation-proved; it needs **one gesture on a device** to produce numbers |
| the R8 critique passes, before/after recording | a build + one Chrome tab — blocked on memory, see `resource-manifest.md` §4 |
| the six-shard gate | blocked on memory; must run **sequentially, single worker**, sampler CLEAR, totals reconciled |

⛔ Until those land, the honest statement of this programme's quality position is: **the static
classes are clean and the thing the owner actually complained about has not yet been measured.**
