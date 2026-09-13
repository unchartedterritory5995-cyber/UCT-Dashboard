---
id: WISDOM-LOOP-LEDGER
title: UCT Wisdom Loop — Implementation Ledger
role: the single authority for what this program has committed, merged and shipped
status: current
generated: 2026-09-13
---

# UCT Wisdom Loop — Implementation Ledger

This file is the program's manifest of commits. **Every commit returned by the ledger query
must have a row here.** A commit on a program-created path with no row is a FAIL.

It follows the Terminal-Next convention
(`origin/terminal-research:docs/terminal-research/00-program-control/LEDGER.md`): rows are
filled from the query, never from memory. Never use a path-filtered or subject-filtered log
alone; that undercounted the Terminal-Next program twice.

⛔ **THE LEDGER QUERY**

```bash
# Section 1 — the program's own branch, before merge
git log --format='%h %ci %s' origin/master..feat/wisdom-loop

# Section 1 — after a merge M (substitute its SHA)
git log --format='%h %ci %s' M^1..M^2

# Section 3 — anyone else building on a path this program created
git diff --diff-filter=A --name-only <first-program-commit>^..feat/wisdom-loop   # the created paths
git log --format='%h %ci %s' <merge-sha>..origin/master -- <those paths>
```

**The one exemption:** a commit that touches ONLY this file is exempt, because the commit that
records a SHA cannot also contain its own SHA. Every other commit, docs-only included, needs a row.

**Required on any row that merges to master:** the classification from
`python tools/flow_worker_watch_coverage.py` (`docs/runbooks/deploy-windows.md` makes a red a
review gate: ADDITIVE or BEHAVIOUR-CHANGING). A red with no classification here is the one
unacceptable state. Also required: the Railway `web` deploy SUCCESS observed before the next
master push (one master merge at a time, repo-wide).

---

## Section 1 — the program's own build: `feat/wisdom-loop`

Branch cut from `origin/master` at **`f4fc5d1c1`** (2026-09-13). Not merged.

| # | commit | when (CDT) | wave | files | subject |
|---|---|---|---|---|---|
| 1 | `37e84831e` | 2026-09-13 09:29 | **S0** | 5 | docs(wisdom): Session 0 discovery — manifest, schema v0, vocabulary v0, golden verifier |
| 2 | `b5e51c37b` | 2026-09-13 09:54 | **S0** | 2 | docs(wisdom): owner rulings D1-D10 (all YES), D6 merge map, D11-D20, expanded scope |

## Section 2 — merges to master

| # | branch | tip SHA | merge SHA | flow-worker classification | web SUCCESS observed |
|---|---|---|---|---|---|

*(none — Session 0 merges nothing)*

## Section 3 — other programs' commits on paths this program created

| commit | when | program-created files touched | subject |
|---|---|---|---|

*(none)*

## Section 4 — flags declared by this program

| flag | declared in commit | read site | status | flipped by / when |
|---|---|---|---|---|

*(none — Session 0 declares no gate. A flag is declared in `docs/feature_flags.json` in the SAME
commit as its read site, because `tests/test_feature_flag_ledger.py` fails on a declaration
with no gate.)*
