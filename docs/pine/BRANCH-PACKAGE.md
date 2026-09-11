# `feat/indicator-r0r1` — branch package

**Prepared 2026-09-11. NOT MERGED, and merging is not this document's decision.**

⛔ Merging this branch anywhere is a product decision under hard stop H2. This page
exists so that decision can be made from one page instead of 143 commit messages.
It ends with the exact command sequence to open a PR; **it has not been run.**

* branch tip at preparation: `91f68cacd`
* base of the range: `cd078bbd2` (the Kind-4 landing)
* commits in range: **143**
* target, read from the repo rather than chosen: `origin/HEAD -> origin/master`,
  so the target is **`master`**. ⚠️ `master` is NOT currently an ancestor of this
  branch — it has moved since `cd078bbd2`, so a merge will need a rebase or a
  merge commit, and that is a decision too.

---

## 1. Member-visible changes

"Member-visible" = a member typing a formula, reading a column, or opening the
builder gets a **different answer** than they did at `cd078bbd2`. Everything else
on this branch is measurement, rails, docs, or dark code.

⭐ The column that matters most is the last one: **ADDS** means something that
refused now works, and is safe to ship in the sense that nobody loses a
capability. **CHANGES** means an answer a member already had is now different —
those are the rows that need a decision.

| # | change | commit | adds or changes |
|---|---|---|---|
| 1 | **`barstate.*` — six columns, defined from our clock and our fetch.** Columns that were blank now answer. | `ae2ed68ec`, `0011da437`, `cc1171d23` | **ADDS** |
| 2 | **`barstate.isnew` is refused BY NAME.** It folded to 1 before — a tautology wearing a value, true on every bar because this engine executes a static fetch once. | `ae2ed68ec` | ⚠️ **CHANGES** — a screen that spelled it translated before and refuses now |
| 3 | **The bar-close tri-state producer.** `/api/bars` emits it and it reaches the columns, so the four CLOCK_REALTIME columns stop being blank on the served lane. | `521a52816`, `9dfe101e0` | **ADDS** |
| 4 | **`ta.highest(n)` / `ta.lowest(n)` — the one-argument form translates.** 97 call sites across 33 tracked scripts stop refusing. ⚰️ Shipped once at the tree layer (`4e877a436`), REVERTED the same night (`12d8ac77c`) because it reclassified the names out of the runtime's carried set and broke the TWO-argument form, then redone at the ARITY layer where it costs nothing. | `7afff7786` | **ADDS** |
| 5 | **A Pine hang becomes a refusal (`pine:timeout`)** instead of taking the batch with it. | `248aa5686` | ⚠️ **CHANGES** — a script that used to hang now refuses |
| 6 | **Kind-4 text types are described and offered** — `textop` in the picker, `str`/`symtext` reachable as its operands. | `a835b0ade` | **ADDS** |
| 7 | **OTC tiers resolve** — `OQX`, `OQB`, `OID` → `OTC`. | `1fb020b56` | **ADDS** |
| 8 | **The bind-foldable window door goes back in**, bounded by the linter. | `e96b31b36` | **ADDS** |
| 9 | **A deep formula reaches the budget instead of a false refusal.** `convert` was recursive (ceiling measured 5,468 nodes) and `parseFormula` laundered the `RangeError` into `canonicalise:node` — so a formula of nothing but `+` and `1` was refused as an unrecognised node shape. | `c04e86bb0` | ⚠️ **CHANGES** — the refusal a member sees is different, and now true |
| 10 | **A crash stops wearing a guard name, everywhere it did.** Seven launder points; an engine error now carries `ENGINE_ERROR` and NO guard. | `f0a39b5f3` | ⚠️ **CHANGES** — same population as #9, six more doors |
| 11 | **`math.pi` translates** (folds to the IEEE-754 double). | `3e6770e82` | **ADDS** |
| 12 | **`sym('…')` checks its ticker shape at the door** instead of saving a definition that charts all-NaN and refuses at the scan gate. | in the `sym` door work | ⚠️ **CHANGES** — a definition that used to SAVE now refuses |

⛔ **Rows 2, 5, 9, 10 and 12 are the ones to read before merging.** Each replaces
an answer a member could already have received. Rows 9 and 10 replace a WRONG
answer with a true one; rows 2, 5 and 12 remove something that should not have
worked.

---

## 2. Flags, and what they default to

