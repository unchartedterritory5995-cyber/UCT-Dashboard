# ⛔⛔ A repo-wide backend `pytest tests/` reached 18 GB on this box — 2026-09-10

**Recorded by the Wave Q1 session (`claude.exe` pid 17464) about a process it did
not own, so the other session's evidence is not lost.** The investigation is a
follow-up, not this session's job.

## Why this file exists

Three consecutive attempts to run the Wave Q1 frontend gate were killed by the
host for low memory — twice at the default two workers per shard, once at one
worker, plus the loop that was *waiting* for other suites to finish. My first
diagnosis was **wrong**: I blamed three concurrent `vitest` runs in peer
worktrees (`inc3-merge`, two `joystick-hub` workers). Measuring instead of
inferring found a single Python process using more memory than everything else
on the machine combined.

## The process

| | |
|---|---|
| command | `C:\Python314\python.exe -m pytest tests/ -q -p no:randomly --timeout=600` |
| pid | 5024 |
| started | 2026-09-10T21:26:23Z |
| RSS observed | 4,096 MB → 17,534 MB → 17,804 MB → **18,120 MB**, still climbing |
| owner | `claude.exe` pid **33188** (a different session; mine is pid 17464) |
| ancestry | `python.exe 5024` ← `bash.exe 24356` ← `bash.exe 42284` ← `bash.exe 45088` ← `claude.exe 33188` |
| end | **died on its own** between two measurements ~90 s apart — almost certainly OOM-killed by the host, before the authorised kill could be issued |

⛔ No partial output file could be attributed to it. Its stdout belonged to
another session's task-output plumbing, and nothing in the repo (no
`.pytest_cache` report, no junit xml) carried a run from that window. What is
recorded above is what was observable from outside the process while it lived.

## ⭐ It is REPRODUCIBLE, and it recurred within minutes

Two more unscoped runs from the same session replaced it almost immediately:

| pid | started | RSS at capture | command |
|---|---|---|---|
| 12872 | 2026-09-10T21:51:26Z | **14,821 MB** | `pytest tests/ -q -p no:randomly` |
| 33464 | 2026-09-10T21:59:35Z | **4,523 MB** | `pytest tests/ -q --collect-only` |

⭐⭐ **THE SHARPEST DATUM IS THE SECOND ROW: `--collect-only` reached 4.5 GB.**
Collection alone — import the test modules, build the item tree, execute nothing
— is enough to do this. So whatever this is, it happens at **import/collection
time**, not during test execution, and a `-k` filter or a timeout will not
contain it. That is where an investigation should start.

Free memory on a 32 GB box fell to **1.3 GB** at the worst point.

## What to investigate (follow-up, NOT this session)

⛔ Do not run `pytest tests/` unscoped on this box until the cause is found.
Scope every backend run to named files, as Wave Q1's checklist already does
(`tests/test_note_updated_at_is_always_a_baseline.py`,
`tests/test_j2_telemetry_allowlist.py` — 25 tests, ~1.4 s, ~50 MB).

Leads, in the order I would take them:

1. **It is collection, not execution** — see above. Import-time work in a
   `conftest.py` or a test module is the first suspect.
2. **`C:\data` IS REAL ON THIS BOX**, and `tests/` is exactly the surface the
   repo-root `conftest.py` tripwire guards. That conftest does AST-derived
   census work over `api/**`, `scripts/` and `tools/` **at import**, and pins ~72
   environment variables. Whether it is the cause or merely adjacent, it is the
   piece of import-time machinery that runs before every backend test — start
   by measuring it alone.
3. **A module-scope fixture or a module-level data load** that is fine per-file
   and catastrophic across the whole tree.
4. ⛔ Rule out the flattering explanation first: this is NOT "the suite is big".
   A collection pass that allocates 4.5 GB is not a size problem, it is a leak
   or an accidental full-data load.

## What this cost, and the rule it produced

Three killed gate runs, one killed wait-loop, and roughly forty minutes of
wall-clock on a deploy checklist — spent by a session that did not own the
process and could not see it without going looking.

> ⛔ **A shared machine is a shared resource, and a gate cycle contends for the
> BOX, not only for `master`.** Reduce your own footprint before asking anyone to
> stop; measure before blaming the loudest neighbour; and never kill another
> session's work to make room for your own.

`scripts/gate_shards.py` gained `--max-workers` (default unchanged at 2) so a
contended box costs a slow run rather than a lost one.
