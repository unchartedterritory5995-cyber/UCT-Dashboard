# PR body for `docs/joystick-audit-2026-09-14` — PREPARED, NOT OPENED

⛔ **This file is the PR body. It is not a PR.** `gh` is not installed on this box and the GitHub
MCP server fails to connect (`Authorization header is badly formatted`), so the PR is opened in a
browser **by a human**. Nothing in this branch opens, merges or rebases anything.

---

## Title

```
audit(joystick): frozen-branch drift, owner-intake readiness, the bug-triage instrument, and a baseline re-measure
```

---

## Body

**Docs and tools only. No member-facing code.** The evidence for that claim is the file list
below: every path is under `docs/`, `tests/` or `tools/`, and **none** is under `app/src/`,
`api/` or `scripts/`.

### ⚠️ Why this list is a THREE-dot diff, and the two-dot form was rejected

The list is `git diff --name-status $(git merge-base origin/master HEAD)..HEAD` — merge-base →
branch.

The two-dot form `git diff master..branch` was produced first and **states something false**.
Two-dot compares the two *tips*, so master's newer commits appear as though **this branch** had
made the opposite change:

| form | files | what it reports |
|---|---|---|
| `master..branch` (two-dot) | **42** | shows `api/services/discord_render/observe.py` as modified, and `tools/deploy_blip_check.py` plus three `tests/test_*.py` as **deleted** — none of which this branch touched |
| `master...branch` (three-dot) | **21** | what the branch actually changed |

⛔ Those 21 phantom entries are master's own commits seen backwards. A PR body asserting
"docs/tools only" while listing `api/services/…` would refute itself inside its own evidence.

### Rebase-clean

| | |
|---|---|
| merge-base | `7707b224194161e24dd40b5a8da2d54df29012ac` |
| master, re-resolved at write time | `1216958ed29aa263a91f7b3224e237ca4ecb7e03` |
| `git merge-tree --write-tree master HEAD` | **exit 0 — no conflicts** |

The branch is **23 commits behind** master's tip. That is not drift and not a stop condition:
**"rebase-clean" here means merges without conflict**, which the in-memory three-way merge
confirms. Nothing was checked out, rebased or merged to establish it.

### Files (21)

```
A  docs/plans/joystick/drift/2026-09-14-audit-pr-body.md          <- this file
A  docs/plans/joystick/drift/2026-09-14-frozen-branch-drift.md
A  docs/plans/joystick/drift/2026-09-14-intake-readiness.md
A  docs/plans/joystick/gate-runs/2026-09-14T17-48-27.json
A  docs/plans/joystick/gate-runs/2026-09-14T17-48-27.md
M  docs/plans/joystick/stage-2-verification.md
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
M  tools/hub_owner_intake.py
```

**One behavioural file (`tools/hub_owner_intake.py`); one edited document; 19 new documents,
fixtures and tests.**

### The two intake fixes

Both were found by running the real tool against the **real** `owner-run.md`, and both are railed
with a control.

**Fix 1 — row D1 speaks its own vocabulary.** The sheet's D1 cell is
`☐ DISTINGUISHABLE ☐ CONFUSABLE`, not PASS/FAIL, so a **correctly marked** sheet scored 26 of 27
and reported `⛔ UNMARKED: D1 · NOT TICKABLE`, refusing to lift the freeze on a complete run.

```python
# before — git show 7707b2241:tools/hub_owner_intake.py
PASS_RE = re.compile(r"(☑|☒|\[x\])\s*PASS|\*\*PASS\*\*", re.I)
FAIL_RE = re.compile(r"(☑|☒|\[x\])\s*FAIL|\*\*FAIL\*\*", re.I)

# after
_PASS_WORDS = r"PASS|DISTINGUISHABLE"
_FAIL_WORDS = r"FAIL|CONFUSABLE"
PASS_RE = re.compile(rf"(☑|☒|\[x\])\s*({_PASS_WORDS})|\*\*({_PASS_WORDS})\*\*", re.I)
FAIL_RE = re.compile(rf"(☑|☒|\[x\])\s*({_FAIL_WORDS})|\*\*({_FAIL_WORDS})\*\*", re.I)
```

