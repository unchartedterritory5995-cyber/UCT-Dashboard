# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 06:43:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\select3; identity = a4fbac583bf8db86340bb3b68ae31071
- `2026-10-07 06:45:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 06:47:29`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 06:47:44`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