| flag | default | what turning it on would do | declared in |
|---|---|---|---|
| `BARSTATE_MODE_VENDOR` (vs `BARSTATE_MODE_CALENDAR`) | **`calendar`** | Every `barstate.*` column a member reads would follow the VENDOR's three axes instead of our tri-state. Member-visible on every bar. | asserted by `tests/test_barstate_vendor_mode.py` and its JS mirror |
| `VITE_VOLUME_NUMERIC_PANE_ENABLED` | **OFF** (`=== '1'`, so absent is off) | A definition overlaid onto the volume pane would get its OWN pane and right-hand scale instead of the shared left axis. | `docs/frontend_feature_flags.json`, status `pending` |

⭐ Both are **built, tested, and dark**. Neither has ever been on outside a test.

⚠️ `docs/feature_flags.json` (the backend ledger) could NOT hold the second one:
its gate list is derived by AST from `api/`, `scripts/`, `tools/`, and
`test_the_ledger_does_not_describe_gates_that_no_longer_exist` fails on an entry
it cannot derive. That is why a frontend ledger now exists — and **the frontend
having had no gate ledger at all is itself a finding**, routed in `requests.md`.

---

## 3. Open product questions, each with the measurement that informs it

### 3.1 Should the barstate columns follow the vendor's three axes?

**Measurement: nine timeline rows, 2026-09-10 → 2026-09-11** (`tests/fixtures/vendor/barstate-daily-timeline.json`).

The vendor has **two time axes and they move hours apart on one bar**:

```
instant A  isconfirmed 0 -> 1   bracketed (19:22, 20:55) ET   hypothesis: 20:00, the extended-hours close
instant B  isrealtime  1 -> 0   bracketed (20:55, 23:57) ET   NO hypothesis at all
```

⭐⭐ **That is the finding: a tri-state cannot express two flags that flip at
different times.** It is a different NUMBER OF AXES, not a calibration difference.

⛔ Rows 4, 5, 6 were full page RELOADS and all read `isrealtime=1`, so the flip is
the clock and not the fetch. Rows 7, 8, 9 share one `pageLoadEpoch` and span
23:57 → 00:56 → 07:38 — one session watching the cold state hold into the next
pre-market.

**What would have to be true to flip it:** an instant for A (one row in
19:30–20:30 ET), an instant for B (rows in 21:00–00:00 ET), an early-close day to
test the derived 17:00 — **a prediction for 27 Nov 2026 is pre-registered in the
fixture** — and a decision about which is right for a SCREEN, which is not the
same question as which matches TradingView. Ours answers "is this bar's period
over"; theirs answers "is this the live bar". A screener usually means the first.

⚠️ And a fifth: **where `dataset_live` would come from in production.** This
engine evaluates a static fetch and may have no honest answer to give it.

### 3.2 Should the door supply a default bound for `ta.barssince(cond)`?

**Measurement (2026-09-11):** the vendor takes **ONE** argument; the two-argument
form is **rejected outright** (`compiles: false`, a one-plot stub). Never-true
returns **`na`**, not 0.

⛔ So our `barssince(series, int)` is the wrong declaration, and "widening to 1" is
narrowing to the truth. **This engine currently accepts a call TradingView
rejects.** Fixing it REMOVES a form that translates today — which is why it is a
product question and not a bug fix.

### 3.3 Should `pineRuntimeFrontend.js` be wired?

**Measurement: the gate is 3/3 green and the module has ZERO importers.**
`app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js` holds
it there deliberately: the module reads the six `barstate.*` columns through
`interpret()`, and nothing in `app/src` supplies `newestBarIsForming` to that
lane, so the four realtime columns would render BLANK to a member.

⭐ The intended ending is written into the gate: build the producer for the JS
lane, then DELETE the test in the same commit. It is not a test to edit.

### 3.4 The Kind-4 descriptions are drafted, not reviewed

`api/services/definition_concierge.py` carries member-facing wording marked
*"drafted autonomously 2026-09-11, product review pending"*. Drafted from each
type's evaluation semantics in `ast_bind`, not invented — but what a member reads
is the owner's to approve.

### 3.5 Measured but NOT pinned — each needs a corpus case

Every one of these is a vendor reading taken this week and deliberately not
shipped, because declaring a new BAR name owes a corpus case and moves every
frozen per-ast digest:

