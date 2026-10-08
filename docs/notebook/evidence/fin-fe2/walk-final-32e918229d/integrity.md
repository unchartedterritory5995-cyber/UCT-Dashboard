# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:39:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\fe2-5; identity = a5ca969b7307e865c9188f1ba5243f1d
- `2026-10-07 13:40:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:42:49`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:45:42`  **shutdown** — C:\data, 62 db files — CLEAN
