# TY3 A/B -- box status and dist verification, per run

`tools/gate_box_lock.py status` read immediately before building each side; dist verified
by content (the CSS chunk carrying `.proseEditor` is bundled into `NotebookFlagGate-*.css`,
not its own `NoteEditorPage-*` chunk -- checked once, directly, before trusting it): a hash
of that chunk's bytes plus whether the B-only marker (`content-visibility` + `1.7em`) is
present. A = `git show f314076f7:<path>` bytes (binary-restored) for both touched files;
B = the committed `39fd60e27` bytes. 2026-10-01, 11:19-11:50 local (CT), interleaved
A1 B1 A2 B2 A3 B3 A4 B4, `--boot --sizes 1000,2000 --opens 20 --chars 60`, a fresh
scratchpad data dir and port per run (never C:\data), one `npm run build` between every
swap. Full per-run stdout: `A1.log` .. `B4.log` in this directory (each carries its own
`dist hash:` and `box status:` lines as its first two, captured before the harness ran).

| run | dist verification | box status |
|---|---|---|
| A1 | NO-MATCH (glob bug in the runner's FIRST hash check, fixed before B1; the dist was independently confirmed A by direct content grep immediately afterward -- see the README) | BUSY -- 5 marked (gate 1, vitest 3, pytest 1) |
| B1 | B (lever present), css-bytes-sha256=7e6601463d3ffc82 | BUSY -- 5 marked (gate 0, vitest 4, pytest 1) |
| A2 | A (lever absent), css-bytes-sha256=51ab0ce75d3c9285 | BUSY -- 2 marked (vitest 2) |
| B2 | B (lever present), css-bytes-sha256=7e6601463d3ffc82 | BUSY -- 2 marked (vitest 2) |
| A3 | A (lever absent), css-bytes-sha256=51ab0ce75d3c9285 | **QUIET** -- 0 marked processes |
| B3 | B (lever present), css-bytes-sha256=7e6601463d3ffc82 | BUSY -- 2 marked (pytest 2) |
| A4 | A (lever absent), css-bytes-sha256=51ab0ce75d3c9285 | BUSY -- 2 marked (pytest 2, same two PIDs as B3) |
| B4 | B (lever present), css-bytes-sha256=7e6601463d3ffc82 | BUSY -- 5 marked (pytest 2, vitest 3) |

The lock (`gate_box_lock.py`'s own coordination ticket, held only by `gate_shards.py`) was
**HELD** by another session's 6-shard gate from before this session started until shortly
before A1; this A/B did not begin until it read FREE, per CLAUDE.md ("if the lock is HELD,
wait"). It never became HELD again during the eight runs; "BUSY" above is box LOAD from
other sessions' vitest/pytest, which `gate_box_lock.py` tracks independently of the lock.

**Only one of eight runs (A3) landed on a quiet box, and it has no quiet B counterpart.**
B's four runs carry a higher average marked-process count (5,2,2,5 = avg 3.5) than A's
(5,2,0,2 = avg 2.25) across this session purely because of when each one happened to land
relative to other sessions' work -- nothing about which side was built controls that. This
is the asymmetry the README's reading accounts for.

After every run the swap-back to B was verified: `git diff --stat` (printed at the end of
each run's own log) and, separately, `python tools/check_repo_hygiene.py` both read clean
against `39fd60e27` with no real content difference (one cosmetic LF-vs-CRLF-on-disk
bookkeeping artifact, corrected, never a byte of actual content change -- `git diff`
itself reported nothing at any point).
