# PR body for `docs/joystick-audit-2026-09-14` — PREPARED, NOT OPENED

⛔ **This file is the PR body. It is not a PR.** `gh` is not installed here and the GitHub MCP
server fails to connect (`Authorization header is badly formatted`). **Owner ruling R4: the owner
opens and merges this in the browser, not an agent.**

---

## Title

```
audit(joystick): baseline settled at 10, provisional entries run down, D1 collision resolved, §5A promoted
```

---

## Body

**Docs and tools only. No member-facing code.** The evidence for that claim is the file list below:
every path is under `docs/`, `tests/` or `tools/`, and **none** is under `app/src/`, `api/` or
`scripts/`.

### ⚠️ Why this list is a THREE-dot diff, and the two-dot form was rejected

The list is `git diff --name-status $(git merge-base origin/master HEAD)..HEAD` — **three dots**,
merge-base → branch.

The two-dot form `git diff master..HEAD` **states something false**. It compares the two *tips*, so
master's newer commits appear as though **this branch** had made the opposite change:

| form | files | what it reports |
|---|---|---|
| `master..HEAD` (two-dot) | **115** | sweeps in every file master has changed since the branch point — `api/**`, `app/src/**`, whole doc trees — shown backwards, as though **this branch** had reverted them |
| `master...HEAD` (three-dot) | **29** | what the branch actually changed |

⛔ Those 86 phantom entries are master's own commits seen backwards. **A PR body asserting
"docs/tools only" while listing `api/services/…` would refute itself inside its own evidence.**

### Rebase-clean

| | |
|---|---|
| merge-base | `7707b224194161e24dd40b5a8da2d54df29012ac` |
| master, re-resolved at write time | `7ac0e0aee` |
| `git merge-tree --write-tree master HEAD` | **exit 0 — no conflicts** |

The branch is behind master's tip. That is **not drift and not a stop condition**: *rebase-clean*
here means **merges without conflict**, confirmed by an in-memory three-way merge. Nothing was
checked out, rebased or merged to establish it.

### Files (29)

```
M  docs/plans/joystick/closure.md                                 <- box-2 caveat note; box stays ☐
M  docs/plans/joystick/deferred.md                                <- G3-15 → G3-16 misreference fix
A  docs/plans/joystick/drift/2026-09-14-audit-pr-body.md          <- this file
A  docs/plans/joystick/drift/2026-09-14-frozen-branch-drift.md
A  docs/plans/joystick/drift/2026-09-14-intake-readiness.md
M  docs/plans/joystick/gate-baseline.json                         <- baseline 7 → 10
A  docs/plans/joystick/gate-runs/2026-09-14T17-48-27.json
A  docs/plans/joystick/gate-runs/2026-09-14T17-48-27.md
A  docs/plans/joystick/gate-runs/2026-09-14T21-39-settling-runs.md  <- the two settling runs
M  docs/plans/joystick/glass-acceptance-steps.md                  <- D1 → D1-a11y
M  docs/plans/joystick/owner-run.md                               <- D1 → D1-eye
M  docs/plans/joystick/requests.md                                <- R-30, R-31; R-29 recurrence
M  docs/plans/joystick/scope-reconciliation.md                    <- D1 → D1-a11y
M  docs/plans/joystick/stage-2-verification.md                    <- §5A promoted from DRAFT
A  docs/plans/joystick/triage/2026-09-14-d1-stage2-interaction.md
A  docs/plans/joystick/triage/2026-09-14-owner-bug-triage.md
A  tests/fixtures/hub_owner_intake/marks-all-pass.md
A  tests/fixtures/hub_owner_intake/marks-one-fail.md
A  tests/fixtures/hub_owner_intake/marks-real-all-pass.md
A  tests/fixtures/hub_owner_intake/marks-real-inconclusive.md
A  tests/fixtures/hub_owner_intake/trace-a1-fires.json
A  tests/fixtures/hub_owner_intake/trace-clipboard-cut.json
A  tests/fixtures/hub_owner_intake/trace-dropped-rows.json
A  tests/fixtures/hub_owner_intake/trace-no-control-block.json
A  tests/fixtures/hub_owner_intake/trace-nominal.json
A  tests/fixtures/hub_owner_intake/trace-out-of-order.json
A  tests/fixtures/hub_owner_intake/trace-wrong-envelope.json
A  tests/test_hub_owner_intake_readiness.py
M  tools/hub_owner_intake.py                                      <- the only behavioural file
```

### What changed, by owner ruling

**R1 · baseline adopted at 10.** `gate-baseline.json` goes 7 → 10, mirroring the file's own
`removals[]` convention with a new `additions[]` array carrying date, manifest provenance and
owner. `files[]` had **drifted** (it listed three removed rows and omitted one added row) and is
now **derived** from `failures[]`; it is documentation-only — `gate_shards.py` reads `sha`,
`measured_at` and `failures` and never `files`.

⛔ **The two provisional entries were then run down.** Manifest:
`gate-runs/2026-09-14T21-39-settling-runs.md`. **The settled number is 10 — unchanged**, because
nothing passed alone *reliably*.

| # | entry | outcome |
|---|---|---|
| 8 | `reachable` (R-29) | **banked** — rail red, re-verified on master |
| 9 | `presentationSingleFormatter` | **still `provisional: true`** — INCONCLUSIVE after five alone-runs |
| 10 | `surfaces/manifest` | **banked**, `provisional: false` — settled by static proof |

