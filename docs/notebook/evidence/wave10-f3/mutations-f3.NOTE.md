# Why `mutations-f3.log` ends "NOT ALL RED / NOT CLEAN" (review M-5)

The raw log is left as written (R-RAW). Its last line is the harness's own verdict, and it reads
"NOT ALL RED / NOT CLEAN" for one reason: the round-0 harness checked `git status --porcelain` and saw
**its own file**, `mutate_f3.py`, untracked in this directory. Every one of its 8 rows is `"red": true`
with `"restored_sha_ok": true`, and the status line it printed names only that file.

Fix round 1's harness (`mutate_f3_r1.py`) excludes its own path and its logs from the clean check, and
also checks each restore against the committed blob, not only against its own capture:

- `mutations-f3-r1-run1.log`: 15 of 16 red. **M4b survived** because the harness named the wrong rail for
  it (the planted tree-not-under-its-wave-tag case lives in the I-2 rail). Kept as the raw record.
- `mutations-f3-r1.log`: the same 16 with M4b pointed at the right rail, **16 of 16 red**, every restore
  sha-verified and equal to the committed blob, tree clean: "ALL 16 RED, RESTORED, CLEAN".