The sheet is the authority on its own vocabulary, so the **reader** learned the word — the sheet
was not rewritten to suit the tool, least of all mid-run while the owner may be holding a printed
copy. The tick still binds to the word that **follows** it, which is what keeps `☐ PASS ☑ FAIL`
from reading as a pass.

**Fix 2 — a missing control block no longer passes.** This one failed in the **dangerous**
direction.

```python
# before — an absent/drifted control block printed a warning, then returned 0
def stage_note(b1: dict, b2: dict) -> str:
    ...
return 0 if (b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]) else 1

# after
control_ok = len(controls) == SECTION_A_CONTROL
def stage_note(b1: dict, b2: dict, control_ok: bool = True) -> str:
    ...
return 0 if (control_ok and b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]) else 1
```

Measured before the fix with **0 declared controls**, the tool printed `✅ TICKABLE` and
`✅ Boxes 1 and 2 are ticked on evidence … The §4 freeze is lifted`. A trace that never showed the
instrument could tell a deliberate press from a flick would have ticked both launch boxes. The
tool's own docstring says the control block decides *"whether anything else means anything"* — it
decided nothing. The fix only ever **withholds** a verdict; it never invents one, and the pass
path still reaches exit 0.

### Tests

```
18 passed, 643 warnings in 1.29s
```

`python -m pytest tests/test_hub_owner_intake_readiness.py -q` — scoped to the named file, per the
backend-pytest rule. Every rail is paired with a control proving it could return the other answer:

| rail | its control |
|---|---|
| every step row in the real sheet parses | no candidate row is missed by the parser |
| D1 reads PASS / FAIL / UNMARKED / AMBIGUOUS | the tick still binds to the following word |
| an unmarked row blocks and is named | a fully marked sheet **is** tickable |
| a missing control block withholds both boxes | a complete run still lifts the freeze |
| unusable input exits 2 and says why | a real failure exits **1**, not 2 |
| a silent A1 scores as the guard holding | a firing A1 is a failure |

`tools/hub_owner_intake.py --self-check` exits 0 with three new cases.

### Also in this branch

- **A drift audit** of the frozen stage-2 branch: **DRIFT-FREE**. Master advanced 375 commits past
  the merge base and touched **none** of the branch's 21 `app/**` files.
- **A baseline re-measure on master `1216958ed`** — six shards, 1350 files reconciling,
  `10 failed / 19919 passed / 19938`. **The baseline of 7 is stale: master itself now fails 10.**
  Details and the verdict block are in `gate-runs/2026-09-14T17-48-27.md`.
  ⛔ `gate-baseline.json` is **not** amended here — R-29 enters it only in the first docs/tool
  commit after the stage-2 PR merges, per the standing ruling.
- **A DRAFT step** in `stage-2-verification.md` (§5A), closing a gap: steps 0–9 contain no
  post-swap check of the Home fan's geometry. Marked DRAFT; **no existing step renumbered**.

---

## Reviewer checks

1. **The file list is three-dot.** Re-run `git diff --name-status $(git merge-base origin/master HEAD)..HEAD` and confirm it matches. If you see `api/` or `app/src/` paths, you are reading the two-dot diff.
2. **`tools/hub_owner_intake.py` is the only behavioural change.** Everything else is a document, a fixture, or a test.
3. **Both fixes make the tool more conservative, never less.** Fix 1 lets it *read* an answer it was blind to; fix 2 makes it *withhold* where it used to pass.
4. **Run the self-check:** `PYTHONIOENCODING=utf-8 python tools/hub_owner_intake.py --self-check` → exit 0. Without that env var the output mangles its own symbols on this box; exit codes are unaffected.
5. **Fixtures are the tool's own shapes**, built by reusing `_synthetic_trace()` / `_synthetic_md()` — a fixture in a shape the product never emits tests nothing.
6. **Nothing here ticks a box, opens a PR, or starts `rollout.md` §3.** `launch/stage-2-member-preview` @ `2ae7e98aa` is untouched and still unopened.
7. ⛔ **Read the W4 verdict block before treating the stage-2 gate as current.** Its conclusion (zero attributable NEW) holds and R-29 was re-verified on master; its *numbers* no longer describe a merge performed today, because master has since gained two further failures of its own.
8. **§5A is a DRAFT and needs an owner ruling.** Do not treat it as an agreed step.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