| name | reading | fixture |
|---|---|---|
| `math.ceil` / `math.floor` | toward ±∞ (floor(-2.5) = **-3**) | `r11-nine-safe-spy-1d-2026-09-11.json` |
| `ta.nvi` | **seed = 1**; accumulates only when volume FELL (209/209, 190/190) | `r11-nvi-spy-2026-09-11.json` |
| `ta.correlation`, `ta.percentile_linear_interpolation` | `na` until the window fills; percentile CLAMPS at 0/100 (610/610) | `r11-corr-pct-spy-2026-09-11.json` |
| `ta.valuewhen` | occurrence 0 is **INCLUSIVE** (122/122); never-fired is `na` | `r11-valuewhen-spy-2026-09-11.json` |
| `time(<tf>)` | forming period's open, never `na`; `time(tf)==time` on own tf | `r11-time-tf-spy-1d-2026-09-11.json` |
| `math.max` / `math.min` | **VARIADIC** (5 args) — our table declares 2 | `groupb-readings-spy-1d-2026-09-11.json` |
| `alma` | ⛔ **does not exist in Pine v6** — must NOT be added | `r11-alma-spy-2026-09-11.json` |

---

## 4. Routed pre-existing reds, by area

None of these were introduced by this branch. Each is recorded in `requests.md`
with a repro.

| area | what | SHA / where |
|---|---|---|
| OptionsFlow | two `0x08` BACKSPACE bytes where `\b` was meant; the guard's regex can never match and the file is binary to git and ripgrep | last touched `9dff9dae0`, `b42faf565`, `37e3e8d4c` |
| Kind 4 / concierge | the `str`/`symtext`/`textop` trio — **superseded** by RULING D | `a835b0ade` |
| census floors | both demand censuses measure 129 scripts against a floor of 150 (`tests/fixtures/oos2_parity` is empty and neither census includes `corpus/committed`) | routed `6df91a134` |
| CRLF class | a committed fixture and its blob disagree about line endings; the alarms prescribed the remedy that CAUSES the defect | **RESOLVED** `39b573ea1` |
| escape census | two rails "green ALONE and red IN COMPANY" | **ANSWERED** — does not reproduce here; `c04e86bb0` carries the mechanism |
| Python suite | 35 real failures across 16 files, and **9 that pass in isolation** | re-measured `9f4a6d0a7` |
| frontend flags | no gate ledger existed; the backend rail actively rejects `VITE_` entries | `74d5e4db3` |

---

## 5. The rails, R1–R8

| rail | what it says | where it is recorded |
|---|---|---|
| **R1** | Re-derive, don't read | `docs/pine/rails.md`; enforced by every "measure it, don't quote it" note |
| **R2** | No claim without its artifact | every capture carries a fixture with its probe sha256 |
| **R3** | Shape drift is a defect class | `write_capture.py`'s column-order guard |
| **R4** | Three states, not two | the barstate tri-state; `bar_close_state` returning `None` |
| **R5** | Nothing user-facing named "Pine" | the door's refusal sentences |
| **R6** | A search returning zero is not evidence until a positive control proves it can match | `capture-procedure.md`'s hidden-tab diagnostic, step (c); `refusalLaundering.test.js`'s fake-guard control |
| **R7** | Python lane discipline — chunked, sequential, named files, never read status through a pipe | `tools/pytest_chunks.py` |
| **R8** | Commit messages via `-F <file>`, never inline | `docs/pine/SESSION-STATE.md`; `12d8ac77c` lost a backticked clause to shell substitution |

---

## 6. To open the PR — NOT RUN

The target is read from the repo (`origin/HEAD -> origin/master`), not chosen.

```sh
# 1. confirm the target is still what the repo says it is
git symbolic-ref refs/remotes/origin/HEAD        # expect refs/remotes/origin/master

# 2. confirm the branch is pushed and remote == local
git rev-parse HEAD origin/feat/indicator-r0r1    # two identical hashes

# 3. see what merging would actually carry
git fetch origin master
git log --oneline origin/master..feat/indicator-r0r1 | wc -l
git diff --stat origin/master...feat/indicator-r0r1

# 4. open the PR (gh is the repo's convention for GitHub operations)
gh pr create \
  --base master \
  --head feat/indicator-r0r1 \
  --title "Pine/barstate wave: measured vendor semantics, two dark flags, no capability removed" \
  --body-file docs/pine/BRANCH-PACKAGE.md
```

⚠️ **Step 3 is not optional.** `master` is not an ancestor of this branch, so
somebody has to decide between a rebase and a merge commit, and that decision
wants the diff in front of it.

⛔ **`--body-file` points at THIS page**, which means the PR body is a document
that says it is not a merge recommendation. That is deliberate.
