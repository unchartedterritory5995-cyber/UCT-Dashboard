# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:08:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\fe2-1; identity = b851ab731b6a1113424f749f343e2b52
- `2026-10-07 13:10:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:10:49`  **shutdown** — C:\data, 62 db files — CLEAN
