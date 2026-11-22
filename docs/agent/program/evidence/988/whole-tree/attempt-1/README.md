# #988 whole-tree pair, attempt-1: stopped, no longer required (AUDIT, 2026-11-11)

**Stopped: the whole-tree pair is no longer required (AUDIT, 2026-11-11).** The Lead stopped it at ~05:32Z, because AUDIT dropped
the local whole-tree pair as a routine GO requirement. This is raw output only. It has not been interpreted, and no head/master
comparison was made.

Both runs: `npx vitest run --exclude "**/zzAudit*"` (the whole tree minus AUDIT's untracked probe files), run under
`agent_suite_lock.py run --who pl-exec` at BelowNormal, one at a time, 30 s apart.

| run | worktree | commit | tree | start (date -u) | node_modules | state |
|---|---|---|---|---|---|---|
| head_fbd9 | C:/w/pl-exec-dev/app | fbd9b12e98e4b849ff7d30578b02f2ee8b0b49e3 | a094b18093 | Wed Nov 11 04:45:30 UTC 2026 | Junction -> C:\w\pl-mc-fw\app\node_modules | finished (2177.47s) |
| master_b786 | C:/w/pl-exec-m4/app (detached) | b786232486ecad514be73b1f4cd5515a0e53b2bb | d059478033 | Wed Nov 11 05:22:24 UTC 2026 | Junction -> C:\w\pl-mc-fw\app\node_modules | STOPPED ~05:32Z, partial, no totals, no JSON |

The junction's package.json differs from master only in the build script and the swr range (^2.4.0 vs 2.4.0). The installed swr is
2.4.0.

Files here: `<run>.totals.txt` (header + totals lines), `head_fbd9.failing-files.txt` (46 files, from the JSON report),
`head_fbd9.failing-tests.txt`, and `census-head_fbd9/` (the raw offender lines, one file per failing census/ratchet rail).
master_b786 has no lists, because it did not finish.

Full raw files (gzip; the sha256 values are of the originals before gzip, and SHA256SUMS.gz.txt beside them has the .gz hashes):

| file | sha256 (original) | backup path |
|---|---|---|
| whole_head_fbd9.clean | 5af0d7c6c05bded4af54c2e65c4fcb144d2c91c40d2e2ca7719a0403b1597876 | /c/Users/blake/uct-backups/988-whole-tree/attempt-1/head_fbd9/whole_head_fbd9.clean.gz |
| whole_head_fbd9.json | a318b5f5e77176cfd9f53cae9a92b50b59c789a06cf46e133cf24500498adde5 | /c/Users/blake/uct-backups/988-whole-tree/attempt-1/head_fbd9/whole_head_fbd9.json.gz |
| whole_head_fbd9.txt (UTF-16) | 0a5255ad0ad88b319602f76613e281a6ee34c4087321a7a6e03052d76f1108aa | /c/Users/blake/uct-backups/988-whole-tree/attempt-1/head_fbd9/whole_head_fbd9.txt.gz |
| whole_master_b786.clean (partial) | 536ab37c77caa2ad323be673aed37ea4e52f69872e91d006325fef982fa4617b | /c/Users/blake/uct-backups/988-whole-tree/attempt-1/master_b786/whole_master_b786.clean.gz |
| whole_master_b786.txt (partial, UTF-16) | c88b57b1d2c1e8f7c4d949187b1703b47013c38410216516dd80aaeea33aa4be | /c/Users/blake/uct-backups/988-whole-tree/attempt-1/master_b786/whole_master_b786.txt.gz |
