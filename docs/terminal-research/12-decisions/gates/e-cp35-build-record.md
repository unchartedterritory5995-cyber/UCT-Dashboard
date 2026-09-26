---
id: e-cp35-build-record
unit: E CP35
packet: packet-e-ci-gap-gate
merges-after: E CP34
status: SIGNED (E CP35, fingerprint 922385382)
---

# E CP35 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  922385382
SCOPE APPROVED:   CP35 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP35 — the push window is a file tier, not a clock (F-OPS-1).** Scope is
> `tools/weekly_exec.py` **as enumerated by `git show --stat` of `d50fadadf`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk top out at **e-cp34**; manifest rows top out at **CP34**. **CP35 free.**

⚠️ **Renumbered from the prompt's plan**, which used CP35 for the post-merge baseline
re-anchor. That becomes **E CP36**; this row is the one built first, so it takes the free
number. Collision proof is the authority, not the plan's spelling.

---

## 1 · ⚰️ THE FIRST LINE EVERY SESSION READS WAS THE SUPERSEDED RULE

```
master-push window: CLOSED (Mon-Fri 09:00-16:00 ET)        exit 1
```

`docs/runbooks/deploy-windows.md` — **owner-approved 2026-09-11**, opening line: *"Replaces
the blanket RTH freeze… This is the single authority on push timing"* — had superseded that
six days earlier. **Two authorities over one value, and the loud one was wrong.**

⛔ **And it returned EXIT 1** whenever it judged the window closed. The designated ET
authority therefore **failed every weekday afternoon**, and any caller checking its status
read a correct time reading as an error. It now always returns **0**: the time reading is what
this subcommand exists to get right, and it succeeded.

⭐ **A clock cannot answer this question at all.** The tier is a property of *the files a push
touches*. Derived over this branch's 47 units: 32 files — `tools` 14 · `app` 10 · `tests` 5 ·
`.github` 1 · `CLAUDE.md` 1 · `api` 1 — the one `api/` file being `api/routers/stream.py`,
which the authority states is **not** on flow-worker's watch list;
`flow_worker_watch_coverage` exits **0**. **All Tier 1.**

## 2 · The change

`window_authority_line()` reads the runbook and derives its **tier count** and
**owner-approval date**. ⛔ **UNREADABLE is a third state:** a missing runbook prints
`deploy-windows.md UNREADABLE - tier unknown`, never a clock — *"no window"* and *"the runbook
is gone"* must not print the same sentence.

The `09:00-16:00` text survives in `cmd_et`'s docstring as the **history** of the 14:26 ET
incident that created the ET authority, now marked explicitly as history rather than a live
rule.

## 3 · Controls

```
the real runbook             -> "BY FILE TIER - …, 2 tier(s), owner-approved 2026-09-11"   ok
a fixture with an EXTRA tier -> "3 tier(s)"  — the output CHANGED                          ok  <- non-vacuity
a fixture with NO runbook    -> "UNREADABLE - tier unknown", and no clock text             ok
exit code                    -> 0 (was 1 during the window)                                ok
```

⭐ **The middle row is the one that matters:** without it, "derives the tier count" is
satisfied by a function that prints a constant.

## 4 · Validators

```
ast.parse              OK
weekly_exec.py et      UTC … | ET … | push window: BY FILE TIER - …, 2 tier(s), 2026-09-11
                       exit 0
check_repo_hygiene     clean, no line-ending flip
```

⚠️ `weekly_exec.py --self-check` exits **2 — `REFUSED: unknown subcommand`**, and it did so at
HEAD too. It is not a self-check-bearing tool; the controls above are its proof.

## 5 · Drafted ledger row — NOT written

| 120 | `d50fadadf` | 2026-09-17 | OPS | 1 | E CP35: `weekly_exec.py et` — the first line every session reads — printed `master-push window: CLOSED (Mon-Fri 09:00-16:00 ET)` for six days after `deploy-windows.md` replaced that blanket rule with a FILE TIER, and returned exit 1 while it did, so the designated ET authority failed every weekday afternoon. It now derives the real rule from the runbook (tier count, approval date), says UNREADABLE when the runbook is missing rather than falling back to a clock, and always exits 0. |

## 6 · Drafted RESUME delta — NOT applied

- ⛔ **When a rule is superseded, grep for the tools that still print it.** The replacement
  document is not the problem; the loud stale copy is.
- ⛔ **Do not fail a reading because you dislike the answer.** Exit 1 for "the window is
  closed" turned a correct clock into a broken tool.
- ⭐ **A question a clock cannot answer should not be answered by a clock.** The tier is a
  property of the file set.
