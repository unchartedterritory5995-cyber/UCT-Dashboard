---
id: e-cp30-build-record
unit: E CP30
packet: packet-e-ci-gap-gate
merges-after: E CP25
status: UNSIGNED
---

# E CP30 — build record

## APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  451bc7295
SCOPE APPROVED:   CP30 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP30 — the parity lane ran NOTHING in CI (F-CI-29).** Scope is the commit(s) named below, **as enumerated by
> `git show --stat`**.

**Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk topped out at **e-cp29** before this unit; manifest rows topped out at **CP29**.
**CP30 free.**

---

## 1 · Why this checkpoint exists at all

F-CI-29 was found and fixed in session 5 and never given a checkpoint. `subprocess.run(LIST, shell=True)` on POSIX execs only `LIST[0]`, so the AST-vs-JS parity lane produced no results and NOTHING was compared, while the record read `exit=0 stdout= stderr=` — a lane that could not fail.

**A findings-fix with no packet cannot reach master**, because nothing signable names it.
This is that checkpoint: it claims the commit, nothing more.

## 2 · The commit(s)

```
e02dca955   tests/test_ast_math_parity.py
```

## 3 · Ordering

Touches one test file no other unit touches, so it is order-independent. Placed after E CP25 to keep the sequence chronological.

## 4 · Validators

```
verify_manifest --check-commits   the commit is CLAIMED (it was one of the eleven)
merge_all --self-check            UNITS and the manifest agree, both directions
cherry-pick proof                 replayed onto a throwaway from origin/master
```

## 5 · Drafted ledger row — NOT written

| 112 | *(named in the session report)* | 2026-09-16 | CI | 1 | E CP30: claims `e02dca955`, the F-CI-29 fix (`shutil.which('npx')`, no `shell=True`). It was one of the eleven commits no unit claimed. |

## 6 · Drafted RESUME delta — NOT applied

- **A fix without a checkpoint cannot be merged.** Number it when you make it.
