# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:53:53`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13q2-q6q13; identity = c953b22344399b4cc1c9811efa126073
- `2026-10-03 04:54:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:56:36`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:59:38`  **shutdown** — C:\data, 62 db files — CLEAN