**#10 was settled without needing a clean box**, because its assertion is data, not timing:
`/admin/wisdom` is a Layout-hosted route (`App.jsx:650`) and appears **0 times** in
`app/src/surfaces/manifest.js`. Load cannot manufacture a missing manifest row. Introduced by
`7b3408a8f` (the **wisdom** workstream), while the rail is S1's — R-31 records both.

**#9 is genuinely unresolved, and the "load" label is wrong.** Five alone-runs: it **failed on a
verified-clear box** (`Tests 1 failed | 11 passed (12)`, test time **15.31s** against a **15s**
ceiling) and **passed twice while a six-shard gate with six vitest workers ran**. Load predicts
nothing in either direction. Its test time swings **2.00s → 15.31s** — an intermittent sitting on
its own timeout boundary, one failure in five, never an assertion failure. It stays banked **only**
under R1 and stays flagged. Settling it means raising that one case's timeout, which edits S10's
file — filed on **R-30**, not done here.

⚠️ **H14 — three of ten baseline entries carry a load classification** in `docs/breadth/gates.md`:
both `ThemeTrackerPage.chartmount` rows (*load-sensitive ~4 s*, banked before today) and #9
(*load 15 s timeout*). #9's runs show such a classification can itself be wrong, which is reason to
re-measure the other two — **listed, not acted on.**

**R2 · box-2 caveat recorded, box NOT ticked.** `closure.md` box 2 carries R2's wording verbatim as
a note. Wire-vs-Breadth is a **new row** in §5A rather than folded into G3-16.

**R3 · §5A promoted** from DRAFT to a real step. **Steps 0–9 are not renumbered.**

**R4 · this PR is the owner's to open and merge.**

### The D1 label collision

"D1" named **four** different checks. The two live ones are renamed by suffix; the two inside
completed evidence records are **left alone** — rewriting finished evidence to tidy a label is
falsifying a record.

| where | was | now |
|---|---|---|
| `owner-run.md` — G3-16(a), Wire vs Journal | `D1` | **`D1-eye`** |
| `glass-acceptance-steps.md` — the no-drag door | `D1` | **`D1-a11y`** |
| `b3b5-evidence-form.md` ×3 — "Move stop → exactly ONE sheet" | `D1` | unchanged (completed evidence) |
| `40-phase2-device.md` — TalkBack on the Actions button | `D1` | unchanged (completed evidence) |

⚰️ **`owner-run.md` used both senses three lines apart** — `:274` *"C1–C4 close G2-1 / G2-2 / D1"*
meant the no-drag door, while `:275` *"D1–D3 close the judgement rows"* meant its own eye row.

`ROW_RE` in `hub_owner_intake.py` gained a `-suffix` branch; without it the renamed row would be
invisible, and a row the parser cannot see is **silently absent from box 2**.

Also fixed: `deferred.md` pointed D-27 at **G3-15** (the chip/Actions overlap) where it meant
**G3-16**. Two occurrences corrected; a **third mention of G3-15 is correct** (*"G3-15 is PASS
(27/27 clear of the Actions button)"*) and was deliberately left.

### Tests

```
22 passed, 839 warnings in 4.67s
```

`python -m pytest tests/test_hub_owner_intake_readiness.py -q` — scoped to the named file. Four new
rails cover the rename, each with a control:

| rail | its control |
|---|---|
| the renamed `D1-eye` parses and no bare `D1` survives | a suffixed id is not a special case (`B7-foo` also parses) |
| box 2 counts exactly the 27-row **SET**, not a count | box 2 still **refuses** an incomplete sheet and names the row |

⭐ The set is pinned, not the count — a count can stay 27 while membership drifts, which is the
defect this programme keeps rediscovering.

`tools/hub_owner_intake.py --self-check` → exit 0. The complete-run control still reaches
`27 · ✅ TICKABLE · freeze is lifted`, so the tool has not simply started refusing everything.

### Ledger

- **R-30** — `formatPercent` adopted by nothing. Owner: **S10 presentation** (`de9551dd9`).
- **R-31** — the surface manifest has an undeclared Layout-hosted route. Owner: **S1 surfaces**
  (`b7e7541a0`).
- **R-29** — dated recurrence line added, quoting the 2026-09-11 removal and today's
  re-verification on master.

Both new rows tagged *surfaced by hub gate, not hub-owned*.

---

## Reviewer checks

1. **The file list is three-dot.** Re-run `git diff --name-status $(git merge-base origin/master HEAD)..HEAD`. If you see `api/` or `app/src/` paths, you are reading the two-dot diff.
2. **`tools/hub_owner_intake.py` is the only behavioural file.** Everything else is a document, a fixture, or a test.
3. **Read `gate-baseline.json`'s `provisional_note` before trusting the number 10.** Two of the three additions are contested, and the file says so.
4. **Run it yourself:** `PYTHONIOENCODING=utf-8 python tools/hub_owner_intake.py --self-check` → exit 0. Without that env var the output mangles its own symbols on this box; exit codes are unaffected.
5. **Boxes 1 and 2 are still ☐.** The box-2 change is a *note*, not a tick.
6. **`launch/stage-2-member-preview` @ `2ae7e98aa` is untouched and still unopened.** Nothing here starts `rollout.md` §3.
7. **§5A is scored by hand.** No tool reads `stage-2-verification.md`; results go to a record under `smoke-runs/` and then box 5's evidence slot.
8. ⛔ **The `2ae7e98aa` gate verdict STILL HOLDS against the settled baseline of 10** — restated in `drift/2026-09-14-frozen-branch-drift.md`. Its claim was a direction (*zero attributable NEW*), not a number, and all three additions are master's, none in the branch's 26 paths. Its *numbers* still do not describe a merge performed today.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
